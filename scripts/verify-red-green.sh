#!/usr/bin/env bash
# verify-red-green.sh — prove that a change's tests actually exercise the change.
# Red-green sibling of verify-preexisting.sh. Uses detached git worktrees (never
# mutates the live working tree).
#
# Usage:
#   scripts/verify-red-green.sh --range <base>..<head> --verify-cmd <script-path> \
#       [--test-glob <git-pathspec-glob>]... [--repo <dir>] [--receipt-out <file>]
#   scripts/verify-red-green.sh --base <ref> --head <ref> --verify-cmd <script-path> \
#       [--test-glob <glob>]... [--repo <dir>] [--receipt-out <file>]
#   scripts/verify-red-green.sh --validate --receipt <file> [--repo <dir>] \
#       [--base <full-sha> --head <full-sha> --verify-cmd <script-path>]
#
#   --verify-cmd may be a relative path; it is validated against the CALLER's
#   cwd at startup. A repo-owned executable is then resolved to the same relative
#   path in each detached worktree; an external absolute executable is unchanged.
#
# Output: JSON on stdout:
#   { verdict, red_green_validated, base_sha, head_sha, head_result, base_result,
#     red_tests, test_command_digest, assertion_artifact_path,
#     assertion_artifact_digest, expected_red_exit_class, green_result,
#     receipt_digest, reason }
#   verdict = VALIDATED | NOT_RED_ON_BASE | NOT_GREEN_ON_HEAD | INCONCLUSIVE
#
# Exit codes:
#   0   VALIDATED (head green AND base red)
#   1   NOT_RED_ON_BASE or NOT_GREEN_ON_HEAD
#   2   usage / bad ref / not a git repo
#   3   INCONCLUSIVE (fail-closed — not validated)

set -euo pipefail

# git :(glob) magic: a single '*' does NOT cross '/', so a bare '*test*' only
# matches basenames at the repo root. Lead every pattern with '**/' so test files
# at ANY depth (e.g. tests/unit_test.sh, src/foo.spec.ts) are matched.
DEFAULT_TEST_GLOBS=(
  '**/*test*'
  '**/*spec*'
  '**/*_test.*'
  '**/test_*'
  '**/tests/**'
  '**/__tests__/**'
  '**/*.test.*'
  '**/*.spec.*'
)

RANGE=""
BASE_REF=""
HEAD_REF=""
VERIFY_CMD=""
REPO=""
VALIDATE_ONLY=0
RECEIPT_FILE=""
RECEIPT_OUT=""
declare -a TEST_GLOBS=()
declare -a ASSERTION_ARTIFACT_PATHS=()
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)/$(basename "${BASH_SOURCE[0]:-$0}")"
VERIFY_CMD_REPO_REL=""
VERIFY_CMD_CONTENT_SHA=""
VERIFY_CMD_BASE_CONTENT_SHA=""
VERIFY_CMD_HEAD_CONTENT_SHA=""
VERIFY_CMD_BYTES_DIGEST=""

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"
# Preserve the shared RFC impl under a private name, then install a sed-extractable
# entrypoint (hooks/tests/verify-red-green.test.sh does:
#   eval "$(sed -n '/^json_escape()/,/^}$/p' "$SCRIPT")"
# so this file must still contain a `json_escape()` definition).
eval "$(declare -f json_escape | sed '1s/^json_escape/_json_escape_rfc/')"
json_escape() {
  if ! declare -F _json_escape_rfc >/dev/null 2>&1; then
    local _je
    if [ -n "${REPO_ROOT:-}" ] && [ -r "$REPO_ROOT/scripts/lib/json-emit.sh" ]; then
      _je="$REPO_ROOT/scripts/lib/json-emit.sh"
    else
      _je="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/json-emit.sh"
    fi
    # shellcheck disable=SC1090
    . "$_je"
    eval "$(declare -f json_escape | sed '1s/^json_escape/_json_escape_rfc/')"
  fi
  _json_escape_rfc "$1"
}

err_usage() {
  echo "$1" >&2
  exit 2
}

