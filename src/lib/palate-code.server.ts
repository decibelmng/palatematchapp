// Server-side palate code computation.
//
// The code is derived data: a pure function of (this user's ratings, those
// bottles' axes, which of them are benchmarks) — exactly the inputs that bump
// palate_version. It used to be computed in a client effect off possibly-empty
// query caches and persisted opportunistically, which left all 18 profiles
// unresolved. It is computed here now, from the rows themselves.
//
// The math is NOT reimplemented: this reads the same computeCode/axesFor from
// src/lib/palate.ts and the same mapping from src/lib/palate-values.ts that the
// screens render from. There is no SQL port, so there is nothing to keep in sync.

import type { SupabaseClient } from "@supabase/supabase-js";
import { axesFor, computeCode, type RatedBottle } from "@/lib/palate";
import { AXIS_SOURCE_COLS, valuesForType, wineTypeOf } from "@/lib/palate-values";

export type PalateCodes = {
  red: string;
  white: string;
  nRated: number;
  palateVersion: number;
};

/**
 * Recompute and persist both codes for one user. Idempotent, and safe to call
 * with zero ratings — a user with no ratings correctly stores XXXXX.
 *
 * Returns the codes written. Throws on a failed write: a silent failure here is
 * the whole reason this column was empty.
 */
export async function recomputeAndStoreCodes(
  db: SupabaseClient,
  userId: string,
): Promise<PalateCodes> {
  const { data: ratings, error: rErr } = await db
    .from("ratings")
    .select("bottle_id, stars")
    .eq("user_id", userId);
  if (rErr) throw new Error(`ratings read failed: ${rErr.message}`);

  const ids = Array.from(new Set((ratings ?? []).map((r) => r.bottle_id as string)));

  let bottles: any[] = [];
  if (ids.length > 0) {
    // Chunked: a heavy rater's id list must not blow the URL length.
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from("bottles")
        .select(AXIS_SOURCE_COLS)
        .in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`bottles read failed: ${error.message}`);
      bottles = bottles.concat(data ?? []);
    }
  }

  const { data: canonRows } = await db
    .from("canon_wines")
    .select("bottle_id, tier")
    .eq("user_id", userId)
    .is("replaced_at", null);
  const benchmarkIds = new Set(
    (canonRows ?? []).filter((c: any) => c.tier === "canon").map((c: any) => c.bottle_id as string),
  );

  const byId = new Map(bottles.map((b) => [b.id as string, b]));
  const red: RatedBottle[] = [];
  const white: RatedBottle[] = [];
  for (const r of ratings ?? []) {
    const b = byId.get(r.bottle_id as string);
    if (!b) continue;
    const t = wineTypeOf(b);
    const canon = benchmarkIds.has(b.id as string);
    if (t === "red") red.push({ stars: r.stars as number, values: valuesForType(b, "red"), canon });
    else if (t === "white") white.push({ stars: r.stars as number, values: valuesForType(b, "white"), canon });
  }

  const redCode = computeCode(red, axesFor("red")).code;
  const whiteCode = computeCode(white, axesFor("white")).code;
  const nRated = (ratings ?? []).length;

  const { data: prof } = await db
    .from("profiles")
    .select("palate_version")
    .eq("id", userId)
    .maybeSingle();
  const palateVersion = (prof?.palate_version as number | null) ?? 0;

  const { error: wErr } = await db
    .from("profiles")
    .update({
      palate_code: redCode, // legacy column, kept on the red code
      palate_code_red: redCode,
      palate_code_white: whiteCode,
      palate_code_version: palateVersion,
      n_rated: nRated,
    })
    .eq("id", userId);
  if (wErr) throw new Error(`code write failed: ${wErr.message}`);

  return { red: redCode, white: whiteCode, nRated, palateVersion };
}

/**
 * Self-heal on read. Any server path that reads a stored code calls this first,
 * so a stale row repairs itself the next time anything looks at it — no
 * dependence on which screen the user happened to open.
 *
 * Cheap: one indexed profile read, and a recompute only when the stored code was
 * computed against an older palate_version.
 */
export async function ensureCodesFresh(db: SupabaseClient, userId: string): Promise<void> {
  const { data: prof } = await db
    .from("profiles")
    .select("palate_version, palate_code_version, palate_code_red")
    .eq("id", userId)
    .maybeSingle();
  if (!prof) return;
  const stale =
    (prof.palate_code_version as number | null ?? -1) !== (prof.palate_version as number | null ?? 0) ||
    !prof.palate_code_red;
  if (!stale) return;
  try {
    await recomputeAndStoreCodes(db, userId);
  } catch (e) {
    console.error("[palate-code] refresh failed:", (e as Error).message);
  }
}
