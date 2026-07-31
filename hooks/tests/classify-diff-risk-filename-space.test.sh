#!/usr/bin/env bash
# Independent verification test for diff path space truncation.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/classify-diff-risk.sh"

json_get() {
  local json="$1"
  local key="$2"
  node - "$key" "$json" <<'NODE'
const fs = require('fs');
const key = process.argv[2];
const payload = String(process.argv[3] || '').trim();
if (!payload) process.exit(0);
let parsed;
try {
  parsed = JSON.parse(payload);
} catch (_error) {
  process.exit(1);
}
const parts = String(key).split('.');
let current = parsed;
for (const part of parts) {
  if (current === undefined || current === null) {
    process.exit(0);
  }
  current = current[part];
}
if (current === undefined) process.exit(0);
if (typeof current === 'string') {
  process.stdout.write(current);
} else {
  process.stdout.write(JSON.stringify(current));
}
NODE
}

# 1. Test space-containing filename preservation.
# We set up a custom rule that strictly matches the full path with spaces.
RULES_FILE="$TEST_TMP/custom-rules.tsv"
printf "space-test\tpath\t^some dir/file with spaces\\.rs$\tspace-checklist\n" > "$RULES_FILE"

SPACE_DIFF="$TEST_TMP/space.diff"
cat > "$SPACE_DIFF" <<'DIFF'
diff --git a/some dir/file with spaces.rs b/some dir/file with spaces.rs
index 1111111..2222222 100644
--- a/some dir/file with spaces.rs
+++ b/some dir/file with spaces.rs
@@ -1,3 +1,3 @@
 // harmless
 +added line
DIFF

SPACE_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$SPACE_DIFF" --rules-file "$RULES_FILE" --sampling-ratio 0)"
SPACE_DOMAINS="$(json_get "$SPACE_OUT" domains)"
SPACE_CHECKLISTS="$(json_get "$SPACE_OUT" checklists)"

assert_contains "$SPACE_DOMAINS" '"space-test"' "diff with space in filename should match the custom path rule"
assert_contains "$SPACE_CHECKLISTS" '"space-checklist"' "diff with space in filename should trigger custom checklist"

# 2. Test bypass consequence.
# A file with spaces before a sensitive keyword (auth) which is pushed past the truncation point.
SENSITIVE_DIFF="$TEST_TMP/sensitive_space.diff"
cat > "$SENSITIVE_DIFF" <<'DIFF'
diff --git a/dir with spaces/auth/file.ts b/dir with spaces/auth/file.ts
index 1111111..2222222 100644
--- a/dir with spaces/auth/file.ts
+++ b/dir with spaces/auth/file.ts
@@ -1,3 +1,3 @@
 // harmless
 +added line
DIFF

# We run with default rules, which has the "auth" rule for path.
SENSITIVE_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$SENSITIVE_DIFF" --sampling-ratio 0)"
SENSITIVE_DOMAINS="$(json_get "$SENSITIVE_OUT" domains)"
SENSITIVE_CHECKLISTS="$(json_get "$SENSITIVE_OUT" checklists)"

assert_contains "$SENSITIVE_DOMAINS" '"auth"' "sensitive path with spaces should match default auth rule"
assert_contains "$SENSITIVE_CHECKLISTS" '"authz-boundary"' "sensitive path with spaces should trigger authz-boundary checklist"

# 3. Paths that start with b/ must preserve that top-level directory.
BP_RULES_FILE="$TEST_TMP/bprefix-rules.tsv"
printf 'b-prefix\tpath\t^b/x$\tb-prefix-check\n' > "$BP_RULES_FILE"

B_PREFIX_DIFF="$TEST_TMP/bprefix.diff"
cat > "$B_PREFIX_DIFF" <<'DIFF'
diff --git a/b/x b/b/x
index 1111111..2222222 100644
--- a/b/x
+++ b/b/x
@@ -1,2 +1,2 @@
 old line
+new line
DIFF

B_PREFIX_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$B_PREFIX_DIFF" --rules-file "$BP_RULES_FILE" --sampling-ratio 0)"
B_PREFIX_DOMAINS="$(json_get "$B_PREFIX_OUT" domains)"
B_PREFIX_CHECKLISTS="$(json_get "$B_PREFIX_OUT" checklists)"
assert_contains "$B_PREFIX_DOMAINS" '"b-prefix"' "path rule matches when file path truly starts with b/"
assert_contains "$B_PREFIX_CHECKLISTS" '"b-prefix-check"' "matched b/ path rule emits configured checklist"

# 4. A literal " b/" inside an unchanged unquoted path is not the header
# separator. Git emits this shape without quoting, so the parser must identify
# the unique split whose a/ and b/ payloads are equal.
AMBIGUOUS_RULES_FILE="$TEST_TMP/ambiguous-rules.tsv"
printf 'ambiguous-path\tpath\t^secure b/permission\\.bin$\tambiguous-path-review\n' > "$AMBIGUOUS_RULES_FILE"
AMBIGUOUS_DIFF="$TEST_TMP/ambiguous.diff"
cat > "$AMBIGUOUS_DIFF" <<'DIFF'
diff --git a/secure b/permission.bin b/secure b/permission.bin
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmeZQzW1
DIFF
AMBIGUOUS_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$AMBIGUOUS_DIFF" --rules-file "$AMBIGUOUS_RULES_FILE" --sampling-ratio 0)"
assert_contains "$(json_get "$AMBIGUOUS_OUT" domains)" '"ambiguous-path"' "literal b-slash segment does not steal the diff-header separator"
assert_contains "$(json_get "$AMBIGUOUS_OUT" checklists)" '"ambiguous-path-review"' "ambiguous path emits its custom checklist"
assert_eq "$(json_get "$AMBIGUOUS_OUT" risk_flags.protected_path)" "1" "ambiguous protected path sets the risk flag"
assert_eq "$(json_get "$AMBIGUOUS_OUT" adversarial_review)" "true" "ambiguous protected path requires adversarial review"

# 5. Git C-quotes control characters. Decoding a quoted newline must remain one
# path record rather than becoming extra mapfile lines.
NEWLINE_RULES_FILE="$TEST_TMP/newline-rules.tsv"
printf 'newline-path\tpath\tpermission\\.bin$\tnewline-path-review\n' > "$NEWLINE_RULES_FILE"
NEWLINE_DIFF="$TEST_TMP/newline.diff"
cat > "$NEWLINE_DIFF" <<'DIFF'
diff --git "a/secure\npermission.bin" "b/secure\npermission.bin"
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmeZQzW1
DIFF
NEWLINE_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$NEWLINE_DIFF" --rules-file "$NEWLINE_RULES_FILE" --sampling-ratio 0)"
assert_contains "$(json_get "$NEWLINE_OUT" domains)" '"newline-path"' "quoted newline remains inside one decoded path record"
assert_contains "$(json_get "$NEWLINE_OUT" checklists)" '"newline-path-review"' "quoted newline path emits its custom checklist"
assert_eq "$(json_get "$NEWLINE_OUT" risk_flags.protected_path)" "1" "quoted newline protected path sets the risk flag"
assert_eq "$(json_get "$NEWLINE_OUT" adversarial_review)" "true" "quoted newline protected path requires adversarial review"

finalize_test
