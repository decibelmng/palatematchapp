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
  it("renders a nemesis-tier row as Dealbreaker, never Benchmark", () => {
    const html = renderToStaticMarkup(<BenchmarkTierBadge tier="nemesis" />);

    expect(html).toContain("Dealbreaker");
    expect(html).not.toContain("Benchmark");
    // Internal tier words must never reach a user-facing string (CLAUDE.md voice rule).
    expect(html).not.toContain("Nemesis");
    expect(html).not.toContain("Canon");
  });

  it("does not derive Benchmark status from a matching dealbreaker row unless tier is canon", () => {
    const html = renderToStaticMarkup(
      <BenchmarkTierBadges benchmarks={[benchmark("nemesis")]} bottleIds={["bottle-1"]} />,
    );

    expect(html).toContain("Dealbreaker");
    expect(html).not.toContain("Benchmark");
    expect(html).not.toContain("Nemesis");
    expect(html).not.toContain("Canon");
  });

  it("does not treat an existing dealbreaker row as an active benchmark on a 1★ wine", () => {
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
    };

    const html = renderToStaticMarkup(<CanonAction bottle={bottle} stars={1} />);

    // A 1★ wine offers no benchmark affordance, and the internal word never leaks.
    expect(html).not.toContain("Set as a benchmark");
    expect(html).not.toContain("Benchmark (tap to remove)");
    expect(html).not.toContain("Canon");
  });
});