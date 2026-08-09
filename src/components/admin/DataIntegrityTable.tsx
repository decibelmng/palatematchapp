import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  derived_table: string;
  row_count: number;
  last_write: string | null;
  parent_label: string;
  parent_count: number;
  shipped_at: string | null;
  window_from: string | null;
};

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All time", days: null as number | null },
];

function fmtDate(s: string | null) {
  if (!s) return "never";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One table, not a dashboard.
 *
 * Two failure modes it has to tell apart. An empty derived table because nobody
 * used the feature looks identical to an empty one because the write path is
 * broken — so every row carries the parent count that should have produced it.
 * And rows that predate a write path would read as permanent failures, which
 * teaches people to ignore the row and kills the table as monitoring — so every
 * path is judged only on rows created after its writer shipped, inside a window.
 */
export function DataIntegrityTable() {
  const [days, setDays] = useState<number | null>(7);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "data-integrity", days],
    queryFn: async (): Promise<Row[]> => {
      const since =
        days === null
          ? new Date(0).toISOString()
          : new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await (supabase as any).rpc("admin_data_integrity", {
        _since: since,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-meta text-muted-foreground">Judged on rows from the last</span>
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            type="button"
            onClick={() => setDays(w.days)}
            className={`min-h-11 rounded-md border px-3 text-meta ${
              days === w.days
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-meta text-muted-foreground">Checking write paths…</p>}
      {error && <p className="text-meta text-destructive">{(error as Error).message}</p>}
      {!isLoading && !error && (!data || data.length === 0) && (
        <p className="text-meta text-muted-foreground">Admin only.</p>
      )}

      {data && data.length > 0 && (
        <div className="pm-card overflow-x-auto">
          <table className="w-full text-left text-meta">
            <thead>
              <tr className="text-muted-foreground">
                <th className="p-2 font-normal">Derived</th>
                <th className="p-2 font-normal text-right">Written</th>
                <th className="p-2 font-normal">Of what</th>
                <th className="p-2 font-normal text-right">Shipped</th>
                <th className="p-2 font-normal text-right">Last write</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                // Only a path with parent rows in the window can be judged. No
                // parent rows is "nothing to write", not a failure.
                const idle = r.parent_count === 0;
                const dead = !idle && r.row_count === 0;
                const shortfall = !idle && r.row_count > 0 && r.row_count < r.parent_count;
                return (
                  <tr key={r.derived_table} className="border-t border-border">
                    <td className="p-2">{r.derived_table}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        dead
                          ? "text-destructive font-medium"
                          : shortfall
                            ? "font-medium"
                            : ""
                      }`}
                    >
                      {idle ? "—" : `${r.row_count} of ${r.parent_count}`}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {idle ? `no ${r.parent_label} yet` : r.parent_label}
                    </td>
                    <td className="p-2 text-right text-muted-foreground">
                      {r.shipped_at ? fmtDate(r.shipped_at) : "—"}
                    </td>
                    <td className="p-2 text-right text-muted-foreground">
                      {fmtDate(r.last_write)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-meta text-muted-foreground">
        A red count is a write path with work to do and nothing written. A dash means there was
        nothing to write in this window.
      </p>
    </div>
  );
}
