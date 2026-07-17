import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyProfile } from "./use-friends";
import { updateMyProfile } from "@/lib/friends.functions";

export type OnboardingStage = "intro" | "rate5" | "done";

export function useOnboardingStage(): {
  stage: OnboardingStage;
  isLoading: boolean;
  setStage: (s: OnboardingStage) => Promise<void>;
} {
  const { data, isLoading } = useMyProfile();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (s: OnboardingStage) => updateMyProfile({ data: { onboarding_stage: s } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-profile"] }),
  });
  const raw = (data?.onboarding_stage as OnboardingStage | undefined) ?? "done";
  const stage: OnboardingStage = raw === "intro" || raw === "rate5" || raw === "done" ? raw : "done";
  return {
    stage,
    isLoading,
    setStage: async (s) => { await mut.mutateAsync(s); },
  };
}
