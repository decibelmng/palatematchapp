import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { redeemInvite } from "@/lib/invites.functions";
import { readPendingInvite, clearPendingInvite } from "@/lib/pending-invite";
import { useSession } from "./use-session";

/** Redeem a stashed invite the first time the user signs in.
 *  Runs once per app mount when a session becomes available and a token exists.
 */
export function useAutoRedeemInvite() {
  const session = useSession();
  const redeem = useServerFn(redeemInvite);

  useEffect(() => {
    if (!session) return;
    const token = readPendingInvite();
    if (!token) return;
    // Guard against the invite-landing route redeeming itself twice.
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/i/")) return;
    (async () => {
      try {
        await redeem({ data: { token } });
        clearPendingInvite();
        toast.success("Connected — added by an invite");
      } catch {
        // Silent — the landing page will show a real error if the user revisits.
        clearPendingInvite();
      }
    })();
  }, [session, redeem]);
}
