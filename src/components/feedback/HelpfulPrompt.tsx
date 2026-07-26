import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { submitFeedback } from "@/lib/feedback.functions";
import { APP_VERSION } from "@/lib/app-version";

// Frequency cap: one show per prompt_key per session (localStorage-persisted with rolling window).
// N sessions = 3 days per prompt_key by default.
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

function storageKey(promptKey: string) { return `pm.prompt.${promptKey}`; }

function shouldShow(promptKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(storageKey(promptKey));
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { at: number; state: "shown" | "answered" | "dismissed" };
    return Date.now() - parsed.at > COOLDOWN_MS;
  } catch { return true; }
}

function record(promptKey: string, state: "answered" | "dismissed") {
  try {
    window.localStorage.setItem(storageKey(promptKey), JSON.stringify({ at: Date.now(), state }));
  } catch { /* ignore */ }
}

/**
 * Inline, dismissible one-tap 👍/👎 prompt. Non-blocking.
 * `promptKey` identifies the prompt for frequency capping + admin analytics.
 * `context` is auto-attached to the row for triage.
 */
export function HelpfulPrompt({
  promptKey,
  question,
  context,
  followUpPlaceholder = "What was off? (optional)",
}: {
  promptKey: string;
  question: string;
  context?: Record<string, unknown>;
  followUpPlaceholder?: string;
}) {
  const submit = useServerFn(submitFeedback);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);
  const [answered, setAnswered] = useState<"up" | "down" | null>(null);
  const [note, setNote] = useState("");
  const [followUpSent, setFollowUpSent] = useState(false);

  useEffect(() => {
    setVisible(shouldShow(promptKey));
  }, [promptKey]);

  if (!visible) return null;

  const sendVote = async (rating: "up" | "down") => {
    setAnswered(rating);
    record(promptKey, "answered");
    try {
      await submit({
        data: {
          category: "helpful_prompt",
          source: "prompt",
          prompt_key: promptKey,
          rating,
          screen: pathname,
          app_version: APP_VERSION,
          context: context ?? null,
        },
      });
    } catch { /* silent — prompt should never surface an error */ }
  };

  const sendFollowUp = async () => {
    if (!note.trim() || !answered) return;
    setFollowUpSent(true);
    try {
      await submit({
        data: {
          category: "helpful_prompt",
          source: "prompt",
          prompt_key: `${promptKey}.note`,
          rating: answered,
          screen: pathname,
          app_version: APP_VERSION,
          message: note.trim(),
          context: context ?? null,
        },
      });
    } catch { /* silent */ }
  };

  const dismiss = () => {
    record(promptKey, "dismissed");
    setVisible(false);
  };

  return (
    <aside
      aria-label={question}
      className="rounded-[12px] border border-border/70 bg-card px-3 py-2.5 flex items-start gap-2"
    >
      <div className="flex-1 min-w-0">
        {!answered && (
          <div className="flex items-center gap-2">
            <span className="text-meta text-foreground">{question}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => sendVote("up")}
                aria-label="Yes, helpful"
                className="h-8 w-8 rounded-md border border-border hover:border-primary/60 hover:text-primary flex items-center justify-center"
              >
                <ThumbsUp size={14} />
              </button>
              <button
                onClick={() => sendVote("down")}
                aria-label="No, not helpful"
                className="h-8 w-8 rounded-md border border-border hover:border-destructive/60 hover:text-destructive flex items-center justify-center"
              >
                <ThumbsDown size={14} />
              </button>
            </div>
          </div>
        )}

        {answered === "up" && (
          <p className="text-meta text-muted-foreground">Thanks — noted.</p>
        )}

        {answered === "down" && !followUpSent && (
          <div className="space-y-1.5">
            <p className="text-meta text-muted-foreground">Thanks — anything specific?</p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={followUpPlaceholder}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              />
              <button
                onClick={sendFollowUp}
                disabled={!note.trim()}
                className="rounded-md bg-primary text-primary-foreground px-2.5 py-1.5 text-xs disabled:opacity-50"
              >
                Send
              </button>
              <button
                onClick={() => setFollowUpSent(true)}
                className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {answered === "down" && followUpSent && (
          <p className="text-meta text-muted-foreground">Thanks — sent.</p>
        )}
      </div>

      {!answered && (
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-muted-foreground hover:text-foreground p-0.5"
        >
          <X size={13} />
        </button>
      )}
    </aside>
  );
}
