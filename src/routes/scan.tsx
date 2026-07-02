import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { ListControls } from "@/components/ListControls";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useSession } from "@/hooks/use-session";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { scanWineList, type ResolvedWine } from "@/lib/scan.functions";
import { searchRestaurantsFn, createRestaurantFn, attributeScanFn } from "@/lib/restaurants.functions";
import { aggregateRated } from "@/lib/cuvee";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls, type Priced } from "@/lib/list-controls";
import type { GroupScored } from "@/lib/group.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/scan")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a wine list — Palate Match" },
      { name: "description", content: "Photograph a restaurant wine list. We rank every bottle by predicted stars for your palate." },
    ],
  }),
  component: () => <AuthGate><Scan /></AuthGate>,
});

async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const buf = await file.arrayBuffer();
  // chunked to avoid call-stack blowup on large images
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const base64 = btoa(binary);
  let mt = file.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mt)) mt = "image/jpeg";
  return { base64, mediaType: mt };
}

type Ranked = Recommendation & { scanned: ResolvedWine };

type ScanRow = Priced & {
  key: string;
  ranked: Ranked;
  type: WineType;
  isCatalog: boolean;
  greatValue: boolean;
};

const TYPE_LABEL: Record<WineType, string> = {
  red: "Reds for you",
  white: "Whites for you",
  rose: "Rosés for you",
  sparkling: "Sparkling for you",
  dessert: "Dessert wines for you",
};

