import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  recommend, BENCHMARK_WEIGHT,
  type FpKey, type RatedFp, type BottleFp, type WineType,
} from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { archetypeFor, type QuizAnswers } from "@/lib/quiz-seeds";
import { summarize, pickTableCall, type CandidateResult, type Verdict } from "@/lib/table-call";
import { formatAmount, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency";

/** Archetype name from a guest's own quiz answers, honouring their primary
 *  type (was hardcoded to red, mislabelling white-focused guests). */
function guestArchetype(q: QuizAnswers | null): string {
  if (q && typeof q === "object" && "votes" in q) {
    const t = (q as QuizAnswers).type === "white" ? "white" : "red";
    return archetypeFor(q as QuizAnswers, t).name;
  }
  return "Wine lover";
}

function toCurrencyCode(s: string | null | undefined): CurrencyCode {
  return s === "EUR" || s === "GBP" || s === "USD" ? s : DEFAULT_CURRENCY;
}

// ────────── Shared: verified-somm gate ──────────

async function requireVerifiedSomm(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("profiles").select("somm_status, establishment").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.somm_status !== "verified") {
    throw new Error("Sommelier mode is verified-only.");
  }
  return { establishment: (data.establishment as string | null) ?? null };
}

// ═══════════════════════════════════════════════════════════════════
// PER-OCCASION CONSENT
// ═══════════════════════════════════════════════════════════════════

/** Guest-side: generate a fresh 6-char code good for ~30 minutes. */
export const sommGrantGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ code: string; expiresAt: string; grantId: string }> => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("somm_grant_generate");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Could not generate a code.");
    return {
      code: row.code as string,
      expiresAt: row.expires_at as string,
      grantId: row.grant_id as string,
    };
  });

/** Somm-side: claim a code, returns guest identity + archetype seed. */
const ClaimSchema = z.object({ code: z.string().min(4).max(12) });

export type ResolvedGuest = {
  userId: string;
  displayName: string;
  archetype: string;
  initial: string;
  /** Set when consent was via a claimed code. Null when the guest is
   *  public + palate_shareable (no per-occasion grant needed). */
  grantId: string | null;
  via: "code" | "public";
  /** ISO expiry of the consent grant (code path only; null for public). */
  expiresAt: string | null;
};

export const sommClaimCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClaimSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResolvedGuest> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const { data: rows, error } = await supabase.rpc("somm_grant_claim", { p_code: data.code.toUpperCase() });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("Code invalid or expired.");
    const name = (row.display_name || row.username) as string;
    const q = row.quiz_answers as QuizAnswers | null;
    return {
      userId: row.guest_id as string,
      displayName: name,
      archetype: guestArchetype(q),
      initial: (name[0] || "?").toUpperCase(),
      grantId: row.grant_id as string,
      via: "code",
      expiresAt: (row.expires_at as string) ?? null,
    };
  });

/** Fallback: username lookup — permitted ONLY when the guest's profile
 *  is public AND palate_shareable. Everything else must go through a
 *  per-occasion code. */
const ResolveGuestSchema = z.object({ username: z.string().min(1).max(64) });

export const sommResolvePublicGuest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolveGuestSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResolvedGuest> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const uname = data.username.trim().replace(/^@/, "").toLowerCase();
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, visibility, palate_shareable, quiz_answers")
      .eq("username", uname).maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof) throw new Error("No public guest with that username.");
    if (prof.visibility !== "public" || !prof.palate_shareable) {
      throw new Error("That guest isn't public. Ask them to hand you a code.");
    }
    const name = (prof.display_name || prof.username) as string;
    const q = prof.quiz_answers as QuizAnswers | null;
    return {
      userId: prof.id as string,
      displayName: name,
      archetype: guestArchetype(q),
      initial: (name[0] || "?").toUpperCase(),
      grantId: null,
      via: "public",
      expiresAt: null,
    };
  });

// ═══════════════════════════════════════════════════════════════════
// GUEST SCORING BUNDLE (RLS-respecting — no admin client)
// ═══════════════════════════════════════════════════════════════════

/** Single narrow helper. Takes a consent handle (grant_id or "public"),
 *  and returns the rated set aggregated by cuvée. All access control is
 *  enforced in the SQL function; RLS applies to the somm's own client. */
