import { createFileRoute, redirect } from "@tanstack/react-router";

// The per-type detail screen (with 3D cube, extra visualizations) is retired.
// One palate screen with a red/white toggle handles both. Old links redirect.
export const Route = createFileRoute("/palate/$type")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/palate" });
  },
});
