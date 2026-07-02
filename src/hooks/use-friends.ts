import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listFriendships,
  searchUsers,
  sendFriendRequest,
  respondToFriendship,
  updateMyProfile,
  getMyProfile,
  saveRecentGroupFn,
  type FriendshipRow,
  type SearchUserHit,
  type RecentGroup,
} from "@/lib/friends.functions";
import { groupPredict, type GroupScored } from "@/lib/group.functions";
import type { BottleFp, WineType, FpKey } from "@/lib/recommender";
import { useSession } from "./use-session";

// ---------- Friendships ----------

export function useFriendships() {
  const session = useSession();
  return useQuery({
    queryKey: ["friendships", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async (): Promise<FriendshipRow[]> => {
      const rows = await listFriendships();
      return rows;
    },
    staleTime: 30_000,
  });
}

export function useAcceptedFriends() {
  const q = useFriendships();
  const list = (q.data ?? []).filter((f) => f.status === "accepted");
  return { ...q, data: list };
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ["user-search", query],
    enabled: query.trim().length >= 2,
    queryFn: async (): Promise<SearchUserHit[]> => searchUsers({ data: { q: query.trim() } }),
    staleTime: 15_000,
  });
}

export function useMyProfile() {
  const session = useSession();
  return useQuery({
    queryKey: ["my-profile", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async () => getMyProfile(),
    staleTime: 60_000,
  });
}

export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { user_id?: string; username?: string }) =>
      sendFriendRequest({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["friendships"] });
      qc.invalidateQueries({ queryKey: ["user-search"] });
    },
  });
}

export function useRespondFriendship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; action: "accept" | "decline" | "cancel" | "remove" }) =>
      respondToFriendship({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["friendships"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { username?: string; display_name?: string }) =>
      updateMyProfile({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["friendships"] });
    },
  });
}

// ---------- "Who's drinking?" group selection ----------
// Session-state only (per user, per tab). Recent groups persist on the profile.

export type { RecentGroup };

export function useRecentGroups() {
  const { data: profile } = useMyProfile();
  const raw = (profile as { recent_groups?: unknown } | undefined)?.recent_groups;
  const list: RecentGroup[] = Array.isArray(raw)
    ? (raw as RecentGroup[]).filter(
        (g) => g && Array.isArray(g.ids) && typeof g.label === "string" && typeof g.usedAt === "number",
      )
    : [];
  return [...list].sort((a, b) => b.usedAt - a.usedAt).slice(0, 5);
}

export function useSaveRecentGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { ids: string[]; label: string }) => saveRecentGroupFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-profile"] }),
  });
}

export function useGroupSelection() {
  // friend ids (excluding self). Session-only.
  const [ids, setIds] = useState<string[]>([]);
  const toggle = (id: string) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 6 ? prev : [...prev, id]));
  const clear = () => setIds([]);
  const set = (next: string[]) => setIds(next.slice(0, 6));
  return { friendIds: ids, toggle, clear, set };
}

// ---------- Group prediction ----------

export type GroupCandidateInput = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  type: WineType;
  fp: Record<FpKey, number>;
};

export function useGroupPredict(friendIds: string[], candidates: GroupCandidateInput[]) {
  const key = [friendIds.slice().sort().join(","), candidates.map((c) => c.id).sort().join(",")].join("|");
  return useQuery({
    queryKey: ["group-predict", key],
    enabled: friendIds.length > 0 && candidates.length > 0,
    queryFn: async (): Promise<Map<string, GroupScored>> => {
      const out: GroupScored[] = [];
      // chunk candidates to keep request size sane
      for (let i = 0; i < candidates.length; i += 200) {
        const chunk = candidates.slice(i, i + 200);
        const part = await groupPredict({ data: { friend_ids: friendIds, candidates: chunk } });
        out.push(...part);
      }
      return new Map(out.map((r) => [r.candidate_id, r]));
    },
    staleTime: 30_000,
  });
}

// Ensure we don't over-cache across sign-outs.
export function useResetGroupCacheOnSignOut() {
  const qc = useQueryClient();
  const session = useSession();
  useEffect(() => {
    if (!session) qc.removeQueries({ queryKey: ["group-predict"] });
  }, [session, qc]);
}
