import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, GraduationCap } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { redeemSommCode } from "@/lib/profile.functions";
import { useMyProfile } from "@/hooks/use-friends";
import { SommBadge } from "@/components/profile/SommBadge";

export const Route = createFileRoute("/palate/verify")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verify as a SOMM — Palate Match" },
      { name: "description", content: "Verify your professional wine credentials to display a SOMM badge on your Palate Match profile." },
    ],
  }),
  component: () => <AuthGate><VerifyPage /></AuthGate>,
});

type Role = "sommelier" | "store_owner" | "beverage_lead" | "other";

function VerifyPage() {
  const { data: profile } = useMyProfile();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [role, setRole] = useState<Role>("sommelier");
  const [establishment, setEstablishment] = useState("");

  const redeem = useMutation({
    mutationFn: () => redeemSommCode({ data: { code: code.trim(), role, establishment: establishment.trim() || undefined } }),
    onSuccess: () => {
      toast.success("SOMM badge activated");
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      setCode("");
    },
    onError: (e: Error) => toast.error(e.message || "Invalid code"),
  });

  const verified = profile?.somm_status === "verified";

  return (
    <div className="pt-2 max-w-md mx-auto">
      <Link to="/palate" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3 w-3" /> Back to profile
      </Link>

      <div className="mt-6 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 text-primary">
          <GraduationCap className="h-7 w-7" />
        </div>
        <h1 className="mt-4 font-serif text-[24px]">Verify as a SOMM</h1>
        <p className="mt-2 text-xs text-muted-foreground max-w-sm mx-auto">
          The SOMM badge is a visible mark on your profile. It grants status, not influence — evidence
          weight in the catalog is earned separately by calibration and can be revoked.
        </p>
      </div>

      {verified && (
        <div className="mt-6 rounded-[14px] border border-primary/40 bg-primary/10 p-4 text-center">
          <SommBadge status={profile?.somm_status} role={profile?.somm_role} establishment={profile?.establishment} />
          <p className="mt-2 text-sm">You&apos;re verified as a SOMM.</p>
          {profile?.establishment && (
            <p className="text-[11px] text-muted-foreground">{profile.establishment}</p>
          )}
        </div>
      )}

      {!verified && (
        <form
          className="mt-6 space-y-4 rounded-[14px] border-[0.5px] border-border bg-card/60 p-4"
          onSubmit={(e) => { e.preventDefault(); if (!code.trim()) return; redeem.mutate(); }}
        >
          <div>
            <label className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
              Role
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["sommelier","store_owner","beverage_lead","other"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-md border px-3 py-2 text-xs ${role===r ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"}`}
                >
                  {r === "sommelier" ? "Sommelier" : r === "store_owner" ? "Wine store owner" : r === "beverage_lead" ? "Beverage lead" : "Other"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
              Establishment (optional)
            </label>
            <input
              type="text"
              value={establishment}
              onChange={(e) => setEstablishment(e.target.value)}
              placeholder="Restaurant, shop, or program"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              maxLength={120}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
              Invite code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SOMM-XXXX"
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              During MVP, verification is by invite. Payment billing coming later.
            </p>
          </div>

          <button
            type="submit"
            disabled={redeem.isPending || !code.trim()}
            className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            {redeem.isPending ? "Verifying…" : "Redeem invite code"}
          </button>
        </form>
      )}

      <p className="mt-6 text-[11px] text-muted-foreground text-center max-w-sm mx-auto">
        The badge grants profile status only. Fingerprint influence is granted separately by
        verification + calibration, capped per bottle, consensus-gated, and revocable.
      </p>
    </div>
  );
}
