// Phase 1 acceptance check: generate notes for a cheap+expensive pair from the
// same appellation with the v2 descriptive-only prompt. If the notes are
// stylistically distinguishable except by flavor, the leak is not closed.
import { generateTastingNote, scoreFromNote } from "../src/lib/fingerprint-prompt";

const key = process.env.LOVABLE_API_KEY!;

const pairs = [
  // Vosne-Romanée: grand cru vs village
  [
    { producer: "Domaine de la Romanée-Conti", name: "La Tâche Grand Cru", type: "red", region: "Vosne-Romanée", country: "France", grape: "Pinot Noir", vintage: 2018 },
    { producer: "Domaine Michel Gros", name: "Vosne-Romanée", type: "red", region: "Vosne-Romanée", country: "France", grape: "Pinot Noir", vintage: 2020 },
  ],
  // Barolo: cult vs everyday
  [
    { producer: "Giacomo Conterno", name: "Monfortino Riserva", type: "red", region: "Barolo", country: "Italy", grape: "Nebbiolo", vintage: 2016 },
    { producer: "Fontanafredda", name: "Serralunga", type: "red", region: "Barolo", country: "Italy", grape: "Nebbiolo", vintage: 2020 },
  ],
];

(async () => {
  for (const [a, b] of pairs) {
    const [nA, nB] = await Promise.all([
      generateTastingNote(a as any, key),
      generateTastingNote(b as any, key),
    ]);
    const [sA, sB] = await Promise.all([
      scoreFromNote(a.type, a.grape, nA, key),
      scoreFromNote(b.type, b.grape, nB, key),
    ]);
    console.log(`\n=== ${a.region} ===`);
    console.log(`FAMOUS  ${a.producer} — ${a.name}`);
    console.log(`  note:  ${nA}`);
    console.log(`  fp:    ${JSON.stringify(sA.fp)}`);
    console.log(`OBSCURE ${b.producer} — ${b.name}`);
    console.log(`  note:  ${nB}`);
    console.log(`  fp:    ${JSON.stringify(sB.fp)}`);
    const dT = sA.fp.tannin - sB.fp.tannin;
    const dB = sA.fp.body - sB.fp.body;
    const dS = sA.fp.savory - sB.fp.savory;
    console.log(`  Δ famous−obscure: tannin ${dT.toFixed(2)}  body ${dB.toFixed(2)}  savory ${dS.toFixed(2)}`);
  }
})();
