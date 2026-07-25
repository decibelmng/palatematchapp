import { Share2 } from "lucide-react";
import { toast } from "sonner";

export function ShareProfileButton({ username, displayName }: { username: string; displayName?: string | null }) {
  const share = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/u/${username}`;
    const title = displayName ? `${displayName} on Palate Match` : "Palate Match profile";
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await (navigator as Navigator & { share: (d: { title: string; url: string }) => Promise<void> })
          .share({ title, url });
        return;
      }
    } catch {
      // fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error(url);
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary/40"
    >
      <Share2 className="h-3.5 w-3.5" />
      Share profile
    </button>
  );
}
