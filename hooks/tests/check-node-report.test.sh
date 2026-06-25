#!/usr/bin/env bash
# check-node-report.test.sh — integration tests for scripts/check-node-report.js.
#
# Test matrix (references/tree-contracts.md §4 + Amendment 2):
#   1. --help exits 0
#   2. Valid report → exit 0, valid:true, empty errors/warnings
#   3. Missing evidence (verdict + empty evidence_pointers) → exit 1, invalid
#   4. Dangling pointer (file doesn't exist anywhere) → exit 1, invalid
#   5. Line-range beyond EOF → exit 1, invalid
#   6. Hash mismatch on artifact → exit 1, invalid
#   7. Unknown schema_version → exit 1, invalid
#   8. Amendment 2a: binary sha256-only pointer valid → exit 0
#   9. Amendment 2b: moved-file → pointer_stale warning + exit 0
#  10. Amendment 2c: file:line-range with commit SHA anchor, resolved via git show → exit 0
#  11. Missing required fields (node, verdict, confidence) → exit 1
#  12. confidence out of range → exit 1
#  13. No evidence_pointers field at all → exit 1
#  14. Missing artifact_paths field → exit 1
#  15. Artifact path does not exist (dangling artifact) → exit 1
#  16. bash -n clean; shellcheck clean (if installed)
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-node-report.js"
assert_file_exists "$SCRIPT" "check-node-report.js exists"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run the script with captured stdout/stderr/exit
run_validator() {
  local stdout_file="$TEST_TMP/.vc.stdout.$$"
  local stderr_file="$TEST_TMP/.vc.stderr.$$"
  node "$SCRIPT" "$@" >"$stdout_file" 2>"$stderr_file"
  __RUN_EXIT=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
  rm -f "$stdout_file" "$stderr_file"
}

# Write a minimal valid report JSON to a temp file; echo the path.
# Usage: make_report [extra-json-key-values...]
# The caller can append/override fields by passing jq expressions.
make_artifact() {
  local path="$TEST_TMP/artifact.$$.txt"
  printf 'line 1\nline 2\nline 3\nline 4\nline 5\n' > "$path"
  printf '%s' "$path"
}

artifact_sha() {
  sha256sum "$1" | awk '{print $1}'
}

make_report() {
  local path="$TEST_TMP/report.$$.json"
  local art; art="$(make_artifact)"
  local art_sha; art_sha="$(artifact_sha "$art")"
  # Build a base valid report and apply any jq overrides passed as args
  local base
  base="$(jq -n \
    --arg node "test-node" \
    --arg art "$art" \
    --arg sha "$art_sha" \
    '{
      schema_version: 1,
      node: $node,
      verdict: "approved",
      confidence: 0.85,
      evidence_pointers: ["sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      artifact_paths: [{"path": $art, "sha256": $sha}],
      doa_log: [],
      escalations: []
    }')"
  # Apply each jq filter argument in order
  for filter in "$@"; do
    base="$(printf '%s' "$base" | jq "$filter")"
  done
  printf '%s\n' "$base" > "$path"
  printf '%s' "$path"
}

# Build a sandbox git repo with one committed file, return "path sha" space-separated
make_git_repo() {
  local repo="$TEST_TMP/repo.$$"
  mkdir -p "$repo/src"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t
  git -C "$repo" config user.name t
  printf 'alpha\nbeta\ngamma\ndelta\nepsilon\n' > "$repo/src/evidence.txt"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "initial"
  local sha; sha="$(git -C "$repo" rev-parse HEAD)"
  printf '%s %s' "$repo" "$sha"
}

# make_git_repo_n <suffix> — like make_git_repo but uses a unique suffix to avoid
# PID-collision when called multiple times within the same bash process.
make_git_repo_n() {
  local suffix="${1:-x}"
  local repo="$TEST_TMP/repo.$$.${suffix}"
  mkdir -p "$repo/src"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t
  git -C "$repo" config user.name t
  printf 'alpha\nbeta\ngamma\ndelta\nepsilon\n' > "$repo/src/evidence.txt"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "initial"
  local sha; sha="$(git -C "$repo" rev-parse HEAD)"
  printf '%s %s' "$repo" "$sha"
}

