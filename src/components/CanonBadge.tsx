import { Crown } from "lucide-react";

type Props = { size?: "sm" | "md"; title?: string; className?: string };

/** Gold crown badge marking a Canon wine. */
export function CanonBadge({ size = "sm", title = "Canon — your benchmark for this region", className = "" }: Props) {
  const px = size === "md" ? 16 : 12;
  return (
    <span
      title={title}
      aria-label="Canon wine"
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold ${className}`}
      style={{
        color: "#b8860b",
        borderColor: "color-mix(in oklab, #d4a03a 55%, transparent)",
        backgroundColor: "color-mix(in oklab, #d4a03a 16%, transparent)",
      }}
    >
      <Crown size={px} strokeWidth={2.2} fill="currentColor" />
      Canon
    </span>
  );
}
