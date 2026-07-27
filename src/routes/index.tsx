import { createFileRoute, redirect } from "@tanstack/react-router";

// The old home hero is retired. There is one scan destination — /scan/list —
// and one scan launcher, the center button in the nav. `/` used to render a
// duplicate hero and cold-open into /rate; both were IA noise.
export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/scan/list" });
  },
});
