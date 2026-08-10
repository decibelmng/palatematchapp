#!/usr/bin/env python3
"""A/B pilot: does telling the scorer that ripeness and weight are DIFFERENT
questions decouple them?

Arm A = the live v3 prompt (SCORE_SYS_V3, unmodified).
Arm B = same prompt with the fp_ripe / fp_body definitions replaced by
        explicitly separated questions plus a cross-contamination rule.

Same cohort as scripts/pilot-v3-deanchored.py, same notes, same model, both arms
scored in the same run so model drift cannot explain a difference.

Reports, per arm: corr(ripe, body), body null rate, ripe null rate, and the
within-(grape,region) SD gate against the frozen v1 priors.

READ-ONLY. Writes nothing to bottles.
"""
import json, os, re, subprocess, sys, statistics as st
from concurrent.futures import ThreadPoolExecutor
import requests

SCAN = "4fd26c64"
AXES = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"]
SRC = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "fingerprint-prompt-v3.ts")
PROMPT_A = re.search(r"const SCORE_SYS_V3 = `([\s\S]*?)`;", open(SRC).read()).group(1)
KEY = os.environ["LOVABLE_API_KEY"]
MODEL = sys.argv[1] if len(sys.argv) > 1 else "google/gemini-3.6-flash"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/pilot-ripe-body.json"

# ── Arm B: the separation patch ───────────────────────────────────────────────
RIPE_OLD = re.search(r"fp_ripe — [\s\S]*?\n\n", PROMPT_A).group(0)
BODY_OLD = re.search(r"fp_body — [\s\S]*?\n\n", PROMPT_A).group(0)

RIPE_NEW = """fp_ripe — RIPENESS OF THE FRUIT ONLY. 0 tart, green, underripe, austere, lean / 1 jammy, raisined, super-ripe, hedonistic.
  The question is: how ripe was the fruit when picked? Read only fruit-maturity language: green, herbaceous, unripe, sour, austere, "canned peas", stalky low; ripe, generous, juicy middle-high; jammy, opulent, lush, decadent, candied, raisiny, "super-ripe", port-like at the top.
  Weight, size and density words are NOT ripeness evidence. "Full-bodied", "dense", "big", "powerful", "concentrated", "thick" tell you how much wine is in the mouth, not how ripe the grapes were. A lean wine can be very ripe; a huge wine can be picked green. If the note gives weight language but no fruit-maturity language, fp_ripe is null.
  "Rich" on its own is weight, not ripeness. "Rich, ripe blackberry" is both — score both.

"""
BODY_NEW = """fp_body — WEIGHT AND VOLUME IN THE MOUTH ONLY. 0 water-light, delicate / 1 thick, heavy, mouth-filling.
  The question is: how much does this wine weigh? Read only weight, size and texture language: light, lean, delicate, "compact", "lightly spritzy" low; medium-bodied, "weight", "richness" middle; full-bodied, dense, thick, syrupy, "sizable", "powerful weight", "concentrated and packed" high.
  Ripeness words are NOT weight evidence. "Jammy", "ripe", "opulent", "lush", "candied", "sweet fruit" describe fruit maturity, not volume. Do not read a ripe note as a heavy wine, and do not read a green or tart note as a light one. Ignore alcohol guesses. If the note gives fruit-maturity language but no weight or texture language, fp_body is null.

"""
SEPARATION_RULE = """
=== RIPENESS AND WEIGHT ARE TWO DIFFERENT QUESTIONS ===

fp_ripe and fp_body must be answered independently. Never infer one from the other's words, and never nudge one toward the other because wines of that style usually score alike. A note may support one, both, or neither. Answering both from the same phrase is an error; returning null for the one the note does not address is correct.
"""

PROMPT_B = PROMPT_A.replace(RIPE_OLD, RIPE_NEW).replace(BODY_OLD, BODY_NEW)
assert PROMPT_B != PROMPT_A and RIPE_NEW in PROMPT_B and BODY_NEW in PROMPT_B, "patch failed"
PROMPT_B = PROMPT_B.replace("=== AXES ===", SEPARATION_RULE.strip() + "\n\n=== AXES ===")


