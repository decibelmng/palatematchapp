import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/search")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Search — Palate Match" },
      { name: "description", content: "Search by intent — describe what you want in plain language." },
    ],
  }),
  component: () => <AuthGate><SearchPage /></AuthGate>,
});

function SearchPage() {
  const [q, setQ] = useState("");
  return (
    <div className="pt-2">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Home
      </Link>
      <h1 className="mt-3 font-serif text-2xl">Search</h1>
      <p className="mt-1 text-sm text-muted-foreground">Try “like my Vosne, under $80”.</p>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Search size={16} className="text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="like my Vosne, under $80"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Intent search is coming soon.</p>
    </div>
  );
}
