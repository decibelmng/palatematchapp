import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  derived_table: string;
  row_count: number;
  last_write: string | null;
  parent_label: string;
  parent_count: number;
};

function fmtDate(s: string | null) {
  if (!s) return "never";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One table, not a dashboard. An empty derived table because nobody used the
 * feature looks identical to an empty one because the write path is broken —
 * so every row carries the parent count that should have produced it. A
 * 0-of-74 ratio is meant to be visible at a glance.
 */
export function DataIntegrityTable() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "data-integrity"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any).rpc("admin_data_integrity");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (isLoading) return <p className="text-meta text-muted-foreground">Checking write paths…</p>;
  if (error) return <p className="text-meta text-destructive">{(error as Error).message}</p>;
  if (!data || data.length === 0)
    return <p className="text-meta text-muted-foreground">Admin only.</p>;

  return (
    <div className="pm-card overflow-x-auto">
      <table className="w-full text-left text-meta">
        <thead>
          <tr className="text-muted-foreground">
            <th className="p-2 font-normal">Derived</th>
            <th className="p-2 font-normal text-right">Rows</th>
            <th className="p-2 font-normal text-right">Of parent</th>
            <th className="p-2 font-normal">Parent</th>
            <th className="p-2 font-normal text-right">Last write</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => {
            const dead = r.parent_count > 0 && r.row_count === 0;
            return (
              <tr key={r.derived_table} className="border-t border-border">
                <td className="p-2">{r.derived_table}</td>
                <td className={`p-2 text-right tabular-nums ${dead ? "text-destructive font-medium" : ""}`}>
                  {r.row_count}
                </td>
                <td className="p-2 text-right tabular-nums text-muted-foreground">
                  {r.row_count} of {r.parent_count}
                </td>
                <td className="p-2 text-muted-foreground">{r.parent_label}</td>
                <td className="p-2 text-right text-muted-foreground">{fmtDate(r.last_write)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
