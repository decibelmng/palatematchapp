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
  /** Body copy — supports ReactNode for inline bold names. */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style confirm button as destructive. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

let enqueue: ((p: Pending) => void) | null = null;

/** Imperative styled confirm. Returns a promise resolving true=confirm, false=cancel.
 *  Falls back to true if the host isn't mounted (SSR / tests). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (enqueue) {
      enqueue({ ...opts, resolve });
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
    setTimeout(() => setQueue((q) => q.slice(1)), 150);
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) finish(false); }}>
      <AlertDialogContent>
        {current && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{current.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="text-sm text-muted-foreground whitespace-pre-line">
                  {current.description}
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
                  current.destructive && buttonVariants({ variant: "destructive" }),
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

