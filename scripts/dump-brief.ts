import { buildTypeBrief, type BriefBenchmark, type TypeBriefInputs } from "@/lib/sommelier-brief";
import type { FpKey, RatedFp } from "@/lib/recommender";
import type { RatedBottle } from "@/lib/palate";
const AXES: FpKey[] = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"];
const fp = (p:any={}) => { const o:any={}; for(const k of AXES) o[k]=p[k]??0.5; return o; };
const rf = (id:string,s:number,v:any={},x:any={}):RatedFp => ({id,name:id,producer:null,region:null,type:"red",fp:fp(v),stars:s,canon:x.canon,nemesis:x.nemesis});
const rr = (s:number,v:any,c=false):RatedBottle => ({stars:s,canon:c,values:{body:v.body??0.5,fruit_char:v.fruit_char??0.5,tannin:v.tannin??0.5,acidity:v.acidity??0.5,sweet:0.05}});
const b = (id:string,v:any,m:any):BriefBenchmark => ({id,bottleId:id,name:m.name,producer:m.producer??null,region:m.region??null,fp:fp(v),createdAt:m.createdAt??"2026-01-01"});
const rated:RatedBottle[]=[];
for(let i=0;i<5;i++) rated.push(rr(5,{tannin:0.2,fruit_char:0.3,body:0.35,acidity:0.75},true));
for(let i=0;i<5;i++) rated.push(rr(5,{tannin:0.85,fruit_char:0.8,body:0.85,acidity:0.6},true));
rated.push(rr(1,{tannin:0.9,fruit_char:0.95}));
const rfp:RatedFp[]=[];
for(let i=0;i<5;i++) rfp.push(rf(`silky-${i}`,5,{tannin:0.2,fruit_dark:0.3,body:0.35,acid:0.75,fresh:0.75},{canon:i===0}));
for(let i=0;i<5;i++) rfp.push(rf(`grippy-${i}`,5,{tannin:0.85,fruit_dark:0.8,body:0.85,acid:0.6,oak:0.7},{canon:i===0}));
rfp.push(rf("neme-1",1,{tannin:0.9,fruit_dark:0.95,ripe:0.95},{nemesis:true}));
const canons=[
  b("silky-0",{tannin:0.2,fruit_dark:0.3,body:0.35,acid:0.75,fresh:0.75},{name:"Vosne-Romanée VV",producer:"Alex Gambal",region:"Vosne-Romanée"}),
  b("grippy-0",{tannin:0.85,fruit_dark:0.8,body:0.85,oak:0.7},{name:"Hillside Select",producer:"Shafer",region:"Napa"}),
];
const nemeses=[b("n-lodi",{tannin:0.75,fruit_dark:0.95,ripe:0.95,oak:0.7},{name:"Old Vine Zinfandel",producer:"Lodi Producer",region:"Lodi"})];
const input:TypeBriefInputs={type:"red",rated,ratedFp:rfp,canons,nemeses};
console.log(buildTypeBrief(input)?.text);