function Scan() {
  const session = useSession();
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const scan = useServerFn(scanWineList);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<{ file: File; url: string }[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const mutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 0) throw new Error("Add at least one photo first.");
      const uid = session?.user.id;
      const scanUuid = crypto.randomUUID();
      // Upload originals to private storage AND encode base64 for vision, in parallel.
      const prepared = await Promise.all(
        files.map(async (file, i) => {
          const { base64, mediaType } = await fileToBase64(file);
          let storagePath: string | null = null;
          if (uid) {
            const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
            const path = `${uid}/${scanUuid}/page-${i + 1}.${ext}`;
            const { error } = await supabase.storage
              .from("scan-images")
              .upload(path, file, { contentType: mediaType, upsert: true });
            if (!error) storagePath = path;
          }
          return {
            image_base64: base64,
            media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/heic",
            storagePath,
          };
        }),
      );
      const image_paths = prepared.map((p) => p.storagePath).filter((p): p is string => !!p);
      const images = prepared.map(({ image_base64, media_type }) => ({ image_base64, media_type }));
      return await scan({ data: { images, image_paths } });
    },
  });


  useEffect(() => {
    if (!mutation.isPending) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [mutation.isPending]);


  const wines = mutation.data?.wines ?? [];
  const stats = mutation.data?.stats;
  const readable = wines.filter((w) => w.fp_resolved);
  const unreadable = wines.filter((w) => !w.fp_resolved);

  // Diagnostic: log the resolved scan payload so it's easy to verify in console.
  useEffect(() => {
    if (mutation.data) {
      // eslint-disable-next-line no-console
      console.log("[scan] resolved", mutation.data);
    }
  }, [mutation.data]);

  const ratedRows: RatedFp[] = useMemo(() => {
    if (!ratedBottles || !ratings) return [];
    const raw = ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    // Aggregate to the cuvée — vintages of the same wine reinforce one signal.
    return aggregateRated(raw).map((c) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    }));
  }, [ratedBottles, ratings]);

  const ranked: Ranked[] = useMemo(() => {
    if (readable.length === 0) return [];
    const candidates: BottleFp[] = readable.map((w, i) => ({
      id: `scan-${i}`,
      name: [w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "Unknown wine",
      producer: w.producer ?? null,
      region: w.region ?? null,
      type: (w.type ?? "red") as WineType,
      fp: w.fp_resolved!,
    }));
    if (ratedRows.length === 0) {
      return candidates.map((b, i) => ({
        bottle: b, predicted: 0, nearest: null, maxSimilarity: 0, scanned: readable[i],
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(readable.map((w, i) => [`scan-${i}`, w]));
    return recs.map((r) => ({ ...r, scanned: byId.get(r.bottle.id)! }));
  }, [readable, ratedRows]);

  const enoughRatings = ratedRows.length >= 3;


  const grouped: { type: WineType; rows: ScanRow[] }[] = useMemo(() => {
    const buckets = new Map<WineType, ScanRow[]>();
    ranked.forEach((r, i) => {
      const t = (r.scanned.type ?? "red") as WineType;
      // Menu price captured from the photo (a raw string). Parse and normalize.
      const p = normalizePrice(r.scanned.price ?? null);
      const isCatalog = r.scanned.fp_source === "catalog";
      const row: ScanRow = {
        key: r.bottle.id + "-" + i,
        ranked: r,
        type: t,
        isCatalog,
        price_amount: p.amount,
        price_band: p.band,
        price_display: p.display,
        predicted: r.predicted,
        greatValue: false,
      };
      row.greatValue = isGreatValue(row);
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t)!.push(row);
    });
    const order: WineType[] = ["red", "white", "rose", "sparkling", "dessert"];
    return order
      .filter((t) => buckets.has(t))
      .map((t) => ({ type: t, rows: buckets.get(t)! }));
  }, [ranked]);

  // --- Group mode: score the scanned wines for the selected friend set ---
  const group = useGroupSelection();
  const groupCandidates: GroupCandidateInput[] = useMemo(() => {
    if (group.friendIds.length === 0) return [];
    return ranked.map((r) => ({
      id: r.bottle.id,
      name: r.bottle.name,
      producer: r.bottle.producer ?? null,
      region: r.bottle.region ?? null,
      type: r.bottle.type,
      fp: r.bottle.fp,
    }));
  }, [ranked, group.friendIds]);
  const groupPred = useGroupPredict(group.friendIds, groupCandidates);
  const groupScores = groupPred.data ?? null;
  const groupActive = group.friendIds.length > 0;



  function flagFor(r: Ranked): { label: string; tone: "good" | "bad" | "warn" } | null {
    if (!enoughRatings) return null;
    if (r.maxSimilarity < 0.35 || r.scanned.confidence === "low")
      return { label: "uncertain — unlike anything you've rated", tone: "warn" };
    if (r.predicted >= 3.8) return { label: "strong match", tone: "good" };
    if (r.predicted <= 2.6) return { label: "likely not your style", tone: "bad" };
    return null;
  }

  function onPick(fileList: FileList | null, inputEl: HTMLInputElement | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    setStaged((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= 8) break;
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
    if (inputEl) inputEl.value = "";
    mutation.reset();
  }

  function removeAt(i: number) {
    setStaged((prev) => {
      const next = [...prev];
      const [removed] = next.splice(i, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
    mutation.reset();
  }

  function startOver() {
    staged.forEach((s) => URL.revokeObjectURL(s.url));
    setStaged([]);
    mutation.reset();
  }

  function submit() {
    mutation.mutate(staged.map((s) => s.file));
  }

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scan a list</p>
      <h1 className="font-serif text-3xl mt-2">Photograph a wine list</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        I'll read every wine on the list and rank them by predicted stars for your palate. Add as many
        photos as the list has pages (up to 8) — they're sent to a vision model and not stored.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files, e.currentTarget)}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files, e.currentTarget)}
        />
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={mutation.isPending || staged.length >= 8}
          className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          Take a photo
        </button>
        <button
          onClick={() => libraryRef.current?.click()}
          disabled={mutation.isPending || staged.length >= 8}
          className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          Upload photos
        </button>
        {staged.length > 0 && (
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {mutation.isPending ? "Reading…" : `Scan ${staged.length} photo${staged.length > 1 ? "s" : ""}`}
          </button>
        )}
        {staged.length > 0 && !mutation.isPending && (
          <button
            onClick={startOver}
            className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium"
          >
            Start over
          </button>
        )}
      </div>

      {staged.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {staged.map((s, i) => (
            <div key={s.url} className="relative">
              <img src={s.url} alt={`page ${i + 1}`} className="h-24 rounded-md border border-border object-cover" />
              {!mutation.isPending && (
                <button
                  onClick={() => removeAt(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border text-xs leading-none flex items-center justify-center shadow"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {mutation.isPending && (
        <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full border-2 border-primary border-r-transparent animate-spin"
          />
          <div className="text-sm">
            <p className="font-medium">
              Reading {staged.length} photo{staged.length > 1 ? "s" : ""}…
            </p>
            <p className="text-xs text-muted-foreground">
              {elapsed}s elapsed · usually 10–40 seconds. Keep this screen open.
            </p>
          </div>
        </div>
      )}

      {mutation.isError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          <button
            onClick={submit}
            disabled={mutation.isPending || staged.length === 0}
            className="mt-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}


      {mutation.isSuccess && readable.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Couldn't read that list — try a clearer, straight-on photo with good light.
        </p>
      )}

      {!enoughRatings && readable.length > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          Rate a few wines first so I can match this list to your taste. Showing the list in the order it was read.
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          Read {stats.total} wine{stats.total > 1 ? "s" : ""} ·{" "}
          <span className="text-foreground">{stats.matched} matched the catalog</span> ·{" "}
          {stats.estimated} estimated
          {stats.unreadable > 0 ? ` · ${stats.unreadable} unreadable` : ""}.
          Catalog matches use calibrated fingerprints; estimated wines use a calibrated LLM inference on the same scale.
        </div>
      )}

      {grouped.length > 0 && (
        <div className="mt-6">
          <DrinkingGroupSelector
            selectedIds={group.friendIds}
            onToggle={group.toggle}
            onClear={group.clear}
            onSet={group.set}
          />
        </div>
      )}

      {grouped.length > 0 && (
        <div className="mt-6 space-y-8">
          {grouped.map((g) => (
            <ScanSection
              key={g.type}
              type={g.type}
              rows={g.rows}
              enoughRatings={enoughRatings}
              flagFor={flagFor}
              groupScores={groupScores}
              groupActive={groupActive}
              groupLoading={groupPred.isFetching}
            />
          ))}
        </div>
      )}


      {unreadable.length > 0 && (
        <div className="mt-8">
          <h2 className="font-serif text-base">Couldn't read these</h2>
          <ul className="mt-2 text-xs text-muted-foreground space-y-1">
            {unreadable.map((w, i) => (
              <li key={i}>{[w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "(illegible)"}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-10 text-[11px] text-muted-foreground">
        Each scan makes one paid vision call. Your photo is processed and discarded — never stored by the app.
      </p>
    </div>
  );
}

function ScanSection({
  type,
  rows,
  enoughRatings,
  flagFor,
  groupScores,
  groupActive,
  groupLoading,
}: {
  type: WineType;
  rows: ScanRow[];
  enoughRatings: boolean;
  flagFor: (r: Ranked) => { label: string; tone: "good" | "bad" | "warn" } | null;
  groupScores: Map<string, GroupScored> | null;
  groupActive: boolean;
  groupLoading: boolean;
}) {
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  // Overlay group_min onto the row's predicted score so filters/sort work unchanged.
  const overlaidRows: ScanRow[] = useMemo(() => {
    if (!groupActive || !groupScores) return rows;
    return rows.map((r) => {
      const g = groupScores.get(r.ranked.bottle.id);
      if (!g) return r;
      const next: ScanRow = { ...r, predicted: g.group_min };
      next.greatValue = isGreatValue(next);
      return next;
    });
  }, [rows, groupActive, groupScores]);

  const scoreAvailable = enoughRatings || groupActive;
  // When user hasn't rated enough (and no group), "best match" / "value" / "confident" have no
  // signal — fall back to keeping the scan's read order.
  const effective: Controls = !scoreAvailable && (controls.sort === "best" || controls.sort === "value" || controls.sort === "confident")
    ? { ...controls, sort: "best" }
    : controls;
  const filtered = useMemo(() => {
    const out = applyControls(overlaidRows, effective);
    if (!scoreAvailable && effective.sort === "best") {
      const idx = new Map(overlaidRows.map((r, i) => [r.key, i]));
      return [...out].sort((a, b) => (idx.get(a.key) ?? 0) - (idx.get(b.key) ?? 0));
    }
    return out;
  }, [overlaidRows, effective, scoreAvailable]);
  const visible = filtered.slice(0, 40);
  const hidden = Math.max(0, filtered.length - visible.length);

  return (
    <section>
      <h2 className="font-serif text-xl">{TYPE_LABEL[type]}</h2>
      {groupActive && (
        <p className="mt-1 text-[11px] uppercase tracking-wider text-primary">
          Group picks · ranked by worst-case ★{groupLoading ? " · scoring…" : ""}
        </p>
      )}
      <ListControls value={controls} onChange={setControls} idPrefix={`scan-${type}`} />
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No wines in this section match those filters.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visible.map(({ ranked: r, isCatalog, greatValue, price_display }) => {
            const flag = groupActive ? null : flagFor(r);
            const g = groupActive && groupScores ? groupScores.get(r.bottle.id) ?? null : null;
            return (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                    <span
                      className={`shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border ${
                        isCatalog
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                      title={isCatalog ? `Matched: ${r.scanned.matched_bottle_name}` : "No catalog match — calibrated LLM estimate"}
                    >
                      {isCatalog ? "catalog" : "estimated"}
                    </span>
                    {greatValue && (
                      <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        great value
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {[r.bottle.region, r.scanned.grape, price_display].filter(Boolean).join(" · ")}
                  </p>
                  {g && (
                    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                      {g.per_person.map((p, i) => (
                        <span key={p.user_id}>
                          {i > 0 && <span className="opacity-50"> · </span>}
                          <span className="text-foreground/80">{p.display_name}</span>{" "}
                          {p.predicted.toFixed(1)}
                          {p.still_learning && <span className="ml-0.5 opacity-70">(still learning)</span>}
                        </span>
                      ))}
                    </p>
                  )}
                  {!g && enoughRatings && r.nearest && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      like your {r.nearest.stars}★ <span className="text-foreground/80">{r.nearest.name}</span>
                    </p>
                  )}
                  {flag && (
                    <p className={`mt-1 text-[11px] ${
                      flag.tone === "good" ? "text-primary" :
                      flag.tone === "bad" ? "text-destructive" :
                      "text-muted-foreground italic"
                    }`}>
                      {flag.label}
                    </p>
                  )}
                </div>
                {g ? (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-primary text-xl">{g.group_min.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                    <p className="text-[10px] text-muted-foreground">avg {g.group_avg.toFixed(1)}</p>
                  </div>
                ) : enoughRatings ? (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">+{hidden} more match these filters.</p>
      )}
    </section>
  );
}
