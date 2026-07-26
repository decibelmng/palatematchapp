import { Share2 } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createOrGetInvite } from "@/lib/invites.functions";
import { displayNameFor } from "@/lib/user-display";

/** Single share path.
 *  - Creates (or reuses) the user's friend-invite token.
 *  - Opens the OS share sheet (navigator.share) with identity-forward text + link.
 *  - Falls back to clipboard when the share API isn't available.
 *  - Recipients land on /i/{token} which renders a rich OG preview server-side
 *    and auto-connects them to the sharer after they sign in.
 */
export function ShareProfileButton({
  username,
  displayName,
  palateCodeRed,
  palateCodeWhite,
  variant = "outline",
  label,
}: {
  username: string;
  displayName?: string | null;
  palateCodeRed?: string | null;
  palateCodeWhite?: string | null;
  variant?: "outline" | "primary";
  label?: string;
}) {
  const invite = useServerFn(createOrGetInvite);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (typeof window === "undefined") return;
    setBusy(true);
    try {
      const { token } = await invite({ data: { kind: "friend" } });
      const url = `${window.location.origin}/i/${token}`;
      const me = displayNameFor({ display_name: displayName ?? null, username });
      const codePart = palateCodeRed
        ? `I'm a ${palateCodeRed} palate on Palate Match`
        : `I'm on Palate Match`;
      const text = `${codePart} — what's your wine palate?`;
      const title = `${me} on Palate Match`;
      try {
        if (typeof navigator !== "undefined" && "share" in navigator) {
          await (navigator as Navigator & { share: (d: { title: string; text?: string; url: string }) => Promise<void> })
            .share({ title, text, url });
          return;
        }
      } catch { /* user cancelled or unsupported — fall through */ }
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success("Invite link copied");
      } catch { toast.error(url); }
    } catch (e) {
      toast.error((e as Error).message ?? "Couldn't create invite");
    } finally {
      setBusy(false);
    }
    void palateCodeWhite;
  };

  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground border-primary hover:opacity-90"
      : "bg-card text-foreground border-border hover:border-primary/40";

  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50 ${styles}`}
    >
      <Share2 className="h-3.5 w-3.5" />
      {busy ? "…" : label ?? "Share profile"}
    </button>
  );
}
