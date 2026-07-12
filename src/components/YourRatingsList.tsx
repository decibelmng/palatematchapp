import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useBottlesByIds, useRatings, useRate, bottleToFp, bottleType, type BottleRow } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { StarDisplay } from "@/components/StarDisplay";
import { CanonAction } from "@/components/CanonAction";
import { NemesisAction } from "@/components/NemesisAction";
import { BenchmarkTierBadges } from "@/components/BenchmarkTierBadge";
import { useMyCanons } from "@/hooks/use-canon";
import { aggregateRated } from "@/lib/cuvee";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type SortKey = "recent" | "high" | "low" | "name";

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

export function YourRatingsList() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles, isLoading } = useBottlesByIds(ratedIds);
  const rate = useRate();
  const [sort, setSort] = useState<SortKey>("recent");
  const session = useSession();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { data: canons } = useMyCanons();

  const bottleById = useMemo(() => {
    const m = new Map<string, BottleRow>();
    for (const b of bottles ?? []) m.set(b.id, b);
    return m;
  }, [bottles]);

  const starsByBottle = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  async function saveNote(bottleId: string) {
    const note = draftNote.trim();
    await supabase
      .from("bottles")
      .update({
        tasting_note: note || null,
        source: note ? "user-added; user tasting note" : "user-added; LLM-researched fingerprint",
      })
      .eq("id", bottleId);
    setEditingId(null);
    setDraftNote("");
    qc.invalidateQueries({ queryKey: ["bottles"] });
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const rows = useMemo(() => {
    if (!bottles || !ratings) return [];
    const ratedInput = bottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    const cuvees = aggregateRated(ratedInput);
    const orderById = new Map(ratings.map((r, i) => [r.bottle_id, i]));
    const cuveeOrder = (c: typeof cuvees[number]) =>
      Math.min(...c.bottleIds.map((id) => orderById.get(id) ?? Infinity));
    const list = [...cuvees];
    switch (sort) {
      case "high": list.sort((a, b) => b.stars - a.stars); break;
      case "low":  list.sort((a, b) => a.stars - b.stars); break;
      case "name": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      default:     list.sort((a, b) => cuveeOrder(a) - cuveeOrder(b));
    }
    return list;
  }, [ratings, bottles, sort]);

  const count = ratings?.length ?? 0;
  const cuveeCount = rows.length;

  if (count === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You haven't rated anything yet — tap stars above to start.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {cuveeCount} wine{cuveeCount === 1 ? "" : "s"} · {count} rating{count === 1 ? "" : "s"}
        </p>
        <label className="text-xs text-muted-foreground flex items-center gap-2">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-input border border-border rounded-md px-2 py-1 text-xs"
          >
            <option value="recent">Recently added</option>
            <option value="high">Highest first</option>
            <option value="low">Lowest first</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>
      </div>

      <ul className="mt-3 divide-y divide-border">
        {isLoading && rows.length === 0 && (
          <li className="py-6 text-sm text-muted-foreground">Loading…</li>
        )}
        {rows.map((c) => {
          const vl = vintageLabel(c.vintages);
          const aggregated = c.bottleIds.length > 1;
          const rep = bottleById.get(c.id);
          const note = rep?.tasting_note ?? null;
          const isOwn = !!rep && !!session && rep.added_by === session.user.id;
          const editing = editingId === c.id;
          const isExpanded = expanded.has(c.cuvee);

          // Order child vintages newest-first, stable
          const children = aggregated
            ? [...c.bottleIds]
                .map((id) => bottleById.get(id))
                .filter((b): b is BottleRow => !!b)
                .sort((a, b) => (b.vintage ?? 0) - (a.vintage ?? 0))
            : [];

          return (
            <li key={c.cuvee} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                {/* Text block — tap target for /wine/$id */}
                <Link
                  to="/wine/$id"
                  params={{ id: c.id }}
                  className="min-w-0 flex-1 block group"
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:underline break-words">
                      {c.name}
                    </p>
                    <BenchmarkTierBadges benchmarks={canons ?? []} bottleIds={c.bottleIds} />
                  </div>

                  <p className="text-xs text-muted-foreground mt-0.5 break-words">
                    {[c.producer, c.region].filter(Boolean).join(" · ")}
                  </p>
                  {vl && (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5 break-words">
                      {aggregated ? `${vl}` : `Vintage ${vl}`}
                    </p>
                  )}
                </Link>

                {/* Stars + actions */}
                <div className="shrink-0 flex flex-col items-start sm:items-end gap-1.5">
                  {aggregated ? (
                    <div className="flex items-center gap-2.5">
                      <StarDisplay
                        value={c.stars}
                        ariaLabel={`Average ${c.stars.toFixed(1)} of 5 across ${c.bottleIds.length} vintages`}
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpanded(c.cuvee)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Hide vintages" : "Show vintages"}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <span>{c.stars.toFixed(1)} · avg of {c.bottleIds.length} vintages</span>
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  ) : (
                    <StarTap
                      value={c.stars}
                      onChange={(s) => rate.mutate({ bottleId: c.bottleIds[0], stars: s })}
                    />
                  )}
                  {!aggregated && rep && <CanonAction bottle={rep} stars={c.stars} />}
                  {!aggregated && rep && <NemesisAction bottle={rep} stars={c.stars} />}
                </div>
              </div>

              {/* Catalog note — only for user-added bottles, muted + labeled */}
              {isOwn && note && !editing && (
                <div className="mt-2 rounded border-l-2 border-border pl-2 py-0.5">
                  <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/80">
                    Catalog note
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{note}</p>
                </div>
              )}
              {isOwn && !editing && (
                <button
                  className="mt-1 text-[10px] text-primary underline"
                  onClick={() => { setEditingId(c.id); setDraftNote(note ?? ""); }}
                >
                  {note ? "edit catalog note" : "+ add catalog note"}
                </button>
              )}
              {isOwn && editing && (
                <div className="mt-1.5">
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    rows={2}
                    placeholder="Catalog tasting note for this bottle…"
                    className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => setEditingId(null)} className="text-[10px] text-muted-foreground underline">cancel</button>
                    <button onClick={() => saveNote(c.id)} className="text-[10px] text-primary underline font-medium">save</button>
                  </div>
                </div>
              )}

              {/* Expanded per-vintage children */}
              {aggregated && isExpanded && (
                <ul className="mt-3 ml-3 pl-3 border-l border-border/60 space-y-2.5">
                  {children.map((child) => {
                    const childStars = starsByBottle.get(child.id) ?? null;
                    return (
                      <li
                        key={child.id}
                        className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <Link
                          to="/wine/$id"
                          params={{ id: child.id }}
                          className="min-w-0 flex-1 text-xs text-foreground hover:underline"
                        >
                          <span className="font-medium">{child.vintage ?? "NV"}</span>
                          <span className="text-muted-foreground"> · {child.name}</span>
                        </Link>
                        <div className="shrink-0 flex items-center gap-2 flex-wrap">
                          <StarTap
                            size="sm"
                            value={childStars}
                            onChange={(s) => rate.mutate({ bottleId: child.id, stars: s })}
                          />
                          <CanonAction bottle={child} stars={childStars} compact />
                          <NemesisAction bottle={child} stars={childStars} compact />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
