import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { X, Bug, HelpCircle, Lightbulb, Heart, MessageSquare, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { submitFeedback, CATEGORIES, type FeedbackCategory } from "@/lib/feedback.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { useRatingsCount, UNLOCK_THRESHOLD } from "@/components/UnlockMeter";
import { APP_VERSION } from "@/lib/app-version";

const CATEGORY_META: Record<Exclude<FeedbackCategory, "helpful_prompt">, { label: string; Icon: typeof Bug }> = {
  bug: { label: "Bug", Icon: Bug },
  confusing: { label: "Confusing", Icon: HelpCircle },
  idea: { label: "Idea", Icon: Lightbulb },
  love: { label: "Love it", Icon: Heart },
  other: { label: "Other", Icon: MessageSquare },
};

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const submit = useServerFn(submitFeedback);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useSession();
  const ratingsCount = useRatingsCount();

  const [category, setCategory] = useState<Exclude<FeedbackCategory, "helpful_prompt"> | null>(null);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setCategory(null);
      setMessage("");
      setFile(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const send = async () => {
    if (!category) { toast.error("Pick a category first"); return; }
    setBusy(true);
    try {
      let screenshot_path: string | null = null;
      if (file && session?.user?.id) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("feedback-screenshots")
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;
        screenshot_path = path;
      }
      const ctx = {
        ratings_count: ratingsCount,
        calibration_pct: Math.min(100, Math.round((ratingsCount / UNLOCK_THRESHOLD) * 100)),
      };
      await submit({
        data: {
          category,
          message: message.trim() || null,
          screen: pathname,
          screenshot_path,
          app_version: APP_VERSION,
          context: ctx,
          source: "button",
        },
      });
      toast.success("Thanks — we read every one.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message ?? "Couldn't send feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-3"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="feedback-title" className="font-serif text-lg">Send feedback</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-accent/60">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-1">
          <p className="text-[12px] text-muted-foreground leading-snug">
            <span className="text-primary font-medium">Palate Match is in beta</span> and you have
            pre-release access — thank you for helping shape it. Tell us anything: what's
            confusing, what's broken, what you'd love.
          </p>
        </div>

        <div className="px-4 pt-3">
          <div className="grid grid-cols-5 gap-1.5">
            {CATEGORIES.map((c) => {
              const { label, Icon } = CATEGORY_META[c];
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pt-3">
          <label htmlFor="fb-msg" className="sr-only">Tell us more</label>
          <textarea
            id="fb-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us more — optional"
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
          />
        </div>

        <div className="px-4 pt-2 flex items-center justify-between">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer">
            <Camera size={14} />
            {file ? <span className="truncate max-w-[180px]">{file.name}</span> : "Attach screenshot"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-[11px] text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          )}
        </div>

        <div className="px-4 py-3 mt-2 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || !category}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
