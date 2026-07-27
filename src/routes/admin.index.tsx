import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useSession } from "@/hooks/use-session";
import {
  BarChart3, Database, Search, Ticket, MessageSquare, Wand2, Bug, Wrench, Map,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin · Palate Match" }] }),
  component: () => <AuthGate><AdminHub /></AuthGate>,
});

const ADMIN_LINKS: Array<{
  to: string;
  label: string;
  description: string;
  Icon: typeof BarChart3;
}> = [
  { to: "/admin/usage",         label: "Usage",          description: "Users, DAU, ratings, scans.",             Icon: BarChart3 },
  { to: "/admin/data-capture",  label: "Data Capture",   description: "Restaurants, listings, price obs.",       Icon: Database },
  { to: "/admin/inspect",       label: "Inspect",        description: "Read-only browse of tables.",             Icon: Search },
  { to: "/admin/somm-codes",    label: "Somm Codes",     description: "Issue and revoke sommelier invites.",     Icon: Ticket },
  { to: "/admin/feedback",      label: "Feedback",       description: "Bug / confusing / idea reports.",         Icon: MessageSquare },
  { to: "/admin/corrections",   label: "Corrections",    description: "Catalog + style-profile corrections.",    Icon: Wrench },
  { to: "/admin/consensus",     label: "Consensus",      description: "Shadow consensus runs.",                  Icon: Wand2 },
  { to: "/admin/disputes",      label: "Disputes",       description: "Style-profile disputes queue.",           Icon: Bug },

  { to: "/admin/type-fix",      label: "Type Fixes",     description: "Bottle type review queue.",               Icon: Wrench },
  { to: "/admin/style-map",     label: "Style Map",      description: "Catalog QA — fingerprint scatter, region coherence.", Icon: Map },

];

function AdminHub() {
  const session = useSession();
  const isAdmin = session?.user?.id && session.user.id === import.meta.env.VITE_ADMIN_USER_ID;
  // We can't verify admin client-side reliably; the sub-pages assertAdmin.
  // If VITE_ADMIN_USER_ID isn't set, still show the hub — sub-pages will gate.

  return (
    <div className="pt-6 pb-24 space-y-4">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Admin</h1>
        <p className="text-xs text-muted-foreground">
          Read-only tools and issue-tracking. Non-admins get "Not authorized" on each page.
        </p>
      </header>

      {isAdmin === false && (
        <p className="text-meta text-muted-foreground">Signed in as non-admin — links will show "Not authorized".</p>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ADMIN_LINKS.map(({ to, label, description, Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/50 hover:bg-accent/40 transition-colors"
            >
              <Icon size={16} className="mt-0.5 text-primary" />
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-meta text-muted-foreground">{description}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
