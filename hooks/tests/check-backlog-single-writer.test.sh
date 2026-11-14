#!/usr/bin/env bash
# hooks/tests/check-backlog-single-writer.test.sh - scripts/check-backlog-single-writer.js (pre-commit guard): with a hippo store
# present, BACKLOG.md and the store must agree whenever a change touches either. Negative controls: a hand edit of BACKLOG.md (a new
# row, or a field of a stored row) is red; a store op without its row is red; the same change through `project-record.js backlog
# new|reply|close` (which writes both) is green; a repo without a store is never blocked. Needs a hippo (see
# require_hippo_or_skip); prints SKIP and exits 0 without it.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip check-backlog-single-writer
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
export HIPPO_BIN

GUARD="$REPO_ROOT/scripts/check-backlog-single-writer.js"
PR="$REPO_ROOT/scripts/project-record.js"
BL=docs/BACKLOG.md
guard() { OUT="$(node "$GUARD" --staged --target "$1" 2>&1 < /dev/null)"; RC=$?; }
pr() { local r="$1"; shift; ( cd "$r" && node "$PR" "$@" 2>&1 < /dev/null ); }
newrow() { # newrow <repo> <title> [origin flags, default --origin self] -> prints the record ULID
  local r="$1" t="$2"; shift 2
  [ $# -gt 0 ] || set -- --origin self
  ( cd "$r" && node "$PR" --json backlog new --title "$t" --trigger "when asked" --trigger-type ready --effort S \
      --source "self 2026-11-15" --problem "Problem of $t." --impact "Impact of $t." "$@" 2>/dev/null < /dev/null ) \
    | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).id)'
}

orphan() { # orphan <repo> <title>: a store record written straight with hippo (no BACKLOG.md row), with the row bullets a row needs
  printf -- '- **Since**: 2026-11-15\n- **Problem**: p\n- **Impact**: i\n- **Trigger**: when asked\n- **Source**: self 2026-11-15\n- **Pointer**: none\n' \
    | "$HIPPO_BIN" --json -C "$1" new issue --title "$2" --status open --tag origin:self --tag effort:s --tag trigger:ready --body-file - \
    | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).data.ids[0])'
}

mk() { # mk <name> [store]
  local r; r="$(hs_mkrepo "$1" "${2:-}")"
  mkdir -p "$r/docs" "$r/project/backlog"; printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$r/$BL"
  git -C "$r" add -A -f >/dev/null && git -C "$r" commit -q -m base || fail "base commit $1"
  printf '%s' "$r"
}

R="$(mk store store)"

# --- negative control: a hand-written row, no store record
printf '### hand row\n- **Id**: BL-0001\n- **Status**: open\n' >> "$R/$BL"
git -C "$R" add "$BL"
guard "$R"
assert_eq "$RC" 1 "hand-written BACKLOG.md row with a store present is red"
assert_contains "$OUT" "node scripts/project-record.js backlog" "red message names the writer"
git -C "$R" reset -q HEAD "$BL"; git -C "$R" checkout -q -- "$BL"

# --- positive: project-record writes the store and the row in one run
ID1="$(newrow "$R" "guard fixture row")"
assert_contains "$(cat "$R/$BL")" "### guard fixture row" "project-record backlog new wrote the row into BACKLOG.md"
assert_contains "$(cat "$R/$BL")" "- **Id**: BL-0001" "the row took the file's next id"
assert_contains "$(cat "$R/$BL")" "<!-- next-id: BL-0002 -->" "the next-id mark moved"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "a project-record backlog new (store op + row) is green"
git -C "$R" commit -q -m withop || fail "commit with op"

# --- negative control: hand edit of a field of a stored row
sed -i 's/^- \*\*Problem\*\*: Problem of guard fixture row\./- **Problem**: edited by hand./' "$R/$BL"
git -C "$R" add "$BL"
guard "$R"
assert_eq "$RC" 1 "hand edit of a stored row's field is red"
assert_contains "$OUT" "backlog_store_mismatch" "names the mismatch"
git -C "$R" reset -q HEAD "$BL"; git -C "$R" checkout -q -- "$BL"

