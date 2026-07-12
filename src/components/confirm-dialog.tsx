import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  /** Bolded wine name rendered before the description text (optional). */
  wineName?: string;
  /** Body copy. Newlines are preserved. */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style confirm button as destructive. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

let enqueue: ((p: Pending) => void) | null = null;

/** Imperative styled confirm. Returns a promise resolving true=confirm, false=cancel.
 *  Falls back to window.confirm if the host isn't mounted (SSR / tests). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (enqueue) {
      enqueue({ ...opts, resolve });
      return;
    }
    if (typeof window !== "undefined") {
      const body = opts.wineName ? `${opts.wineName}\n\n${opts.description}` : opts.description;
      resolve(window.confirm(`${opts.title}\n\n${body}`));
      return;
    }
    resolve(true);
  });
}

export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const current = queue[0] ?? null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    enqueue = (p) => setQueue((q) => [...q, p]);
    return () => { enqueue = null; };
  }, []);

  useEffect(() => { setOpen(!!current); }, [current]);

  function finish(value: boolean) {
    if (!current) return;
    current.resolve(value);
    setOpen(false);
    // Small delay lets the exit animation play before mounting the next entry.
    setTimeout(() => setQueue((q) => q.slice(1)), 150);
  }

  const lines: ReactNode = current
    ? current.description.split("\n").map((line, i) => (
        <span key={i} className="block">
          {line || "\u00A0"}
        </span>
      ))
    : null;

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) finish(false); }}>
      <AlertDialogContent>
        {current && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{current.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  {current.wineName && (
                    <p className="font-semibold text-foreground">{current.wineName}</p>
                  )}
                  <div>{lines}</div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => finish(false)}>
                {current.cancelLabel ?? "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => finish(true)}
                className={cn(
                  current.destructive &&
                    buttonVariants({ variant: "destructive" }),
                )}
              >
                {current.confirmLabel ?? "Continue"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
