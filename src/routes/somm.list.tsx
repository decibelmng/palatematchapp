import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useMyProfile } from "@/hooks/use-friends";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { ChevronLeft, ScanLine, Ban, RotateCcw, Pencil, Check } from "lucide-react";
import {
  sommGetMyHouseList, sommSaveHouseListFromScan, sommSetStock, sommCorrectItem,
  type HouseListItem,
} from "@/lib/somm.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/somm/list")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "House list — Palate Match" },
      { name: "description", content: "Persist and version your house list. Mark bottles out of stock." },
    ],
  }),
  component: () => <AuthGate><ListPage /></AuthGate>,
});

function ListPage() {
  const { data: profile } = useMyProfile();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const listQ = useQuery({
    queryKey: ["somm-house-list"],
    queryFn: () => sommGetMyHouseList(),
    enabled: !!profile && profile.somm_status === "verified",
  });
  const list = listQ.data;

  const saveFn = useServerFn(sommSaveHouseListFromScan);
  const saveFromScan = useMutation({
    mutationFn: (scanId: string) => saveFn({ data: { scanId } }),
    onSuccess: (r) => {
      toast.success(`Saved v${r.version} — ${r.added} added, ${r.removed} gone, ${r.priceChanges} price changes.`);
      qc.invalidateQueries({ queryKey: ["somm-house-list"] });
      qc.invalidateQueries({ queryKey: ["somm-candidates"] });
      setSaving(false);
    },
    onError: (e: Error) => { toast.error(friendlyError(e)); setSaving(false); },
  });

  const onSaveLatestScan = async () => {
    setSaving(true);
    try {
      // Find the caller's most recent completed scan.
      const { data, error } = await supabase
        .from("scans")
        .select("id, status, updated_at")
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Scan a wine list first, then come back here to save it.");
        setSaving(false);
        return;
      }
      saveFromScan.mutate(data[0].id as string);
    } catch (e) {
      toast.error(friendlyError(e));
      setSaving(false);
    }
  };

  if (profile && profile.somm_status !== "verified") {
    return (
      <div className="pt-6 max-w-md mx-auto text-center px-4">
        <h1 className="text-h1 text-foreground">House list</h1>
        <p className="mt-2 text-sub text-muted-foreground">Verified sommeliers only.</p>
        <Link to="/palate/verify" className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-primary-foreground text-sub">
          Verify with a code
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-24 max-w-md mx-auto px-4">
      <Link to="/somm" className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3 w-3" /> Sommelier mode
      </Link>
      <h1 className="mt-2 text-h1 text-foreground">House list</h1>
      {list?.establishment && (
        <p className="text-sub text-muted-foreground">{list.establishment}</p>
      )}

      <div className="mt-4 grid gap-2">
        <Link to="/scan/list" className="pm-card p-3 flex items-center gap-2 text-sub text-foreground">
          <ScanLine className="h-4 w-4 text-primary" />
          Scan the list to capture a fresh version
        </Link>
        <button
          type="button"
          disabled={saving || saveFromScan.isPending}
          onClick={onSaveLatestScan}
          className="pm-card p-3 flex items-center gap-2 text-sub text-foreground disabled:opacity-60 text-left"
        >
          <RotateCcw className="h-4 w-4 text-primary" />
          {saving || saveFromScan.isPending ? "Saving…" : "Save my most recent scan as a new version"}
        </button>
      </div>

      {list && list.versions.length > 0 && (
        <div className="mt-6">
          <div className="text-meta uppercase text-muted-foreground">Versions</div>
          <ul className="mt-2 space-y-1">
            {list.versions.slice(0, 6).map((v) => (
              <li key={v.id} className="text-meta text-muted-foreground">
                v{v.version} · {v.itemCount} bottles · {new Date(v.createdAt).toLocaleDateString()}
                {v.id === list.activeVersionId && <span className="ml-2 text-primary">active</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {list && list.items.length > 0 && (
        <div className="mt-6">
          <div className="text-meta uppercase text-muted-foreground">Active list — {list.items.length} items</div>
          <ul className="mt-2 space-y-2">
            {list.items.map((it) => (
              <ItemRow key={it.id} item={it} houseListId={list.houseListId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, houseListId }: { item: HouseListItem; houseListId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [producer, setProducer] = useState(item.producer ?? "");
  const [cuvee, setCuvee] = useState(item.cuvee ?? "");
  const [vintage, setVintage] = useState(item.vintage?.toString() ?? "");

  const stockFn = useServerFn(sommSetStock);
  const correctFn = useServerFn(sommCorrectItem);

  const setStock = useMutation({
    mutationFn: (oos: boolean) => stockFn({
      data: { houseListId, bottleId: item.bottleId!, outOfStock: oos },
    }),
    onSuccess: () => {
      toast.success(item.outOfStock ? "Back in stock." : "Marked out of stock.");
      qc.invalidateQueries({ queryKey: ["somm-house-list"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const correct = useMutation({
    mutationFn: () => correctFn({
      data: {
        itemId: item.id,
        producer: producer.trim() || null,
        cuvee: cuvee.trim() || null,
        vintage: vintage.trim() ? parseInt(vintage, 10) : null,
      },
    }),
    onSuccess: () => {
      toast.success("Correction saved.");
      qc.invalidateQueries({ queryKey: ["somm-house-list"] });
      setEditing(false);
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <li className={`pm-card p-3 ${item.outOfStock ? "opacity-60" : ""}`}>
      {editing ? (
        <div className="grid gap-2">
          <input className="rounded-md border border-border bg-background/70 px-2 py-1 text-sub" placeholder="Producer" value={producer} onChange={(e) => setProducer(e.target.value)} />
          <input className="rounded-md border border-border bg-background/70 px-2 py-1 text-sub" placeholder="Cuvée" value={cuvee} onChange={(e) => setCuvee(e.target.value)} />
          <input inputMode="numeric" className="rounded-md border border-border bg-background/70 px-2 py-1 text-sub" placeholder="Vintage" value={vintage} onChange={(e) => setVintage(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => correct.mutate()} disabled={correct.isPending}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-primary-foreground text-meta disabled:opacity-60">
              <Check className="h-3 w-3" /> Save
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="text-meta uppercase text-muted-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sub text-foreground">
              {item.producer || "Unknown producer"}{item.cuvee ? ` — ${item.cuvee}` : ""}
              {item.vintage ? ` · ${item.vintage}` : ""}
            </div>
            <div className="text-meta text-muted-foreground">
              {item.priceAmount != null ? `${item.currency ?? ""} ${item.priceAmount}` : "no price"}
              {item.format !== "bottle" ? ` · ${item.format}` : ""}
              {!item.bottleId && <span className="ml-1 text-amber-500">unmatched</span>}
              {item.corrected && <span className="ml-1 text-primary">corrected</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit" className="text-muted-foreground hover:text-foreground">
              <Pencil className="h-4 w-4" />
            </button>
            {item.bottleId && (
              <button
                type="button"
                onClick={() => setStock.mutate(!item.outOfStock)}
                aria-label={item.outOfStock ? "Mark back in stock" : "Mark out of stock"}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-meta ${item.outOfStock ? "bg-muted text-foreground" : "bg-destructive/10 text-destructive"}`}
              >
                <Ban className="h-3 w-3" /> {item.outOfStock ? "In stock" : "Out"}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
