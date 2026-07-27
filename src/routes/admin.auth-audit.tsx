import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { adminAuthAuditEntries, type AdminAuthAuditEntry } from "@/lib/admin-auth-audit.functions";

export const Route = createFileRoute("/admin/auth-audit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin · Auth audit" },
      { name: "description", content: "Read-only authentication audit trail." },
      { property: "og:title", content: "Admin · Auth audit" },
      { property: "og:description", content: "Read-only authentication audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AuthGate>
      <AdminAuthAudit />
    </AuthGate>
  ),
});

function AdminAuthAudit() {
  const [hours, setHours] = useState(72);
  const fetchEntries = useServerFn(adminAuthAuditEntries);
  const query = useQuery({
    queryKey: ["admin", "auth-audit", hours],
    queryFn: () => fetchEntries({ data: { hours, limit: 500 } }),
  });

  const rows = (query.data ?? []) as AdminAuthAuditEntry[];
  const counts = useMemo(() => {
    const success = rows.filter((row) => !row.error).length;
    return { success, failed: rows.length - success };
  }, [rows]);

  return (
    <div className="mx-auto max-w-5xl p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Auth audit</h1>
        <p className="text-xs text-muted-foreground">Read-only authentication events.</p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {[24, 72, 168].map((value) => (
          <Button
            key={value}
            type="button"
            onClick={() => setHours(value)}
            variant={hours === value ? "default" : "outline"}
            size="sm"
          >
            {value}h
          </Button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {rows.length} rows · {counts.success} without error · {counts.failed} with error
        </span>
      </div>

      {query.error && (
        <p className="mt-4 rounded-md border border-border bg-card p-3 text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Action</th>
              <th className="p-2">Method</th>
              <th className="p-2">Path</th>
              <th className="p-2">Provider</th>
              <th className="p-2">Status</th>
              <th className="p-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><td className="p-3 text-muted-foreground" colSpan={7}>Loading…</td></tr>
            )}
            {!query.isLoading && rows.length === 0 && (
              <tr><td className="p-3 text-muted-foreground" colSpan={7}>No events found.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60 align-top">
                <td className="p-2 whitespace-nowrap font-mono text-muted-foreground">{fmt(row.created_at)}</td>
                <td className="p-2 whitespace-nowrap">{row.action ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">{row.method ?? "—"}</td>
                <td className="p-2 min-w-[160px]">{row.path ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">{row.provider ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">{row.status ?? "—"}</td>
                <td className="p-2 min-w-[220px]">{row.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(ts: string) {
  try {
    return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return ts;
  }
}