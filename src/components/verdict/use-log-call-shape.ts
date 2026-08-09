import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScanRow } from "./types";
import { countPriced, pricePosition } from "./tiebreak";
import { logWriteFailure } from "@/lib/write-failure-log";

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
 * decision screen. It is NOT silent, though: a failed write is logged at error
 * level and recorded in write_failures, so "no rows" can be told apart from
 * "the write path is broken".
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

        const payload = {
            user_id: uid,
            scan_id: scanId,
            is_catalog: call.isCatalog,
            price_position: pricePosition(call, rows),
            list_size: rows.length,
            n_priced: countPriced(rows),
            palate_version: prof?.palate_version ?? null,
        };

        const { error } = await supabase
          .from("call_instrumentation")
          .upsert(payload, { onConflict: "user_id,scan_id", ignoreDuplicates: true });
        if (error) {
          await logWriteFailure({
            table: "call_instrumentation",
            operation: "upsert",
            error,
            userId: uid,
            context: {
              scan_id: scanId,
              is_catalog: payload.is_catalog,
              price_position: payload.price_position,
              list_size: payload.list_size,
            },
          });
        }
      } catch (e) {
        await logWriteFailure({
          table: "call_instrumentation",
          operation: "upsert",
          error: e,
          context: { scan_id: scanId, list_size: rows.length },
        });
      }
    })();
  }, [call, rows, scanId]);
}
