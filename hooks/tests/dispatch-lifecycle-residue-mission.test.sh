#!/usr/bin/env bash
# Row 3: lease-gc must not abort the loop on one failed transition.
. "$(dirname "$0")/lib.sh"

assert_r3_run_ledger_sh_lease() {
  local RL="$REPO_ROOT/scripts/run-ledger.sh"
  local LR="$TEST_TMP/r3-lease-gc.jsonl"
  local CONTROLLER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"

  unset AUTOPILOT_SESSION_ID
  unset CLAUDE_CODE_SESSION_ID

  sleep 30 &
  local DEAD_PID=$!
  local DEAD_START
  DEAD_START="$(awk '{print $22}' "/proc/$DEAD_PID/stat" 2>/dev/null || echo 1)"
  kill "$DEAD_PID" >/dev/null 2>&1 || true
  wait "$DEAD_PID" 2>/dev/null || true
  local OLD_HB=$(($(date +%s) - 50000))

  bash "$RL" init --ledger "$LR" >/dev/null
  bash "$RL" stage-acquire --ledger "$LR" --run-id aaa-fail --stage campaign \
    --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
    --worktree "$TEST_TMP/r3-no-wt-fail" >/dev/null
  python3 - "$LR" <<'PY'
import json, sys
path = sys.argv[1]
rows = []
with open(path) as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row.get("kind") == "stage" and row.get("run_id") == "aaa-fail":
            row.pop("nonce", None)
        rows.append(row)
with open(path, "w") as fh:
    for row in rows:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")
PY
  bash "$RL" stage-acquire --ledger "$LR" --run-id zzz-ok --stage campaign \
    --pid "$DEAD_PID" --start-time "$DEAD_START" --heartbeat-ts "$OLD_HB" \
    --worktree "$TEST_TMP/r3-no-wt-ok" >/dev/null

  local GC_REPO="$TEST_TMP/r3-reap-repo"
  mkdir -p "$GC_REPO"
  git -C "$GC_REPO" init -q -b develop
  git -C "$GC_REPO" -c user.email=wlb@test -c user.name=wlb \
    commit -q --allow-empty -m "r3 lease-gc wrapper fixture"
  local GC_COMMON
  GC_COMMON="$(git -C "$GC_REPO" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$GC_COMMON/autopilot"
  local GC_LEDGER="$GC_COMMON/autopilot/implementation-campaign.jsonl"
  cp "$LR" "$GC_LEDGER"

  local GC_OUT GC_EC
  set +e
  GC_OUT="$(bash "$RL" lease-gc --ledger "$LR" --ttl-secs 43200 --json 2>/dev/null)"
  GC_EC=$?
  set -e
  # RED at f61a0aab8603686e004fba27fec7cefd1f8fed61: lease-gc exits 1 with empty
  # stdout (loop abort inside command_stage_transition via error/exit) so no
  # JSON; appended never reported for zzz-ok.
  assert_eq "$GC_EC" "0" "lease-gc --json exits 0 after a per-lease failure"
  assert_eq "$(jq -r .failed <<<"$GC_OUT")" "1" "failed counts the corrupt lease"
  assert_eq "$(jq -r .dead <<<"$GC_OUT")" "2" "both stale leases counted dead"
  assert_eq "$(jq -r .appended <<<"$GC_OUT")" "1" "healthy lease still appended"
  assert_eq "$(jq -r .scanned <<<"$GC_OUT")" "2" "loop scanned both leases"

  AUTOPILOT_TEST_MODE=1 "$CONTROLLER" reap --repo "$GC_REPO" \
    --root-run-id "r3-lease-gc-root" --yes > "$TEST_TMP/r3-reap.json"
  assert_exit_code "$?" "0" "reap with mixed lease-gc ledger succeeds"
  assert_eq "$(jq -r '.lease_gc.failed' < "$TEST_TMP/r3-reap.json")" "1" \
    "wrapper keeps failed=1 instead of zero-defaulting"
  assert_eq "$(jq -r '.lease_gc.appended' < "$TEST_TMP/r3-reap.json")" "1" \
    "wrapper keeps healthy appended instead of zeros"
  assert_eq "$(jq -r '.lease_gc.scanned' < "$TEST_TMP/r3-reap.json")" "2" \
    "wrapper keeps scanned instead of zeros"
}

