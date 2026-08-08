import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyActivity,
  getSharedLists,
  setRatingPhoto,
  listSavedRestaurants,
  toggleSavedRestaurant,
} from "@/lib/feed-extras.functions";
import { useSession } from "./use-session";

export function useMyActivity(limit = 20) {
  const session = useSession();
  const fn = useServerFn(getMyActivity);
  return useQuery({
    queryKey: ["feed", "mine", session?.user.id ?? null, limit],
    enabled: !!session,
    queryFn: () => fn({ data: { limit } }),
    staleTime: 30_000,
  });
}

export function useSharedLists(limit = 10) {
  const session = useSession();
  const fn = useServerFn(getSharedLists);
  return useQuery({
    queryKey: ["feed", "shared-lists", session?.user.id ?? null, limit],
    enabled: !!session,
    queryFn: () => fn({ data: { limit } }),
    staleTime: 60_000,
  });
}

export function useSetRatingPhoto() {
  const qc = useQueryClient();
  const fn = useServerFn(setRatingPhoto);
  return useMutation({
    mutationFn: (v: { rating_id: string; path: string | null; shared?: boolean }) =>
      fn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed", "mine"] }),
  });
}

export function useSavedRestaurants() {
  const session = useSession();
  const fn = useServerFn(listSavedRestaurants);
  return useQuery({
    queryKey: ["saved-restaurants", session?.user.id ?? null],
    enabled: !!session,
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useToggleSavedRestaurant() {
  const qc = useQueryClient();
  const fn = useServerFn(toggleSavedRestaurant);
  return useMutation({
    mutationFn: (v: { restaurant_id: string; saved: boolean }) => fn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-restaurants"] }),
  });
}
