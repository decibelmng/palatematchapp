import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { logWriteFailure } from "@/lib/write-failure-log";
import { friendlyError } from "@/lib/error-message";
import { searchRestaurantsFn, createRestaurantFn, attributeScanToVenueFn } from "@/lib/restaurants.functions";

export function PrescanRestaurantPicker({
  value, onChange, disabled,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  disabled: boolean;
}) {
  const searchFn = useServerFn(searchRestaurantsFn);
  const createFn = useServerFn(createRestaurantFn);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["restaurants", "prescan-search", debounced],
    enabled: debounced.length >= 2 && !value,
    queryFn: () => searchFn({ data: { q: debounced } }),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: async (name: string) => createFn({ data: { name, city: city.trim() || null } }),
    onSuccess: (row) => {
      onChange({ id: row.id, name: row.name });
      setQ("");
      toast.success(`Selected ${row.name}`);
    },
    onError: (e: any) => toast.error(friendlyError(e, "Couldn't create")),
  });

  if (value) {
    return (
      <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
        <div className="text-sub">
          <p className="text-label uppercase tracking-label text-primary">Attributing to</p>
          <p className="font-medium">{value.name}</p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-meta text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Change
          </button>
        )}
      </div>
    );
  }

  const showCreate = debounced.length >= 2 && results.data && results.data.length === 0;

  return (
    <div className="mt-4 rounded-md border border-border bg-card p-3">
      <p className="text-sub font-medium">Where are you? <span className="text-muted-foreground font-normal">(optional)</span></p>
      <p className="text-meta text-muted-foreground">Pick a restaurant now to attribute this list automatically.</p>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Restaurant name…"
        disabled={disabled}
        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sub outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
      {results.data && results.data.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
          {results.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => { onChange({ id: r.id, name: r.name }); setQ(""); }}
                className="w-full text-left px-3 py-2 text-sub hover:bg-accent/60 disabled:opacity-60"
              >
                <span className="font-medium">{r.name}</span>
                {r.city && <span className="text-muted-foreground"> · {r.city}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCreate && (
        <div className="mt-2 space-y-2">
          <p className="text-meta text-muted-foreground">No match — create it:</p>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City (optional)"
            disabled={disabled || create.isPending}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sub"
          />
          <button
            type="button"
            disabled={disabled || create.isPending || !debounced}
            onClick={() => create.mutate(debounced)}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sub font-medium disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : `Create "${debounced}"`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Attribute a saved scan to a venue, after the results are on screen.
 *
 * The only attribution surface. It writes scans.restaurant_id — the column
 * venue cards, per-venue list history and currency learning all read. The
 * former RestaurantAttribution wrote scan_logs.restaurant_id, a mirror nothing
 * reads, and has been deleted.
 */

export function VenueAttribution({
  scanId,
  scanLogId,
  initialVenue,
}: {
  scanId: string;
  scanLogId?: string | null;
  initialVenue?: string | null;
}) {
  const searchFn = useServerFn(searchRestaurantsFn);
  const createFn = useServerFn(createRestaurantFn);
  const attributeFn = useServerFn(attributeScanToVenueFn);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");
  const [open, setOpen] = useState(false);
  const [attributed, setAttributed] = useState<string | null>(initialVenue ?? null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["restaurants", "search", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: () => searchFn({ data: { q: debounced } }),
    staleTime: 30_000,
  });

  const attach = useMutation({
    mutationFn: async (r: { id: string; name: string }) =>
      attributeFn({ data: { scan_id: scanId, restaurant_id: r.id, scan_log_id: scanLogId ?? null } }),
    onSuccess: (res) => {
      setAttributed(res.restaurant_name);
      setOpen(false);
      setQ("");
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["scan"] });
      toast.success(
        res.wines > 0
          ? `Added ${res.wines} wine${res.wines === 1 ? "" : "s"} to ${res.restaurant_name}`
          : `This list is now on record at ${res.restaurant_name}`,
      );
    },
    onError: (e: any, vars) => {
      void logWriteFailure({
        table: "scans",
        operation: "update",
        error: e,
        context: { path: "attributeScanToVenueFn", scan_id: scanId, restaurant_id: vars?.id, restaurant_name: vars?.name },
      });
      toast.error(friendlyError(e, "Couldn't save the venue"));
    },
  });

  const createAndAttach = useMutation({
    mutationFn: async (name: string) => {
      const created = await createFn({ data: { name, city: city.trim() || null } });
      return attributeFn({ data: { scan_id: scanId, restaurant_id: created.id, scan_log_id: scanLogId ?? null } });
    },
    onSuccess: (res) => {
      setAttributed(res.restaurant_name);
      setOpen(false);
      setQ("");
      setCity("");
      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.success(`${res.restaurant_name} added — ${res.wines} wine${res.wines === 1 ? "" : "s"} on record`);
    },
    onError: (e: any, name) => {
      void logWriteFailure({
        table: "restaurants",
        operation: "insert",
        error: e,
        context: { path: "createRestaurantFn+attributeScanToVenueFn", scan_id: scanId, name, city: city.trim() || null },
      });
      toast.error(friendlyError(e, "Couldn't add that restaurant"));
    },
  });

  const busy = attach.isPending || createAndAttach.isPending;

  if (attributed) {
    return (
      <div className="pm-card p-3 text-sub flex items-center justify-between gap-3">
        <span className="text-foreground">
          On record at <span className="font-medium">{attributed}</span>
        </span>
        <button
          type="button"
          onClick={() => { setAttributed(null); setOpen(true); }}
          className="min-h-[44px] px-2 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Change
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pm-card w-full min-h-[44px] p-3 text-left text-sub text-foreground hover:bg-accent/40"
      >
        Where was this list? <span className="text-muted-foreground">Name the restaurant</span>
      </button>
    );
  }

  const showCreate = debounced.length >= 2 && results.data && results.data.length === 0 && !results.isFetching;

  return (
    <div className="pm-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sub font-medium text-foreground">Where was this list?</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] px-2 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Not now
        </button>
      </div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Restaurant name…"
        autoFocus
        disabled={busy}
        className="mt-2 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sub outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
      {results.data && results.data.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
          {results.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => attach.mutate({ id: r.id, name: r.name })}
                className="w-full min-h-[44px] text-left px-3 py-2 text-sub hover:bg-accent/60 disabled:opacity-60"
              >
                <span className="font-medium">{r.name}</span>
                {r.city && <span className="text-muted-foreground"> · {r.city}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCreate && (
        <div className="mt-2 space-y-2">
          <p className="text-meta text-muted-foreground">No match yet — add it:</p>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City (optional)"
            disabled={busy}
            className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sub"
          />
          <button
            type="button"
            disabled={busy || !debounced}
            onClick={() => createAndAttach.mutate(debounced)}
            className="min-h-[44px] rounded-md bg-primary text-primary-foreground px-3 py-2 text-sub font-medium disabled:opacity-60"
          >
            {createAndAttach.isPending ? "Adding…" : `Add "${debounced}"`}
          </button>
        </div>
      )}
    </div>
  );
}
