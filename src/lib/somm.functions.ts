import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  recommend, BENCHMARK_WEIGHT,
  type FpKey, type RatedFp, type BottleFp, type WineType,
} from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { archetypeFor, type QuizAnswers } from "@/lib/quiz-seeds";
import type { PaletteType } from "@/lib/palate";
import { summarize, pickTableCall, type CandidateResult, type WinnerPick } from "@/lib/table-call";

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

// ────────── Guest resolution (consent via palate_shareable) ──────────

const ResolveGuestSchema = z.object({ username: z.string().min(1).max(64) });

export type ResolvedGuest = {
  userId: string;
  displayName: string;
  archetype: string;
  initial: string;
};

export const sommResolveGuest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolveGuestSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResolvedGuest> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const uname = data.username.trim().replace(/^@/, "").toLowerCase();
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, palate_shareable, quiz_answers, palate_code_red, palate_code_white")
      .eq("username", uname).maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof) throw new Error("No guest found with that username.");
    if (!prof.palate_shareable) {
      throw new Error("That guest hasn't turned on palate sharing.");
    }
    const name = (prof.display_name || prof.username) as string;
    let archetype = "Wine lover";
    const q = prof.quiz_answers as QuizAnswers | null;
    if (q && typeof q === "object" && "votes" in q) {
      // Prefer red if the caller has red votes, else fall back to white.
      const type: PaletteType = "red";
      archetype = archetypeFor(q, type).name;
    }
    return {
      userId: prof.id as string,
      displayName: name,
      archetype,
      initial: (name[0] || "?").toUpperCase(),
    };
  });

// ────────── Guest data loader (admin, after consent verified) ──────────

async function loadGuestRatedFp(admin: any, guestUserId: string): Promise<RatedFp[]> {
  const { data: ratings, error: rErr } = await admin
    .from("ratings").select("bottle_id, stars").eq("user_id", guestUserId);
  if (rErr) throw new Error(rErr.message);
  if (!ratings || ratings.length === 0) return [];

  const ids = Array.from(new Set(ratings.map((r: any) => r.bottle_id as string)));
  const bottles: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    bottles.push(...(data ?? []));
  }
  const byId = new Map(bottles.map((b) => [b.id, b]));
  const starsById = new Map(ratings.map((r: any) => [r.bottle_id, r.stars as number]));

  const { data: benches, error: bErr } = await admin
    .from("canon_wines").select("bottle_id, tier")
    .eq("user_id", guestUserId).is("replaced_at", null);
  if (bErr) throw new Error(bErr.message);
  const canonSet = new Set<string>();
  const nemSet = new Set<string>();
  for (const r of (benches ?? []) as any[]) {
    if (r.tier === "canon") canonSet.add(r.bottle_id);
    else if (r.tier === "nemesis") nemSet.add(r.bottle_id);
  }

  const raw: (RatedFp & { vintage: number | null; bottleIds?: string[] })[] = [];
  for (const [id, b] of byId) {
    const stars = starsById.get(id);
    if (typeof stars !== "number") continue;
    const t = (String(b.type ?? "red").toLowerCase()) as WineType;
    raw.push({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: t, stars, vintage: b.vintage ?? null,
      fp: {
        fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
        ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
      },
    });
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

// ────────── Table call ──────────

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
});

const TableCallInput = z.object({
  guests: z.array(z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    archetype: z.string(),
    initial: z.string(),
  })).min(1).max(6),
  candidates: z.array(CandidateSchema).min(1).max(400),
  houseListId: z.string().uuid().optional(),
});

export type TableCallCandidateOut = CandidateResult & {
  name: string;
  producer: string | null;
  region: string | null;
  type: WineType;
};

export type TableCallOutput = {
  results: TableCallCandidateOut[];
  call: WinnerPick;
  guests: z.infer<typeof TableCallInput>["guests"];
};

