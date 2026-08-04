#!/usr/bin/env bash
# session-mode.test.sh — black-box CLI contract for scripts/session-mode.js
# (orchestrator-mode marker: set/clear/status, TTL expiry, level validation,
#  session-id keying, atomic overwrite).
# Run: bash hooks/tests/session-mode.test.sh
set -u

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q --no-local "$SOURCE_ROOT" "$TMP/hermetic-repo"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$TMP/hermetic-repo" apply
REPO_ROOT="$TMP/hermetic-repo"
CLI="$REPO_ROOT/scripts/session-mode.js"

export AUTOPILOT_SESSION_MODE_DIR="$TMP/markers"
export CLAUDE_CODE_SESSION_ID="test-session-aaa"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok - $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
check() { # desc, expected-exit, actual-exit
  [ "$2" = "$3" ] && ok "$1" || fail "$1 (want exit $2, got $3)"
}

# 1. status with no marker → active:false, exit 0
OUT=$(node "$CLI" status 2>/dev/null); RC=$?
check "status no-marker exit 0" 0 "$RC"
echo "$OUT" | grep -q '"active": *false' && ok "status no-marker active:false" || fail "status no-marker active:false ($OUT)"

# 2. set l5 → exit 0, marker file exists, status reports level
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1; RC=$?
check "set l5 exit 0" 0 "$RC"
[ -f "$TMP/markers/test-session-aaa.json" ] && ok "marker file created" || fail "marker file created"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"active": *true' && ok "status active:true after set" || fail "status active:true after set ($OUT)"
echo "$OUT" | grep -q '"level": *"l5"' && ok "status level l5" || fail "status level l5 ($OUT)"
echo "$OUT" | grep -q "\"repo_root\": *\"$REPO_ROOT\"" && ok "status repo_root" || fail "status repo_root ($OUT)"

# 3. overwrite: set l3 over l5 → level becomes l3 (same-session mode change; MiniMax stale-marker case)
node "$CLI" set --level l3 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"level": *"l3"' && ok "overwrite l5→l3" || fail "overwrite l5→l3 ($OUT)"

# 4. invalid level → exit 2, no marker change
node "$CLI" set --level l9 --repo-root "$REPO_ROOT" >/dev/null 2>&1; RC=$?
check "invalid level exit 2" 2 "$RC"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"level": *"l3"' && ok "invalid level leaves marker intact" || fail "invalid level leaves marker intact"

# 5. TTL expiry: marker with past expires_at → status active:false (fail-open)
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" --ttl-hours 0 >/dev/null 2>&1
sleep 1
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"active": *false' && ok "expired marker → active:false" || fail "expired marker → active:false ($OUT)"

# 6. clear → marker gone, status active:false, clear again idempotent exit 0
node "$CLI" set --level l4 --repo-root "$REPO_ROOT" >/dev/null 2>&1
node "$CLI" clear >/dev/null 2>&1; RC=$?
check "clear exit 0" 0 "$RC"
[ ! -f "$TMP/markers/test-session-aaa.json" ] && ok "marker removed" || fail "marker removed"
node "$CLI" clear >/dev/null 2>&1; RC=$?
check "clear idempotent exit 0" 0 "$RC"

# 7. non-ENOENT removal errors fail closed instead of reporting a false clear
mkdir -p "$TMP/markers/test-session-aaa.json"
node "$CLI" clear >/dev/null 2>&1; RC=$?
check "clear removal error exit 1" 1 "$RC"
[ -d "$TMP/markers/test-session-aaa.json" ] \
  && ok "clear removal error leaves target intact" \
  || fail "clear removal error leaves target intact"
rmdir "$TMP/markers/test-session-aaa.json"

# 8. session-id isolation: marker for A invisible to session B
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT=$(CLAUDE_CODE_SESSION_ID="test-session-bbb" node "$CLI" status)
echo "$OUT" | grep -q '"active": *false' && ok "session-id isolation" || fail "session-id isolation ($OUT)"

# 9. corrupt marker → status active:false, exit 0 (fail-open)
echo 'not json{{{' > "$TMP/markers/test-session-aaa.json"
OUT=$(node "$CLI" status 2>/dev/null); RC=$?
check "corrupt marker exit 0" 0 "$RC"
echo "$OUT" | grep -q '"active": *false' && ok "corrupt marker → active:false" || fail "corrupt marker → active:false ($OUT)"

# 10. set defaults repo_root to cwd git toplevel when omitted
cd "$REPO_ROOT"
node "$CLI" set --level l6 >/dev/null 2>&1; RC=$?
check "set without --repo-root exit 0" 0 "$RC"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q "\"repo_root\": *\"$REPO_ROOT\"" && ok "repo_root defaults to git toplevel" || fail "repo_root defaults to git toplevel ($OUT)"

