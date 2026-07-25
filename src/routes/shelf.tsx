import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/shelf")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Shop Shelf — Palate Match" },
      { name: "description", content: "Scan a shop shelf and see the best value for your palate." },
    ],
  }),
  component: () => <AuthGate><Shelf /></AuthGate>,
});

function Shelf() {
  return (
    <div className="pt-2">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Home
      </Link>
      <h1 className="mt-3 font-serif text-2xl">At a shop</h1>
      <p className="mt-1 text-sm text-muted-foreground">Shelf scan is coming soon. For now, use “Scan a wine list” — it works on shelves too.</p>
      <Link to="/scan" className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
        Open scanner
      </Link>
    </div>
  );
}
