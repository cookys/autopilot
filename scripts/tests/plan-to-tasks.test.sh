#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/plan-to-tasks.js"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT
export HOME="$TMPDIR_TEST/home"
mkdir -p "$HOME"

PASS=0
FAIL=0

# Setup a temp git repo with a valid phases:v1 plan
TEST_REPO="$TMPDIR_TEST/repo"
mkdir -p "$TEST_REPO/docs/plans"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email "test@example.com"
git -C "$TEST_REPO" config user.name "Test User"

cat > "$TEST_REPO/docs/plans/2026-11-25-sample.md" <<'EOF'
# Sample Plan
## 4. Phases
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok 1      | no         | First phase |
| P2 | S    | P1         | echo ok 2      | no         | Second phase |
| P3 | M    | P1, P2     | echo ok 3      | yes        | Third phase |
<!-- /phases -->
EOF

git -C "$TEST_REPO" add docs/plans/2026-11-25-sample.md
git -C "$TEST_REPO" commit -q -m "add sample plan"
COMMIT_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
PLAN_SHA="$(node -e "const fs=require('fs'),crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));" "$TEST_REPO/docs/plans/2026-11-25-sample.md")"

RECEIPT="$TMPDIR_TEST/sample.freeze-receipt.json"
cat > "$RECEIPT" <<EOF
{
  "commit": "$COMMIT_SHA",
  "path": "docs/plans/2026-11-25-sample.md",
  "sha256": "$PLAN_SHA",
  "verdict": "READY"
}
EOF

# Stub fleet binary
FLEET_LOG="$TMPDIR_TEST/fleet.log"
FLEET_STATE="$TMPDIR_TEST/fleet-tasks.json"
echo '[]' > "$FLEET_STATE"

STUB_FLEET="$TMPDIR_TEST/fleet-stub.sh"
cat > "$STUB_FLEET" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$TEST_FLEET_LOG"
cmd="${1:-}"
sub="${2:-}"
if [ "$cmd" = "lock" ]; then
  exit 0
fi
if [ "$cmd" = "tasks" ]; then
  cat "$TEST_FLEET_STATE"
  exit 0
fi
if [ "$cmd" = "dispatch" ]; then
  shift 2
  body="${*: -1}"
  new_id="$(node -e "
    const fs = require('fs');
    const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const id = 'T-' + (state.length + 1);
    state.push({ task_id: id, title: process.argv[2].split('\\n')[0] });
    fs.writeFileSync(process.argv[1], JSON.stringify(state));
    process.stdout.write(id);
  " "$TEST_FLEET_STATE" "$body")"
  echo "$new_id"
  exit 0
fi
exit 1
STUB
chmod +x "$STUB_FLEET"

export PLAN_TO_TASKS_FLEET_BIN="$STUB_FLEET"
export PLAN_TO_TASKS_ASSIGNEE="test/courier/member"
export TEST_FLEET_LOG="$FLEET_LOG"
export TEST_FLEET_STATE="$FLEET_STATE"

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL ($name): expected '$expected', got '$actual'" >&2
    FAIL=$((FAIL + 1))
  fi
}

# 1. Negative controls: zero fleet mutations
: > "$FLEET_LOG"
set +e
(cd "$TEST_REPO" && node "$SCRIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "missing --receipt exits 2" "2" "$rc"
assert_eq "missing --receipt zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"

BAD_SHA_RECEIPT="$TMPDIR_TEST/bad-sha.json"
sed 's/"sha256": "[^"]*"/"sha256": "0000000000000000000000000000000000000000000000000000000000000000"/' "$RECEIPT" > "$BAD_SHA_RECEIPT"
: > "$FLEET_LOG"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$BAD_SHA_RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "bad sha exits 1" "1" "$rc"
assert_eq "bad sha zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"

BAD_VERDICT_RECEIPT="$TMPDIR_TEST/bad-verdict.json"
sed 's/"verdict": "READY"/"verdict": "CONDITIONAL"/' "$RECEIPT" > "$BAD_VERDICT_RECEIPT"
: > "$FLEET_LOG"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$BAD_VERDICT_RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "bad verdict exits 1" "1" "$rc"
assert_eq "bad verdict zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"

# Bad lint plan
cat > "$TEST_REPO/docs/plans/2026-11-25-badlint.md" <<'EOF'
# Bad Plan
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | INVALID | -       | echo ok        | no         | Bad size |
<!-- /phases -->
EOF
git -C "$TEST_REPO" add docs/plans/2026-11-25-badlint.md
git -C "$TEST_REPO" commit -q -m "add badlint plan"
BAD_COMMIT="$(git -C "$TEST_REPO" rev-parse HEAD)"
BAD_PLAN_SHA="$(node -e "const fs=require('fs'),crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));" "$TEST_REPO/docs/plans/2026-11-25-badlint.md")"
BAD_LINT_RECEIPT="$TMPDIR_TEST/bad-lint.json"
cat > "$BAD_LINT_RECEIPT" <<EOF
{"commit":"$BAD_COMMIT","path":"docs/plans/2026-11-25-badlint.md","sha256":"$BAD_PLAN_SHA","verdict":"READY"}
EOF
: > "$FLEET_LOG"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$BAD_LINT_RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "bad lint exits 1" "1" "$rc"
assert_eq "bad lint zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"

