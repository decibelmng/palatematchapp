import { describe, it, expect } from "vitest";
import { applyControlsGrouped, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";

type Row = Parameters<typeof applyControlsGrouped>[0][number];

function r(id: string, amount: number | null, predicted = 3): Row {
  return {
    key: id,
    isCatalog: true,
    type: "red",
    predicted,
    maxSimilarity: 0.5,
    price_amount: amount,
    price_band: amount == null ? "unknown" : "$$",
    price_display: amount == null ? null : String(amount),
    price_currency: "USD",
    price_glass: null,
    price_bottle: amount,
  } as unknown as Row;
}

const rows = [r("cheap", 40), r("dear", 200), r("none", null, 4.5)];

function ctl(sort: Controls["sort"]): Controls {
  return { ...DEFAULT_CONTROLS, sort };
}

describe("unpriced wines are grouped, not silently sunk", () => {
  it("labels the tail in both price directions", () => {
    for (const sort of ["price_asc", "price_desc"] as const) {
      const g = applyControlsGrouped(rows, ctl(sort));
      expect(g).toHaveLength(2);
      expect(g[0].label).toBeNull();
      expect(g[0].rows.map((x) => x.key)).toEqual(
        sort === "price_asc" ? ["cheap", "dear"] : ["dear", "cheap"],
      );
      expect(g[1].label).toBe("No price listed");
      expect(g[1].rows.map((x) => x.key)).toEqual(["none"]);
    }
  });

  it("keeps the sort total and leaves non-price sorts ungrouped", () => {
    const g = applyControlsGrouped(rows, ctl("best"));
    expect(g).toHaveLength(1);
    expect(g[0].label).toBeNull();
    expect(g[0].rows).toHaveLength(3);
    expect(g[0].rows[0].key).toBe("none"); // highest match still wins on "best"
  });
});