# 11. SHADOW-mode routing failure must degrade, not crash.
#
# `admitMissionRouting` deliberately returns a non-fatal record when graph/routing
# resolution fails under `enforcement_mode: shadow` (mission-routing-admission.js:
# `if (policy…enforcement_mode === 'enforce') throw error;` → else `shadowFailure`
# with `admission: null`). `cmdSet` then dereferenced `missionRouting.admission
# .admission_digest` unconditionally, turning that deliberately-non-blocking
# outcome into a hard TypeError — and no marker was written at all, so the
# operator was left worse off than in `off` mode.
SHADOW_REPO="$TMP/shadow-repo"
git init -q "$SHADOW_REPO"
git -C "$SHADOW_REPO" config user.email "session-mode-test@example.invalid"
git -C "$SHADOW_REPO" config user.name "Session Mode Test"
mkdir -p "$SHADOW_REPO/.claude"
# Reuse this repo's governance section (so resolveGovernancePolicy passes) but
# force mission_convergence to shadow. No .claude/mission-routing-config.json is
# written, which is what makes the routing resolution fail.
node - "$REPO_ROOT/.claude/owner-kernel-governance.json" \
  "$SHADOW_REPO/.claude/owner-kernel-governance.json" <<'NODE'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(src, 'utf8'));
