import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { FeedbackDialog } from "./FeedbackDialog";

/** Persistent, unobtrusive feedback entry. Reachable in one tap from anywhere it's mounted. */
export function FeedbackButton({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const [open, setOpen] = useState(false);
  if (variant === "inline") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40"
        >
          <MessageSquare size={13} />
          Send feedback
        </button>
        <FeedbackDialog open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
        className="fixed bottom-24 right-3 z-40 h-10 w-10 rounded-full border border-border bg-card/95 backdrop-blur shadow-lg text-muted-foreground hover:text-primary hover:border-primary/50 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <MessageSquare size={16} />
      </button>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
