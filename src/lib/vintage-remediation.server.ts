/**
 * Server-only helpers for vintage-mismatch remediation. Kept out of the
 * .functions.ts wrapper so nothing but server functions lives at its module
 * scope.
 */
export type RemediationClass = "unrated" | "confirm-existing" | "confirm-resolve";

export type RemediationItem = {
  scan_wine_id: string;
  scan_id: string;
  user_id: string;
  scanned_at: string | null;
  scanned_vintage: number;
  scanned_producer: string | null;
  scanned_cuvee: string | null;
  wrong_bottle_id: string;
  wrong_name: string;
  wrong_producer: string | null;
  wrong_region: string | null;
  wrong_type: string;
  wrong_vintage: number;
  years_apart: number;
  correct_bottle_id: string | null;
  correct_name: string | null;
  /** The scan owner's own rating on the wrongly matched bottle, if any. */
  stars: number | null;
  /** Someone else's rating sits on this bottle — never moved from here. */
  other_ratings: number;
  benchmark_tier: "canon" | "nemesis" | null;
  prediction_rows: number;
  klass: RemediationClass;
};

type SW = {
  id: string; scan_id: string; user_id: string; vintage: number | null;
  producer: string | null; cuvee: string | null; wine_type: string | null;
  matched_bottle_id: string | null; created_at: string | null;
};
type B = {
  id: string; name: string; producer: string | null; region: string | null;
  type: string; vintage: number | null; grape: string | null; country: string | null;
};

export async function buildQueue(admin: any): Promise<RemediationItem[]> {
  const { data: lines, error: e1 } = await admin
    .from("scan_wines")
    .select("id,scan_id,user_id,vintage,producer,cuvee,wine_type,matched_bottle_id,created_at")
    .not("matched_bottle_id", "is", null)
    .not("vintage", "is", null)
    .limit(5000);
  if (e1) throw new Error(e1.message);
  const rows = (lines ?? []) as SW[];

  const ids = [...new Set(rows.map((r) => r.matched_bottle_id!))];
  const bottles = new Map<string, B>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,grape,country")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const b of (data ?? []) as B[]) bottles.set(b.id, b);
  }

  const bad = rows.filter((r) => {
    const b = bottles.get(r.matched_bottle_id!);
    return b?.vintage != null && r.vintage != null && b.vintage !== r.vintage;
  });
  if (bad.length === 0) return [];

  const wrongIds = [...new Set(bad.map((r) => r.matched_bottle_id!))];

  // Judgment attached to the wrong bottle.
  const { data: rts } = await admin
    .from("ratings").select("user_id,bottle_id,stars").in("bottle_id", wrongIds);
  const { data: cws } = await admin
    .from("canon_wines").select("user_id,bottle_id,tier").in("bottle_id", wrongIds).is("replaced_at", null);
  const { data: pos } = await admin
    .from("prediction_outcomes").select("user_id,bottle_id").in("bottle_id", wrongIds);

  const ratingKey = (u: string, b: string) => `${u}|${b}`;
  const ratings = new Map<string, number>();
  const ratingsByBottle = new Map<string, number>();
  for (const r of (rts ?? []) as any[]) {
    ratings.set(ratingKey(r.user_id, r.bottle_id), r.stars);
    ratingsByBottle.set(r.bottle_id, (ratingsByBottle.get(r.bottle_id) ?? 0) + 1);
  }
  const tiers = new Map<string, "canon" | "nemesis">();
  for (const c of (cws ?? []) as any[]) tiers.set(ratingKey(c.user_id, c.bottle_id), c.tier);
  const preds = new Map<string, number>();
  for (const p of (pos ?? []) as any[]) {
    const k = ratingKey(p.user_id, p.bottle_id);
    preds.set(k, (preds.get(k) ?? 0) + 1);
  }

  // Does the correct vintage already exist? Same producer, same type, that year.
  const correct = new Map<string, B | null>();
  for (const r of bad) {
    const b = bottles.get(r.matched_bottle_id!)!;
    const ck = `${b.producer ?? ""}|${b.type}|${r.vintage}`;
    if (correct.has(ck)) continue;
    if (!b.producer) { correct.set(ck, null); continue; }
    const { data } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,grape,country")
      .eq("type", b.type)
      .eq("vintage", r.vintage)
      .ilike("producer", b.producer)
      .limit(1);
    correct.set(ck, ((data ?? []) as B[])[0] ?? null);
  }

  return bad.map((r) => {
    const b = bottles.get(r.matched_bottle_id!)!;
    const ck = `${b.producer ?? ""}|${b.type}|${r.vintage}`;
    const c = correct.get(ck) ?? null;
    const k = ratingKey(r.user_id, b.id);
    const stars = ratings.get(k) ?? null;
    const tier = tiers.get(k) ?? null;
    const predictionRows = preds.get(k) ?? 0;
    const ownRating = stars != null ? 1 : 0;
    const carriesJudgment = stars != null || tier != null || predictionRows > 0;
    return {
      scan_wine_id: r.id,
      scan_id: r.scan_id,
      user_id: r.user_id,
      scanned_at: r.created_at,
      scanned_vintage: r.vintage!,
      scanned_producer: r.producer,
      scanned_cuvee: r.cuvee,
      wrong_bottle_id: b.id,
      wrong_name: b.name,
      wrong_producer: b.producer,
      wrong_region: b.region,
      wrong_type: b.type,
      wrong_vintage: b.vintage!,
      years_apart: Math.abs(r.vintage! - b.vintage!),
      correct_bottle_id: c?.id ?? null,
      correct_name: c?.name ?? null,
      stars,
      other_ratings: (ratingsByBottle.get(b.id) ?? 0) - ownRating,
      benchmark_tier: tier,
      prediction_rows: predictionRows,
      klass: !carriesJudgment ? "unrated" : c ? "confirm-existing" : "confirm-resolve",
    } satisfies RemediationItem;
  });
}

