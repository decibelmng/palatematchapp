#!/usr/bin/env python3
"""Side-by-side gate comparison: v1 priors vs v3 on 2.5-flash vs v3 on 3.6-flash.

Reads the two pilot dumps (identical 40-wine cohort, identical prompt) and
scores Corison separately, since it is not in the cohort but is the named
control for the "Corison and Caymus are the same wine to the engine" defect.
READ-ONLY.
"""
import json, os, re, statistics as st, subprocess, sys
import requests

AXES = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"]
ACTIVE = [a for a in AXES if a != "fresh"]  # fresh retired
SRC = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "fingerprint-prompt-v3.ts")
PROMPT = re.search(r"const SCORE_SYS_V3 = `([\s\S]*?)`;", open(SRC).read()).group(1)
KEY = os.environ["LOVABLE_API_KEY"]

A = {r["id"]: r for r in json.load(open("/tmp/pilot-v3.json"))}      # 2.5-flash
B = {r["id"]: r for r in json.load(open("/tmp/pilot-v3-36.json"))}   # 3.6-flash
rows = [B[i] for i in B]


def q(sql):
    out = subprocess.run(["psql", "-At", "-F", "\x1f", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split("\x1f") for l in out.strip("\n").split("\n") if l]


def score(note, wtype, model):
    r = requests.post("https://ai.gateway.lovable.dev/v1/chat/completions",
        headers={"content-type": "application/json", "Lovable-API-Key": KEY},
        json={"model": model,
              "messages": [{"role": "system", "content": PROMPT},
                           {"role": "user", "content": json.dumps({"type": wtype, "tasting_note": note})}],
              "response_format": {"type": "json_object"}}, timeout=180)
    r.raise_for_status()
    c = re.sub(r"^```(?:json)?|```$", "", r.json()["choices"][0]["message"]["content"].strip()).strip()
    j = json.loads(c)

    def one(v):
        if v is None or v == "" or (isinstance(v, str) and v.lower() == "null"):
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return None if x != x else max(0.0, min(1.0, x))
    return {a: one(j["fp"].get(a)) for a in AXES}


def sd(vals):
    vals = [v for v in vals if v is not None]
    return st.pstdev(vals) if len(vals) > 1 else 0.0


napa = [r for r in rows if r["region"] == "Napa Valley" and r["grape"] == "Cabernet Sauvignon"]
print(f"=== PRIMARY GATE — Napa Valley / Cabernet Sauvignon (n={len(napa)}) ===")
print(f"{'axis':<11}{'v1 sd':>8}{'2.5 sd':>8}{'3.6 sd':>8}{'2.5/v1':>8}{'3.6/v1':>8}{'3.6/2.5':>9}")
r36, r25 = [], []
for a in AXES:
    s1 = sd([r["prior"][a] for r in napa])
    s25 = sd([A[r["id"]]["v3"][a] for r in napa])
    s36 = sd([r["v3"][a] for r in napa])
    q25 = s25 / s1 if s1 > 1e-9 else float("inf")
    q36 = s36 / s1 if s1 > 1e-9 else float("inf")
    if a in ACTIVE:
        r25.append(q25); r36.append(q36)
    tag = "" if a in ACTIVE else "  (retired)"
    print(f"{a:<11}{s1:>8.3f}{s25:>8.3f}{s36:>8.3f}{q25:>8.2f}{q36:>8.2f}"
          f"{(s36/s25 if s25 > 1e-9 else float('inf')):>9.2f}{tag}")
print(f"\nactive axes (7, fresh retired): mean 2.5/v1 {st.mean(r25):.2f}   mean 3.6/v1 {st.mean(r36):.2f}")
print(f"active axes up on v1: 2.5 {sum(1 for x in r25 if x > 1)}/7   3.6 {sum(1 for x in r36 if x > 1)}/7")

print("\n=== NULL RATE per axis (40 wines) ===")
print(f"{'axis':<11}{'2.5':>8}{'3.6':>8}{'delta':>8}")
for a in AXES:
    n25 = 100.0 * sum(1 for r in rows if A[r["id"]]["v3"][a] is None) / len(rows)
    n36 = 100.0 * sum(1 for r in rows if r["v3"][a] is None) / len(rows)
    print(f"{a:<11}{n25:>7.1f}%{n36:>7.1f}%{n36 - n25:>+7.1f}")

for lab, D in (("2.5", A), ("3.6", B)):
    cnt = [sum(1 for a in ACTIVE if D[r["id"]]["v3"][a] is None) for r in rows]
    read = [7 - c for c in cnt]
    print(f"{lab}: active axes read per wine — "
          + "  ".join(f"{k}:{read.count(k)}" for k in range(8) if read.count(k))
          + f"   below 3-axis floor: {sum(1 for x in read if x < 3)}")


def dist(x, y, keys=ACTIVE):
    ks = [a for a in keys if x.get(a) is not None and y.get(a) is not None]
    if len(ks) < 3:
        return float("inf")
    return (sum((x[a] - y[a]) ** 2 for a in ks) / len(ks)) ** 0.5 * (len(keys) ** 0.5)


print("\n=== CORISON vs CAYMUS ===")
cor = q("""select b.id, b.name, b.type, n.note,
       b.fp_fresh_prior, b.fp_acid_prior, b.fp_tannin_prior, b.fp_fruit_dark_prior,
       b.fp_ripe_prior, b.fp_oak_prior, b.fp_body_prior, b.fp_savory_prior
from bottles b join catalog_source_notes n on n.bottle_id = b.id
where b.producer = 'Corison' and b.region = 'Napa Valley' limit 1""")[0]
corison = {"name": cor[1], "prior": {a: float(cor[4 + i]) for i, a in enumerate(AXES)},
           "v3_25": score(cor[3], cor[2], "google/gemini-2.5-flash"),
           "v3_36": score(cor[3], cor[2], "google/gemini-3.6-flash")}
cay = next(r for r in rows if r["producer"] == "Caymus")
caymus = {"name": cay["name"], "prior": cay["prior"],
          "v3_25": A[cay["id"]]["v3"], "v3_36": cay["v3"]}
print(f"Corison: {corison['name']}\nCaymus : {caymus['name']}\n")
for lab, k in (("v1 prior", "prior"), ("v3 2.5-flash", "v3_25"), ("v3 3.6-flash", "v3_36")):
    print(f"-- {lab} --")
    for w in (corison, caymus):
        print(f"   {w['name'][:34]:<36}" + " ".join(
            f"{a[:4]}=" + ("null" if w[k][a] is None else f"{w[k][a]:.2f}") for a in AXES))
    print(f"   distance (7 active axes): {dist(corison[k], caymus[k]):.3f}\n")

json.dump({"corison": corison, "caymus": caymus}, open("/tmp/corison-caymus.json", "w"), indent=1)
