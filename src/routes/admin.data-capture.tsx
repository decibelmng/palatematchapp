import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { adminCaptureSummary, adminRestaurantCoverage } from "@/lib/admin-capture.functions";

export const Route = createFileRoute("/admin/data-capture")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — capture accumulation" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <AuthGate><CapturePage /></AuthGate>,
});

function CapturePage() {
  const summaryFn = useServerFn(adminCaptureSummary);
  const coverageFn = useServerFn(adminRestaurantCoverage);
  const [dupOnly, setDupOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "obs" | "listings">("recent");

  const summary = useQuery({ queryKey: ["adm-capture-summary"], queryFn: () => summaryFn() });
  const coverage = useQuery({ queryKey: ["adm-capture-coverage"], queryFn: () => coverageFn() });

  const rows = useMemo(() => {
    let r = (coverage.data ?? []).slice();
    if (dupOnly) r = r.filter((x) => x.possible_duplicate);
    if (sort === "obs") r.sort((a, b) => b.price_obs - a.price_obs);
    else if (sort === "listings") r.sort((a, b) => b.listings - a.listings);
    else r.sort((a, b) => (b.last_seen ?? "").localeCompare(a.last_seen ?? ""));
    return r;
  }, [coverage.data, dupOnly, sort]);

  if (summary.error || coverage.error) {
    return (
      <div className="pt-6">
        <div className="text-sm text-destructive">Not authorized.</div>
        <Link to="/" className="text-sm underline">Home</Link>
      </div>
    );
  }

  const s = summary.data;

  return (
    <div className="pt-6 space-y-5">
      <header>
        <div className="text-xs text-muted-foreground">
          <Link to="/admin/usage" className="underline">Admin</Link> · data capture
        </div>
        <h1 className="text-2xl font-semibold mt-1">Restaurant + price capture</h1>
        <p className="text-sm text-muted-foreground">Read-only. Watch the asset build toward volume that unlocks B/C.</p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Tile label="Restaurants" value={s?.total_restaurants} />
        <Tile label="Listings" value={s?.total_listings} />
        <Tile label="Price observations" value={s?.total_price_obs} />
        <Tile label="Restaurants ≥5 obs" value={s?.restaurants_with_min_obs} />
        <Tile label="Possible duplicates" value={s?.possible_duplicates} tone={((s?.possible_duplicates ?? 0) > 0) ? "warn" : undefined} />
        <Tile label="Scans this week" value={s?.scans_this_week} />
      </div>

      <div className="flex items-center gap-3 text-xs pt-2">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
          duplicates only
        </label>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-muted-foreground">sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="bg-card border border-border rounded px-1.5 py-0.5">
            <option value="recent">recent</option>
            <option value="obs">obs</option>
            <option value="listings">listings</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-accent/40">
            <tr className="text-left">
              <th className="px-3 py-2">Restaurant</th>
              <th className="px-3 py-2 text-right">Listings</th>
              <th className="px-3 py-2 text-right">Obs</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium truncate max-w-[220px]">{r.name}</div>
                  <div className="text-meta text-muted-foreground">
                    {r.city ?? ""}
                    {r.possible_duplicate && <span className="ml-1 text-foreground">· possible duplicate</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.listings}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.price_obs}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.last_seen ? new Date(r.last_seen).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No restaurants match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | undefined; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "warn" ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"}`}>
      <div className="text-2xl font-semibold tabular-nums">{value ?? "—"}</div>
      <div className="text-meta text-muted-foreground uppercase tracking-label mt-0.5">{label}</div>
    </div>
  );
}
