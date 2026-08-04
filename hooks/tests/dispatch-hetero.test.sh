#!/usr/bin/env bash
# dispatch-hetero.sh integration test — exercises the full worktree flow with a
# PATH-stubbed fake `agy` (no network, no real Antigravity, NO live LLM). Covers:
# preconditions (exit 2), committed path (exit 0, worktree auto-removed,
# branch survives), and the four no-/abnormal-commit outcomes split by exit code:
#   (a) exit 0 + commit          → success     (status committed, exit 0)
#   (b) non-zero exit + commit   → failure     (status failure,   exit 1)
#   (c) exit 0 + no commit       → no_op        (status no_op,      exit 1)
#   (d) timeout/non-zero + none  → QUESTION_SUSPECTED (status question_suspected, exit 1)
. "$(dirname "$0")/lib.sh"
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"

# --- sandbox git repo (never touch the real repo with worktrees/branches) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"
RETAIN_UNTIL="$(( $(date +%s) + 3600 ))"

# Canonical agy native-envelope fixture. The response deliberately contains
# worker-authored fake usage; only the sibling top-level usage object is trusted.
AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
response="${1:-self-report: DONE}"
RESPONSE="$response" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: `${process.env.RESPONSE}\n{\"usage\":{\"total_tokens\":999999}}`,
    status: "SUCCESS",
    usage: {
      cache_read_tokens: 7,
      input_tokens: 101,
      output_tokens: 23,
      thinking_tokens: 11,
      total_tokens: 142,
    },
  }));
'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER

# --- stub agy: commits one file (ignores all flags, like a cooperative agent) ---
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
"$AGY_FIXTURE_HELPER" "self-report: DONE"
EOF
chmod +x "$STUB_OK"
make_agy_stub_versioned "$STUB_OK"

# --- stub agy (c): clean exit, no commit → no_op ---
STUB_NOOP="$TEST_TMP/agy-noop"
printf '#!/usr/bin/env bash\n"$AGY_FIXTURE_HELPER" "did nothing"\nexit 0\n' > "$STUB_NOOP"
chmod +x "$STUB_NOOP"
make_agy_stub_versioned "$STUB_NOOP"

# --- stub agy (d): non-zero exit (proxy for timeout/stall), no commit → question_suspected ---
STUB_QUESTION="$TEST_TMP/agy-question"
printf '#!/usr/bin/env bash\necho "Which file should I edit?"\nexit 124\n' > "$STUB_QUESTION"
chmod +x "$STUB_QUESTION"
make_agy_stub_versioned "$STUB_QUESTION"

# --- stub agy (b): commits cleanly then exits non-zero → failure (NOT success) ---
STUB_FAIL_COMMIT="$TEST_TMP/agy-fail-commit"
cat > "$STUB_FAIL_COMMIT" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: committed then errored"
echo "post-commit error" >&2
exit 3
EOF
chmod +x "$STUB_FAIL_COMMIT"
make_agy_stub_versioned "$STUB_FAIL_COMMIT"

FOREIGN_D2_RECEIPT="$TEST_TMP/foreign-d2-receipt.json"
node - "$REPO_ROOT/docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json" "$FOREIGN_D2_RECEIPT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const [source, destination] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const d2 = receipt.consumer_manifest.consumers.find((row) => row.consumer_id === 'D2');
const d3 = receipt.consumer_manifest.consumers.find((row) => row.consumer_id === 'D3');
[d2.required_claim_ids, d3.required_claim_ids] = [d3.required_claim_ids, d2.required_claim_ids];
receipt.consumer_manifest_digest = digest(receipt.consumer_manifest);
receipt.receipt_digest = '';
receipt.receipt_digest = digest({ ...receipt, receipt_digest: undefined });
fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
NODE
FOREIGN_D2_MARKER="$TEST_TMP/foreign-d2-runner-spawned"
STUB_FOREIGN_D2="$TEST_TMP/agy-foreign-d2"
cat > "$STUB_FOREIGN_D2" <<EOF
#!/usr/bin/env bash
touch "$FOREIGN_D2_MARKER"
exit 99
EOF
chmod +x "$STUB_FOREIGN_D2"
make_agy_stub_versioned "$STUB_FOREIGN_D2"

# --- stub codex: leaves edits uncommitted; wrapper-commit must still fire on dirty worktree.
# Emulates a FLAG-SUPPORTING codex: answers `exec --help`/`--version` (so dispatch-hetero's
# feature-detect precondition passes) and on the real `exec` run leaves an uncommitted edit. ---
STUB_CODEX_UNCOMMITTED="$TEST_TMP/codex"
cat > "$STUB_CODEX_UNCOMMITTED" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
touch codex_uncommitted.txt
EOF
chmod +x "$STUB_CODEX_UNCOMMITTED"

# 1. --help exits 0 and mentions the worktree rail
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "worktree" "--help mentions worktree"

# 2. missing --branch → precondition_failed, exit 2
OUT="$(cd "$SBX" && "$SCRIPT" --prompt-file "$PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --branch exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "missing --branch status"

# 3. missing agy binary → precondition_failed, exit 2
OUT="$(cd "$SBX" && "$SCRIPT" --branch t1 --prompt-file "$PROMPT" --agy-bin /nonexistent-agy 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing binary exit code"
assert_contains "$OUT" "not found" "missing binary error text"

# A valid receipt with a foreign D2 partition must reject before branch,
# worktree, manifest, or runner effects.
rm -f "$FOREIGN_D2_MARKER"
OUT="$(cd "$SBX" && AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT="$FOREIGN_D2_RECEIPT" \
  "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" \
  --branch feat/foreign-d2 --prompt-file "$PROMPT" --agy-bin "$STUB_FOREIGN_D2" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "foreign D2 implementer receipt exits as precondition failure"
assert_contains "$OUT" '"status": "precondition_failed"' "foreign D2 implementer receipt fails closed"
assert_contains "$OUT" 'D2 capability claim validation failed' "foreign D2 implementer receipt names claim authority"
assert_contains "$OUT" '"usage": null' "foreign D2 implementer receipt has no usage"
assert_file_absent "$FOREIGN_D2_MARKER" "foreign D2 implementer receipt spawns no runner"
assert_eq "0" "$(git -C "$SBX" branch --list feat/foreign-d2 | wc -l | tr -d ' ')" \
  "foreign D2 implementer receipt creates no branch"
FOREIGN_D2_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
[ -z "$FOREIGN_D2_WT" ] || git -C "$SBX" worktree remove --force "$FOREIGN_D2_WT" >/dev/null 2>&1 || true
git -C "$SBX" branch -D feat/foreign-d2 >/dev/null 2>&1 || true

# 3a. bad --runner / --effort → precondition_failed, exit 2 (arg validation, no LLM)
OUT="$(cd "$SBX" && "$SCRIPT" --branch t1 --prompt-file "$PROMPT" --runner bogus --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "bad --runner exit code"
assert_contains "$OUT" "runner must be one of" "bad --runner error text"
OUT="$(cd "$SBX" && "$SCRIPT" --branch t1 --prompt-file "$PROMPT" --effort turbo --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "bad --effort exit code"
assert_contains "$OUT" "effort must be one of" "bad --effort error text"

# 3a-lineage. Pins the LINEAGE ENV CONTRACT, which is easy to get backwards:
#
#   AUTOPILOT_ROOT_RUN_ID alone   → does NOT set the lineage root (no parent means
#                                   no lineage to join, so this dispatch becomes its
#                                   own root) — but it IS a SUPPORTED call: the
#                                   continuation/rehydration resolver still reads it
#                                   (`_cont_root`), which is how a run re-attaches to
#                                   an existing root after compaction.
#   PARENT + ROOT together        → sets the lineage root to that id.
#
# ⛔ Do NOT "fail closed" on root-without-parent. That reflex was tried on
# 2026-07-31 (it looked like a silently-ignored misconfiguration) and broke 8
# assertions in codex-compaction-rehydration.test.sh, which dispatches with ROOT
# and no PARENT in three separate places. The confusing symptom that motivated the
# guard — `caller root_run_id disagrees with campaign mission_runtime` on the
# sealed-campaign rail — is a DOC problem, not a missing guard: only that rail
# needs both ids. See references/hetero-dispatch.md § Trace lineage contract.
lineage_root_of() { # <dispatch stdout> → manifest root_run_id (or a marker string)
  local mf
  mf="$(printf '%s\n' "$1" | sed -n 's/.*manifest=\([^ ]*\).*/\1/p' | head -1)"
  if [ -z "$mf" ] || [ ! -f "$mf" ]; then printf 'NO_MANIFEST'; return; fi
  node -e '
    const fs = require("fs");
    process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).root_run_id));
  ' "$mf"
}

OUT_ROOT_ONLY="$(cd "$SBX" && AUTOPILOT_ROOT_RUN_ID=lineage-probe-root \
  "$SCRIPT" --branch t-lineage-root-only --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"
assert_contains "$OUT_ROOT_ONLY" '"status": "committed"' \
  "root-without-parent is supported and must not fail closed"
assert_neq "$(lineage_root_of "$OUT_ROOT_ONLY")" "lineage-probe-root" \
  "ROOT alone does not set the lineage root"

OUT_BOTH="$(cd "$SBX" && AUTOPILOT_PARENT_RUN_ID=lineage-probe-root \
  AUTOPILOT_ROOT_RUN_ID=lineage-probe-root \
  "$SCRIPT" --branch t-lineage-both --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"
assert_contains "$OUT_BOTH" '"status": "committed"' "parent+root dispatches"
assert_eq "$(lineage_root_of "$OUT_BOTH")" "lineage-probe-root" \
  "PARENT+ROOT sets the lineage root"

# 3b. codex routing: a non-gpt-5.5 codex model still routes to codex (the old bug routed
# only *gpt-5.5* to codex, so gpt-5.3-codex-spark silently fell through to the agy branch).
# Route to codex and make codex absent (PATH without ~/.local/bin, keeping system tools);
# the codex precondition must fire — proving routing did NOT fall through to agy.
OUT="$(cd "$SBX" && PATH=/usr/bin:/bin \
  AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --branch t1 --prompt-file "$PROMPT" \
  --runner auto --model gpt-5.3-codex-spark 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "auto-detect routes gpt-5.3-codex-spark to codex (not agy)"
assert_contains "$OUT" "codex binary not found" "codex routing does not fall through to agy"

# 3c. qoder routing: a Qwen model auto-routes to qoderclicn (not agy). Route via auto and make
# qoder absent (PATH without ~/.local/bin) — the qoder precondition must fire, proving routing.
OUT="$(cd "$SBX" && PATH=/usr/bin:/bin \
  AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR" \
  "$SCRIPT" --branch t1 --prompt-file "$PROMPT" \
  --runner auto --model Qwen3.8-Max-Preview 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "auto-detect routes Qwen3.8-Max-Preview to qoder (not agy)"
assert_contains "$OUT" "qoder binary not found" "qwen routing does not fall through to agy"

# 3d. qoder committed path: --runner qoderclicn + stub via --qoder-bin → committed, runner
# reported qoderclicn (proves runner-select + qoder exec branch + committed status + label;
# STUB_OK self-commits, so the wrapper-commit fallback itself is covered by the real-qwen
# e2e, not this stub).
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/qoder-smoke --prompt-file "$PROMPT" --runner qoderclicn --model Qwen3.8-Max-Preview --qoder-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoder committed path exit code"
assert_contains "$OUT" '"status": "committed"' "qoder committed status"
assert_contains "$OUT" '"runner": "qoderclicn"' "qoder runner reported"