# ---------------------------------------------------------------------------
# TEST 1: --help exits 0
# ---------------------------------------------------------------------------
run_validator --help
assert_exit_code "$__RUN_EXIT" "0" "--help exits 0"
assert_contains "$__RUN_STDOUT" "Usage" "--help contains usage"

# ---------------------------------------------------------------------------
# TEST 2: valid report → exit 0, valid:true
# ---------------------------------------------------------------------------
VALID_REPORT="$(make_report)"
run_validator "$VALID_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "valid report exits 0"
VALID_JSON="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$VALID_JSON" "true" "valid report has valid:true"
ERR_COUNT="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | length')"
assert_eq "$ERR_COUNT" "0" "valid report has 0 errors"
WARN_COUNT="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | length')"
assert_eq "$WARN_COUNT" "0" "valid report has 0 warnings"

# ---------------------------------------------------------------------------
# TEST 3: missing evidence (verdict + empty evidence_pointers) → exit 1
# ---------------------------------------------------------------------------
MISSING_EV_REPORT="$(make_report '.evidence_pointers = []')"
run_validator "$MISSING_EV_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-evidence report exits 1"
MEVR_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$MEVR_VALID" "false" "missing-evidence report has valid:false"
MEVR_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$MEVR_ERRS" "evidence_pointer" "missing-evidence error mentions evidence_pointer"

# ---------------------------------------------------------------------------
# TEST 4: dangling pointer (file doesn't exist anywhere) → exit 1
# ---------------------------------------------------------------------------
DANGLE_REPORT="$(make_report '.evidence_pointers = ["scripts/does-not-exist-at-all.sh:1-5"]')"
run_validator "$DANGLE_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "dangling-pointer report exits 1"
DANGLE_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$DANGLE_VALID" "false" "dangling-pointer report has valid:false"
DANGLE_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$DANGLE_ERRS" "not found" "dangling-pointer error mentions not found"
# The pointer is not a stale warning — it's a hard error (must NOT silently pass)
assert_eq "$__RUN_EXIT" "1" "dangling pointer is a hard error, not just a warning"

# ---------------------------------------------------------------------------
# TEST 5: line-range beyond EOF → exit 1
# ---------------------------------------------------------------------------
# Artifact file has 5 lines; pointer says 1-100
ART5="$(make_artifact)"
ART5_SHA="$(artifact_sha "$ART5")"
LR_REPORT="$TEST_TMP/lr-report.json"
jq -n \
  --arg node "lr-node" \
  --arg art "$ART5" \
  --arg sha "$ART5_SHA" \
  --arg ptr "${ART5}:1-100" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.9,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$LR_REPORT"
run_validator "$LR_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "line-range-beyond-EOF exits 1"
LR_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$LR_VALID" "false" "line-range-beyond-EOF has valid:false"
LR_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$LR_ERRS" "exceeds file length" "line-range-beyond-EOF error mentions exceeds"

# ---------------------------------------------------------------------------
# TEST 6: hash mismatch on artifact → exit 1
# ---------------------------------------------------------------------------
HASH_ART="$(make_artifact)"
WRONG_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HASH_REPORT="$(make_report \
  ".artifact_paths = [{\"path\": \"$HASH_ART\", \"sha256\": \"$WRONG_SHA\"}]" \
  '.evidence_pointers = ["sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]')"
run_validator "$HASH_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "hash-mismatch exits 1"
HM_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$HM_VALID" "false" "hash-mismatch has valid:false"
HM_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$HM_ERRS" "mismatch" "hash-mismatch error mentions mismatch"

# ---------------------------------------------------------------------------
# TEST 7: unknown schema_version → exit 1
# ---------------------------------------------------------------------------
SV_REPORT="$(make_report '.schema_version = 99')"
run_validator "$SV_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "unknown-schema-version exits 1"
SV_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$SV_VALID" "false" "unknown-schema-version has valid:false"
SV_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$SV_ERRS" "schema_version" "unknown-schema-version error mentions schema_version"
assert_contains "$SV_ERRS" "99" "unknown-schema-version error mentions the bad version number"

# ---------------------------------------------------------------------------
# TEST 8 (Amendment 2a): sha256-only pointer valid format → exit 0
# ---------------------------------------------------------------------------
SHA256_REPORT="$(make_report \
  '.evidence_pointers = ["sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]' \
  '.artifact_paths = []')"