async function loadGuestRatedFpViaConsent(
  supabase: any,
  guestUserId: string,
  grantId: string | null,
): Promise<RatedFp[]> {
  const { data, error } = await supabase.rpc("somm_load_guest_scoring_bundle", {
    p_guest_id: guestUserId,
    p_grant_id: grantId,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const raw: (RatedFp & { vintage: number | null; bottleIds?: string[] })[] = [];
  const canonSet = new Set<string>();
  const nemSet = new Set<string>();
  for (const r of rows) {
    const t = (String(r.type ?? "red").toLowerCase()) as WineType;
    raw.push({
      id: r.bottle_id, name: r.name, producer: r.producer, region: r.region,
      type: t, stars: r.stars, vintage: r.vintage ?? null,
      fp: {
        fresh: r.fp_fresh, acid: r.fp_acid, tannin: r.fp_tannin, fruit_dark: r.fp_fruit_dark,
        ripe: r.fp_ripe, oak: r.fp_oak, body: r.fp_body, savory: r.fp_savory,
      },
    });
    if (r.canon) canonSet.add(r.bottle_id);
    if (r.nemesis) nemSet.add(r.bottle_id);
  }
  const agg = aggregateRated(raw);
  return agg.map((c) => {
    const isCanon = c.bottleIds.some((id) => canonSet.has(id));
    const isNem = c.bottleIds.some((id) => nemSet.has(id));
    return {
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
      weight: isCanon || isNem ? BENCHMARK_WEIGHT : 1,
      canon: isCanon, nemesis: isNem,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// TABLE CALL — narrowed payload
// ═══════════════════════════════════════════════════════════════════

const FpSchema = z.object({
  fresh: z.number(), acid: z.number(), tannin: z.number(), fruit_dark: z.number(),
  ripe: z.number(), oak: z.number(), body: z.number(), savory: z.number(),
});
const WineTypeSchema = z.enum(["red", "white", "sparkling", "rose", "dessert"]);
const CandidateSchema = z.object({
  id: z.string(), name: z.string(),
  producer: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  type: WineTypeSchema,
  fp: FpSchema,
  priceAmount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
});

const GuestInSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  archetype: z.string(),
  initial: z.string(),
  grantId: z.string().uuid().nullable(),
  via: z.enum(["code", "public"]),
});

const TableCallInput = z.object({
  guests: z.array(GuestInSchema).min(1).max(6),
  candidates: z.array(CandidateSchema).min(1).max(400),
  houseListId: z.string().uuid().optional(),
});

/** Slim bottle facts — no per-guest data. Alternates carry only this. */
export type SlimBottle = {
  candidateId: string;
  name: string;
  producer: string | null;
  region: string | null;
  type: WineType;
  /** Pre-formatted price in the list's currency (e.g. "$120"); null if unpriced. */
  priceText: string | null;
};

/** A winner or split-half — slim facts plus per-guest ordinal verdicts. */
export type BottleWithVerdicts = SlimBottle & {
  guests: Array<{ userId: string; initial: string; verdict: Verdict }>;
};

/** Narrowed table-call response. Nothing about non-winner candidates
 *  leaves the server. Per-guest verdicts are attached only to the
 *  winner (or each half of a split pair). */
export type TableCallOutput = {
  kind: "one-bottle" | "split";
  winner: BottleWithVerdicts | null;
  alternates: SlimBottle[];                    // ≤3, facts only
  splitPair: [BottleWithVerdicts, BottleWithVerdicts] | null;
  splitAssignment: Record<string, "a" | "b"> | null;
  guests: Array<{ userId: string; displayName: string; initial: string }>;
  reasoning: string;
};

export const sommCallTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TableCallInput.parse(input))
  .handler(async ({ data, context }): Promise<TableCallOutput> => {
    const { supabase, userId } = context;
    const { establishment } = await requireVerifiedSomm(supabase, userId);

    // OOS filter (only when we're scoring against a saved house list).
    let candidates = data.candidates;
    if (data.houseListId) {
      const { data: oos, error: oErr } = await supabase
        .from("house_list_stock")
        .select("bottle_id")
        .eq("house_list_id", data.houseListId)
        .eq("out_of_stock", true);
      if (oErr) throw new Error(oErr.message);
      const oosSet = new Set((oos ?? []).map((r: any) => r.bottle_id as string));
      candidates = candidates.filter((c) => !oosSet.has(c.id));
    }

    const bottleFps: BottleFp[] = candidates.map((c) => ({
      id: c.id, name: c.name, producer: c.producer ?? null, region: c.region ?? null,
      type: c.type as WineType, fp: c.fp as Record<FpKey, number>,
    }));

    // Compute per-guest scores via consent-gated RPC. RLS applies through
    // the somm's own client; the SQL function enforces access.
    const perGuestPredicted = new Map<string, Map<string, number>>();
    const perGuestVetoed = new Map<string, Set<string>>();
    // Which wine types has each guest actually rated? A candidate whose type is
    // absent here reads as "cant-say" — never a cross-type guess (invariant #2).
    const perGuestRatedTypes = new Map<string, Set<WineType>>();
    for (const g of data.guests) {
      const rated = await loadGuestRatedFpViaConsent(supabase, g.userId, g.grantId);
      perGuestRatedTypes.set(g.userId, new Set(rated.map((r) => r.type)));
      const recs = rated.length > 0
        ? recommend(rated, bottleFps, { restrictToRatedTypes: false })
        : [];
      const pm = new Map<string, number>();
      const vs = new Set<string>();
      for (const r of recs) {
        pm.set(r.bottle.id, r.predicted);
        if (r.vetoed) vs.add(r.bottle.id);
      }
      perGuestPredicted.set(g.userId, pm);
      perGuestVetoed.set(g.userId, vs);
    }

    // Score every candidate server-side, but return only the winner/alts/split.
    const results: (CandidateResult & { name: string; producer: string | null; region: string | null; type: WineType; priceText: string | null })[] =
      candidates.map((c) => {
        const guestScores = data.guests.map((g) => {
          const ratedTypes = perGuestRatedTypes.get(g.userId);
          const untested = !ratedTypes || !ratedTypes.has(c.type as WineType);
          const predRaw = perGuestPredicted.get(g.userId)?.get(c.id);
          const skipped = perGuestVetoed.get(g.userId)?.has(c.id) ?? false;
          const pred = skipped
            ? 1.5
            : (typeof predRaw === "number" && !Number.isNaN(predRaw) ? predRaw : 3.0);
          return { userId: g.userId, archetype: g.archetype, initial: g.initial, predicted: pred, untested };
        });
        const s = summarize(c.id, guestScores);
        const priceText = typeof c.priceAmount === "number"
          ? formatAmount(c.priceAmount, toCurrencyCode(c.currency))
          : null;
        return { ...s, name: c.name, producer: c.producer ?? null, region: c.region ?? null, type: c.type as WineType, priceText };
      });

    const call = pickTableCall(results);
    const byId = new Map(results.map((r) => [r.candidateId, r]));

    const toSlim = (id: string): SlimBottle | null => {
      const r = byId.get(id);
      if (!r) return null;
      return { candidateId: r.candidateId, name: r.name, producer: r.producer, region: r.region, type: r.type, priceText: r.priceText };
    };
    const toWithVerdicts = (cr: CandidateResult): BottleWithVerdicts | null => {
      const slim = toSlim(cr.candidateId);
      if (!slim) return null;
      return {
        ...slim,
        guests: cr.guests.map((g) => ({ userId: g.userId, initial: g.initial, verdict: g.verdict })),
      };
    };

    let winner: BottleWithVerdicts | null = null;
    let splitPair: [BottleWithVerdicts, BottleWithVerdicts] | null = null;
    if (call.kind === "one-bottle" && call.winner) {
      winner = toWithVerdicts(call.winner);
    } else if (call.kind === "split" && call.splitPair) {
      const [a, b] = call.splitPair;
      const wa = toWithVerdicts(a); const wb = toWithVerdicts(b);
      if (wa && wb) splitPair = [wa, wb];
    }

    // Alternates: next best fine-plus candidates that aren't the winner
    // or split-half. Facts only — no per-guest verdicts.
    const winnerIds = new Set<string>();
    if (winner) winnerIds.add(winner.candidateId);
    if (splitPair) { winnerIds.add(splitPair[0].candidateId); winnerIds.add(splitPair[1].candidateId); }
    const alternates: SlimBottle[] = results
      .filter((r) => !winnerIds.has(r.candidateId) && r.finePlus)
      .sort((a, b) => b.lovesCount - a.lovesCount)
      .slice(0, 3)
      .map((r) => ({ candidateId: r.candidateId, name: r.name, producer: r.producer, region: r.region, type: r.type, priceText: r.priceText }));

    // Access log: one row per guest included in the call. Written through
    // the somm's own client under an RLS INSERT policy that requires
    // somm_id = auth.uid() AND verified somm.
    const logRows = data.guests.map((g) => ({
      guest_id: g.userId,
      somm_id: userId,
      establishment,
      candidate_count: candidates.length,
      kind: "table-call",
      grant_id: g.grantId,
      via: g.via,
    }));
    if (logRows.length > 0) {
      const { error: logErr } = await supabase.from("somm_access_log").insert(logRows);
      // Access log failures are surfaced as errors — this is the
      // accountability backstop; a silent failure defeats the point.
      if (logErr) throw new Error(`Access log failed: ${logErr.message}`);
    }

    return {
      kind: call.kind,
      winner,
      alternates,
      splitPair,
      splitAssignment: call.splitAssignment,
      guests: data.guests.map((g) => ({ userId: g.userId, displayName: g.displayName, initial: g.initial })),
      reasoning: call.reasoning,
    };
  });

// ═══════════════════════════════════════════════════════════════════
// GUEST-SIDE: read own access log
// ═══════════════════════════════════════════════════════════════════

export type AccessLogEntry = {
  id: string;
  sommId: string;
  sommName: string | null;
  establishment: string | null;
  candidateCount: number;
  via: "code" | "public";
  occurredAt: string;
};

export const getMyAccessLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessLogEntry[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("somm_access_log")
      .select("id, somm_id, establishment, candidate_count, via, occurred_at")
      .eq("guest_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return [];
    const sommIds = Array.from(new Set(rows.map((r) => r.somm_id as string)));
    const { data: names } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", sommIds);
    const nameById = new Map<string, string>();
    for (const p of names ?? []) {
      nameById.set(p.id as string, (p.display_name as string | null) ?? (p.username as string));
    }
    return rows.map((r) => ({
      id: r.id as string,
      sommId: r.somm_id as string,
      sommName: nameById.get(r.somm_id as string) ?? null,
      establishment: (r.establishment as string | null) ?? null,
      candidateCount: r.candidate_count as number,
      via: r.via as "code" | "public",
      occurredAt: r.occurred_at as string,
    }));
  });

// ═══════════════════════════════════════════════════════════════════
// HOUSE LIST: read / save / stock / correct  (unchanged)
// ═══════════════════════════════════════════════════════════════════

export type HouseListItem = {
  id: string;
  bottleId: string | null;
  producer: string | null;
  cuvee: string | null;
  vintage: number | null;
  priceAmount: number | null;
  currency: string | null;
  format: string;
  corrected: boolean;
  outOfStock: boolean;
};

export type HouseListView = {
  houseListId: string;
  establishment: string;
  activeVersionId: string | null;
  activeVersion: number | null;
  items: HouseListItem[];
  versions: Array<{ id: string; version: number; createdAt: string; itemCount: number }>;
};

/** Set (or rename) the verified somm's establishment. Without one, no house
 *  list can exist and table calls are impossible — this unblocks first run.
 *  RLS-scoped to the caller's own profile row. */
const SetEstablishmentSchema = z.object({ establishment: z.string().min(1).max(120) });

export const sommSetEstablishment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetEstablishmentSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ establishment: string }> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const name = data.establishment.trim();
    const { error } = await supabase.from("profiles").update({ establishment: name }).eq("id", userId);
    if (error) throw new Error(error.message);
    return { establishment: name };
  });

