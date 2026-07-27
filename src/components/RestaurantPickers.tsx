import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { searchRestaurantsFn, createRestaurantFn, attributeScanFn } from "@/lib/restaurants.functions";

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

export function RestaurantAttribution({ scanId }: { scanId: string }) {
  const searchFn = useServerFn(searchRestaurantsFn);
  const createFn = useServerFn(createRestaurantFn);
  const attributeFn = useServerFn(attributeScanFn);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");
  const [attributed, setAttributed] = useState<{ name: string; id: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["restaurants", "search", debounced],
    enabled: debounced.length >= 2 && !attributed,
    queryFn: () => searchFn({ data: { q: debounced } }),
    staleTime: 30_000,
  });

  const attribute = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await attributeFn({ data: { scan_id: scanId, restaurant_id: id } });
      return { ...res, name };
    },
    onSuccess: (res) => {
      setAttributed({ id: res.restaurant_id, name: res.restaurant_name });
      toast.success(`Saved ${res.upserted} wine${res.upserted === 1 ? "" : "s"} to ${res.restaurant_name}`);
    },
    onError: (e: any) => toast.error(friendlyError(e, "Couldn't save")),
  });

  const createAndAttribute = useMutation({
    mutationFn: async (name: string) => {
      const created = await createFn({ data: { name, city: city.trim() || null } });
      const res = await attributeFn({ data: { scan_id: scanId, restaurant_id: created.id } });
      return { ...res, name: created.name };
    },
    onSuccess: (res) => {
      setAttributed({ id: res.restaurant_id, name: res.restaurant_name });
      toast.success(`Created ${res.restaurant_name} and saved ${res.upserted} wines`);
    },
    onError: (e: any) => toast.error(friendlyError(e, "Couldn't create restaurant")),
  });

  const busy = attribute.isPending || createAndAttribute.isPending;

  if (dismissed) return null;
  if (attributed) {
    return (
      <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-meta">
        <p className="text-foreground">Saved to <span className="font-medium">{attributed.name}</span>.</p>
      </div>
    );
  }

  const showCreate = debounced.length >= 2 && results.data && results.data.length === 0;

  return (
    <div className="mt-4 rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sub font-medium">Where are you?</p>
          <p className="text-meta text-muted-foreground">Optional — attribute this list to a restaurant.</p>
        </div>
        <button onClick={() => setDismissed(true)}
          className="text-meta text-muted-foreground hover:text-foreground underline underline-offset-2">
          Skip
        </button>
      </div>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Restaurant name…"
        disabled={busy}
        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sub outline-none focus:ring-2 focus:ring-ring" />
      {results.data && results.data.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
          {results.data.map((r) => (
            <li key={r.id}>
              <button disabled={busy} onClick={() => attribute.mutate({ id: r.id, name: r.name })}
                className="w-full text-left px-3 py-2 text-sub hover:bg-accent/60 disabled:opacity-60">
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
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (optional)"
            disabled={busy} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sub" />
          <button disabled={busy || !debounced} onClick={() => createAndAttribute.mutate(debounced)}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sub font-medium disabled:opacity-60">
            {createAndAttribute.isPending ? "Creating…" : `Create "${debounced}"`}
          </button>
        </div>
      )}
      {busy && !createAndAttribute.isPending && (
        <p className="mt-2 text-meta text-muted-foreground">Saving…</p>
      )}
    </div>
  );
}
