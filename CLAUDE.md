# CLAUDE.md — Palate Match

Context file for Claude Code. Read this first.

Last updated: 2026-07-27

---

## What this app is

Palate Match learns an individual's wine palate and matches them to bottles they
will love. It exists to do two jobs. Every design decision resolves in favour of
one of them. If a change serves neither, it does not ship.

**Job 1 — the guest.** A person is at a restaurant table with a wine list in
front of them and a server returning in sixty seconds. From lock screen to "I'll
have the Chinon": one-handed, in dim light, on bad wifi, with no instructions.

**Job 2 — the sommelier.** A guest hands over a phone. The sommelier reads their
palate in ten seconds. For a table of four, one bottle nobody regrets.

Consequences to apply without being asked:

- Under time pressure a person needs a decision, not data. Lead with the
  recommendation as a sentence; numbers are available on tap, never first.
- Fewer, larger, higher-contrast elements beat more information. When a screen
  gets crowded, cut — do not shrink type or reduce spacing.
- Honesty beats confidence. A weak match is stated plainly, not dressed up.
- Used standing, one-handed, in the dark, while being watched. Optimise for
  that, not for a desk.

Owner: Dave Sonntag. Solo founder. Wine-literate — assume domain fluency, do not
explain what Vosne-Romanée is.

---

## Current state — read before proposing work

### Live in production (palatematchapp.com)

- Design foundations: contrast-corrected tokens across three themes (light,
  dark, service), a 7-step type scale, `.pm-card` elevation, three distinct
  doubt treatments (uncertain / contested / vetoed).
- The Verdict screen. `scan.list.tsx` went 1767 → 193 lines; the decision
  surface lives in `src/components/verdict/`.
- Money and locale: currency detection per scan, format-aware price bands,
  relative value tags. Markup-versus-retail is deliberately suppressed — see
  "Known gaps".
- Benchmark / Dealbreaker naming. These are the user-facing terms. Internal
  identifiers still say canon / nemesis and that is intentional.
- Provenance infrastructure: `fp_model`, `fp_prompt_hash`, `fp_pipeline`,
  `fp_scored_at`, `fp_job_id` on `bottles`, plus `catalog_jobs` and
  `fingerprint_prompts`.
- `ax_body`, `ax_tannin`, `ax_acidity`, `ax_fruit_char` are
  `GENERATED ALWAYS AS (fp_*) STORED`. `ax_sweet` is independent.

### Sommelier — ungated and functional (was: gated off)

The gating described in earlier versions of this doc is **gone**. `/somm`,
`/somm/table`, `/somm/list` no longer redirect; each soft-gates in-component on
`somm_status === "verified"`. The verify card on `/palate` is live (real
`somm_status` check, not `{false && …}`). The full guest→consent-code→table-call
loop works end to end.

All three former privacy blockers are resolved in-tree:

1. The `expires_at` ambiguity is fixed (migration `20260727033301…`: every table
   aliased, every reference qualified, locals renamed `v_*`).
2. `sommCallTable` now returns only `winner` + `alternates` (facts-only
   `SlimBottle`, verdicts stripped) + `splitPair`. Scoring still runs over all
   candidates server-side; only those leave the handler.
3. The RLS-respecting `context.supabase` is used throughout the guest-scoring
   path. The `service_role` client lives solely in `admin-somm.functions.ts`
   behind `assertAdmin` (the invite-code surface), never the scoring path.

**Open product gaps (not privacy — finish before pushing somms hard):**

- A verified somm with no `establishment` set hits a dead end: the house list is
  required for a table call, but `establishment` is optional at verify.
- The 30-min consent grant is re-validated at scoring time, so a call assembled
  slowly can fail mid-session with no re-prompt path.
- A guest who hasn't rated a candidate's type defaults to "not for them" (3.0 →
  below FINE_MIN), so a red-only guest vetoes every white on the list.
- The deterministic 10-second brief (`sommelier-brief.ts`) is the strongest
  "read a palate fast" asset but is not reachable from the somm's table screen —
  only via the guest's `/brief` or the scan-flow dialog.
