import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, ScanLine, Store, Home as HomeIcon, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a wine list — Palate Match" },
      { name: "description", content: "Point your camera at any wine list to find the bottle you'll love. One tap from home." },
      { property: "og:title", content: "Scan a wine list — Palate Match" },
      { property: "og:description", content: "Point your camera at any wine list to find the bottle you'll love." },
    ],
  }),
  component: () => <AuthGate><Home /></AuthGate>,
});

function Home() {
  return (
    <div className="pt-2">
      <Link
        to="/search"
        className="flex items-center gap-3 rounded-[14px] border-[0.5px] border-border bg-card px-4 py-3 shadow-[var(--pm-card-shadow)] hover:bg-accent transition"
      >
        <Search size={16} className="text-muted-foreground shrink-0" strokeWidth={1.8} />
        <span className="flex-1 text-[13px] text-muted-foreground">
          Search — “like my Vosne, under $80”
        </span>
      </Link>

      {/* SCAN HERO — the app's front door */}
      <Link
        to="/scan/list"
        data-testid="scan-hero"
        className="mt-4 block rounded-[18px] border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-6 shadow-[var(--pm-card-shadow)] hover:border-primary transition min-h-[240px]"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 h-16 w-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center">
            <ScanLine size={36} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] uppercase text-primary"
              style={{ letterSpacing: "0.22em" }}
            >
              At a restaurant
            </p>
            <h1 className="mt-2 font-serif text-[28px] leading-[1.1] text-foreground">
              Scan a wine list
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Point the camera. We'll rank every bottle to your palate in seconds.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider text-primary">
              Open camera →
            </span>
          </div>
        </div>
      </Link>

      <p
        className="mt-8 text-[10px] uppercase text-muted-foreground"
        style={{ letterSpacing: "0.22em" }}
      >
        Other moments
      </p>

      <div className="mt-2 rounded-[14px] border-[0.5px] border-border bg-card overflow-hidden shadow-[var(--pm-card-shadow)]">
        <SecondaryRow
          to="/shelf"
          icon={<Store size={18} strokeWidth={1.7} />}
          title="At a shop"
          desc="Scan a shelf, find the best value"
        />
        <SecondaryRow
          to="/tonight"
          icon={<HomeIcon size={18} strokeWidth={1.7} />}
          title="Tonight, from my cellar"
          desc="What to open from what you own"
        />
        <SecondaryRow
          to="/shortlist"
          icon={<Sparkles size={18} strokeWidth={1.7} />}
          title="Seek these out"
          desc="10 bottles worth hunting down"
          last
        />
      </div>
    </div>
  );
}

function SecondaryRow({
  to,
  icon,
  title,
  desc,
  last,
}: {
  to: "/shelf" | "/tonight" | "/shortlist";
  icon: React.ReactNode;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <Link
      to={to}
      data-testid="secondary-row"
      className={`flex items-center gap-3 px-4 py-3 hover:bg-accent transition min-h-[56px] ${
        last ? "" : "border-b-[0.5px] border-border"
      }`}
    >
      <span className="text-muted-foreground shrink-0" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] leading-tight text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <span className="text-muted-foreground/60 text-sm" aria-hidden="true">→</span>
    </Link>
  );
}