emit_json() {
  local verdict="$1" validated="$2" base_sha="$3" head_sha="$4"
  local head_result="$5" base_result="$6" red_tests_json="$7" reason="$8"
  if [[ -n "${RECEIPT_EXTRA_JSON:-}" ]]; then
    local body receipt_json
    body="$(printf '{"verdict":"%s","red_green_validated":%s,"base_sha":"%s","head_sha":"%s","head_result":"%s","base_result":"%s","red_tests":%s,"reason":"%s",%s}' \
      "$(json_escape "$verdict")" "$validated" "$(json_escape "$base_sha")" \
      "$(json_escape "$head_sha")" "$(json_escape "$head_result")" \
      "$(json_escape "$base_result")" "$red_tests_json" "$(json_escape "$reason")" \
      "$RECEIPT_EXTRA_JSON")"
    receipt_json="$(node - "$body" <<'NODE'
"use strict";
const crypto = require('crypto');
const value = JSON.parse(process.argv[2]);
const canonical = (item) => Array.isArray(item)
  ? '[' + item.map(canonical).join(',') + ']'
  : (item && typeof item === 'object'
    ? '{' + Object.keys(item).sort().map((key) => JSON.stringify(key) + ':' + canonical(item[key])).join(',') + '}'
    : JSON.stringify(item));
value.receipt_digest = crypto.createHash('sha256').update(canonical(value)).digest('hex');
process.stdout.write(JSON.stringify(value, null, 2));
NODE
    )"
    printf '%s\n' "$receipt_json"
    if [[ -n "${RECEIPT_OUT:-}" ]]; then
      (umask 077; printf '%s\n' "$receipt_json" > "$RECEIPT_OUT")
      chmod 600 "$RECEIPT_OUT"
    fi
    return 0
  fi
  printf '{\n'
  printf '  "verdict": "%s",\n' "$verdict"
  printf '  "red_green_validated": %s,\n' "$validated"
  printf '  "base_sha": "%s",\n' "$(json_escape "$base_sha")"
  printf '  "head_sha": "%s",\n' "$(json_escape "$head_sha")"
  printf '  "head_result": "%s",\n' "$head_result"
  printf '  "base_result": "%s",\n' "$base_result"
  printf '  "red_tests": %s,\n' "$red_tests_json"
  printf '  "reason": "%s"\n' "$(json_escape "$reason")"
  printf '}\n'
}

# Validate a previously emitted polarity receipt without rerunning the candidate.
# This is deliberately separate from the producer path: a stale/cross-candidate
# receipt must be rejected before a verification-author workflow can treat it as evidence.
validate_receipt() {
  local receipt_file="$1" repo="$2" base_ref="$3" head_ref="$4" verify_cmd="$5"
  local validation validation_rc
  set +e
  validation="$(node - "$receipt_file" "$repo" "$base_ref" "$head_ref" "$verify_cmd" <<'NODE'
"use strict";
const fs = require('fs');
const crypto = require('crypto');
const child = require('child_process');
const path = require('path');
const [receiptFile, repo, expectedBase, expectedHead, verifyCmd] = process.argv.slice(2);
const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : (value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value));
const digest = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const git = (args, encoding = 'utf8') => child.execFileSync(
  'git', ['-C', repo, ...args], { encoding, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
);
const reject = (reason) => {
  process.stdout.write(JSON.stringify({ valid: false, status: 'rejected', reason }) + '\n');
  process.exit(1);
};
const fullCommit = (value, label) => {
  if (!/^[0-9a-f]{40,64}$/.test(String(value || ''))) reject(label + ' is not a full immutable SHA');
  try {
    if (git(['rev-parse', '--verify', value + '^{commit}']).trim() !== value) {
      reject(label + ' does not resolve to the exact receipt commit');
    }
  } catch (_error) { reject(label + ' is absent from the repository'); }
  return value;
};
const blobSha = (head, relativePath) => {
  try {
    return crypto.createHash('sha256').update(git(['show', head + ':' + relativePath], 'buffer')).digest('hex');
  } catch (_error) { return null; }
};
let receipt;
try { receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')); }
catch (error) { reject('receipt is not valid JSON: ' + error.message); }
if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schema_version !== 1
    || receipt.artifact_type !== 'red_green_polarity_receipt'
    || receipt.verdict !== 'VALIDATED'
    || receipt.red_green_validated !== true
    || receipt.expected_red_exit_class !== 'nonzero'
    || receipt.green_result !== 'green'
    || !Array.isArray(receipt.assertion_artifacts)
    || receipt.assertion_artifacts.length === 0
    || typeof receipt.test_command_digest !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.test_command_digest)
    || typeof receipt.verify_command_path !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.verify_command_bytes_sha256 || '')
    || !/^[0-9a-f]{64}$/.test(receipt.verify_command_base_bytes_sha256 || '')
    || !/^[0-9a-f]{64}$/.test(receipt.verify_command_head_bytes_sha256 || '')
    || typeof receipt.assertion_artifact_digest !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.assertion_artifact_digest)
    || typeof receipt.receipt_digest !== 'string') {
  reject('receipt has an invalid red/green polarity shape');
}
const receiptBody = { ...receipt };
delete receiptBody.receipt_digest;
if (!/^[0-9a-f]{64}$/.test(receipt.receipt_digest)
    || digest(receiptBody) !== receipt.receipt_digest) reject('receipt digest is invalid');
