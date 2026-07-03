import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Star, Pencil, ScanLine, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile } from "@/hooks/use-friends";
import { ThemeToggle } from "./ThemeToggle";

const TABS = [
  { to: "/", label: "Palate", Icon: Star },
  { to: "/rate", label: "Rate", Icon: Pencil },
  { to: "/scan", label: "Scan", Icon: ScanLine },
  { to: "/restaurants", label: "Restaurants", Icon: MapPin },
] as const;

type TabTo = (typeof TABS)[number]["to"];

function initialsFor(name: string | null | undefined): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isActive(pathname: string, to: TabTo): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: profile } = useMyProfile();
  const initials = initialsFor(
    (profile as { display_name?: string | null; username?: string | null } | undefined)?.display_name
      ?? (profile as { username?: string | null } | undefined)?.username
      ?? null,
  );

  useEffect(() => { setMenuOpen(false); }, [pathname]);

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

  return (
    <div className="cellar-bg min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 px-5 pt-5 pb-3 flex items-center justify-between bg-background/85 backdrop-blur border-b border-border/60">
        <Link to="/" className="font-serif text-xl tracking-tight">
          Palate <span className="text-primary">Match</span>
        </Link>

        <div className="flex items-center gap-2" ref={menuRef}>
          <ThemeToggle />
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              className="h-9 w-9 rounded-full border border-border bg-card/80 text-xs font-semibold text-foreground hover:bg-accent transition-colors flex items-center justify-center"
            >
              {initials}
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-44 rounded-lg border border-border bg-card shadow-xl overflow-hidden z-40"
              >
                <Link
                  to="/friends"
                  role="menuitem"
                  className="block px-3 py-2.5 text-sm text-foreground hover:bg-accent/60"
                >
                  Friends
                </Link>
                <button
                  role="menuitem"
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
          {TABS.map(({ to, label, Icon }) => {
            const active = isActive(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors border-t-2 ${
                  active
                    ? "text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
