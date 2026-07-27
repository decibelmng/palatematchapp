import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { sommGrantGenerate, getMyAccessLog, type AccessLogEntry } from "@/lib/somm.functions";

/** Guest-side: generate a short-lived code to hand to a sommelier, plus
 *  a log of every table call that has included this guest. */
export function SommShareCodeCard() {
  const generateFn = useServerFn(sommGrantGenerate);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [showLog, setShowLog] = useState(false);

  const gen = useMutation({
    mutationFn: () => generateFn(),
    onSuccess: (r) => setIssued({ code: (r as any).code, expiresAt: (r as any).expiresAt }),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const logQ = useQuery({
    queryKey: ["somm-access-log"],
    queryFn: () => getMyAccessLog(),
    enabled: showLog,
    staleTime: 30_000,
  });

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      toast.success("Code copied.");
    } catch { /* ignore */ }
  };

  const expiresIn = issued ? Math.max(0, Math.round((new Date(issued.expiresAt).getTime() - Date.now()) / 60000)) : 0;

  return (
    <div className="mt-5 rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <div className="text-sub text-foreground">Hand over a code</div>
      </div>
      <p className="mt-1 text-meta text-muted-foreground">
        Give this to your sommelier. It works once, and expires in 30 minutes.
      </p>

      {issued ? (
        <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-background/70 px-3 py-2">
          <div>
            <div className="font-mono text-h2 tracking-widest text-foreground">{issued.code}</div>
            <div className="text-meta text-muted-foreground">Expires in ~{expiresIn} min</div>
          </div>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy code"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-meta text-foreground"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => gen.mutate()}
          disabled={gen.isPending}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-primary-foreground text-sub disabled:opacity-60"
        >
          {issued ? "New code" : gen.isPending ? "Generating…" : "Generate code"}
        </button>
        <button
          type="button"
          onClick={() => setShowLog((s) => !s)}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sub text-foreground"
        >
          <ShieldCheck className="h-4 w-4" />
          {showLog ? "Hide access log" : "Who's read my palate?"}
        </button>
      </div>

      {showLog && (
        <div className="mt-3">
          {logQ.isLoading && <div className="text-meta text-muted-foreground">Loading…</div>}
          {logQ.data && logQ.data.length === 0 && (
            <div className="text-meta text-muted-foreground">No sommelier has read your palate yet.</div>
          )}
          {logQ.data && logQ.data.length > 0 && (
            <ul className="mt-2 divide-y divide-border">
              {logQ.data.map((row: AccessLogEntry) => (
                <li key={row.id} className="py-2">
                  <div className="text-sub text-foreground">
                    {row.sommName ?? "A sommelier"}
                    {row.establishment ? ` · ${row.establishment}` : ""}
                  </div>
                  <div className="text-meta text-muted-foreground">
                    {new Date(row.occurredAt).toLocaleString()} · {row.candidateCount} bottles · {row.via === "code" ? "via code" : "public profile"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
