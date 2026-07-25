import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/shortlist")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Seek These Out — Palate Match" },
      { name: "description", content: "Ten bottles worth hunting down for your palate." },
    ],
  }),
  component: () => <AuthGate><Shortlist /></AuthGate>,
});

function Shortlist() {
  return (
    <div className="pt-2">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Home
      </Link>
      <h1 className="mt-3 font-serif text-2xl">Seek these out</h1>
      <p className="mt-1 text-sm text-muted-foreground">A curated shortlist for your palate is coming soon.</p>
      <Link to="/matches" className="mt-4 inline-block text-sm text-primary underline">
        Meanwhile, see your matches →
      </Link>
    </div>
  );
}