const base = fullCommit(receipt.base_sha, 'receipt base_sha');
const head = fullCommit(receipt.head_sha, 'receipt head_sha');
if (expectedBase && fullCommit(expectedBase, 'expected base') !== base) reject('receipt is bound to a different base candidate');
if (expectedHead && fullCommit(expectedHead, 'expected head') !== head) reject('receipt is bound to a different head candidate');
if (base === head) reject('receipt base_sha and head_sha must be different commits');
try { git(['merge-base', '--is-ancestor', base, head]); }
catch (_error) { reject('receipt commits are not in an ancestor relationship'); }
if (receipt.base_result !== 'red' || receipt.head_result !== 'green'
    || !Number.isInteger(receipt.base_exit_code) || receipt.base_exit_code === 0
    || receipt.head_exit_code !== 0) reject('receipt does not prove a red-before/green-after transition');
if (!Array.isArray(receipt.red_tests)
    || !Object.prototype.hasOwnProperty.call(receipt, 'assertion_artifact_path')) {
  reject('receipt is missing red test and assertion artifact path fields');
}
const actualArtifacts = receipt.assertion_artifacts.map((item) => item && item.path).sort();
if (actualArtifacts.some((item) => typeof item !== 'string' || item.length === 0
    || path.posix.isAbsolute(item) || item.split('/').includes('..'))
    || receipt.red_tests.slice().sort().join('\0') !== actualArtifacts.join('\0')) {
  reject('receipt assertion artifact paths are malformed or inconsistent');
}
for (const item of receipt.assertion_artifacts) {
  if (!/^[0-9a-f]{64}$/.test(item.sha256 || '') || blobSha(head, item.path) !== item.sha256) {
    reject('assertion artifact is stale or bound to a different candidate: ' + item.path);
  }
}
if (digest(receipt.assertion_artifacts) !== receipt.assertion_artifact_digest) reject('assertion artifact digest is invalid');
if (receipt.assertion_artifacts.length === 1
    ? receipt.assertion_artifact_path !== receipt.assertion_artifacts[0].path
    : receipt.assertion_artifact_path !== null) {
  reject('receipt assertion_artifact_path is inconsistent with assertion_artifacts');
}
if (verifyCmd) {
  const resolved = path.isAbsolute(verifyCmd) ? verifyCmd : path.resolve(process.cwd(), verifyCmd);
  const repoPrefix = path.resolve(repo) + path.sep;
  const relative = resolved.startsWith(repoPrefix) ? resolved.slice(repoPrefix.length).split(path.sep).join('/') : null;
  const headContentSha = relative ? blobSha(head, relative) : (() => {
    try { return crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'); }
    catch (_error) { return null; }
  })();
  const baseContentSha = relative
    ? (receipt.red_tests.includes(relative) ? headContentSha : blobSha(base, relative))
    : headContentSha;
  const commandPath = relative || resolved;
  if (!headContentSha || !baseContentSha || commandPath !== receipt.verify_command_path
      || headContentSha !== receipt.verify_command_head_bytes_sha256
      || baseContentSha !== receipt.verify_command_base_bytes_sha256
      || headContentSha !== baseContentSha
      || receipt.verify_command_bytes_sha256 !== headContentSha) {
    reject('verification command bytes are stale, changed, or cross-candidate');
  }
  if (digest({ path: commandPath, base_content_sha256: baseContentSha, head_content_sha256: headContentSha, content_sha256: headContentSha }) !== receipt.test_command_digest) {
    reject('receipt is bound to a different verification command');
  }
}
process.stdout.write(JSON.stringify({
  valid: true,
  status: 'validated',
  receipt_digest: receipt.receipt_digest,
  base_sha: base,
  head_sha: head,
  assertion_artifact_digest: receipt.assertion_artifact_digest,
  test_command_digest: receipt.test_command_digest,
  assertion_artifacts: receipt.assertion_artifacts.map((item) => item.path),
}) + '\n');
NODE
  )"
  validation_rc=$?
  set -e
  if [ "$validation_rc" -ne 0 ]; then
    printf '%s\n' "$validation"
    return "$validation_rc"
  fi

  # A receipt is only shippable when the controller supplies the immutable
  # candidate identities and the exact verification command.  Re-run the
  # command against detached base/head worktrees and compare the resulting
  # receipt fields; a producer cannot make a self-consistent forged claim pass
  # this boundary.
  if [[ -n "$base_ref" || -n "$head_ref" ]]; then
    [[ -n "$base_ref" && -n "$head_ref" && -n "$verify_cmd" ]] || {
      printf '%s\n' '{"valid":false,"status":"rejected","reason":"independent polarity observation requires base, head, and verify command"}'
      return 1
    }
    local observed receipt_paths_json observed_rc observed_file
    observed_file="$(mktemp -t verify-red-green-observed-XXXXXX.json)"
    trap 'rm -f "$observed_file"' RETURN
    mapfile -t receipt_paths < <(node - "$validation" <<'NODE'
"use strict";
const value = JSON.parse(process.argv[2]);
for (const item of value.assertion_artifacts || []) process.stdout.write(String(item) + "\n");
NODE
    )
    local -a observe_args=(--base "$base_ref" --head "$head_ref" --verify-cmd "$verify_cmd" --repo "$repo" --receipt-out "$observed_file")
    local artifact
    for artifact in "${receipt_paths[@]}"; do
      observe_args+=(--assertion-artifact "$artifact")
    done
    set +e
    observed="$(bash "$SCRIPT_PATH" "${observe_args[@]}" 2>&1)"
    observed_rc=$?
    set -e
    if [ "$observed_rc" -ne 0 ]; then
      printf '%s\n' '{"valid":false,"status":"rejected","reason":"independent polarity observation did not validate"}'
      return 1
    fi
    set +e
    node - "$receipt_file" "$observed_file" <<'NODE'
