import { GraduationCap } from "lucide-react";

/**
 * SOMM badge — pure status chip. Renders whenever somm_status === "verified".
 * Purposefully carries no engine influence: nothing in the recommender or
 * fp_observations write path reads this component or the `somm_status` column.
 * Evidence-weight comes from user_reliability (Phase D), not from the badge.
 */
export function SommBadge({
  status,
  role,
  establishment,
  className = "",
}: {
  status: string | null | undefined;
  role?: string | null;
  establishment?: string | null;
  className?: string;
}) {
  if (status !== "verified") return null;
  const roleLabel =
    role === "sommelier" ? "Sommelier"
    : role === "store_owner" ? "Wine Store"
    : role === "beverage_lead" ? "Beverage Lead"
    : "SOMM";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase text-primary ${className}`}
      style={{ letterSpacing: "0.16em" }}
      title={establishment ?? roleLabel}
    >
      <GraduationCap className="h-3 w-3" />
      {roleLabel}
    </span>
  );
}