- The winner card omits region and price, which the rest of the app already has.

### Never built

- Offline support. No caching, no upload queue. The core use case is restaurant
  basements with no signal.
- Bottle scan persistence. List scans persist; bottle scans do not.

### Built since — corrections to older "never built" notes

- **Venue-based feed content is built and live-wired** (`getVenueActivity` →
  `VenueActivityCard`), reading real `scans`/`scan_wines`/`restaurants` with an
  8-wine attribution floor. It only *looks* absent on a thin database.
- **The hamburger menu is retired.** Theme, feedback, sign-out, past scans and
  friends now live on `/palate` under Account.

### IA cleanup — still open

- Reopening a saved scan renders `RankedScanList`, a flatter, downgraded surface
  vs. the live `VerdictSurface` — same data, two visual languages.
- Bottle-scan history rows self-link to a dead end (no persisted detail route).
- Two profile surfaces (`/palate` and `/u/$username`) duplicate content; the
  public one also renders the owner's own profile, so a share link shows a user
  a second, differently-designed version of themselves.

---

## Engine invariants — do not change without explicit instruction

These are deliberate architectural decisions. Each was arrived at by debugging a
specific failure. If a refactor appears to simplify one, it is reintroducing a
bug.

1. **Per-axis independent ridge regression.** Axis weights (omega) are learned
   with an independent ridge per axis. Never a joint regression. Palate axes are
   correlated and joint regression produces informationally backwards weights.

2. **Red and white are separate palates.** Computed independently, never
   blended, never compared. No code path may average across types or rank a red
   against a white.

3. **The veto is a basin rule, not a radius.** A negative anchor fires only when
   it is closer to the candidate than any positive anchor. A pure distance
   threshold over-vetoes and was replaced for that reason.

4. **Kernel sharpening (gamma = 2) is load-bearing.** It preserves multimodal
   palate structure. Real palates are frequently bimodal — the owner's red
   palate has two poles 0.7 units apart, wider than the Barolo-to-Napa distance.
   An unsharpened kernel collapses both into a meaningless midpoint.

5. **Bandwidth is adaptive**, from median pairwise distances in the user's own
   rated set. Never a fixed constant.

6. **Shrinkage is toward the per-type mean.** Not global, not a population prior.

7. **Anchors carry 3x sample weight**, one positive and one negative per
   region/type. Check the tier default explicitly — a wrong default here has
   caused a silent scoring bug.

8. **Region is not a model dimension.** Style space accounts for it. Do not add
   region as a feature, weight, or filter inside the scorer. Region centroids
   may be computed *from* fingerprints for display only.

9. **Ripeness is not sweetness.** The ripeness axis captures fruit character.
   Jammy is its ceiling; dryness is a separate axis.

10. **Vintage-aware, cuvée-aggregated.** Ratings attach to producer + cuvée +
    vintage. Cuvée averages are derived for display, never written back.

11. **Fingerprint corrections require tasting evidence**, never reputation or
    typicity priors. A wine's fame is not data.

12. **Palate versioning.** Any change to weights, anchors, or fingerprints bumps
    `palate_version` and invalidates cached predictions. Watch for column
    shadowing.

Before changing scoring math: state the change, name the invariant it touches,
and add a vitest case that fails under the old behaviour.

**Bugs already fixed once — do not reintroduce:** Nemesis tier default;
`region_key` generated-column collision; per-axis omega normalisation;
`palate_version` column shadowing; `ax_fruit_char` defaulting to 0 (making a
missing value indistinguishable from a real extreme).

---

## The catalog problem — biggest open issue

**The v1 fingerprints are a (grape, region, vintage) typicity grid with jitter,
not per-wine values.**

118,015 rows share `fp_pipeline = 'unknown_v1_bulk'`, all inserted in a single
transaction on 2026-06-30, with no tasting notes and no recoverable model
provenance. The `source` string claims "LLM-derived calibrated fingerprint" and
that claim is false — billing shows eleven gateway requests in that window, and
git history contains no Anthropic reference at any point.

