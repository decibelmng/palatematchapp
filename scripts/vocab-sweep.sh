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
WORDS='nemesis|canon|veto|fingerprint|axis|kernel|maximin|palate code|predicted'
EXCL=(-g '!src/routes/admin*' -g '!src/components/admin/**' -g '!src/**/__tests__/**')

echo "== A) string literals =="
rg -n --pcre2 -i "(\"|'|\`)[^\"'\`]*($WORDS)[^\"'\`]*(\"|'|\`)" src "${EXCL[@]}"
echo "== B) JSX text nodes =="
rg -n --pcre2 -i ">[^<>{}\"']*($WORDS)[^<>{}\"']*<" src "${EXCL[@]}"