value.mission_convergence = {
  schema_version: 1,
  enforcement_mode: 'shadow',
  max_campaigns: 4,
  max_wall_seconds: 7200,
  max_tool_calls: 1000,
  max_engine_attempts: 20,
  max_external_wait_seconds: 600,
  max_canonical_changed_files: 50,
  max_output_bytes: 10000000,
  max_deliverables: 4,
  max_parallel: 2,
  max_batches: 2,
  max_graph_depth: 2,
  max_gate_attempts: 8,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(dst, `${JSON.stringify(value, null, 2)}\n`);
NODE
printf 'shadow\n' > "$SHADOW_REPO/README.md"
git -C "$SHADOW_REPO" add -A
git -C "$SHADOW_REPO" commit -qm "shadow fixture"

# Guard: the fixture must actually be in shadow mode, otherwise this case would
# silently exercise the LEGACY (`off`) path and pass without touching the bug.
SHADOW_MODE=$(node -e "
  const m = require('$REPO_ROOT/scripts/implementation-campaign-check.js');
  process.stdout.write(m.projectMissionMode(process.argv[1]));
" "$SHADOW_REPO" 2>/dev/null)
[ "$SHADOW_MODE" = "shadow" ] \
  && ok "shadow fixture is in shadow mode" \
  || fail "shadow fixture is in shadow mode (got '$SHADOW_MODE')"

CLAUDE_CODE_SESSION_ID="test-session-shadow" \
  node "$CLI" set --level l5 --repo-root "$SHADOW_REPO" >/dev/null 2>&1; RC=$?
check "set under SHADOW routing failure exits 0 (degrade, not crash)" 0 "$RC"
SHADOW_MARKER="$TMP/markers/test-session-shadow.json"
[ -f "$SHADOW_MARKER" ] \
  && ok "SHADOW marker written despite routing failure" \
  || fail "SHADOW marker written despite routing failure"
if [ -f "$SHADOW_MARKER" ]; then
  SHADOW_SHAPE=$(node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const r = m.mission_routing || {};
    process.stdout.write([
      `status=${r.status}`,
      `admitted=${r.admitted}`,
      `would_block=${r.would_block}`,
      `admission_null=${r.admission === null}`,
      `has_noop=${Object.prototype.hasOwnProperty.call(m, "mission_noop")}`,
    ].join(" "));
  ' "$SHADOW_MARKER")
  [ "$SHADOW_SHAPE" = "status=SHADOW admitted=false would_block=true admission_null=true has_noop=false" ] \
    && ok "SHADOW marker records the non-admission and omits mission_noop" \
    || fail "SHADOW marker shape ($SHADOW_SHAPE)"
fi

# 12. NEGATIVE CONTROL for #11: the fix must skip `mission_noop` only when there
# is no admission to bind it to. Without this case, "never emit mission_noop"
# would satisfy #11 just as well and silently strip the no-op surface that
# dispatch-hetero.sh reads via verifyMissionRoutingProjection.
CLAUDE_CODE_SESSION_ID="test-session-enforce" \
  node "$CLI" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1; RC=$?
check "set under enforced READY admission exits 0" 0 "$RC"
ENFORCE_MARKER="$TMP/markers/test-session-enforce.json"
if [ -f "$ENFORCE_MARKER" ]; then
  ENFORCE_SHAPE=$(node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const r = m.mission_routing || {};
    const n = m.mission_noop || {};
    const sha = (v) => /^[a-f0-9]{64}$/u.test(v || "");
    process.stdout.write([
      `status=${r.status}`,
      `admission_present=${r.admission !== null && r.admission !== undefined}`,
      `noop_digest=${sha(n.digest)}`,
      `noop_admission_digest=${sha(n.admission_digest)}`,
    ].join(" "));
  ' "$ENFORCE_MARKER")
  [ "$ENFORCE_SHAPE" = "status=READY admission_present=true noop_digest=true noop_admission_digest=true" ] \
    && ok "READY admission still emits a digest-bound mission_noop" \
    || fail "READY admission mission_noop shape ($ENFORCE_SHAPE)"
else
  fail "enforce marker written"
fi

# 13. Strict managed admission distinguishes every invalid marker class while
# preserving one all-zero rejection contract. A linked worktree is the positive
# control: it shares Git common-dir identity with the controller marker and must
# not self-lock the canonical managed path.
MANAGED_WORKTREE="$TMP/managed-worktree"
git -C "$REPO_ROOT" worktree add -q --detach "$MANAGED_WORKTREE" HEAD
D3_OUT=$(node - "$REPO_ROOT" "$ENFORCE_MARKER" "$MANAGED_WORKTREE" "$SHADOW_REPO" "$TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, markerPath, managedWorktree, foreignRepo, tmp] = process.argv.slice(2);
const {
  DEV_FLOW_ADMISSION_REJECTION_CODE,
  devFlowAdmissionRejection,
  markerRepoIdentity,
  validateManagedDevFlowAdmission,
} = require(path.join(root, 'scripts', 'session-mode.js'));
const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
process.env.CLAUDE_CODE_SESSION_ID = marker.session_id;
const admission = marker.mission_routing.admission;
const campaign = {
  repo_identity: markerRepoIdentity(managedWorktree),
  mission_runtime: {
    mission_policy_digest: admission.mission_policy_digest,
    mission_graph_digest: admission.mission_graph_digest,
  },
};
const write = (name, value) => {
  const file = path.join(tmp, `${name}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
  return file;
};
const cases = [
  ['absent', path.join(tmp, 'absent.json'), 'l5', campaign, /absent/],
  ['expired', write('expired', { ...marker, expires_at: '2000-01-01T00:00:00.000Z' }), 'l5', campaign, /expired/],
  ['malformed', write('malformed', 'not-json\n'), 'l5', campaign, /malformed/],
  ['repository', write('repository', { ...marker, repo_root: foreignRepo }), 'l5', campaign, /repository mismatch/],
  ['level', markerPath, 'l4', campaign, /level mismatch/],
  ['mission', markerPath, 'l5', {
    ...campaign,
    mission_runtime: { ...campaign.mission_runtime, mission_policy_digest: '0'.repeat(64) },
  }, /Mission projection mismatch/],
];
for (const [name, file, level, boundCampaign, reason] of cases) {
  const result = validateManagedDevFlowAdmission({
    repoRoot: managedWorktree,
    effectiveLevel: level,
    campaignContract: boundCampaign,
    markerFile: file,
  });
  assert.strictEqual(result.valid, false, name);
  const rejection = devFlowAdmissionRejection(result.reason);
  assert.strictEqual(rejection.status, 'blocked', name);
  assert.strictEqual(rejection.phase, 'dev_flow_admission', name);
  assert.strictEqual(rejection.rejection_code, DEV_FLOW_ADMISSION_REJECTION_CODE, name);
  assert.strictEqual(rejection.dispatcher_called, false, name);
  assert.strictEqual(rejection.model_calls, 0, name);
  assert.strictEqual(rejection.mutation_attempts, 0, name);
  assert.strictEqual(rejection.resources_created, 0, name);
  assert.match(rejection.reason, reason, name);
}
const positive = validateManagedDevFlowAdmission({
  repoRoot: managedWorktree,
  effectiveLevel: 'l5',
  campaignContract: campaign,
  markerFile: markerPath,
});
assert.strictEqual(positive.valid, true);
assert.strictEqual(positive.repo_identity, markerRepoIdentity(root));
assert.match(positive.sources_digest, /^[a-f0-9]{64}$/u);
const stableMarker = path.join(path.dirname(markerPath), 'codex-stable-session.json');
fs.copyFileSync(markerPath, stableMarker);
process.env.AUTOPILOT_SESSION_ID = 'codex-stable-session';
process.chdir(managedWorktree);
const copiedSessionMarker = validateManagedDevFlowAdmission({
  repoRoot: managedWorktree,
  effectiveLevel: 'l5',
  campaignContract: campaign,
});
assert.strictEqual(copiedSessionMarker.valid, false);
assert.match(copiedSessionMarker.reason, /session mismatch/);
process.stdout.write('managed_admission_matrix_ready');
NODE
); RC=$?
check "managed admission matrix exits 0" 0 "$RC"
[ "$D3_OUT" = "managed_admission_matrix_ready" ] \
  && ok "managed admission matrix rejects six invalid classes and admits linked worktree" \
  || fail "managed admission matrix output ($D3_OUT)"

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