run_validator "$SHA256_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "sha256-only pointer valid format exits 0"
SHA256_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$SHA256_VALID" "true" "sha256-only pointer valid format has valid:true"

# Bad sha256: wrong length
BAD_SHA256_REPORT="$(make_report '.evidence_pointers = ["sha256:tooshort"]')"
run_validator "$BAD_SHA256_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "sha256-only malformed pointer exits 1"
BAD_SHA_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$BAD_SHA_ERRS" "64 lowercase hex" "sha256-only malformed error mentions 64 hex chars"

# ---------------------------------------------------------------------------
# TEST 9 (Amendment 2b): moved-file → pointer_stale warning + exit 0 (valid)
# ---------------------------------------------------------------------------
REPO_RESULT="$(make_git_repo)"
MOVED_REPO="${REPO_RESULT% *}"
# Move the file within the repo so src/evidence.txt no longer exists at HEAD
mkdir -p "$MOVED_REPO/lib"
mv "$MOVED_REPO/src/evidence.txt" "$MOVED_REPO/lib/evidence.txt"
git -C "$MOVED_REPO" add -A
git -C "$MOVED_REPO" commit -q -m "move file"

MOVED_ART="$(make_artifact)"
MOVED_ART_SHA="$(artifact_sha "$MOVED_ART")"
MOVED_REPORT="$TEST_TMP/moved-report.json"
jq -n \
  --arg node "moved-node" \
  --arg art "$MOVED_ART" \
  --arg sha "$MOVED_ART_SHA" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.8,
    evidence_pointers: ["src/evidence.txt:1-3"],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$MOVED_REPORT"

run_validator "$MOVED_REPORT" --repo "$MOVED_REPO"
assert_exit_code "$__RUN_EXIT" "0" "moved-file (no sha) exits 0 (still valid with warning)"
MOVED_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$MOVED_VALID" "true" "moved-file (no sha) has valid:true"
MOVED_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | length')"
assert_eq "$MOVED_ERRS" "0" "moved-file (no sha) has 0 errors"
MOVED_WARNS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | join(" ")')"
# No SHA anchor → Mode B: pointer_degraded_basename_match (not pointer_stale)
assert_contains "$MOVED_WARNS" "pointer_degraded_basename_match" "moved-file (no sha) emits pointer_degraded_basename_match warning"
assert_contains "$MOVED_WARNS" "evidence.txt" "moved-file (no sha) warning names the file"

# Confirm NOT silently passed: warning count must be > 0
MOVED_WARN_COUNT="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | length')"
assert_neq "$MOVED_WARN_COUNT" "0" "moved-file (no sha) is not silently passed (warning count > 0)"

