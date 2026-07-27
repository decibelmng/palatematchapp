import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { listUserScans } from "@/lib/scans-history.functions";

export const Route = createFileRoute("/scans")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Past scans — Palate Match" },
      { name: "description", content: "Every wine list you've scanned. Reopen any to see it re-ranked against your current palate." },
    ],
  }),
  component: () => <AuthGate><ScansPage /></AuthGate>,
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ScansPage() {
  const list = useServerFn(listUserScans);
  const q = useQuery({ queryKey: ["user-scans"], queryFn: () => list(), staleTime: 30_000 });

  return (
    <div className="pt-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Past scans</h1>
        <p className="text-sm text-muted-foreground">
          Facts stored once — every scan re-ranks against your current palate when you open it.
        </p>
      </header>

      {q.isLoading && <div className="text-sm text-muted-foreground py-8">Loading…</div>}
      {q.error && <div className="text-sm text-destructive py-4">Couldn't load scans.</div>}
      {q.data && q.data.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No scans yet. Head to the <Link to="/scan/list" className="text-primary underline">scan tab</Link> to capture your first wine list.
        </div>
      )}

      <ul className="space-y-2">
        {(q.data ?? []).map((s) => {
          const isBottle = s.kind === "bottle";
          return (
            <li key={s.id}>
              <Link
                to={isBottle ? "/scans" : "/scan/$id"}
                params={isBottle ? undefined : { id: s.id }}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:bg-accent/40 active:bg-accent/60 transition-colors"
              >
                {isBottle && s.front_thumb_url ? (
                  <img
                    src={s.front_thumb_url}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover border border-border"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-muted border border-border flex items-center justify-center text-meta text-muted-foreground uppercase tracking-label">
                    {isBottle ? "Btl" : "List"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {isBottle
                      ? (s.bottle_label ?? "Bottle scan")
                      : (s.restaurant_name ?? s.venue_raw_text ?? "Unattributed scan")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(s.scanned_at)}
                    {isBottle
                      ? (s.rated_stars ? ` · rated ${s.rated_stars}★` : " · not rated yet")
                      : ` · ${s.wine_count} wine${s.wine_count === 1 ? "" : "s"}${s.matched_count > 0 ? ` · ${s.matched_count} matched` : ""}`}
                  </div>
                </div>
                {s.status !== "complete" && s.status !== "parsed" && (
                  <span className="shrink-0 text-meta uppercase tracking-label text-muted-foreground rounded px-1.5 py-0.5 border border-border">
                    {s.status}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