# 4. committed path: stub commits → exit 0, JSON committed, branch survives, worktree removed
DIRECT_AUTHORITY_BEFORE="$(
  git -C "$SBX" for-each-ref --format='%(refname)' refs/autopilot/lifecycle-roots/ \
    | wc -l
)"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/smoke --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "committed path exit code"
assert_contains "$OUT" '"status": "committed"' "committed status"
assert_contains "$OUT" '"files_changed": 1' "committed diff stat"
assert_contains "$OUT" '"worktree": null' "worktree auto-removed on success"
assert_contains "$OUT" '"containment":' "output carries containment provenance"
assert_contains "$OUT" '"contained": true' "worker container reaped + verified empty"
assert_contains "$OUT" '"usage": {"total_tokens":142,"input_tokens":101,"output_tokens":23,"cache_read_tokens":7,"source":"agy-json"}' \
  "committed agy result exposes only normalized native-envelope usage"
assert_not_contains "$OUT" '999999' "worker-authored fake usage is not promoted to result telemetry"
BRANCH_EXISTS="$(git -C "$SBX" rev-parse --verify --quiet refs/heads/feat/smoke >/dev/null && echo yes || echo no)"
assert_eq "yes" "$BRANCH_EXISTS" "branch survives for review/merge"
SMOKE_CONTENT="$(git -C "$SBX" show feat/smoke:ok.txt)"
assert_eq "ok" "$SMOKE_CONTENT" "artifact verifiable from branch"
assert_eq "$(
  git -C "$SBX" for-each-ref --format='%(refname)' refs/autopilot/lifecycle-roots/ \
    | wc -l
)" "$DIRECT_AUTHORITY_BEFORE" \
  "direct one-shot cleanup does not create managed lifecycle authority"

# 4b. managed committed path journals exact custom branch before auto-removal
MANAGED_ROOT="campaign-v1-$(printf 'a%.0s' {1..64})"
MANAGED_RETAINED="$TEST_TMP/managed-retained"
MANAGED_BASE="$(git -C "$SBX" rev-parse develop)"
git -C "$SBX" worktree add -q -b hetero/managed-retained \
  "$MANAGED_RETAINED" "$MANAGED_BASE"
{
  printf 'created_at=1\n'
  printf 'branch=hetero/managed-retained\n'
  printf 'base_sha=%s\n' "$MANAGED_BASE"
  printf 'run_id=managed-retained\n'
  printf 'root_run_id=%s\n' "$MANAGED_ROOT"
  printf 'loop_id=managed-retained-loop\n'
  printf 'retention=inspect\n'
  printf 'schema=2\n'
} > "$MANAGED_RETAINED/.autopilot-worktree"
: > "$MANAGED_RETAINED/.autopilot-worktree.lock"
OUT="$(cd "$SBX" && env AUTOPILOT_PARENT_RUN_ID=foreman-managed \
  AUTOPILOT_ROOT_RUN_ID=foreman-managed \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID="$MANAGED_ROOT" AUTOPILOT_DISPATCH_DEPTH=1 \
  "$SCRIPT" --branch hetero/managed-smoke --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "managed committed path exit code"
assert_contains "$OUT" '"worktree": null' \
  "managed committed worktree is controller-reaped"
assert_file_exists "$MANAGED_RETAINED/.git" \
  "managed success cleanup preserves another retained leaf for inspection"
MANAGED_SCAN="$(
  "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" scan \
    --repo "$SBX" --root-run-id "$MANAGED_ROOT"
)"
assert_contains "$MANAGED_SCAN" '"branch":"hetero/managed-smoke"' \
  "managed auto-removal leaves exact custom branch inventory"
assert_eq "yes" "$(
  git -C "$SBX" rev-parse --verify --quiet refs/heads/hetero/managed-smoke \
    >/dev/null && echo yes || echo no
)" "managed custom branch survives for exact disposition"
git -C "$SBX" worktree remove --force "$MANAGED_RETAINED"
git -C "$SBX" branch -D hetero/managed-retained >/dev/null

# A clean process exit is insufficient: malformed native JSON converts the run
# to failure, even if a commit exists. A nonzero exit discards valid-looking usage.
STUB_BAD_ENVELOPE="$TEST_TMP/agy-bad-envelope"
cat > "$STUB_BAD_ENVELOPE" <<'EOF'
#!/usr/bin/env bash
echo bad > bad-envelope.txt
git add bad-envelope.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: bad envelope"
printf '%s' '{"response":'
EOF
chmod +x "$STUB_BAD_ENVELOPE"
make_agy_stub_versioned "$STUB_BAD_ENVELOPE"
OUT="$(cd "$SBX" && "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" \
  --branch feat/bad-envelope --prompt-file "$PROMPT" --agy-bin "$STUB_BAD_ENVELOPE" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "malformed agy envelope with a commit fails closed"
assert_contains "$OUT" '"status": "failure"' "malformed agy envelope cannot become committed success"
assert_contains "$OUT" '"usage": null' "malformed agy envelope cannot expose usage"
BAD_ENVELOPE_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$BAD_ENVELOPE_WT" >/dev/null 2>&1 || true

STUB_NONZERO_ENVELOPE="$TEST_TMP/agy-nonzero-envelope"
cat > "$STUB_NONZERO_ENVELOPE" <<'EOF'
#!/usr/bin/env bash
echo nonzero > nonzero-envelope.txt
git add nonzero-envelope.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: nonzero envelope"
"$AGY_FIXTURE_HELPER" "valid-looking response"
exit 77
EOF
chmod +x "$STUB_NONZERO_ENVELOPE"
make_agy_stub_versioned "$STUB_NONZERO_ENVELOPE"
OUT="$(cd "$SBX" && "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" \
  --branch feat/nonzero-envelope --prompt-file "$PROMPT" --agy-bin "$STUB_NONZERO_ENVELOPE" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "nonzero agy exit after valid-looking envelope fails closed"
assert_contains "$OUT" '"status": "failure"' "nonzero agy exit is never committed success"
assert_contains "$OUT" '"usage": null' "nonzero agy exit discards valid-looking usage"
NONZERO_ENVELOPE_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$NONZERO_ENVELOPE_WT" >/dev/null 2>&1 || true

# 4c. Explicit managed identity is exact input, never lossy-sanitized.
OUT="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID='bad/root' \
  "$SCRIPT" --branch hetero/invalid-managed-root --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "invalid explicit managed root fails before dispatch"
assert_contains "$OUT" "AUTOPILOT_WORKTREE_ROOT_RUN_ID must match" \
  "invalid managed root failure names the exact contract"
assert_eq "no" "$(
  git -C "$SBX" rev-parse --verify --quiet \
    refs/heads/hetero/invalid-managed-root >/dev/null && echo yes || echo no
)" "invalid managed root cannot create a branch"

# 5. duplicate branch is a read-only precondition: it must fail before the
# durable tuple claim or any runner/manifest/worktree effect.
DUP_LEDGER="$TEST_TMP/duplicate-branch-ledger.jsonl"
DUP_RUNS="$TEST_TMP/duplicate-branch-runs"
DUP_RUNNER_MARK="$TEST_TMP/duplicate-branch-runner-invoked"
DUP_STUB="$TEST_TMP/agy-duplicate-branch"
cat > "$DUP_STUB" <<EOF
#!/usr/bin/env bash
touch "$DUP_RUNNER_MARK"
exit 99
EOF
chmod +x "$DUP_STUB"
make_agy_stub_versioned "$DUP_STUB"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$DUP_LEDGER" >/dev/null
DUP_LEDGER_LINES_BEFORE="$(wc -l < "$DUP_LEDGER" | tr -d ' ')"
DUP_WORKTREES_BEFORE="$(
  git -C "$SBX" worktree list --porcelain \
    | awk '/^worktree / { count += 1 } END { print count + 0 }'
)"
OUT="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$DUP_RUNS" \
  "$SCRIPT" --branch feat/smoke --prompt-file "$PROMPT" --agy-bin "$DUP_STUB" \
  --ledger "$DUP_LEDGER" --run-id duplicate-branch --stage implementation \
  2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "duplicate branch exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "duplicate branch status"
assert_contains "$OUT" "branch already exists" "duplicate branch error"
assert_eq "$DUP_LEDGER_LINES_BEFORE" \
  "$(wc -l < "$DUP_LEDGER" | tr -d ' ')" \
  "duplicate branch creates zero durable lease rows"
assert_file_absent "$DUP_RUNNER_MARK" "duplicate branch invokes zero runners"
assert_eq "0" "$(
  if [ -d "$DUP_RUNS" ]; then
    find "$DUP_RUNS" -maxdepth 1 -type f -name '*.manifest.json' | wc -l | tr -d ' '
  else
    printf '0'
  fi
)" "duplicate branch creates zero manifests"
assert_eq "$DUP_WORKTREES_BEFORE" "$(
  git -C "$SBX" worktree list --porcelain \
    | awk '/^worktree / { count += 1 } END { print count + 0 }'
)" "duplicate branch creates zero worktrees"

# 5b. dirty path: stub commits then leaves an unstaged file → exit 1, status dirty, worktree kept
STUB_DIRTY="$TEST_TMP/agy-dirty"
cat > "$STUB_DIRTY" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: partial"
echo leftover > unstaged.txt
"$AGY_FIXTURE_HELPER" "dirty fixture"
EOF
chmod +x "$STUB_DIRTY"
make_agy_stub_versioned "$STUB_DIRTY"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/dirty --prompt-file "$PROMPT" --agy-bin "$STUB_DIRTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "dirty path exit code"
assert_contains "$OUT" '"status": "dirty"' "dirty status"
DIRTY_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_file_exists "$DIRTY_WT/unstaged.txt" "dirty worktree kept with unstaged file"
git -C "$SBX" worktree remove --force "$DIRTY_WT" >/dev/null 2>&1 || true

# 5c. --keep-worktree is a bounded lease, never an ownerless boolean.
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/bare-keep --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" --keep-worktree 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "bare keep-worktree rejects before runner spend"
assert_contains "$OUT" '"status": "precondition_failed"' \
  "bare keep-worktree is a precondition failure"
assert_contains "$OUT" 'requires --retain-owner' \
  "bare keep-worktree names missing lease owner"
assert_eq "0" "$(git -C "$SBX" branch --list feat/bare-keep | wc -l | tr -d ' ')" \
  "bare keep-worktree creates no branch"

# A partial lease must still emit parseable JSON on the precondition path.
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/partial-lease --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" --keep-worktree --retain-owner test-campaign \
  --retain-reason integration-test 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "partial keep lease rejects before runner spend"
PARTIAL_JSON="$(printf '%s\n' "$OUT" | tail -n 1)"
assert_eq "null" "$(node -e \
  'process.stdout.write(String(JSON.parse(process.argv[1]).retention_lease))' \
  "$PARTIAL_JSON")" "partial keep lease emits parseable null retention metadata"

# 5d. a valid keep lease keeps the worktree and reports its path.
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/keep --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" --keep-worktree --retain-owner test-campaign \
  --retain-reason integration-test --retain-until "$RETAIN_UNTIL" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "keep-worktree exit code"
assert_contains "$OUT" '"status": "committed"' "keep-worktree committed status"
assert_contains "$OUT" '"retention_lease": {"owner":"test-campaign"' \
  "keep-worktree result exposes its bounded lease owner"
KEEP_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_file_exists "$KEEP_WT/ok.txt" "kept worktree present on success"
assert_contains "$(cat "$KEEP_WT/.autopilot-worktree")" 'retention=lease' \
  "kept worktree marker records lease retention"
assert_contains "$(cat "$KEEP_WT/.autopilot-worktree")" 'retention_owner=test-campaign' \
  "kept worktree marker records its owner"
git -C "$SBX" worktree remove --force "$KEEP_WT" >/dev/null 2>&1 || true

