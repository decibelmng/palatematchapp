import { useRatings } from "@/hooks/use-palate-data";
import { useQuizAnswers } from "@/hooks/use-quiz";
import { SEED_FADE_THRESHOLD } from "@/lib/quiz-seeds";

/** Unified calibration state used by every "unlock" surface.
 *
 *  A user is CALIBRATED enough to rank a wine list when either:
 *    - they've completed the style quiz, OR
 *    - they have at least one real rating.
 *
 *  A user is PROVISIONAL when they're calibrated by quiz alone AND have
 *  fewer than SEED_FADE_THRESHOLD real ratings. The verdict UI must label
 *  provisional predictions honestly. */
export function useCalibrationState() {
  const { data: quiz } = useQuizAnswers();
  const { data: ratings } = useRatings();
  const realCount = ratings?.length ?? 0;
  const quizCompleted = !!quiz?.completedAt;
  const calibrated = quizCompleted || realCount > 0;
  const provisional = quizCompleted && realCount < SEED_FADE_THRESHOLD;
  const source: "quiz" | "ratings" | "none" =
    !calibrated ? "none" : realCount >= SEED_FADE_THRESHOLD ? "ratings" : quizCompleted ? "quiz" : "ratings";
  return { calibrated, provisional, source, realCount, quizCompleted };
}
