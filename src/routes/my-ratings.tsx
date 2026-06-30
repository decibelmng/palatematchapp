import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useBottlesByIds, useRatings, useRate, bottleToFp, bottleType, type BottleRow } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { aggregateRated } from "@/lib/cuvee";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/my-ratings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your ratings — Palate Match" },
      { name: "description", content: "Edit or remove the bottles that make up your palate code." },
    ],
  }),
  component: () => <AuthGate><MyRatings /></AuthGate>,
});

type SortKey = "recent" | "high" | "low" | "name";

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

function MyRatings() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles, isLoading } = useBottlesByIds(ratedIds);
  const rate = useRate();
  const [sort, setSort] = useState<SortKey>("recent");
  const session = useSession();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  const bottleById = useMemo(() => {
    const m = new Map<string, BottleRow>();
    for (const b of bottles ?? []) m.set(b.id, b);
    return m;
  }, [bottles]);

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

  const rows = useMemo(() => {
    if (!bottles || !ratings) return [];
    const ratedInput = bottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    const cuvees = aggregateRated(ratedInput);

    // recent-order = order of first occurrence in ratings
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

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your ratings</p>
      <h1 className="font-serif text-3xl mt-2">The wines behind your palate</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Vintages of the same wine are grouped — your rating applies to the wine's style across years.
      </p>

      {count === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-card/60 p-5">
          <p className="text-sm text-muted-foreground">You haven't rated anything yet.</p>
          <Link
            to="/rate"
            className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Rate a bottle
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-between gap-3">
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
              const isResearched = rep?.source?.includes("LLM-researched") ?? false;
              const editing = editingId === c.id;
              return (
                <li key={c.cuvee} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[c.producer, c.region].filter(Boolean).join(" · ")}
                      {vl ? <span className="text-muted-foreground/80"> · {vl}</span> : null}
                    </p>
                    {aggregated && (
                      <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                        avg of {c.bottleIds.length} ratings across vintages
                      </p>
                    )}
                    {note && !editing && (
                      <div className="mt-1.5 rounded border-l-2 border-primary/40 pl-2 py-0.5">
                        {isResearched && (
                          <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                            researched estimate
                          </p>
                        )}
                        <p className="text-[11px] italic text-muted-foreground leading-snug">"{note}"</p>
                      </div>
                    )}
                    {isOwn && !editing && (
                      <button
                        className="mt-1 text-[10px] text-primary underline"
                        onClick={() => { setEditingId(c.id); setDraftNote(note ?? ""); }}
                      >
                        {note ? "edit note" : "+ add your note"}
                      </button>
                    )}
                    {editing && (
                      <div className="mt-1.5">
                        <textarea
                          value={draftNote}
                          onChange={(e) => setDraftNote(e.target.value)}
                          rows={2}
                          placeholder="Your tasting impression…"
                          className="w-full bg-input border border-border rounded-md px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => setEditingId(null)} className="text-[10px] text-muted-foreground underline">cancel</button>
                          <button onClick={() => saveNote(c.id)} className="text-[10px] text-primary underline font-medium">save</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {aggregated ? (
                    <div className="shrink-0 flex items-center gap-3">
                      <span className="font-serif text-primary">{c.stars.toFixed(1)}★</span>
                      <button
                        className="text-xs text-muted-foreground underline"
                        onClick={() => {
                          for (const id of c.bottleIds) rate.mutate({ bottleId: id, stars: null });
                        }}
                      >
                        clear all
                      </button>
                    </div>
                  ) : (
                    <StarTap
                      value={c.stars}
                      onChange={(s) => rate.mutate({ bottleId: c.bottleIds[0], stars: s })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
