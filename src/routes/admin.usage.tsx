import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  adminUsageSummary,
  adminDailyActiveUsers,
} from "@/lib/admin-usage.functions";
import { adminUserListWithEmail } from "@/lib/admin-somm.functions";

export const Route = createFileRoute("/admin/usage")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin · Usage" },
      { name: "description", content: "Read-only usage analytics." },
    ],
  }),
  component: () => (
    <AuthGate>
      <AdminUsage />
    </AuthGate>
  ),
});

type SortKey = "last_seen_at" | "created_at" | "ratings_count" | "scans_count" | "wishlist_count";

function AdminUsage() {
  const summaryFn = useServerFn(adminUsageSummary);
  const listFn = useServerFn(adminUserListWithEmail);
  const dauFn = useServerFn(adminDailyActiveUsers);

  const summary = useQuery({ queryKey: ["admin", "usage", "summary"], queryFn: () => summaryFn() });
  const users = useQuery({
    queryKey: ["admin", "usage", "users"],
    queryFn: () => listFn({ data: { limit: 500, offset: 0 } }),
  });
  const dau = useQuery({
    queryKey: ["admin", "usage", "dau"],
    queryFn: () => dauFn({ data: { days: 30 } }),
  });

  const [sort, setSort] = useState<SortKey>("last_seen_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const rows = users.data ?? [];
    const mul = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = (a as any)[sort];
      const bv = (b as any)[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number") return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
  }, [users.data, sort, dir]);

  const dauMax = useMemo(
    () => (dau.data ?? []).reduce((m, r) => Math.max(m, Number(r.users)), 0) || 1,
    [dau.data],
  );

  if (summary.error || users.error || dau.error) {
    const msg =
      (summary.error as Error | undefined)?.message ??
      (users.error as Error | undefined)?.message ??
      (dau.error as Error | undefined)?.message ??
      "Error";
    return <div className="p-6 text-sm text-destructive">{msg}</div>;
  }

  const clickSort = (k: SortKey) => {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir("desc"); }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 pb-24">
      <h1 className="text-xl font-semibold">Usage</h1>
      <p className="mt-1 text-xs text-muted-foreground">Read-only. Ping updates the caller's own row only.</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Total users" value={summary.data?.total_users} />
        <Tile label="Active 24h" value={summary.data?.active_24h} />
        <Tile label="Active 7d" value={summary.data?.active_7d} />
        <Tile label="Active 30d" value={summary.data?.active_30d} />
        <Tile label="New this week" value={summary.data?.new_this_week} />
        <Tile label="Median ratings/user" value={summary.data?.median_ratings_per_user} />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Daily active (last 30d)</h2>
        <div className="mt-2 rounded border-[0.5px] border-border bg-card/60 p-2">
          {(dau.data ?? []).length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="space-y-1">
              {(dau.data ?? []).map((r) => (
                <li key={r.day} className="grid grid-cols-[88px_1fr_36px] items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{r.day}</span>
                  <span className="h-2 rounded bg-primary/60" style={{ width: `${(Number(r.users) / dauMax) * 100}%` }} />
                  <span className="text-right tabular-nums">{r.users}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Users ({sorted.length})</h2>
        <div className="mt-2 overflow-x-auto rounded border-[0.5px] border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">User</th>
                <Th onClick={() => clickSort("created_at")} active={sort === "created_at"} dir={dir}>Joined</Th>
                <Th onClick={() => clickSort("last_seen_at")} active={sort === "last_seen_at"} dir={dir}>Last seen</Th>
                <Th onClick={() => clickSort("ratings_count")} active={sort === "ratings_count"} dir={dir}>Ratings</Th>
                <Th onClick={() => clickSort("scans_count")} active={sort === "scans_count"} dir={dir}>Scans</Th>
                <Th onClick={() => clickSort("wishlist_count")} active={sort === "wishlist_count"} dir={dir}>Wishlist</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="border-t border-border/60">
                  <td className="p-2">
                    <div className="font-medium">{u.display_name ?? u.username}</div>
                    <div className="text-[10px] text-muted-foreground">@{u.username}</div>
                  </td>
                  <td className="p-2 whitespace-nowrap">{fmt(u.created_at)}</td>
                  <td className="p-2 whitespace-nowrap">{u.last_seen_at ? fmt(u.last_seen_at) : "—"}</td>
                  <td className="p-2 tabular-nums">{u.ratings_count}</td>
                  <td className="p-2 tabular-nums">{u.scans_count}</td>
                  <td className="p-2 tabular-nums">{u.wishlist_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className="rounded-[12px] border-[0.5px] border-border bg-card/60 p-3">
      <div className="text-[11px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value == null ? "—" : typeof value === "number" ? Math.round(Number(value) * 10) / 10 : value}
      </div>
    </div>
  );
}

function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="p-2">
      <button onClick={onClick} className={`text-left ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {children}{active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function fmt(ts: string) {
  try {
    const d = new Date(ts);
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch { return ts; }
}
