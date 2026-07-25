import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, UtensilsCrossed, Store, Home as HomeIcon, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/matches")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Discover — Palate Match" },
      { name: "description", content: "Find the right bottle for the moment — restaurant, shop, cellar, or shortlist." },
    ],
  }),
  component: () => <AuthGate><Discover /></AuthGate>,
});

function Discover() {
  return (
    <div className="pt-2">
      <Link
        to="/search"
        className="flex items-center gap-3 rounded-[14px] border-[0.5px] border-border bg-card px-4 py-3.5 shadow-[var(--pm-card-shadow)] hover:bg-accent transition"
      >
        <Search size={18} className="text-muted-foreground shrink-0" strokeWidth={1.8} />
        <span className="flex-1 text-[14px] text-muted-foreground">
          Search — “like my Vosne, under $80”
        </span>
      </Link>

      <p
        className="mt-8 text-[10px] uppercase text-muted-foreground"
        style={{ letterSpacing: "0.22em" }}
      >
        Discover
      </p>

      <div className="mt-3 rounded-[14px] border-[0.5px] border-border bg-card overflow-hidden shadow-[var(--pm-card-shadow)]">
        <DiscoverRow
          to="/scan"
          icon={<UtensilsCrossed size={22} strokeWidth={1.7} />}
          title="At a restaurant"
          desc="Scan the list, order the best one"
        />
        <DiscoverRow
          to="/shelf"
          icon={<Store size={22} strokeWidth={1.7} />}
          title="At a shop"
          desc="Scan a shelf, buy the best value"
        />
        <DiscoverRow
          to="/tonight"
          icon={<HomeIcon size={22} strokeWidth={1.7} />}
          title="Tonight, from my cellar"
          desc="What to open from what you own"
        />
        <DiscoverRow
          to="/shortlist"
          icon={<Sparkles size={22} strokeWidth={1.7} />}
          title="Seek these out"
          desc="10 bottles worth hunting down"
          last
        />
      </div>
    </div>
  );
}

function DiscoverRow({
  to,
  icon,
  title,
  desc,
  last,
}: {
  to: "/scan" | "/shelf" | "/tonight" | "/shortlist";
  icon: React.ReactNode;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-4 px-4 py-4 hover:bg-accent transition ${
        last ? "" : "border-b-[0.5px] border-border"
      }`}
    >
      <span className="text-primary shrink-0" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-serif text-[16px] leading-tight">{title}</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <span className="text-muted-foreground text-lg" aria-hidden="true">→</span>
    </Link>
  );
}
