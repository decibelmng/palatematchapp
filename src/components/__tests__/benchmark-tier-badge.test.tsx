import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkTierBadge, BenchmarkTierBadges } from "@/components/BenchmarkTierBadge";
import { CanonAction } from "@/components/CanonAction";
import type { CanonRow } from "@/hooks/use-canon";
import type { BottleRow } from "@/hooks/use-palate-data";

vi.mock("@/hooks/use-canon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-canon")>();
  const nemesisRow = benchmark("nemesis");
  return {
    ...actual,
    useMyCanons: () => ({ data: [nemesisRow] }),
    useCanonForScope: () => null,
    useDemoteCanon: () => ({ mutate: vi.fn() }),
    usePromoteCanon: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

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

  it("does not let CanonAction treat an existing Nemesis benchmark as an active Canon", () => {
    const bottle: BottleRow = {
      id: "bottle-1",
      name: "Marchesi di Barolo",
      producer: "Marchesi di Barolo",
      region: "Piedmont",
      grape: "Nebbiolo",
      vintage: 2019,
      type: "red",
      critic_score: null,
      price_band: null,
      fp_fresh: 0.5,
      fp_acid: 0.5,
      fp_tannin: 0.5,
      fp_fruit_dark: 0.5,
      fp_ripe: 0.5,
      fp_oak: 0.5,
      fp_body: 0.5,
      fp_savory: 0.5,
      ax_body: 0.5,
      ax_fruit_char: 0.5,
      ax_tannin: 0.5,
      ax_acidity: 0.5,
      ax_sweet: 0.5,
      tasting_note: null,
      source: null,
      added_by: null,
      created_at: "2026-07-11T00:00:00.000Z",
      refingerprinted_at: null,
      fp_harmonized_at: null,
      fp_vec: null,
    };

    const html = renderToStaticMarkup(<CanonAction bottle={bottle} stars={1} />);

    expect(html).not.toContain("Canon");
    expect(html).not.toContain("Make Canon");
  });
});