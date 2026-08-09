import json, os, re, statistics, time, requests, subprocess
from concurrent.futures import ThreadPoolExecutor
KEY = os.environ["LOVABLE_API_KEY"]
URL = "https://ai.gateway.lovable.dev/v1/chat/completions"
AXES = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"]
src = open("/dev-server/src/lib/fingerprint-prompt-v3.ts").read()
SYS = src.split("const SCORE_SYS_V3 = `",1)[1].split("`;",1)[0]

q = ("select json_agg(t) from (select b.id, b.type, b.region, n.note "
     "from public.catalog_source_notes n join public.bottles b on b.id=n.bottle_id "
     "where n.note is not null and length(n.note)>150 order by md5(b.id::text) limit 300) t")
rows = json.loads(subprocess.check_output(["psql","-At","-c",q]).decode())
print("rows", len(rows))

def call(row, extra):
    for attempt in range(3):
        try:
            r = requests.post(URL, headers={"content-type":"application/json","Lovable-API-Key":KEY},
                json={"model":"google/gemini-3.6-flash","messages":[{"role":"system","content":SYS},
                {"role":"user","content":json.dumps({"type":row["type"],"tasting_note":row["note"]})}],
                "response_format":{"type":"json_object"}, **extra}, timeout=180)
            if r.status_code == 429:
                time.sleep(2*(attempt+1)); continue
            if r.status_code != 200: return None
            c = r.json()["choices"][0]["message"].get("content") or ""
            c = re.sub(r"^```(?:json)?","",c.strip()).rstrip("`").strip()
            return json.loads(c)
        except Exception:
            time.sleep(1)
    return None

arms = {"A_reasoning": {}, "C_no_reasoning": {"reasoning":{"enabled":False}}}
res = {}
for name, extra in arms.items():
    t0=time.time()
    with ThreadPoolExecutor(max_workers=16) as ex:
        res[name]=list(ex.map(lambda r: call(r, extra), rows))
    print(f"{name}: {sum(1 for x in res[name] if x)}/{len(rows)} ok in {time.time()-t0:.0f}s")

def col(arm,a): return [(x.get("fp",{}) or {}).get(a) if x else None for x in res[arm]]
print(f"\n{'axis':12s} {'nA':>4} {'sdA':>7} {'nC':>4} {'sdC':>7} {'sdC/sdA':>8} {'r':>6} {'MAD':>6}")
for a in AXES:
    pa, pc = col("A_reasoning",a), col("C_no_reasoning",a)
    va=[v for v in pa if isinstance(v,(int,float))]; vc=[v for v in pc if isinstance(v,(int,float))]
    sda=statistics.stdev(va) if len(va)>1 else 0; sdc=statistics.stdev(vc) if len(vc)>1 else 0
    both=[(u,v) for u,v in zip(pa,pc) if isinstance(u,(int,float)) and isinstance(v,(int,float))]
    r = round(statistics.correlation([u for u,_ in both],[v for _,v in both]),3) if len(both)>2 else None
    mad = round(sum(abs(u-v) for u,v in both)/len(both),3) if both else None
    print(f"{a:12s} {len(va):4d} {sda:7.4f} {len(vc):4d} {sdc:7.4f} {sdc/sda if sda else 0:8.3f} {str(r):>6} {str(mad):>6}")

# within-region discrimination: the real gate
for arm in arms:
    byreg = {}
    for row,x in zip(rows,res[arm]):
        if not x: continue
        byreg.setdefault(row["region"] or "?", []).append(x.get("fp",{}) or {})
    wr, tot = [], []
    for a in AXES:
        inner=[]
        for reg,fps in byreg.items():
            v=[f.get(a) for f in fps if isinstance(f.get(a),(int,float))]
            if len(v)>2: inner.append(statistics.stdev(v))
        allv=[f.get(a) for fps in byreg.values() for f in fps if isinstance(f.get(a),(int,float))]
        if inner and len(allv)>1: wr.append(sum(inner)/len(inner)); tot.append(statistics.stdev(allv))
    print(f"{arm}: mean within-region SD={sum(wr)/len(wr):.4f}  mean overall SD={sum(tot)/len(tot):.4f}  ratio={sum(wr)/sum(tot):.3f}")
