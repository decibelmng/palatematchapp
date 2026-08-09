#!/usr/bin/env python3
"""Phase 3 pilot — de-anchored v3 scorer on real recovered tasting notes.

Cohort: the reds that matched on scan 4fd26c64 + Napa Cabernets to 41 wines.
Reads notes from public.catalog_source_notes, scores each blind with the v3
prompt (type + note only), and reports within-(grape,region) discrimination
against the frozen v1 priors. READ-ONLY: writes nothing to bottles.
"""
import json, os, re, subprocess, sys, statistics as st
from concurrent.futures import ThreadPoolExecutor
import requests

SCAN = "4fd26c64"
AXES = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"]
SRC = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "fingerprint-prompt-v3.ts")
PROMPT = re.search(r"const SCORE_SYS_V3 = `([\s\S]*?)`;", open(SRC).read()).group(1)
KEY = os.environ["LOVABLE_API_KEY"]
MODEL = sys.argv[1] if len(sys.argv) > 1 else "google/gemini-2.5-flash"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/pilot-v3.json"


def q(sql):
    out = subprocess.run(["psql", "-At", "-F", "\x1f", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split("\x1f") for l in out.strip("\n").split("\n") if l]


def score(note, wtype):
    r = requests.post(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        headers={"content-type": "application/json", "Lovable-API-Key": KEY},
        json={"model": MODEL,
              "messages": [{"role": "system", "content": PROMPT},
                           {"role": "user", "content": json.dumps({"type": wtype, "tasting_note": note})}],
              "response_format": {"type": "json_object"}},
        timeout=120)
    r.raise_for_status()
    c = r.json()["choices"][0]["message"]["content"]
    c = re.sub(r"^```(?:json)?|```$", "", c.strip()).strip()
    j = json.loads(c)
    def one(v):
        if v is None or v == "" or (isinstance(v, str) and v.lower() == "null"):
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return None if x != x else max(0.0, min(1.0, x))
    fp = {a: one(j["fp"].get(a)) for a in AXES}
    if wtype not in ("red", "dessert"):
        fp["tannin"] = fp["fruit_dark"] = 0.0  # structurally absent, not unread
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
print(f"model: {MODEL}")
print(f"cohort: {len(rows)} wines "
      f"({sum(1 for r in rows if r['src']=='scan')} from scan {SCAN}, "
      f"{sum(1 for r in rows if r['src']=='napa_cab')} extra Napa Cab)\n")

with ThreadPoolExecutor(max_workers=6) as ex:
    fps = list(ex.map(lambda r: score(r["note"], r["type"]), rows))
for r, fp in zip(rows, fps):
    r["v3"] = fp
    r["prior"] = {a: float(r[f"prior_{a}"]) for a in AXES}


def spread(vals):
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        return {"sd": 0.0, "range": 0.0, "n": len(vals)}
    return {"sd": st.pstdev(vals), "range": max(vals) - min(vals), "n": len(vals)}


def group_report(label, subset):
    if len(subset) < 3:
        return
    print(f"--- {label}  (n={len(subset)}) ---")
    print(f"{'axis':<11}{'v1 sd':>8}{'v3 sd':>8}{'ratio':>8}{'v1 rng':>9}{'v3 rng':>9}{'v3 n':>7}{'null%':>7}")
    ratios = []
    for a in AXES:
        p = spread([r["prior"][a] for r in subset])
        v = spread([r["v3"][a] for r in subset])
        ratio = (v["sd"] / p["sd"]) if p["sd"] > 1e-9 else float("inf")
        ratios.append(ratio)
        nullpct = 100.0 * (len(subset) - v["n"]) / len(subset)
        print(f"{a:<11}{p['sd']:>8.3f}{v['sd']:>8.3f}{ratio:>8.2f}{p['range']:>9.3f}"
              f"{v['range']:>9.3f}{v['n']:>7}{nullpct:>7.0f}")
    fin = [x for x in ratios if x != float("inf")]
    print(f"mean sd ratio v3/v1: {st.mean(fin):.2f}  "
          f"axes improved: {sum(1 for x in ratios if x > 1)}/{len(ratios)}\n")


def dist(x, y):
    """Rescaled over the axes readable on BOTH sides — same convention as
    omegaDistance. No comparable axis returns inf, never 0."""
    ks = [a for a in AXES if x.get(a) is not None and y.get(a) is not None]
    if not ks:
        return float("inf")
    return (sum((x[a] - y[a]) ** 2 for a in ks) / len(ks)) ** 0.5 * (len(AXES) ** 0.5)


def null_report(rows):
    print("--- null rate per axis (all %d wines) ---" % len(rows))
    for a in AXES:
        n = sum(1 for r in rows if r["v3"][a] is None)
        print(f"{a:<11}{n:>4} null  {100.0*n/len(rows):>5.1f}%")
    counts = [sum(1 for a in AXES if r["v3"][a] is None) for r in rows]
    print("nulls per wine: " + "  ".join(
        f"{k}:{counts.count(k)}" for k in range(0, 9) if counts.count(k)))
    thin = [(r["name"], c) for r, c in zip(rows, counts) if c > 3]
    print(f"wines with >3 null axes: {len(thin)}")
    for n, c in thin:
        print(f"   {c} nulls  {n}")
    print()


null_report(rows)

napa_cab = [r for r in rows if r["region"] == "Napa Valley" and r["grape"] == "Cabernet Sauvignon"]
group_report("PRIMARY GATE — Napa Valley / Cabernet Sauvignon", napa_cab)
group_report(f"scan {SCAN} reds", [r for r in rows if r["src"] == "scan"])

print("--- pairwise separation within Napa Cab ---")
for lab in ("prior", "v3"):
    ds = [dist(a[lab], b[lab]) for i, a in enumerate(napa_cab) for b in napa_cab[i + 1:]]
    print(f"{lab:<6} mean {st.mean(ds):.3f}  median {st.median(ds):.3f}  "
          f"min {min(ds):.3f}  max {max(ds):.3f}  identical pairs {sum(1 for d in ds if d < 1e-6)}")

named = {p.lower(): None for p in ("corison", "caymus", "shafer", "silver oak", "spottswoode", "frog's leap")}
picks = {}
for r in napa_cab:
    k = r["producer"].lower()
    if k in named and k not in picks:
        picks[k] = r
if len(picks) >= 2:
    print("\n--- named-producer check (should NOT be near-identical) ---")
    ks = list(picks)
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            print(f"{a} vs {b}: v1 d={dist(picks[a]['prior'], picks[b]['prior']):.3f}   "
                  f"v3 d={dist(picks[a]['v3'], picks[b]['v3']):.3f}")
    print()
    for k, r in picks.items():
        print(f"{r['producer']:<14} v3 " + " ".join(f"{a[:4]}={r['v3'][a]:.2f}" for a in AXES))

json.dump([{k: r[k] for k in ("id", "name", "producer", "grape", "region", "src", "prior", "v3")} for r in rows],
          open(OUT, "w"), indent=1)
print(f"\nfull results → {OUT} (no database writes)")
