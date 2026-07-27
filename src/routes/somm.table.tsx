import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useMyProfile } from "@/hooks/use-friends";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { X, Plus, ChevronLeft, ScanLine, Users, KeyRound } from "lucide-react";
import {
  sommClaimCode, sommResolvePublicGuest, sommCallTable,
  sommGetMyHouseList, sommHouseListCandidates,
  type ResolvedGuest, type TableCallOutput, type BottleWithVerdicts,
} from "@/lib/somm.functions";
import type { Verdict } from "@/lib/table-call";

export const Route = createFileRoute("/somm/table")({
  ssr: false,
  // TEMPORARY GATE: /somm/table is hidden pending consent + payload work.
  // Direct navigation redirects to /palate; the component below is retained.
  beforeLoad: () => {
    throw redirect({ to: "/palate" });
  },
  head: () => ({
    meta: [
      { title: "Table mode — Palate Match" },
      { name: "description", content: "Guest hands you a code. You call the bottle." },
    ],
  }),
  component: () => <AuthGate><TablePage /></AuthGate>,
});

function TablePage() {
  const { data: profile } = useMyProfile();
  const [guests, setGuests] = useState<ResolvedGuest[]>([]);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [showPublic, setShowPublic] = useState(false);
  const [result, setResult] = useState<TableCallOutput | null>(null);

  const claimFn = useServerFn(sommClaimCode);
  const resolvePublicFn = useServerFn(sommResolvePublicGuest);
  const callFn = useServerFn(sommCallTable);

  const addGuest = (g: ResolvedGuest) => {
    if (guests.some((x) => x.userId === g.userId)) {
      toast.info("Guest already at the table.");
      return;
    }
    if (guests.length >= 6) {
      toast.error("Six guests is the limit.");
      return;
    }
    setGuests((prev) => [...prev, g]);
  };

  const claim = useMutation({
    mutationFn: (c: string) => claimFn({ data: { code: c } }),
    onSuccess: (g) => { addGuest(g as ResolvedGuest); setCode(""); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const resolvePublic = useMutation({
    mutationFn: (u: string) => resolvePublicFn({ data: { username: u } }),
    onSuccess: (g) => { addGuest(g as ResolvedGuest); setUsername(""); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const houseListQ = useQuery({
    queryKey: ["somm-house-list"],
    queryFn: () => sommGetMyHouseList(),
    enabled: !!profile && profile.somm_status === "verified",
  });
  const houseList = houseListQ.data;

  const candidatesQ = useQuery({
    queryKey: ["somm-candidates", houseList?.activeVersionId],
    queryFn: () => sommHouseListCandidates({ data: { houseListVersionId: houseList!.activeVersionId! } }),
    enabled: !!houseList?.activeVersionId,
  });

  const call = useMutation({
    mutationFn: async () => {
      const candidates = candidatesQ.data ?? [];
      if (guests.length === 0) throw new Error("Add at least one guest.");
      if (candidates.length === 0) throw new Error("No list to score against. Save your house list first.");
      return callFn({
        data: {
          guests: guests.map((g) => ({
            userId: g.userId, displayName: g.displayName, archetype: g.archetype,
            initial: g.initial, grantId: g.grantId, via: g.via,
          })),
          candidates,
          houseListId: houseList?.houseListId || undefined,
        },
      });
    },
    onSuccess: (r) => setResult(r as TableCallOutput),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (profile && profile.somm_status !== "verified") {
    return <VerifiedGate />;
  }

  return (
    <div className="pt-4 pb-24 max-w-md mx-auto px-4">
      <Link to="/somm" className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3 w-3" /> Sommelier mode
      </Link>

      <h1 className="mt-2 text-h1 text-foreground">Table</h1>

      <section aria-label="Guests" className="mt-4">
        <div className="text-meta uppercase text-muted-foreground">Who's at the table?</div>

        {guests.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {guests.map((g) => (
              <div key={g.userId} className="pm-card px-3 py-2 flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-meta">
                  {g.initial}
                </div>
                <div>
                  <div className="text-meta text-foreground">{g.displayName}</div>
                  <div className="text-meta text-muted-foreground">
                    {g.archetype} · {g.via === "code" ? "via code" : "public"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${g.displayName}`}
                  onClick={() => setGuests((prev) => prev.filter((x) => x.userId !== g.userId))}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c.length < 4) return;
            claim.mutate(c);
          }}
        >
          <div className="flex-1 relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              aria-label="Guest code"
              className="w-full rounded-md border border-border bg-background/70 pl-9 pr-3 py-2 text-sub text-foreground uppercase tracking-widest focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="Guest code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters" autoCorrect="off" maxLength={8}
            />
          </div>
          <button
            type="submit"
            disabled={claim.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-primary-foreground text-sub disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
        <p className="mt-2 text-meta text-muted-foreground">
          Ask the guest to open their palate and tap "Hand over a code" — expires in 30 minutes.
        </p>

        <button
          type="button"
          onClick={() => setShowPublic((s) => !s)}
          className="mt-3 text-meta text-muted-foreground underline"
        >
          {showPublic ? "Hide public-profile lookup" : "Guest has a public profile? Look up by @username"}
        </button>
        {showPublic && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const u = username.trim();
              if (!u) return;
              resolvePublic.mutate(u);
            }}
          >
            <input
              aria-label="Public username"
              className="flex-1 rounded-md border border-border bg-background/70 px-3 py-2 text-sub text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="@username (public only)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="off" autoCorrect="off"
            />
            <button
              type="submit"
              disabled={resolvePublic.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sub disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        )}
      </section>

      <section aria-label="List source" className="mt-6">
        <div className="text-meta uppercase text-muted-foreground">The list</div>
        {houseList?.activeVersionId ? (
          <div className="pm-card mt-2 p-3 flex items-center justify-between">
            <div>
              <div className="text-sub text-foreground">{houseList.establishment}</div>
              <div className="text-meta text-muted-foreground">
                v{houseList.activeVersion} · {candidatesQ.data?.length ?? 0} bottles in stock
              </div>
            </div>
            <Link to="/somm/list" className="text-meta uppercase text-primary">Manage</Link>
          </div>
        ) : (
          <Link to="/somm/list" className="pm-card mt-2 p-3 flex items-center gap-2 text-sub text-foreground">
            <ScanLine className="h-4 w-4 text-primary" />
            Save your house list to enable table calls.
          </Link>
        )}
      </section>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => call.mutate()}
          disabled={call.isPending || guests.length === 0 || !candidatesQ.data?.length}
          className="w-full rounded-full bg-primary text-primary-foreground py-3 text-sub disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2">
            <Users className="h-4 w-4" />
            {call.isPending ? "Reading the table…" : "Call the table"}
          </span>
        </button>
      </div>

      {result && <TableResult result={result} />}
    </div>
  );
}

function VerifiedGate() {
  return (
    <div className="pt-6 max-w-md mx-auto text-center px-4">
      <h1 className="text-h1 text-foreground">Sommelier mode</h1>
      <p className="mt-2 text-sub text-muted-foreground">Verified sommeliers only.</p>
      <Link to="/palate/verify" className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-primary-foreground text-sub">
        Verify with a code
      </Link>
    </div>
  );
}

// ────────── Result ──────────

function verdictColor(v: Verdict): string {
  if (v === "loves") return "bg-primary text-primary-foreground";
  if (v === "fine") return "bg-muted text-foreground";
  return "bg-destructive/15 text-destructive";
}

function verdictLabel(v: Verdict): string {
  if (v === "loves") return "loves it";
  if (v === "fine") return "fine";
  return "not for them";
}

function TableResult({ result }: { result: TableCallOutput }) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of result.guests) m.set(g.userId, g.displayName);
    return m;
  }, [result.guests]);

  if (result.kind === "split" && result.splitPair) {
    const [a, b] = result.splitPair;
    return (
      <div className="mt-6">
        <div className="text-meta uppercase text-muted-foreground">The call</div>
        <p className="mt-2 text-sub text-foreground">{result.reasoning}</p>
        <div className="mt-3 grid gap-3">
          {[a, b].map((c) => <SplitCard key={c.candidateId} c={c} nameById={nameById} />)}
        </div>
      </div>
    );
  }

  const winner = result.winner;
  if (!winner) return null;

  return (
    <div className="mt-6">
      <div className="text-meta uppercase text-muted-foreground">The call</div>
      <div className="pm-card mt-2 p-4">
        <div className="text-h2 text-foreground">{winner.name}</div>
        {winner.producer && (
          <div className="text-sub text-muted-foreground">{winner.producer}</div>
        )}
        <p className="mt-2 text-sub text-foreground">{result.reasoning}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {winner.guests.map((g) => (
            <span key={g.userId} className={`rounded-full px-2 py-1 text-meta ${verdictColor(g.verdict)}`}>
              {nameById.get(g.userId) ?? g.initial}: {verdictLabel(g.verdict)}
            </span>
          ))}
        </div>
      </div>

      {result.alternates.length > 0 && (
        <div className="mt-6">
          <div className="text-meta uppercase text-muted-foreground">Alternates</div>
          <div className="mt-2 grid gap-2">
            {result.alternates.map((c) => (
              <div key={c.candidateId} className="pm-card p-3">
                <div className="text-sub text-foreground">{c.name}</div>
                <div className="text-meta text-muted-foreground">
                  {c.producer ?? ""}{c.producer && c.region ? " · " : ""}{c.region ?? ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SplitCard({ c, nameById }: { c: BottleWithVerdicts; nameById: Map<string, string> }) {
  return (
    <div className="pm-card p-3">
      <div className="text-sub text-foreground">{c.name}</div>
      {c.producer && <div className="text-meta text-muted-foreground">{c.producer}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.guests.filter((g) => g.verdict !== "not-for-them").map((g) => (
          <span key={g.userId} className={`rounded-full px-2 py-0.5 text-meta ${verdictColor(g.verdict)}`}>
            {nameById.get(g.userId) ?? g.initial}
          </span>
        ))}
      </div>
    </div>
  );
}
