#!/usr/bin/env bash
# hooks/tests/check-backlog-single-writer.test.sh - scripts/check-backlog-single-writer.js (pre-commit guard): with a hippo store
# present, a commit that changes the backlog file needs a .hippo/ops entry in the same commit. Negative control: a direct edit of
# BACKLOG.md alone is red; the same edit riding with a real `project-record.js backlog new` op is green; a repo without a store is
# never blocked. Needs a hippo (see require_hippo_or_skip); prints SKIP and exits 0 without it.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip check-backlog-single-writer
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup

GUARD="$REPO_ROOT/scripts/check-backlog-single-writer.js"
PR="$REPO_ROOT/scripts/project-record.js"
BL=project/backlog/BACKLOG.md
guard() { OUT="$(node "$GUARD" --staged --target "$1" 2>&1 < /dev/null)"; RC=$?; }

mk() { # mk <name> [store]
  local r; r="$(hs_mkrepo "$1" "${2:-}")"
  mkdir -p "$r/project/backlog"; printf '# BACKLOG\n\n' > "$r/$BL"
  git -C "$r" add -A -f >/dev/null && git -C "$r" commit -q -m base || fail "base commit $1"
  printf '%s' "$r"
}

R="$(mk store store)"

# --- negative control: direct edit, no store op
printf '### hand row\n- **Status**: open\n' >> "$R/$BL"
git -C "$R" add "$BL"
guard "$R"
assert_eq "$RC" 1 "direct BACKLOG.md edit with a store present is red"
assert_contains "$OUT" "BACKLOG.md is written by scripts/project-record.js; run: node scripts/project-record.js backlog" "red message names the writer"
git -C "$R" reset -q HEAD "$BL"; git -C "$R" checkout -q -- "$BL"

# --- positive: a real project-record write plus the file change in one commit
( cd "$R" && node "$PR" backlog new --title "guard fixture row" --trigger "when asked" --trigger-type ready --effort S --origin self \
    --source "self 2026-11-15" --problem "A problem." --impact "Some impact." >/dev/null 2>&1 < /dev/null ) || fail "project-record backlog new"
printf '### guard fixture row\n- **Status**: open\n' >> "$R/$BL"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "BACKLOG.md edit riding with a project-record store op is green"
git -C "$R" commit -q -m withop || fail "commit with op"

# --- the store op alone (BACKLOG.md untouched) is green
( cd "$R" && node "$PR" backlog new --title "second row" --trigger "when asked" --trigger-type ready --effort S --origin self \
    --source "self 2026-11-15" --problem "Another." --impact "Impact." >/dev/null 2>&1 < /dev/null ) || fail "second write"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "store op without a BACKLOG.md change is green"
git -C "$R" commit -q -m op2

# --- range mode: base..head with a direct edit is red
base="$(git -C "$R" rev-parse HEAD)"
printf 'x\n' >> "$R/$BL"; git -C "$R" commit -q -am direct
OUT="$(node "$GUARD" --range "$base..HEAD" --target "$R" 2>&1 < /dev/null)"; RC=$?
assert_eq "$RC" 1 "range with a direct edit is red"

# --- no store: never blocked
N="$(mk nostore)"
printf 'x\n' >> "$N/$BL"; git -C "$N" add "$BL"
guard "$N"
assert_eq "$RC" 0 "repo without a hippo store is not guarded"

# --- usage
node "$GUARD" --bogus >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "unknown flag exits 2"

finalize_test
