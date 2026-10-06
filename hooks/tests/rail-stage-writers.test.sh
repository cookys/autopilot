#!/usr/bin/env bash
# hooks/tests/rail-stage-writers.test.sh — plan docs/plans/2026-10-06-dev-flow-stage-graph.md section 2.7 Writers, phase P3 (KR2).
#
# Each rail runs with its existing stub transport against a temp session marker and the test asserts the marker's
# `stage`, `review_families` (completed seats only) and `unit`; a forced stage-advance exit 3 gives exactly one
# diagnostic line and the rail still exits as it would have. Real ~/.autopilot is never touched.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_STAGE_ADVANCE_BIN 2>/dev/null || true
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_REVIEW_SERVER_AUTOSTART=0
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

SM="$REPO_ROOT/scripts/session-mode.js"
SA="$REPO_ROOT/scripts/stage-advance.js"
PR_SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
HRL="$REPO_ROOT/scripts/hetero-review-loop.js"

# Marker repo (clean working tree: the E1 bump check on verify sees nothing).
MR="$TEST_TMP/marker-repo"; mkdir -p "$MR"; git init -q -b develop "$MR"; git -C "$MR" commit -q --allow-empty -m init

SESS_N=0
newsess() { SESS_N=$((SESS_N+1)); export AUTOPILOT_SESSION_ID="rsw-$SESS_N"; MARKER="$AUTOPILOT_SESSION_MODE_DIR/$AUTOPILOT_SESSION_ID.json"; }
jf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((a,k)=>a==null?a:a[k],m);console.log(v===undefined?"<absent>":JSON.stringify(v))' "$MARKER" "$1"; }
sm() { node "$SM" "$@" >/dev/null 2>&1; }
adv() { node "$SA" "$@" >/dev/null 2>&1; }
l_to_plan() { sm set --size L --repo-root "$MR"; adv --to intent; adv --to proposal; adv --to plan; }
count_diag() { printf '%s\n' "$1" | grep -c '^stage-advance: ' || true; }

