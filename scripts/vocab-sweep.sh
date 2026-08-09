#!/usr/bin/env bash
# Standing search for banned user-facing vocabulary. Run: bash scripts/vocab-sweep.sh
#
# TWO patterns, always. The first sweep used only pattern A (quote-anchored) and
# therefore missed every bare JSX text node — a repeatable class of miss.
#   A) string literals:  "…nemesis…"  '…canon…'  `…veto…`
#   B) JSX text nodes:   <p>Your fingerprint</p>   (no quote character present)
#
# Admin surfaces legitimately keep the internal words — the constraint is guest
# and somm-facing copy — so src/routes/admin*, src/components/admin are excluded.
set -uo pipefail
cd "$(dirname "$0")/.."
# "palate code" is NOT banned. The ban existed only while the code was being
# demoted behind the archetype; that decision was reversed and the code is now
# the identity hero, so users have to learn the term. "fingerprint" stays
# banned — "style reading" is the replacement.
WORDS='nemesis|canon|veto|fingerprint|axis|kernel|maximin|predicted'
EXCL=(-g '!src/routes/admin*' -g '!src/components/admin/**' -g '!src/**/__tests__/**')

echo "== A) string literals =="
rg -n --pcre2 -i "(\"|'|\`)[^\"'\`]*($WORDS)[^\"'\`]*(\"|'|\`)" src "${EXCL[@]}"
echo "== B) JSX text nodes =="
rg -n --pcre2 -i ">[^<>{}\"']*($WORDS)[^<>{}\"']*<" src "${EXCL[@]}"

# ── C) Tailwind v4 custom-property syntax ───────────────────────────────────
# `bg-[--surface]` compiles to `background-color: --surface` — invalid CSS, so
# the declaration is dropped and the element gets NO background. It fails
# silently: no build error, no console warning, just a transparent panel over
# other text. v4 requires the paren form: `bg-(--surface)`.
# This shipped as a real bug in the scan detail sheet; it is now a standing check.
echo "== C) Tailwind v4 bracket-form custom property (must be paren form) =="
if rg -n --pcre2 -e "-\[--[a-z0-9-]+\]" src; then
  echo "FAIL: rewrite as utility-(--token)"
  exit 1
else
  echo "clean"
fi

# ── D) plpgsql OUT-name shadowing in RETURNS TABLE functions ────────────────
# A function with `RETURNS TABLE(... delta double precision ...)` exposes every
# OUT name as a plpgsql variable. A bare `delta` inside the body that also
# names a column of a table the body touches raises 42702 at CALL time — never
# at migration time, so it ships green and fails on the first real write.
# This shipped twice: save_rating_with_cascade (delta) and admin_consensus_validate
# (bottle_id). Rule: in any plpgsql RETURNS TABLE body, table-qualify EVERY
# column reference (alias the table) and prefix every local with v_.
# `SET col = …` left-hand sides and INSERT/ON CONFLICT column lists are exempt —
# those are unambiguously columns.
echo "== D) SQL: bare column refs in RETURNS TABLE bodies (manual, migrations only) =="
if [ -d supabase/migrations ]; then
  rg -n --pcre2 -e "RETURNS TABLE" supabase/migrations | tail -5 || true
  echo "reminder: qualify every column ref; prefix locals with v_"
fi
