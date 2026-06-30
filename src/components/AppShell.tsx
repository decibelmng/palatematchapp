import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/", label: "Code" },
    { to: "/pour", label: "Pour next" },
    { to: "/rate", label: "Rate" },
  ] as const;

  return (
    <div className="cellar-bg min-h-screen flex flex-col">
      <header className="px-5 pt-7 pb-4 flex items-center justify-between">
        <Link to="/" className="font-serif text-xl tracking-tight">
          Palate <span className="text-primary">Match</span>
        </Link>
        <button
          onClick={async () => { await supabase.auth.signOut(); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 px-5 pb-24 max-w-xl w-full mx-auto">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="max-w-xl mx-auto flex">
          {tabs.map((t) => {
            const active = pathname === t.to;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex-1 text-center py-3.5 text-sm transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
