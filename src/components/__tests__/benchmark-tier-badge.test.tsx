import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BenchmarkTierBadge, BenchmarkTierBadges } from "@/components/BenchmarkTierBadge";
import type { CanonRow } from "@/hooks/use-canon";

function benchmark(tier: CanonRow["tier"], bottleId = "bottle-1"): CanonRow {
  return {
    id: `${tier}-1`,
    user_id: "user-1",
    rating_id: "rating-1",
    bottle_id: bottleId,
    region: "Piedmont",
    region_key: "piedmont",
    wine_type: "red",
    tier,
    created_at: "2026-07-11T00:00:00.000Z",
    replaced_at: null,
  };
}

describe("benchmark tier badges", () => {
  it("renders a Nemesis tier row as Nemesis, never Canon", () => {
    const html = renderToStaticMarkup(<BenchmarkTierBadge tier="nemesis" />);

    expect(html).toContain("Nemesis");
    expect(html).not.toContain("Canon");
  });

  it("does not derive Canon status from a matching benchmark row unless tier is canon", () => {
    const html = renderToStaticMarkup(
      <BenchmarkTierBadges benchmarks={[benchmark("nemesis")]} bottleIds={["bottle-1"]} />,
    );

    expect(html).toContain("Nemesis");
    expect(html).not.toContain("Canon");
  });
});