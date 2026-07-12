/* eslint-disable no-console */
import { __debug_learnOmega, __debug_pickBandwidth as pickBandwidth, NEMESIS_RADIUS_MULT, type RatedFp } from "../src/lib/recommender";

const rows = [
  ["d5a147bb-fb37-4fdf-ae3a-a04adf71da83","Silver Oak 2005 AV",5,false,false,0.35,0.55,0.7,0.9,0.8,0.85,0.85,0.3],
  ["766ad257-d21c-4d15-a7d9-ea649d59d3c4","Silver Oak 2006 AV",5,false,false,0.35,0.55,0.7,0.9,0.8,0.85,0.85,0.3],
  ["6c158623-bb29-4d56-809c-0a3acc6abd80","Silver Oak 2007 Napa",5,false,false,0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4],
  ["1e33d57a-3564-4615-be0a-6b488b4d89a2","Silver Oak 2008 Napa",5,true,false,0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4],
  ["c6ab2b38-9ee0-4c74-94cd-384093e02a2a","Ca' del Bosco 2006 Pinéro",4,false,false,0.65,0.7,0.35,0.15,0.6,0.45,0.5,0.45],
  ["8e08903f-053a-4243-9ff1-68f0b35fef83","Clos Fourtet 2000",5,false,false,0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5],
  ["3a6cfa87-8710-46bd-a9bb-4d613334e932","Clos Fourtet 2010",5,true,false,0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5],
  ["5768d617-ccaa-4ce3-b769-5a833d70315a","Clos Fourtet 2009",5,false,false,0.55,0.6,0.6,0.75,0.65,0.6,0.7,0.5],
  ["254d75bc-9235-4be4-94fd-89ecb0ec2b51","Shafer HSS 2003",5,true,false,0.35,0.55,0.8,0.9,0.85,0.8,0.9,0.35],
  ["f521c62c-e93a-4c15-80ec-01cb42cfe3c2","San Leonardo 2007",2,false,false,0.65,0.7,0.65,0.55,0.6,0.6,0.7,0.65],
  ["d7ca5cf6-cead-4f80-ac97-eb8d0bd181bd","Marchesi di Barolo 2007 (NEMESIS)",1,false,true,0.65,0.85,0.85,0.35,0.55,0.6,0.8,0.75],
  ["b52cdfbb-057d-4416-81f4-c08c91e66191","Clinet 2009",5,false,false,0.3,0.45,0.7,0.85,0.85,0.35,0.85,0.25],
  ["575bee74-0a52-4d63-a245-70a0012cad44","Gnarly Head 2007",1,false,false,0.35,0.45,0.5,0.75,0.85,0.6,0.75,0.25],
  ["c60a861f-e4b7-4718-aee3-8577cd77e120","Gnarly Head 2009",1,false,false,0.35,0.45,0.55,0.9,0.85,0.6,0.8,0.2],
  ["ec56bfe3-f8f5-426a-a8db-31f7bd2d1371","Gnarly Head 2010 (NEMESIS)",1,false,true,0.35,0.45,0.55,0.9,0.8,0.6,0.75,0.2],
  ["569fe928-b557-48ea-b3a1-e07b6536c43a","Silver Oak 2006 Napa",5,false,false,0.35,0.55,0.65,0.9,0.8,0.8,0.85,0.4],
  ["f125d07a-e4d3-4c76-ab3a-6b4536edfdfa","Vineyard 36 2013",5,false,false,0.45,0.55,0.7,0.9,0.85,0.75,0.85,0.45],
  ["8e4ce92a-f4cb-4653-a6a4-f4fd292eaa3b","Tenuta Le Colonne",4,false,false,0.55,0.6,0.65,0.8,0.7,0.6,0.75,0.4],
  ["d0ea10ac-fc27-4639-b9fa-047c8dfe87e4","Isole e Olena Cepparello 2010",5,false,false,0.55,0.8,0.65,0.3,0.6,0.6,0.75,0.65],
  ["0781bd97-b1a5-45a7-b39a-91235f76f6fd","Isole e Olena Cepparello 2012",5,false,false,0.55,0.8,0.65,0.3,0.6,0.6,0.75,0.65],
  ["d56238bf-385f-4a86-8c14-fb14d3dfa9e4","J Hofstatter template",5,false,false,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5],
  ["6f72ac21-425e-48b8-987f-85117a5247b8","Biondi Santi 1997",5,false,false,0.4,0.65,0.85,0.85,0.65,0.4,0.8,0.5],
  ["9b76d5a8-8444-41bd-881e-56d70f06f340","Petit Mouton 2006",5,true,false,0.7,0.7,0.7,0.8,0.75,0.65,0.75,0.4],
  ["bc6b43a0-25fc-45ca-8133-2c21102ff5d7","Mouton 2007",5,false,false,0.65,0.8,0.8,0.8,0.7,0.75,0.9,0.65],
  ["02a05fe0-029d-4437-8958-0189459350d3","Mouton 2008",5,false,false,0.65,0.8,0.8,0.8,0.7,0.75,0.9,0.65],
  ["019fa4c3-2c2b-4a7e-b5a0-559ae4ecf66a","Pavillon Rouge 2011",5,true,false,0.35,0.5,0.8,0.9,0.65,0.85,0.85,0.4],
  ["ddc71495-6ea8-4972-9da1-2b2f6d1a792d","Alex Gambal 2009 VV",5,true,false,0.7,0.75,0.35,0.15,0.55,0.45,0.5,0.65],
] as const;

const rated: RatedFp[] = rows.map((r) => ({
  id: r[0], name: r[1], producer: null, region: null, type: "red",
  stars: r[2] as number, canon: r[3] as boolean, nemesis: r[4] as boolean,
  weight: (r[3] || r[4]) ? 3.0 : 1.0,
  fp: { fresh: r[5], acid: r[6], tannin: r[7], fruit_dark: r[8], ripe: r[9], oak: r[10], body: r[11], savory: r[12] },
}));

const fit = __debug_learnOmega!(rated, "red");
const h = pickBandwidth(rated, fit);
console.log("h =", h.toFixed(6), "radius =", (h * NEMESIS_RADIUS_MULT).toFixed(6));
console.log("omega =", JSON.stringify(fit.omega));
console.log("active =", JSON.stringify(fit.active));

// Emit SQL VALUES for the two nemeses and every positive (stars>=4) anchor.
const AXES = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"] as const;
const nemVals = rated.filter((r) => r.nemesis).map((r) =>
  `('${r.name.replace(/'/g,"''")}', ARRAY[${AXES.map((a) => r.fp[a]).join(",")}]::float8[])`
).join(",\n  ");
const posVals = rated.filter((r) => !r.nemesis && r.stars >= 4).map((r) =>
  `('${r.name.replace(/'/g,"''")}', ARRAY[${AXES.map((a) => r.fp[a]).join(",")}]::float8[])`
).join(",\n  ");
const omegaArr = AXES.map((a) => (fit.active.includes(a) ? fit.omega[a] : 0)).join(",");

console.log("\n--- SQL SNIPPETS ---");
console.log(`-- h=${h}\n-- radius=${h*NEMESIS_RADIUS_MULT}`);
console.log(`\nWITH omega AS (SELECT ARRAY[${omegaArr}]::float8[] AS w),\nnem(name, fp) AS (VALUES\n  ${nemVals}\n),\npos(name, fp) AS (VALUES\n  ${posVals}\n)`);