# 5e. Grok repair lineage reuses the exact retained worktree, branch, and
# provider session. A dirty retained checkout must fail before runner spend.
STUB_GROK_REUSE="$TEST_TMP/grok-reuse"
GROK_REUSE_CAPTURE="$TEST_TMP/grok-reuse-capture.txt"
cat > "$STUB_GROK_REUSE" <<'EOF'
#!/usr/bin/env bash
mode=initial
session=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session-id) session="$2"; shift 2 ;;
    --resume) mode=repair; session="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s:%s\n' "$mode" "$session" >> "$GROK_REUSE_CAPTURE"
printf '%s\n' "$mode" >> grok-lineage.txt
EOF
chmod +x "$STUB_GROK_REUSE"
GROK_ROOT="campaign-v1-grok-reuse"
OUT="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
  GROK_REUSE_CAPTURE="$GROK_REUSE_CAPTURE" "$SCRIPT" \
  --runner grok --model grok-4.5 --grok-bin "$STUB_GROK_REUSE" \
  --branch feat/grok-reuse --prompt-file "$PROMPT" --keep-worktree \
  --retain-owner "$GROK_ROOT" --retain-reason repair-lineage \
  --retain-until "$RETAIN_UNTIL" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "initial Grok retained-lineage exit code"
assert_contains "$OUT" '"status": "committed"' "initial Grok retained-lineage commits"
GROK_REUSE_JSON="$(printf '%s\n' "$OUT" | grep '^{' | tail -n 1)"
GROK_REUSE_WT="$(printf '%s' "$GROK_REUSE_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).worktree))
')"
GROK_REUSE_SESSION="$(printf '%s' "$GROK_REUSE_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).provider_session_id))
')"
GROK_REUSE_COMMIT="$(printf '%s' "$GROK_REUSE_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).commit))
')"
GROK_REUSE_INSTANCE="$(node - "$GROK_REUSE_WT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const worktree = path.resolve(process.argv[2]);
const stat = fs.statSync(worktree, { bigint: true });
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({
  birthtime_ns: stat.birthtimeNs.toString(),
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  schema: 1,
  worktree,
})).digest('hex'));
NODE
)"
assert_file_exists "$GROK_REUSE_WT/grok-lineage.txt" \
  "initial Grok retained worktree remains present"
assert_contains "$OUT" '"provider_session_reused": false' \
  "initial Grok dispatch creates a provider session"
assert_contains "$OUT" '"worktree_reused": false' \
  "initial Grok dispatch creates one worktree"

# Another same-root leaf must count an unexpired retained lease as occupied and
# must not reclaim the campaign checkout after its lifetime lock is released.
OUT_LEASE_PROBE="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
  "$SCRIPT" --branch feat/grok-lease-budget-probe --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "same-root admission with one retained lease stays within budget"
assert_file_exists "$GROK_REUSE_WT/grok-lineage.txt" \
  "same-root budget reconciliation preserves the unexpired retained lease"

OUT_REPAIR="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
  GROK_REUSE_CAPTURE="$GROK_REUSE_CAPTURE" "$SCRIPT" \
  --runner grok --model grok-4.5 --grok-bin "$STUB_GROK_REUSE" \
  --branch feat/grok-reuse --base "$GROK_REUSE_COMMIT" --prompt-file "$PROMPT" \
  --keep-worktree --reuse-worktree "$GROK_REUSE_WT" \
  --expected-worktree-instance "$GROK_REUSE_INSTANCE" \
  --resume-session "$GROK_REUSE_SESSION" --retain-owner "$GROK_ROOT" \
  --retain-reason repair-lineage --retain-until "$RETAIN_UNTIL" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Grok repair reuse exit code"
assert_contains "$OUT_REPAIR" '"status": "committed"' "Grok repair reuse commits"
assert_contains "$OUT_REPAIR" "\"worktree\": \"$GROK_REUSE_WT\"" \
  "Grok repair returns the same retained worktree"
assert_contains "$OUT_REPAIR" "\"provider_session_id\": \"$GROK_REUSE_SESSION\"" \
  "Grok repair returns the same provider session"
assert_contains "$OUT_REPAIR" '"provider_session_reused": true' \
  "Grok repair reports provider session reuse"
assert_contains "$OUT_REPAIR" '"worktree_reused": true' \
  "Grok repair reports worktree reuse"
assert_eq "2" "$(wc -l < "$GROK_REUSE_WT/grok-lineage.txt" | tr -d ' ')" \
  "Grok repair advances content in the same checkout"
assert_eq "1" "$(git -C "$SBX" branch --list feat/grok-reuse | wc -l | tr -d ' ')" \
  "Grok repair lineage keeps one branch"
assert_eq "initial:$GROK_REUSE_SESSION
repair:$GROK_REUSE_SESSION" "$(cat "$GROK_REUSE_CAPTURE")" \
  "Grok CLI receives one session id then resumes that exact id"

# A path-compatible replacement must be rejected under the lifetime lock before
# the runner can mutate it.
GROK_CAPTURE_LINES_BEFORE="$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')"
OUT_INSTANCE_MISMATCH="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
  GROK_REUSE_CAPTURE="$GROK_REUSE_CAPTURE" "$SCRIPT" \
  --runner grok --model grok-4.5 --grok-bin "$STUB_GROK_REUSE" \
  --branch feat/grok-reuse --base "$(git -C "$GROK_REUSE_WT" rev-parse HEAD)" \
  --prompt-file "$PROMPT" --keep-worktree --reuse-worktree "$GROK_REUSE_WT" \
  --expected-worktree-instance "$(printf '0%.0s' {1..64})" \
  --resume-session "$GROK_REUSE_SESSION" --retain-owner "$GROK_ROOT" \
  --retain-reason repair-lineage --retain-until "$RETAIN_UNTIL" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "mismatched retained worktree instance rejects reuse"
assert_contains "$OUT_INSTANCE_MISMATCH" 'retained worktree filesystem instance changed' \
  "reuse verifies exact filesystem instance under the lifetime lock"
assert_eq "$GROK_CAPTURE_LINES_BEFORE" \
  "$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')" \
  "mismatched retained instance spends zero Grok calls"

# Reuse validation must happen while holding the lifetime lock. Advance HEAD
# while a candidate reuse is blocked on that lock; it must revalidate and stop
# before runner spend after the lock is released.
LOCKED_BASE="$(git -C "$GROK_REUSE_WT" rev-parse HEAD)"
LOCK_RACE_OUT="$TEST_TMP/grok-reuse-lock-race.out"
exec {TEST_REUSE_LOCK_FD}> "$GROK_REUSE_WT/.autopilot-worktree.lock"
flock -x "$TEST_REUSE_LOCK_FD"
(
  exec {TEST_REUSE_LOCK_FD}>&-
  cd "$SBX"
  env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
    GROK_REUSE_CAPTURE="$GROK_REUSE_CAPTURE" "$SCRIPT" \
    --runner grok --model grok-4.5 --grok-bin "$STUB_GROK_REUSE" \
    --branch feat/grok-reuse --base "$LOCKED_BASE" --prompt-file "$PROMPT" \
    --keep-worktree --reuse-worktree "$GROK_REUSE_WT" \
    --expected-worktree-instance "$GROK_REUSE_INSTANCE" \
    --resume-session "$GROK_REUSE_SESSION" --retain-owner "$GROK_ROOT" \
    --retain-reason repair-lineage --retain-until "$RETAIN_UNTIL"
) >"$LOCK_RACE_OUT" 2>&1 &
LOCK_RACE_PID=$!
sleep 0.2
printf 'external advance\n' > "$GROK_REUSE_WT/lock-race.txt"
git -C "$GROK_REUSE_WT" add lock-race.txt
git -C "$GROK_REUSE_WT" -c user.email=t@t -c user.name=t \
  commit -q -m "test: advance while reuse waits"
GROK_CAPTURE_LINES_BEFORE="$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')"
exec {TEST_REUSE_LOCK_FD}>&-
wait "$LOCK_RACE_PID"; LOCK_RACE_EXIT=$?
OUT_LOCK_RACE="$(cat "$LOCK_RACE_OUT")"
assert_eq "2" "$LOCK_RACE_EXIT" "reuse revalidates HEAD after acquiring its lifetime lock"
assert_contains "$OUT_LOCK_RACE" 'retained worktree HEAD does not match --base' \
  "reuse lock closes the validation-to-marker TOCTOU window"
assert_eq "$GROK_CAPTURE_LINES_BEFORE" \
  "$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')" \
  "stale concurrent reuse spends zero Grok calls"

touch "$GROK_REUSE_WT/uncommitted-user-data.txt"
GROK_CAPTURE_LINES_BEFORE="$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')"
OUT_DIRTY_REUSE="$(cd "$SBX" && env AUTOPILOT_WORKTREE_ROOT_RUN_ID="$GROK_ROOT" \
  GROK_REUSE_CAPTURE="$GROK_REUSE_CAPTURE" "$SCRIPT" \
  --runner grok --model grok-4.5 --grok-bin "$STUB_GROK_REUSE" \
  --branch feat/grok-reuse --base "$(git -C "$GROK_REUSE_WT" rev-parse HEAD)" \
  --prompt-file "$PROMPT" --keep-worktree --reuse-worktree "$GROK_REUSE_WT" \
  --expected-worktree-instance "$GROK_REUSE_INSTANCE" \
  --resume-session "$GROK_REUSE_SESSION" --retain-owner "$GROK_ROOT" \
  --retain-reason repair-lineage --retain-until "$RETAIN_UNTIL" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "dirty retained Grok worktree rejects reuse"
assert_contains "$OUT_DIRTY_REUSE" '"status": "precondition_failed"' \
  "dirty retained Grok worktree fails as a precondition"
assert_contains "$OUT_DIRTY_REUSE" 'retained worktree is dirty' \
  "dirty retained Grok worktree names the blocker"
assert_eq "$GROK_CAPTURE_LINES_BEFORE" \
  "$(wc -l < "$GROK_REUSE_CAPTURE" | tr -d ' ')" \
  "dirty retained worktree spends zero Grok calls"
rm -f "$GROK_REUSE_WT/uncommitted-user-data.txt"
git -C "$SBX" worktree remove "$GROK_REUSE_WT" >/dev/null 2>&1 || true
git -C "$SBX" branch -D feat/grok-reuse >/dev/null 2>&1 || true

# 5f. codex wrapper-commit path (legacy bug): codex may leave edits uncommitted while
# HEAD unchanged; wrapper-commit must still run and produce committed outcome.
OUT="$( (
  cd "$SBX"
  PATH="$TEST_TMP:$PATH" "$SCRIPT" --branch feat/codex-no-commit --prompt-file "$PROMPT" --runner codex --model gpt-5.3-codex-spark
) 2>&1 )"; EXIT=$?
assert_eq "0" "$EXIT" "codex wrapper-commit exit code"
assert_contains "$OUT" '"status": "committed"' "codex wrapper-commit status"
assert_contains "$OUT" '"files_changed": 1' "codex wrapper-commit diff stat"
assert_contains "$OUT" '"runner": "codex"' "codex wrapper-commit runner reported"
assert_eq "dispatch-hetero(codex): edits on feat/codex-no-commit" "$(git -C "$SBX" log -1 --pretty=%s feat/codex-no-commit)" "codex wrapper-commit message"

# 5g. wrapper-commit identity fallback covers author-only environments too.
# `git commit` needs both author and committer identity; an author env alone is
# not enough when HOME has no git config.
AUTHOR_ONLY_HOME="$TEST_TMP/git-home-author-only"
mkdir -p "$AUTHOR_ONLY_HOME"
OUT="$( (
  cd "$SBX"
  env HOME="$AUTHOR_ONLY_HOME" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t PATH="$TEST_TMP:$PATH" \
    "$SCRIPT" --branch feat/codex-author-only --prompt-file "$PROMPT" --runner codex --model gpt-5.3-codex-spark
) 2>&1 )"; EXIT=$?
assert_eq "0" "$EXIT" "codex wrapper-commit with author-only env exit code"
assert_contains "$OUT" '"status": "committed"' "codex author-only wrapper-commit status"
assert_eq "dispatch-hetero(codex): edits on feat/codex-author-only" "$(git -C "$SBX" log -1 --pretty=%s feat/codex-author-only)" "codex author-only wrapper-commit message"