# --- reply and close go through the writer too (peer row)
ID2="$(newrow "$R" "peer row" --origin peer --reporter tester --report "fleet 01ABC (tester, 2026-11-15)")"
assert_contains "$(cat "$R/$BL")" "- **Reply**: none" "peer row starts unanswered"
pr "$R" backlog reply "$ID2" --reply "2026-11-15 fleet 01XYZ" >/dev/null || fail "backlog reply"
assert_contains "$(cat "$R/$BL")" "- **Reply**: 2026-11-15 fleet 01XYZ" "reply landed in the row"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "new + reply through project-record is green"
git -C "$R" commit -q -m peer || fail "commit peer"
pr "$R" backlog close "$ID1" done >/dev/null || fail "backlog close"
assert_not_contains "$(cat "$R/$BL")" "### guard fixture row" "close removed the row"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "close through project-record is green"
git -C "$R" commit -q -m closed || fail "commit close"

# --- negative control: a writer run staged only in part (the worktree agrees, the commit would not)
ID3="$(newrow "$R" "partial stage row")"
git -C "$R" add -f .hippo
guard "$R"
assert_eq "$RC" 1 "staging only .hippo after a writer run is red"
assert_contains "$OUT" "$BL" "names the unstaged BACKLOG.md"
git -C "$R" reset -q; git -C "$R" add -f "$BL"
guard "$R"
assert_eq "$RC" 1 "staging only BACKLOG.md with .hippo dirty is red"
assert_contains "$OUT" ".hippo" "names the unstaged .hippo"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "staging BACKLOG.md and .hippo together is green"
git -C "$R" commit -q -m partial || fail "commit partial"
pr "$R" backlog close "$ID3" done >/dev/null || fail "backlog close partial"
git -C "$R" add -A -f; git -C "$R" commit -q -m partialclosed || fail "commit partial close"

# --- negative control: a store op with no row (BACKLOG.md untouched)
ORPHAN="$(orphan "$R" "orphan op")"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 1 "a store op without its BACKLOG.md row is red"
assert_contains "$OUT" "backlog_unprojected" "names the unprojected record"
assert_contains "$OUT" "$ORPHAN" "names the record id"

# --- the repair command projects it, and the commit is green
pr "$R" backlog sync "$ORPHAN" >/dev/null || fail "backlog sync"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "backlog sync puts the row in and the tree agrees again"
git -C "$R" commit -q -m synced || fail "commit sync"

# --- known drift listed in project/backlog/store-drift.json passes; a stale entry fails (the list only shrinks)
ORPHAN2="$(orphan "$R" "tolerated orphan")"
printf '{"records":{"%s":"test"}}\n' "$ORPHAN2" > "$R/project/backlog/store-drift.json"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "a listed known-drift record passes"
printf '{"records":{"%s":"test","01AAAAAAAAAAAAAAAAAAAAAAAA":"gone"}}\n' "$ORPHAN2" > "$R/project/backlog/store-drift.json"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 1 "a drift entry that no longer drifts is red"
assert_contains "$OUT" "remove it from the list" "tells to remove the stale entry"
git -C "$R" reset -q; git -C "$R" checkout -q -- . ; rm -f "$R/project/backlog/store-drift.json"

# --- range mode: a base..head with a hand edit is red
base="$(git -C "$R" rev-parse HEAD)"
printf '### range hand row\n- **Id**: BL-0099\n- **Status**: open\n' >> "$R/$BL"; git -C "$R" commit -q -am direct
OUT="$(node "$GUARD" --range "$base..HEAD" --target "$R" 2>&1 < /dev/null)"; RC=$?
assert_eq "$RC" 1 "range with a hand edit is red"

# --- no store: never blocked
N="$(mk nostore)"
printf 'x\n' >> "$N/$BL"; git -C "$N" add "$BL"
guard "$N"
assert_eq "$RC" 0 "repo without a hippo store is not guarded"

# --- usage
node "$GUARD" --bogus >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "unknown flag exits 2"

finalize_test