# ------------------------------------------------------------------ family_of parity (shell source of truth vs lib)
FAMILY_SH="$TEST_TMP/family_of.sh"
sed -n '/^family_of() {/,/^}/p' "$REPO_ROOT/scripts/resolve-review-loop.sh" >"$FAMILY_SH"
PARITY=$(node -e '
const { familyOfEngine } = require(process.argv[1]);
const { spawnSync } = require("child_process");
const models = ["gpt-5.5","codex-max","o3-mini","claude-opus-4","sonnet","haiku","Qwen3-Max","qwq","gemini-3-pro","flash","grok-4","composer-2","MiniMax-M2","abab7","glm-5","zhipu-x","kimi-k2","moonshot-v1","mystery","x",""];
let bad = [];
for (const m of models) {
  const sh = spawnSync("bash", ["-c", `. "$1"; family_of "$2"`, "_", process.argv[2], m], { encoding: "utf8" }).stdout.trim();
  if (sh !== familyOfEngine(m)) bad.push(`${m}: sh=${sh} js=${familyOfEngine(m)}`);
}
console.log(bad.length ? bad.join("; ") : "ok");
' "$REPO_ROOT/scripts/lib/stage-write.js" "$FAMILY_SH")
assert_eq "$PARITY" "ok" "familyOfEngine mirrors resolve-review-loop.sh family_of"

# ------------------------------------------------------------------ rail 1: dispatch-plan-review
PLAN_REPO="$TEST_TMP/plan-repo"; mkdir -p "$PLAN_REPO"; git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN_REPO/plan.md"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' '- R2: immediate integrity' >"$PLAN_REPO/rubric.md"
MANIFEST="$TEST_TMP/manifest.json"
cat >"$MANIFEST" <<'JSON'
{
  "schema_version": 1, "artifact_type": "plan_review_manifest", "logical_plan_id": "rsw-plan",
  "minimum_distinct_families": 3, "max_attempts_per_seat": 2,
  "seats": [
    { "id": "architect", "runner": "codex", "model": "gpt-fixture", "effort": "high", "endpoint": "default", "role": "architecture",
      "family": "openai", "readiness_status": "ready", "qualification_status": "qualified", "required": true, "excluded_families": [], "fallbacks": [] },
    { "id": "operations", "runner": "grok", "model": "grok-fixture", "effort": "high", "endpoint": "default", "role": "operations",
      "family": "xai", "readiness_status": "ready", "qualification_status": "qualified", "required": true, "excluded_families": [], "fallbacks": [] },
    { "id": "skeptic", "runner": "qoderclicn", "model": "qwen-fixture", "effort": "high", "endpoint": "default", "role": "skeptic",
      "family": "qwen", "readiness_status": "ready", "qualification_status": "qualified", "required": true, "excluded_families": [], "fallbacks": [] },
    { "id": "product", "runner": "agy", "model": "gemini-fixture", "effort": "high", "endpoint": "default", "role": "product",
      "family": "google", "readiness_status": "ready", "qualification_status": "qualified", "required": false, "excluded_families": [], "fallbacks": [] }
  ]
}
JSON
FX="$REPO_ROOT/hooks/tests/fixtures/plan-review"
seqjson() { node -e 'const o={};for(const e of process.argv.slice(1)){const [s,...f]=e.split("=");o[s]=f.join("=").split(",");}process.stdout.write(JSON.stringify(o))' "$@"; }
run_pr() { # ticket responses -> sets PR_OUT PR_RC PR_ERR
  PR_OUT=$(AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$2" \
    node "$PR_SCRIPT" --repo-root "$PLAN_REPO" --plan-file "$PLAN_REPO/plan.md" --rubric-file "$PLAN_REPO/rubric.md" \
      --ticket "$1" --session-id "s-$1" --generation 1 --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/pr-state-$1" 2>"$TEST_TMP/pr-err")
  PR_RC=$?; PR_ERR=$(cat "$TEST_TMP/pr-err")
}
ALL_READY=$(seqjson "architect=$FX/ready.json" "operations=$FX/ready.json" "skeptic=$FX/ready.json" "product=$FX/ready.json")
# product (optional) exhausts its transport: ambiguous twice. Its family must be absent from the marker.
PRODUCT_DOWN=$(seqjson "architect=$FX/ready.json" "operations=$FX/ready.json" "skeptic=$FX/ready.json" "product=$FX/ambiguous.txt,$FX/ambiguous.txt")

newsess; l_to_plan
run_pr rsw-all "$ALL_READY"
assert_eq "$PR_RC" "0" "plan-review all seats: rail rc"
assert_eq "$(jf stage)" '"plan-review"' "plan-review: stage written on entry"
assert_eq "$(jf review_families)" '["google","openai","qwen","xai"]' "plan-review: families = completed seats only"
assert_eq "$(count_diag "$PR_ERR")" "0" "plan-review: no diagnostic on the happy path"
SET_AT=$(jf stage_set_at)

newsess; l_to_plan
run_pr rsw-down "$PRODUCT_DOWN"
assert_eq "$PR_RC" "0" "plan-review one optional seat unavailable: rail rc (as without the writer)"
assert_eq "$(jf stage)" '"plan-review"' "plan-review (seat down): stage"
assert_eq "$(jf review_families)" '["openai","qwen","xai"]' "plan-review (seat down): failed seat's family absent"
case "$(jf review_families)" in *google*) bad_g=1 ;; *) bad_g=0 ;; esac
assert_eq "$bad_g" "0" "plan-review (seat down): google never written (planned families are written nowhere)"

# forced exit 3: marker is at implement, plan-review is illegal from there
newsess; l_to_plan; adv --to plan-review; adv --to implement
run_pr rsw-ill "$ALL_READY"
assert_eq "$PR_RC" "0" "plan-review illegal stage move: rail still exits 0"
assert_eq "$(count_diag "$PR_ERR")" "1" "plan-review illegal stage move: exactly one diagnostic line"
assert_contains "$PR_ERR" "stage-advance: 3 " "plan-review diagnostic carries the exit code"
assert_eq "$(jf stage)" '"implement"' "plan-review illegal move: marker stage untouched"
assert_eq "$(jf review_families)" "<absent>" "plan-review illegal move: no families written"

# no marker at all: silent
export AUTOPILOT_SESSION_ID="rsw-none"
run_pr rsw-nomarker "$ALL_READY"
assert_eq "$PR_RC" "0" "plan-review without any marker: rail rc"
assert_eq "$(count_diag "$PR_ERR")" "0" "plan-review without a marker: silent (rails run outside sessions routinely)"