# ---------------------------------------------------------------------------
# TEST 9b: moved-file WITH sha anchor + same content → pointer_stale + exit 0
# The pointer uses the ORIGINAL sha (where src/evidence.txt existed), but the file
# has since moved to lib/evidence.txt in the current working tree.
# git show ORIG_SHA:src/evidence.txt succeeds → line count check passes → but
# src/evidence.txt no longer in working tree → content-hash search → stale warning.
# ---------------------------------------------------------------------------
MSHA_REPO_RESULT="$(make_git_repo_n stale)"
MSHA_REPO="${MSHA_REPO_RESULT% *}"
MSHA_SHA="${MSHA_REPO_RESULT#* }"
# MSHA_SHA is the initial commit (src/evidence.txt exists there).
# Now move the file (same content) in a new commit.
mkdir -p "$MSHA_REPO/lib"
mv "$MSHA_REPO/src/evidence.txt" "$MSHA_REPO/lib/evidence.txt"
git -C "$MSHA_REPO" add -A
git -C "$MSHA_REPO" commit -q -m "move evidence"
# Current working tree: src/evidence.txt gone, lib/evidence.txt has SAME content.

MSHA_ART="$(make_artifact)"
MSHA_ART_SHA="$(artifact_sha "$MSHA_ART")"
MSHA_REPORT="$TEST_TMP/msha-report.json"
jq -n \
  --arg node "msha-node" \
  --arg art "$MSHA_ART" \
  --arg sha "$MSHA_ART_SHA" \
  --arg ptr "src/evidence.txt:1-3@${MSHA_SHA}" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.8,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$MSHA_REPORT"

run_validator "$MSHA_REPORT" --repo "$MSHA_REPO"
assert_exit_code "$__RUN_EXIT" "0" "moved-file (sha, same content) exits 0"
MSHA_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$MSHA_VALID" "true" "moved-file (sha, same content) has valid:true"
MSHA_WARNS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | join(" ")')"
assert_contains "$MSHA_WARNS" "pointer_stale" "moved-file (sha, same content) emits pointer_stale"
MSHA_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | length')"
assert_eq "$MSHA_ERRS" "0" "moved-file (sha, same content) has 0 errors"

# ---------------------------------------------------------------------------
# TEST 9c: sha anchor (original), file moved to lib/ but with DIFFERENT content →
# same-basename match with different hash → error (false-positive guard)
# The pointer uses the ORIGINAL sha (git show succeeds). In current working tree
# src/evidence.txt is gone; lib/evidence.txt exists but with DIFFERENT content.
# Content-hash search finds no match. Same-basename file has different content → error.
# ---------------------------------------------------------------------------
DIFF_REPO_RESULT="$(make_git_repo_n diff)"
DIFF_REPO="${DIFF_REPO_RESULT% *}"
DIFF_ORIG_SHA="${DIFF_REPO_RESULT#* }"
# Create lib/evidence.txt with DIFFERENT content; remove src/evidence.txt
mkdir -p "$DIFF_REPO/lib"
rm "$DIFF_REPO/src/evidence.txt"
printf 'completely different content line 1\nline 2\n' > "$DIFF_REPO/lib/evidence.txt"
git -C "$DIFF_REPO" add -A
git -C "$DIFF_REPO" commit -q -m "replace with different content"
# Current working tree: src/evidence.txt gone; lib/evidence.txt has DIFFERENT content.
# Pointer anchor = DIFF_ORIG_SHA (original commit where src/evidence.txt existed).

DIFF_ART="$(make_artifact)"
DIFF_ART_SHA="$(artifact_sha "$DIFF_ART")"
DIFF_REPORT="$TEST_TMP/diff-report.json"
jq -n \
  --arg node "diff-node" \
  --arg art "$DIFF_ART" \
  --arg sha "$DIFF_ART_SHA" \
  --arg ptr "src/evidence.txt:1-3@${DIFF_ORIG_SHA}" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.8,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$DIFF_REPORT"

run_validator "$DIFF_REPORT" --repo "$DIFF_REPO"
# git show DIFF_ORIG_SHA:src/evidence.txt succeeds → file not in working tree at src/ →
# content-hash search: lib/evidence.txt has DIFFERENT hash → basename match different content
# → error (false-positive guard fires)
assert_exit_code "$__RUN_EXIT" "1" "moved-file (sha, diff content, basename match) exits 1"
DIFF_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$DIFF_VALID" "false" "moved-file (sha, diff content, basename match) has valid:false"
DIFF_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$DIFF_ERRS" "invalid" "moved-file (sha, diff content) error mentions invalid"