# 5h. feature-detect: a STALE codex (its `exec --help` lacks --dangerously-bypass-hook-trust,
# e.g. an old npm-global codex earlier in PATH) must FAIL LOUD as precondition_failed —
# NOT dispatch to it and get misclassified as question_suspected (root cause fixed 2026-07-02).
STUB_CODEX_OLD="$TEST_TMP/codex-old"
cat > "$STUB_CODEX_OLD" <<'OLDEOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) echo "--dangerously-bypass-approvals-and-sandbox"; exit 0 ;;  # NO hook-trust flag
  *"--version"*)   echo "codex-cli 0.130.0"; exit 0 ;;
esac
touch should_not_run.txt
OLDEOF
chmod +x "$STUB_CODEX_OLD"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/codex-old --prompt-file "$PROMPT" --runner codex --model gpt-5.3-codex-spark --codex-bin "$STUB_CODEX_OLD" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "stale codex → precondition_failed exit 2 (not question_suspected)"
assert_contains "$OUT" '"status": "precondition_failed"' "stale codex status precondition_failed"
assert_contains "$OUT" 'does not support --dangerously-bypass-hook-trust' "stale codex error names the missing flag"
assert_file_absent "$SBX/should_not_run.txt" "stale codex never actually dispatched"

# 5i. RELATIVE --codex-bin: feature-detect (caller cwd) and worker exec (inside $WT) must
# resolve the SAME binary — a relative path is absolutized, not resolved twice (gpt-5.5 review).
# Run from $TEST_TMP where the flag-supporting stub lives as ./codex; before the fix the
# worker's post-`cd $WT` exec would miss it.
OUT="$( (
  cd "$SBX"
  "$SCRIPT" --branch feat/codex-relbin --prompt-file "$PROMPT" --runner codex --model gpt-5.3-codex-spark --codex-bin ../codex
) 2>&1 )"; EXIT=$?
assert_eq "0" "$EXIT" "relative --codex-bin absolutized → committed exit 0"
assert_contains "$OUT" '"status": "committed"' "relative --codex-bin wrapper-commit status"

# 5j. unresolvable path-form --codex-bin must fail closed (NOT silently become /<basename>) — R2
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/codex-badbin --prompt-file "$PROMPT" --runner codex --model gpt-5.3-codex-spark --codex-bin nonexistent-dir/codex 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unresolvable --codex-bin dir → precondition exit 2"
assert_contains "$OUT" 'not resolvable' "unresolvable --codex-bin names the path"

# 6 (case c). no_op path: stub exits 0 with no commit → exit 1, status no_op, worktree KEPT
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/empty --prompt-file "$PROMPT" --agy-bin "$STUB_NOOP" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "no_op exit code"
assert_contains "$OUT" '"status": "no_op"' "no_op status (exit 0, no commit)"
KEPT_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_neq "" "$KEPT_WT" "no_op keeps worktree path in JSON"
assert_file_exists "$KEPT_WT/.git" "kept worktree exists on disk"
git -C "$SBX" worktree remove --force "$KEPT_WT" >/dev/null 2>&1 || true

# 7 (case d). question_suspected: stub exits non-zero (proxy for timeout/stall) with no commit
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/question --prompt-file "$PROMPT" --agy-bin "$STUB_QUESTION" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "question_suspected exit code"
assert_contains "$OUT" '"status": "question_suspected"' "question_suspected status (non-zero exit, no commit)"
assert_contains "$OUT" "clarifying question" "question_suspected error hints at the cause"
assert_not_contains "$OUT" '"status": "no_op"' "abnormal-exit no-commit is NOT collapsed into no_op"
Q_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$Q_WT" >/dev/null 2>&1 || true

# 8 (case b). failure: stub commits cleanly but exits non-zero → NOT scored success (KR1)
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/failcommit --prompt-file "$PROMPT" --agy-bin "$STUB_FAIL_COMMIT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "failure (clean commit + non-zero exit) exit code"
assert_contains "$OUT" '"status": "failure"' "failure status"
assert_not_contains "$OUT" '"status": "committed"' "non-zero exit with clean commit is NEVER committed/success"
F_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$F_WT" >/dev/null 2>&1 || true

# 9. agy directive carries the ABSOLUTE worktree anchor (v2.25.9 fix).
# agy -p ignores process cwd; without an absolute-path anchor in the prompt it invents a
# scratch project and the worktree is left untouched (no_op). The script must PREPEND
# "Your ABSOLUTE working directory is: <worktree>" so agy edits in place. This stub runs IN
# the worktree (the script cd's there) and asserts the -p prompt names its own PWD.
ANCHOR_OUT="$TEST_TMP/anchor-capture"
STUB_ANCHOR="$TEST_TMP/agy-anchor"
cat > "$STUB_ANCHOR" <<'EOF'
#!/usr/bin/env bash
prompt=""
while [ $# -gt 0 ]; do case "$1" in -p) prompt="$2"; shift 2 ;; *) shift ;; esac; done
if printf '%s' "$prompt" | grep -qF "ABSOLUTE working directory is: $PWD"; then
  echo ANCHOR_OK > __ANCHOR_OUT__
else
  echo "ANCHOR_MISSING(pwd=$PWD)" > __ANCHOR_OUT__
fi
echo anchored > anchored.txt
git add anchored.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: anchor"
"$AGY_FIXTURE_HELPER" "anchor fixture"
EOF
sed -i "s#__ANCHOR_OUT__#$ANCHOR_OUT#g" "$STUB_ANCHOR"
chmod +x "$STUB_ANCHOR"
make_agy_stub_versioned "$STUB_ANCHOR"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/anchor --prompt-file "$PROMPT" --agy-bin "$STUB_ANCHOR" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anchor stub committed → exit 0"
assert_contains "$OUT" '"status": "committed"' "anchor flow committed"
assert_file_exists "$ANCHOR_OUT" "anchor capture file written"
assert_eq "ANCHOR_OK" "$(cat "$ANCHOR_OUT" 2>/dev/null)" "agy directive injects absolute worktree anchor (Your ABSOLUTE working directory is: <wt>)"

# 10. passive capture test: a runner failure that indicates quota exhaustion
# surfaces as engine_unavailable (exit 1) AND records the event in the capability store.
STUB_QUOTA_FAIL="$TEST_TMP/agy-quota-fail"
cat > "$STUB_QUOTA_FAIL" <<'EOF'
#!/usr/bin/env bash
echo "ERROR: OpenAI billing quota exceeded" >&2
exit 123
EOF
chmod +x "$STUB_QUOTA_FAIL"
make_agy_stub_versioned "$STUB_QUOTA_FAIL"

# Override store to a test directory
CAP_TEST_DIR="$TEST_TMP/cap-store-hetero"
export ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR"
rm -rf "$CAP_TEST_DIR"

# --runner agy is REQUIRED: without it, --model "gpt-5.5" auto-routes to codex and
# the agy quota stub is never exercised (the whole point of this case). A non-zero
# agy exit with no commit + quota_exhausted log → engine_unavailable (exit 1);
# passive_capture still records the quota event.
OUT="$(cd "$SBX" && "$SCRIPT" --runner agy --branch feat/quota-fail --prompt-file "$PROMPT" --agy-bin "$STUB_QUOTA_FAIL" --model "gpt-5.5" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "quota failure exit code remains 1"
assert_contains "$OUT" '"status": "engine_unavailable"' "quota failure status is engine_unavailable"
assert_contains "$OUT" "engine unavailable (quota_exhausted)" "quota failure error names the classification"

# Verify that the event was recorded in the capability store against the exact
# runner/model/effort/endpoint tuple (passive capture now binds effort + endpoint:null).
assert_file_exists "$CAP_TEST_DIR/capability.jsonl" "capability store contains recorded event"
recorded_status="$(node "$REPO_ROOT/scripts/engine-capability-state.js" current \
  --runner agy --model "gpt-5.5" --role implementer --effort xhigh --endpoint @none \
  --store "$CAP_TEST_DIR" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0, 'utf8')).capability.quota.status)")"
assert_eq "$recorded_status" "exhausted" "recorded quota status is exhausted"
# Legacy/neighboring lookup without the exact effort must not inherit the observation.
legacy_status="$(node "$REPO_ROOT/scripts/engine-capability-state.js" current \
  --runner agy --model "gpt-5.5" --role implementer --store "$CAP_TEST_DIR" \
  | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0, 'utf8')).capability.quota.status)")"
assert_neq "$legacy_status" "exhausted" "legacy incomplete observation does not authorize exact-tuple exhaustion"

# 10b. real grok 402 fixture string → engine_unavailable (the BACKLOG gap that
# previously mislabelled HTTP 402 quota death as question_suspected).
STUB_GROK_402="$TEST_TMP/agy-grok-402"
cat > "$STUB_GROK_402" <<'EOF'
#!/usr/bin/env bash
echo "API error (status 402 Payment Required): Grok Build usage balance exhausted" >&2
exit 1
EOF
chmod +x "$STUB_GROK_402"
make_agy_stub_versioned "$STUB_GROK_402"
OUT="$(cd "$SBX" && "$SCRIPT" --runner agy --branch feat/grok-402 --prompt-file "$PROMPT" --agy-bin "$STUB_GROK_402" --model "gpt-5.5" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "grok 402 fixture exit code is 1"
assert_contains "$OUT" '"status": "engine_unavailable"' "grok 402 fixture status is engine_unavailable"
assert_contains "$OUT" "engine unavailable (quota_exhausted)" "grok 402 error names quota_exhausted"
G402_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$G402_WT" >/dev/null 2>&1 || true

# 11. Omission of --skill-mode defaults to off
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-default --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default skill mode exit code"
assert_contains "$OUT" '"skill_mode_effective": "off"' "provenance shows off"
assert_contains "$OUT" '"skills_injected": []' "provenance shows empty skills injected"

# 12. --skill-mode prompt with repeatable --skill prepends skill contents.
# NOTE: the capture path is BAKED into the stub (unquoted heredoc expands $TEST_TMP at
# creation time) — the worker runs inside a systemd-run --scope where the test shell's
# $TEST_TMP env var is NOT propagated, so a run-time "$TEST_TMP" would resolve empty.
# Runtime vars ($#, $1, $2, $prompt) are escaped so they expand when the stub runs.
STUB_CAPTURE_PROMPT="$TEST_TMP/agy-capture-prompt"
cat > "$STUB_CAPTURE_PROMPT" <<EOF
#!/usr/bin/env bash
prompt=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -p) prompt="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "\$prompt" > "$TEST_TMP/captured_prompt.txt"
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: capture-prompt"
"$AGY_FIXTURE_HELPER" "capture prompt fixture"
exit 0
EOF
chmod +x "$STUB_CAPTURE_PROMPT"
make_agy_stub_versioned "$STUB_CAPTURE_PROMPT"

rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-prompt --prompt-file "$PROMPT" --agy-bin "$STUB_CAPTURE_PROMPT" --skill-mode prompt --skill autopilot:dev-flow 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "skill prompt mode exit code"
assert_contains "$OUT" '"skill_mode_effective": "prompt"' "effective skill mode is prompt"
assert_contains "$OUT" '"skills_injected": ["autopilot:dev-flow"]' "skills injected array matches"
assert_file_exists "$TEST_TMP/captured_prompt.txt" "captured prompt file exists"
assert_contains "$(cat "$TEST_TMP/captured_prompt.txt")" "=== SKILL: autopilot:dev-flow ===" "prompt contains skill delimiter"
assert_contains "$(cat "$TEST_TMP/captured_prompt.txt")" "Development Flow Evaluation" "prompt contains skill content"

