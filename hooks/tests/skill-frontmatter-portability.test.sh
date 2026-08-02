#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROBE="$REPO_ROOT/scripts/probe-skill-frontmatter-portability.sh"
ARTIFACT="$TEST_TMP/skill-metadata-portability.json"

assert_file_exists "$PROBE" "frontmatter portability probe exists"
bash -n "$PROBE"
assert_exit_code "$?" 0 "probe has valid shell syntax"

HELP="$(bash "$PROBE" --help 2>&1)"
assert_contains "$HELP" "--check" "probe documents check mode"
assert_contains "$HELP" "--validate" "probe documents receipt validation"

set +e
OUT="$(TMPDIR="$HOOK_TMPDIR" HOME="$HOOK_HOME" bash "$PROBE" --check --output "$ARTIFACT" 2>&1)"
EXIT=$?
set -e
assert_exit_code "$EXIT" 0 "isolated real-runtime probe reaches a truthful terminal"
assert_file_exists "$ARTIFACT" "probe writes a receipt"
assert_contains "$OUT" '"zero_residue":true' "probe reports exact temp-root cleanup"

SUMMARY="$(node - "$ARTIFACT" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log([
  'schema=' + value.schema_version,
  'type=' + value.artifact_type,
  'classification=' + value.classification,
  'attempts=' + value.attempts.length,
  'claude=' + value.attempts.find((row) => row.runtime === 'claude').outcome,
  'codex=' + value.attempts.find((row) => row.runtime === 'codex').outcome,
  'tier=' + value.fixture.unknown_field,
  'residue=' + value.cleanup.residue_paths.length,
].join('\n'));
NODE
)"
assert_contains "$SUMMARY" "schema=1" "receipt schema is frozen"
assert_contains "$SUMMARY" "type=skill_frontmatter_portability" "receipt type is frozen"
assert_contains "$SUMMARY" "attempts=2" "receipt has exactly Claude and Codex attempts"
assert_contains "$SUMMARY" "tier=tier" "receipt records the unknown field"
assert_contains "$SUMMARY" "residue=0" "receipt records no residue"
CLASSIFICATION="$(printf '%s\n' "$SUMMARY" | sed -n 's/^classification=//p')"
case "$CLASSIFICATION" in
  pass|fail|inconclusive) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "receipt classification is not a truthful terminal: $CLASSIFICATION" ;;
esac

INVALID="$TEST_TMP/invalid.json"
node - "$ARTIFACT" "$INVALID" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.classification = source.classification === 'pass' ? 'inconclusive' : 'pass';
fs.writeFileSync(process.argv[3], JSON.stringify(source));
NODE
set +e
bash "$PROBE" --validate "$INVALID" >"$TEST_TMP/invalid.out" 2>&1
EXIT=$?
set -e
assert_exit_code "$EXIT" 1 "validator rejects classification/attempt mismatch"

RESIDUE="$TEST_TMP/residue.json"
node - "$ARTIFACT" "$RESIDUE" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.cleanup.zero_residue = false;
source.cleanup.residue_paths = ['stale'];
fs.writeFileSync(process.argv[3], JSON.stringify(source));
NODE
set +e
bash "$PROBE" --validate "$RESIDUE" >"$TEST_TMP/residue.out" 2>&1
EXIT=$?
set -e
assert_exit_code "$EXIT" 1 "validator rejects residue"
assert_contains "$(cat "$TEST_TMP/residue.out")" "cleanup residue receipt is not empty" "validator explains residue failure"

MISSING="$TEST_TMP/missing.json"
node - "$ARTIFACT" "$MISSING" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.attempts = [source.attempts[0]];
fs.writeFileSync(process.argv[3], JSON.stringify(source));
NODE
set +e
bash "$PROBE" --validate "$MISSING" >"$TEST_TMP/missing.out" 2>&1
EXIT=$?
set -e
assert_exit_code "$EXIT" 1 "validator rejects missing runtime evidence"

finalize_test
