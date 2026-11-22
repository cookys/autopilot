#!/usr/bin/env bash
export TMPDIR=/tmp
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip decision-ledger-mirror
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
LEDGER="${AP_PLUGIN_ROOT:-$REPO_ROOT}/scripts/decision-ledger.js"
R="$(hs_mkrepo mirror store)"
row='{"decision_id":"example","rationale":"because"}'
run_ledger() { (cd "$R" && node "$LEDGER" "$@") 2>"$TEST_TMP/err"; }
H() { "$HIPPO_BIN" --json -C "$R" "$@"; }
get() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(eval(process.argv[1]))' "$@"; }
OUT="$(run_ledger append --kind decision --json "$row" --dedupe)"; RC=$?
assert_eq 0 "$RC" 'append succeeds'
assert_eq '' "$(cat "$TEST_TMP/err")" 'mirror has no error'
ID="$(H list --tag key:ledger:example --history | get 'd.data.records[0]?.id || ""')"
[ -n "$ID" ] || fail 'decision mirror missing by key ledger:example'
SHOW="$(H show "$ID")"
assert_eq true "$(printf '%s' "$SHOW" | get 'd.data.record.tags.includes("source:decision-ledger")')" 'decision tag'
assert_eq "$OUT" "$(printf '%s' "$SHOW" | get 'd.data.record.body.trimEnd()')" 'decision body matches row'
run_ledger append --kind decision --json "$row" --dedupe >/dev/null
assert_eq 1 "$(H list --tag key:ledger:example --history | get 'd.data.records.length')" 'dedupe leaves one record'
VETO="$(run_ledger veto --id example)"; RC=$?
assert_eq 0 "$RC" 'veto succeeds'
COUNT="$(H list --tag source:decision-ledger --history | get 'd.data.records.length')"
assert_eq 2 "$COUNT" 'veto mirrored'
VID="$(H list --tag source:decision-ledger --history | get 'd.data.records.find(r=>r.id!==process.argv[2]).id' "$ID")"
assert_eq "$VETO" "$(H show "$VID" | get 'd.data.record.body.trimEnd()')" 'veto body matches row'
run_ledger append --kind decision --json '{"decision_id":"Invalid ID","rationale":"hash key"}' >/dev/null
HASH="$(printf 'Invalid ID' | sha256sum | cut -c1-8)"
assert_eq 1 "$(H list --tag "key:ledger:$HASH" --history | get 'd.data.records.length')" 'invalid key uses sha256 prefix'
R="$(hs_mkrepo broken store)"
printf '#!/bin/sh\nexit 1\n' > "$TEST_TMP/broken"
chmod +x "$TEST_TMP/broken"
OUT="$(HIPPO_BIN="$TEST_TMP/broken" run_ledger append --kind decision --json "$row")"; RC=$?
assert_eq 0 "$RC" 'broken store append succeeds'
assert_contains "$(cat "$TEST_TMP/err")" 'decision-ledger:' 'broken store prints hint'
assert_eq "$OUT" "$(cat "$R/.git/autopilot/ledger/decisions.jsonl")" 'broken store keeps file row'
R="$(hs_mkrepo files)"
OUT="$(HIPPO_BIN="$TEST_TMP/broken" run_ledger append --kind decision --json "$row")"; RC=$?
assert_eq 0 "$RC" 'files append succeeds'
assert_eq '' "$(cat "$TEST_TMP/err")" 'files mode silent'
assert_eq "$OUT" "$(cat "$R/.git/autopilot/ledger/decisions.jsonl")" 'files output equals row'
finalize_test
