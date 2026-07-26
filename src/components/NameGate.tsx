// Blocks the app until the signed-in user has a non-empty display_name.
// Handles both new signups (before/after this rule shipped) and legacy users.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMyProfile, useUpdateProfile } from "@/hooks/use-friends";

const PENDING_KEY = "pm.pendingDisplayName";

export function NameGate({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useMyProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(PENDING_KEY)?.trim() ?? ""; } catch { return ""; }
  });

  const current = (profile as { display_name?: string | null } | null | undefined)?.display_name ?? null;
  const missing = !isLoading && profile !== undefined && !(current && current.trim().length > 0);

  // Auto-apply a pending name captured at signup, without requiring extra input.
  useEffect(() => {
    if (!missing || update.isPending) return;
    let pending = "";
    try { pending = localStorage.getItem(PENDING_KEY)?.trim() ?? ""; } catch { /* ignore */ }
    if (pending.length === 0) return;
    update.mutate({ display_name: pending.slice(0, 60) }, {
      onSuccess: () => { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } },
    });
  }, [missing, update]);

  // Wait for profile — don't flash the prompt over children.
  if (isLoading || profile === undefined) return <>{children}</>;
  if (!missing) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) { toast.error("Please enter a name."); return; }
    if (trimmed.length > 60) { toast.error("Keep it under 60 characters."); return; }
    try {
      await update.mutateAsync({ display_name: trimmed });
    } catch (err) {
      toast.error((err as Error).message ?? "Couldn't save name");
    }
  };

  return (
    <>
      {/* Keep the app in the tree so it hydrates behind the modal, but block interaction. */}
      <div aria-hidden className="pointer-events-none opacity-40">{children}</div>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-gate-title"
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      >
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4"
        >
          <div>
            <h2 id="name-gate-title" className="font-serif text-xl">What should we call you?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Your name shows on your palate, ratings, and to friends. You can change it later in your profile.
            </p>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            required
            minLength={1}
            maxLength={60}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={update.isPending || name.trim().length === 0}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </>
  );
}
