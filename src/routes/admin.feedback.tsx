import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import {
  adminListFeedback,
  adminFeedbackSummary,
  adminSetFeedbackStatus,
  type FeedbackRow,
} from "@/lib/admin-feedback.functions";
import { displayNameFor } from "@/lib/user-display";

export const Route = createFileRoute("/admin/feedback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Feedback — Admin" }] }),
  component: () => <AuthGate><FeedbackAdmin /></AuthGate>,
});

type StatusFilter = "" | "new" | "triaged" | "resolved";
type SourceFilter = "" | "button" | "prompt";

function FeedbackAdmin() {
  const list = useServerFn(adminListFeedback);
  const summary = useServerFn(adminFeedbackSummary);
  const setStatus = useServerFn(adminSetFeedbackStatus);
  const qc = useQueryClient();

  const [category, setCategory] = useState<string>("");
  const [source, setSource] = useState<SourceFilter>("");
  const [status, setStatus_] = useState<StatusFilter>("");

  const rows = useQuery({
    queryKey: ["admin-feedback", category, source, status],
    queryFn: () => list({ data: { category: category || null, source: source || null, status: status || null } }),
  });

  const sum = useQuery({
    queryKey: ["admin-feedback-summary"],
    queryFn: () => summary(),
  });

  const mut = useMutation({
    mutationFn: (input: { id: string; status: "new" | "triaged" | "resolved" }) =>
      setStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feedback"] }),
  });

  const summaryData = sum.data;

  return (
    <div className="pt-6 pb-24 space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Feedback</h1>
        <p className="text-xs text-muted-foreground">
          Unsolicited (button) and solicited (prompts). Read-only except status.
        </p>
      </header>

      {/* Summary tiles */}
      {summaryData && (
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">This week</div>
            <div className="mt-1 text-2xl font-semibold">{summaryData.this_week_total}</div>
            <ul className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
              {summaryData.by_category.map((c) => (
                <li key={c.category} className="flex justify-between">
                  <span>{c.category}</span><span>{c.n}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Prompt 👍/👎</div>
            <ul className="mt-1 text-[11px] space-y-1">
              {summaryData.prompt_ratios.length === 0 && (
                <li className="text-muted-foreground">No prompt data yet.</li>
              )}
              {summaryData.prompt_ratios.map((p) => {
                const total = p.up + p.down;
                const upPct = total ? Math.round((p.up / total) * 100) : 0;
                return (
                  <li key={p.prompt_key}>
                    <div className="flex justify-between">
                      <span className="font-mono text-[10px]">{p.prompt_key}</span>
                      <span>{upPct}% 👍 ({p.up}/{total})</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="col-span-2 rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Screens generating most "confusing" feedback
            </div>
            {summaryData.confusing_by_screen.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">None this week.</p>
            ) : (
              <ul className="mt-1 text-[11px] space-y-0.5">
                {summaryData.confusing_by_screen.map((s) => (
                  <li key={s.screen} className="flex justify-between">
                    <span className="font-mono text-[10px] truncate">{s.screen}</span>
                    <span>{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="flex flex-wrap gap-2 items-center text-xs">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1">
          <option value="">All categories</option>
          <option value="bug">Bug</option>
          <option value="confusing">Confusing</option>
          <option value="idea">Idea</option>
          <option value="love">Love it</option>
          <option value="other">Other</option>
          <option value="helpful_prompt">Prompt</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="rounded-md border border-border bg-background px-2 py-1">
          <option value="">Any source</option>
          <option value="button">Button</option>
          <option value="prompt">Prompt</option>
        </select>
        <select value={status} onChange={(e) => setStatus_(e.target.value as StatusFilter)} className="rounded-md border border-border bg-background px-2 py-1">
          <option value="">Any status</option>
          <option value="new">New</option>
          <option value="triaged">Triaged</option>
          <option value="resolved">Resolved</option>
        </select>
      </section>

      {/* Rows */}
      <section className="space-y-2">
        {rows.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {rows.error && <p className="text-xs text-destructive">{(rows.error as Error).message}</p>}
        {rows.data?.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet.</p>}
        {rows.data?.map((r) => (
          <FeedbackCard key={r.id} row={r} onSetStatus={(s) => mut.mutate({ id: r.id, status: s })} />
        ))}
      </section>
    </div>
  );
}

function FeedbackCard({ row, onSetStatus }: { row: FeedbackRow; onSetStatus: (s: "new" | "triaged" | "resolved") => void }) {
  const name = displayNameFor({ display_name: row.display_name, username: row.username ?? "user" });
  const date = useMemo(() => new Date(row.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), [row.created_at]);
  const badge = row.source === "prompt"
    ? `${row.prompt_key ?? "prompt"} · ${row.rating === "up" ? "👍" : "👎"}`
    : row.category;

  return (
    <article className="rounded-lg border border-border bg-card p-3 space-y-2">
      <header className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
          {badge}
        </span>
        <span>·</span>
        <span>{name}</span>
        <span>·</span>
        <span className="font-mono">{row.screen ?? "—"}</span>
        <span className="ml-auto">{date}</span>
      </header>
      {row.message && <p className="text-sm whitespace-pre-wrap">{row.message}</p>}
      {row.signed_screenshot_url && (
        <a href={row.signed_screenshot_url} target="_blank" rel="noreferrer">
          <img src={row.signed_screenshot_url} alt="Screenshot" className="max-h-48 rounded border border-border" />
        </a>
      )}
      <footer className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        {row.app_version && <span>build: {row.app_version}</span>}
        {row.context && Object.entries(row.context).map(([k, v]) => (
          <span key={k} className="rounded bg-muted/50 px-1.5 py-0.5">{k}: {String(v)}</span>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {(["new", "triaged", "resolved"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSetStatus(s)}
              className={`rounded px-2 py-0.5 border ${
                row.status === s
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </span>
      </footer>
    </article>
  );
}