"use strict";
const fs = require('fs');
const crypto = require('crypto');
const [claimedPath, observedPath] = process.argv.slice(2);
const claimed = JSON.parse(fs.readFileSync(claimedPath, 'utf8'));
const observed = JSON.parse(fs.readFileSync(observedPath, 'utf8'));
const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : (value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value));
const same = (left, right) => canonical(left) === canonical(right);
const fields = [
  'verdict', 'red_green_validated', 'base_sha', 'head_sha', 'head_result',
  'base_result', 'red_tests', 'test_command_digest', 'assertion_artifact_path',
  'verify_command_path', 'verify_command_bytes_sha256',
  'verify_command_base_bytes_sha256', 'verify_command_head_bytes_sha256',
  'assertion_artifacts', 'assertion_artifact_digest', 'expected_red_exit_class',
  'green_result', 'base_exit_code', 'head_exit_code', 'receipt_digest',
];
for (const field of fields) {
  if (!same(claimed[field], observed[field])) {
    process.stdout.write(JSON.stringify({ valid: false, status: 'rejected', reason: 'receipt differs from independently observed polarity: ' + field }) + '\n');
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify({ valid: true, status: 'validated', observation: 'independent', receipt_digest: claimed.receipt_digest }) + '\n');
NODE
    local compare_rc=$?
    set -e
    rm -f "$observed_file"
    trap - RETURN
    return "$compare_rc"
  fi
  printf '%s\n' "$validation"
}

