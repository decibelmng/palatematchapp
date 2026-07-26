import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Ticket, X, Loader2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import {
  adminListSommCodes,
  adminGenerateSommCode,
  adminRevokeSommCode,
  type SommCodeRow,
} from "@/lib/admin-somm.functions";
import { displayNameFor } from "@/lib/user-display";

export const Route = createFileRoute("/admin/somm-codes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin · Somm Codes" }] }),
  component: () => <AuthGate><SommCodesAdmin /></AuthGate>,
});

function SommCodesAdmin() {
  const list = useServerFn(adminListSommCodes);
  const generate = useServerFn(adminGenerateSommCode);
  const revoke = useServerFn(adminRevokeSommCode);
  const qc = useQueryClient();

  const rows = useQuery({
    queryKey: ["admin", "somm-codes"],
    queryFn: () => list(),
  });

  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "used" | "revoked">("all");

  const gen = useMutation({
    mutationFn: (n: string | null) => generate({ data: { note: n } }),
    onSuccess: async ({ code }) => {
      try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
      toast.success(`Generated ${code} (copied)`);
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin", "somm-codes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rev = useMutation({
    mutationFn: (code: string) => revoke({ data: { code } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Code revoked");
      else toast.error("Couldn't revoke — code is used or already revoked");
      qc.invalidateQueries({ queryKey: ["admin", "somm-codes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = (rows.data ?? []).filter((r) => filter === "all" ? true : r.status === filter);

  if (rows.error) {
    return <div className="pt-6 text-sm text-destructive">{(rows.error as Error).message}</div>;
  }

  return (
    <div className="pt-6 pb-24 space-y-4">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Somm Codes</h1>
        <p className="text-xs text-muted-foreground">Issue and revoke sommelier invite codes.</p>
      </header>

      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Generate a code</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Label (optional) — e.g. 'For Rae, The French Laundry'"
            maxLength={120}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => gen.mutate(note.trim() || null)}
            disabled={gen.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {gen.isPending ? <Loader2 size={13} className="animate-spin" /> : <Ticket size={13} />}
            Generate
          </button>
        </div>
      </section>

      <section className="flex items-center gap-2 text-xs">
        {(["all", "active", "used", "revoked"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-2.5 py-1 border ${
              filter === s
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">{filtered.length} of {rows.data?.length ?? 0}</span>
      </section>

      <section className="space-y-2">
        {rows.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {filtered.length === 0 && !rows.isLoading && (
          <p className="text-xs text-muted-foreground">No codes.</p>
        )}
        {filtered.map((row) => (
          <CodeCard key={row.code} row={row} onRevoke={() => rev.mutate(row.code)} />
        ))}
      </section>
    </div>
  );
}

function CodeCard({ row, onRevoke }: { row: SommCodeRow; onRevoke: () => void }) {
  const created = new Date(row.created_at).toLocaleDateString();
  const used = row.used_at ? new Date(row.used_at).toLocaleDateString() : null;
  const redeemer = row.used_by
    ? displayNameFor({ display_name: row.used_by_display_name, username: row.used_by_username ?? "user" })
    : null;

  const statusStyles = {
    active:  "bg-primary/10 text-primary border-primary/30",
    used:    "bg-muted text-muted-foreground border-border",
    revoked: "bg-destructive/10 text-destructive border-destructive/30",
  } as const;

  return (
    <article className="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <header className="flex items-center gap-2">
        <code className="font-mono text-sm font-semibold">{row.code}</code>
        <span className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${statusStyles[row.status]}`}>
          {row.status}
        </span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={async () => {
            try { await navigator.clipboard.writeText(row.code); toast.success("Copied"); } catch { /* ignore */ }
          }}
          className="ml-auto p-1 text-muted-foreground hover:text-foreground"
        >
          <Copy size={13} />
        </button>
        {row.status === "active" && (
          <button
            type="button"
            aria-label="Revoke"
            onClick={onRevoke}
            className="p-1 text-muted-foreground hover:text-destructive"
            title="Revoke"
          >
            <X size={13} />
          </button>
        )}
      </header>
      {row.note && <p className="text-[12px]">{row.note}</p>}
      <p className="text-[11px] text-muted-foreground">
        Created {created}
        {used && redeemer && (
          <>
            {" · "}Redeemed {used} by {redeemer}
            {row.used_by_email && <> · <span className="font-mono">{row.used_by_email}</span></>}
          </>
        )}
        {row.status === "revoked" && row.revoked_at && (
          <> · Revoked {new Date(row.revoked_at).toLocaleDateString()}</>
        )}
      </p>
    </article>
  );
}
