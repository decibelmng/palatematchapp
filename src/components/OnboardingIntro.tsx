import { Link } from "@tanstack/react-router";
import { PalateStar, lettersFromCode } from "./PalateStar";
import { axesFor } from "@/lib/palate";

/** First-run welcome screen — shown when profile.onboarding_stage === 'intro'.
 *  Single-purpose CTA advances the stage to 'rate5' and routes to /rate. */
export function OnboardingIntro({ onStart }: { onStart: () => void }) {
  const exampleLetters = lettersFromCode("LNSND", axesFor("red"));
  return (
    <div className="pt-6 pb-10 flex flex-col items-center text-center px-2">
      <div className="opacity-90">
        <PalateStar axes={axesFor("red")} letters={exampleLetters} size={200} animate />
      </div>

      <p
        className="mt-4 text-[10px] uppercase text-muted-foreground"
        style={{ letterSpacing: "0.22em" }}
      >
        Welcome
      </p>
      <h1 className="mt-2 font-serif text-[26px] leading-tight max-w-[22ch]">
        Your palate has a code.
      </h1>
      <p className="mt-3 text-sm text-muted-foreground max-w-[36ch] leading-relaxed">
        Rate 5 wines you know you love — or don't. We compute your palate and
        rank any wine list for you.
      </p>

      <Link
        to="/rate"
        onClick={onStart}
        className="mt-7 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90"
      >
        Rate your first wine →
      </Link>

      <ol className="mt-8 grid gap-3 text-left max-w-sm w-full">
        {[
          "Rate 5 wines",
          "See your palate on the map",
          "Scan any wine list — we rank it for you",
        ].map((text, i) => (
          <li key={i} className="flex items-center gap-3 text-[13px]">
            <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-[11px]">
              {i + 1}
            </span>
            <span className={i === 0 ? "" : "text-muted-foreground"}>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