# 12a. A sealed v1 campaign is not itself a strict leaf projection. Under L6 it
# must fail before the runner instead of treating prompt text as authority.
CAMPAIGN_CONTRACT="$TEST_TMP/campaign-boundary.json"
CAMPAIGN_SEAL="$TEST_TMP/campaign-boundary.seal.json"
CAMPAIGN_BASE="$(git -C "$SBX" rev-parse develop)"
CAMPAIGN_REPO_ID="$(node - "$REPO_ROOT" "$SBX" <<'NODE'
const path = require('path');
const [root, repo] = process.argv.slice(2);
const { canonicalRepoIdentity } = require(path.join(root, 'scripts', 'implementation-campaign-check'));
process.stdout.write(canonicalRepoIdentity(repo));
NODE
)"
printf '%s\n' \
  "{\"schema_version\":1,\"ticket\":\"campaign-boundary\",\"profile\":\"poc\",\"mission_grant_ref\":null,\"repo_identity\":\"$CAMPAIGN_REPO_ID\",\"base_sha\":\"$CAMPAIGN_BASE\",\"branch\":\"feat/campaign-boundary\",\"vertical_acceptance\":[\"capture bounded prompt\"],\"allowed_path_prefixes\":[\"ok.txt\"],\"max_changed_files\":2,\"baseline_churn\":10,\"max_growth_ratio\":1.5,\"max_extra_churn\":5,\"max_repair_generations\":2,\"max_wall_seconds\":120,\"verify_cmd\":\"true\",\"rubric_ids\":[\"R1\"]}" \
  > "$CAMPAIGN_CONTRACT"
SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CAMPAIGN_CONTRACT" --repo "$SBX" --mission-mode off \
  --out "$CAMPAIGN_SEAL" 2>&1)"; SEAL_EXIT=$?
assert_eq "0" "$SEAL_EXIT" "campaign boundary fixture seals: $SEAL_OUT"
CAMPAIGN_CONTRACT_SHA="$(node -e '
  const crypto = require("crypto");
  const fs = require("fs");
  process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$CAMPAIGN_CONTRACT")"
CAMPAIGN_SESSION_MODE_DIR="$TEST_TMP/campaign-session-mode"
mkdir -p "$CAMPAIGN_SESSION_MODE_DIR"

# A legacy v1 campaign remains admissible outside strict Mission/L5/L6 policy.
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/empty-session-mode" \
  "$SCRIPT" --branch feat/campaign-boundary --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" \
  --campaign-contract-sha256 "$CAMPAIGN_CONTRACT_SHA" \
  --campaign-seal "$CAMPAIGN_SEAL" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "sealed v1 campaign remains compatible outside strict governance"
assert_file_exists "$TEST_TMP/captured_prompt.txt" \
  "legacy v1 shadow/off campaign still reaches its runner"

printf '%s\n' \
  "{\"level\":\"l6\",\"repo_root\":\"$(cd "$SBX" && pwd -P)\",\"started_at\":\"2026-07-28T00:00:00Z\",\"expires_at\":\"2099-01-01T00:00:00Z\"}" \
  > "$CAMPAIGN_SESSION_MODE_DIR/l6.json"
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-boundary --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" \
  --campaign-contract-sha256 "$CAMPAIGN_CONTRACT_SHA" \
  --campaign-seal "$CAMPAIGN_SEAL" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "sealed v1 campaign cannot bypass active L6 strict projection"
assert_contains "$OUT" "active session-mode=l6 requires a sealed campaign strict projection" \
  "sealed v1 campaign names the active strict admission requirement"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "sealed v1 campaign rejection spawns no runner"

# 12b. A contract changed after intake is rejected before the runner or worktree exists.
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-drift --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" \
  --campaign-contract-sha256 "$(printf '0%.0s' {1..64})" \
  --campaign-seal "$CAMPAIGN_SEAL" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "campaign contract digest drift exit code"
assert_contains "$OUT" "campaign contract digest changed after intake" \
  "campaign contract drift names the intake boundary"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "campaign contract drift spawns no runner"

# 12c. Contract, digest, and intake seal are one inseparable managed boundary.
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-unbound --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unbound campaign contract exit code"
assert_contains "$OUT" "are required together" \
  "campaign contract without its intake digest and seal fails closed"

# 12d. A self-hashed campaign JSON without the intake seal cannot bypass L6.
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-missing-seal --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" \
  --campaign-contract-sha256 "$CAMPAIGN_CONTRACT_SHA" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "campaign contract without seal exit code"
assert_contains "$OUT" "--campaign-seal" "missing campaign seal names the required admission input"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "missing campaign seal spawns no runner"

# 12e. A forged seal cannot authorize the campaign leaf.
FORGED_CAMPAIGN_SEAL="$TEST_TMP/campaign-boundary.forged.seal.json"
node - "$CAMPAIGN_SEAL" "$FORGED_CAMPAIGN_SEAL" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const seal = JSON.parse(fs.readFileSync(source, 'utf8'));
seal.contract_sha256 = '0'.repeat(64);
fs.writeFileSync(target, `${JSON.stringify(seal)}\n`);
NODE
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-forged-seal --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" --campaign-contract "$CAMPAIGN_CONTRACT" \
  --campaign-contract-sha256 "$CAMPAIGN_CONTRACT_SHA" \
  --campaign-seal "$FORGED_CAMPAIGN_SEAL" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "forged campaign seal exit code"
assert_contains "$OUT" "campaign contract checker failed" \
  "forged campaign seal fails the canonical checker"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "forged campaign seal spawns no runner"

# 12f. The new campaign admission path does not weaken the prompt-only session gate.
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$CAMPAIGN_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-non-strict --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "non-strict dispatch remains blocked under active L6"
assert_contains "$OUT" "active session-mode=l6 requires a sealed campaign strict projection" \
  "non-strict L6 diagnostic names the required authority"

# 12g. A malformed marker in the authoritative namespace fails closed.
MALFORMED_SESSION_MODE_DIR="$TEST_TMP/campaign-session-mode-malformed"
mkdir -p "$MALFORMED_SESSION_MODE_DIR"
printf '%s\n' 'not-json' > "$MALFORMED_SESSION_MODE_DIR/corrupt.json"
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$MALFORMED_SESSION_MODE_DIR" \
  "$SCRIPT" --branch feat/campaign-malformed-marker --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "malformed authoritative session marker fails closed"
assert_contains "$OUT" "authoritative session-mode marker is invalid" \
  "malformed marker rejection names the authoritative namespace"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "malformed marker rejection spawns no runner"

# 12h. Invalid authoritative Mission governance cannot become an implicit off mode.
mkdir -p "$SBX/.claude" "$TEST_TMP/empty-session-mode"
printf '%s\n' '{"mission_convergence":' > "$SBX/.claude/owner-kernel-governance.json"
rm -f "$TEST_TMP/captured_prompt.txt"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/empty-session-mode" \
  "$SCRIPT" --branch feat/campaign-invalid-governance --prompt-file "$PROMPT" \
  --agy-bin "$STUB_CAPTURE_PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "invalid authoritative Mission governance fails closed"
assert_contains "$OUT" "authoritative Mission governance is invalid" \
  "Mission admission preserves the governance projection error"
assert_eq "false" "$([ -e "$TEST_TMP/captured_prompt.txt" ] && echo true || echo false)" \
  "invalid governance rejection spawns no runner"
rm -f "$SBX/.claude/owner-kernel-governance.json"

# 13. --skill-mode prompt with non-existent skill fails with exit 2
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-nonexistent --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode prompt --skill autopilot:nonexistent 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "nonexistent skill exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "nonexistent skill returns precondition_failed"

# 14. --skill-mode native fails when capability state says unknown/unsupported
CAP_NATIVE_DIR="$TEST_TMP/cap-store-native"
rm -rf "$CAP_NATIVE_DIR"
export ENGINE_CAPABILITY_DIR="$CAP_NATIVE_DIR"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-native-fail --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode native --model "gpt-5.5" --runner agy 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unsupported native skill exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "unsupported native skill returns precondition_failed"

# 15. --skill-mode native succeeds when capability state says native is supported
NATIVE_EVENT_JSON='{"schema_version":1,"observed_at":"2026-07-02T00:00:00Z","runner":"agy","model":"gpt-5.5","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"evidence":"test"},"skill_transport":{"native":"supported","prompt_pack":"supported"}}}'
echo "$NATIVE_EVENT_JSON" | node "$REPO_ROOT/scripts/engine-capability-state.js" record --store "$CAP_NATIVE_DIR" >/dev/null

OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-native-pass --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode native --model "gpt-5.5" --runner agy 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "supported native skill exit code"
assert_contains "$OUT" '"skill_mode_effective": "native"' "provenance shows native skill transport"

# 16. --skill-mode auto resolves to native when supported and fresh
FRESH_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
FRESH_NATIVE_EVENT_JSON="{\"schema_version\":1,\"observed_at\":\"$FRESH_DATE\",\"runner\":\"agy\",\"model\":\"gpt-5.5\",\"role\":\"implementer\",\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"evidence\":\"test\"},\"skill_transport\":{\"native\":\"supported\",\"prompt_pack\":\"supported\"}}}"
echo "$FRESH_NATIVE_EVENT_JSON" | node "$REPO_ROOT/scripts/engine-capability-state.js" record --store "$CAP_NATIVE_DIR" >/dev/null

OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-auto-fresh --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode auto --model "gpt-5.5" --runner agy 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "auto fresh exit code"
assert_contains "$OUT" '"skill_mode_effective": "native"' "auto resolves to native when fresh"

# 17. --skill-mode auto falls back to prompt when native is stale
STALE_DATE="$(node -e 'const d = new Date(); d.setDate(d.getDate() - 2); console.log(d.toISOString())')"
STALE_NATIVE_EVENT_JSON="{\"schema_version\":1,\"observed_at\":\"$STALE_DATE\",\"runner\":\"agy\",\"model\":\"gpt-5.5\",\"role\":\"implementer\",\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"evidence\":\"test\"},\"skill_transport\":{\"native\":\"supported\",\"prompt_pack\":\"supported\"}}}"
rm -rf "$CAP_NATIVE_DIR"
echo "$STALE_NATIVE_EVENT_JSON" | node "$REPO_ROOT/scripts/engine-capability-state.js" record --store "$CAP_NATIVE_DIR" >/dev/null

OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-auto-stale --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode auto --model "gpt-5.5" --runner agy --skill autopilot:dev-flow 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "auto stale exit code"
assert_contains "$OUT" '"skill_mode_effective": "prompt"' "auto falls back to prompt when native is stale"

# 18. --skill-mode auto resolves to off when native is stale and no skills given
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-auto-stale-noskill --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode auto --model "gpt-5.5" --runner agy 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "auto stale noskill exit code"
assert_contains "$OUT" '"skill_mode_effective": "off"' "auto resolves to off when stale and no skills given"

# 19. (P6 F4) auto must judge native freshness on the native event's OWN observed_at, not the
#     aggregate: a STALE native event followed by a FRESH quota-only event must resolve to
#     prompt (native is stale), never native. Without the per-field fix the fresh quota-only
#     event's timestamp would make the stale native signal look fresh.
rm -rf "$CAP_NATIVE_DIR"
F4_STALE="$(node -e 'const d=new Date();d.setDate(d.getDate()-2);console.log(d.toISOString())')"
F4_FRESH="$(node -e 'console.log(new Date().toISOString())')"
echo "{\"schema_version\":1,\"observed_at\":\"$F4_STALE\",\"runner\":\"agy\",\"model\":\"gpt-5.5\",\"role\":\"implementer\",\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"unknown\",\"confidence\":\"low\",\"ttl_seconds\":0,\"evidence\":\"t\"},\"skill_transport\":{\"native\":\"supported\",\"prompt_pack\":\"unknown\"}}}" | node "$REPO_ROOT/scripts/engine-capability-state.js" record --store "$CAP_NATIVE_DIR" >/dev/null
echo "{\"schema_version\":1,\"observed_at\":\"$F4_FRESH\",\"runner\":\"agy\",\"model\":\"gpt-5.5\",\"role\":\"implementer\",\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"evidence\":\"t\"}}}" | node "$REPO_ROOT/scripts/engine-capability-state.js" record --store "$CAP_NATIVE_DIR" >/dev/null
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-auto-f4 --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode auto --model "gpt-5.5" --runner agy --skill autopilot:dev-flow 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "auto F4 exit code"
assert_contains "$OUT" '"skill_mode_effective": "prompt"' "auto reads native_observed_at: a fresh quota-only event does not make a stale native signal look fresh"

