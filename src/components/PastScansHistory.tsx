import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listUserScans } from "@/lib/scans-history.functions";

function fmtScanDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PastScansHistory() {
  const list = useServerFn(listUserScans);
  const q = useQuery({ queryKey: ["user-scans"], queryFn: () => list(), staleTime: 30_000 });

  if (q.isLoading) return <div className="mt-8 text-sub text-muted-foreground">Loading past scans…</div>;
  if (q.error) return <div className="mt-8 text-sub text-destructive">Couldn't load past scans.</div>;
  const scans = q.data ?? [];

  return (
    <section aria-labelledby="past-scans-heading" className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 id="past-scans-heading" className="font-serif text-heading">Past scans</h2>
        {scans.length > 0 && (
          <span className="text-meta text-muted-foreground">
            {scans.length} scan{scans.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="mt-1 text-meta text-muted-foreground">
        Facts saved once — each scan re-ranks against your current palate when you open it.
      </p>
      {scans.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sub text-muted-foreground">
          No scans yet. Point the camera at a wine list above to capture your first one.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {scans.map((s) => {
            const scannedMs = new Date(s.scanned_at).getTime();
            const isPostMeal =
              Number.isFinite(scannedMs) && (Date.now() - scannedMs) > 3 * 3600 * 1000;
            const ordered = s.ordered_unrated ?? [];
            // Named prompt when we know what was ordered; the generic nudge
            // only survives where there is no outcome row.
            const showNamed = isPostMeal && ordered.length > 0;
            const showGeneric = isPostMeal && ordered.length === 0 && s.wine_count > 0;
            return (
              <li key={s.id}>
                <Link
                  to="/scan/$id"
                  params={{ id: s.id }}
                  className="block rounded-lg border border-border bg-card p-4 hover:bg-accent/40 active:bg-accent/60 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {s.restaurant_name ?? s.venue_raw_text ?? "Unattributed scan"}
                      </div>
                      <div className="text-meta text-muted-foreground mt-0.5">
                        {fmtScanDate(s.scanned_at)} · {s.wine_count} wine{s.wine_count === 1 ? "" : "s"}
                        {s.matched_count > 0 && <> · {s.matched_count} matched</>}
                      </div>
                    </div>
                    {s.status !== "complete" && s.status !== "parsed" && (
                      <span className="shrink-0 text-label uppercase tracking-label text-muted-foreground rounded px-1.5 py-0.5 border border-border">
                        {s.status}
                      </span>
                    )}
                  </div>
                  {showNamed && (
                    <div className="mt-3 space-y-2">
                      {ordered.map((o) => (
                        <div
                          key={o.bottle_id}
                          className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2"
                        >
                          <span className="min-w-0 text-meta text-foreground">
                            How was the {o.name}?
                          </span>
                          <span className="shrink-0 text-label uppercase tracking-label text-primary font-medium">
                            Rate it →
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {showGeneric && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                      <span className="text-meta text-foreground">Did you order something? Rate it.</span>
                      <span className="shrink-0 text-label uppercase tracking-label text-primary font-medium">
                        Rate wines →
                      </span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}

        </ul>

      )}
    </section>
  );
}
