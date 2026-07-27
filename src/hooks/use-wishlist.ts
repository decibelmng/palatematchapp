import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { addToWishlist, removeFromWishlist, listWishlist } from "@/lib/wishlist.functions";
import { useSession } from "./use-session";

export function useWishlist() {
  const session = useSession();
  const listFn = useServerFn(listWishlist);
  return useQuery({
    queryKey: ["wishlist", session?.user.id ?? null],
    enabled: !!session,
    queryFn: () => listFn(),
    staleTime: 15_000,
  });
}

/** Set of bottle_ids in the viewer's wishlist for O(1) lookups in feed cards. */
export function useWishlistIds(): Set<string> {
  const { data } = useWishlist();
  return new Set((data ?? []).map((w) => w.bottle_id));
}

export function useAddToWishlist() {
  const qc = useQueryClient();
  const addFn = useServerFn(addToWishlist);
  return useMutation({
    mutationFn: (args: { bottle_id: string; source_context?: "feed" | "scan" | "search" | "wine" | "other" }) =>
      addFn({ data: { bottle_id: args.bottle_id, source_context: args.source_context ?? "other" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wishlist"] });
      toast.success("Saved to your wishlist");
    },
    onError: (e) => toast.error(friendlyError(e, "Couldn't save.")),
  });
}

export function useRemoveFromWishlist() {
  const qc = useQueryClient();
  const removeFn = useServerFn(removeFromWishlist);
  return useMutation({
    mutationFn: (args: { bottle_id: string }) => removeFn({ data: { bottle_id: args.bottle_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Couldn't remove.")),
  });
}
