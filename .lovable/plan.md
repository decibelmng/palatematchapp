
# Network resilience + IA cleanup

Two independent tracks. Each stage lands as one working checkpoint — none of them leave the app broken between stages.

## Stage 1 — Information architecture (structural, no engine changes)

The nav is the fastest win and unblocks everything else. Once "Scan" is a single destination and the hamburger is gone, the offline states have somewhere clean to live.

1. **Collapse `/` into `/scan`.** `/` becomes a redirect to `/scan/list`. Delete the duplicate hero. The center Scan button and `/scan/list` are now the only two ways in — and the button opens straight to camera capture (already implemented).
2. **Four tabs, no hamburger.** `Scan · Cellar · Palate · Table`. Center button is Scan. Verified sommeliers see Table (goes to `/somm/table`); everyone else sees Feed under the same slot. Cellar consolidates the current `/canons`, `/wishlist`, `/scans` under one tabbed screen (we already have `/wines` for this — rename route).
3. **Palate consolidation.** Merge `/palate/$type` into `/palate` with a red/white toggle at the top. `/palate/$type` becomes a redirect for old links.
4. **Palate screen owns settings.** Theme toggle, service mode, feedback, sign-out, past scans move into an "Account" section on `/palate`. Header avatar menu is deleted.
5. **Orphan nav fix.** Every route resolves to exactly one active tab via a route→tab map. `/somm/*` → Table, `/wine/*` `/wines` `/canons` `/wishlist` `/scans` → Cellar, `/u/*` `/feed` `/friends` → Feed (or Table for somms), `/rate` → Palate, `/scan/*` `/s/*` → Scan.
6. **Retire extra palate visualizations.** Default view shows only `PalateStar`. `TasteMap` moves behind an "Advanced" `<details>` disclosure. `TasteCube`, `FingerprintSpoke`, `PalateBars` disappear from routed screens (the components stay in the repo, unimported).
7. **CalibrationMeter → sentence.** Replace percentage bars with `Rate {N} more {reds|whites} to sharpen your {red|white} picks.` One line, actionable, or nothing.

## Stage 2 — Voice + toast plumbing

8. **Toaster reposition.** Sonner `position="top-center"` on mobile (below the header), or `bottom-center` with a `offset` of 120px so it clears nav + thumb bar + A2HS. Verify at 320px width.
9. **Undo on rating actions.** `saveRating`/`clearRating` call sites emit a toast with a 5s Undo action that re-runs the inverse mutation. One helper in `src/lib/rating-toast.ts`; wire it into `useRateBottle` and the star-tap components.
10. **Voice sweep.** Grep for the three forbidden registers and rewrite:
    - Precious: "Your palate has a code", "Cellar", "Nemesis" (any lingering).
    - Engineering: "Facts stored once", "re-ranks against your current palate", "reach", "convergence", any string containing "kernel", "axis", "confidence %".
    - Report before/after counts. All output copy in sentence case, no apology, no implementation detail. Empty states become one-line invitations to act.

## Stage 3 — Offline + slow-network resilience

11. **Cached last scan.** After every successful scan load, write `{scan, ranked, cachedAt}` to `localStorage["pm.last-scan"]`. `/scan/list` and `/scan/$id` show the cached ranked list when the network request fails and render a banner: *"Offline — showing your last scan."* When the network returns, silently refresh.
12. **Upload queue.** When `navigator.onLine === false` at the moment of scan submission, stash the image blob + metadata in IndexedDB under `pm.scan-queue` and show a persistent card: *"Saved — I'll read this as soon as you're back on wifi."* A single `online` listener drains the queue in order, one at a time, and posts a toast for each result.
13. **Stall detection.** In `useScanRanking` and the scan-list result path, if 15s pass with no new wines committed, show a banner: *"Still working. Want the {N} we have so far?"* with a "Show what we have" button that ranks whatever has landed. Same guard on the initial upload → OCR round trip.
14. **Loading copy pass.** Every skeleton screen gets a one-sentence label of what's happening ("Reading the list", "Ranking against your palate", "Fetching your ratings") and, past 15s, a visible action ("Retry", "Show partial", "Use cached").

## Technical notes

- **Cache format.** `pm.last-scan` v1: `{ v: 1, scan_id, restaurant, wines: WineRow[], ranked_ids: string[], cached_at: iso }`. Version bump discards old entries.
- **Queue format.** IndexedDB `pm-queue` store, one record per pending upload: `{ id, blob, mime, restaurant_hint, queued_at }`. Drained by a hook mounted once in `AppShell`.
- **Tab-active resolution.** Central `resolveActiveTab(pathname)` used by `AppShell`; no route can render with zero tabs active.
- **Palate merge.** Keep `palate.index.tsx` as the canonical screen. `palate.$type.tsx` becomes `throw redirect({ to: "/palate", search: { type } })`.

## What I need from you

This is roughly 2-3 checkpoints of work. Confirm:

- **Ship order.** OK to do Stage 1 in this turn (IA + palate merge + calibration sentence), then Stage 2, then Stage 3 — or do you want offline first?
- **Cellar naming.** The current route is `/wines` with four tabs. Rename to `/cellar` and drop `/canons`, `/wishlist`, `/scans` as top-level routes (they stay as redirects), or keep `/wines` and just relabel the tab?
- **Table tab visibility.** Verified sommeliers only, everyone else sees Feed in that slot — confirmed? Or is Table a fifth tab that appears alongside Feed for somms?
- **Cache scope.** Cache exactly the most recent scan, or the last N (say 3) so the user can flip back to yesterday's dinner?