# ---------------------------------------------------------------------------
# TEST 9d: sha anchor resolves at commit, but the file was DELETED outright —
# no successor anywhere (no content match, no same-basename candidate).
# Contract §5.3: "not found anywhere → validation FAILURE". A deleted citation
# is not spot-checkable; this must be exit 1, never a silent pass.
# ---------------------------------------------------------------------------
DEL_REPO_RESULT="$(make_git_repo_n del)"
DEL_REPO="${DEL_REPO_RESULT% *}"
DEL_ORIG_SHA="${DEL_REPO_RESULT#* }"
rm "$DEL_REPO/src/evidence.txt"
git -C "$DEL_REPO" add -A
git -C "$DEL_REPO" commit -q -m "delete evidence outright"
# Working tree: src/evidence.txt gone; NO file with matching content or basename.

DEL_ART="$(make_artifact)"
DEL_ART_SHA="$(artifact_sha "$DEL_ART")"
DEL_REPORT="$TEST_TMP/del-report.json"
jq -n \
  --arg node "del-node" \
  --arg art "$DEL_ART" \
  --arg sha "$DEL_ART_SHA" \
  --arg ptr "src/evidence.txt:1-3@${DEL_ORIG_SHA}" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.8,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$DEL_REPORT"

run_validator "$DEL_REPORT" --repo "$DEL_REPO"
assert_exit_code "$__RUN_EXIT" "1" "deleted-file (sha anchor, no successor) exits 1"
DEL_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$DEL_VALID" "false" "deleted-file (no successor) has valid:false"
DEL_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$DEL_ERRS" "deleted-file" "deleted-file error names the deleted-file class"

# ---------------------------------------------------------------------------
# TEST 10 (Amendment 2c): file:line-range with commit SHA anchor → git show → exit 0
# ---------------------------------------------------------------------------
GSHOW_REPO_RESULT="$(make_git_repo)"
GSHOW_REPO="${GSHOW_REPO_RESULT% *}"
GSHOW_SHA="${GSHOW_REPO_RESULT#* }"

GSHOW_ART="$(make_artifact)"
GSHOW_ART_SHA="$(artifact_sha "$GSHOW_ART")"
GSHOW_REPORT="$TEST_TMP/gshow-report.json"
jq -n \
  --arg node "gshow-node" \
  --arg art "$GSHOW_ART" \
  --arg sha "$GSHOW_ART_SHA" \
  --arg ptr "src/evidence.txt:2-4@${GSHOW_SHA}" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.9,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$GSHOW_REPORT"

run_validator "$GSHOW_REPORT" --repo "$GSHOW_REPO"
assert_exit_code "$__RUN_EXIT" "0" "commit-SHA anchor resolved via git show exits 0"
GSHOW_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$GSHOW_VALID" "true" "commit-SHA anchor resolved via git show has valid:true"
GSHOW_WARNS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | length')"
assert_eq "$GSHOW_WARNS" "0" "commit-SHA anchor resolution emits no warnings"
GSHOW_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | length')"
assert_eq "$GSHOW_ERRS" "0" "commit-SHA anchor resolution emits no errors"

# Also verify line-range-beyond-EOF via git show path
GSHOW_OOB_REPORT="$TEST_TMP/gshow-oob-report.json"
jq -n \
  --arg node "gshow-oob-node" \
  --arg art "$GSHOW_ART" \
  --arg sha "$GSHOW_ART_SHA" \
  --arg ptr "src/evidence.txt:1-999@${GSHOW_SHA}" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.9,
    evidence_pointers: [$ptr],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$GSHOW_OOB_REPORT"
run_validator "$GSHOW_OOB_REPORT" --repo "$GSHOW_REPO"
assert_exit_code "$__RUN_EXIT" "1" "commit-SHA anchor line-range-beyond-EOF exits 1"
OOB_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$OOB_ERRS" "exceeds file length" "commit-SHA anchor line-range-beyond-EOF error"