Consequences:

- Corison and Caymus are the same wine to the engine. Both are Napa Cabernet.
- Barolo sits 0.5x of catalog-mean distance from Napa Cabernet. Two of the most
  stylistically opposed famous reds are middling-apart.
- Compression is severe: tannin's top three values cover 45.6% of the catalog,
  acid 43.7%, ripe 38.0%, savory 34.7%.
- **Any analysis showing regions cluster in fingerprint space is circular.** The
  region coherence work, the control group, the nearest-region results for the
  owner's palate — all superseded. They describe a lookup table agreeing with
  itself.

A v2 blinded two-step pipeline exists (`generateTastingNote` sighted, then
`scoreFromNote` blind). A 78-wine pilot **failed its gate**: within-region
variance went *down*, because grape-calibration bands and named-wine anchors in
the scoring prompt turned it into a better typicity grid.

Next step, unspent: the Kaggle `winemag-data-130k-v2.csv` `description` field is
the real per-wine tasting note for ~109,617 of these rows, dropped at ingest and
publicly recoverable. Rejoin it, strip the grape anchors from the scorer, re-run
the pilot on real human notes. Full re-fingerprint is ~$665 and thirteen hours,
and must be done as one atomic swap via shadow columns — mixed calibration is
worse than uniformly wrong calibration, because distances between a corrected
wine and an uncorrected one become artifacts of which batch they landed in.

---

## Data and privacy invariants

1. **Visibility is enforced server-side.** `profiles.visibility` (private /
   followers / public) governs every read of another user's palate. Never rely
   on the client.
2. **Group scoring is privacy-safe by construction.** Table features return
   agreement levels and aggregates. They never expose another guest's ratings,
   benchmarks, or palate — including to the sommelier.
3. **One rating row per user per bottle.** Upsert, never insert.
4. **Scans and photos are private by default.** A shared scan is scored against
   the *viewer's* palate.
5. **Facts stored once, scores computed on read.** Never persist a prediction as
   a fact.
6. **Estimated attributes are always flagged**, in data and in UI.

---

## Stack

Things commonly gotten wrong:

- **TanStack Start**, not Vite + React Router. Route files export
  `createFileRoute`. Most routes are `ssr: false` — preserve that.
- **Tailwind v4** with `@theme inline` in `src/styles.css`. There is **no**
  `tailwind.config.js`. Do not create one.
- Server logic uses TanStack server functions via `useServerFn`, not API routes.
- Supabase for data and auth. **RLS is the enforcement layer**, never client
  filtering.
- React 19, TypeScript, TanStack Query, shadcn/ui + Radix, vitest.
- Catalog is ~118,000 wines. Never fetch unbounded. Lists over 50 rows are
  virtualised.

### Local development

Package manager is **Bun** (`bun.lock`, `bunfig.toml`) — not npm.

- `bun install` — dependencies.
- `bun run dev` — Vite dev server.
- `bun run test` — vitest (73 tests; keep green).
- `bunx tsc --noEmit` — type-check (must be clean).
- `bun run lint` — eslint.

The repo lives in a normal local folder, never inside Google Drive (Drive
corrupts `.git`). `main` is production (palatematchapp.com) **and** live-synced
to Lovable — do all work on a branch, never rewrite pushed history, keep `main`
green. See `AGENTS.md`.

### Auth — read before touching routing

`/` throws `redirect({ to: "/scan/list" })` in `beforeLoad`. **A thrown TanStack
redirect discards `location.hash`.** OAuth and magic-link callbacks were landing
on `/` and having their tokens destroyed before anything could read them. This
cost roughly fifteen debugging rounds.

`/auth/callback` now exists with no `beforeLoad`, no `AuthGate`, no redirect
opinion. Both OAuth `redirect_uri` and magic-link `emailRedirectTo` point at it.
`/` carries a guard that forwards auth callbacks there with hash intact.

Never point an auth callback at a route that redirects.

Temporary auth instrumentation may still be present (`authTrace`, a debug panel,
sessionStorage writes, a `.lovable.app` test button). Remove once sign-in is
confirmed stable.

