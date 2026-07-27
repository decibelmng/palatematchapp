import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import type { QuizAnswers } from "@/lib/quiz-seeds";

/** Read the current user's saved style-quiz answers (nullable). */
export function useQuizAnswers() {
  const session = useSession();
  return useQuery({
    queryKey: ["quiz-answers", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async (): Promise<QuizAnswers | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("quiz_answers, quiz_completed_at")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.quiz_answers as unknown;
      if (!raw || typeof raw !== "object") return null;
      return raw as QuizAnswers;
    },
    staleTime: 60_000,
  });
}

export function useSaveQuizAnswers() {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (answers: QuizAnswers) => {
      if (!session) throw new Error("Not signed in");
      const withStamp: QuizAnswers = { ...answers, completedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("profiles")
        .update({
          quiz_answers: withStamp,
          quiz_completed_at: withStamp.completedAt,
          onboarding_stage: "done",
        })
        .eq("id", session.user.id);
      if (error) throw error;
      return withStamp;
    },
    onSuccess: (saved) => {
      qc.setQueryData(["quiz-answers", session?.user.id ?? null], saved);
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["palate-version"] });
      // Force re-rank on any open scan surface.
      qc.invalidateQueries({ queryKey: ["ratings"] });
    },
  });
}
