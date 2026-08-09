/**
 * "I ordered this" — one tap, no confirmation, no modal, undoable.
 *
 * Lives on the Call, on both alternates, and on every row of the full list, so
 * the answer is always given on the screen the person is already looking at.
 * Nothing prompts for it.
 *
 * Rendered inside cards whose whole surface is an overlay <button>, so this must
 * always be a SIBLING of that overlay, never nested inside it, and needs
 * pointer-events re-enabled on the otherwise inert content layer.
 */
export function OrderedButton({
  ordered,
  onToggle,
  disabled,
  size = "default",
  wineName,
}: {
  ordered: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: "default" | "compact";
  wineName: string;
}) {
  const compact = size === "compact";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={ordered}
      aria-label={ordered ? `Undo: ordered ${wineName}` : `I ordered ${wineName}`}
      className={[
        "pointer-events-auto inline-flex items-center gap-1.5 rounded-full border font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:opacity-60",
        compact
          ? "px-2.5 py-1 min-h-11 text-meta"
          : "px-3 min-h-11 text-sub",
        ordered
          ? "border-(--good) bg-[color-mix(in_oklab,var(--good)_18%,transparent)] text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent/40",
      ].join(" ")}
    >
      <span aria-hidden>{ordered ? "✓" : "＋"}</span>
      {ordered ? "Ordered" : "I ordered this"}
    </button>
  );
}