export const sommCallTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TableCallInput.parse(input))
  .handler(async ({ data, context }): Promise<TableCallOutput> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);

    // Consent recheck: every guest must have palate_shareable = true.
    const uniqueGuestIds = Array.from(new Set(data.guests.map((g) => g.userId)));
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, palate_shareable")
      .in("id", uniqueGuestIds);
    if (pErr) throw new Error(pErr.message);
    for (const id of uniqueGuestIds) {
      const p = (profs ?? []).find((r) => r.id === id);
      if (!p || !p.palate_shareable) throw new Error("One guest turned off sharing.");
    }

    // OOS filter (if we're calling against a house list).
    let candidates = data.candidates;
    if (data.houseListId) {
      const { data: oos, error: oErr } = await supabase
        .from("house_list_stock")
        .select("bottle_id")
        .eq("house_list_id", data.houseListId)
        .eq("out_of_stock", true);
      if (oErr) throw new Error(oErr.message);
      const oosSet = new Set((oos ?? []).map((r) => r.bottle_id as string));
      candidates = candidates.filter((c) => !oosSet.has(c.id));
    }

    const bottleFps: BottleFp[] = candidates.map((c) => ({
      id: c.id, name: c.name, producer: c.producer ?? null, region: c.region ?? null,
      type: c.type as WineType, fp: c.fp as Record<FpKey, number>,
    }));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const perGuestPredicted = new Map<string, Map<string, number>>();
    const perGuestVetoed = new Map<string, Set<string>>();
    for (const g of data.guests) {
      const rated = await loadGuestRatedFp(supabaseAdmin, g.userId);
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

    const results: TableCallCandidateOut[] = candidates.map((c) => {
      const guestScores = data.guests.map((g) => {
        const predRaw = perGuestPredicted.get(g.userId)?.get(c.id);
        const vetoed = perGuestVetoed.get(g.userId)?.has(c.id) ?? false;
        const pred = vetoed
          ? 1.5
          : (typeof predRaw === "number" && !Number.isNaN(predRaw) ? predRaw : 3.0);
        return { userId: g.userId, archetype: g.archetype, initial: g.initial, predicted: pred };
      });
      const s = summarize(c.id, guestScores);
      return {
        ...s, name: c.name, producer: c.producer ?? null,
        region: c.region ?? null, type: c.type as WineType,
      };
    });

    const call = pickTableCall(results);
    return { results, call, guests: data.guests };
  });

// ────────── House list: read / save / stock / correct ──────────

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
    const activeVersion = versions?.find((v) => v.id === activeVersionId)?.version ?? null;

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
      const oos = new Set((stockRows ?? []).map((r) => r.bottle_id as string));
      items = (itemRows ?? []).map((r) => ({
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
        .in("version_id", (versions ?? []).map((v) => v.id));
      if (cErr) throw new Error(cErr.message);
      for (const r of cnt ?? []) {
        versionCounts.set(r.version_id as string, (versionCounts.get(r.version_id as string) ?? 0) + 1);
      }
    }
    return {
      houseListId: hl.id as string, establishment,
      activeVersionId, activeVersion,
      items,
      versions: (versions ?? []).map((v) => ({
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

    // Upsert house_lists
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

    // Load previous active items for diff
    const { data: hl } = await supabase.from("house_lists")
      .select("active_version_id").eq("id", houseListId).maybeSingle();
    let prevByBottle = new Map<string, number | null>(); // bottle_id -> price
    if (hl?.active_version_id) {
      const { data: prev } = await supabase.from("house_list_items")
        .select("bottle_id, price_amount").eq("version_id", hl.active_version_id);
      for (const r of prev ?? []) {
        if (r.bottle_id) prevByBottle.set(r.bottle_id as string, r.price_amount as number | null);
      }
    }

    // Next version number
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

    const rows = (wines ?? []).map((w) => ({
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

    // Diff
    const curByBottle = new Map<string, number | null>();
    for (const w of wines ?? []) {
      if (w.matched_bottle_id) {
        curByBottle.set(w.matched_bottle_id as string, w.price_amount as number | null);
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

/** Fetch candidate bottles for a house list version. Only bottles that
 *  resolved to the catalog are eligible — unresolved rows are hidden until
 *  the sommelier corrects them. */
const CandidatesInput = z.object({ houseListVersionId: z.string().uuid() });

export const sommHouseListCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CandidatesInput.parse(i))
  .handler(async ({ data, context }): Promise<Array<z.infer<typeof CandidateSchema>>> => {
    const { supabase, userId } = context;
    await requireVerifiedSomm(supabase, userId);
    const { data: items, error } = await supabase
      .from("house_list_items").select("bottle_id").eq("version_id", data.houseListVersionId);
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((items ?? []).map((r) => r.bottle_id).filter(Boolean))) as string[];
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
        out.push({
          id: b.id, name: b.name, producer: b.producer, region: b.region,
          type: (String(b.type ?? "red").toLowerCase()) as WineType,
          fp: {
            fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
            ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
          },
        });
      }
    }
    return out;
  });