assert_r16_dispatch_foreman_tes() {
  # Regression guard, not a RED→GREEN pin. BACKLOG row 16 appears already
  # resolved by 8de50578; this row adds a regression guard only, no product
  # fix; the BACKLOG row itself is stale and needs closure (out of this
  # bundle's scope — no BACKLOG.md edits).
  # Actual base Summary (parent GIT overlay + sibling-prefix stripped):
  #   PASS [dispatch-foreman] 115 assertions
  local out ec
  out="$(
    unset GIT_ALLOW_PROTOCOL GIT_CONFIG_COUNT GIT_TERMINAL_PROMPT
    unset AUTOPILOT_DISPATCH_SIBLING_REF_PREFIX AUTOPILOT_DISPATCH_DEPTH
    unset AUTOPILOT_PARENT_RUN_ID AUTOPILOT_ROOT_RUN_ID AUTOPILOT_WORKTREE_ROOT_RUN_ID
    for i in $(seq 0 40); do
      unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"
    done
    env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      bash "$REPO_ROOT/hooks/tests/dispatch-foreman.test.sh" < /dev/null 2>&1
  )"
  ec=$?
  assert_eq "$ec" "0" "r16: dispatch-foreman.test.sh subprocess exits 0"
  assert_contains "$out" "PASS [dispatch-foreman]" \
    "r16: Summary shows 0 failed"
}

assert_r19_pin_store_hardening() {
  local STORE_SRC="$REPO_ROOT/scripts/lib/jsonl-store.js"
  # (1) writeSnapshot fsyncs the temp file and the directory (RED at base: no fsync).
  assert_contains "$(cat "$STORE_SRC")" "fsyncSync" \
    "r19: jsonl-store.js fsyncs (temp fd and directory)"
  local fsync_n
  fsync_n="$(grep -c 'fsyncSync' "$STORE_SRC")"
  assert_eq "$(test "$fsync_n" -ge 2 && echo yes || echo no)" "yes" \
    "r19: at least two fsyncSync sites (temp fd + directory fd)"

  local SCRATCH="$TEST_TMP/r19-pin-store"
  mkdir -p "$SCRATCH"
  local STORE="$SCRATCH/pins.jsonl"
  local ORPHAN="$SCRATCH/.pins.jsonl.tmp.12345.999"
  local FRESH="$SCRATCH/.pins.jsonl.tmp.99999.1"
  printf 'orphan-body\n' > "$ORPHAN"
  printf 'fresh-body\n' > "$FRESH"
  node -e '
    const fs = require("fs");
    const orphan = process.argv[1];
    const st = fs.statSync(orphan);
    const aged = new Date(Date.now() - 30_000);
    fs.utimesSync(orphan, aged, aged);
  ' "$ORPHAN"

  node -e '
    const s = require(process.argv[1]);
    s.writeSnapshot(process.argv[2], [{ k: 1 }]);
  ' "$STORE_SRC" "$STORE"

  assert_file_absent "$ORPHAN" "r19: aged orphan tmp must be swept"
  assert_file_exists "$FRESH" "r19: recent same-shaped tmp must be kept"
  assert_file_exists "$STORE" "r19: writeSnapshot must publish the store file"
}

