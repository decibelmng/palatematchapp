import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { scanBottleLabel, type BottleCandidate, type BottleScanResult, type BottleExtract } from "@/lib/bottle-scan.functions";
import { supabase } from "@/integrations/supabase/client";
import { StarTap } from "@/components/StarTap";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { AddBottleDialog } from "@/components/AddBottleDialog";
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [front, setFront] = useState<{ file: File; url: string } | null>(null);
  const [back, setBack]   = useState<{ file: File; url: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pickTarget, setPickTarget] = useState<"front" | "back">("front");
  const [showAdd, setShowAdd] = useState(false);

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

  function onPick(fileList: FileList | null, inputEl: HTMLInputElement | null) {
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    const url = URL.createObjectURL(f);
    if (pickTarget === "front") {
      if (front) URL.revokeObjectURL(front.url);
      setFront({ file: f, url });
    } else {
      if (back) URL.revokeObjectURL(back.url);
      setBack({ file: f, url });
    }
    if (inputEl) inputEl.value = "";
    mutation.reset();
  }

  function startOver() {
    if (front) URL.revokeObjectURL(front.url);
    if (back) URL.revokeObjectURL(back.url);
    setFront(null); setBack(null);
    mutation.reset();
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
    await supabase.from("ratings").upsert(
      { user_id: session.user.id, bottle_id: c.id, stars },
      { onConflict: "user_id,bottle_id" },
    );
    qc.invalidateQueries({ queryKey: ["ratings"] });
    toast.success(`Rated ${c.name} ${stars}★`);
  }

  const extracted = result?.extracted;
  const looksLikeMenu = result?.looks_like_menu === true;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-3 text-xs">
        <Link to="/scan" className="text-muted-foreground hover:text-foreground">← Scan</Link>
      </div>
      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Scan a bottle</p>
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

      {front && (
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
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This looks like a wine <span className="font-medium">list or menu</span>, not a single bottle.
          <div className="mt-2">
            <Link to="/scan/list" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">
              Switch to list scan →
            </Link>
          </div>
        </div>
      )}

      {result && !looksLikeMenu && extracted && (
        <div className="mt-6 space-y-5">
          <div className="rounded-md border border-border bg-card/60 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Read from label</p>
            <p className="mt-1 font-medium">
              {[extracted.producer, extracted.wine_name].filter(Boolean).join(" — ") || "(couldn't read producer)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {[extracted.vintage, extracted.region ?? extracted.country, extracted.grape].filter(Boolean).join(" · ")}
            </p>
            {extracted.type && <div className="mt-1"><WineTypeBadge type={extracted.type} /></div>}
          </div>

          {(result.match_quality === "confident" || result.match_quality === "ambiguous") && (
            <p className="text-xs text-muted-foreground -mb-2">{result.match_summary}</p>
          )}

          {result.match_quality === "confident" && result.candidates[0] && (
            <ConfidentCard
              c={result.candidates[0]}
              predicted={predictedForCandidate(result.candidates[0])}
              onRate={(s) => rateCandidate(result.candidates[0], s)}
            />
          )}

          {result.match_quality === "ambiguous" && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">Is it one of these?</p>
                <p className="text-[11px] text-muted-foreground">Top {Math.min(3, result.candidates.length)} matches — compare & pick</p>
              </div>
              <ul className="mt-3 space-y-3">
                {result.candidates.slice(0, 3).map((c, idx) => (
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
                  Add it as a new community bottle — we'll pre-fill everything from the label.
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


          {result.match_quality === "none" && (
            <div className="rounded-md border border-dashed border-border bg-card/40 p-4">
              <p className="text-sm">No confident catalog match — add it as a community bottle.</p>
              <p className="mt-1 text-xs text-muted-foreground">Everything from the label is pre-filled. Just confirm.</p>
              <button
                onClick={() => setShowAdd(true)}
                className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
              >
                Add this bottle →
              </button>
            </div>
          )}
        </div>
      )}

      <AddBottleDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        initialForm={{
          producer: extracted?.producer ?? "",
          name: extracted?.wine_name ?? "",
          type: (extracted?.type ?? "red") as any,
          region: extracted?.region ?? "",
          country: extracted?.country ?? "",
          grape: extracted?.grape ?? "",
          vintage: extracted?.vintage != null ? String(extracted.vintage) : "",
        }}
      />

      <p className="mt-10 text-[11px] text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</p>
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
      <p className="text-[10px] uppercase tracking-[0.18em] text-primary">Found it</p>
      <p className="mt-1 font-medium">{c.name}</p>
      <p className="text-xs text-muted-foreground">
        {[c.producer, c.region, c.vintage].filter(Boolean).join(" · ")}
      </p>
      {c.tasting_note && (
        <p className="mt-2 text-xs italic text-muted-foreground">"{c.tasting_note}"</p>
      )}
      {predicted != null && (
        <p className="mt-2 text-sm">
          Predicted for you: <span className="font-serif text-primary text-lg">{predicted.toFixed(1)}</span>
          <span className="text-primary">★</span>
        </p>
      )}
      <ConfidenceMeter score={c.score} reasons={c.reasons} />
      <div className="mt-3">
        <p className="text-xs text-muted-foreground mb-1">Rate it (one tap)</p>
        <StarTap value={stars} onChange={(s) => { if (s != null) { setStars(s); onRate(s); } }} />
        {stars != null && <p className="mt-1 text-[11px] text-primary">Saved {stars}★</p>}
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
      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
      : "bg-muted text-muted-foreground";
  const bar =
    score >= 0.85 ? "bg-primary" : score >= 0.6 ? "bg-amber-500" : "bg-muted-foreground/60";
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${tone}`}>
          {label} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-border overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {reasons.length > 0 && (
        <details className="mt-2 text-[11px] text-muted-foreground">
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
    status === "diff" ? "text-amber-600 dark:text-amber-400" :
    "text-muted-foreground";
  const icon = status === "match" ? "✓" : status === "diff" ? "≠" : "·";
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
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
    <li className="rounded-md border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">#{rank}</span>
            <p className="text-sm font-medium truncate">{c.name}</p>
          </div>
          {c.tasting_note && (
            <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-2">"{c.tasting_note}"</p>
          )}
        </div>
        {predicted != null && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">For you</p>
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
            className="text-[11px] rounded-md bg-primary text-primary-foreground px-2.5 py-1 font-medium"
          >
            That's it · 5★
          </button>
        </div>
        <div className="mt-1.5">
          <StarTap value={stars} onChange={(s: number | null) => { if (s != null) { setStars(s); onRate(s); } }} />
          {stars != null && <p className="mt-1 text-[11px] text-primary">Saved {stars}★</p>}
        </div>
      </div>
    </li>
  );
}


