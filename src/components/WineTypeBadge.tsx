import type { WineType } from "@/lib/recommender";

type Props = {
  type: WineType | string | null | undefined;
  size?: "sm" | "md";
};

function normalize(t: WineType | string | null | undefined): WineType | null {
  if (!t) return null;
  const v = String(t).toLowerCase();
  if (v.startsWith("red")) return "red";
  if (v.startsWith("white")) return "white";
  if (v.startsWith("spark")) return "sparkling";
  if (v.startsWith("ros")) return "rose";
  if (v.startsWith("dessert")) return "dessert";
  return null;
}

const LABEL: Record<WineType, string> = {
  red: "Red",
  white: "White",
  sparkling: "Sparkling",
  rose: "Rosé",
  dessert: "Dessert",
};

/** Map each type to one of the palate-axis tokens so badges stay on-theme in
 *  both light and dark. The mapping is by color family, not by axis meaning. */
const TOKEN: Record<WineType, string> = {
  red: "var(--color-axis-fruit)",     // wine red
  white: "var(--color-axis-body)",    // gold
  sparkling: "var(--color-axis-acidity)", // cool blue
  rose: "var(--color-axis-sweet)",    // pink-violet
  dessert: "var(--color-axis-oak)",   // amber
};

export function WineTypeBadge({ type, size = "sm" }: Props) {
  const t = normalize(type);
  if (!t) return null;
  const color = TOKEN[t];
  const px = size === "md" ? "px-2.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-block rounded-full border uppercase tracking-wider ${px}`}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      {LABEL[t]}
    </span>
  );
}
