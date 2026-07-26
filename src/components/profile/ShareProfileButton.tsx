import { Share2 } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createOrGetInvite } from "@/lib/invites.functions";

export function ShareProfileButton({ username, displayName }: { username: string; displayName?: string | null }) {
  const invite = useServerFn(createOrGetInvite);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (typeof window === "undefined") return;
    setBusy(true);
    try {
      const { token } = await invite({ data: { kind: "friend" } });
      const url = `${window.location.origin}/i/${token}`;
      const title = displayName ? `${displayName} on Palate Match` : "Palate Match invite";
      try {
        if (typeof navigator !== "undefined" && "share" in navigator) {
          await (navigator as Navigator & { share: (d: { title: string; url: string }) => Promise<void> })
            .share({ title, url });
          return;
        }
      } catch { /* fall through */ }
      try { await navigator.clipboard.writeText(url); toast.success("Invite link copied"); }
      catch { toast.error(url); }
    } catch (e) {
      toast.error((e as Error).message ?? "Couldn't create invite");
    } finally {
      setBusy(false);
    }
    void username;
  };
  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary/40 disabled:opacity-50"
    >
      <Share2 className="h-3.5 w-3.5" />
      {busy ? "…" : "Share profile"}
    </button>
  );
}