# injected binary + spawn failure
export AUTOPILOT_STAGE_ADVANCE_BIN="$TEST_TMP/does-not-exist"
newsess; l_to_plan
run_pr rsw-spawn "$ALL_READY"
assert_eq "$PR_RC" "0" "plan-review with an unspawnable stage-advance: rail rc"
assert_eq "$(count_diag "$PR_ERR")" "1" "plan-review spawn failure: exactly one diagnostic line"
assert_contains "$PR_ERR" "stage-advance: spawn" "plan-review spawn diagnostic"
unset AUTOPILOT_STAGE_ADVANCE_BIN
cat >"$TEST_TMP/fake-sa.sh" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$TEST_TMP/fake-sa.log"
exit 4
EOF
chmod +x "$TEST_TMP/fake-sa.sh"
export AUTOPILOT_STAGE_ADVANCE_BIN="$TEST_TMP/fake-sa.sh"
newsess; l_to_plan
run_pr rsw-fake "$ALL_READY"
assert_eq "$(count_diag "$PR_ERR")" "1" "injected bin exit 4: one diagnostic line (entry failed, completion skipped)"
assert_eq "$(wc -l <"$TEST_TMP/fake-sa.log" | tr -d ' ')" "1" "injected bin: completion write skipped after the entry failed"
assert_contains "$(cat "$TEST_TMP/fake-sa.log")" "--to plan-review" "injected bin received --to plan-review"
unset AUTOPILOT_STAGE_ADVANCE_BIN

# ------------------------------------------------------------------ rail 2: hetero-review-loop collect
HR="$TEST_TMP/hr-repo"; mkdir -p "$HR/scripts"; git -C "$HR" init -q -b main
echo a >"$HR/f.txt"; git -C "$HR" add f.txt; git -C "$HR" commit -q -m c1
echo b >"$HR/f.txt"; git -C "$HR" commit -q -am c2
HR_BASE=$(git -C "$HR" rev-parse HEAD)
git -C "$HR" checkout -q -b work; echo c >>"$HR/f.txt"; git -C "$HR" commit -q -am c3
cat >"$TEST_TMP/dispatch-review-stub.sh" <<'EOF'
#!/usr/bin/env bash
VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
echo "${!VAR}"
EOF
chmod +x "$TEST_TMP/dispatch-review-stub.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$TEST_TMP/dispatch-review-stub.sh"
CLEAN='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
export STUB_RESPONSE_s0="$CLEAN" STUB_RESPONSE_s1='{"status": "no_verdict"}' STUB_RESPONSE_s2="$CLEAN"
SEATS="gpt-5/low@codex,grok-4/low@grok,gemini-3/low@agy"
LEDGER_N=0
run_hrl() { # extra flags... -> HR_OUT HR_RC HR_ERR
  LEDGER_N=$((LEDGER_N+1))
  HR_OUT=$(node "$HRL" collect --repo-root "$HR" --ledger "$TEST_TMP/ledger$LEDGER_N" --phase p1 --generation 1 --branch work \
    --phase-base "$HR_BASE" --seats "$SEATS" "$@" 2>"$TEST_TMP/hr-err"); HR_RC=$?; HR_ERR=$(cat "$TEST_TMP/hr-err")
}
to_verify() { sm set --size M --repo-root "$MR"; adv --to plan; adv --to implement; adv --to verify; }

newsess; to_verify
run_hrl --allow-seat-gap --min-reviewed-seats 2
assert_eq "$HR_RC" "0" "hetero collect with one failed seat (gap allowed): rail rc"
assert_eq "$(jf stage)" '"code-review"' "hetero collect: stage written on entry"
assert_eq "$(jf review_families)" '["google","openai"]' "hetero collect: families = reviewed seats only (xai seat had no verdict)"
assert_eq "$(count_diag "$HR_ERR")" "0" "hetero collect: no diagnostic on the happy path"

newsess; to_verify
export STUB_RESPONSE_s1="$CLEAN"
run_hrl
assert_eq "$HR_RC" "0" "hetero collect all seats reviewed: rail rc"
assert_eq "$(jf review_families)" '["google","openai","xai"]' "hetero collect all reviewed: all three families"
export STUB_RESPONSE_s1='{"status": "no_verdict"}'