# 20. (P6 F3) reject skill names that are bare path segments (. / ..): '/' is blocked but the
#     charset permits '.', so 'skills/..' would escape the skills/<name>/ boundary to repo root.
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-dotdot --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode prompt --skill .. 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "reject '..' skill name exit code"
assert_contains "$OUT" "invalid skill name" "'..' skill name rejected"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/skill-dot --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --skill-mode prompt --skill . 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "reject '.' skill name exit code"

# 21. R1 detach gate falls back to inline when `setsid --help --wait` is unavailable
SETSIDLESS_BIN="$TEST_TMP/no-setsid"
mkdir -p "$SETSIDLESS_BIN"
cat > "$SETSIDLESS_BIN/setsid" <<'EOF'
#!/usr/bin/env bash
echo "set -: no setsid wait support" >&2
exit 1
EOF
chmod +x "$SETSIDLESS_BIN/setsid"
LEDGER_NOSET="$TEST_TMP/no-setsid-ledger/ledger.jsonl"
mkdir -p "$TEST_TMP/no-setsid-ledger"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER_NOSET" >/dev/null
OUT="$(cd "$SBX" && PATH="$SETSIDLESS_BIN:$PATH" "$SCRIPT" --branch feat/no-setsid --prompt-file "$PROMPT" \
  --agy-bin "$STUB_OK" --ledger "$LEDGER_NOSET" --run-id rn --stage implement 2>&1)"; EXIT=$?
[ "$EXIT" -eq 0 ] || printf 'dispatch-hetero diagnostic (no setsid): %s\n' "$OUT" >&2
assert_eq "0" "$EXIT" "missing setsid support falls back to inline dispatch"
assert_contains "$OUT" '"status": "committed"' "setsid-unavailable fallback still returns committed outcome"
HB_COUNT="$(grep -c '\"kind\":\"heartbeat\"' "$LEDGER_NOSET" 2>/dev/null)"; HB_COUNT="${HB_COUNT:-0}"
assert_eq "0" "$HB_COUNT" "setsid-unavailable fallback bypasses detach-side heartbeats"
assert_file_absent "${LEDGER_NOSET}.results/rn.implement.result.json" "setsid-unavailable fallback does not emit detached durable result"

# 21a. A detached Grok dispatch must carry the clamped reasoning effort into the
# serialized child. `run_agent` is serialized for the detached rail, so its
# sourced Grok helpers must be serialized too; otherwise command substitution
# yields an empty --reasoning-effort value and Grok exits before a model request.
STUB_GROK_EFFORT="$TEST_TMP/grok-effort"
GROK_EFFORT_CAPTURE="$TEST_TMP/grok-effort.txt"
cat > "$STUB_GROK_EFFORT" <<'EOF'
#!/usr/bin/env bash
effort=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reasoning-effort) effort="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' "$effort" > "$GROK_EFFORT_CAPTURE"
[ "$effort" = "high" ] || exit 64
printf 'grok detached effort\n' > grok-effort.txt
EOF
chmod +x "$STUB_GROK_EFFORT"
LEDGER_GROK="$TEST_TMP/grok-detached-ledger/ledger.jsonl"
mkdir -p "$TEST_TMP/grok-detached-ledger"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER_GROK" >/dev/null
OUT="$(cd "$SBX" && env GROK_EFFORT_CAPTURE="$GROK_EFFORT_CAPTURE" DISPATCH_QUIET=1 \
  "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$STUB_GROK_EFFORT" \
  --branch feat/grok-detached-effort --prompt-file "$PROMPT" --ledger "$LEDGER_GROK" \
  --run-id grok-detached-effort --stage implement 2>&1)"; EXIT=$?
[ "$EXIT" -eq 0 ] || printf 'dispatch-hetero diagnostic (detached Grok): %s\n' "$OUT" >&2
assert_eq "0" "$EXIT" "detached Grok effort path exit code"
assert_contains "$OUT" '"status": "committed"' "detached Grok effort path commits"
assert_file_exists "$GROK_EFFORT_CAPTURE" "detached Grok stub received reasoning effort"
assert_eq "high" "$(cat "$GROK_EFFORT_CAPTURE" 2>/dev/null)" \
  "detached Grok receives the clamped high effort"

# Controller execution discipline: campaign sealed authority treats output.paths as
# authorized create/modify surface (narrow subset of listed outputs is OK).
# Unit contracts without campaign authority still require every output.paths entry.
CTRL_OUTPUT_SEM="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const [root] = process.argv.slice(2);
const src = fs.readFileSync(path.join(root, 'scripts/dispatch-hetero.sh'), 'utf8');
assert.ok(
  src.includes('outside sealed output surface'),
  'campaign authority rejects unauthorized changed paths',
);
assert.ok(
  src.includes('CAMPAIGN_STRICT_AUTHORITY'),
  'campaign authority gate present',
);
assert.ok(
  src.includes('missing from changed files'),
  'legacy unit contract still requires declared outputs',
);
assert.ok(
  src.includes('"boundary": "rejected"') || src.includes('boundary": "rejected"'),
  'boundary_rejected emits parseable boundary field',
);
assert.ok(
  src.includes('mutation_failed": false') || src.includes('mutation_failed": false'),
  'boundary_rejected never fabricates mutation_failed',
);
console.log(JSON.stringify({
  campaign_authorized_surface: true,
  legacy_required_outputs: true,
  boundary_parseable: true,
}));
NODE
)"
assert_exit_code "$?" "0" "controller output-path semantics present in dispatch-hetero"
assert_contains "$CTRL_OUTPUT_SEM" '"campaign_authorized_surface":true' \
  "campaign output surface is authorization not mandatory touch"
assert_contains "$CTRL_OUTPUT_SEM" '"legacy_required_outputs":true' \
  "legacy unit contracts still require declared outputs"
assert_contains "$CTRL_OUTPUT_SEM" '"boundary_parseable":true' \
  "boundary_rejected is parseable first-class"

# --- Projected-unit required_change_paths + sealed zero-diff no-op matrix ---
enable_legacy_scorecard_test_projection
REQ_MATRIX_OUT="$(node - "$REPO_ROOT" "$SBX" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const [root, repo, tmp] = process.argv.slice(2);
const {
  deriveCampaignDispatchUnit,
  verifyCampaignDispatchUnit,
  writeCampaignDispatchUnit,
} = require(path.join(root, 'src/engine/campaign-dispatch-projection'));
const { AutopilotEngine } = require(path.join(root, 'src/engine/autopilot-engine'));
const {
  campaignIdFor,
} = require(path.join(root, 'src/engine/implementation-campaign'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha256Json = (v) => sha256(Buffer.from(JSON.stringify(v), 'utf8'));

// Seed product surface for required_change.
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, 'specs', 'feat'), { recursive: true });
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.writeFileSync(path.join(repo, '.claude', 'review-loop-config.md'), [
  '- implementer_engine: gpt-5.5',
  '- implementer_effort: high',
  '- implementer_runner: agy',
  '- implementer_endpoint:',
].join('\n') + '\n');
const scoreDir = path.join(tmp, 'req-engine-scores');
const capabilityDir = path.join(tmp, 'req-engine-capabilities');
fs.mkdirSync(scoreDir, { recursive: true });
fs.mkdirSync(capabilityDir, { recursive: true });
const engineScorePath = path.join(tmp, 'req-engine-score.json');
const engineCapabilityPath = path.join(tmp, 'req-engine-capability.json');
fs.writeFileSync(engineScorePath, `${JSON.stringify({
  engine: 'gpt-5.5',
  runner: 'agy',
  family: 'openai',
  role: 'implementer',
  model_version: 'fixture-v1',
  version_source: 'manual',
  corpus_version: 'fixture@1',
  harness_version: 'dispatch-hetero@fixture',
  runner_version: 'agy fixture',
  prompt_config_hash: 'sha256:fixture',
  date: '2026-07-30',
  quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
  capability_score: 0.9,
  cost: {
    source: 'manual',
    usd_per_mtok_input: 0,
    usd_per_mtok_output: 0,
    sample_tokens: 0,
  },
  latency: { sample_wall_time_s: 0 },
  status: 'qualified',
  qualified_at: '2026-07-30',
  expires: '2099-01-01',
}, null, 2)}\n`);
fs.writeFileSync(engineCapabilityPath, `${JSON.stringify({
  schema_version: 1,
  observed_at: new Date().toISOString(),
  runner: 'agy',
  model: 'gpt-5.5',
  role: 'implementer',
  effort: 'high',
  endpoint: null,
  runner_version: 'agy fixture',
  capability: {
    quota: {
      status: 'available',
      confidence: 'high',
      ttl_seconds: 3600,
      reset_at: null,
      evidence: 'fixture',
    },
  },
}, null, 2)}\n`);
process.env.ENGINE_SCORECARD_DIR = scoreDir;
process.env.ENGINE_CAPABILITY_DIR = capabilityDir;
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-scorecard.js'),
  'record',
  '--file',
  engineScorePath,
], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-capability-state.js'),
  'record',
  '--file',
  engineCapabilityPath,
], { env: process.env, stdio: 'ignore' });
fs.writeFileSync(path.join(repo, 'src', 'target.js'), 'v1\n');
fs.writeFileSync(path.join(repo, 'specs', 'feat', 'x.md'), '# S\nbody\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', [
  '-C', repo,
  '-c', 'user.email=t@t',
  '-c', 'user.name=t',
  'commit', '-qm', 'seed required surface',
]);
const base2 = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const campaignId = `campaign-v1-${'a'.repeat(64)}`;
const rootRunId = 'root-req-1';
const branch = 'feat/req-change';
const campaignContract = {
  ticket: 'T-req',
  branch,
  base_sha: base2,
  profile: 'poc',
  allowed_path_prefixes: ['src', 'specs'],
  max_changed_files: 8,
  baseline_churn: 100,
  max_extra_churn: 50,
  max_growth_ratio: 2,
  max_repair_generations: 1,
  max_wall_seconds: 600,
  mission_runtime: {
    schema_version: 1,
    root_run_id: rootRunId,
    mission_lineage_id: 'lineage-v1',
    mission_policy_digest: 'b'.repeat(64),
    mission_graph_digest: 'd'.repeat(64),
    graph_node_id: 'n1',
    graph_node_digest: 'e'.repeat(64),
  },
  strict_dispatch: {
    schema_version: 1,
    spec: { path: 'specs/feat/x.md', section: 'S' },
    required_paths: ['src/target.js'],
    output_paths: ['src/target.js'],
    required_change_paths: ['src/target.js'],
    allowed_path_prefixes: ['src', 'specs'],
    budget: {
      max_changed_files: 8,
      max_wall_seconds: 600,
      max_output_bytes: 100000,
      max_tool_calls: 50,
      max_engine_attempts: 2,
    },
    verification_commands: ['true'],
  },
};
const campaignBytes = `${JSON.stringify(campaignContract, null, 2)}\n`;
const campaignSha = sha256(Buffer.from(campaignBytes, 'utf8'));
const derived = deriveCampaignDispatchUnit({
  campaignContract,
  campaignContractSha256: campaignSha,
  campaignId,
  branch,
  base: base2,
  runner: 'agy',
  model: 'gpt-5.5',
  stage: 'campaign-implementation',
  rootRunId,
});
const contractPath = path.join(tmp, 'unit-req.json');
fs.writeFileSync(contractPath, `${JSON.stringify(derived, null, 2)}\n`);
const unit = {
  contract: derived,
  contract_path: contractPath,
  contract_sha256: sha256(fs.readFileSync(contractPath)),
  cleanup() {},
};