export const sommGetMyHouseList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HouseListView | null> => {
    const { supabase, userId } = context;
    const { establishment } = await requireVerifiedSomm(supabase, userId);
    if (!establishment) return null;

    const { data: hl, error: hErr } = await supabase
      .from("house_lists")
      .select("id, establishment, active_version_id")
      .eq("establishment", establishment)
      .maybeSingle();
    if (hErr) throw new Error(hErr.message);
    if (!hl) {
      return {
        houseListId: "", establishment, activeVersionId: null, activeVersion: null,
        items: [], versions: [],
      };
    }

    const { data: versions, error: vErr } = await supabase
      .from("house_list_versions")
      .select("id, version, created_at")
      .eq("house_list_id", hl.id)
      .order("version", { ascending: false });
    if (vErr) throw new Error(vErr.message);
    const activeVersionId = hl.active_version_id ?? versions?.[0]?.id ?? null;
    const activeVersion = versions?.find((v: any) => v.id === activeVersionId)?.version ?? null;

    let items: HouseListItem[] = [];
    if (activeVersionId) {
      const [{ data: itemRows, error: iErr }, { data: stockRows, error: sErr }] = await Promise.all([
        supabase.from("house_list_items")
          .select("id, bottle_id, raw_producer, raw_cuvee, raw_vintage, price_amount, currency, format, corrected")
          .eq("version_id", activeVersionId),
        supabase.from("house_list_stock")
          .select("bottle_id, out_of_stock")
          .eq("house_list_id", hl.id).eq("out_of_stock", true),
      ]);
      if (iErr) throw new Error(iErr.message);
      if (sErr) throw new Error(sErr.message);
      const oos = new Set((stockRows ?? []).map((r: any) => r.bottle_id as string));
      items = (itemRows ?? []).map((r: any) => ({
        id: r.id as string,
        bottleId: r.bottle_id as string | null,
        producer: r.raw_producer as string | null,
        cuvee: r.raw_cuvee as string | null,
        vintage: r.raw_vintage as number | null,
        priceAmount: r.price_amount as number | null,
        currency: r.currency as string | null,
        format: r.format as string,
        corrected: r.corrected as boolean,
        outOfStock: r.bottle_id ? oos.has(r.bottle_id as string) : false,
      }));
    }

    const versionCounts = new Map<string, number>();
    if ((versions ?? []).length > 0) {
      const { data: cnt, error: cErr } = await supabase
        .from("house_list_items")
        .select("version_id")
        .in("version_id", (versions ?? []).map((v: any) => v.id));
      if (cErr) throw new Error(cErr.message);
      for (const r of cnt ?? []) {
        versionCounts.set(r.version_id as string, (versionCounts.get(r.version_id as string) ?? 0) + 1);
      }
    }
    return {
      houseListId: hl.id as string, establishment,
      activeVersionId, activeVersion,
      items,
      versions: (versions ?? []).map((v: any) => ({
        id: v.id as string, version: v.version as number,
        createdAt: v.created_at as string, itemCount: versionCounts.get(v.id as string) ?? 0,
      })),
    };
  });

