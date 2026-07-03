import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/my-ratings")({
  beforeLoad: () => {
    throw redirect({ to: "/rate" });
  },
});