---

## Design constraints

1. Contrast is measured as the **minimum** across `--bg`, `--surface`, and
   `--surface-2`, in all three themes. State the ratio and name the worst
   surface. Never report a single-surface figure.
2. No font below 13px. Seven size tokens exist; use them. No arbitrary
   `text-[Npx]`, no inline `letterSpacing`.
3. `--amber` and `--gold-dim` are non-text tokens. Warning states use `--text`
   for words, amber for rails and icons.
4. Cards are opaque. `.pm-card` with a real 1px border at 3:1 or better.
5. Three themes: light, dark, service (true black, for dark restaurants). All
   pass every rule.
6. No hardcoded currency symbols. All price judgments are relative to the list
   in hand or to retail — never an absolute threshold.
7. 44px minimum tap targets. Real semantic elements. No nested interactives.

---

## Voice

These words must **never** appear in a user-facing string: nemesis, canon, veto,
fingerprint, axis, kernel, maximin, predicted. Internal identifiers may keep
them.

- Sensory, not technical: "silky and perfumed", not "low tannin, high aromatic
  intensity". Assume an interested amateur, not a student cramming.
- Never truncate a wine name. Ever.
- Recommendations are complete sentences. "It sits right next to the
  Vosne-Romanée you gave five stars — same silk, same perfume."
- Describe the wine's character, never the model's structure. "Skip this one —
  it's the drying, grippy style you've consistently rated low."
- Sentence case. Active voice. Errors state what happened and what to do, with
  no apology and no implementation detail.

---

## Out of scope

- New palate visualisations. There is one: `PalateStar`. `TasteMap` sits behind
  an Advanced disclosure.
- Star ratings on any decision surface. Rating happens after drinking.
- Social features beyond what exists. No comments, likes, or discovery feed.
- Gamification. No streaks, points, or levels.
- Any claim of precision the engine doesn't have: no decimal score as the
  primary readout, no percentage match.

---

## How to work here

The owner has been running this project by relaying prompts to a browser-based
build tool that could see the code while the reviewing model could not. That
relay produced several expensive failures. In Claude Code, do not reproduce it.

**Verify, don't relay.** Read the file. Run the grep. Check `git log`. Do not
report what a summary said.

**Measure, don't estimate.** Several reported contrast ratios in this project's
history were approximations that read as measurements, and one masked a real
failure (`--border-strong` was reported at 3.25 and actually measured 2.77 on
the surface that mattered). If you state a number, compute it.

**Name the denominator.** The Barolo-to-Napa separation was reported three times
as 3.44x, 0.71x, and 0.504x — three different normalisers, none stated. A ratio
without its denominator is not a measurement.

**Test the assumption one layer down.** The auth bug survived four theories
because everyone accepted "the broker returns tokens to the origin" without
checking what the landing route did with them. When behaviour contradicts
configuration, something further up is overriding it.

**Say "I don't know."** When logs aren't available or provenance is
unrecoverable, state that plainly rather than implying absence of evidence is
evidence of absence.

**Derived data carries its derivation.** If a number came from a model, the row
records which model, which prompt, and when. This project has been bitten twice
by the absence of that — once through missing tasting notes, once through
missing model records.

---

## Immediate priorities

1. **Fix the catalog.** Attempt the Kaggle description rejoin, strip grape
   anchors from the scorer, re-run the 78-wine pilot. The gate is within-region
   discrimination — can two Barolos from different producers be told apart? — not
   between-region separation, which a grid already does.
2. **Finish the sommelier product.** It is ungated and functional; close the
   open product gaps above (establishment dead-end, grant expiry mid-call,
   red-only-guest vetoes, brief not on the table screen, no price/region on the
   winner). Real codes are in the wild, and it is the monetisation path.
3. **Offline support.** The core use case has no signal and everything currently
   assumes the network works.

Unrelated to code: the app has never been used against a real restaurant wine
list. Every validation so far has been greps, contrast ratios, and synthetic
fixtures. Whether the Call picks the bottle a person would have picked is
unanswered.
