import { recommend } from "@/lib/recommender";
import type { RatedFp, BottleFp } from "@/lib/recommender";

const fp = (a:number,b:number,c:number,d:number,e:number,f:number,g:number,h:number) =>
  ({ fresh:a, acid:b, tannin:c, fruit_dark:d, ripe:e, oak:f, body:g, savory:h });

const mk = (id:string, stars:number, x:any, benchmark=false, nemesis=false): RatedFp => ({
  id, name:id, type:"red", fp:x, stars,
  weight: benchmark || nemesis ? 3 : 1,
  canon: benchmark, nemesis,
});

const rated: RatedFp[] = [
  mk("d5a147bb",5,fp(0.35,0.55,0.7,0.9,0.8,0.85,0.85,0.3)),
  mk("766ad257",5,fp(0.35,0.55,0.7,0.9,0.8,0.85,0.85,0.3)),
  mk("6c158623",5,fp(0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4)),
  mk("1e33d57a",5,fp(0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4),true),
  mk("d56238bf",5,fp(0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5)),
  mk("6f72ac21",5,fp(0.4,0.65,0.85,0.85,0.65,0.4,0.8,0.5)),
  mk("9b76d5a8",5,fp(0.7,0.7,0.7,0.8,0.75,0.65,0.75,0.4),true),
  mk("bc6b43a0",5,fp(0.65,0.8,0.8,0.8,0.7,0.75,0.9,0.65)),
  mk("02a05fe0",5,fp(0.65,0.8,0.8,0.8,0.7,0.75,0.9,0.65)),
  mk("019fa4c3",5,fp(0.35,0.5,0.8,0.9,0.65,0.85,0.85,0.4),true),
  mk("ddc71495",5,fp(0.7,0.75,0.35,0.15,0.55,0.45,0.5,0.65),true),
  mk("8e08903f",5,fp(0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5)),
  mk("3a6cfa87",5,fp(0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5),true),
  mk("5768d617",5,fp(0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5)),
  mk("254d75bc",5,fp(0.35,0.55,0.8,0.9,0.85,0.8,0.9,0.35),true),
  mk("b52cdfbb",5,fp(0.3,0.45,0.7,0.85,0.85,0.35,0.85,0.25)),
  mk("569fe928",5,fp(0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4)),
  mk("f125d07a",5,fp(0.45,0.55,0.7,0.9,0.85,0.75,0.85,0.45)),
  mk("d0ea10ac",5,fp(0.55,0.8,0.65,0.3,0.6,0.6,0.75,0.65)),
  mk("0781bd97",5,fp(0.55,0.8,0.65,0.3,0.6,0.6,0.75,0.65)),
  mk("8e4ce92a",4,fp(0.55,0.6,0.65,0.8,0.7,0.6,0.75,0.4)),
  mk("c6ab2b38",4,fp(0.65,0.7,0.35,0.15,0.6,0.45,0.5,0.45)),
  mk("f521c62c",2,fp(0.65,0.7,0.65,0.55,0.6,0.6,0.7,0.65)),
  mk("d7ca5cf6",1,fp(0.65,0.85,0.85,0.35,0.55,0.6,0.8,0.75),false,true),
  mk("c60a861f",1,fp(0.35,0.45,0.55,0.9,0.85,0.6,0.8,0.2)),
  mk("575bee74",1,fp(0.35,0.45,0.5,0.75,0.85,0.6,0.75,0.25)),
  mk("ec56bfe3",1,fp(0.35,0.45,0.55,0.9,0.8,0.6,0.75,0.2),false,true),
];

const cands: BottleFp[] = [
  { id:"earthquake", name:"Earthquake Cab 2011", type:"red", fp: fp(0.325,0.5,0.75,0.8,0.775,0.775,0.8,0.3) },
  { id:"masseto",    name:"Masseto",             type:"red", fp: fp(0.55,0.7,0.85,0.85,0.75,0.75,0.9,0.5) },
  { id:"quilceda",   name:"Quilceda Creek Cab",  type:"red", fp: fp(0.4,0.55,0.85,0.9,0.8,0.85,0.9,0.4) },
  { id:"caymus",     name:"Caymus Special",      type:"red", fp: fp(0.35,0.55,0.65,0.9,0.85,0.85,0.9,0.35) },
  { id:"araujo",     name:"Araujo Eisele",       type:"red", fp: fp(0.5,0.65,0.8,0.8,0.7,0.75,0.85,0.5) },
  { id:"spotts",     name:"Spottswoode Family",  type:"red", fp: fp(0.55,0.7,0.75,0.7,0.6,0.65,0.75,0.55) },
  { id:"modus",      name:"Modus Operandi",      type:"red", fp: fp(0.5,0.6,0.75,0.8,0.75,0.75,0.85,0.4) },
  { id:"rupert",     name:"Anthonij Rupert",     type:"red", fp: fp(0.55,0.65,0.7,0.65,0.7,0.65,0.75,0.55) },
  { id:"larosa",     name:"Viña La Rosa Ossa",   type:"red", fp: fp(0.55,0.7,0.7,0.75,0.65,0.65,0.8,0.55) },
  { id:"domiciano",  name:"Domiciano Malbec",    type:"red", fp: fp(0.4,0.55,0.65,0.85,0.75,0.55,0.8,0.3) },
];

const recs = recommend(rated, cands);
for (const r of recs) {
  console.log(JSON.stringify({
    name: r.bottle.name,
    predicted: +r.predicted.toFixed(3),
    evidence: +r.evidence.toFixed(3),
    vetoed: r.vetoed,
    vetoDist: r.vetoReason ? +r.vetoReason.distance.toFixed(4) : null,
    nemesis: r.vetoReason?.nemesis.id ?? null,
  }));
}