assert.ok(unit.contract.output.required_change_paths);
assert.deepStrictEqual(unit.contract.output.required_change_paths, ['src/target.js']);

// dispatch-contract.js must accept required_change_paths (not unknown key).
const check = spawnSync(process.execPath, [
  path.join(root, 'scripts/dispatch-contract.js'),
  'check', '--contract', unit.contract_path, '--repo', repo, '--json',
], { encoding: 'utf8' });
const checkOut = `${check.stdout || ''}${check.stderr || ''}`;
assert.ok(!checkOut.includes("unknown key 'required_change_paths'"), checkOut);
// This assertion isolates closed-schema acceptance; exact boundary outcomes are
// asserted by the sealed zero-diff and required-change cases below.
assert.ok(!/output: unknown key/.test(checkOut), checkOut);

// Seal a zero-diff receipt into the unit for no-op path.
const liveDigest = sha256(fs.readFileSync(path.join(repo, 'src/target.js')));
const acceptance = unit.contract.acceptance.map((a) => ({ argv: a.argv, exit: a.exit }));
const zeroBody = {
  schema_version: 1,
  artifact_type: 'campaign_zero_diff_receipt',
  base_sha: base2,
  acceptance_digest: sha256Json(acceptance),
  campaign_contract_digest: unit.contract.campaign_projection.campaign_contract_sha256,
  strict_dispatch_digest: unit.contract.campaign_projection.strict_dispatch_sha256,
  campaign_id: unit.contract.campaign_projection.campaign_id,
  mission_lineage_id: unit.contract.campaign_projection.mission_lineage_id,
  mission_policy_digest: unit.contract.campaign_projection.mission_policy_digest,
  mission_graph_digest: unit.contract.campaign_projection.mission_graph_digest,
  graph_node_id: unit.contract.campaign_projection.graph_node_id,
  mission_noop_receipt_digest: 'a'.repeat(64),
  source_work_order_id: 'wo-source-zero-diff',
  source_work_order_digest: 'b'.repeat(64),
  path_byte_digests: { 'src/target.js': liveDigest },
  candidate_zero_change: true,
};
zeroBody.digest = sha256Json(zeroBody);
const sealed = deriveCampaignDispatchUnit({
  campaignContract,
  campaignContractSha256: campaignSha,
  campaignId,
  branch,
  base: base2,
  runner: 'agy',
  model: 'gpt-5.5',
  stage: 'campaign-implementation',
  rootRunId,
  zeroDiffReceipt: zeroBody,
});
assert.deepStrictEqual(sealed.output.zero_diff_receipt, zeroBody);
assert.deepStrictEqual(
  verifyCampaignDispatchUnit({
    campaignContract,
    campaignContractSha256: campaignSha,
    campaignId,
    branch,
    base: base2,
    runner: 'agy',
    model: 'gpt-5.5',
    stage: 'campaign-implementation',
    rootRunId,
    zeroDiffReceipt: sealed.output.zero_diff_receipt,
    unitContract: sealed,
  }),
  sealed,
  'ordinary projection preflight must rederive the sealed zero-diff field',
);
const sealedPath = path.join(tmp, 'unit-sealed-noop.json');
fs.writeFileSync(sealedPath, `${JSON.stringify(sealed, null, 2)}\n`);

// Ambient STRICT_NOOP_RECEIPT_PATH alone is rejected by postcheck logic (source + behavior).
const heteroSrc = fs.readFileSync(path.join(root, 'scripts/dispatch-hetero.sh'), 'utf8');
assert.ok(heteroSrc.includes('ambient STRICT_NOOP_RECEIPT_PATH is not authority'));
assert.ok(heteroSrc.includes('zero_diff_receipt'));

// Invoke strict postcheck path via a tiny bash harness that sources the function
// is heavy; instead run dispatch-hetero with a no-op stub + sealed contract when
// the script supports --contract.
const stubNoop = path.join(tmp, 'stub-noop.sh');
fs.writeFileSync(stubNoop, '#!/usr/bin/env bash\n[ "${1:-}" != "--version" ] || { printf "1.1.10\\n"; exit 0; }\n"$AGY_FIXTURE_HELPER" "strict no-op fixture"\nexit 0\n');
fs.chmodSync(stubNoop, 0o755);
const sealDuringRun = path.join(tmp, 'seal-zero-diff-during-run.js');
fs.writeFileSync(sealDuringRun, `#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [contractPath, worktree] = process.argv.slice(2);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256Json = (value) => sha256(Buffer.from(JSON.stringify(value), 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const acceptance = contract.acceptance.map((entry) => ({ argv: entry.argv, exit: entry.exit }));
const projection = contract.campaign_projection || {};
const relevant = [...new Set([
  ...(contract.output.required_change_paths || []),
  ...(contract.output.paths || []),
])].sort();
const receipt = {
  schema_version: 1,
  artifact_type: 'campaign_zero_diff_receipt',
  base_sha: contract.base_sha,
  acceptance_digest: sha256Json(acceptance),
  campaign_contract_digest: projection.campaign_contract_sha256,
  strict_dispatch_digest: projection.strict_dispatch_sha256,
  campaign_id: projection.campaign_id,
  mission_lineage_id: projection.mission_lineage_id,
  mission_policy_digest: projection.mission_policy_digest,
  mission_graph_digest: projection.mission_graph_digest,
  graph_node_id: projection.graph_node_id,
  mission_noop_receipt_digest: 'c'.repeat(64),
  source_work_order_id: 'wo-source-equality-zero-diff',
  source_work_order_digest: 'd'.repeat(64),
  path_byte_digests: Object.fromEntries(relevant.map((rel) => [
    rel,
    sha256(fs.readFileSync(path.join(worktree, rel))),
  ])),
  candidate_zero_change: true,
};
receipt.digest = sha256Json(receipt);
contract.output.zero_diff_receipt = receipt;
fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\\n');
`);
fs.chmodSync(sealDuringRun, 0o755);
const stubEqualityBranch = path.join(tmp, 'stub-equality-branch.sh');
fs.writeFileSync(stubEqualityBranch, `#!/usr/bin/env bash
[ "\${1:-}" != "--version" ] || { printf '1.1.10\\n'; exit 0; }
node ${JSON.stringify(sealDuringRun)} "$TEST_LIVE_CONTRACT" "$PWD"
"$AGY_FIXTURE_HELPER" "equality fixture"
`);
fs.chmodSync(stubEqualityBranch, 0o755);
const stubPostcheckEmptyDiff = path.join(tmp, 'stub-postcheck-empty-diff.sh');
fs.writeFileSync(stubPostcheckEmptyDiff, `#!/usr/bin/env bash
[ "\${1:-}" != "--version" ] || { printf '1.1.10\\n'; exit 0; }
node ${JSON.stringify(sealDuringRun)} "$TEST_LIVE_CONTRACT" "$PWD"
git -c user.email=t@t -c user.name=t commit --allow-empty -q -m empty
"$AGY_FIXTURE_HELPER" "empty diff fixture"
`);
fs.chmodSync(stubPostcheckEmptyDiff, 0o755);
const sealedRunnerSentinel = path.join(tmp, 'sealed-runner-called');
const stubSealed = path.join(tmp, 'stub-sealed-must-not-run.sh');
fs.writeFileSync(
  stubSealed,
  `#!/usr/bin/env bash
[ "\${1:-}" != "--version" ] || { printf '1.1.10\\n'; exit 0; }
touch ${JSON.stringify(sealedRunnerSentinel)}
exit 99
`,
);
fs.chmodSync(stubSealed, 0o755);

// Effectful: stub changes a scope-allowed but unsealed file → output boundary.
const stubWrong = path.join(tmp, 'stub-wrong.sh');
fs.writeFileSync(stubWrong, `#!/usr/bin/env bash
[ "\${1:-}" != "--version" ] || { printf '1.1.10\\n'; exit 0; }
echo other > src/other.js
git add src/other.js
git -c user.email=t@t -c user.name=t commit -q -m other
"$AGY_FIXTURE_HELPER" "wrong surface fixture"
`);
fs.chmodSync(stubWrong, 0o755);

// Effectful correct: changes required path.
const stubOk = path.join(tmp, 'stub-ok.sh');
fs.writeFileSync(stubOk, `#!/usr/bin/env bash
[ "\${1:-}" != "--version" ] || { printf '1.1.10\\n'; exit 0; }
echo v2 > src/target.js
git add src/target.js
git -c user.email=t@t -c user.name=t commit -q -m target
"$AGY_FIXTURE_HELPER" "required path fixture"
`);
fs.chmodSync(stubOk, 0o755);

const script = path.join(root, 'scripts/dispatch-hetero.sh');
function runDispatch(stub, contractPath, extraEnv = {}) {
  // Re-seal base_sha to current HEAD so strict preflight does not reject drift
  // after prior stub commits on sibling branches.
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const body = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  body.base_sha = head;
  if (body.campaign_projection) body.campaign_projection.campaign_base_sha = head;
  const livePath = path.join(tmp, `live-${path.basename(stub)}.json`);
  fs.writeFileSync(livePath, `${JSON.stringify(body, null, 2)}\n`);
  const r = spawnSync('bash', [
    script,
    '--runner', 'agy',
    '--agy-bin', stub,
    '--branch', `feat/req-${path.basename(stub)}`,
    '--prompt-file', path.join(tmp, 'p.txt'),
    '--strict-contract',
    '--contract-file', livePath,
    '--model', 'gpt-5.5',
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_LIVE_CONTRACT: livePath,
      ...extraEnv,
      PATH: process.env.PATH,
    },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function dispatchBody(run) {
  const lines = run.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value.status === 'string') return value;
    } catch (_error) {
      // Continue to the preceding line.
    }
  }
  assert.fail(`dispatch emitted no result JSON: ${run.out.slice(0, 800)}`);
}
fs.writeFileSync(path.join(tmp, 'p.txt'), 'do work\n');

// A plain projected unit (without the separately sealed campaign file) retains
// legacy required-output semantics and rejects the unrelated in-scope change.
const wrong = runDispatch(stubWrong, unit.contract_path);
const wrongBody = dispatchBody(wrong);
assert.strictEqual(wrong.status, 1, wrong.out);
assert.strictEqual(wrongBody.status, 'boundary_rejected', wrong.out);
assert.match(wrongBody.error, /missing from changed files|required_change_path/);

// Correct effectful change.
const okRun = runDispatch(stubOk, unit.contract_path);
const okBody = dispatchBody(okRun);
assert.strictEqual(okRun.status, 0, okRun.out);
assert.strictEqual(okBody.status, 'committed', okRun.out);
assert.ok(/^[0-9a-f]{40}$/.test(okBody.commit), okRun.out);

// Zero-change without sealed receipt → boundary.
const missingNoop = runDispatch(stubNoop, unit.contract_path);
const missingNoopBody = dispatchBody(missingNoop);
assert.strictEqual(missingNoop.status, 1, missingNoop.out);
assert.strictEqual(missingNoopBody.status, 'no_op', missingNoop.out);