# Parse CLI
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --range)
      [[ $# -ge 2 ]] || err_usage "missing value for --range"
      RANGE="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || err_usage "missing value for --base"
      BASE_REF="$2"
      shift 2
      ;;
    --head)
      [[ $# -ge 2 ]] || err_usage "missing value for --head"
      HEAD_REF="$2"
      shift 2
      ;;
    --verify-cmd)
      [[ $# -ge 2 ]] || err_usage "missing value for --verify-cmd"
      VERIFY_CMD="$2"
      shift 2
      ;;
    --test-glob)
      [[ $# -ge 2 ]] || err_usage "missing value for --test-glob"
      TEST_GLOBS+=("$2")
      shift 2
      ;;
    --assertion-artifact)
      [[ $# -ge 2 ]] || err_usage "missing value for --assertion-artifact"
      ASSERTION_ARTIFACT_PATHS+=("$2")
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || err_usage "missing value for --repo"
      REPO="$2"
      shift 2
      ;;
    --validate)
      VALIDATE_ONLY=1
      shift
      ;;
    --receipt)
      [[ $# -ge 2 ]] || err_usage "missing value for --receipt"
      RECEIPT_FILE="$2"
      shift 2
      ;;
    --receipt-out|--out)
      [[ $# -ge 2 ]] || err_usage "missing value for --receipt-out"
      RECEIPT_OUT="$2"
      shift 2
      ;;
    *)
      err_usage "unknown argument: $1"
      ;;
  esac
done

if [[ "$VALIDATE_ONLY" -eq 0 ]]; then
  [[ -n "$VERIFY_CMD" ]] || err_usage "missing required --verify-cmd"
else
  [[ -n "$RECEIPT_FILE" ]] || err_usage "--validate requires --receipt <file>"
fi

if [[ "$VALIDATE_ONLY" -eq 0 && -z "$RANGE" && ( -z "$BASE_REF" || -z "$HEAD_REF" ) ]]; then
  err_usage "missing required --range <base>..<head> or --base and --head"
fi

if [[ -z "$REPO" ]]; then
  REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || err_usage "not a git repository"
fi

if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  err_usage "not a git repository: $REPO"
fi
REPO="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)" || err_usage "not a git repository: $REPO"
REPO="$(cd "$REPO" && pwd -P)" || err_usage "repository path unresolvable: $REPO"

if [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  validate_receipt "$RECEIPT_FILE" "$REPO" "$BASE_REF" "$HEAD_REF" "$VERIFY_CMD"
  exit $?
fi

if [[ -n "$RANGE" ]]; then
  if [[ "$RANGE" != *".."* ]]; then
    err_usage "invalid --range (expected <base>..<head>): $RANGE"
  fi
  BASE_REF="${RANGE%%..*}"
  HEAD_REF="${RANGE#*..}"
fi

BASE_SHA="$(git -C "$REPO" rev-parse --verify "$BASE_REF" 2>/dev/null)" || err_usage "base ref not found: $BASE_REF"
HEAD_SHA="$(git -C "$REPO" rev-parse --verify "$HEAD_REF" 2>/dev/null)" || err_usage "head ref not found: $HEAD_REF"

# Canonicalize --verify-cmd to an absolute path BEFORE any cd: run_verify_cmd
# executes inside detached worktrees, so a path relative to the caller's cwd
# would stop resolving (or resolve to a different file) after the cd.
if [[ "$VERIFY_CMD" != /* ]]; then
  if [[ -e "$VERIFY_CMD" ]]; then
    # Wrap the cd in a conditional: a non-directory dirname or a cd failure
    # (permissions, races) must exit 2 with a named error, not abort via set -e.
    if ! VERIFY_CMD_DIR="$(cd "$(dirname "$VERIFY_CMD")" 2>/dev/null && pwd)"; then
      err_usage "verify-cmd dirname unresolvable: $VERIFY_CMD"
    fi
    VERIFY_CMD="$VERIFY_CMD_DIR/$(basename "$VERIFY_CMD")"
  else
    err_usage "verify-cmd not found (relative path resolved against caller cwd): $VERIFY_CMD"
  fi
fi
if [[ ! -x "$VERIFY_CMD" ]]; then
  err_usage "verify-cmd not found or not executable: $VERIFY_CMD"
fi

# A tracked verify executable belongs to the repository rather than the caller
# checkout. Keep its relative identity and resolve it under each worktree at run
# time. Truly external absolute commands continue to execute at their original
# path with the worktree passed as argv[1].
VERIFY_CMD_REPO_REL=""
case "$VERIFY_CMD" in
  "$REPO"/*)
    VERIFY_CMD_CANDIDATE="${VERIFY_CMD#"$REPO"/}"
    if git -C "$REPO" ls-files --error-unmatch -- "$VERIFY_CMD_CANDIDATE" >/dev/null 2>&1; then
      VERIFY_CMD_REPO_REL="$VERIFY_CMD_CANDIDATE"
    fi
    ;;
esac

if [[ ${#ASSERTION_ARTIFACT_PATHS[@]} -gt 0 ]]; then
  # Controller-supplied artifact paths are the immutable assertion boundary.
  # They must be tracked files changed by this candidate; silently accepting an
  # arbitrary path would let a receipt bind to an unrelated green test.
  declare -A _artifact_seen=()
  for _artifact_path in "${ASSERTION_ARTIFACT_PATHS[@]}"; do
    [[ -n "$_artifact_path" && "$_artifact_path" != /* && "$_artifact_path" != *'..'* ]] \
      || err_usage "invalid --assertion-artifact path: $_artifact_path"
    [[ -z "${_artifact_seen[$_artifact_path]:-}" ]] || err_usage "duplicate --assertion-artifact path: $_artifact_path"
    _artifact_seen[$_artifact_path]=1
    git -C "$REPO" ls-files --error-unmatch -- "$_artifact_path" >/dev/null 2>&1 \
      || err_usage "assertion artifact is not tracked: $_artifact_path"
    git -C "$REPO" diff --quiet "$BASE_SHA..$HEAD_SHA" -- "$_artifact_path" \
      && err_usage "assertion artifact is not changed by candidate: $_artifact_path"
  done
  TEST_FILES="$(printf '%s\n' "${ASSERTION_ARTIFACT_PATHS[@]}")"
elif [[ ${#TEST_GLOBS[@]} -eq 0 ]]; then
  TEST_GLOBS=("${DEFAULT_TEST_GLOBS[@]}")
fi

# Collect changed test files (deduplicated) via git pathspec globs.
collect_test_files() {
  local -A seen=()
  local g ps f
  for g in "${TEST_GLOBS[@]}"; do
    ps=":(glob)${g}"
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if [[ -z "${seen[$f]:-}" ]]; then
        seen[$f]=1
        printf '%s\n' "$f"
      fi
    done < <(git -C "$REPO" diff --name-only "${BASE_SHA}..${HEAD_SHA}" -- "$ps" 2>/dev/null || true)
  done
}

if [[ -z "${TEST_FILES:-}" ]]; then
  TEST_FILES="$(collect_test_files)"
fi
if [[ -z "$TEST_FILES" ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "no-test-files-in-diff"
  exit 3
fi

mapfile -t TEST_FILE_ARRAY <<< "$TEST_FILES"

sha256_git_blob() {
  local commit="$1" path="$2"
  git -C "$REPO" show "$commit:$path" | sha256sum | awk '{print $1}'
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

verify_cmd_path_for_worktree() {
  local wt="$1"
  if [[ -n "$VERIFY_CMD_REPO_REL" ]]; then
    printf '%s/%s' "$wt" "$VERIFY_CMD_REPO_REL"
  else
    printf '%s' "$VERIFY_CMD"
  fi
}

canonical_digest() {
  node - "$1" <<'NODE'
"use strict";
const crypto = require('crypto');
const value = JSON.parse(process.argv[2]);
const canonical = (item) => Array.isArray(item)
  ? '[' + item.map(canonical).join(',') + ']'
  : (item && typeof item === 'object'
    ? '{' + Object.keys(item).sort().map((key) => JSON.stringify(key) + ':' + canonical(item[key])).join(',') + '}'
    : JSON.stringify(item));
process.stdout.write(crypto.createHash('sha256').update(canonical(value)).digest('hex'));
NODE
}

VERIFY_CMD_IDENTITY_PATH="$VERIFY_CMD"
if [[ -n "$VERIFY_CMD_REPO_REL" ]]; then
  VERIFY_CMD_IDENTITY_PATH="$VERIFY_CMD_REPO_REL"
fi
ASSERTION_ARTIFACTS_JSON="["
ASSERTION_ARTIFACT_PATH=""
_artifact_first=1
for _test_file in "${TEST_FILE_ARRAY[@]}"; do
  _artifact_sha="$(sha256_git_blob "$HEAD_SHA" "$_test_file")"
  if [[ "$_artifact_first" -eq 0 ]]; then
    ASSERTION_ARTIFACTS_JSON+=","
  fi
  ASSERTION_ARTIFACTS_JSON+="{\"path\":\"$(json_escape "$_test_file")\",\"sha256\":\"$_artifact_sha\"}"
  _artifact_first=0
done
ASSERTION_ARTIFACTS_JSON+="]"
if [[ "${#TEST_FILE_ARRAY[@]}" -eq 1 ]]; then
  ASSERTION_ARTIFACT_PATH="${TEST_FILE_ARRAY[0]}"
fi
if [[ -z "$ASSERTION_ARTIFACT_PATH" ]]; then
  ASSERTION_ARTIFACT_PATH_JSON="null"
else
  ASSERTION_ARTIFACT_PATH_JSON="\"$(json_escape "$ASSERTION_ARTIFACT_PATH")\""
fi
ASSERTION_ARTIFACT_DIGEST="$(canonical_digest "$ASSERTION_ARTIFACTS_JSON")"

WT_TMP="$(mktemp -d -t verify-red-green-XXXXXX)"
WT_HEAD="$WT_TMP/head"
WT_BASE="$WT_TMP/base"
PATCH_FILE="$WT_TMP/test.patch"

cleanup() {
  git -C "$REPO" worktree remove --force "$WT_HEAD" 2>/dev/null || true
  git -C "$REPO" worktree remove --force "$WT_BASE" 2>/dev/null || true
  git -C "$REPO" worktree prune 2>/dev/null || true
  rm -rf "$WT_TMP"
}
trap cleanup EXIT

run_verify_cmd() {
  local wt="$1"
  local verify_cmd="$VERIFY_CMD"
  local ec=0
  local cmd_path cmd_sha cmd_after
  if [[ -n "$VERIFY_CMD_REPO_REL" ]]; then
    verify_cmd="$wt/$VERIFY_CMD_REPO_REL"
  fi
  cmd_path="$(verify_cmd_path_for_worktree "$wt")"
  if [[ ! -f "$cmd_path" ]] || ! cmd_sha="$(sha256_file "$cmd_path" 2>/dev/null)" \
      || [[ "$cmd_sha" != "$VERIFY_CMD_CONTENT_SHA" ]]; then
    LAST_VERIFY_EXIT=125
    return 125
  fi
  set +e
  (
    cd "$wt" || exit 1
    "$verify_cmd" "$wt"
  )
  ec=$?
  if [[ -f "$cmd_path" ]]; then
    cmd_after="$(sha256_file "$cmd_path" 2>/dev/null || true)"
  else
    cmd_after=""
  fi
  if [[ "$cmd_after" != "$VERIFY_CMD_CONTENT_SHA" ]]; then
    ec=125
  fi
  LAST_VERIFY_EXIT="$ec"
  set -e
  return "$ec"
}

HEAD_RESULT="skipped"
BASE_RESULT="skipped"
HEAD_EXIT_CODE=0
BASE_EXIT_CODE=0
RED_TESTS_JSON="[]"
REASON=""
RECEIPT_EXTRA_JSON=""

# HEAD check: green at head with full change present.
if ! git -C "$REPO" worktree add --detach "$WT_HEAD" "$HEAD_SHA" >/dev/null 2>&1; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "head-worktree-add-failed"
  exit 3
fi

if [[ -n "$VERIFY_CMD_REPO_REL" && ! -x "$WT_HEAD/$VERIFY_CMD_REPO_REL" ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "head-verify-cmd-missing-or-not-executable"
  exit 3
fi

# Pin HEAD command bytes before the first detached observation.  The base hash
# is added below after its assertion patch is applied.
VERIFY_CMD_HEAD_CONTENT_SHA="$(sha256_file "$(verify_cmd_path_for_worktree "$WT_HEAD")" 2>/dev/null || true)"
if [[ ! "$VERIFY_CMD_HEAD_CONTENT_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "verification-command-bytes-unavailable"
  exit 3
fi
VERIFY_CMD_CONTENT_SHA="$VERIFY_CMD_HEAD_CONTENT_SHA"

if run_verify_cmd "$WT_HEAD"; then
  HEAD_RESULT="green"
  HEAD_EXIT_CODE="$LAST_VERIFY_EXIT"
else
  HEAD_RESULT="red"
  HEAD_EXIT_CODE="$LAST_VERIFY_EXIT"
  emit_json "NOT_GREEN_ON_HEAD" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" ""
  exit 1
fi

# RED check: apply only test-file edits onto base, expect failure.
if ! git -C "$REPO" worktree add --detach "$WT_BASE" "$BASE_SHA" >/dev/null 2>&1; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "base-worktree-add-failed"
  exit 3
fi

if ! git -C "$REPO" diff "${BASE_SHA}..${HEAD_SHA}" -- "${TEST_FILE_ARRAY[@]}" >"$PATCH_FILE" 2>/dev/null; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "test-patch-build-failed"
  exit 3
fi

if ! git -C "$WT_BASE" apply "$PATCH_FILE" 2>/dev/null; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "test-patch-apply-failed"
  exit 3
fi

RED_TESTS_JSON="$(json_array_from_lines "$TEST_FILES")"

if [[ -n "$VERIFY_CMD_REPO_REL" && ! -x "$WT_BASE/$VERIFY_CMD_REPO_REL" ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "$RED_TESTS_JSON" "base-verify-cmd-missing-or-not-executable"
  exit 3
fi

# Pin the exact bytes that both detached observations will execute.  For a
# repo-owned command this is measured after the assertion patch is applied to
# the base worktree, so a command changed as part of the assertion is still the
# same executable in both observations.  Any remaining byte mismatch is
# infrastructure ambiguity, not red evidence.
VERIFY_CMD_BASE_CONTENT_SHA="$(sha256_file "$(verify_cmd_path_for_worktree "$WT_BASE")" 2>/dev/null || true)"
if [[ ! "$VERIFY_CMD_BASE_CONTENT_SHA" =~ ^[0-9a-f]{64}$ ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "$RED_TESTS_JSON" "verification-command-bytes-unavailable"
  exit 3
fi
if [[ "$VERIFY_CMD_HEAD_CONTENT_SHA" != "$VERIFY_CMD_BASE_CONTENT_SHA" ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "$RED_TESTS_JSON" "verification-command-bytes-mismatch"
  exit 3
fi
VERIFY_CMD_CONTENT_SHA="$VERIFY_CMD_HEAD_CONTENT_SHA"
VERIFY_CMD_BYTES_DIGEST="$(canonical_digest "$(printf '{"path":"%s","base_content_sha256":"%s","head_content_sha256":"%s","content_sha256":"%s"}' \
  "$(json_escape "$VERIFY_CMD_IDENTITY_PATH")" "$VERIFY_CMD_BASE_CONTENT_SHA" "$VERIFY_CMD_HEAD_CONTENT_SHA" "$VERIFY_CMD_CONTENT_SHA")")"
TEST_COMMAND_DIGEST="$VERIFY_CMD_BYTES_DIGEST"

if run_verify_cmd "$WT_BASE"; then
  BASE_RESULT="green"
  BASE_EXIT_CODE="$LAST_VERIFY_EXIT"
  emit_json "NOT_RED_ON_BASE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "$BASE_RESULT" "$RED_TESTS_JSON" ""
  exit 1
fi

BASE_RESULT="red"
BASE_EXIT_CODE="$LAST_VERIFY_EXIT"
RECEIPT_EXTRA_JSON="$(printf '"schema_version":1,"artifact_type":"red_green_polarity_receipt","test_command_digest":"%s","verify_command_path":"%s","verify_command_bytes_sha256":"%s","verify_command_base_bytes_sha256":"%s","verify_command_head_bytes_sha256":"%s","assertion_artifacts":%s,"assertion_artifact_path":%s,"assertion_artifact_digest":"%s","expected_red_exit_class":"nonzero","green_result":"green","base_exit_code":%s,"head_exit_code":%s' \
  "$TEST_COMMAND_DIGEST" "$(json_escape "$VERIFY_CMD_IDENTITY_PATH")" "$VERIFY_CMD_CONTENT_SHA" "$VERIFY_CMD_BASE_CONTENT_SHA" "$VERIFY_CMD_HEAD_CONTENT_SHA" "$ASSERTION_ARTIFACTS_JSON" "$ASSERTION_ARTIFACT_PATH_JSON" \
  "$ASSERTION_ARTIFACT_DIGEST" "$BASE_EXIT_CODE" "$HEAD_EXIT_CODE")"
emit_json "VALIDATED" "true" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "$BASE_RESULT" "$RED_TESTS_JSON" ""
exit 0