def q(sql):
    out = subprocess.run(["psql", "-At", "-F", "\x1f", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split("\x1f") for l in out.strip("\n").split("\n") if l]


def score(prompt, note, wtype):
    for attempt in range(3):
        try:
            r = requests.post(
                "https://ai.gateway.lovable.dev/v1/chat/completions",
                headers={"content-type": "application/json", "Lovable-API-Key": KEY},
                json={"model": MODEL,
                      "messages": [{"role": "system", "content": prompt},
                                   {"role": "user", "content": json.dumps({"type": wtype, "tasting_note": note})}],
                      "response_format": {"type": "json_object"},
                      "reasoning": {"enabled": False}},
                timeout=180)
            r.raise_for_status()
            c = r.json()["choices"][0]["message"]["content"]
            c = re.sub(r"^```(?:json)?|```$", "", c.strip()).strip()
            j = json.loads(c)
            break
        except Exception:
            if attempt == 2:
                raise

    def one(v):
        if v is None or v == "" or (isinstance(v, str) and v.lower() == "null"):
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return None if x != x else max(0.0, min(1.0, x))
    fp = {a: one(j.get("fp", {}).get(a)) for a in AXES}
    if wtype not in ("red", "dessert"):
        fp["tannin"] = fp["fruit_dark"] = 0.0
    return fp


COHORT_SQL = f"""
with scan_reds as (
  select distinct b.id, b.name, b.producer, b.grape, b.region, b.type,
         {', '.join('b.fp_%s_prior' % a for a in AXES)}, n.note, 'scan' as src
  from scan_wines sw
  join bottles b on b.id = sw.matched_bottle_id
  join catalog_source_notes n on n.bottle_id = b.id
  where sw.scan_id::text like '{SCAN}%' and b.type = 'red'
), napa as (
  select b.id, b.name, b.producer, b.grape, b.region, b.type,
         {', '.join('b.fp_%s_prior' % a for a in AXES)}, n.note, 'napa_cab' as src
  from bottles b join catalog_source_notes n on n.bottle_id = b.id
  where b.region = 'Napa Valley' and b.grape = 'Cabernet Sauvignon'
    and b.id not in (select id from scan_reds)
  order by n.points desc nulls last, b.name
  limit 30
)
select * from scan_reds union all select * from napa;
"""

cols = ["id", "name", "producer", "grape", "region", "type"] + [f"prior_{a}" for a in AXES] + ["note", "src"]
rows = [dict(zip(cols, r)) for r in q(COHORT_SQL)]
print(f"model: {MODEL}   cohort: {len(rows)} reds\n")

jobs = [(arm, r) for arm in ("A", "B") for r in rows]
with ThreadPoolExecutor(max_workers=8) as ex:
    res = list(ex.map(lambda j: score(PROMPT_A if j[0] == "A" else PROMPT_B, j[1]["note"], j[1]["type"]), jobs))
for (arm, r), fp in zip(jobs, res):
    r[arm] = fp
for r in rows:
    r["prior"] = {a: float(r[f"prior_{a}"]) for a in AXES}


def pearson(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None, len(pairs)
    xs2 = [p[0] for p in pairs]; ys2 = [p[1] for p in pairs]
    mx, my = st.mean(xs2), st.mean(ys2)
    num = sum((x - mx) * (y - my) for x, y in pairs)
    den = (sum((x - mx) ** 2 for x in xs2) * sum((y - my) ** 2 for y in ys2)) ** 0.5
    return (num / den if den > 1e-12 else None), len(pairs)


def spread(vals):
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        return {"sd": 0.0, "n": len(vals)}
    return {"sd": st.pstdev(vals), "n": len(vals)}


print("=== 1. corr(ripe, body) ===")
for arm, lab in (("prior", "v1 prior"), ("A", "v3 current"), ("B", "v3 separated")):
    r_, n = pearson([x[arm]["ripe"] for x in rows], [x[arm]["body"] for x in rows])
    print(f"{lab:<14} r = {'n/a' if r_ is None else f'{r_:+.3f}'}   pairs both-read n={n}")

print("\n=== 2. null rate per axis ===")
print(f"{'axis':<11}{'A current':>11}{'B separated':>13}")
for a in AXES:
    na = sum(1 for r in rows if r["A"][a] is None)
    nb = sum(1 for r in rows if r["B"][a] is None)
    print(f"{a:<11}{100.0*na/len(rows):>10.0f}%{100.0*nb/len(rows):>12.0f}%")
for arm in ("A", "B"):
    reads = [sum(1 for a in AXES if r[arm][a] is not None) for r in rows]
    print(f"arm {arm}: mean axes read {st.mean(reads):.2f}  median {st.median(reads):.0f}")

print("\n=== 3. within-(Napa Valley, Cabernet Sauvignon) SD gate ===")
napa = [r for r in rows if r["region"] == "Napa Valley" and r["grape"] == "Cabernet Sauvignon"]
print(f"n={len(napa)}")
print(f"{'axis':<11}{'v1 sd':>8}{'A sd':>8}{'A/v1':>7}{'B sd':>8}{'B/v1':>7}{'B/A':>7}")
ra, rb = [], []
for a in AXES:
    p, A, B = spread([r["prior"][a] for r in napa]), spread([r["A"][a] for r in napa]), spread([r["B"][a] for r in napa])
    f = lambda x: (x["sd"] / p["sd"]) if p["sd"] > 1e-9 else float("nan")
    ra.append(f(A)); rb.append(f(B))
    ba = (B["sd"] / A["sd"]) if A["sd"] > 1e-9 else float("nan")
    print(f"{a:<11}{p['sd']:>8.3f}{A['sd']:>8.3f}{f(A):>7.2f}{B['sd']:>8.3f}{f(B):>7.2f}{ba:>7.2f}")
fin = lambda xs: [x for x in xs if x == x]
print(f"mean SD ratio vs v1 — A {st.mean(fin(ra)):.2f}   B {st.mean(fin(rb)):.2f}")
print(f"axes improved vs v1 — A {sum(1 for x in fin(ra) if x>1)}/{len(fin(ra))}   B {sum(1 for x in fin(rb) if x>1)}/{len(fin(rb))}")

json.dump({"model": MODEL, "prompt_b": PROMPT_B,
           "rows": [{k: r[k] for k in ("id", "name", "producer", "grape", "region", "src", "prior", "A", "B")} for r in rows]},
          open(OUT, "w"), indent=1)
print(f"\nfull results → {OUT} (no database writes)")
