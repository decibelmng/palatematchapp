import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { scanWineList, type ScannedWine } from "@/lib/scan.functions";

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

type Ranked = Recommendation & { scanned: ScannedWine };

function Scan() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const scan = useServerFn(scanWineList);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const { base64, mediaType } = await fileToBase64(file);
      return await scan({ data: { image_base64: base64, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/heic" } });
    },
  });

  const wines = mutation.data?.wines ?? [];
  const readable = wines.filter((w) => w.fp);
  const unreadable = wines.filter((w) => !w.fp);

  const ratedRows: RatedFp[] = useMemo(() => {
    if (!ratedBottles || !ratings) return [];
    return ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b),
      fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
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
      fp: w.fp!,
    }));
    if (ratedRows.length === 0) {
      // No ratings yet: present in original order, no scoring.
      return candidates.map((b, i) => ({
        bottle: b, predicted: 0, nearest: null, maxSimilarity: 0, scanned: readable[i],
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(readable.map((w, i) => [`scan-${i}`, w]));
    return recs.map((r) => ({ ...r, scanned: byId.get(r.bottle.id)! }));
  }, [readable, ratedRows]);

  const enoughRatings = ratedRows.length >= 3;
  const displayList = ranked.slice(0, 40);

  function flagFor(r: Ranked): { label: string; tone: "good" | "bad" | "warn" } | null {
    if (!enoughRatings) return null;
    if (r.maxSimilarity < 0.35 || r.scanned.confidence === "low")
      return { label: "uncertain — unlike anything you've rated", tone: "warn" };
    if (r.predicted >= 3.8) return { label: "strong match", tone: "good" };
    if (r.predicted <= 2.6) return { label: "likely not your style", tone: "bad" };
    return null;
  }

  function onPick(file: File | undefined | null) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    mutation.reset();
    mutation.mutate(file);
  }

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scan a list</p>
      <h1 className="font-serif text-3xl mt-2">Photograph a wine list</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        I'll read every wine on the list and rank them by predicted stars for your palate. The photo
        is sent to a vision model and not stored.
      </p>

      <div className="mt-5 flex gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={mutation.isPending}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {mutation.isPending ? "Reading…" : preview ? "Scan another" : "Take or upload photo"}
        </button>
      </div>

      {preview && (
        <img src={preview} alt="wine list" className="mt-4 max-h-48 rounded-md border border-border object-cover" />
      )}

      {mutation.isError && (
        <p className="mt-4 text-sm text-destructive">{(mutation.error as Error).message}</p>
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

      {displayList.length > 0 && (
        <ul className="mt-6 divide-y divide-border">
          {displayList.map((r) => {
            const flag = flagFor(r);
            return (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[r.bottle.region, r.scanned.grape, r.scanned.price].filter(Boolean).join(" · ")}
                  </p>
                  {enoughRatings && r.nearest && (
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
                {enoughRatings && (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {ranked.length > 40 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing top 40 of {ranked.length} readable wines.
        </p>
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
