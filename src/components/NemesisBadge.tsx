import { Skull } from "lucide-react";

type Props = { size?: "sm" | "md"; title?: string; className?: string };

/** Muted dark badge marking a Nemesis wine — the visual mirror of the Canon crown. */
export function NemesisBadge({ size = "sm", title = "Nemesis — your dealbreaker for this region", className = "" }: Props) {
  const px = size === "md" ? 16 : 12;
  return (
    <span
      title={title}
      aria-label="Nemesis wine"
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold ${className}`}
      style={{
        color: "var(--destructive)",
        borderColor: "color-mix(in oklab, var(--destructive) 55%, transparent)",
        backgroundColor: "color-mix(in oklab, var(--destructive) 14%, transparent)",
      }}
    >
      <Skull size={px} strokeWidth={2.2} />
      Nemesis
    </span>
  );
}
