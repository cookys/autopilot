#!/usr/bin/env bash
# review-candidate (BL-0090 P5): the `repair` disposition. A parked review-only campaign closes not-ready
# and emits a seeded implement-review contract (base = the reviewed head, task = the findings, paths and
# verify copied from the adoption contract). RO13 (repair), RO1 (still no writer in the review-only
# campaign), the seeded contract passing implementation-campaign-check.js, and the base-is-reviewed-head
# refusal. Every scenario runs in a throwaway git repo through hooks/tests/lib/review-candidate-driver.js.
#
# Negative controls (the MUTATION block): each guard is broken in a private copy of the source tree and the
# matching scenario must flip (red); the copy is restored and the scenario shown green again.
TEST_NAME="review-candidate-repair"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

DRIVER_REL="hooks/tests/lib/review-candidate-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/review-candidate-stub-review.sh"
RC="$TEST_TMP/rcp"; mkdir -p "$RC"
eq() { assert_eq "$2" "$1" "$3"; }

run_in() {
  local root="$1" sc="$2" extra="${3:-}"
  rm -rf "$RC/$sc"
  printf '{"root":"%s","tmp":"%s","tag":"%s","stub":"%s","scenario":"%s"%s}' \
    "$root" "$RC" "$sc" "$STUB" "${4:-$sc}" "$extra" > "$RC/$sc.ctx.json"
  node "$root/$DRIVER_REL" "$RC/$sc.ctx.json" < /dev/null > "$RC/$sc.out" 2> "$RC/$sc.err"
  tail -n 1 "$RC/$sc.out" > "$RC/$sc.json"
}
run_sc() { run_in "$REPO_ROOT" "$1" "${2:-}" "${3:-ok}"; }
jf() { node -e "const j=JSON.parse(require('fs').readFileSync('$RC/$1.json','utf8'));const v=($2);process.stdout.write(String(v))" 2>/dev/null; }
sf() { jf "$1" "j.steps[$2].$3"; }

FIX='"verdict":"fix"'
SHIP_ENV='"env":{"RC_VERDICT":"ship"}'

# ---- RO13 repair after a park: terminal not-ready + a seeded contract -----------------------------------------
run_sc rp ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "review_candidate_disposition_repair" "$(sf rp 0 code)" "RO13 repair: the parked review closes with the named repair code"
eq "blocked" "$(sf rp 0 status)" "RO13 repair: the review-only campaign is not-ready (blocked), never converged"
eq "TERMINAL_STOP" "$(sf rp 0 campaign_phase)" "RO13 repair: the campaign projects TERMINAL_STOP"
eq "true" "$(sf rp 0 'findings_count > 0')" "RO13 repair: the findings are listed in the result"
eq "0" "$(sf rp 0 review_calls_delta)" "RO13 repair: closing spends no review call"
eq "$(jf rp 'j.first_head')" "$(sf rp 0 handoff.base_sha)" "seed: base is the reviewed head"
eq "false" "$(sf rp 0 handoff.has_adoption)" "seed: no adoption section (it is a normal implement-review contract)"
eq "true" "$(sf rp 0 handoff.task_has_findings)" "seed: the task prompt carries the findings"
eq "true" "$(sf rp 0 'handoff.task_prompt.includes("planted defect")')" "seed: the task prompt names the reviewed finding"
eq "true" "$(sf rp 0 handoff.task_file_matches)" "seed: the task file on disk equals the inline prompt"
eq "true" "$(sf rp 0 handoff.contract_file_matches)" "seed: the contract file on disk equals the inline contract"
eq "true" "$(sf rp 0 'handoff.verify_cmd')" "seed: verify command copied from the adoption contract"
eq '["src/"]' "$(jf rp 'JSON.stringify(j.steps[0].handoff.allowed_path_prefixes)')" "seed: allowed paths copied from the adoption contract"
eq "2" "$(sf rp 0 handoff.max_repair_generations)" "seed: the writer gets a repair budget (poc ceiling)"
eq "0" "$(sf rp 0 handoff.seal_status)" "the seeded contract passes implementation-campaign-check.js seal"
eq "0" "$(jf rp 'j.impl')" "RO1: no implementer call in the review-only campaign across the repair hand-off"
eq "0" "$(sf rp 0 impl_after)" "RO1: still zero implementer calls after the repair step"
eq "0" "$(sf rp 0 model_calls)" "RO13 repair: the closing step makes no model call"
eq "true" "$(sf rp 0 'result_keys.includes("repair_handoff")')" "the hand-off is a result field"

