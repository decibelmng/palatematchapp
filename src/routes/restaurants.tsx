import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { listRestaurantsFn } from "@/lib/restaurants.functions";

export const Route = createFileRoute("/restaurants")({
  component: () => (
    <AppShell>
      <AuthGate>
        <RestaurantsShell />
      </AuthGate>
    </AppShell>
  ),
});

function RestaurantsShell() {
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId === "/restaurants/$id");
  if (isChild) return <Outlet />;
  return <RestaurantsList />;
}

function RestaurantsList() {
  const listFn = useServerFn(listRestaurantsFn);
  const { data, isLoading } = useQuery({
    queryKey: ["restaurants", "all"],
    queryFn: () => listFn({}),
    staleTime: 60_000,
  });

  return (
    <div className="pt-4">
      <h1 className="font-serif text-2xl">Restaurants</h1>
      <p className="text-xs text-muted-foreground mt-1">
        Wine lists built from scans. Tap one to see it with your match scores.
      </p>

      {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}

      {data && data.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No restaurants yet. Scan a wine list and attribute it to a restaurant to start building the graph.
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="mt-5 divide-y divide-border rounded-md border border-border overflow-hidden">
          {data.map((r) => (
            <li key={r.id}>
              <Link
                to="/restaurants/$id"
                params={{ id: r.id }}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{r.name}</p>
                  {r.city && <p className="text-xs text-muted-foreground">{r.city}</p>}
                </div>
                <span className="text-muted-foreground text-sm">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
