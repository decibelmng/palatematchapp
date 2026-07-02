import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/scan")({
  ssr: false,
  component: () => <AuthGate><Outlet /></AuthGate>,
});