assert_r92_reap_dispatch_branch() {
  local SCRIPT="$REPO_ROOT/scripts/reap-dispatch-branches.sh"
  local repo="$TEST_TMP/r92-reap-branches"
  git init -q -b develop "$repo"
  git -C "$repo" -c user.email=wlb@test -c user.name=wlb \
    commit -q --allow-empty -m "r92 scan --all fixture"
  local base common key
  base="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" branch agent/attributed-r1-20260921 develop
  git -C "$repo" branch agent/orphan-r1-20260921 develop
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$common/autopilot-worktree-branch-inventory"
  chmod 700 "$common/autopilot-worktree-branch-inventory"
  key="$(
    printf '%s\0%s\0%s\0%s\0' "r92-root" "$TEST_TMP/r92-origin" \
      "agent/attributed-r1-20260921" "$base" | sha256sum | awk '{print $1}'
  )"
  printf \
    '{"schema":1,"root_run_id":"%s","path":"%s","branch":"%s","tip":"%s","marker_sha256":"%s","captured_at":1}\n' \
    "r92-root" "$TEST_TMP/r92-origin" "agent/attributed-r1-20260921" "$base" \
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
    > "$common/autopilot-worktree-branch-inventory/$key.json"
  chmod 600 "$common/autopilot-worktree-branch-inventory/$key.json"

  # RED at base: --all refused by usage() with exact text:
  # usage: reap-dispatch-branches.sh scan|check|reap [options]
  #   shared: --repo <dir> --into <ref> --pattern <bash-ere> --inventory-file <json>
  local out rc names
  set +e
  out="$(bash "$SCRIPT" scan --repo "$repo" --into develop --all 2>/dev/null)"
  rc=$?
  set -e
  assert_eq "$rc" "0" "scan --all exits 0"
  names="$(jq -r '.unattributed[].name' <<<"$out" | sort | tr '\n' ' ')"
  assert_contains "$names" "agent/orphan-r1-20260921" \
    "unattributed lists the branch with no root_run_id record"
  assert_not_contains "$names" "agent/attributed-r1-20260921" \
    "journal-attributed branch is not listed as unattributed"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/orphan-r1-20260921; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "scan --all must not delete the unattributed branch"
  fi
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/attributed-r1-20260921; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "scan --all must not delete the attributed branch"
  fi
}

assert_r93_prunetmpresidue_cove() {
  local LIB="$REPO_ROOT/scripts/lib/prune-tmp-residue.sh"
  # shellcheck disable=SC1090
  . "$LIB" 2>/dev/null || fail "prune-tmp-residue.sh not sourceable"

  local PRUNE_TMP="$TEST_TMP/r93-prune"
  mkdir -p "$PRUNE_TMP"

  : > "$PRUNE_TMP/qc-emit-aged"
  touch -d "10 days ago" "$PRUNE_TMP/qc-emit-aged"
  : > "$PRUNE_TMP/qc-emit-fresh"
  mkdir -p "$PRUNE_TMP/autopilot-foreman-runs"
  touch -d "10 days ago" "$PRUNE_TMP/autopilot-foreman-runs"
  : > "$PRUNE_TMP/unregistered-scratch-aged"
  touch -d "10 days ago" "$PRUNE_TMP/unregistered-scratch-aged"

  TMPDIR="$PRUNE_TMP" prune_tmp_residue 3 'some-caller-pattern'
  assert_exit_code $? 0 "r93: prune returns 0"
  assert_file_absent "$PRUNE_TMP/qc-emit-aged" \
    "r93: aged qc-emit-* pruned via registered list even when caller omits it"
  assert_file_exists "$PRUNE_TMP/qc-emit-fresh" "r93: fresh qc-emit-* kept"
  assert_file_exists "$PRUNE_TMP/autopilot-foreman-runs" \
    "r93: autopilot-* live-run family is not registered and must be kept"
  assert_file_exists "$PRUNE_TMP/unregistered-scratch-aged" \
    "r93: non-registered aged pattern kept"
}

