import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, ScanLine } from "lucide-react";

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
      <h1 className="font-serif text-3xl mt-2">Point the camera</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick a scan mode — the camera opens on the next screen. You can attribute the scan to a restaurant before you shoot.
      </p>

      <div className="mt-6 grid gap-3">
        <PrimaryCard
          to="/scan/list"
          icon={<ScanLine size={28} strokeWidth={1.7} />}
          title="Scan a wine list"
          desc="Photograph the pages of a restaurant list. Pick the restaurant first to auto-attribute."
          cta="Open camera"
        />
        <PrimaryCard
          to="/scan/bottle"
          icon={<Camera size={28} strokeWidth={1.7} />}
          title="Scan a bottle"
          desc="Photograph a label to identify, rate, or add one wine."
          cta="Open camera"
        />
      </div>
    </div>
  );
}

function PrimaryCard({
  to, icon, title, desc, cta,
}: { to: "/scan/list" | "/scan/bottle"; icon: React.ReactNode; title: string; desc: string; cta: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border-2 border-border bg-card p-5 hover:border-primary/60 hover:bg-accent/40 transition-colors"
    >
      <div className="shrink-0 h-14 w-14 rounded-xl border border-border bg-primary/10 text-primary flex items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-serif text-lg leading-tight">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        <span className="mt-2 inline-block text-[11px] font-semibold uppercase tracking-wider text-primary">
          {cta} →
        </span>
      </div>
    </Link>
  );
}
