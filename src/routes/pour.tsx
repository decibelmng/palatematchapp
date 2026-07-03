import { createFileRoute, Navigate } from "@tanstack/react-router";

// Legacy alias — kept as a client-side redirect to /matches.
export const Route = createFileRoute("/pour")({
  ssr: false,
  component: () => <Navigate to="/matches" replace />,
});
