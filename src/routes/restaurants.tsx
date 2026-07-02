import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/restaurants")({
  component: () => (
    <AppShell>
      <AuthGate>
        <Outlet />
      </AuthGate>
    </AppShell>
  ),
});
