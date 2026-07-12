import { useSommelierBrief } from "@/hooks/use-sommelier-brief";
import { SommelierBriefCard } from "@/components/SommelierBriefCard";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Modal wrapper around SommelierBriefCard. Used from the Scan flow so a
 * sommelier standing at the table gets the same brief the Share sheet
 * shows, one tap away from the scan results.
 */
export function SommelierBriefDialog({ open, onClose }: Props) {
  const brief = useSommelierBrief();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {brief.text ? (
          <SommelierBriefCard brief={brief} />
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Rate a few more wines to unlock your sommelier brief.
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}
