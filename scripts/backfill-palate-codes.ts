// One-off backfill: recompute palate codes for every profile that has ratings,
// using the SAME computeCode/valuesForType the app uses. Reads via psql; prints
// UPDATE statements (it does not write).
//   bun run scripts/backfill-palate-codes.ts
import { execFileSync } from "node:child_process";
import { axesFor, computeCode, type RatedBottle } from "../src/lib/palate";
import { valuesForType, wineTypeOf } from "../src/lib/palate-values";

function q<T>(sql: string): T[] {
  const out = execFileSync("psql", ["-t", "-A", "-c", `select coalesce(json_agg(t),'[]') from (${sql}) t`], {
    encoding: "utf8",
  });
  return JSON.parse(out.trim());
}

type Row = {
  user_id: string;
  stars: number;
  type: string | null;
  ax_body: number | null;
  ax_fruit_char: number | null;
  ax_tannin: number | null;
  ax_acidity: number | null;
  ax_sweet: number | null;
  fp_oak: number | null;
  is_benchmark: boolean;
};

const rows = q<Row>(`
  select r.user_id, r.stars, b.type, b.ax_body, b.ax_fruit_char, b.ax_tannin,
         b.ax_acidity, b.ax_sweet, b.fp_oak,
         exists (select 1 from canon_wines c
                  where c.user_id = r.user_id and c.bottle_id = r.bottle_id
                    and c.tier = 'canon' and c.replaced_at is null) as is_benchmark
  from ratings r join bottles b on b.id = r.bottle_id
`);

const byUser = new Map<string, Row[]>();
for (const r of rows) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);

const versions = q<{ id: string; palate_version: number }>(
  `select id, palate_version from profiles`,
);
const vmap = new Map(versions.map((v) => [v.id, v.palate_version]));

for (const [uid, rs] of byUser) {
  const red: RatedBottle[] = [];
  const white: RatedBottle[] = [];
  for (const r of rs) {
    const t = wineTypeOf(r);
    const entry = { stars: r.stars, canon: r.is_benchmark };
    if (t === "red") red.push({ ...entry, values: valuesForType(r, "red") });
    else if (t === "white") white.push({ ...entry, values: valuesForType(r, "white") });
  }
  const rc = computeCode(red, axesFor("red")).code;
  const wc = computeCode(white, axesFor("white")).code;
  console.log(
    `UPDATE profiles SET palate_code='${rc}', palate_code_red='${rc}', palate_code_white='${wc}', ` +
      `palate_code_version=${vmap.get(uid) ?? 0}, n_rated=${rs.length} WHERE id='${uid}'; ` +
      `-- red=${red.length} white=${white.length}`,
  );
}
