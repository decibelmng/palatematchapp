import { useEffect, useMemo, useRef, useState } from "react";
import type { FullBrief } from "@/lib/sommelier-brief";

type Props = {
  brief: FullBrief;
};

/**
 * "For your sommelier" — the deterministic narrative rendered as a
 * copyable / shareable card. Tapping the text opens an editable textarea
 * (session-only edits; regenerated fresh next open).
 */
export function SommelierBriefCard({ brief }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(brief.text);
  const [status, setStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When the underlying brief regenerates (palate_version bump), reset the
  // draft — the data is the source of truth, not saved prose.
  useEffect(() => {
    if (!editing) setDraft(brief.text);
  }, [brief.text, editing]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 2200);
    return () => clearTimeout(t);
  }, [status]);

  const outText = editing ? draft : brief.text;
  const canShare = useMemo(() => typeof navigator !== "undefined" && !!navigator.share, []);

  if (!brief.text) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(outText);
      setStatus("Copied.");
    } catch {
      setStatus("Copy failed.");
    }
  };

  const onShare = async () => {
    if (!canShare) return onCopy();
    try {
      await navigator.share({ text: outText });
    } catch {
      /* user cancelled */
    }
  };

  const beginEdit = () => {
    setEditing(true);
    setDraft(brief.text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  return (
    <section
      aria-label="For your sommelier"
      className="mt-6 rounded-[14px] border-[0.5px] border-border bg-card/60 p-4 shadow-[var(--pm-card-shadow)]"
    >
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] uppercase text-muted-foreground"
          style={{ letterSpacing: "0.22em" }}
        >
          For your sommelier
        </p>
        <span className="text-[10px] text-muted-foreground/70">
          {editing ? "editing (session only)" : `${brief.wordCount} words`}
        </span>
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          rows={Math.min(14, Math.max(6, draft.split("\n").length + 2))}
          className="mt-3 w-full rounded-md border-[0.5px] border-border bg-background/60 p-3 text-[13px] leading-relaxed font-serif text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          aria-label="Edit brief"
          className="mt-3 block w-full text-left rounded-md p-3 -m-3 hover:bg-accent/40 transition-colors"
        >
          <div className="font-serif text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">
            {brief.text}
          </div>
        </button>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-full border-[0.5px] border-border bg-background/70 px-3 py-1 text-[11px] uppercase text-foreground hover:bg-accent"
          style={{ letterSpacing: "0.14em" }}
        >
          Copy
        </button>
        {canShare && (
          <button
            type="button"
            onClick={onShare}
            className="rounded-full border-[0.5px] border-primary bg-primary/10 px-3 py-1 text-[11px] uppercase text-foreground hover:bg-primary/20"
            style={{ letterSpacing: "0.14em" }}
          >
            Share
          </button>
        )}
        {editing && (
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(brief.text); }}
            className="text-[11px] uppercase text-muted-foreground hover:text-foreground"
            style={{ letterSpacing: "0.14em" }}
          >
            Discard
          </button>
        )}
        {status && (
          <span className="text-[11px] text-muted-foreground">{status}</span>
        )}
      </div>
    </section>
  );
}