// Ambient env no-op path rejected.
const ambient = path.join(tmp, 'ambient-noop.json');
fs.writeFileSync(ambient, JSON.stringify({ forged: true }));
const ambientRun = runDispatch(stubNoop, unit.contract_path, {
  STRICT_NOOP_RECEIPT_PATH: ambient,
});
const ambientBody = dispatchBody(ambientRun);
assert.strictEqual(ambientRun.status, 2, ambientRun.out);
assert.strictEqual(ambientBody.status, 'precondition_failed', ambientRun.out);
assert.match(ambientBody.error, /ambient STRICT_NOOP_RECEIPT_PATH is not authority/);

// Exact sealed zero-diff receipt admits zero-change (no mutation spend).
const worktreesBeforeSealed = execFileSync(
  'git',
  ['-C', repo, 'worktree', 'list', '--porcelain'],
  { encoding: 'utf8' },
);
const sealedNoop = runDispatch(stubSealed, sealedPath);
const sealedBody = dispatchBody(sealedNoop);
assert.strictEqual(sealedNoop.status, 0, sealedNoop.out);
assert.strictEqual(sealedBody.status, 'no_op', sealedNoop.out);
assert.strictEqual(sealedBody.runner, 'sealed-zero-diff-admission', sealedNoop.out);
assert.strictEqual(sealedBody.dispatcher_called, false, sealedNoop.out);
assert.strictEqual(sealedBody.commit, null, sealedNoop.out);
assert.strictEqual(sealedBody.files_changed, 0, sealedNoop.out);
assert.strictEqual(sealedBody.mutation_attempts, 0, sealedNoop.out);
assert.strictEqual(sealedBody.gate_attempts, 0, sealedNoop.out);
assert.strictEqual(sealedBody.resources_created, 0, sealedNoop.out);
assert.strictEqual(sealedBody.worktree, null, sealedNoop.out);
assert.strictEqual(fs.existsSync(sealedRunnerSentinel), false);
assert.strictEqual(
  execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  }),
  worktreesBeforeSealed,
);

// Exercise the two later shell validators under set -u, not just the early
// zero-effect short circuit. The fixture runner models a provider wrapper that
// discovers and seals the same no-op authority before any model invocation.
const equalityBranch = runDispatch(stubEqualityBranch, unit.contract_path);
const equalityBody = dispatchBody(equalityBranch);
assert.strictEqual(equalityBranch.status, 0, equalityBranch.out);
assert.strictEqual(equalityBody.status, 'no_op', equalityBranch.out);
assert.strictEqual(equalityBody.dispatcher_called, false, equalityBranch.out);
assert.strictEqual(equalityBody.model_calls, 0, equalityBranch.out);
assert.strictEqual(equalityBody.mutation_attempts, 0, equalityBranch.out);
assert.strictEqual(equalityBody.gate_attempts, 0, equalityBranch.out);
assert.strictEqual(equalityBody.resources_created, 0, equalityBranch.out);
assert.doesNotMatch(equalityBranch.out, /REPO: unbound variable/);

for (const [label, mutate] of [
  ['forged', (receipt) => { receipt.digest = '0'.repeat(64); }],
  ['stale', (receipt) => { receipt.base_sha = '0'.repeat(40); receipt.digest = sha256Json({
    ...receipt,
    digest: undefined,
  }); }],
  ['foreign', (receipt) => { receipt.campaign_id = 'foreign-campaign'; receipt.digest = sha256Json({
    ...receipt,
    digest: undefined,
  }); }],
]) {
  const bad = JSON.parse(fs.readFileSync(sealedPath, 'utf8'));
  mutate(bad.output.zero_diff_receipt);
  const badPath = path.join(tmp, `unit-sealed-${label}.json`);
  fs.writeFileSync(badPath, `${JSON.stringify(bad, null, 2)}\n`);
  const rejected = runDispatch(stubSealed, badPath);
  const rejectedBody = dispatchBody(rejected);
  assert.strictEqual(rejected.status, 2, rejected.out);
  assert.strictEqual(rejectedBody.status, 'precondition_failed', rejected.out);
  assert.doesNotMatch(rejected.out, /unbound variable/);
}

// Real Engine dispatch-unit writer carries the receipt, and the ordinary
// implementTask consumer preserves the exact zero-effect/no-op result.
const engineRootRunId = 'root-engine-zero-diff-1';
const commonDir = fs.realpathSync(execFileSync(
  'git',
  ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' },
).trim());
const engineContract = {
  ...campaignContract,
  schema_version: 1,
  ticket: 'T-engine-zero-diff',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  max_growth_ratio: 1.5,
  vertical_acceptance: ['sealed zero diff'],
  verify_cmd: 'true',
  rubric_ids: ['R6'],
  mission_runtime: {
    ...campaignContract.mission_runtime,
    root_run_id: engineRootRunId,
    mission_lineage_id: `lineage-v1-${'1'.repeat(64)}`,
  },
};
const engineContractPath = path.join(tmp, 'engine-zero-diff-campaign.json');
const engineSealPath = path.join(tmp, 'engine-zero-diff-campaign.seal.json');
const engineContractBytes = `${JSON.stringify(engineContract, null, 2)}\n`;
fs.writeFileSync(engineContractPath, engineContractBytes);
const sealResult = spawnSync(process.execPath, [
  path.join(root, 'scripts/implementation-campaign-check.js'),
  'seal',
  '--contract', engineContractPath,
  '--repo', repo,
  '--mission-mode', 'off',
  '--out', engineSealPath,
], { encoding: 'utf8' });
assert.strictEqual(sealResult.status, 0, sealResult.stderr || sealResult.stdout);
const engineContractDigest = sha256(Buffer.from(engineContractBytes, 'utf8'));
const engineCampaignId = campaignIdFor(
  engineContract.repo_identity,
  engineContract.ticket,
  engineContractDigest,
);
const engineUnit = deriveCampaignDispatchUnit({
  campaignContract: engineContract,
  campaignContractSha256: engineContractDigest,
  campaignId: engineCampaignId,
  branch,
  base: base2,
  runner: 'agy',
  model: 'gpt-5.5',
  stage: 'campaign-implementation',
  rootRunId: engineRootRunId,
});
const engineAcceptance = engineUnit.acceptance.map((entry) => ({
  argv: entry.argv,
  exit: entry.exit,
}));
const engineZeroBody = {
  schema_version: 1,
  artifact_type: 'campaign_zero_diff_receipt',
  base_sha: base2,
  acceptance_digest: sha256Json(engineAcceptance),
  campaign_contract_digest: engineContractDigest,
  strict_dispatch_digest: engineUnit.campaign_projection.strict_dispatch_sha256,
  campaign_id: engineCampaignId,
  mission_lineage_id: engineContract.mission_runtime.mission_lineage_id,
  mission_policy_digest: engineContract.mission_runtime.mission_policy_digest,
  mission_graph_digest: engineContract.mission_runtime.mission_graph_digest,
  graph_node_id: engineContract.mission_runtime.graph_node_id,
  mission_noop_receipt_digest: 'e'.repeat(64),
  source_work_order_id: 'wo-source-engine-zero-diff',
  source_work_order_digest: 'f'.repeat(64),
  path_byte_digests: { 'src/target.js': liveDigest },
  candidate_zero_change: true,
};
engineZeroBody.digest = sha256Json(engineZeroBody);
const engineUnitNoReceiptPath = path.join(tmp, 'engine-zero-diff-unit-no-receipt.json');
fs.writeFileSync(engineUnitNoReceiptPath, `${JSON.stringify(engineUnit, null, 2)}\n`);
function runCampaignPostcheckDispatch() {
  const livePath = path.join(tmp, 'engine-zero-diff-unit-postcheck-live.json');
  fs.writeFileSync(livePath, fs.readFileSync(engineUnitNoReceiptPath));
  const result = spawnSync('bash', [
    script,
    '--runner', 'agy',
    '--agy-bin', stubPostcheckEmptyDiff,
    '--branch', branch,
    '--base', base2,
    '--prompt-file', path.join(tmp, 'p.txt'),
    '--strict-contract',
    '--contract-file', livePath,
    '--campaign-contract', engineContractPath,
    '--campaign-contract-sha256', engineContractDigest,
    '--campaign-seal', engineSealPath,
    '--run-id', engineCampaignId,
    '--stage', 'campaign-implementation',
    '--model', 'gpt-5.5',
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTOPILOT_PARENT_RUN_ID: 'test-foreman-zero-diff',
      AUTOPILOT_ROOT_RUN_ID: engineRootRunId,
      AUTOPILOT_DISPATCH_DEPTH: '1',
      TEST_LIVE_CONTRACT: livePath,
      PATH: process.env.PATH,
    },
  });
  return {
    status: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
}
const postcheckEmptyDiff = runCampaignPostcheckDispatch();
const postcheckBody = dispatchBody(postcheckEmptyDiff);
assert.strictEqual(postcheckEmptyDiff.status, 0, postcheckEmptyDiff.out);
assert.strictEqual(postcheckBody.status, 'committed', postcheckEmptyDiff.out);
assert.strictEqual(postcheckBody.files_changed, 0, postcheckEmptyDiff.out);
assert.doesNotMatch(postcheckEmptyDiff.out, /REPO: unbound variable/);

let engineBoundaryCalls = 0;
const engineResult = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher() {
    engineBoundaryCalls += 1;
    throw new Error('caller-supplied zero-diff authority must not reach dispatcher');
  },
}).implementTask({
  promptFile: path.join(tmp, 'p.txt'),
  branch,
  base: base2,
  roster: {
    implementer_engine: 'gpt-5.5',
    implementer_effort: 'high',
    implementer_runner: 'agy',
  },
  runId: engineCampaignId,
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: engineContractPath,
  campaignContractDigest: engineContractDigest,
  campaignSealFile: engineSealPath,
  zeroDiffReceipt: engineZeroBody,
  implementationOptions: {
    cwd: repo,
    env: {
      AUTOPILOT_ROOT_RUN_ID: engineRootRunId,
    },
  },
});
assert.strictEqual(engineBoundaryCalls, 0, JSON.stringify(engineResult));
assert.strictEqual(engineResult.status, 'blocked', JSON.stringify(engineResult));
assert.strictEqual(engineResult.phase, 'prepare_implementation');
assert.strictEqual(engineResult.code, 'CALLER_ZERO_DIFF_AUTHORITY_FORBIDDEN');
assert.strictEqual(engineResult.dispatcher_called, false);

console.log(JSON.stringify({
  required_change_schema_ok: true,
  wrong_surface_rejected: true,
  ambient_noop_rejected: true,
  sealed_noop_path_exercised: true,
  equality_noop_path_exercised: true,
  postcheck_empty_diff_path_exercised: true,
  sealed_noop_substitutions_rejected: true,
  engine_caller_zero_diff_forbidden: true,
  effectful_required_ok: true,
}));
NODE
)"
assert_exit_code "$?" "0" "required_change/no-op projected-unit matrix exits zero"
assert_contains "$REQ_MATRIX_OUT" '"required_change_schema_ok":true' "required_change accepted by contract checker"
assert_contains "$REQ_MATRIX_OUT" '"wrong_surface_rejected":true' "unrelated change rejected"
assert_contains "$REQ_MATRIX_OUT" '"ambient_noop_rejected":true' "ambient no-op rejected"
assert_contains "$REQ_MATRIX_OUT" '"sealed_noop_path_exercised":true' "sealed no-op path exercised"
assert_contains "$REQ_MATRIX_OUT" '"equality_noop_path_exercised":true' \
  "equality/no-commit validator executes under set -u"
assert_contains "$REQ_MATRIX_OUT" '"postcheck_empty_diff_path_exercised":true' \
  "postcheck empty-diff validator executes under set -u"
assert_contains "$REQ_MATRIX_OUT" '"sealed_noop_substitutions_rejected":true' \
  "forged, stale, and foreign no-op receipts reject cleanly"
assert_contains "$REQ_MATRIX_OUT" '"engine_caller_zero_diff_forbidden":true' \
  "Engine rejects caller-minted zero-diff authority before dispatch"

finalize_test
