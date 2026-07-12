import { readFileSync } from "node:fs";
import { buildFullBrief, type BriefBenchmark, type TypeBriefInputs } from "@/lib/sommelier-brief";
import { buildTypeContext, distanceInContext, type FpKey, type RatedFp } from "@/lib/recommender";
import type { RatedBottle, PaletteType } from "@/lib/palate";

const AXES: FpKey[] = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"];
const data = JSON.parse(readFileSync("/tmp/livebrief/data.json","utf8"));
const bottles: any[] = data.bottles ?? [];
const ratings: any[] = data.ratings ?? [];
const canons: any[] = data.canons ?? [];
const byId = new Map(bottles.map(b=>[b.id,b]));
const canonIds = new Set(canons.filter(c=>c.tier==="canon").map(c=>c.bottle_id));
const nemIds = new Set(canons.filter(c=>c.tier==="nemesis").map(c=>c.bottle_id));

const rfp: RatedFp[] = ratings.flatMap((r:any)=>{
  const b:any = byId.get(r.bottle_id); if (!b) return [];
  return [{ id:b.id, name:b.name, producer:b.producer, region:b.region,
    type: b.type==="white"?"white":"red",
    fp:{fresh:b.fp_fresh,acid:b.fp_acid,tannin:b.fp_tannin,fruit_dark:b.fp_fruit_dark,ripe:b.fp_ripe,oak:b.fp_oak,body:b.fp_body,savory:b.fp_savory},
    stars:r.stars, canon:canonIds.has(b.id), nemesis:nemIds.has(b.id)}];
});
const toRated = (t:PaletteType):RatedBottle[] => ratings.flatMap((r:any)=>{
  const b:any=byId.get(r.bottle_id); if(!b) return [];
  const bt = b.type==="white"?"white":"red";
  if (bt!==t) return [];
  return [{stars:r.stars, canon:canonIds.has(b.id), values:{body:b.ax_body,fruit_char:b.ax_fruit_char,tannin:b.ax_tannin,acidity:b.ax_acidity,sweet:b.ax_sweet}}];
});
const toBench = (t:"red"|"white",tier:"canon"|"nemesis"):BriefBenchmark[] => canons.flatMap((c:any)=>{
  if (c.tier!==tier) return [];
  const b:any=byId.get(c.bottle_id); if(!b) return [];
  const bt = b.type==="white"?"white":"red"; if (bt!==t) return [];
  return [{id:c.id, bottleId:c.bottle_id, name:b.name, producer:b.producer, region:b.region,
    fp:{fresh:b.fp_fresh,acid:b.fp_acid,tannin:b.fp_tannin,fruit_dark:b.fp_fruit_dark,ripe:b.fp_ripe,oak:b.fp_oak,body:b.fp_body,savory:b.fp_savory},
    createdAt:c.created_at}];
});

for (const t of ["red","white"] as const) {
  console.log(`\n═══ ${t.toUpperCase()} — LIVE CANON CLUSTER ASSIGNMENTS ═══`);
  const sameFp = rfp.filter(r=>r.type===t);
  const ctx = buildTypeContext(sameFp, t);
  if (!ctx) { console.log("  (no ctx — insufficient data)"); continue; }
  console.log(`  h=${ctx.h.toFixed(3)}  activeAxes=[${ctx.fit.active.join(",")}]`);
  const cf = sameFp.filter(r=>r.canon);
  const n=cf.length; const p=Array.from({length:n},(_,i)=>i);
  const find=(x:number):number=>p[x]===x?x:(p[x]=find(p[x]));
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) {
    const d=distanceInContext(cf[i].fp,cf[j].fp,ctx);
    if (d<ctx.h) { const ra=find(i),rb=find(j); if(ra!==rb) p[ra]=rb; }
  }
  const groups=new Map<number,RatedFp[]>();
  for (let i=0;i<n;i++){ const r=find(i); const a=groups.get(r)??[]; a.push(cf[i]); groups.set(r,a); }
  let idx=0;
  for (const g of [...groups.values()].sort((a,b)=>b.length-a.length)) {
    idx++;
    const centroid={} as Record<FpKey,number>;
    for (const k of AXES) centroid[k] = g.reduce((s,r)=>s+r.fp[k],0)/g.length;
    console.log(`  Lane ${idx}: ${g.length} canon(s)  tannin=${centroid.tannin.toFixed(2)} acid=${centroid.acid.toFixed(2)} body=${centroid.body.toFixed(2)} fruit_dark=${centroid.fruit_dark.toFixed(2)} oak=${centroid.oak.toFixed(2)}`);
    for (const r of g) console.log(`     • ${r.producer ?? "?"} — ${r.name}`);
  }
}

const redRated = toRated("red"), whiteRated = toRated("white");
const redInput:TypeBriefInputs|null = redRated.length? { type:"red", rated:redRated, ratedFp:rfp.filter(r=>r.type==="red"), canons:toBench("red","canon"), nemeses:toBench("red","nemesis") } : null;
const whiteInput:TypeBriefInputs|null = whiteRated.length? { type:"white", rated:whiteRated, ratedFp:rfp.filter(r=>r.type==="white"), canons:toBench("white","canon"), nemeses:toBench("white","nemesis") } : null;
const brief = buildFullBrief({red:redInput,white:whiteInput});
console.log("\n═══ FULL BRIEF ═══\n");
console.log(brief.text);
console.log(`\n(word count: ${brief.wordCount}, overBudget=${brief.overBudget})`);