# seat gap WITHOUT --allow-seat-gap: the rail exits 1 as before; the marker still holds only completed families
newsess; to_verify
run_hrl
assert_eq "$HR_RC" "1" "hetero collect seat gap without --allow-seat-gap: rail rc unchanged (1)"
assert_eq "$(jf review_families)" '["google","openai"]' "hetero collect seat gap: completed families only"

# forced exit 3: marker at plan, code-review is illegal from there
newsess; sm set --size M --repo-root "$MR"; adv --to plan
run_hrl --allow-seat-gap --min-reviewed-seats 2
assert_eq "$HR_RC" "0" "hetero collect illegal stage move: rail still exits 0"
assert_eq "$(count_diag "$HR_ERR")" "1" "hetero collect illegal stage move: exactly one diagnostic line"
assert_contains "$HR_ERR" "stage-advance: 3 " "hetero collect diagnostic carries the exit code"
assert_eq "$(jf stage)" '"plan"' "hetero collect illegal move: marker stage untouched"

# opt-out / finalize never write: a marker at plan stays at plan
newsess; sm set --size M --repo-root "$MR"; adv --to plan
node "$HRL" opt-out --repo-root "$HR" --ledger "$TEST_TMP/ledger-oo" --phase p1 --knob hetero_review >/dev/null 2>"$TEST_TMP/oo-err"
assert_eq "$(jf stage)" '"plan"' "hetero opt-out does not write a stage"
assert_eq "$(count_diag "$(cat "$TEST_TMP/oo-err")")" "0" "hetero opt-out prints no stage-advance line"
unset STUB_RESPONSE_s0 STUB_RESPONSE_s1 STUB_RESPONSE_s2 AUTOPILOT_DISPATCH_REVIEW_SCRIPT

