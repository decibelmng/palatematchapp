import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import {
  scanBottleLabel,
  resolveBottleFromRead,
  type BottleCandidate,
  type BottleScanResult,
  type BottleExtract,
} from "@/lib/bottle-scan.functions";
import { resolveOrCreateOnDemand } from "@/lib/on-demand-bottle.functions";
import { createLovableVisionRecognizer } from "@/lib/recognizer";
import { supabase } from "@/integrations/supabase/client";
import { StarTap } from "@/components/StarTap";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { AddBottleDialog } from "@/components/AddBottleDialog";
import { verdictLine } from "@/components/verdict/reason";
import { toast } from "sonner";


export const Route = createFileRoute("/scan/bottle")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a bottle — Palate Match" },
      { name: "description", content: "Photograph a wine bottle label to identify, rate, or add it — in under 15 seconds." },
    ],
  }),
  component: BottleScan,
});

async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const buf = await file.arrayBuffer();
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

function BottleScan() {
  const session = useSession();
  const qc = useQueryClient();
  const scan = useServerFn(scanBottleLabel);
  const resolveFn = useServerFn(resolveBottleFromRead);
  const onDemandFn = useServerFn(resolveOrCreateOnDemand);
  const [onDemandBusy, setOnDemandBusy] = useState(false);
  // Provider-agnostic recognizer wrapper (Lovable vision LLM today; a
  // future bake-off winner can drop in behind the same interface).
  const recognizer = useMemo(() => createLovableVisionRecognizer(scan), [scan]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [front, setFront] = useState<{ file: File; url: string } | null>(null);
  const [back, setBack]   = useState<{ file: File; url: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pickTarget, setPickTarget] = useState<"front" | "back">("front");
  const [showAdd, setShowAdd] = useState(false);

  // Auto-open camera when arriving from the center-scan chooser (?capture=1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") !== "1") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", url.toString());
    setPickTarget("front");
    const t = setTimeout(() => cameraRef.current?.click(), 60);
    return () => clearTimeout(t);
  }, []);

  // Confirm-first state: after vision reads the label, the user edits
  // the extracted fields (photo visible), and NOTHING resolves to a
  // catalog wine or writes a rating until they confirm. Low-confidence
  // fields render highlighted; the human is the reliable step.
  const [editedRead, setEditedRead] = useState<BottleExtract | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [override, setOverride] = useState<{
    candidates: BottleCandidate[];
    best_score: number;
    match_quality: BottleScanResult["match_quality"];
    match_summary: string;
  } | null>(null);

  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const ratedRows: RatedFp[] = useMemo(() => {
    if (!ratedBottles || !ratings) return [];
    const raw = ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    return aggregateRated(raw).map((c) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    }));
  }, [ratedBottles, ratings]);

  const mutation = useMutation({
    mutationFn: async (): Promise<BottleScanResult> => {
      const files = [front, back].filter((s): s is { file: File; url: string } => !!s);
      if (files.length === 0) throw new Error("Take or upload at least a front-label photo.");
      const uid = session?.user.id;
      const scanUuid = crypto.randomUUID();
      const prepared = await Promise.all(files.map(async (s, i) => {
        const { base64, mediaType } = await fileToBase64(s.file);
        let storagePath: string | null = null;
        if (uid) {
          const ext = (s.file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
          const path = `${uid}/${scanUuid}/bottle-${i === 0 ? "front" : "back"}.${ext}`;
          const { error } = await supabase.storage
            .from("scan-images")
            .upload(path, s.file, { contentType: mediaType, upsert: true });
          if (!error) storagePath = path;
        }
        return {
          image_base64: base64,
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/heic",
          storagePath,
        };
      }));
      const image_paths = prepared.map((p) => p.storagePath).filter((p): p is string => !!p);
      const images = prepared.map(({ image_base64, media_type }) => ({ image_base64, media_type }));
      return await recognizer.recognizeBottle({ images, image_paths });
    },
    onSuccess: (r) => {
      // Seed the editable confirm form from the raw read; require an
      // explicit confirm before any candidate is presented for rating.
      setEditedRead(r.extracted);
      setConfirmed(false);
      setOverride(null);
    },
  });

  const resolveMut = useMutation({
    mutationFn: async (read: BottleExtract) => resolveFn({ data: { read } }),
    onSuccess: (r) => { setOverride(r); setConfirmed(true); },
    onError: (e: Error) => { toast.error(e.message || "Couldn't re-check the catalog."); },
  });

  useEffect(() => {
    if (!mutation.isPending) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [mutation.isPending]);

  function onPick(fileList: FileList | null, inputEl: HTMLInputElement | null) {
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    const url = URL.createObjectURL(f);
    const isFirstPhoto = !front && !back;
    if (pickTarget === "front") {
      if (front) URL.revokeObjectURL(front.url);
      setFront({ file: f, url });
    } else {
      if (back) URL.revokeObjectURL(back.url);
      setBack({ file: f, url });
    }
    if (inputEl) inputEl.value = "";
    mutation.reset();
    setEditedRead(null); setConfirmed(false); setOverride(null);
    // Auto-kick the scan on the first photo so users don't have to hunt
    // for a second button. Subsequent adds (e.g. adding a back label)
    // still require an explicit "Identify" tap.
    if (isFirstPhoto) {
      setTimeout(() => mutation.mutate(), 0);
    }
  }

  function startOver() {
    if (front) URL.revokeObjectURL(front.url);
    if (back) URL.revokeObjectURL(back.url);
    setFront(null); setBack(null);
    mutation.reset();
    setEditedRead(null); setConfirmed(false); setOverride(null);
  }

  const result = mutation.data ?? null;

  // Predicted stars for the top catalog candidate
  const predictedForCandidate = (c: BottleCandidate): number | null => {
    if (ratedRows.length < 3) return null;
    const cand: BottleFp = {
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: (c.type ?? "red") as any, fp: c.fp,
    };
    const [rec] = recommend(ratedRows, [cand]);
    return rec?.predicted ?? null;
  };

  async function rateCandidate(c: BottleCandidate, stars: number) {
    if (!session) return;
    // Route through the cascade RPC so rating a scanned bottle can never
    // orphan an existing benchmark; useRate isn't wired here because scan
    // has its own react-query lifecycle. Confirm inline if applicable.
    const { data: canonRows } = await supabase
      .from("canon_wines")
      .select("tier,region")
      .eq("user_id", session.user.id)
      .eq("bottle_id", c.id)
      .is("replaced_at", null)
      .limit(1);
    const active = canonRows?.[0] as { tier: "canon" | "nemesis"; region: string } | undefined;
    if (active && (
      (active.tier === "canon" && stars < 5) ||
      (active.tier === "nemesis" && stars > 2)
    )) {
      const verb = active.tier === "canon"
        ? `You marked this as one of your favorites in ${active.region} — lowering the rating removes that.`
        : `You marked this as one to avoid in ${active.region} — raising the rating removes that.`;
      if (typeof window !== "undefined" && !window.confirm(`${verb}\n\nContinue and update ${c.name}?`)) {
        return;
      }
    }
    const predicted = predictedForCandidate(c);
    const { error } = await (supabase as any).rpc("save_rating_with_cascade", {
      p_bottle_id: c.id,
      p_stars: stars,
      p_predicted: predicted,
    });

    if (error) {
      toast.error(error.message || `Couldn't rate ${c.name}`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["ratings"] });
    qc.invalidateQueries({ queryKey: ["canons"] });
    qc.invalidateQueries({ queryKey: ["palate-version"] });
    toast.success(`Rated ${c.name} ${stars}★`);
  }

  // C2 — On-demand fingerprint & add.
  // Fires only from the "no catalog match" path, after confirm. Identity
  // dedup runs server-side; if a match exists we link (no dupe insert). If
  // not, we fingerprint via the same LLM pipeline the base catalog uses
  // and insert as source='on-demand', unverified=true.
  async function fingerprintAndAdd() {
    if (!extracted || onDemandBusy) return;
    const producer = extracted.producer?.trim();
    const name = (extracted.wine_name ?? extracted.region ?? "").trim();
    if (!producer || !name) {
      toast.error("Producer and wine/appellation are required.");
      return;
    }
    setOnDemandBusy(true);
    try {
      const res = await onDemandFn({
        data: {
          producer,
          name,
          type: (extracted.type ?? "red") as "red" | "white" | "sparkling" | "rose" | "dessert",
          region: extracted.region ?? null,
          country: extracted.country ?? null,
          grape: extracted.grape ?? null,
          vintage: extracted.vintage ?? null,
        },
      });
      qc.invalidateQueries({ queryKey: ["bottles"] });
      if (res.reason === "identity-linked") {
        toast.success("Matched an existing catalog wine.");
      } else if (res.reason === "flat-flagged") {
        toast.warning("Added — the style read was thin, so we flagged it for review.");
      } else {
        toast.success("Added to your catalog.");
      }
      // Hand off to the manual dialog in "rate" phase by opening it with
      // the resolved id? Simpler: nudge them to /rate — the wine is now
      // scoreable and searchable.
      window.location.href = `/wine/${res.bottle_id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add this wine.");
    } finally {
      setOnDemandBusy(false);
    }
  }

  const rawExtracted = result?.extracted;
  const extracted = editedRead ?? rawExtracted;
  const looksLikeMenu = result?.looks_like_menu === true;

  // The resolution shown to the user is either the initial server-side
  // resolution (from the raw read) or an override from re-resolving the
  // edited read on confirm. Candidates only render once confirmed=true.
  const resolution = override ?? (result ? {
    candidates: result.candidates,
    best_score: result.best_score,
    match_quality: result.match_quality,
    match_summary: result.match_summary,
  } : null);

  function readChanged(): boolean {
    if (!rawExtracted || !editedRead) return false;
    const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
    return (
      norm(editedRead.producer)  !== norm(rawExtracted.producer)  ||
      norm(editedRead.wine_name) !== norm(rawExtracted.wine_name) ||
      norm(editedRead.region)    !== norm(rawExtracted.region)    ||
      norm(editedRead.country)   !== norm(rawExtracted.country)   ||
      norm(editedRead.grape)     !== norm(rawExtracted.grape)     ||
      (editedRead.vintage ?? null) !== (rawExtracted.vintage ?? null) ||
      (editedRead.type ?? null)    !== (rawExtracted.type ?? null)
    );
  }

  function confirmRead() {
    if (!editedRead) return;
    if (readChanged()) {
      resolveMut.mutate(editedRead);
    } else {
      setConfirmed(true);
    }
  }


  return (
    <div className="pt-2">
      <div className="flex items-center gap-3 text-xs">
        <Link to="/" className="text-muted-foreground hover:text-foreground">← Home</Link>
      </div>
      <p className="mt-3 text-xs uppercase tracking-label text-muted-foreground">Scan a bottle</p>
      <h1 className="font-serif text-3xl mt-2">Point at the label</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One clear photo of the front label. Add the back if the front is sparse — it helps for obscure bottles.
      </p>

      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files, e.currentTarget)}
      />
      <input
        ref={libraryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files, e.currentTarget)}
      />

      <div className="mt-5 grid grid-cols-2 gap-3">
        <LabelSlot
          title="Front label"
          preview={front}
          onCamera={() => { setPickTarget("front"); cameraRef.current?.click(); }}
          onUpload={() => { setPickTarget("front"); libraryRef.current?.click(); }}
          onRemove={() => { if (front) URL.revokeObjectURL(front.url); setFront(null); mutation.reset(); }}
          disabled={mutation.isPending}
        />
        <LabelSlot
          title="Back label (optional)"
          preview={back}
          onCamera={() => { setPickTarget("back"); cameraRef.current?.click(); }}
          onUpload={() => { setPickTarget("back"); libraryRef.current?.click(); }}
          onRemove={() => { if (back) URL.revokeObjectURL(back.url); setBack(null); mutation.reset(); }}
          disabled={mutation.isPending}
        />
      </div>

      {(front || back) && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {mutation.isPending ? "Reading label…" : "Identify this bottle"}
          </button>
          {!mutation.isPending && (
            <button
              onClick={startOver}
              className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium"
            >
              Start over
            </button>
          )}
        </div>
      )}

      {mutation.isPending && (
        <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 flex items-center gap-3">
          <span aria-hidden className="inline-block h-4 w-4 rounded-full border-2 border-primary border-r-transparent animate-spin" />
          <div className="text-sm">
            <p className="font-medium">Reading label…</p>
            <p className="text-xs text-muted-foreground">{elapsed}s elapsed · usually 5–15 seconds.</p>
          </div>
        </div>
      )}

      {mutation.isError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        </div>
      )}

      {looksLikeMenu && (
        <div className="pm-uncertain mt-4 rounded-md p-3 text-sm">
          This looks like a wine <span className="font-medium">list or menu</span>, not a single bottle.
          <div className="mt-2">
            <Link to="/scan/list" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">
              Switch to list scan →
            </Link>
          </div>
        </div>
      )}

      {result && !looksLikeMenu && extracted && editedRead && (
        <div className="mt-6 space-y-5">
          {!confirmed ? (
            <ConfirmReadCard
              read={editedRead}
              rawConfidence={rawExtracted?.confidence ?? null}
              photoUrl={front?.url ?? back?.url ?? null}
              onChange={(patch: Partial<BottleExtract>) => setEditedRead({ ...editedRead, ...patch })}
              onConfirm={confirmRead}
              onNoneOfThese={() => setShowAdd(true)}
              busy={resolveMut.isPending}
            />
          ) : (
            <>
              {/* Duplicate detection: have I already rated this cuvée? */}
              {(() => {
                const dupe = findExistingRating(extracted, ratedBottles ?? [], ratings ?? []);
                if (!dupe) return null;
                return (
                  <div className="rounded-md border border-primary/50 bg-primary/10 p-3 text-sm">
                    <p className="font-medium">You've rated this wine before — {dupe.stars}★</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dupe.bottle.producer} · {dupe.bottle.name}{dupe.bottle.vintage ? ` · ${dupe.bottle.vintage}` : ""}
                    </p>
                    <p className="mt-1 text-meta text-muted-foreground">
                      Rate it again below to update — we'll keep it on the same wine instead of duplicating.
                    </p>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between gap-3">
                <p className="text-meta uppercase tracking-label text-primary">Confirmed</p>
                <button
                  onClick={() => setConfirmed(false)}
                  className="text-meta text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Edit read
                </button>
              </div>

              {resolution && (resolution.match_quality === "confident" || resolution.match_quality === "ambiguous") && (
                <p className="text-xs text-muted-foreground -mb-2">{resolution.match_summary}</p>
              )}

              {resolution?.match_quality === "confident" && resolution.candidates[0] && (
                <ConfidentCard
                  c={resolution.candidates[0]}
                  predicted={predictedForCandidate(resolution.candidates[0])}
                  onRate={(s) => rateCandidate(resolution.candidates[0], s)}
                />
              )}

              {resolution?.match_quality === "ambiguous" && (
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">Is it one of these?</p>
                    <p className="text-meta text-muted-foreground">Top {Math.min(3, resolution.candidates.length)} matches — compare & pick</p>
                  </div>
                  <ul className="mt-3 space-y-3">
                    {resolution.candidates.slice(0, 3).map((c, idx) => (
                      <CompareCard
                        key={c.id}
                        c={c}
                        rank={idx + 1}
                        extracted={extracted}
                        predicted={predictedForCandidate(c)}
                        onRate={(s) => rateCandidate(c, s)}
                      />
                    ))}
                  </ul>
                  <div className="mt-4 rounded-md border-2 border-dashed border-primary/50 bg-primary/5 p-3">
                    <p className="text-sm font-medium">None of these match?</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Add it as a new community bottle — we'll pre-fill everything from your confirmed read. Only the wine name is required.
                    </p>
                    <button
                      onClick={() => setShowAdd(true)}
                      className="mt-2 w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
                    >
                      Add as new bottle →
                    </button>
                  </div>
                </div>
              )}

              {resolution?.match_quality === "none" && (
                <div className="rounded-md border border-dashed border-border bg-card p-4">
                  <p className="text-sm font-medium">
                    {extracted.producer || extracted.wine_name
                      ? "No confident catalog match — add it as a community bottle."
                      : "Couldn't read this label — enter the wine name to continue."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your confirmed read is pre-filled. Only the wine name is required.
                  </p>
                  <div className="mt-3 grid gap-2">
                    <button
                      onClick={fingerprintAndAdd}
                      disabled={onDemandBusy || !extracted.producer || !(extracted.wine_name || extracted.region)}
                      className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      {onDemandBusy ? "Working…" : "Add it and work out its style."}
                    </button>
                    <button
                      onClick={() => setShowAdd(true)}
                      disabled={onDemandBusy}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      Add with manual details →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}


      {showAdd && (
        <AddBottleDialog
          open={showAdd}
          onClose={() => setShowAdd(false)}
          initialForm={{
            producer: extracted?.producer ?? "",
            name: extracted?.wine_name ?? extracted?.region ?? "",
            type: (extracted?.type ?? "red") as any,
            region: extracted?.region ?? "",
            country: extracted?.country ?? "",
            grape: extracted?.grape ?? "",
            vintage: extracted?.vintage != null ? String(extracted.vintage) : "",
          }}
        />
      )}

      <p className="mt-10 text-meta text-muted-foreground">
        Each scan makes one paid vision call. Your label photo is stored privately to your account.
      </p>
    </div>
  );
}

function LabelSlot({
  title, preview, onCamera, onUpload, onRemove, disabled,
}: {
  title: string;
  preview: { url: string } | null;
  onCamera: () => void;
  onUpload: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-meta uppercase tracking-label text-muted-foreground">{title}</p>
      {preview ? (
        <div className="mt-2 relative">
          <img src={preview.url} alt={title} className="w-full h-40 object-cover rounded-md border border-border" />
          {!disabled && (
            <button
              onClick={onRemove}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border text-xs leading-none flex items-center justify-center shadow"
              aria-label={`Remove ${title}`}
            >×</button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <button
            onClick={onCamera}
            disabled={disabled}
            className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-medium disabled:opacity-60"
          >
            Take photo
          </button>
          <button
            onClick={onUpload}
            disabled={disabled}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium disabled:opacity-60"
          >
            Upload
          </button>
        </div>
      )}
    </div>
  );
}

function ConfidentCard({
  c, predicted, onRate,
}: { c: BottleCandidate; predicted: number | null; onRate: (stars: number) => void }) {
  const [stars, setStars] = useState<number | null>(null);
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-meta uppercase tracking-label text-primary">Found it</p>
      <p className="mt-1 font-medium">{c.name}</p>
      <p className="text-xs text-muted-foreground">
        {[c.producer, c.region, c.vintage].filter(Boolean).join(" · ")}
      </p>
      {c.tasting_note && (
        <p className="mt-2 text-xs italic text-muted-foreground">"{c.tasting_note}"</p>
      )}
      {predicted != null && (
        <p className="mt-2 text-sm">
          For you: <span className="font-serif text-primary text-lg">{predicted.toFixed(1)}</span>
          <span className="text-primary">★</span>
        </p>
      )}
      <ConfidenceMeter score={c.score} reasons={c.reasons} />
      <div className="mt-3">
        <p className="text-xs text-muted-foreground mb-1">Rate it (one tap)</p>
        <StarTap value={stars} onChange={(s) => { if (s != null) { setStars(s); onRate(s); } }} />
        {stars != null && <p className="mt-1 text-meta text-primary">Saved {stars}★</p>}
      </div>
    </div>
  );
}

function ConfidenceMeter({ score, reasons }: { score: number; reasons: string[] }) {
  const pct = Math.round(score * 100);
  const label = score >= 0.85 ? "High confidence" : score >= 0.6 ? "Possible match" : "Low confidence";
  const tone =
    score >= 0.85
      ? "bg-primary text-primary-foreground"
      : score >= 0.6
      ? "bg-amber-500/20 text-foreground dark:text-foreground"
      : "bg-muted text-muted-foreground";
  const bar =
    score >= 0.85 ? "bg-primary" : score >= 0.6 ? "bg-amber-500" : "bg-muted-foreground/60";
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className={`text-meta uppercase tracking-label rounded-full px-2 py-0.5 ${tone}`}>
          {label} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-border overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {reasons.length > 0 && (
        <details className="mt-2 text-meta text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Why this match?
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-4 list-disc">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function fieldMatch(a: string | null | undefined, b: string | null | undefined): "match" | "diff" | "unknown" {
  const na = normalize(a); const nb = normalize(b);
  if (!na || !nb) return "unknown";
  if (na === nb) return "match";
  const aw = new Set(na.split(" ").filter((w) => w.length > 2));
  const bw = nb.split(" ").filter((w) => w.length > 2);
  if (bw.some((w) => aw.has(w))) return "match";
  return "diff";
}

function CompareRow({
  label, value, status,
}: { label: string; value: string; status: "match" | "diff" | "unknown" }) {
  const tone =
    status === "match" ? "text-primary" :
    status === "diff" ? "text-foreground dark:text-foreground" :
    "text-muted-foreground";
  const icon = status === "match" ? "✓" : status === "diff" ? "≠" : "·";
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-16 shrink-0 text-meta uppercase tracking-label text-muted-foreground">{label}</span>
      <span className={`shrink-0 font-mono ${tone}`}>{icon}</span>
      <span className="min-w-0 truncate">{value || <span className="text-muted-foreground italic">—</span>}</span>
    </div>
  );
}

function CompareCard({
  c, rank, extracted, predicted, onRate,
}: {
  c: BottleCandidate;
  rank: number;
  extracted: BottleExtract;
  predicted: number | null;
  onRate: (stars: number) => void;
}) {
  const [stars, setStars] = useState<number | null>(null);
  const producerStatus = fieldMatch(extracted.producer, c.producer);
  const nameStatus = fieldMatch(extracted.wine_name, c.name);
  const regionStatus = fieldMatch(extracted.region ?? extracted.country, c.region);
  const vintageStatus: "match" | "diff" | "unknown" =
    extracted.vintage == null || c.vintage == null
      ? "unknown"
      : extracted.vintage === c.vintage ? "match" : "diff";

  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-meta font-mono text-muted-foreground">#{rank}</span>
            <p className="text-sm font-medium truncate">{c.name}</p>
          </div>
          {c.tasting_note && (
            <p className="mt-1 text-meta italic text-muted-foreground line-clamp-2">"{c.tasting_note}"</p>
          )}
        </div>
        {predicted != null && (
          <div className="shrink-0 text-right">
            <p className="text-meta uppercase tracking-label text-muted-foreground">For you</p>
            <p className="font-serif text-primary text-base leading-none">{predicted.toFixed(1)}<span className="text-xs">★</span></p>
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-1 rounded border border-border/60 bg-background/40 p-2">
        <CompareRow label="Producer" value={c.producer ?? ""} status={producerStatus} />
        <CompareRow label="Cuvée"    value={c.name}            status={nameStatus} />
        <CompareRow label="Region"   value={c.region ?? ""}    status={regionStatus} />
        <CompareRow label="Vintage"  value={c.vintage != null ? String(c.vintage) : ""} status={vintageStatus} />
      </div>

      <ConfidenceMeter score={c.score} reasons={c.reasons} />

      <div className="mt-3 border-t border-border/60 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Pick & rate</p>
          <button
            onClick={() => { setStars(5); onRate(5); }}
            className="text-meta rounded-md bg-primary text-primary-foreground px-2.5 py-1 font-medium"
          >
            That's it · 5★
          </button>
        </div>
        <div className="mt-1.5">
          <StarTap value={stars} onChange={(s: number | null) => { if (s != null) { setStars(s); onRate(s); } }} />
          {stars != null && <p className="mt-1 text-meta text-primary">Saved {stars}★</p>}
        </div>
      </div>
    </li>
  );
}

// ---------- Extracted "read from label" card with confirmed/inferred chips ----------

function ExtractedCard({ extracted }: { extracted: BottleExtract }) {
  // Producer + wine_name are usually printed on the label → confirmed.
  // Grape/region/type are frequently inferred from producer typicity when the
  // label is sparse. Chip them as "verify" when overall confidence is not high.
  const inferHint = extracted.confidence !== "high";
  const chip = (
    <span className="pm-uncertain-chip ml-1 text-meta">
      verify
    </span>

  );
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-meta uppercase tracking-label text-muted-foreground">Read from label</p>
      <p className="mt-1 font-medium">
        {[extracted.producer, extracted.wine_name].filter(Boolean).join(" — ") || "(couldn't read producer)"}
      </p>
      <p className="text-xs text-muted-foreground">
        {extracted.vintage != null && <span>{extracted.vintage}</span>}
        {(extracted.region ?? extracted.country) && (
          <>
            {extracted.vintage != null && <span> · </span>}
            <span>{extracted.region ?? extracted.country}</span>
            {inferHint && chip}
          </>
        )}
        {extracted.grape && (
          <>
            <span> · </span>
            <span>{extracted.grape}</span>
            {inferHint && chip}
          </>
        )}
      </p>
      {extracted.type && (
        <div className="mt-1 flex items-center gap-1">
          <WineTypeBadge type={extracted.type} />
          {inferHint && chip}
        </div>
      )}
      <p className="mt-2 text-meta text-muted-foreground">
        Chips marked <span className="text-foreground dark:text-foreground">verify</span> may have been inferred — tap to correct in the form.
      </p>
    </div>
  );
}

// ---------- Duplicate rating detection (producer + cuvée, vintage-collapsed) ----------

function tokenize(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3),
  );
}
function overlaps(a: Set<string>, b: Set<string>): number {
  let n = 0; a.forEach((t) => { if (b.has(t)) n++; });
  return n;
}
function findExistingRating(
  extracted: BottleExtract,
  ratedBottles: Array<{ id: string; name: string; producer: string | null; vintage: number | null }>,
  ratings: Array<{ bottle_id: string; stars: number }>,
) {
  const eProd = tokenize(extracted.producer);
  const eName = tokenize(extracted.wine_name);
  if (eProd.size === 0 && eName.size === 0) return null;
  let best: { bottle: any; stars: number; score: number } | null = null;
  for (const b of ratedBottles) {
    const bProd = tokenize(b.producer);
    const bName = tokenize(b.name);
    const prodO = overlaps(eProd, bProd);
    const nameO = overlaps(eName, bName) + overlaps(eName, bProd);
    if (eProd.size > 0 && prodO === 0) continue;
    if (eName.size > 0 && nameO === 0) continue;
    const score = prodO + nameO;
    if (score < 2) continue;
    const r = ratings.find((x) => x.bottle_id === b.id);
    if (!r) continue;
    if (!best || score > best.score) best = { bottle: b, stars: r.stars, score };
  }
  return best;
}


// ---------- Editable confirm screen (the make-or-break) ----------
//
// After vision reads the label, the human confirms or fixes each field
// BEFORE anything resolves to a catalog wine or writes a rating.
// Low-confidence fields (or empty fields) render with an amber ring so
// the user knows what to double-check. The photo stays visible.

function ConfirmReadCard({
  read, rawConfidence, photoUrl, onChange, onConfirm, onNoneOfThese, busy,
}: {
  read: BottleExtract;
  rawConfidence: "high" | "medium" | "low" | null | undefined;
  photoUrl: string | null;
  onChange: (patch: Partial<BottleExtract>) => void;
  onConfirm: () => void;
  onNoneOfThese: () => void;
  busy: boolean;
}) {
  // Field is "low-confidence" when either (a) the whole read was flagged
  // medium/low, or (b) the field itself is empty / null. In either case
  // we want the human's eye on it.
  const shaky = rawConfidence !== "high";
  const highlight = (v: string | number | null | undefined) =>
    (shaky || v == null || v === "")
      ? "border border-dashed border-[--amber] bg-transparent"
      : "border-border bg-background";


  const producerBlank = !read.producer?.trim();
  const nameBlank = !read.wine_name?.trim();
  const missingCore = producerBlank && nameBlank;

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta uppercase tracking-label text-primary">Confirm the read</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check what we pulled off the label before we look it up. Amber fields may have been inferred.
          </p>
        </div>
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Scanned label"
            className="shrink-0 h-20 w-20 object-cover rounded-md border border-border"
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ConfirmField label="Producer" required value={read.producer ?? ""} highlightClass={highlight(read.producer)}
          onChange={(v) => onChange({ producer: v || null })} placeholder="e.g. Château Margaux" />
        <ConfirmField label="Cuvée / wine name" value={read.wine_name ?? ""} highlightClass={highlight(read.wine_name)}
          onChange={(v) => onChange({ wine_name: v || null })} placeholder="Leave empty for producer-only labels" />
        <ConfirmField label="Vintage" value={read.vintage != null ? String(read.vintage) : ""} highlightClass={highlight(read.vintage)}
          onChange={(v) => {
            const n = v.replace(/[^0-9]/g, "").slice(0, 4);
            onChange({ vintage: n.length === 4 ? Number(n) : null });
          }} placeholder="Ask, don't guess" inputMode="numeric" />
        <ConfirmField label="Region / appellation" value={read.region ?? ""} highlightClass={highlight(read.region)}
          onChange={(v) => onChange({ region: v || null })} placeholder="e.g. Margaux, Bordeaux" />
        <ConfirmField label="Country" value={read.country ?? ""} highlightClass={highlight(read.country)}
          onChange={(v) => onChange({ country: v || null })} placeholder="France" />
        <ConfirmField label="Grape(s)" value={read.grape ?? ""} highlightClass={highlight(read.grape)}
          onChange={(v) => onChange({ grape: v || null })} placeholder="Nebbiolo · often inferred" />
        <div className="block">
          <label className="block text-meta font-medium text-foreground mb-1.5">Type</label>
          <select
            value={read.type ?? "red"}
            onChange={(e) => onChange({ type: e.target.value as BottleExtract["type"] })}
            className={`w-full rounded-md border px-3 py-2 text-sm outline-none transition ${highlight(read.type)}`}
          >
            <option value="red">Red</option>
            <option value="white">White</option>
            <option value="rose">Rosé</option>
            <option value="sparkling">Sparkling</option>
            <option value="dessert">Dessert</option>
          </select>
        </div>
      </div>

      {read.vintage == null && (
        <p className="mt-3 text-meta text-foreground dark:text-foreground">
          No vintage read — style shifts by year, so leaving this blank matches the wine but not the specific bottle.
        </p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <p className="text-meta text-muted-foreground">
          Nothing is saved until you confirm.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onNoneOfThese}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
          >
            Add as new bottle
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || missingCore}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Re-checking catalog…" : "Confirm & find in catalog →"}
          </button>
        </div>
      </div>
      {missingCore && (
        <p className="mt-2 text-meta text-destructive">
          At least a producer or wine name is required.
        </p>
      )}
    </div>
  );
}

function ConfirmField({
  label, value, onChange, placeholder, required, inputMode, highlightClass,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "text" | "numeric";
  highlightClass: string;
}) {
  return (
    <div className="block">
      <label className="block text-meta font-medium text-foreground mb-1.5">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition ${highlightClass}`}
      />
    </div>
  );
}




