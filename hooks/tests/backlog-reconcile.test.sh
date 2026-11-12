#!/usr/bin/env bash
# hooks/tests/backlog-reconcile.test.sh - `check-backlog-entries.js --hippo --reconcile` against the REAL hippo binary (plan
# 2026-11-02-oc-a3-writers-use-hippo, A3.4 step 1, the --reconcile rule): every backlog row Id and ADR file number needs a record with
# that provenance value, else backlog_unimported. Needs a hippo >= 0.2.2 (HIPPO_BIN, hippo on PATH, else $HOME/.local/bin/hippo); prints SKIP [suite] and exits 0 without it.
# Repos are temp repos under a sandbox HOME (hooks/tests/lib/hippo-sandbox.sh, C6).
# Red-checks: docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/a3.4-reconcile/.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip backlog-reconcile
export HIPPO_BIN
HIPPO_BIN="$(command -v "$HIPPO_BIN")" || fail "HIPPO_BIN is not executable"
export HIPPO_BIN
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup

GATE="$REPO_ROOT/scripts/check-backlog-entries.js"
H() { "$HIPPO_BIN" --json -C "$1" "${@:2}"; }
jf() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const v=eval(process.argv[1]); console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
# rec <repo> [gate args]: run the reconcile gate in block mode; sets RC, OUT (stdout), ERR (stderr)
rec() {
  local repo="$1"; shift
  OUT="$(node "$GATE" --hippo --reconcile --mode block --target "$repo" --backlog "$repo/BACKLOG.md" "$@" 2>"$TEST_TMP/err")"; RC=$?
  ERR="$(cat "$TEST_TMP/err")"
}
row() { printf '### Row %s\n- **Id**: BL-%s\n- **Status**: open\n- **Problem**: p\n\n' "$1" "$1"; }
commit_all() { git -C "$1" add -A && git -C "$1" commit -q -m "$2" || fail "commit $2"; }

R="$(hs_mkrepo rec store)"
mkdir -p "$R/docs/dev/adr"
{ printf '# BACKLOG\n\n'; row 0001; row 0002; row 0003; } > "$R/BACKLOG.md"
printf '# First decision\n\n- **Status**: Accepted\n- **Date**: 2026-01-01\n\nbody\n' > "$R/docs/dev/adr/0001-first.md"
( cd "$R" && "$HIPPO_BIN" import --from autopilot-backlog BACKLOG.md --from adr-dir docs/dev/adr >/dev/null ) || fail "import"
commit_all "$R" import

# --- positive
rec "$R"
assert_eq "$RC" 0 "reconcile passes after import"
assert_eq "$(echo "$OUT" | jf 'd.reconcile.checked')" 4 "reconcile checked 3 rows + 1 ADR"
assert_eq "$(echo "$OUT" | jf 'd.violations.length')" 0 "no findings after import"

# --- negative control: a row added after import
row 0004 >> "$R/BACKLOG.md"
rec "$R"
assert_eq "$RC" 1 "new row after import blocks"
assert_eq "$(echo "$OUT" | jf 'd.violations[0].code')" backlog_unimported "code is backlog_unimported"
assert_eq "$(echo "$OUT" | jf 'd.violations[0].level')" block "level is block"
assert_eq "$(echo "$OUT" | jf 'd.reconcile.missing')" '["BL-0004"]' "names exactly BL-0004"

# --- negative control: an ADR added after import; the fix hint covers both sources and sorts ids
printf '# Second decision\n\n- **Status**: Accepted\n- **Date**: 2026-01-02\n\nbody\n' > "$R/docs/dev/adr/0002-second.md"
rec "$R"
assert_eq "$RC" 1 "new ADR plus new row blocks"
assert_eq "$(echo "$OUT" | jf 'd.reconcile.missing')" '["ADR-0002","BL-0004"]' "names ADR-0002 and BL-0004, sorted"
FIX="$(echo "$OUT" | jf 'd.reconcile.fix')"
assert_eq "$FIX" "hippo import --from autopilot-backlog BACKLOG.md --from adr-dir docs/dev/adr --only ADR-0002,BL-0004" "printed repair command"

