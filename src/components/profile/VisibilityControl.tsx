import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Users } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateMyProfile } from "@/lib/friends.functions";

type Visibility = "private" | "followers" | "public";

const OPTS: Array<{ value: Visibility; label: string; hint: string; Icon: typeof Eye }> = [
  { value: "private",   label: "Private",   hint: "Only you can see your ratings + activity", Icon: EyeOff },
  { value: "followers", label: "Followers", hint: "Only accepted followers see the full profile", Icon: Users },
  { value: "public",    label: "Public",    hint: "Anyone with the link can see the full profile", Icon: Eye },
];

export function VisibilityControl({ current }: { current: Visibility }) {
  const [value, setValue] = useState<Visibility>(current);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Visibility) => updateMyProfile({ data: { visibility: v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Visibility updated");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update visibility"),
  });
  return (
    <div className="rounded-[14px] border-[0.5px] border-border bg-card/60 p-4">
      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
        Profile visibility
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {OPTS.map(({ value: v, label, Icon }) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              disabled={m.isPending}
              onClick={() => { setValue(v); m.mutate(v); }}
              className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/40"}`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {OPTS.find((o) => o.value === value)?.hint}
      </p>
    </div>
  );
}
