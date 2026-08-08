import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScanRow } from "./types";
import { pricePosition } from "./tiebreak";

/**
 * Silent, append-only instrumentation. NO UI.
 *
 * The tie-break puts a clean catalog match first, and catalog coverage is
 * densest among famous, expensive producers — so the Call may skew upmarket.
 * That is the safer failure and "Spend less" mitigates it, but it should not be
 * invisible. One row per scan: was the Call a catalog match or an estimate, and
 * where did its price sit in that list's own spread.
 *
 * Never blocks or surfaces an error — a failed write must not touch the
 * decision screen.
 */
export function useLogCallShape(call: ScanRow | null, rows: ScanRow[], scanId: string | null) {
  const logged = useRef<string | null>(null);

  useEffect(() => {
    if (!call || !scanId) return;
    if (logged.current === scanId) return;
    logged.current = scanId;

    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) return;
        const { data: prof } = await supabase
          .from("profiles")
          .select("palate_version")
          .eq("id", uid)
          .maybeSingle();

        await supabase.from("call_instrumentation").upsert(
          {
            user_id: uid,
            scan_id: scanId,
            is_catalog: call.isCatalog,
            price_position: pricePosition(call, rows),
            list_size: rows.length,
            palate_version: prof?.palate_version ?? null,
          },
          { onConflict: "user_id,scan_id", ignoreDuplicates: true },
        );
      } catch {
        // Instrumentation is best-effort by design.
      }
    })();
  }, [call, rows, scanId]);
}
