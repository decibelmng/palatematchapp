import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { UserPlus, UserCheck, Clock } from "lucide-react";
import { followUser, unfollowUser } from "@/lib/profile.functions";

export function FollowButton({
  followeeId,
  status,
  onChange,
}: {
  followeeId: string;
  status: "none" | "pending" | "accepted" | string;
  onChange?: () => void;
}) {
  const qc = useQueryClient();
  const follow = useMutation({
    mutationFn: () => followUser({ data: { followee_id: followeeId } }),
    onSuccess: (r) => {
      const s = (r as { status?: string } | null)?.status;
      toast.success(s === "accepted" ? "Following" : "Request sent");
      qc.invalidateQueries({ queryKey: ["public-profile"] });
      onChange?.();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  const unfollow = useMutation({
    mutationFn: () => unfollowUser({ data: { followee_id: followeeId } }),
    onSuccess: () => {
      toast.success("Unfollowed");
      qc.invalidateQueries({ queryKey: ["public-profile"] });
      onChange?.();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  const pending = follow.isPending || unfollow.isPending;

  if (status === "accepted") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => unfollow.mutate()}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-destructive/60 hover:text-destructive"
      >
        <UserCheck className="h-3.5 w-3.5" /> Following
      </button>
    );
  }
  if (status === "pending") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => unfollow.mutate()}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Clock className="h-3.5 w-3.5" /> Requested
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => follow.mutate()}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90"
    >
      <UserPlus className="h-3.5 w-3.5" /> Follow
    </button>
  );
}
