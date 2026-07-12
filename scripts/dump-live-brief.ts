import { createClient } from "@supabase/supabase-js";
import { buildFullBrief, type BriefBenchmark, type TypeBriefInputs } from "@/lib/sommelier-brief";
import { buildTypeContext, distanceInContext, type FpKey, type RatedFp } from "@/lib/recommender";
import type { RatedBottle, PaletteType } from "@/lib/palate";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
const sb = createClient(url, key);
const USER = "e3c4104c-56e7-4b6b-a359-5dc063302951";
const AXES: FpKey[] = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"];

async function main() {
  const { data: bottles } = await sb.from("bottles").select("id,name,producer,region,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet");
  const byId = new Map((bottles ?? []).map((b:any)=>[b.id,b]));
  const { data: ratings } = await sb.from("ratings").select("bottle_id,stars").eq("user_id",USER);
  const { data: cwins } = await (sb as any).from("canon_wines").select("id,bottle_id,tier,wine_type,created_at").eq("user_id",USER).is("replaced_at",null).order("created_at",{ascending:false});
  const canonIds = new Set((cwins??[]).filter((c:any)=>c.tier==="canon").map((c:any)=>c.bottle_id));
  const nemIds = new Set((cwins??[]).filter((c:any)=>c.tier==="nemesis").map((c:any)=>c.bottle_id));

  const rfpAll: RatedFp[] = [];
  for (const r of (ratings??[]) as any[]) {
    const b:any = byId.get(r.bottle_id); if (!b) continue;
    rfpAll.push({ id:b.id, name:b.name, producer:b.producer, region:b.region,
      type: b.type==="white"?"white":"red",
      fp:{fresh:b.fp_fresh,acid:b.fp_acid,tannin:b.fp_tannin,fruit_dark:b.fp_fruit_dark,ripe:b.fp_ripe,oak:b.fp_oak,body:b.fp_body,savory:b.fp_savory},
      stars:r.stars, canon:canonIds.has(b.id), nemesis:nemIds.has(b.id)});
  }
  const toRated = (t:PaletteType):RatedBottle[] => (ratings??[]).flatMap((r:any)=>{
    const b:any=byId.get(r.bottle_id); if(!b||b.type!==t) return [];
    return [{stars:r.stars, canon:canonIds.has(b.id), values:{body:b.ax_body,fruit_char:b.ax_fruit_char,tannin:b.ax_tannin,acidity:b.ax_acidity,sweet:b.ax_sweet}}];
  });
  const toBench = (t:"red"|"white"):BriefBenchmark[] => (cwins??[]).flatMap((c:any)=>{
    const b:any=byId.get(c.bottle_id); if(!b||(b.type==="white"?"white":"red")!==t) return [];
    return [{id:c.id, bottleId:c.bottle_id, name:b.name, producer:b.producer, region:b.region,
      fp:{fresh:b.fp_fresh,acid:b.fp_acid,tannin:b.fp_tannin,fruit_dark:b.fp_fruit_dark,ripe:b.fp_ripe,oak:b.fp_oak,body:b.fp_body,savory:b.fp_savory},
      createdAt:c.created_at, tier:c.tier}];
  });

  for (const t of ["red","white"] as const) {
    console.log(`\n═══ ${t.toUpperCase()} — LIVE CLUSTER ASSIGNMENTS ═══`);
    const sameFp = rfpAll.filter(r=>r.type===t);
    const ctx = buildTypeContext(sameFp, t);
    if (!ctx) { console.log("  (no ctx)"); continue; }
    console.log(`  h=${ctx.h.toFixed(3)}  active=${ctx.fit.active.join(",")}`);
    const canonsFp = sameFp.filter(r=>r.canon);
    // Same union-find as sommelier-brief
    const n=canonsFp.length; const p=Array.from({length:n},(_,i)=>i);
    const find=(x:number):number=>p[x]===x?x:(p[x]=find(p[x]));
    for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) {
      const d=distanceInContext(canonsFp[i].fp,canonsFp[j].fp,ctx);
      if (d<ctx.h) { const ra=find(i),rb=find(j); if(ra!==rb) p[ra]=rb; }
    }
    const groups=new Map<number,RatedFp[]>();
    for (let i=0;i<n;i++){ const r=find(i); const a=groups.get(r)??[]; a.push(canonsFp[i]); groups.set(r,a); }
    let idx=0;
    for (const g of groups.values()) {
      idx++;
      const centroid={} as Record<FpKey,number>;
      for (const k of AXES) centroid[k] = g.reduce((s,r)=>s+r.fp[k],0)/g.length;
      console.log(`  Lane ${idx}: ${g.length} canon(s) — centroid tannin=${centroid.tannin.toFixed(2)} acid=${centroid.acid.toFixed(2)} body=${centroid.body.toFixed(2)} fruit_dark=${centroid.fruit_dark.toFixed(2)}`);
      for (const r of g) console.log(`     • ${r.producer ?? "?"} — ${r.name}`);
    }
  }

  const redRated = toRated("red"), whiteRated = toRated("white");
  const redInput:TypeBriefInputs|null = redRated.length? { type:"red", rated:redRated, ratedFp:rfpAll.filter(r=>r.type==="red"), canons:toBench("red").filter((b:any)=>b.tier==="canon"), nemeses:toBench("red").filter((b:any)=>b.tier==="nemesis") } : null;
  const whiteInput:TypeBriefInputs|null = whiteRated.length? { type:"white", rated:whiteRated, ratedFp:rfpAll.filter(r=>r.type==="white"), canons:toBench("white").filter((b:any)=>b.tier==="canon"), nemeses:toBench("white").filter((b:any)=>b.tier==="nemesis") } : null;
  const brief = buildFullBrief({red:redInput,white:whiteInput});
  console.log("\n═══ FULL BRIEF ═══\n");
  console.log(brief.text);
  console.log(`\n(word count: ${brief.wordCount}, overBudget=${brief.overBudget})`);
}
main().catch(e=>{console.error(e);process.exit(1)});