# ---------------------------------------------------------------------------
# TEST 11: missing required fields (node, verdict, confidence)
# ---------------------------------------------------------------------------
NO_NODE_REPORT="$(make_report 'del(.node)')"
run_validator "$NO_NODE_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-node field exits 1"
NN_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$NN_ERRS" "node" "missing-node error mentions field name"

NO_VERDICT_REPORT="$(make_report 'del(.verdict)')"
run_validator "$NO_VERDICT_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-verdict field exits 1"
NV_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$NV_ERRS" "verdict" "missing-verdict error mentions field name"

NO_CONF_REPORT="$(make_report 'del(.confidence)')"
run_validator "$NO_CONF_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-confidence field exits 1"
NC_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$NC_ERRS" "confidence" "missing-confidence error mentions field name"

# ---------------------------------------------------------------------------
# TEST 12: confidence out of range
# ---------------------------------------------------------------------------
OOR_LO_REPORT="$(make_report '.confidence = -0.1')"
run_validator "$OOR_LO_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "confidence < 0 exits 1"
OOR_LO_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$OOR_LO_ERRS" "0.0" "confidence < 0 error mentions range"

OOR_HI_REPORT="$(make_report '.confidence = 1.1')"
run_validator "$OOR_HI_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "confidence > 1 exits 1"
OOR_HI_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$OOR_HI_ERRS" "1.0" "confidence > 1 error mentions range"

# Edge: exactly 0.0 and 1.0 are valid
CONF_ZERO_REPORT="$(make_report '.confidence = 0.0')"
run_validator "$CONF_ZERO_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "confidence = 0.0 is valid"

CONF_ONE_REPORT="$(make_report '.confidence = 1.0')"
run_validator "$CONF_ONE_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "confidence = 1.0 is valid"

# ---------------------------------------------------------------------------
# TEST 13: missing evidence_pointers field entirely → exit 1
# ---------------------------------------------------------------------------
NO_EP_REPORT="$(make_report 'del(.evidence_pointers)')"
run_validator "$NO_EP_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-evidence_pointers field exits 1"
NEP_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$NEP_ERRS" "evidence_pointers" "missing-evidence_pointers error names field"

# ---------------------------------------------------------------------------
# TEST 14: missing artifact_paths field → exit 1
# ---------------------------------------------------------------------------
NO_AP_REPORT="$(make_report 'del(.artifact_paths)')"
run_validator "$NO_AP_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "missing-artifact_paths field exits 1"
NAP_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$NAP_ERRS" "artifact_paths" "missing-artifact_paths error names field"

# ---------------------------------------------------------------------------
# TEST 15: artifact path does not exist (dangling artifact) → exit 1
# ---------------------------------------------------------------------------
DANGLE_ART_REPORT="$(make_report \
  '.artifact_paths = [{"path": "/nonexistent/art/file.txt", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]')"
run_validator "$DANGLE_ART_REPORT"
assert_exit_code "$__RUN_EXIT" "1" "dangling-artifact exits 1"
DA_ERRS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.errors | join(" ")')"
assert_contains "$DA_ERRS" "not found at path" "dangling-artifact error mentions path"

# ---------------------------------------------------------------------------
# TEST 16a (Fix 6): @HEAD anchor → warning but still exit 0
# ---------------------------------------------------------------------------
HEAD_REPO_RESULT="$(make_git_repo_n head)"
HEAD_REPO="${HEAD_REPO_RESULT% *}"

HEAD_ART="$(make_artifact)"
HEAD_ART_SHA="$(artifact_sha "$HEAD_ART")"
HEAD_REPORT="$TEST_TMP/head-report.json"
jq -n \
  --arg node "head-node" \
  --arg art "$HEAD_ART" \
  --arg sha "$HEAD_ART_SHA" \
  '{
    schema_version: 1, node: $node, verdict: "approved", confidence: 0.8,
    evidence_pointers: ["src/evidence.txt:1-3@HEAD"],
    artifact_paths: [{"path": $art, "sha256": $sha}],
    doa_log: [], escalations: []
  }' > "$HEAD_REPORT"

