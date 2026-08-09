/**
 * Instrumentation failure log.
 *
 * The measurement layer's whole purpose is producing evidence, so a write that
 * fails silently is worse than no write at all: it produces a number people
 * trust. `predicted_stars` at 0-of-739 and `restaurant_wines` at 0-of-74 were
 * both invisible for exactly this reason.
 *
 * Every failed instrumentation write lands here with enough context to identify
 * the row that was lost, and is logged at error level. Rows written + failures
 * logged = writes attempted, so the two can be compared on /admin. If the
 * failure log itself fails, the console is the last resort — we never recurse.
 */
import { supabase } from "@/integrations/supabase/client";

export async function logWriteFailure(args: {
  table: string;
  operation?: "insert" | "upsert" | "update" | "delete";
  error: unknown;
  userId?: string | null;
  context: Record<string, unknown>;
}): Promise<void> {
  const message =
    args.error instanceof Error
      ? args.error.message
      : typeof args.error === "object" && args.error && "message" in args.error
        ? String((args.error as { message: unknown }).message)
        : String(args.error);

  // Error level, with the identifying context inline — this is the signal that
  // tells us a row was lost rather than never attempted.
  console.error(
    `[write-failure] ${args.table}.${args.operation ?? "insert"} failed: ${message}`,
    args.context,
  );

  try {
    // The insert policy is `auth.uid() = user_id`, so a null user_id is
    // rejected and the failure log itself disappears — resolve the caller when
    // it wasn't passed in.
    let uid = args.userId ?? null;
    if (!uid) {
      const { data } = await supabase.auth.getUser();
      uid = data.user?.id ?? null;
    }
    const { error } = await supabase.from("write_failures").insert({
      user_id: uid,
      target_table: args.table,
      operation: args.operation ?? "insert",
      message,
      context: args.context as never,
    });

    if (error) {
      console.error("[write-failure] could not persist failure log:", error.message);
    }
  } catch (e) {
    console.error("[write-failure] could not persist failure log:", (e as Error).message);
  }
}
