import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { researchBottle, type ResearchResult, type DuplicateMatch } from "@/lib/add-bottle.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { StarTap } from "@/components/StarTap";
import { WineTypeBadge } from "@/components/WineTypeBadge";

type WineType = "red" | "white" | "sparkling" | "rose" | "dessert";

type Form = {
  producer: string;
  name: string;
  type: WineType;
  region: string;
  country: string;
  grape: string;
  vintage: string;
  price_band: string;
};

const EMPTY: Form = {
  producer: "", name: "", type: "red",
  region: "", country: "", grape: "", vintage: "", price_band: "",
};

type Phase = "form" | "researching" | "duplicate" | "review" | "rate" | "saving";

export function AddBottleDialog({
  open, onClose, initialQuery, initialForm, autoStart,
}: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  initialForm?: Partial<Form>;
  autoStart?: boolean;
}) {
  const session = useSession();
  const qc = useQueryClient();
  const research = useServerFn(researchBottle);

  const [form, setForm] = useState<Form>({ ...EMPTY, name: initialQuery ?? "", ...(initialForm ?? {}) });
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [savedBottleId, setSavedBottleId] = useState<string | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [userNote, setUserNote] = useState("");


  function reset() {
    setForm({ ...EMPTY });
    setPhase("form");
    setError(null);
    setResult(null);
    setSavedBottleId(null);
    setStars(null);
    setUserNote("");
  }

  function close() {
    reset();
    onClose();
    qc.invalidateQueries({ queryKey: ["ratings"] });
  }

  async function runResearch() {
    setError(null);
    if (!form.producer.trim() || !form.name.trim()) {
      setError("Producer and name are required.");
      setPhase("form");
      return;
    }
    setPhase("researching");
    try {
      const r = await research({
        data: {
          producer: form.producer.trim(),
          name: form.name.trim(),
          type: form.type,
          region: form.region.trim() || null,
          country: form.country.trim() || null,
          grape: form.grape.trim() || null,
          vintage: form.vintage.trim() ? parseInt(form.vintage, 10) : null,
          price_band: form.price_band.trim() || null,
        },
      });
      setResult(r);
      if (r.duplicates.length > 0 && r.duplicates[0].score >= 0.8) {
        setPhase("duplicate");
      } else {
        setPhase("review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
      setPhase("form");
    }
  }

  function onResearch(e: React.FormEvent) {
    e.preventDefault();
    void runResearch();
  }

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open) { autoStartedRef.current = false; return; }
    if (autoStart && !autoStartedRef.current && phase === "form") {
      autoStartedRef.current = true;
      void runResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);


  async function rateExisting(d: DuplicateMatch) {
    if (!session) return;
    setPhase("saving");
    try {
      await supabase.from("ratings").upsert({
        user_id: session.user.id, bottle_id: d.id, stars: 5,
      }, { onConflict: "user_id,bottle_id" });
      qc.invalidateQueries({ queryKey: ["ratings"] });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rating failed.");
      setPhase("duplicate");
    }
  }

  async function saveBottle() {
    if (!session || !result) return;
    setPhase("saving");
    setError(null);
    try {
      const { fp, ax_sweet, tasting_note } = result;
      const insert = {
        producer: form.producer.trim(),
        name: form.name.trim(),
        type: form.type,
        region: form.region.trim() || null,
        country: form.country.trim() || null,
        grape: form.grape.trim() || null,
        vintage: form.vintage.trim() ? parseInt(form.vintage, 10) : null,
        price_band: form.price_band.trim() || null,
        fp_fresh: fp.fresh, fp_acid: fp.acid, fp_tannin: fp.tannin,
        fp_fruit_dark: fp.fruit_dark, fp_ripe: fp.ripe, fp_oak: fp.oak,
        fp_body: fp.body, fp_savory: fp.savory,
        ax_body: fp.body, ax_fruit_char: fp.fruit_dark,
        ax_tannin: fp.tannin, ax_acidity: fp.acid, ax_sweet,
        tasting_note,
        source: "user-added; LLM-researched fingerprint",
        added_by: session.user.id,
      };
      const { data: row, error: insErr } = await supabase
        .from("bottles").insert(insert).select("id").single();
      if (insErr) throw insErr;
      setSavedBottleId(row.id);
      setUserNote("");
      setPhase("rate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
      setPhase("review");
    }
  }

  async function commitRating(s: number) {
    if (!session || !savedBottleId) return;
    setStars(s);
    await supabase.from("ratings").upsert({
      user_id: session.user.id, bottle_id: savedBottleId, stars: s,
    }, { onConflict: "user_id,bottle_id" });
    qc.invalidateQueries({ queryKey: ["ratings"] });
  }

  async function saveUserNote() {
    if (!savedBottleId) return;
    const trimmed = userNote.trim();
    if (!trimmed) { close(); return; }
    await supabase
      .from("bottles")
      .update({ tasting_note: trimmed, source: "user-added; user tasting note" })
      .eq("id", savedBottleId);
    close();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-xl">Add a bottle</h2>
          <button onClick={close} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {phase === "form" && (
          <form onSubmit={onResearch} className="space-y-3">
            <Field label="Producer *" value={form.producer} onChange={(v) => setForm({ ...form, producer: v })} placeholder="e.g. Le Macchiole" />
            <Field label="Wine / cuvée *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Le Colonne Bolgheri" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Type
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as WineType })}
                  className="mt-1 w-full bg-input border border-border rounded-md px-2 py-2 text-sm"
                >
                  <option value="red">Red</option>
                  <option value="white">White</option>
                  <option value="rose">Rosé</option>
                  <option value="sparkling">Sparkling</option>
                  <option value="dessert">Dessert</option>
                </select>
              </label>
              <Field label="Vintage" value={form.vintage} onChange={(v) => setForm({ ...form, vintage: v.replace(/[^0-9]/g, "").slice(0, 4) })} placeholder="2022" />
            </div>
            <Field label="Region" value={form.region} onChange={(v) => setForm({ ...form, region: v })} placeholder="Toscana, Bolgheri" />
            <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} placeholder="Italy" />
            <Field label="Grape(s)" value={form.grape} onChange={(v) => setForm({ ...form, grape: v })} placeholder="Merlot, Petit Verdot, Cab Franc" />
            <Field label="Price band (optional)" value={form.price_band} onChange={(v) => setForm({ ...form, price_band: v })} placeholder="$$, $$$" />

            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-[11px] text-muted-foreground">
              The app will research the wine's style and produce an estimated fingerprint on the same calibrated scale as the catalog.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={close} className="flex-1 rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="submit" className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
                Research & continue
              </button>
            </div>
          </form>
        )}

        {phase === "researching" && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <div className="inline-block animate-spin rounded-full border-2 border-border border-t-primary h-6 w-6 mb-3" />
            <p>Researching {form.producer} {form.name}…</p>
          </div>
        )}

        {phase === "duplicate" && result && (
          <div className="space-y-3">
            <p className="text-sm">This looks a lot like wine{result.duplicates.length > 1 ? "s" : ""} already in the catalog:</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {result.duplicates.slice(0, 4).map((d) => (
                <li key={d.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[d.producer, d.region, d.vintage].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">match {(d.score * 100).toFixed(0)}%</p>
                  </div>
                  <button
                    onClick={() => rateExisting(d)}
                    className="shrink-0 text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 font-medium"
                  >
                    Rate this 5★
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-2">
              <button onClick={close} className="flex-1 rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button
                onClick={() => setPhase("review")}
                className="flex-1 rounded-md border border-primary text-primary px-3 py-2 text-sm font-medium"
              >
                None of these — add new
              </button>
            </div>
          </div>
        )}

        {phase === "review" && result && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{form.producer} — {form.name}</p>
              <p className="text-xs text-muted-foreground">
                {[form.vintage, form.region || form.country, form.grape].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-1"><WineTypeBadge type={form.type} /></div>
            </div>

            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Researched estimate — not a verified tasting note
              </p>
              <p className="text-sm leading-snug italic">"{result.tasting_note}"</p>
              <FpGrid fp={result.fp} sweet={result.ax_sweet} />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setPhase("form")} className="flex-1 rounded-md border border-border px-3 py-2 text-sm">Back</button>
              <button onClick={saveBottle} className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
                Save & rate
              </button>
            </div>
          </div>
        )}

        {phase === "saving" && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <div className="inline-block animate-spin rounded-full border-2 border-border border-t-primary h-6 w-6 mb-3" />
            <p>Saving…</p>
          </div>
        )}

        {phase === "rate" && result && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{form.producer} — {form.name}</p>
            <div>
              <p className="text-xs text-muted-foreground mb-2">How would you rate it?</p>
              <StarTap value={stars} onChange={(s) => s != null && commitRating(s)} />
              {stars != null && <p className="text-[11px] text-primary mt-2">Saved ★ {stars}</p>}
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Replace or append the researched note (optional)
              </p>
              <p className="text-[11px] italic text-muted-foreground mb-2">
                Current: "{result.tasting_note}"
              </p>
              <textarea
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                placeholder="Your own tasting impression…"
                rows={3}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={close} className="flex-1 rounded-md border border-border px-3 py-2 text-sm">
                Done
              </button>
              <button
                onClick={saveUserNote}
                disabled={!userNote.trim()}
                className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Save my note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function FpGrid({ fp, sweet }: { fp: Record<string, number>; sweet: number }) {
  const rows: [string, number][] = [
    ["Body", fp.body], ["Tannin", fp.tannin], ["Acid", fp.acid],
    ["Oak", fp.oak], ["Ripe", fp.ripe], ["Savory", fp.savory],
    ["Dark fruit", fp.fruit_dark], ["Fresh", fp.fresh], ["Sweet", sweet],
  ];
  return (
    <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 text-muted-foreground">{k}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${Math.round(v * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