run_validator "$HEAD_REPORT" --repo "$HEAD_REPO"
assert_exit_code "$__RUN_EXIT" "0" "@HEAD anchor exits 0 (warning, not error)"
HEAD_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$HEAD_VALID" "true" "@HEAD anchor report has valid:true"
HEAD_WARNS="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | join(" ")')"
assert_contains "$HEAD_WARNS" "@HEAD anchor which is not stable" "@HEAD anchor emits instability warning"
HEAD_WARN_COUNT="$(printf '%s' "$__RUN_STDOUT" | jq -r '.warnings | length')"
assert_neq "$HEAD_WARN_COUNT" "0" "@HEAD anchor warning count > 0"

# ---------------------------------------------------------------------------
# TEST 16b: CRLF artifact sha256 verification (both raw and normalized)
# ---------------------------------------------------------------------------
CRLF_ART="$TEST_TMP/crlf-art.txt"
printf 'line 1\r\nline 2\r\n' > "$CRLF_ART"

# Raw sha256 of the CRLF file:
RAW_SHA="$(sha256sum "$CRLF_ART" | awk '{print $1}')"
# CRLF-normalized (LF only) content: "line 1\nline 2\n"
NORM_SHA="$(printf 'line 1\nline 2\n' | sha256sum | awk '{print $1}')"

# 16b.1: Validator succeeds with raw SHA
CRLF_RAW_REPORT="$(make_report \
  ".artifact_paths = [{\"path\": \"$CRLF_ART\", \"sha256\": \"$RAW_SHA\"}]" \
  '.evidence_pointers = ["sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]')"
run_validator "$CRLF_RAW_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "CRLF artifact raw SHA validation exits 0"
CRLF_RAW_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$CRLF_RAW_VALID" "true" "CRLF artifact raw SHA is valid"

# 16b.2: Validator succeeds with CRLF-normalized SHA
CRLF_NORM_REPORT="$(make_report \
  ".artifact_paths = [{\"path\": \"$CRLF_ART\", \"sha256\": \"$NORM_SHA\"}]" \
  '.evidence_pointers = ["sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]')"
run_validator "$CRLF_NORM_REPORT"
assert_exit_code "$__RUN_EXIT" "0" "CRLF artifact normalized SHA validation exits 0"
CRLF_NORM_VALID="$(printf '%s' "$__RUN_STDOUT" | jq -r '.valid')"
assert_eq "$CRLF_NORM_VALID" "true" "CRLF artifact normalized SHA is valid"

# ---------------------------------------------------------------------------
# TEST 16c: CLI usage and help advertise the actual .js entrypoint (the .sh was
# deleted in the port — the help/usage name must match the real file, not a name
# that no longer exists on disk).
# ---------------------------------------------------------------------------
# Run with --help
run_validator --help
assert_contains "$__RUN_STDOUT" "check-node-report.js" "--help stdout prints check-node-report.js"
assert_not_contains "$__RUN_STDOUT" "check-node-report.sh" "--help stdout does not print the deleted check-node-report.sh"

# Run with usage error (no arguments)
run_validator
assert_exit_code "$__RUN_EXIT" "2" "no arguments exits 2"
assert_contains "$__RUN_STDERR" "check-node-report.js" "usage error prints check-node-report.js"
assert_not_contains "$__RUN_STDERR" "check-node-report.sh" "usage error does not print the deleted check-node-report.sh"

# (wrapper tests removed since wrapper is deleted)

# Also bash -n this test file itself
bash -n "$0" 2>/dev/null
assert_exit_code "$?" "0" "bash -n check-node-report.test.sh is clean"

finalize_test
