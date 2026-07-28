#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CHECKER="$REPO_ROOT/scripts/implementation-campaign-check.js"
BASELINE="$REPO_ROOT/hooks/tests/fixtures/implementation-campaign/red-baseline.json"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q
git -C "$SBX" config user.email "campaign-test@example.invalid"
git -C "$SBX" config user.name "Campaign Test"
mkdir -p "$SBX/.claude"
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow
printf 'first\n' > "$SBX/README.md"
git -C "$SBX" add README.md .claude/owner-kernel-governance.json
git -C "$SBX" commit -qm "first"
printf 'second\n' >> "$SBX/README.md"
git -C "$SBX" commit -qam "second"

BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
ALT_SHA="$(git -C "$SBX" rev-parse HEAD^)"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
if [[ "$COMMON_RAW" = /* ]]; then
  COMMON_DIR="$(realpath "$COMMON_RAW")"
else
  COMMON_DIR="$(realpath "$SBX/$COMMON_RAW")"
fi
REPO_ID="git-common-dir:$COMMON_DIR"
CONTRACT="$TEST_TMP/campaign.json"
SEAL="$TEST_TMP/campaign.seal.json"

write_contract() {
  local target="$1"
  node - "$target" "$REPO_ID" "$BASE_SHA" <<'NODE'
const fs = require('fs');
const [target, repoIdentity, baseSha] = process.argv.slice(2);
const value = {
  schema_version: 1,
  ticket: 'icc-p0',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: repoIdentity,
  base_sha: baseSha,
  branch: 'impl/icc-p0',
  vertical_acceptance: ['one bounded vertical slice is verified'],
  allowed_path_prefixes: ['src/', 'hooks/tests/'],
  max_changed_files: 18,
  baseline_churn: 900,
  max_growth_ratio: 1.5,
  max_extra_churn: 450,
  max_repair_generations: 2,
  max_wall_seconds: 7200,
  verify_cmd: 'bash hooks/tests/implementation-campaign.test.sh',
  rubric_ids: ['R1', 'R2', 'R3'],
};
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
}

run_checker() {
  local stdout_file="$TEST_TMP/stdout"
  local stderr_file="$TEST_TMP/stderr"
  if [ "${1:-}" = "--help" ]; then
    HOME="$HOOK_HOME" node "$CHECKER" "$@" >"$stdout_file" 2>"$stderr_file"
  else
    HOME="$HOOK_HOME" node "$CHECKER" "$@" \
      --mission-mode "${MISSION_MODE:-shadow}" >"$stdout_file" 2>"$stderr_file"
  fi
  __RUN_EXIT=$?
  __RUN_STDOUT="$(cat "$stdout_file")"
  __RUN_STDERR="$(cat "$stderr_file")"
}

mutate_contract() {
  local target="$1"
  local expression="$2"
  node - "$target" "$expression" <<'NODE'
const fs = require('fs');
const [target, expression] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(target, 'utf8'));
Function('value', expression)(value);
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
}

write_contract "$CONTRACT"
run_checker seal --contract "$CONTRACT" --repo "$SBX" --out "$SEAL"
assert_exit_code "$__RUN_EXIT" "0" "valid campaign contract seals"
assert_contains "$__RUN_STDOUT" '"verdict": "SEALED"' "seal emits SEALED"
assert_file_exists "$SEAL" "independent seal is written"
assert_eq "$(stat -c '%a' "$SEAL")" "600" "seal is private by default"

run_checker check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL"
assert_exit_code "$__RUN_EXIT" "0" "sealed campaign contract validates"
assert_contains "$__RUN_STDOUT" '"verdict": "VALID"' "check emits VALID"

run_checker seal --contract "$CONTRACT" --repo "$SBX" --out "$SEAL"
assert_exit_code "$__RUN_EXIT" "3" "existing seal cannot be silently replaced"
assert_contains "$__RUN_STDERR" "already exists" "reseal rejection names no-clobber policy"

UNRELATED="$TEST_TMP/unrelated.json"
printf 'owner data\n' > "$UNRELATED"
run_checker seal --contract "$CONTRACT" --repo "$SBX" --out "$UNRELATED"
assert_exit_code "$__RUN_EXIT" "3" "seal cannot overwrite an unrelated regular file"
assert_eq "$(cat "$UNRELATED")" "owner data" "unrelated file contents are preserved"

SAME="$TEST_TMP/same.json"
write_contract "$SAME"
run_checker seal --contract "$SAME" --repo "$SBX" --out "$SAME"
assert_exit_code "$__RUN_EXIT" "3" "same-path seal is rejected"
assert_contains "$__RUN_STDERR" "independent" "same-path rejection names independence"

ALIAS="$TEST_TMP/alias.json"
ORIGINAL="$TEST_TMP/original.json"
write_contract "$ORIGINAL"
ln "$ORIGINAL" "$ALIAS"
run_checker seal --contract "$ORIGINAL" --repo "$SBX" --out "$ALIAS"
assert_exit_code "$__RUN_EXIT" "3" "same-inode seal alias is rejected"
assert_contains "$__RUN_STDERR" "alias" "inode alias rejection is named"

UNKNOWN="$TEST_TMP/unknown.json"
write_contract "$UNKNOWN"
mutate_contract "$UNKNOWN" "value.unreviewed = true;"
run_checker seal --contract "$UNKNOWN" --repo "$SBX" --out "$TEST_TMP/unknown.seal"
assert_exit_code "$__RUN_EXIT" "3" "unknown contract field is rejected"
assert_contains "$__RUN_STDOUT" "unknown field 'unreviewed'" "unknown field is named"

MISSING="$TEST_TMP/missing.json"
write_contract "$MISSING"
mutate_contract "$MISSING" "delete value.max_wall_seconds;"
run_checker seal --contract "$MISSING" --repo "$SBX" --out "$TEST_TMP/missing.seal"
assert_exit_code "$__RUN_EXIT" "3" "missing budget is rejected"
assert_contains "$__RUN_STDOUT" "missing required field 'max_wall_seconds'" "missing budget is named"

ESCAPE="$TEST_TMP/escape.json"
write_contract "$ESCAPE"
mutate_contract "$ESCAPE" "value.allowed_path_prefixes = ['../secret'];"
run_checker seal --contract "$ESCAPE" --repo "$SBX" --out "$TEST_TMP/escape.seal"
assert_exit_code "$__RUN_EXIT" "3" "path escape is rejected"
assert_contains "$__RUN_STDOUT" "path escapes" "path escape reason is named"

ABSOLUTE="$TEST_TMP/absolute.json"
write_contract "$ABSOLUTE"
mutate_contract "$ABSOLUTE" "value.allowed_path_prefixes = ['/tmp'];"
run_checker seal --contract "$ABSOLUTE" --repo "$SBX" --out "$TEST_TMP/absolute.seal"
assert_exit_code "$__RUN_EXIT" "3" "absolute path prefix is rejected"
assert_contains "$__RUN_STDOUT" "path escapes" "absolute path rejection is specific"

WINDOWS="$TEST_TMP/windows.json"
write_contract "$WINDOWS"
mutate_contract "$WINDOWS" "value.allowed_path_prefixes = ['C:\\\\\\\\outside'];"
run_checker seal --contract "$WINDOWS" --repo "$SBX" --out "$TEST_TMP/windows.seal"
assert_exit_code "$__RUN_EXIT" "3" "Windows drive path is rejected on every host"
assert_contains "$__RUN_STDOUT" "path escapes" "Windows path rejection is specific"

WINDOWS_SLASH="$TEST_TMP/windows-slash.json"
write_contract "$WINDOWS_SLASH"
mutate_contract "$WINDOWS_SLASH" "value.allowed_path_prefixes = ['C:/outside'];"
run_checker seal --contract "$WINDOWS_SLASH" --repo "$SBX" --out "$TEST_TMP/windows-slash.seal"
assert_exit_code "$__RUN_EXIT" "3" "Windows forward-slash drive path is rejected on every host"

WINDOWS_DRIVE_RELATIVE="$TEST_TMP/windows-drive-relative.json"
write_contract "$WINDOWS_DRIVE_RELATIVE"
mutate_contract "$WINDOWS_DRIVE_RELATIVE" "value.allowed_path_prefixes = ['C:outside'];"
run_checker seal --contract "$WINDOWS_DRIVE_RELATIVE" --repo "$SBX" \
  --out "$TEST_TMP/windows-drive-relative.seal"
assert_exit_code "$__RUN_EXIT" "3" "Windows drive-relative path is rejected on every host"

NESTED_GIT="$TEST_TMP/nested-git.json"
write_contract "$NESTED_GIT"
mutate_contract "$NESTED_GIT" "value.allowed_path_prefixes = ['worker/.git/objects'];"
run_checker seal --contract "$NESTED_GIT" --repo "$SBX" --out "$TEST_TMP/nested-git.seal"
assert_exit_code "$__RUN_EXIT" "3" "nested Git metadata path is rejected"
assert_contains "$__RUN_STDOUT" "path escapes" "nested Git metadata rejection is specific"

WINDOWS_GIT_ALIAS="$TEST_TMP/windows-git-alias.json"
write_contract "$WINDOWS_GIT_ALIAS"
mutate_contract "$WINDOWS_GIT_ALIAS" "value.allowed_path_prefixes = ['worker/.GiT./objects'];"
run_checker seal --contract "$WINDOWS_GIT_ALIAS" --repo "$SBX" \
  --out "$TEST_TMP/windows-git-alias.seal"
assert_exit_code "$__RUN_EXIT" "3" "Win32 trailing-dot Git alias is rejected"

WINDOWS_ADS="$TEST_TMP/windows-ads.json"
write_contract "$WINDOWS_ADS"
mutate_contract "$WINDOWS_ADS" \
  "value.allowed_path_prefixes = ['worker/.git::\$INDEX_ALLOCATION'];"
run_checker seal --contract "$WINDOWS_ADS" --repo "$SBX" --out "$TEST_TMP/windows-ads.seal"
assert_exit_code "$__RUN_EXIT" "3" "Win32 alternate-data-stream alias is rejected"

WINDOWS_DEVICE="$TEST_TMP/windows-device.json"
write_contract "$WINDOWS_DEVICE"
mutate_contract "$WINDOWS_DEVICE" "value.allowed_path_prefixes = ['worker/CON.txt'];"
run_checker seal --contract "$WINDOWS_DEVICE" --repo "$SBX" \
  --out "$TEST_TMP/windows-device.seal"
assert_exit_code "$__RUN_EXIT" "3" "Win32 reserved device name with extension is rejected"

WINDOWS_DEVICE_NUMBERED="$TEST_TMP/windows-device-numbered.json"
write_contract "$WINDOWS_DEVICE_NUMBERED"
mutate_contract "$WINDOWS_DEVICE_NUMBERED" "value.allowed_path_prefixes = ['worker/lPt9/log'];"
run_checker seal --contract "$WINDOWS_DEVICE_NUMBERED" --repo "$SBX" \
  --out "$TEST_TMP/windows-device-numbered.seal"
assert_exit_code "$__RUN_EXIT" "3" "Win32 numbered device name is rejected case-insensitively"

WHITESPACE="$TEST_TMP/whitespace.json"
write_contract "$WHITESPACE"
mutate_contract "$WHITESPACE" "value.allowed_path_prefixes = ['src/.. /outside'];"
run_checker seal --contract "$WHITESPACE" --repo "$SBX" --out "$TEST_TMP/whitespace.seal"
assert_exit_code "$__RUN_EXIT" "3" "whitespace-obfuscated segment is rejected"

BAD_BRANCH="$TEST_TMP/bad-branch.json"
write_contract "$BAD_BRANCH"
mutate_contract "$BAD_BRANCH" "value.branch = '../impl/icc-p0';"
run_checker seal --contract "$BAD_BRANCH" --repo "$SBX" --out "$TEST_TMP/bad-branch.seal"
assert_exit_code "$__RUN_EXIT" "3" "ref traversal branch is rejected"
assert_contains "$__RUN_STDOUT" "invalid Git branch name" "branch rejection is specific"

OPTION_BRANCH="$TEST_TMP/option-branch.json"
write_contract "$OPTION_BRANCH"
mutate_contract "$OPTION_BRANCH" "value.branch = '--help';"
run_checker seal --contract "$OPTION_BRANCH" --repo "$SBX" --out "$TEST_TMP/option-branch.seal"
assert_exit_code "$__RUN_EXIT" "3" "option-shaped branch is rejected before Git parsing"
assert_contains "$__RUN_STDOUT" "invalid Git branch name" "option-shaped branch rejection is specific"

VERIFY_INJECTION="$TEST_TMP/verify-injection.json"
write_contract "$VERIFY_INJECTION"
mutate_contract "$VERIFY_INJECTION" "value.verify_cmd = 'true; touch /tmp/campaign-pwn';"
run_checker seal --contract "$VERIFY_INJECTION" --repo "$SBX" --out "$TEST_TMP/verify-injection.seal"
assert_exit_code "$__RUN_EXIT" "3" "verify command shell chaining is rejected"
assert_contains "$__RUN_STDOUT" "without shell control operators" "verify command rejection is specific"

PROFILE="$TEST_TMP/profile.json"
write_contract "$PROFILE"
mutate_contract "$PROFILE" "value.max_repair_generations = 3;"
run_checker seal --contract "$PROFILE" --repo "$SBX" --out "$TEST_TMP/profile.seal"
assert_exit_code "$__RUN_EXIT" "3" "POC repair ceiling increase is rejected"
assert_contains "$__RUN_STDOUT" "exceeds poc ceiling 2" "profile ceiling rejection is specific"

CHURN="$TEST_TMP/churn.json"
write_contract "$CHURN"
mutate_contract "$CHURN" "value.max_extra_churn = 451;"
run_checker seal --contract "$CHURN" --repo "$SBX" --out "$TEST_TMP/churn.seal"
assert_exit_code "$__RUN_EXIT" "3" "ratio-inconsistent churn ceiling is rejected"
assert_contains "$__RUN_STDOUT" "ratio-derived ceiling 450" "churn ceiling is deterministic"

UNBOUNDED="$TEST_TMP/unbounded.json"
write_contract "$UNBOUNDED"
mutate_contract "$UNBOUNDED" "value.max_changed_files = Number.MAX_SAFE_INTEGER;"
run_checker seal --contract "$UNBOUNDED" --repo "$SBX" --out "$TEST_TMP/unbounded.seal"
assert_exit_code "$__RUN_EXIT" "3" "effectively unbounded file budget is rejected"
assert_contains "$__RUN_STDOUT" "1..4096" "absolute file ceiling is schema-derived"

DRIFT="$TEST_TMP/drift.json"
DRIFT_SEAL="$TEST_TMP/drift.seal"
write_contract "$DRIFT"
run_checker seal --contract "$DRIFT" --repo "$SBX" --out "$DRIFT_SEAL"
mutate_contract "$DRIFT" "value.branch = 'impl/drifted';"
run_checker check --contract "$DRIFT" --repo "$SBX" --seal "$DRIFT_SEAL"
assert_exit_code "$__RUN_EXIT" "3" "post-seal contract mutation is rejected"
assert_contains "$__RUN_STDOUT" '"verdict": "DRIFT"' "mutation produces DRIFT"
assert_contains "$__RUN_STDOUT" '"contract_sha256"' "mutation names digest drift"

SHA_DRIFT="$TEST_TMP/sha-drift.json"
SHA_SEAL="$TEST_TMP/sha-drift.seal"
write_contract "$SHA_DRIFT"
run_checker seal --contract "$SHA_DRIFT" --repo "$SBX" --out "$SHA_SEAL"
mutate_contract "$SHA_DRIFT" "value.base_sha = '$ALT_SHA';"
run_checker check --contract "$SHA_DRIFT" --repo "$SBX" --seal "$SHA_SEAL"
assert_exit_code "$__RUN_EXIT" "3" "post-seal base SHA change is rejected"
assert_contains "$__RUN_STDOUT" '"contract_sha256"' "base SHA drift changes sealed digest"

CEILING_DRIFT="$TEST_TMP/ceiling-drift.json"
CEILING_SEAL="$TEST_TMP/ceiling-drift.seal"
write_contract "$CEILING_DRIFT"
mutate_contract "$CEILING_DRIFT" "value.max_changed_files = 17;"
run_checker seal --contract "$CEILING_DRIFT" --repo "$SBX" --out "$CEILING_SEAL"
mutate_contract "$CEILING_DRIFT" "value.max_changed_files = 18;"
run_checker check --contract "$CEILING_DRIFT" --repo "$SBX" --seal "$CEILING_SEAL"
assert_exit_code "$__RUN_EXIT" "3" "post-seal ceiling increase is rejected"
assert_contains "$__RUN_STDOUT" '"verdict": "DRIFT"' "ceiling increase is seal drift"

BAD_ID="$TEST_TMP/bad-id.json"
write_contract "$BAD_ID"
mutate_contract "$BAD_ID" "value.repo_identity = 'git-common-dir:/wrong';"
run_checker seal --contract "$BAD_ID" --repo "$SBX" --out "$TEST_TMP/bad-id.seal"
assert_exit_code "$__RUN_EXIT" "3" "repository identity mismatch is rejected"
assert_contains "$__RUN_STDOUT" "canonical repository identity" "identity rejection is specific"

ENFORCED_GRANT="$TEST_TMP/enforced-grant.json"
write_contract "$ENFORCED_GRANT"
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" enforce
MISSION_MODE=enforce run_checker seal --contract "$ENFORCED_GRANT" --repo "$SBX" \
  --out "$TEST_TMP/enforced-grant.seal"
assert_exit_code "$__RUN_EXIT" "3" "enforced Mission rejects a null parent grant"
assert_contains "$__RUN_STDOUT" "required when Mission enforcement is enabled" \
  "enforced parent rejection is specific"

GRANT_HASH="$(printf 'a%.0s' {1..64})"
mutate_contract "$ENFORCED_GRANT" "value.mission_grant_ref = '$GRANT_HASH';"
MISSION_MODE=enforce run_checker seal --contract "$ENFORCED_GRANT" --repo "$SBX" \
  --out "$TEST_TMP/enforced-grant.seal"
assert_exit_code "$__RUN_EXIT" "3" "unverified grant hash cannot enable Mission enforcement"
assert_contains "$__RUN_STDOUT" "unavailable until Mission integration" \
  "pre-integration Mission enforcement fails closed"

MISSION_MODE=shadow run_checker seal --contract "$CONTRACT" --repo "$SBX" \
  --out "$TEST_TMP/downgraded-mode.seal"
assert_exit_code "$__RUN_EXIT" "3" "caller cannot downgrade authoritative Mission enforcement"
assert_contains "$__RUN_STDERR" "does not match authoritative project mode" \
  "mode downgrade rejection names the authority mismatch"

write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow

OBJECT_FORMAT="$TEST_TMP/object-format.json"
write_contract "$OBJECT_FORMAT"
mutate_contract "$OBJECT_FORMAT" "value.base_sha = '$(printf 'b%.0s' {1..64})';"
run_checker seal --contract "$OBJECT_FORMAT" --repo "$SBX" --out "$TEST_TMP/object-format.seal"
assert_exit_code "$__RUN_EXIT" "3" "SHA-256 length is rejected in a SHA-1 repository"
assert_contains "$__RUN_STDOUT" "40-hex sha1" "repository object format determines SHA length"

BASELINE_SHA="$(node -e 'const f=require(process.argv[1]); process.stdout.write(f.baseline_sha)' "$BASELINE")"
BASELINE_TREE="$(node -e 'const f=require(process.argv[1]); process.stdout.write(f.baseline_tree)' "$BASELINE")"
EXPLOIT_COUNT="$(node -e 'const f=require(process.argv[1]); process.stdout.write(String(f.exploits.length))' "$BASELINE")"
assert_eq "$EXPLOIT_COUNT" "5" "RED baseline records all five exploit shapes"
git -C "$REPO_ROOT" cat-file -e "${BASELINE_SHA}^{commit}" 2>/dev/null
assert_exit_code "$?" "0" "RED baseline commit exists"
assert_eq "$(git -C "$REPO_ROOT" rev-parse "${BASELINE_SHA}^{tree}")" "$BASELINE_TREE" \
  "RED baseline tree is content-bound"
git -C "$REPO_ROOT" merge-base --is-ancestor "$BASELINE_SHA" HEAD
assert_exit_code "$?" "0" "RED baseline is an ancestor of the implementation branch"

BASE_ARCHIVE="$TEST_TMP/red-baseline"
mkdir -p "$BASE_ARCHIVE"
git -C "$REPO_ROOT" archive "$BASELINE_SHA" | tar -x -C "$BASE_ARCHIVE"
RED_OUT="$(node \
  "$REPO_ROOT/hooks/tests/fixtures/implementation-campaign/probe-red-baseline.js" \
  "$BASE_ARCHIVE" "$TEST_TMP/red-baseline-prompt.txt")"
assert_exit_code "$?" "0" "all five RED exploits reproduce against pinned develop runtime"
for exploit in missing_contract repair_cap_reset missing_finding_disposition \
  session_resume_reset verification_receipt_reuse; do
  assert_eq "$(node -e \
    'const v=JSON.parse(process.argv[1]); process.stdout.write(String(v.exploits[process.argv[2]]))' \
    "$RED_OUT" "$exploit")" "true" "RED runtime reproduces $exploit"
done

run_checker --help
assert_exit_code "$__RUN_EXIT" "0" "help exits zero"

finalize_test