# RO1 control (A5): the same fixture through implement-review does record implementer calls, so the counter sees calls
run_sc rp_ctl '' implement_control
eq "true" "$(jf rp_ctl 'j.impl >= 1')" "RO1 control: implement-review on the fixture records >= 1 implementer call"

# end must NOT emit a hand-off
run_sc rp_end ",$FIX"',"steps":[{"continuation":"end"}]' ok
eq "review_candidate_disposition_end" "$(sf rp_end 0 code)" "end still closes with the end code"
eq "null" "$(sf rp_end 0 handoff)" "end emits no repair hand-off"

# ---- the preset: no wait ----------------------------------------------------------------------------------------
run_sc rp_pre ",$FIX"',"preset":"repair"' ok
eq "review_candidate_disposition_repair" "$(jf rp_pre 'j.code')" "RO13 preset repair: the first run closes with the repair code, no wait"
eq "TERMINAL_STOP" "$(jf rp_pre 'j.campaign_phase')" "RO13 preset repair: the campaign is terminal on the first run"
eq "false" "$(jf rp_pre 'j.durable_wait')" "RO13 preset repair: the run does not park"
eq "$(jf rp_pre 'j.first_head')" "$(jf rp_pre 'j.handoff.base_sha')" "preset repair: seed base is the reviewed head"
eq "0" "$(jf rp_pre 'j.handoff.seal_status')" "preset repair: the seeded contract seals"
eq "0" "$(jf rp_pre 'j.impl')" "RO1 preset repair: no implementer call"

# ---- the reviewed head follows a return ------------------------------------------------------------------------
run_sc rp_ret ",$FIX"',"steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"fix"}},{"continuation":"repair"}]' ok
eq "$(sf rp_ret 0 head)" "$(sf rp_ret 1 handoff.base_sha)" "repair after a return seeds from the LATEST reviewed head, not the sealed one"
eq "true" "$(jf rp_ret 'j.steps[1].handoff.base_sha !== j.first_head')" "the latest head differs from the sealed head in this scenario"
eq "0" "$(sf rp_ret 1 handoff.seal_status)" "repair after a return: the seeded contract seals"

# ---- refusals ----------------------------------------------------------------------------------------------------
run_sc rp_np ',"failModel":"gpt-5.4","steps":[{"continuation":"repair"}]' ok
eq "review_candidate_continuation_not_parked" "$(sf rp_np 0 code)" "repair on a review that is not parked is refused by name"
eq "null" "$(sf rp_np 0 handoff)" "a refused repair emits no hand-off"
run_sc rp_nr ",$FIX"',"steps":[{"continuation":"repair","resume":false}]' ok
eq "review_candidate_continuation_requires_resume" "$(sf rp_nr 0 code)" "repair without --resume is refused by name"

# ---- seed control: a seed whose base is not the reviewed head is refused (unit level) ------------------------------
seed_check() { # <root> -> prints the refusal code, or OK when the bad seed was accepted
  ROOT_UNDER_TEST="$1" node -e "
    const m = require(process.env.ROOT_UNDER_TEST + '/src/engine/review-candidate-repair-seed.js');
    const head = 'a'.repeat(40);
    const adoption = { schema_version: 1, ticket: 'T', profile: 'poc', repo_identity: 'r', base_sha: 'b'.repeat(40),
      branch: 'ext/x', vertical_acceptance: ['v'], allowed_path_prefixes: ['src/'], max_changed_files: 5, baseline_churn: 1,
      max_growth_ratio: 1.5, max_extra_churn: 1, max_repair_generations: 0, max_wall_seconds: 60, verify_cmd: 'true',
      rubric_ids: ['ICC-RC1'], mission_grant_ref: null, adoption: { head_sha: head } };
    const good = m.buildRepairSeed({ adoptionContract: adoption, reviewedHead: head, findings: [], campaignId: 'c' }).contract;
    try {
      m.validateRepairSeed({ seed: { ...good, base_sha: 'c'.repeat(40) }, adoptionContract: adoption, reviewedHead: head });
      process.stdout.write('OK');
    } catch (e) { process.stdout.write(e.code); }"
}
eq "review_candidate_repair_seed_base_mismatch" "$(seed_check "$REPO_ROOT")" "control: a seeded contract whose base is not the reviewed head is refused by name"