assert_r109_recover_stale_backlo() {
  # RED at base (mkdirSync dir lock): existing lock dir throws unconditionally:
  #   admit-backlog-follow-ups: backlog admission lock unavailable: EEXIST: file already exists, mkdir '<backlog>.admission.lock'
  # A crashed admission left an empty dir (or a PID file) and every later admit failed forever.
  local SCRIPT="$REPO_ROOT/scripts/admit-backlog-follow-ups.js"
  local SCRATCH="$TEST_TMP/r109-admit"
  mkdir -p "$SCRATCH"

  write_r109_portfolio() {
    node - "$1" "$2" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const suffix = process.argv[3];
const material = {
  context: `r109 context ${suffix}`,
  item_id: `r109-${suffix}`,
  proposed_backlog_title: `r109 title ${suffix}`,
  trigger: `When r109 ${suffix}.`,
};
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
const scoreBreakdown = {
  aggregate_score: 7,
  acceptance: 0,
  risk: 3,
  value: 4,
  conservative_cost: 8,
  reviewer_count: 2,
  per_reviewer: [
    { reviewer_id: 'review-a', acceptance: 0, risk: 1, value: 2, cost: 4 },
    { reviewer_id: 'review-b', acceptance: 0, risk: 2, value: 2, cost: 8 },
  ],
};
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema_version: 1,
  aggregation_policy: 'union-on-verified-must-fix+fixed-budget-score',
  roster: ['review-a', 'review-b'],
  selected_mvp: [],
  cut_list: [{
    item_id: material.item_id,
    title: material.proposed_backlog_title,
    reason: 'outside-optimal-fixed-budget-portfolio',
    score_breakdown: scoreBreakdown,
  }],
  backlog_candidates: [{
    fingerprint,
    item_id: material.item_id,
    proposed_backlog_title: material.proposed_backlog_title,
    context: material.context,
    trigger: material.trigger,
    sources: ['review-a', 'review-b'],
    aggregate_score: 7,
    score_breakdown: scoreBreakdown,
    evidence: [
      { reviewer_id: 'review-a', evidence_kind: 'verified-observation', observation: 'No WAL path exists.' },
      { reviewer_id: 'review-b', evidence_kind: 'spec', observation: 'P3 omits storage authority.' },
    ],
  }],
  score_breakdown: {
    budget: 0,
    budget_used: 0,
    budget_remaining: 0,
    selected_aggregate_score: 0,
    optimization_tiebreakers: [
      'maximum-aggregate-score',
      'fewest-items',
      'lowest-cost',
      'lexical-item-id',
    ],
  },
  terminal_condition: {
    state: 'NO_MVP_ITEMS_REQUIRED',
    bounded: true,
    acceptance_prerequisites_satisfied: true,
    verified_must_fix_satisfied: true,
    current_scope_expanded: false,
    reason: 'Frozen prerequisites and verified MUST-FIX union selected; optional score optimum computed.',
  },
}));
NODE
  }

  run_admit() {
    local input="$1" backlog="$2" ticket="$3"
    local out rc
    set +e
    out="$(timeout 20 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      node "$SCRIPT" --input "$input" --backlog "$backlog" --current-ticket "$ticket" 2>&1)"
    rc=$?
    set -e
    printf '%s\n' "$out"
    return "$rc"
  }

  # --- dead PID file lock is stolen ---
  local DEAD_DIR="$SCRATCH/dead"
  mkdir -p "$DEAD_DIR"
  printf '# backlog\n' > "$DEAD_DIR/BACKLOG.md"
  write_r109_portfolio "$DEAD_DIR/candidates.json" dead
  sleep 30 &
  local DEAD_PID=$!
  kill "$DEAD_PID" >/dev/null 2>&1 || true
  wait "$DEAD_PID" 2>/dev/null || true
  printf '%s\n' "$DEAD_PID" > "$DEAD_DIR/BACKLOG.md.admission.lock"
  local DEAD_OUT DEAD_RC
  set +e
  DEAD_OUT="$(run_admit "$DEAD_DIR/candidates.json" "$DEAD_DIR/BACKLOG.md" r109-dead)"
  DEAD_RC=$?
  set -e
  assert_eq "$DEAD_RC" "0" "r109: stale dead-pid lock is stolen and admission completes"
  assert_contains "$DEAD_OUT" '"artifact_type": "backlog_admission_receipt"' \
    "r109: dead-pid steal emits admission receipt"
  assert_file_absent "$DEAD_DIR/BACKLOG.md.admission.lock" \
    "r109: lock file released after stale steal"

  # --- live PID file lock is not stolen ---
  local LIVE_DIR="$SCRATCH/live"
  mkdir -p "$LIVE_DIR"
  printf '# backlog\n' > "$LIVE_DIR/BACKLOG.md"
  write_r109_portfolio "$LIVE_DIR/candidates.json" live
  sleep 30 &
  local LIVE_PID=$!
  printf '%s\n' "$LIVE_PID" > "$LIVE_DIR/BACKLOG.md.admission.lock"
  local LIVE_OUT LIVE_RC
  set +e
  LIVE_OUT="$(run_admit "$LIVE_DIR/candidates.json" "$LIVE_DIR/BACKLOG.md" r109-live)"
  LIVE_RC=$?
  set -e
  kill "$LIVE_PID" >/dev/null 2>&1 || true
  wait "$LIVE_PID" 2>/dev/null || true
  assert_neq "$LIVE_RC" "0" "r109: live holder lock is refused (never stolen)"
  assert_contains "$LIVE_OUT" "held by a live process" \
    "r109: live hold reports timeout rather than stealing"
  assert_eq "$(tr -d '\n' < "$LIVE_DIR/BACKLOG.md.admission.lock")" "$LIVE_PID" \
    "r109: live holder lock file still records the live pid"

  # --- legacy empty directory lock is cleared, not busy-spun ---
  local LEGACY_DIR="$SCRATCH/legacy"
  mkdir -p "$LEGACY_DIR"
  printf '# backlog\n' > "$LEGACY_DIR/BACKLOG.md"
  write_r109_portfolio "$LEGACY_DIR/candidates.json" legacy
  mkdir "$LEGACY_DIR/BACKLOG.md.admission.lock"
  local LEGACY_OUT LEGACY_RC
  set +e
  LEGACY_OUT="$(run_admit "$LEGACY_DIR/candidates.json" "$LEGACY_DIR/BACKLOG.md" r109-legacy)"
  LEGACY_RC=$?
  set -e
  assert_eq "$LEGACY_RC" "0" "r109: empty legacy directory lock is migrated/cleared"
  assert_contains "$LEGACY_OUT" '"artifact_type": "backlog_admission_receipt"' \
    "r109: legacy dir lock does not hang; admission completes"
  if [ -d "$LEGACY_DIR/BACKLOG.md.admission.lock" ]; then
    fail "r109: leftover directory-shaped lock after admission"
  fi
}