const SaveFromScanInput = z.object({ scanId: z.string().uuid() });

export type HouseListSaveDiff = {
  added: number;
  removed: number;
  priceChanges: number;
  version: number;
};

export const sommSaveHouseListFromScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveFromScanInput.parse(i))
  .handler(async ({ data, context }): Promise<HouseListSaveDiff> => {
    const { supabase, userId } = context;
    const { establishment } = await requireVerifiedSomm(supabase, userId);
    if (!establishment) throw new Error("Set your establishment on your profile first.");

    const { data: scan, error: sErr } = await supabase
      .from("scans").select("id, user_id, currency")
      .eq("id", data.scanId).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!scan || scan.user_id !== userId) throw new Error("Scan not found.");

    const { data: wines, error: wErr } = await supabase
      .from("scan_wines")
      .select("producer, cuvee, vintage, matched_bottle_id, price_amount, currency, format")
      .eq("scan_id", data.scanId);
    if (wErr) throw new Error(wErr.message);

    let houseListId: string;
    const { data: existing } = await supabase
      .from("house_lists").select("id").eq("establishment", establishment).maybeSingle();
    if (existing) {
      houseListId = existing.id as string;
    } else {
      const { data: created, error: cErr } = await supabase
        .from("house_lists").insert({ establishment, owner_id: userId })
        .select("id").single();
      if (cErr) throw new Error(cErr.message);
      houseListId = created.id as string;
    }

    const { data: hl } = await supabase.from("house_lists")
      .select("active_version_id").eq("id", houseListId).maybeSingle();
    let prevByBottle = new Map<string, number | null>();
    if (hl?.active_version_id) {
      const { data: prev } = await supabase.from("house_list_items")
        .select("bottle_id, price_amount").eq("version_id", hl.active_version_id);
      for (const r of prev ?? []) {
        if ((r as any).bottle_id) prevByBottle.set((r as any).bottle_id as string, (r as any).price_amount as number | null);
      }
    }

    const { data: last } = await supabase.from("house_list_versions")
      .select("version").eq("house_list_id", houseListId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = ((last?.version as number | undefined) ?? 0) + 1;

    const { data: ver, error: vErr } = await supabase
      .from("house_list_versions")
      .insert({ house_list_id: houseListId, version: nextVersion, scan_id: data.scanId, created_by: userId })
      .select("id").single();
    if (vErr) throw new Error(vErr.message);
    const versionId = ver.id as string;

    const rows = (wines ?? []).map((w: any) => ({
      version_id: versionId,
      bottle_id: w.matched_bottle_id ?? null,
      raw_producer: w.producer, raw_cuvee: w.cuvee, raw_vintage: w.vintage,
      price_amount: w.price_amount, currency: w.currency ?? scan.currency ?? null,
      format: w.format ?? "bottle",
    }));
    if (rows.length > 0) {
      const { error: iErr } = await supabase.from("house_list_items").insert(rows);
      if (iErr) throw new Error(iErr.message);
    }

    await supabase.from("house_lists").update({ active_version_id: versionId }).eq("id", houseListId);

    const curByBottle = new Map<string, number | null>();
    for (const w of wines ?? []) {
      if ((w as any).matched_bottle_id) {
        curByBottle.set((w as any).matched_bottle_id as string, (w as any).price_amount as number | null);
      }
    }
    let added = 0, removed = 0, priceChanges = 0;
    for (const [id, p] of curByBottle) {
      if (!prevByBottle.has(id)) added++;
      else if ((prevByBottle.get(id) ?? null) !== (p ?? null)) priceChanges++;
    }
    for (const id of prevByBottle.keys()) if (!curByBottle.has(id)) removed++;

    return { added, removed, priceChanges, version: nextVersion };
  });

