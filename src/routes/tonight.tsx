import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/tonight")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Drink Tonight — Palate Match" },
      { name: "description", content: "What to open tonight from your cellar." },
    ],
  }),
  component: () => <AuthGate><Tonight /></AuthGate>,
});

function Tonight() {
  return (
    <div className="pt-2">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Home
      </Link>
      <h1 className="mt-3 font-serif text-2xl">Tonight, from my cellar</h1>
      <p className="mt-1 text-sm text-muted-foreground">Cellar suggestions are coming soon.</p>
    </div>
  );
}
