import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { Eye, EyeOff, Users } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateMyProfile } from "@/lib/friends.functions";

type Visibility = "private" | "followers" | "public";

const OPTS: Array<{ value: Visibility; label: string; hint: string; Icon: typeof Eye }> = [
  { value: "private",   label: "Private",   hint: "Only you can see your ratings + activity", Icon: EyeOff },
  { value: "followers", label: "Followers", hint: "Only accepted followers see the full profile", Icon: Users },
  { value: "public",    label: "Public",    hint: "Anyone with the link can see the full profile", Icon: Eye },
];

/**
 * VisibilityControl — persisted profile visibility.
 * Source of truth is `current` (from getMyProfile). We do not hold a local
 * duplicate: writing goes through the server fn, cache is patched optimistically,
 * and the profile query is invalidated to refetch the stored value.
 */
export function VisibilityControl({ current }: { current: Visibility }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Visibility) => updateMyProfile({ data: { visibility: v } }),
    onMutate: async (v: Visibility) => {
      // Optimistic: patch every ["my-profile", ...] cache entry so the UI
      // reflects the new value immediately and survives navigation.
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      qc.getQueriesData({ queryKey: ["my-profile"] }).forEach(([key, data]) => {
        snapshots.push([key, data]);
        if (data && typeof data === "object") {
          qc.setQueryData(key, { ...(data as object), visibility: v });
        }
      });
      return { snapshots };
    },
    onError: (e: Error, _v, ctx) => {
      // Roll back optimistic patch.
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(friendlyError(e, "Failed to update visibility"));
    },
    onSuccess: () => {
      toast.success("Visibility updated");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
  });

  const value: Visibility = m.isPending && m.variables ? (m.variables as Visibility) : current;

  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <p className="text-meta uppercase text-muted-foreground" style={{  }}>
        Profile visibility
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {OPTS.map(({ value: v, label, Icon }) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              disabled={m.isPending}
              onClick={() => m.mutate(v)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/40"}`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-meta text-muted-foreground">
        {OPTS.find((o) => o.value === value)?.hint}
      </p>
    </div>
  );
}