# ------------------------------------------------------------------ rail 3: engine implement-review (campaign = one deliverable)
ER="$TEST_TMP/engine-repo"
mkdir -p "$ER/docs/plans" "$ER/.claude" "$ER/src"
git -C "$ER" init -q -b main
git -C "$ER" config user.email e@example.invalid; git -C "$ER" config user.name e
write_mission_governance "$ER/.claude/owner-kernel-governance.json" shadow
printf 'seed\n' >"$ER/src/fixture.js"; printf '.autopilot/\n' >"$ER/.gitignore"
git -C "$ER" add .; git -C "$ER" commit -qm base
E_BASE=$(git -C "$ER" rev-parse HEAD)
printf 'Implement the stage-writer fixture.\n' >"$TEST_TMP/e-prompt.txt"
ENGINE_JS="$TEST_TMP/engine-case.js"
cat >"$ENGINE_JS" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, promptFile, tmp, ticket, mode] = process.argv.slice(2);
const { AutopilotEngine, runCampaignIntake, campaignIdFor } = require(path.join(root, 'src', 'engine'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const common = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-common-dir')));
const seats = [{ role: 'qc', runner: 'cc-shim', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture' }];
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_qualified: true,
  implementer_engine: 'fixture-implementer', implementer_effort: 'high', implementer_runner: 'fixture',
  loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: 1,
  qc_panel_seats_complete: true, qc_panel_seats: seats,
};
const dir = path.join(tmp, `${ticket}-campaign`); fs.mkdirSync(dir, { recursive: true });
const campaignPath = path.join(dir, 'campaign.json'); const sealPath = path.join(dir, 'campaign.seal.json');
const campaign = {
  schema_version: 1, ticket, profile: 'poc', mission_grant_ref: null, repo_identity: `git-common-dir:${common}`,
  base_sha: base, branch: `impl/${ticket}`, vertical_acceptance: ['stage writer'], allowed_path_prefixes: ['src/'],
  max_changed_files: 4, baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5, max_repair_generations: 2,
  max_wall_seconds: 7200, verify_cmd: 'test -f src/fixture.js', rubric_ids: ['R1'],
};
fs.writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`);
execFileSync(process.execPath, [path.join(root, 'scripts', 'implementation-campaign-check.js'), 'seal', '--contract', campaignPath,
  '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath], { cwd: repo, encoding: 'utf8' });
const admitted = runCampaignIntake({ repo, contractPath: campaignPath, sealPath, promptFile, base, branch: campaign.branch, roster }, {
  now: () => '2026-07-26T00:00:00.000Z',
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
  claimGeneration: () => ({ owner: 'campaign_generation', status: 'claimed', generation: 1, nonce: ticket,
    ledger: path.join(repo, '.autopilot', 'injected-ledger.jsonl'), stage_identity: `run-ledger:1:${ticket}` }),
});
const campaignId = campaignIdFor(admitted.initial_state.repo_identity, admitted.contract.ticket, admitted.contract_digest);
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return { ...admitted, campaign_id: campaignId, contract: { ...admitted.contract, max_repair_generations: 2 },
      generation_claim: { ledger: path.join(repo, '.autopilot', 'identity-ledger.jsonl'), generation: 1, nonce: ticket, stage_identity: `run-ledger:1:${ticket}` } };
  },
  campaignComposer() { return { status: 'blocked', phase: 'fixture', reason: 'stop after entry' }; },
});
const result = engine.runImplementationReviewLoop({
  promptFile, branch: campaign.branch, base, roster, campaignManaged: true, campaignContract: campaignPath,
  implementationOptions: { env: { AUTOPILOT_ROOT_RUN_ID: campaignId, AUTOPILOT_DISPATCH_DEPTH: '1' } },
});
console.log(`result_status=${result.status}`);
console.log(`stage_unit=${engine.stageUnit}`);
if (mode === 'verify') {
  engine.stageVerifyOnConverge({ status: 'blocked' });   // not converged: no write
  console.log('after_blocked_done');
  engine.stageVerifyOnConverge({ status: 'converged' });
}
NODE
run_engine() { # ticket mode -> E_OUT E_ERR
  E_OUT=$(node "$ENGINE_JS" "$REPO_ROOT" "$ER" "$E_BASE" "$TEST_TMP/e-prompt.txt" "$TEST_TMP" "$1" "${2:-entry}" 2>"$TEST_TMP/e-err"); E_RC=$?
  E_ERR=$(cat "$TEST_TMP/e-err")
}
xl_to_plan_review() { sm set --size XL --repo-root "$MR"; adv --to intent; adv --to proposal; adv --to plan; adv --to plan-review; }

newsess; xl_to_plan_review
run_engine eng-ok entry
assert_contains "$E_OUT" "result_status=" "engine ran to a result"
assert_eq "$(jf stage)" '"implement"' "engine entry: stage = implement"
assert_eq "$(jf unit.kind)" '"deliverable"' "engine entry: unit.kind from the size (XL = deliverable)"
assert_eq "$(jf unit.index)/$(jf unit.total)" "1/1" "engine entry: unit index/total from the frozen denominator"
assert_eq "$(jf unit.label)" '"eng-ok"' "engine entry: unit label = graph node (ticket)"
assert_eq "$(count_diag "$E_ERR")" "0" "engine entry: no diagnostic on the happy path"

newsess; xl_to_plan_review
run_engine eng-verify verify
assert_contains "$E_OUT" "after_blocked_done" "engine: a non-converged result writes nothing"
assert_eq "$(jf stage)" '"verify"' "engine converged: per-deliverable review writes verify"
assert_eq "$(jf unit.index)/$(jf unit.total)" "1/1" "engine converged: unit carried on the verify write"

# L size: the unit kind comes from the graph for the marker's size (phase), not hard-coded deliverable
newsess; sm set --size L --repo-root "$MR"; adv --to intent; adv --to proposal; adv --to plan; adv --to plan-review
run_engine eng-l entry
assert_eq "$(jf stage)" '"implement"' "engine on an L marker: stage = implement"
assert_eq "$(jf unit.kind)" '"phase"' "engine on an L marker: unit kind phase (no unit-kind violation)"

# forced exit 3: XL marker at intent, implement is illegal; the engine continues and one line is printed
newsess; sm set --size XL --repo-root "$MR"; adv --to intent
run_engine eng-ill verify
assert_contains "$E_OUT" "result_status=" "engine illegal stage move: engine still returns its result"
assert_eq "$(count_diag "$E_ERR")" "1" "engine illegal stage move: exactly one diagnostic line (entry + verify share the run)"
assert_contains "$E_ERR" "stage-advance: 3 " "engine diagnostic carries the exit code"
assert_eq "$(jf stage)" '"intent"' "engine illegal move: marker stage untouched"

finalize_test
