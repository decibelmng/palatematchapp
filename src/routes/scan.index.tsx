import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/scan/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan — Palate Match" },
      { name: "description", content: "Scan a restaurant wine list, or scan a bottle label to identify and rate one wine." },
    ],
  }),
  component: ScanChooser,
});

function ScanChooser() {
  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scan</p>
      <h1 className="font-serif text-3xl mt-2">What are you scanning?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick one — you can always switch after.
      </p>

      <div className="mt-6 grid gap-3">
        <ChoiceCard
          to="/scan/list"
          icon={<MenuIcon />}
          title="Scan a wine list"
          desc="Photograph a restaurant's list to see what matches your table."
        />
        <ChoiceCard
          to="/scan/bottle"
          icon={<BottleIcon />}
          title="Scan a bottle"
          desc="Photograph a label to identify, rate, or add one wine."
        />
      </div>
    </div>
  );
}

function ChoiceCard({
  to, icon, title, desc,
}: { to: "/scan/list" | "/scan/bottle"; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 hover:bg-accent/50 transition-colors"
    >
      <div className="shrink-0 h-12 w-12 rounded-lg border border-border bg-background flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-serif text-lg leading-tight">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      </div>
      <span className="ml-auto self-center text-muted-foreground group-hover:text-primary transition-colors">›</span>
    </Link>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

function BottleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2h4v3.2c0 .6.2 1.2.6 1.6l1.2 1.2c.8.8 1.2 1.9 1.2 3V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V11c0-1.1.4-2.2 1.2-3l1.2-1.2c.4-.4.6-1 .6-1.6V2Z" />
      <path d="M8 13h8" />
    </svg>
  );
}
