import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useMyProfile } from "@/hooks/use-friends";
import { Users, ListChecks, BookOpen, GraduationCap } from "lucide-react";

export const Route = createFileRoute("/somm")({
  ssr: false,
  // TEMPORARY GATE: /somm is hidden from the shipped build pending consent +
  // payload work. Direct navigation redirects to /palate. Code below is kept
  // intact so the surface can be re-enabled by removing this beforeLoad.
  beforeLoad: () => {
    throw redirect({ to: "/palate" });
  },
  head: () => ({
    meta: [
      { title: "Sommelier mode — Palate Match" },
      { name: "description", content: "Table calls, house list, and briefs — for verified sommeliers." },
    ],
  }),
  component: () => <AuthGate><SommIndex /></AuthGate>,
});

function SommIndex() {
  const { data: profile } = useMyProfile();
  if (profile && profile.somm_status !== "verified") {
    return (
      <div className="pt-6 max-w-md mx-auto text-center px-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <GraduationCap className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-h1 text-foreground">Sommelier mode</h1>
        <p className="mt-2 text-sub text-muted-foreground">
          This surface is for verified sommeliers on the floor. Enter your access code to unlock it.
        </p>
        <Link
          to="/palate/verify"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground text-sub"
        >
          Verify as a sommelier
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-6 max-w-md mx-auto px-4">
      <h1 className="text-h1 text-foreground">Sommelier mode</h1>
      <p className="mt-1 text-sub text-muted-foreground">
        For the floor. Two hands free, one bottle to call.
      </p>

      <div className="mt-6 grid gap-3">
        <SommTile to="/somm/table" icon={<Users className="h-5 w-5" />} title="Table"
          body="Read the table in ten seconds. One bottle nobody regrets." />
        <SommTile to="/somm/list" icon={<ListChecks className="h-5 w-5" />} title="House list"
          body="Persist and version your list. Mark bottles out of stock." />
        <SommTile to="/brief" icon={<BookOpen className="h-5 w-5" />} title="Your own brief"
          body="Full-screen for handing your phone to another somm." />
      </div>
    </div>
  );
}

function SommTile({ to, icon, title, body }: {
  to: string; icon: React.ReactNode; title: string; body: string;
}) {
  return (
    <Link to={to} className="pm-card p-4 flex gap-3 items-start hover:bg-accent/40">
      <div className="mt-1 rounded-full bg-primary/10 text-primary p-2">{icon}</div>
      <div>
        <div className="text-sub text-foreground">{title}</div>
        <div className="text-meta text-muted-foreground">{body}</div>
      </div>
    </Link>
  );
}
