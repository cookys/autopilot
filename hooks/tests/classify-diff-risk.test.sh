#!/usr/bin/env bash
# classify-diff-risk.sh integration test — domain matching, adversarial checklists,
# low-risk sampling, and closed-loop append-rule write-back.
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

SENSITIVE_DIFF="$TEST_TMP/sensitive.diff"
cat > "$SENSITIVE_DIFF" <<'DIFF'
diff --git a/auth/session-token.ts b/auth/session-token.ts
index 1111111..2222222 100644
--- a/auth/session-token.ts
+++ b/auth/session-token.ts
@@ -10,6 +10,7 @@
 const user = lookupUser(tenant_id);
+// tenant boundary check
 +if (tenant_id === 0) throw new Error("tenant_id invalid");
DIFF

SENSITIVE_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$SENSITIVE_DIFF" --sampling-ratio 0 --source-trust low --oracle-available 1 --security-surface 0)"
assert_neq "$SENSITIVE_OUT" "" "sensitive classification emits JSON"
SENSITIVE_DOMAINS="$(json_get "$SENSITIVE_OUT" domains)"
SENSITIVE_CHECKLISTS="$(json_get "$SENSITIVE_OUT" checklists)"
assert_contains "$SENSITIVE_DOMAINS" '"auth"' "sensitive diff detects auth domain"
assert_contains "$SENSITIVE_DOMAINS" '"tenant"' "sensitive diff detects tenant domain"
assert_contains "$SENSITIVE_CHECKLISTS" '"authz-boundary"' "auth domain maps to authz-boundary checklist"
assert_contains "$SENSITIVE_CHECKLISTS" '"tenant-boundary"' "tenant domain maps to tenant-boundary checklist"
assert_eq "$(json_get "$SENSITIVE_OUT" adversarial_review)" "true" "sensitive diff is marked adversarial_review"

QUOTED_BINARY_RULES="$TEST_TMP/quoted-binary-rules.tsv"
printf 'quoted-binary\tpath\t^secure dir/auth "key"\\.bin$\tbinary-path-review\n' > "$QUOTED_BINARY_RULES"
QUOTED_BINARY_DIFF="$TEST_TMP/quoted-binary.diff"
cat > "$QUOTED_BINARY_DIFF" <<'DIFF'
diff --git "a/secure dir/auth \"key\".bin" "b/secure dir/auth \"key\".bin"
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmeZQzW1
DIFF

QUOTED_BINARY_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$QUOTED_BINARY_DIFF" --rules-file "$QUOTED_BINARY_RULES" --sampling-ratio 0)"
assert_contains "$(json_get "$QUOTED_BINARY_OUT" domains)" '"quoted-binary"' "quoted binary diff header preserves the full path"
assert_contains "$(json_get "$QUOTED_BINARY_OUT" checklists)" '"binary-path-review"' "protected binary path emits its checklist"
assert_eq "$(json_get "$QUOTED_BINARY_OUT" risk_flags.protected_path)" "1" "protected binary path sets the risk flag"
assert_eq "$(json_get "$QUOTED_BINARY_OUT" adversarial_review)" "true" "protected binary path requires adversarial review"

RENAME_DIFF="$TEST_TMP/rename.diff"
cat > "$RENAME_DIFF" <<'DIFF'
diff --git a/docs/session.ts b/auth/session.ts
similarity index 100%
rename from docs/session.ts
rename to auth/session.ts
DIFF
RENAME_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$RENAME_DIFF" --sampling-ratio 0)"
assert_contains "$(json_get "$RENAME_OUT" domains)" '"auth"' "rename destination still participates in path classification"
assert_contains "$(json_get "$RENAME_OUT" checklists)" '"authz-boundary"' "rename path behavior remains intact"

BENIGN_DIFF="$TEST_TMP/benign.diff"
cat > "$BENIGN_DIFF" <<'DIFF'
diff --git a/docs/readme.md b/docs/readme.md
index 3333333..4444444 100644
--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1,3 +1,3 @@
 # README
 // harmless comment
 +This is a docs-only update.
DIFF

BENIGN_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$BENIGN_DIFF" --sampling-ratio 0 --source-trust high --oracle-available 1 --security-surface 0)"
assert_eq "$(json_get "$BENIGN_OUT" domains)" "[]" "benign diff yields no detected domains"
assert_eq "$(json_get "$BENIGN_OUT" checklists)" "[]" "benign diff yields no checklists"
assert_eq "$(json_get "$BENIGN_OUT" adversarial_review)" "false" "benign diff is non-adversarial without sampling"

SAMPLING_OUT="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$BENIGN_DIFF" --sampling-ratio 1 --sampling-seed classifier-seed --source-trust high --oracle-available 1 --security-surface 0)"
assert_eq "$(json_get "$SAMPLING_OUT" "sampling.selected")" "true" "low-risk diff selected by sampling ratio 1"
assert_eq "$(json_get "$SAMPLING_OUT" "sampling.reason")" "low-risk-sampling" "low-risk sampling reason is recorded"
assert_eq "$(json_get "$SAMPLING_OUT" adversarial_review)" "true" "sampling-selected low-risk diff is adversarial_review"
assert_contains "$(json_get "$SAMPLING_OUT" checklists)" '"sampling-sanity"' "sampling-low-risk adds sampling-sanity checklist"

RULES_FILE="$TEST_TMP/custom-diff-risk-rules.tsv"
WRITEBACK_DIFF="$TEST_TMP/writeback.diff"
cat > "$WRITEBACK_DIFF" <<'DIFF'
diff --git a/ops/legacy_billing_notes.txt b/ops/legacy_billing_notes.txt
index 5555555..6666666 100644
--- a/ops/legacy_billing_notes.txt
+++ b/ops/legacy_billing_notes.txt
@@ -1 +1,2 @@
 notes.md
+legacy update
DIFF

WRITEBACK_BEFORE="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$WRITEBACK_DIFF" --rules-file "$RULES_FILE" --sampling-ratio 0)"
assert_eq "$(json_get "$WRITEBACK_BEFORE" domains)" "[]" "custom rule file initially misses unseen domain"

APPEND_OUT="$(bash "$SCRIPT" append-rule --repo "$TEST_TMP" --rules-file "$RULES_FILE" --domain billing-risk --scope path --pattern '(^|/)ops/legacy_billing_notes\.txt$' --checklist 'billing-contracts,legacy-risk' 2>&1)"
assert_contains "$APPEND_OUT" '"status":"ok"' "append-rule command reports status ok"

WRITEBACK_AFTER="$(bash "$SCRIPT" --repo "$TEST_TMP" --diff-file "$WRITEBACK_DIFF" --rules-file "$RULES_FILE" --sampling-ratio 0)"
assert_contains "$(json_get "$WRITEBACK_AFTER" domains)" '"billing-risk"' "append-rule domain is now detected"
assert_contains "$(json_get "$WRITEBACK_AFTER" checklists)" '"billing-contracts"' "append-rule checklist is now emitted"
assert_contains "$(json_get "$WRITEBACK_AFTER" checklists)" '"legacy-risk"' "append-rule second checklist is now emitted"

finalize_test