# --- the printed repair command repairs (run as printed, from the repo root, only ids it names)
( cd "$R" && eval "${FIX/#hippo/\"\$HIPPO_BIN\"}" >/dev/null ) || fail "repair command failed: $FIX"
commit_all "$R" repair
rec "$R"
assert_eq "$RC" 0 "reconcile passes after the printed repair"
assert_eq "$(H "$R" list --kind issue --history | jf 'd.data.records.length')" 4 "repair created only the named record (4 issues)"

# --- ADR only missing: the hint names only the ADR source
printf '# Third decision\n\n- **Status**: Accepted\n- **Date**: 2026-01-03\n\nbody\n' > "$R/docs/dev/adr/0003-third.md"
rec "$R"
assert_eq "$(echo "$OUT" | jf 'd.reconcile.fix')" "hippo import --from adr-dir docs/dev/adr --only ADR-0003" "ADR-only hint"
rm "$R/docs/dev/adr/0003-third.md"

# --- a mention is not an id: BL-0099 in a Problem line is not required
sed -i 's/^- \*\*Problem\*\*: p$/- **Problem**: see BL-0099/' "$R/BACKLOG.md"
rec "$R"
assert_eq "$RC" 0 "an id mentioned in text is not an item id"

# --- a closed record still counts
ID2="$(H "$R" list --kind issue --history | jf 'd.data.records.find(r=>r.provenance.value==="BL-0002").id')"
H "$R" close "$ID2" done >/dev/null || fail "close BL-0002"
commit_all "$R" close
assert_eq "$(H "$R" list --kind issue --history | jf 'd.data.records.find(r=>r.provenance.value==="BL-0002").status')" done "BL-0002 record is closed"
rec "$R"
assert_eq "$RC" 0 "a closed record still counts"

# --- no ADR directory: ADR ids skipped with one info line
rm -rf "$R/docs/dev/adr"
rec "$R"
assert_eq "$RC" 0 "no ADR dir: still passes"
assert_contains "$ERR" "no ADR directory at docs/dev/adr: ADR ids skipped" "no ADR dir: one info line"

# --- --adr-dir override
mkdir -p "$R/decisions"; printf '# X\n\n- **Status**: Accepted\n- **Date**: 2026-01-01\n' > "$R/decisions/0007-x.md"
rec "$R" --adr-dir "$R/decisions"
assert_eq "$(echo "$OUT" | jf 'd.reconcile.missing')" '["ADR-0007"]' "--adr-dir is honoured"
rm -rf "$R/decisions"

# --- no store -> exit 2
R_NO="$(hs_mkrepo nostore)"; cp "$R/BACKLOG.md" "$R_NO/BACKLOG.md"
rec "$R_NO"
assert_eq "$RC" 2 "no store: exit 2"
assert_contains "$ERR" "no hippo store in" "no store: message"
assert_eq "$OUT" "" "no store: nothing on stdout"

# --- store present, hippo hidden -> exit 5, nothing printed as passing
HIPPO_BIN=/nonexistent/hippo rec "$R"
assert_eq "$RC" 5 "hippo hidden: exit 5"
assert_contains "$ERR" "hippo unusable" "hippo hidden: reason"
assert_eq "$OUT" "" "hippo hidden: nothing printed as passing"

# --- --hippo alone is not the full step
node "$GATE" --hippo --target "$R" --backlog "$R/BACKLOG.md" >/dev/null 2>"$TEST_TMP/err"; RC=$?
assert_eq "$RC" 2 "--hippo without --reconcile: exit 2"
assert_contains "$(cat "$TEST_TMP/err")" "not implemented in this change: only --reconcile" "--hippo alone: message"
node "$GATE" --reconcile --backlog "$R/BACKLOG.md" >/dev/null 2>&1; assert_eq "$?" 2 "--reconcile without --hippo: usage exit 2"

hs_exit_check
finalize_test
