#!/usr/bin/env bash
# Test for D8b inputs-landed gate in .githooks/pre-push:
# - Throwaway git repo: input sha is NOT an ancestor of remote target -> pre-push exits non-zero naming the id.
# - Make input sha an ancestor of remote target -> pre-push exits 0.
# - Negative control: AUTOPILOT_PREPUSH_INPUTS=off passes the bad case.
# - No plan or plan with no declared inputs -> silent pass.
. "$(dirname "$0")/lib.sh"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"

REMOTE="$TEST_TMP/remote.git"
SBX="$TEST_TMP/sbx"
$GIT init -q --bare "$REMOTE"
mkdir -p "$SBX/.githooks" "$SBX/scripts/lib" "$SBX/.claude"

cp "$REPO_ROOT/.githooks/pre-push" "$SBX/.githooks/pre-push"
chmod +x "$SBX/.githooks/pre-push"
cp "$REPO_ROOT/scripts/check-inputs-landed.js" "$SBX/scripts/check-inputs-landed.js"
cp "$REPO_ROOT/scripts/resolve-qc-gate.sh" "$SBX/scripts/resolve-qc-gate.sh"
chmod +x "$SBX/scripts/resolve-qc-gate.sh"
for f in json-emit.sh resolve-config.sh qc-evidence.sh; do
  cp "$REPO_ROOT/scripts/lib/$f" "$SBX/scripts/lib/$f"
done
printf -- '- mode: off\n' > "$SBX/.claude/qc-gate-config.md"

$GIT -C "$SBX" init -q
$GIT -C "$SBX" config core.hooksPath "$SBX/.githooks"
$GIT -C "$SBX" remote add origin "$REMOTE"
echo "base" > "$SBX/base.txt"
$GIT -C "$SBX" add base.txt
$GIT -C "$SBX" commit -q -m "initial base"
$GIT -C "$SBX" push -q -u origin develop

# --- Case 1: no plan -> silent pass ---
$GIT -C "$SBX" checkout -q -b feat/no-plan develop
echo "work" > "$SBX/work.txt"
$GIT -C "$SBX" add work.txt
$GIT -C "$SBX" commit -q -m "feat: work without plan"
PUSH_ERR="$($GIT -C "$SBX" push -q origin feat/no-plan 2>&1)"
PUSH_RC=$?
assert_eq 0 "$PUSH_RC" "no-plan push exits 0"
assert_eq "" "$PUSH_ERR" "no-plan push is silent"

# --- Case 1b: plan without ## Inputs -> silent pass ---
$GIT -C "$SBX" checkout -q -b feat/no-inputs develop
mkdir -p "$SBX/docs/plans"
cat > "$SBX/docs/plans/2026-11-13-no-inputs.md" <<'EOF'
# Feature without declared inputs

## Goal
Ship standalone change.
EOF
$GIT -C "$SBX" add docs/plans/2026-11-13-no-inputs.md
$GIT -C "$SBX" commit -q -m "docs: plan without inputs"
PUSH_ERR="$($GIT -C "$SBX" push -q origin feat/no-inputs 2>&1)"
PUSH_RC=$?
assert_eq 0 "$PUSH_RC" "plan-without-inputs push exits 0"
assert_eq "" "$PUSH_ERR" "plan-without-inputs push is silent"

# --- Case 2: input sha committed on wrong tree (NOT an ancestor of remote target) -> blocked naming id ---
$GIT -C "$SBX" checkout -q -b wrong-tree develop
echo "upstream fix on wrong tree" > "$SBX/upstream.txt"
$GIT -C "$SBX" add upstream.txt
$GIT -C "$SBX" commit -q -m "fix: upstream input on wrong tree"
INPUT_SHA="$($GIT -C "$SBX" rev-parse HEAD)"

$GIT -C "$SBX" checkout -q -b feat/d8b-consumer develop
mkdir -p "$SBX/docs/plans"
cat > "$SBX/docs/plans/2026-11-13-d8b-consumer.md" <<EOF
# Consumer task

Branch: \`feat/d8b-consumer\`

## Inputs

\`\`\`json
{"inputs":[{"id":"inp-wrong-tree","sha":"$INPUT_SHA"}]}
\`\`\`
EOF
$GIT -C "$SBX" add docs/plans/2026-11-13-d8b-consumer.md
$GIT -C "$SBX" commit -q -m "feat: consumer depending on inp-wrong-tree"

PUSH_ERR="$($GIT -C "$SBX" push origin feat/d8b-consumer 2>&1)"
PUSH_RC=$?
if [ "$PUSH_RC" -eq 0 ]; then
  fail "unlanded input push should exit non-zero, got 0"
else
  assert_eq ok ok "unlanded input push exits non-zero ($PUSH_RC)"
fi
assert_contains "$PUSH_ERR" "inp-wrong-tree" "blocked push names failing input id"
assert_contains "$PUSH_ERR" "NOT-LANDED" "blocked push includes check-inputs-landed diagnostic"

# Also verify pushing directly to remote develop ref blocks with the same id
PUSH_DEV_ERR="$($GIT -C "$SBX" push origin feat/d8b-consumer:develop 2>&1)"
PUSH_DEV_RC=$?
if [ "$PUSH_DEV_RC" -eq 0 ]; then
  fail "unlanded input push to develop should exit non-zero, got 0"
else
  assert_eq ok ok "unlanded input push to develop exits non-zero ($PUSH_DEV_RC)"
fi
assert_contains "$PUSH_DEV_ERR" "inp-wrong-tree" "blocked push to develop names failing input id"

# --- Case 3 (Negative control): AUTOPILOT_PREPUSH_INPUTS=off passes the bad case ---
BYPASS_ERR="$(AUTOPILOT_PREPUSH_INPUTS=off $GIT -C "$SBX" push -q origin feat/d8b-consumer:refs/heads/bypass-probe 2>&1)"
BYPASS_RC=$?
assert_eq 0 "$BYPASS_RC" "negative control: AUTOPILOT_PREPUSH_INPUTS=off passes bad case"

# --- Case 4: land input sha onto remote target (origin/develop) -> push exits 0 ---
$GIT -C "$SBX" checkout -q develop
$GIT -C "$SBX" merge -q --ff-only wrong-tree
$GIT -C "$SBX" push -q origin develop
$GIT -C "$SBX" checkout -q feat/d8b-consumer

LANDED_ERR="$($GIT -C "$SBX" push -q origin feat/d8b-consumer 2>&1)"
LANDED_RC=$?
assert_eq 0 "$LANDED_RC" "after input lands on origin/develop, feature push exits 0 ($LANDED_ERR)"

# Pushing a fast-forward onto remote develop now also passes because remote develop has INPUT_SHA
$GIT -C "$SBX" rebase -q develop
LANDED_DEV_ERR="$($GIT -C "$SBX" push -q origin feat/d8b-consumer:develop 2>&1)"
LANDED_DEV_RC=$?
assert_eq 0 "$LANDED_DEV_RC" "after input lands on remote develop, push to develop exits 0 ($LANDED_DEV_ERR)"

finalize_test