# 2. Normal creation
: > "$FLEET_LOG"
echo '[]' > "$FLEET_STATE"
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null
assert_eq "normal creation creates 3 tasks" "3" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"
assert_eq "P1 has no --queue" "0" "$(grep "Phase: P1" "$FLEET_LOG" | grep -c -- "--queue" || true)"
assert_eq "P2 has --queue --after T-1" "1" "$(grep "Phase: P2" "$FLEET_LOG" | grep -c -- "--queue --after T-1" || true)"
assert_eq "P3 has --queue --after T-1 --after T-2" "1" "$(grep "Phase: P3" "$FLEET_LOG" | grep -c -- "--queue --after T-1 --after T-2" || true)"

# 3. Rerun idempotency (remove P3 from state, rerun should only create P3)
node -e "
  const fs = require('fs');
  const s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).slice(0, 2);
  fs.writeFileSync(process.argv[1], JSON.stringify(s));
" "$FLEET_STATE"
: > "$FLEET_LOG"
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null
assert_eq "rerun creates only 1 task" "1" "$(grep -c "^dispatch" "$FLEET_LOG" || true)"
assert_eq "rerun creates P3" "1" "$(grep -c "Phase: P3" "$FLEET_LOG" || true)"

# 4. Extra unknown Phase -> exit 1
node -e "
  const fs = require('fs');
  const s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  s.push({ task_id: 'T-99', title: 'Plan: docs/plans/2026-11-25-sample.md@${COMMIT_SHA:0:12} Phase: P99' });
  fs.writeFileSync(process.argv[1], JSON.stringify(s));
" "$FLEET_STATE"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "unknown phase exits 1" "1" "$rc"

# 5. Missing assignee -> exit 2, zero fleet calls
: > "$FLEET_LOG"
set +e
(cd "$TEST_REPO" && env -u PLAN_TO_TASKS_ASSIGNEE -u AUTOPILOT_FLEET_ADDRESS node "$SCRIPT" --receipt "$RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "missing assignee exits 2" "2" "$rc"
assert_eq "missing assignee zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"

# 6. P6: a terminal adjudicated receipt is accepted; an unknown verdict is not
ADJ_RECEIPT="$TMPDIR_TEST/adjudicated.json"
sed 's/"verdict": "READY"/"verdict": "adjudicated"/' "$RECEIPT" > "$ADJ_RECEIPT"
BOGUS_RECEIPT="$TMPDIR_TEST/bogus-verdict.json"
sed 's/"verdict": "READY"/"verdict": "adjudicated-ish"/' "$RECEIPT" > "$BOGUS_RECEIPT"
: > "$FLEET_LOG"
echo '[]' > "$FLEET_STATE"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$BOGUS_RECEIPT") >/dev/null 2>&1
rc=$?
set -e
assert_eq "unknown verdict exits 1" "1" "$rc"
assert_eq "unknown verdict zero fleet calls" "0" "$(wc -l < "$FLEET_LOG" | tr -d ' ')"
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$ADJ_RECEIPT") >/dev/null
assert_eq "adjudicated receipt creates 3 tasks" "3" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"

# 7. --repo reads the commit from another repo; ASSIGNEE_MAP routes single phases
echo '[]' > "$FLEET_STATE"
: > "$FLEET_LOG"
(cd "$TMPDIR_TEST" && PLAN_TO_TASKS_ASSIGNEE_MAP="P2=other/courier/pm" node "$SCRIPT" --receipt "$RECEIPT" --repo "$TEST_REPO") >/dev/null
assert_eq "--repo creates 3 tasks from outside the repo" "3" "$(grep -c '^dispatch' "$FLEET_LOG" || true)"
assert_eq "map routes P2 to the override" "1" "$(grep -c '^dispatch other/courier/pm .*' "$FLEET_LOG" || true)"
assert_eq "unmapped phases keep the default assignee" "2" "$(grep -c '^dispatch test/courier/member ' "$FLEET_LOG" || true)"
echo '[]' > "$FLEET_STATE"
: > "$FLEET_LOG"
set +e
(cd "$TMPDIR_TEST" && PLAN_TO_TASKS_ASSIGNEE_MAP="P9=other/courier/pm" node "$SCRIPT" --receipt "$RECEIPT" --repo "$TEST_REPO") >/dev/null 2>&1
rc=$?
set -e
assert_eq "map naming an unknown phase exits 2" "2" "$rc"
assert_eq "unknown map phase makes zero dispatches" "0" "$(grep -c '^dispatch' "$FLEET_LOG" || true)"

echo "plan-to-tasks.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
