import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useAcceptedFriends, useMyProfile, useRecentGroups, useSaveRecentGroup } from "@/hooks/use-friends";

type Props = {
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onSet: (ids: string[]) => void;
};

/** "Who's drinking?" chip row for Matches and Scan.
 *  - Session-only selection (state managed by parent).
 *  - Recent groups shortcut persisted per user in localStorage.
 *  - Cap of 6 friends enforced by the parent hook.
 */
export function DrinkingGroupSelector({ selectedIds, onToggle, onClear, onSet }: Props) {
  const { data: friends = [], isLoading } = useAcceptedFriends();
  const { data: me } = useMyProfile();
  const recent = useRecentGroups();
  const saveRecent = useSaveRecentGroup();

  const friendById = useMemo(() => {
    const m = new Map<string, typeof friends[number]>();
    for (const f of friends) m.set(f.other.user_id, f);
    return m;
  }, [friends]);

  const groupLabel = useMemo(() => {
    if (selectedIds.length === 0) return "You";
    const names = selectedIds
      .map((id) => friendById.get(id)?.other.display_name || friendById.get(id)?.other.username || "friend")
      .filter(Boolean);
    return ["You", ...names].join(" + ");
  }, [selectedIds, friendById]);

  const persistRecent = () => {
    if (selectedIds.length > 0) saveRecent.mutate({ ids: selectedIds, label: groupLabel });
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Who's drinking?</div>
        {selectedIds.length > 0 && (
          <button
            onClick={() => { persistRecent(); onClear(); }}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Just me
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* Me chip — always on, non-toggleable */}
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs bg-primary text-primary-foreground">
          <span aria-hidden>●</span>
          {me?.display_name || me?.username || "You"}
        </span>

        {isLoading ? (
          <span className="text-xs text-muted-foreground self-center">loading friends…</span>
        ) : friends.length === 0 ? (
          <Link
            to="/friends"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            + Invite a friend
          </Link>
        ) : (
          friends.map((f) => {
            const id = f.other.user_id;
            const on = selectedIds.includes(id);
            const disabled = !on && selectedIds.length >= 6;
            const name = f.other.display_name || f.other.username;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border transition-colors ${
                  on
                    ? "bg-primary text-primary-foreground border-primary"
                    : disabled
                    ? "border-border text-muted-foreground/50 cursor-not-allowed"
                    : "border-border bg-background hover:bg-accent"
                }`}
              >
                <span aria-hidden>{on ? "●" : "○"}</span>
                {name}
              </button>
            );
          })
        )}
      </div>

      {recent.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recent groups</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((g) => {
              const validIds = g.ids.filter((id) => friendById.has(id));
              if (validIds.length === 0) return null;
              return (
                <button
                  key={g.usedAt}
                  type="button"
                  onClick={() => onSet(validIds)}
                  className="rounded-full px-2.5 py-1 text-[11px] border border-border bg-background hover:bg-accent"
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Ranking bottles by the group's worst-case predicted stars (min); tiebreak by average.
        </div>
      )}
    </div>
  );
}
