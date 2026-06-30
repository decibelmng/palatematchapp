type Props = {
  value: number | null;
  onChange: (stars: number | null) => void;
  size?: "sm" | "md";
};

export function StarTap({ value, onChange, size = "md" }: Props) {
  const px = size === "sm" ? "text-lg" : "text-2xl";
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              // Always set to n; never toggle off on repeat tap.
              if (value !== n) onChange(n);
            }}
            className={`${px} leading-none transition-colors ${
              filled ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            ★
          </button>
        );
      })}
      {value !== null && (
        <button
          type="button"
          aria-label="Clear rating"
          onClick={(e) => { e.stopPropagation(); onChange(null); }}
          className="ml-2 text-xs text-muted-foreground/60 hover:text-muted-foreground underline-offset-2 hover:underline"
        >
          clear
        </button>
      )}
    </div>
  );
}