const SetStockInput = z.object({
  houseListId: z.string().uuid(),
  bottleId: z.string().uuid(),
  outOfStock: z.boolean(),
});

export const sommSetStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetStockInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    if (data.outOfStock) {
      const { error } = await supabase.from("house_list_stock").upsert({
        house_list_id: data.houseListId, bottle_id: data.bottleId,
        out_of_stock: true, updated_by: userId, updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("house_list_stock")
        .delete()
        .eq("house_list_id", data.houseListId).eq("bottle_id", data.bottleId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const CorrectItemInput = z.object({
  itemId: z.string().uuid(),
  producer: z.string().optional().nullable(),
  cuvee: z.string().optional().nullable(),
  vintage: z.number().int().min(1900).max(2100).optional().nullable(),
});

export const sommCorrectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CorrectItemInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const patch: {
      corrected: boolean;
      raw_producer?: string | null;
      raw_cuvee?: string | null;
      raw_vintage?: number | null;
    } = { corrected: true };
    if (data.producer !== undefined) patch.raw_producer = data.producer;
    if (data.cuvee !== undefined) patch.raw_cuvee = data.cuvee;
    if (data.vintage !== undefined) patch.raw_vintage = data.vintage;
    const { error } = await supabase.from("house_list_items").update(patch).eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CandidatesInput = z.object({ houseListVersionId: z.string().uuid() });

export const sommHouseListCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CandidatesInput.parse(i))
  .handler(async ({ data, context }): Promise<Array<z.infer<typeof CandidateSchema>>> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const { data: items, error } = await supabase
      .from("house_list_items").select("bottle_id, price_amount, currency").eq("version_id", data.houseListVersionId);
    if (error) throw new Error(error.message);
    // First-seen price per bottle (the list's own quoted price + currency).
    const priceByBottle = new Map<string, { amount: number | null; currency: string | null }>();
    for (const r of items ?? []) {
      const bid = (r as any).bottle_id as string | null;
      if (bid && !priceByBottle.has(bid)) {
        priceByBottle.set(bid, { amount: (r as any).price_amount ?? null, currency: (r as any).currency ?? null });
      }
    }
    const ids = Array.from(new Set((items ?? []).map((r: any) => r.bottle_id).filter(Boolean))) as string[];
    if (ids.length === 0) return [];
    const out: Array<z.infer<typeof CandidateSchema>> = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: bs, error: bErr } = await supabase
        .from("bottles")
        .select("id,name,producer,region,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory")
        .in("id", chunk);
      if (bErr) throw new Error(bErr.message);
      for (const b of bs ?? []) {
        const price = priceByBottle.get((b as any).id as string);
        out.push({
          id: (b as any).id, name: (b as any).name, producer: (b as any).producer, region: (b as any).region,
          type: (String((b as any).type ?? "red").toLowerCase()) as WineType,
          fp: {
            fresh: (b as any).fp_fresh, acid: (b as any).fp_acid, tannin: (b as any).fp_tannin, fruit_dark: (b as any).fp_fruit_dark,
            ripe: (b as any).fp_ripe, oak: (b as any).fp_oak, body: (b as any).fp_body, savory: (b as any).fp_savory,
          },
          priceAmount: price?.amount ?? null,
          currency: price?.currency ?? null,
        });
      }
    }
    return out;
  });
