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
eq "true" "$(jf rp 'j.steps[0].handoff.task_prompt.includes("reviewer claims, not yet adjudicated by depth-0") && j.steps[0].handoff.task_prompt.includes("Verify each one against the code first") && j.steps[0].handoff.task_prompt.includes("List every finding you judge not to hold, with the")')" "seed: findings are framed as reviewer claims to verify, with not-holding ones listed with reasons"
eq "false" "$(jf rp 'j.steps[0].handoff.task_prompt.includes("accepted findings") || j.steps[0].handoff.task_prompt.includes("Fix every finding")')" "seed: the old accept-everything wording is gone"
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

# ---- BL-0155 (ruled for the owner by the coordinator): a repeated repair never reuses a branch name ----------
run_sc rp_b1 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "repair/rp_b1-repair" "$(sf rp_b1 0 handoff.branch)" "first repair of a ticket keeps the plain branch name"
run_sc rp_b2 ",$FIX"',"steps":[{"continuation":"repair","preBranches":["repair/rp_b2-repair"]}]' ok
eq "repair/rp_b2-repair-r2" "$(sf rp_b2 0 handoff.branch)" "second repair of the same ticket gets -r2, never the existing branch"
run_sc rp_b3 ",$FIX"',"steps":[{"continuation":"repair","preBranches":["repair/rp_b3-repair","repair/rp_b3-repair-r2"]}]' ok
eq "repair/rp_b3-repair-r3" "$(sf rp_b3 0 handoff.branch)" "third repair gets -r3"
eq "0" "$(sf rp_b3 0 handoff.seal_status)" "a suffixed seeded contract still seals"
run_sc rp_b4 ",$FIX"',"steps":[{"continuation":"repair","preBranches":["repair/rp_b4-repair"],"preTags":["repair/rp_b4-repair"]}]' ok
eq "repair/rp_b4-repair-r2" "$(sf rp_b4 0 handoff.branch)" "a same-named tag does not hide the existing repair branch (still -r2)"
list_check() { # <root> <cwd> -> prints the error code, or the branch list when the listing succeeded
  ROOT_UNDER_TEST="$1" LIST_CWD="$2" node -e "
    const m = require(process.env.ROOT_UNDER_TEST + '/src/engine/review-candidate-repair-seed.js');
    try { process.stdout.write(JSON.stringify(m.listRepairBranches(process.env.LIST_CWD))); }
    catch (e) { process.stdout.write(e.code || 'THROWN'); }"
}
NOT_A_REPO="$TEST_TMP/not-a-repo"; mkdir -p "$NOT_A_REPO"
eq "review_candidate_repair_seed_invalid" "$(list_check "$REPO_ROOT" "$NOT_A_REPO")" "a failing branch listing fails closed with a named code (no silent empty list)"

# ---- BL-0155: a repair branch another clone pushed (remote-tracking only here) is counted too ------------------------
# A local bare repo stands in for the remote; no network. clone B has never created repair/rp_rt-repair itself.
RT="$TEST_TMP/rt"; mkdir -p "$RT"
git init -q --bare -b main "$RT/origin.git"
git clone -q "$RT/origin.git" "$RT/a" 2>/dev/null
git -C "$RT/a" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$RT/a" push -q origin HEAD:refs/heads/main 2>/dev/null
git -C "$RT/a" push -q origin HEAD:refs/heads/repair/rp_rt-repair 2>/dev/null
git clone -q "$RT/origin.git" "$RT/b" 2>/dev/null
eq '["repair/rp_rt-repair"]' "$(list_check "$REPO_ROOT" "$RT/b")" "BL-0155: a repair branch that exists only as a remote-tracking ref is listed"
git -C "$RT/b" branch -q repair/local-only
eq '["repair/local-only","repair/rp_rt-repair"]' "$(list_check "$REPO_ROOT" "$RT/b")" "BL-0155: local and remote-tracking repair branches are both listed, once each"
git -C "$RT/b" branch -q repair/rp_rt-repair origin/repair/rp_rt-repair
eq '["repair/local-only","repair/rp_rt-repair"]' "$(list_check "$REPO_ROOT" "$RT/b")" "BL-0155: a branch present locally AND remotely is listed once"
seed_branch() { # <root> <cwd> <ticket> -> the repair branch the seed would pick
  ROOT_UNDER_TEST="$1" LIST_CWD="$2" TICKET="$3" node -e "
    const m = require(process.env.ROOT_UNDER_TEST + '/src/engine/review-candidate-repair-seed.js');
    const adoption = { adoption: {}, ticket: process.env.TICKET, base_sha: 'a'.repeat(40) };
    try {
      const s = m.buildRepairSeed({ adoptionContract: adoption, reviewedHead: 'b'.repeat(40), findings: [], campaignId: 'c',
        existingBranches: m.listRepairBranches(process.env.LIST_CWD) });
      process.stdout.write(s.branch || s.contract.branch || JSON.stringify(Object.keys(s)));
    } catch (e) { process.stdout.write(e.code || e.message); }"
}
git -C "$RT/b" branch -q -D repair/rp_rt-repair
eq "repair/rp_rt-repair-r2" "$(seed_branch "$REPO_ROOT" "$RT/b" rp_rt)" "BL-0155: the seed skips a name taken only on the remote (-r2, no push collision)"

# ---- BL-0155: the prompt states what the contract allows (not "one round") -----------------------------------------
eq "false" "$(jf rp 'j.steps[0].handoff.task_prompt.includes("one repair round")')" "seed: the prompt does not claim one round while the contract allows more"
eq "true" "$(jf rp 'j.steps[0].handoff.task_prompt.includes("authorizes a repair campaign")')" "seed: the prompt says choosing repair authorizes a repair campaign (plan RO13 wording)"

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