# ---- MUTATION: break each guard in a private copy ------------------------------------------------------------------
MC="$TEST_TMP/mcopy"; mkdir -p "$MC"
( cd "$REPO_ROOT" && rsync -a src scripts schemas bin references profiles skills agents plugin.json .claude-plugin hooks "$MC/" ) \
  && mkdir -p "$MC/.claude" && cp "$REPO_ROOT/.claude/owner-kernel-governance.json" "$MC/.claude/"
mut() {
  OLD="$2" NEW="$3" node -e "
    const fs=require('fs');const f=process.argv[1];let s=fs.readFileSync(f,'utf8');
    const n=s.split(process.env.OLD).length-1;
    if(n!==1){console.error('mutation matched '+n+' times: '+process.env.OLD.slice(0,70));process.exit(3);}
    fs.writeFileSync(f,s.split(process.env.OLD).join(process.env.NEW));" "$MC/$1" || { echo "FAIL: mutation did not apply ($1)"; exit 1; }
}
restore() { cp "$REPO_ROOT/$1" "$MC/$1"; }
SEED="src/engine/review-candidate-repair-seed.js"
ENG="src/engine/autopilot-engine.js"

# P1 base check removed: the bad seed is accepted
mut "$SEED" "if (seed.base_sha !== reviewedHead) {" "if (false) {"
eq "OK" "$(seed_check "$MC")" "MUTATION base check removed: a seed with the wrong base is accepted (red)"
restore "$SEED"
eq "review_candidate_repair_seed_base_mismatch" "$(seed_check "$MC")" "MUTATION restored: the wrong base is refused again (green)"

# P2 the builder seeds from the wrong base (the adoption base) with the check in place: the engine refuses and leaves the review parked
mut "$SEED" "seed.base_sha = reviewedHead;" "seed.base_sha = adoptionContract.base_sha;"
run_in "$MC" mp2 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "review_candidate_repair_seed_base_mismatch" "$(jf mp2 'j.steps[0].code')" "engine: a wrongly-based seed is refused by name at the repair step"
eq "AWAITING_DISPOSITION" "$(jf mp2 'j.steps[0].campaign_phase')" "engine: a refused seed leaves the review parked (the caller can still end or return)"
eq "null" "$(jf mp2 'j.steps[0].handoff')" "engine: a refused seed emits no hand-off"
# ... and with the check gone as well, the wrong-based hand-off escapes (red for the real assertion above)
mut "$SEED" "if (seed.base_sha !== reviewedHead) {" "if (false) {"
run_in "$MC" mp2b ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "true" "$(jf mp2b 'j.steps[0].handoff && j.steps[0].handoff.base_sha !== j.first_head')" "MUTATION both removed: the hand-off carries a base that is not the reviewed head (red)"
restore "$SEED"

# P3 repair no longer closes (engine path for a resume)
mut "$ENG" "|| continuationState.continuation === 'repair')) {" "|| false)) {"
run_in "$MC" mp3 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "true" "$(jf mp3 'j.steps[0].code !== "review_candidate_disposition_repair"')" "MUTATION repair not closed on resume: no repair code (red)"
restore "$ENG"

# P4 hand-off not attached
mut "$ENG" "if (isRepair && repairSeed) {" "if (false) {"
run_in "$MC" mp4 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "true" "$(jf mp4 'j.steps[0].handoff === null')" "MUTATION hand-off not attached: repair returns no seeded contract (red)"
restore "$ENG"
run_in "$MC" mp4r ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "0" "$(jf mp4r 'j.steps[0].handoff.seal_status')" "MUTATION restored: the hand-off is back and seals (green)"

# P5 RO1 counter: a planted writer call on the repair path would show in impl (counter sees it via the forced_writer control in review-candidate.test.sh)

finalize_test
