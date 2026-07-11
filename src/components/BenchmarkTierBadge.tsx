import { CanonBadge } from "@/components/CanonBadge";
import { NemesisBadge } from "@/components/NemesisBadge";
import { isCanonBenchmark, isNemesisBenchmark, type BenchmarkTier, type CanonRow } from "@/hooks/use-canon";

type BadgeProps = {
  size?: "sm" | "md";
  title?: string;
  className?: string;
};

export function BenchmarkTierBadge({ tier, ...badgeProps }: BadgeProps & { tier: BenchmarkTier }) {
  if (tier === "canon") return <CanonBadge {...badgeProps} />;
  return <NemesisBadge {...badgeProps} />;
}

export function BenchmarkTierBadges({
  benchmarks,
  bottleIds,
  ...badgeProps
}: BadgeProps & {
  benchmarks: CanonRow[];
  bottleIds: string[];
}) {
  const hasCanon = bottleIds.some((id) => benchmarks.some((c) => c.bottle_id === id && isCanonBenchmark(c)));
  const hasNemesis = bottleIds.some((id) => benchmarks.some((c) => c.bottle_id === id && isNemesisBenchmark(c)));

  return (
    <>
      {hasCanon && <CanonBadge {...badgeProps} />}
      {hasNemesis && <NemesisBadge {...badgeProps} />}
    </>
  );
}