assert_r122_verification_author() {
  # VA on cc-shim: capability recorded ONLY in the effort-less partition.
  # RED at base: capabilityCurrentArgs always passes --effort → quota unknown → NO-GO.
  # GREEN: omit --effort for the probe's non-consuming runner set → GO.
  # Control: codex still queries WITH --effort.
  local utc_now
  utc_now="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d+Z$/,"Z"))')"

  local mini="$TEST_TMP/r122-mini"
  mkdir -p "$mini/specs/feat" "$mini/.claude" "$mini/tools"
  cat > "$mini/specs/feat/core.md" <<'EOF'
# API
ok
EOF
  cat > "$mini/tools/red.sh" <<'EOF'
#!/bin/sh
exit 0
EOF
  cat > "$mini/tools/runner.sh" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$mini/tools/red.sh" "$mini/tools/runner.sh"
  cat > "$mini/.claude/review-loop-config.md" <<'EOF'
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- implementer_effort: high
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- plan_review: off
- hetero_review: off
- consult_dispatch: off
- discuss_dispatch: off
EOF
  git -C "$mini" init -q -b develop
  git -C "$mini" -c user.email=wlb@test -c user.name=wlb add .
  git -C "$mini" -c user.email=wlb@test -c user.name=wlb commit -q -m "r122 fixture"
  local base_sha
  base_sha="$(git -C "$mini" rev-parse HEAD)"

  local store="$TEST_TMP/r122-store"
  mkdir -p "$store"
  cat > "$store/va_score.json" <<'EOF'
{"engine":"glm-5.2","runner":"cc-shim","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$store" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$store/va_score.json" >/dev/null
  # Effort-less partition only (no effort key).
  cat > "$store/va_cap.json" <<EOF
{"schema_version":1,"observed_at":"$utc_now","runner":"cc-shim","model":"glm-5.2","role":"verification_author","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"effortless-only"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$store" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$store/va_cap.json" >/dev/null

  cat > "$store/impl_score.json" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$store" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$store/impl_score.json" >/dev/null
  cat > "$store/impl_cap.json" <<EOF
{"schema_version":1,"observed_at":"$utc_now","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"codex-effort"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$store" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$store/impl_cap.json" >/dev/null

  local contracts="$TEST_TMP/r122-contracts"
  mkdir -p "$contracts"
  cat > "$contracts/va.json" <<EOF
{
  "schema": 1,
  "unit_id": "r122-va",
  "role": "verification-author",
  "goal": "Verify r122",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$base_sha",
  "depends_on": [],
  "scope": {
    "allow_paths": ["oracle.test.sh"],
    "deny_paths": ["vendor/"],
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["specs/feat/core.md"],
    "required_engine_role": "verification-author",
    "required_red_command": ["tools/red.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {"kind": "raw-artifact", "paths": ["oracle.test.sh"]},
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF
  cat > "$contracts/impl.json" <<EOF
{
  "schema": 1,
  "unit_id": "r122-impl",
  "role": "implementer",
  "goal": "Implement r122 control",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$base_sha",
  "depends_on": [],
  "scope": {
    "allow_paths": ["specs/"],
    "deny_paths": ["vendor/"],
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["specs/feat/core.md"],
    "required_engine_role": "implementer",
    "required_red_command": ["tools/red.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {"kind": "diff", "paths": ["specs/"]},
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

  local arglog="$TEST_TMP/r122-cap-argv.jsonl"
  : > "$arglog"
  local preload="$TEST_TMP/r122-cap-argv.cjs"
  cat > "$preload" <<PRELOAD
'use strict';
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;
const logPath = process.env.R122_CAP_ARGV_LOG;
childProcess.spawnSync = function(command, args, options) {
  if (Array.isArray(args)
      && path.basename(String(args[0])) === 'engine-capability-state.js'
      && args[1] === 'current') {
    fs.appendFileSync(logPath, JSON.stringify(args) + '\\n');
  }
  return originalSpawnSync.call(this, command, args, options);
};
PRELOAD

  local va_out va_rc
  set +e
  va_out="$(
    env NODE_OPTIONS="--require=$preload" \
      R122_CAP_ARGV_LOG="$arglog" \
      ENGINE_SCORECARD_DIR="$store" ENGINE_CAPABILITY_DIR="$store" \
      node "$REPO_ROOT/scripts/dispatch-contract.js" check \
      --contract "$contracts/va.json" --repo "$mini" --json 2>&1
  )"
  va_rc=$?
  set -e
  assert_eq "$va_rc" "0" "r122: cc-shim VA resolves GO from effort-less partition"
  assert_contains "$va_out" '"verdict":"GO"' "r122: VA verdict GO"
  local va_line
  va_line="$(grep 'cc-shim' "$arglog" | tail -n 1 || true)"
  assert_contains "$va_line" '"--runner","cc-shim"' "r122: VA capability query uses cc-shim"
  assert_not_contains "$va_line" '"--effort"' "r122: non-consuming runner omits --effort"

  : > "$arglog"
  local impl_out impl_rc
  set +e
  impl_out="$(
    env NODE_OPTIONS="--require=$preload" \
      R122_CAP_ARGV_LOG="$arglog" \
      ENGINE_SCORECARD_DIR="$store" ENGINE_CAPABILITY_DIR="$store" \
      node "$REPO_ROOT/scripts/dispatch-contract.js" check \
      --contract "$contracts/impl.json" --repo "$mini" --json 2>&1
  )"
  impl_rc=$?
  set -e
  assert_eq "$impl_rc" "0" "r122: codex implementer control still GO"
  local impl_line
  impl_line="$(grep 'codex' "$arglog" | tail -n 1 || true)"
  assert_contains "$impl_line" '"--effort"' "r122: effort-consuming codex still queries WITH --effort"
  assert_contains "$impl_line" '"high"' "r122: codex effort value preserved"
}

assert_r3_run_ledger_sh_lease
assert_r16_dispatch_foreman_tes
assert_r19_pin_store_hardening
assert_r92_reap_dispatch_branch
assert_r93_prunetmpresidue_cove
assert_r109_recover_stale_backlo
assert_r122_verification_author
finalize_test
