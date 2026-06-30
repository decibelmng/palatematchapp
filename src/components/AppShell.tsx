import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const TABS = [
  { to: "/", label: "Code", icon: "✦" },
  { to: "/pour", label: "Pour next", icon: "◐" },
  { to: "/rate", label: "Rate", icon: "★" },
  { to: "/scan", label: "Scan list", icon: "⌬" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Click outside to close
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const current = TABS.find((t) => t.to === pathname) ?? TABS[0];

  return (
    <div className="cellar-bg min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 px-5 pt-5 pb-3 flex items-center justify-between bg-background/85 backdrop-blur border-b border-border/60">
        <Link to="/" className="font-serif text-xl tracking-tight">
          Palate <span className="text-primary">Match</span>
        </Link>

        <div className="flex items-center gap-2" ref={menuRef}>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-full border border-border bg-card/80 pl-3 pr-2 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <span className="text-primary text-sm leading-none">{current.icon}</span>
              <span>{current.label}</span>
              <span className="flex flex-col gap-[3px] ml-1">
                <span className="block w-3.5 h-px bg-current" />
                <span className="block w-3.5 h-px bg-current" />
                <span className="block w-3.5 h-px bg-current" />
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-52 rounded-lg border border-border bg-card shadow-xl overflow-hidden z-40"
              >
                {TABS.map((t) => {
                  const active = pathname === t.to;
                  return (
                    <Link
                      key={t.to}
                      to={t.to}
                      role="menuitem"
                      className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? "bg-accent text-primary"
                          : "text-foreground hover:bg-accent/60"
                      }`}
                    >
                      <span className="text-base w-5 text-center">{t.icon}</span>
                      <span>{t.label}</span>
                    </Link>
                  );
                })}
                <button
                  onClick={async () => { await supabase.auth.signOut(); }}
                  className="w-full text-left px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent/60 border-t border-border"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 pb-24 max-w-xl w-full mx-auto">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="max-w-xl mx-auto flex">
          {TABS.map((t) => {
            const active = pathname === t.to;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors border-t-2 ${
                  active
                    ? "text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