# P6 the reviewed-head SOURCE is broken (review fix 2): the runtime must refuse, not just a test turn red
mut "$ENG" "? ((continuation && continuation.reviewed_head) || null)" "? (false && continuation.reviewed_head) || null"
run_in "$MC" mp6 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "review_candidate_repair_reviewed_head_missing" "$(jf mp6 'j.steps[0].code')" "head source lost on resume: the runtime refuses by name (no silent fallback to the sealed head)"
eq "AWAITING_DISPOSITION" "$(jf mp6 'j.steps[0].campaign_phase')" "head source lost: the review stays parked"
eq "null" "$(jf mp6 'j.steps[0].handoff')" "head source lost: no hand-off"
restore "$ENG"
# P7 the source reads a STALE head (the sealed one) after a return: the independent park-candidate cross-check refuses
mut "$ENG" "? ((continuation && continuation.reviewed_head) || null)" "? (campaignControl.contract.adoption.head_sha)"
run_in "$MC" mp7 ",$FIX"',"steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"fix"}},{"continuation":"repair"}]' ok
eq "review_candidate_repair_head_mismatch" "$(jf mp7 'j.steps[1].code')" "stale head source after a return: the cross-check refuses by name at runtime"
eq "AWAITING_DISPOSITION" "$(jf mp7 'j.steps[1].campaign_phase')" "stale head source: the review stays parked"
# ... and with the cross-check also removed, the stale-based hand-off escapes (red)
mut "$ENG" "if (parkedCommit !== reviewedHead) {" "if (false) {"
run_in "$MC" mp7b ",$FIX"',"steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"fix"}},{"continuation":"repair"}]' ok
eq "true" "$(jf mp7b 'j.steps[1].handoff && j.steps[1].handoff.base_sha === j.first_head')" "MUTATION cross-check removed: a seed based on the stale sealed head escapes (red)"
restore "$ENG"

# P9 preset repair on the FIRST run (BL-0155): a seed that is refused must not terminalize or emit a hand-off
mut "$SEED" "seed.base_sha = reviewedHead;" "seed.base_sha = adoptionContract.base_sha;"
run_in "$MC" mp9 ",$FIX"',"preset":"repair"' ok
eq "review_candidate_repair_seed_base_mismatch" "$(jf mp9 'j.code')" "preset repair first run: a wrongly-based seed is refused by name"
eq "null" "$(jf mp9 'j.handoff')" "preset repair first run: a refused seed emits no hand-off"
eq "AWAITING_DISPOSITION" "$(jf mp9 'j.campaign_phase')" "preset repair first run: a refused seed leaves the review parked"
mut "$SEED" "if (seed.base_sha !== reviewedHead) {" "if (false) {"
run_in "$MC" mp9b ",$FIX"',"preset":"repair"' ok
eq "true" "$(jf mp9b 'j.handoff && j.handoff.base_sha !== j.first_head')" "MUTATION both removed on the preset path: the wrong-based hand-off escapes (red)"
restore "$SEED"
run_in "$MC" mp9r ",$FIX"',"preset":"repair"' ok
eq "review_candidate_disposition_repair" "$(jf mp9r 'j.code')" "MUTATION restored: the preset repair closes with the repair code again (green)"

# P10 seed-before-close (BL-0155, items 3 and 4): when terminalizing fails, the seed written before the close
# must still be on disk (kept, not dropped). The failure is forced in the private copy.
mut "$ENG" "|| campaignControl.terminal_failure.status !== 'terminalized') {" "|| true) {"
run_in "$MC" mp10 ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "true" "$(jf mp10 'j.steps[0].code !== "review_candidate_disposition_repair"')" "forced close failure: the repair does not report a closed campaign"
eq "true" "$(jf mp10 'j.steps[0].seed_files.some((f) => f.endsWith("contract.json"))')" "close failed: the seeded contract file is still on disk"
eq "true" "$(jf mp10 'j.steps[0].seed_files.some((f) => f.endsWith("task.md"))')" "close failed: the seeded task file is still on disk"
# control: the seed write removed (a seed written only after the close would look the same): nothing on disk (red)
mut "$ENG" "if (isRepair && repairSeed) {" "if (false) {"
run_in "$MC" mp10b ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "0" "$(jf mp10b 'j.steps[0].seed_files.length')" "MUTATION seed not written before the close: no seed on disk after a failed close (red)"
restore "$ENG"

# P8 closeOnly covers repair: the repair close skips the repair-round wall check like end (review fix 3)
run_sc rp_wall ",$FIX"',"steps":[{"mustFixAuthority":100000,"continuation":"repair"}]' ok
eq "review_candidate_disposition_repair" "$(sf rp_wall 0 code)" "repair with too little wall left for a repair round still closes with the repair code"
eq "TERMINAL_STOP" "$(sf rp_wall 0 campaign_phase)" "repair with too little wall left for a repair round leaves a terminal campaign"
eq "0" "$(sf rp_wall 0 handoff.seal_status)" "repair with too little wall left for a repair round: the hand-off still seals"
mut "src/engine/campaign-intake.js" "['end', 'repair'].includes(reviewCandidateContinuation.continuation) ? { closeOnly: true } : {}" "['end'].includes(reviewCandidateContinuation.continuation) ? { closeOnly: true } : {}"
run_in "$MC" mp8 ",$FIX"',"steps":[{"mustFixAuthority":100000,"continuation":"repair"}]' ok
eq "true" "$(jf mp8 'j.steps[0].code !== "review_candidate_disposition_repair"')" "MUTATION closeOnly limited to end: repair with too little wall left for a repair round is no longer closed (red)"
restore "src/engine/campaign-intake.js"

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
