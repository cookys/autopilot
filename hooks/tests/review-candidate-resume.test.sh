#!/usr/bin/env bash
# review-candidate (BL-0090 P2): `autopilot engine review-candidate --resume` for an interrupted or parked
# review, the end/return dispositions, the sealed adoption.disposition_preset, the run-time quorum reading
# (RO7) and the short-panel terminal. Every scenario runs in its own throwaway git repo through
# hooks/tests/lib/review-candidate-driver.js (a fresh engine per resume step = a new process).
#
# Negative controls (the MUTATION block): each guarded behaviour is broken in a private copy of the source
# tree and the matching scenario must then show the OPPOSITE outcome (red); the copy is restored and the
# scenario shown green again. The real assertions above would fail under each mutation.
TEST_NAME="review-candidate-resume"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

DRIVER_REL="hooks/tests/lib/review-candidate-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/review-candidate-stub-review.sh"
RC="$TEST_TMP/rcr"; mkdir -p "$RC"
eq() { assert_eq "$2" "$1" "$3"; }

# run_in <root> <scenario> [extra json, leading comma]  -> $RC/<scenario>.json
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
# step observations: sf <scenario> <step index> <field>
sf() { jf "$1" "j.steps[$2].$3"; }

seat() { printf '{"role":"qc","runner":"cc-shim","model":"%s","effort":"high","endpoint":null,"family":"%s"}' "$1" "$2"; }
ANTH_OPENAI_GOOGLE='"seats":['"$(seat claude-opus-4-6 anthropic),$(seat gpt-5.4 openai),$(seat gemini-3-pro google)"']'
FIX='"verdict":"fix"'
SHIP_ENV='"env":{"RC_VERDICT":"ship"}'

# ---- resume of an interrupted review: finished seats are not asked again --------------------------------------
run_sc ia ',"failModel":"gpt-5.4","steps":[{}]' ok
eq "blocked" "$(jf ia 'j.status')" "interrupted review: the first run parks on the lost seat (transport fault)"
eq "converged" "$(sf ia 0 status)" "interrupted review: --resume converges"
eq "1" "$(sf ia 0 review_calls_delta)" "interrupted review: only the lost seat is asked again (RO11 reuse)"
eq "gpt-5.4" "$(sf ia 0 'review_models_delta[0]')" "interrupted review: the seat asked again is the one that failed"
eq "TERMINAL_READY" "$(sf ia 0 campaign_phase)" "interrupted review: the campaign projects TERMINAL_READY"
run_sc ia_flag ',"failModel":"gpt-5.4","steps":[{"continuation":"end"}]' ok
eq "review_candidate_continuation_not_parked" "$(sf ia_flag 0 code)" "a continuation flag on a review that is not parked is refused by name"
eq "0" "$(sf ia_flag 0 review_calls_delta)" "a refused continuation flag spends no review call"

# ---- the parked review: end ---------------------------------------------------------------------------------
run_sc pk ",$FIX" ok
eq "AWAITING_DISPOSITION" "$(jf pk 'j.campaign_phase')" "a review with a finding parks in AWAITING_DISPOSITION"
run_sc pk_end ",$FIX"',"steps":[{"continuation":"end"}]' ok
eq "blocked" "$(sf pk_end 0 status)" "end: terminal not-ready (blocked, so the CLI exits non-zero)"
eq "review_candidate_disposition_end" "$(sf pk_end 0 code)" "end: names its code"
eq "TERMINAL_STOP" "$(sf pk_end 0 campaign_phase)" "end: the campaign projects TERMINAL_STOP"
assert_contains "$(sf pk_end 0 reason)" "[rc-001]" "end: the unresolved finding is listed by id"
assert_contains "$(sf pk_end 0 reason)" "planted defect" "end: the unresolved finding is listed by claim"
eq "0" "$(sf pk_end 0 review_calls_delta)" "end: no review call"
eq "0" "$(sf pk_end 0 model_calls)" "end: no model call"

# ---- the parked review: return ------------------------------------------------------------------------------
run_sc pk_ret ",$FIX"',"steps":[{"continuation":"return","move":"forward",'"$SHIP_ENV"'}]' ok
eq "converged" "$(sf pk_ret 0 status)" "return: a descendant head is re-reviewed and converges"
eq "3" "$(sf pk_ret 0 review_calls_delta)" "return: the new head's seats all review fresh (nothing reused across heads)"
eq "TERMINAL_READY" "$(sf pk_ret 0 campaign_phase)" "return: the SAME campaign reaches TERMINAL_READY"
eq "true" "$(jf pk_ret 'j.seat_diff_final_parity')" "return: the bytes the seats last received equal an independent diff base..final head"
eq "false" "$(jf pk_ret 'j.seat_diff_parity')" "return control: the seats' diff is NOT the first head's diff"
run_sc pk_noop ",$FIX"',"steps":[{"continuation":"return","move":"noop_commit",'"$SHIP_ENV"'}]' ok
eq "converged" "$(sf pk_noop 0 status)" "return: an empty descendant commit is a new head and is reviewed"
eq "3" "$(sf pk_noop 0 review_calls_delta)" "return: an empty descendant commit still gets fresh seats (head is part of the binding)"
run_sc pk_side ",$FIX"',"steps":[{"continuation":"return","move":"sideways"}]' ok
eq "review_candidate_return_not_descendant" "$(sf pk_side 0 code)" "return: a head that does not descend from the reviewed head is refused by name"
eq "0" "$(sf pk_side 0 review_calls_delta)" "return not-descendant: no review call"
eq "AWAITING_DISPOSITION" "$(sf pk_side 0 campaign_phase)" "return not-descendant: the review stays parked (caller can still end it)"
run_sc pk_same ",$FIX"',"steps":[{"continuation":"return"}]' ok
eq "review_candidate_return_no_new_head" "$(sf pk_same 0 code)" "return: no new head is refused by name"

# ---- refusals ------------------------------------------------------------------------------------------------
run_sc pk_bogus ",$FIX"',"steps":[{"continuation":"bogus"}]' ok
eq "review_candidate_continuation_unknown" "$(sf pk_bogus 0 code)" "an unknown continuation value is refused by name"
run_sc pk_rep ",$FIX"',"steps":[{"continuation":"repair"}]' ok
eq "review_candidate_repair_not_provided" "$(sf pk_rep 0 code)" "repair is refused by name (P5 is not shipped)"
run_sc pk_none ",$FIX"',"steps":[{}]' ok
eq "review_candidate_continuation_required" "$(sf pk_none 0 code)" "resuming a parked review with no continuation and no preset is refused by name"
eq "0" "$(sf pk_none 0 review_calls_delta)" "a refused parked resume spends no review call"

# ---- the sealed preset ---------------------------------------------------------------------------------------
run_sc pr_end ",$FIX"',"preset":"end"' ok
eq "review_candidate_disposition_end" "$(jf pr_end 'j.code')" "preset end: a first run that parks on a finding closes itself"
eq "TERMINAL_STOP" "$(jf pr_end 'j.campaign_phase')" "preset end: the campaign is terminal on the first run"
run_sc pr_endr ',"failModel":"gpt-5.4","preset":"end","steps":[{"env":{"RC_VERDICT":"fix"}}]' ok
eq "review_candidate_disposition_end" "$(sf pr_endr 0 code)" "preset end: an interrupted review that resumes onto a finding closes itself"
run_sc pr_ret ",$FIX"',"preset":"return","steps":[{"move":"forward",'"$SHIP_ENV"'}]' ok
eq "AWAITING_DISPOSITION" "$(jf pr_ret 'j.steps.length ? "AWAITING_DISPOSITION" : "x"')" "preset return: the first run parks (return needs a new head)"
eq "converged" "$(sf pr_ret 0 status)" "preset return: a plain --resume with a new head returns without the flag"
run_sc pr_rep ",$FIX"',"preset":"repair","steps":[{}]' ok
eq "review_candidate_repair_not_provided" "$(sf pr_rep 0 code)" "preset repair is refused by name"
run_sc pr_flag ",$FIX"',"preset":"end","steps":[{"continuation":"return","move":"forward",'"$SHIP_ENV"'}]' ok
# preset end closes the first run, so the later flag meets a terminal campaign: a refusal, never a re-review
eq "0" "$(sf pr_flag 0 review_calls_delta)" "the flag after a preset-ended review spends no review call"

# ---- (a) run-time quorum: author family removed first, then the remaining families counted (RO7) -------------
RTQ_SEATS=",\"minPanel\":2,\"authorFamily\":\"openai\",$ANTH_OPENAI_GOOGLE"
run_sc rtq_ok "$RTQ_SEATS" ok
eq "converged" "$(jf rtq_ok 'j.status')" "RO7 run-time: three families, author removed leaves two -> quorum met, converged"
run_sc rtq "$RTQ_SEATS"',"failModel":"gemini-3-pro"' ok
eq "blocked" "$(jf rtq 'j.status')" "RO7 run-time: a lost seat leaves only one non-author family -> quorum NOT met"
eq "final_panel_families_below_minimum" "$(jf rtq 'j.reason')" "RO7 run-time: names families_below_minimum"
eq "REVIEWING" "$(jf rtq 'j.campaign_phase')" "a single transport fault on a seat stays resumable (not terminal)"

# ---- (b) a seat lost for good that leaves the panel short is terminal with a code --------------------------------
GEM='"env":{"RC_FAIL_MODEL":"gemini-3-pro"}'
run_sc rtb "$RTQ_SEATS"',"failModel":"gemini-3-pro","steps":[{'"$GEM"'},{'"$GEM"'},{'"$GEM"'}]' ok
eq "REVIEWING" "$(sf rtb 0 campaign_phase)" "short panel: after the 2nd attempt the campaign is still resumable"
eq "REVIEWING" "$(sf rtb 1 campaign_phase)" "short panel: after the 3rd attempt the campaign is still resumable"
eq "TERMINAL_STOP" "$(sf rtb 2 campaign_phase)" "short panel: the seat's attempt budget is spent -> terminal"
eq "review_candidate_panel_short" "$(sf rtb 2 code)" "short panel: terminal not-ready carries the named code"
eq "0" "$(sf rtb 2 review_calls_delta)" "short panel: the exhausted seat is not asked again"

# ---- MUTATION: break each guard in a private copy of the tree; the matching scenario must flip --------------------
MC="$TEST_TMP/mcopy"; mkdir -p "$MC"
( cd "$REPO_ROOT" && rsync -a src scripts schemas bin references profiles skills agents plugin.json .claude-plugin hooks "$MC/" ) \
  && mkdir -p "$MC/.claude" && cp "$REPO_ROOT/.claude/owner-kernel-governance.json" "$MC/.claude/"
# mut <file> <old> <new>: exact single replacement in the copy (a miss fails the suite)
mut() {
  OLD="$2" NEW="$3" node -e "
    const fs=require('fs');const f=process.argv[1];let s=fs.readFileSync(f,'utf8');
    const n=s.split(process.env.OLD).length-1;
    if(n!==1){console.error('mutation matched '+n+' times: '+process.env.OLD.slice(0,70));process.exit(3);}
    fs.writeFileSync(f,s.split(process.env.OLD).join(process.env.NEW));" "$MC/$1" || { echo "FAIL: mutation did not apply ($1)"; exit 1; }
}
restore() { cp "$REPO_ROOT/$1" "$MC/$1"; }
ENG="src/engine/autopilot-engine.js"
INT="src/engine/campaign-intake.js"
STO="src/engine/final-panel-seat-store.js"

# M1 non-descendant accepted
mut "$INT" "if (!probe(['merge-base', '--is-ancestor', held, tip.out]).ok) {" "if (false) {"
run_in "$MC" m1 ",$FIX"',"steps":[{"continuation":"return","move":"sideways"}]' ok
eq "true" "$(jf m1 'j.steps[0].code !== "review_candidate_return_not_descendant"')" "MUTATION descent check removed: a sideways head is no longer refused (red)"
restore "$INT"
run_in "$MC" m1r ",$FIX"',"steps":[{"continuation":"return","move":"sideways"}]' ok
eq "review_candidate_return_not_descendant" "$(jf m1r 'j.steps[0].code')" "MUTATION restored: the descent refusal is back (green)"

# M2 unknown continuation accepted (engine + intake both validate)
mut "$ENG" "if (!['end', 'return', 'repair'].includes(continuationFlag)) {" "if (false) {"
mut "$INT" "if (flag !== null && !['end', 'return', 'repair'].includes(flag)) {" "if (false) {"
run_in "$MC" m2 ",$FIX"',"steps":[{"continuation":"bogus"}]' ok
eq "true" "$(jf m2 'j.steps[0].code !== "review_candidate_continuation_unknown"')" "MUTATION unknown-value check removed: a bogus continuation is no longer refused (red)"
restore "$ENG"; restore "$INT"

# M3 end terminal transition removed
mut "$ENG" "return closeParkedReviewAsEnd(priorController);" "/* end removed */"
run_in "$MC" m3 ",$FIX"',"steps":[{"continuation":"end"}]' ok
eq "true" "$(jf m3 'j.steps[0].campaign_phase !== "TERMINAL_STOP"')" "MUTATION end transition removed: the campaign is no longer terminal (red)"
restore "$ENG"

# M4 preset ignored (resume path in intake, first-run path in the engine)
mut "$INT" "const continuation = parked ? (flag || preset) : null;" "const continuation = parked ? (flag) : null;"
mut "$ENG" "&& campaignControl.contract.adoption.disposition_preset === 'end') {" "&& false) {"
run_in "$MC" m4 ",$FIX"',"preset":"return","steps":[{"move":"forward",'"$SHIP_ENV"'}]' ok
eq "review_candidate_continuation_required" "$(jf m4 'j.steps[0].code')" "MUTATION preset ignored (resume): the preset return no longer applies (red)"
run_in "$MC" m4b ",$FIX"',"preset":"end"' ok
eq "true" "$(jf m4b 'j.code !== "review_candidate_disposition_end"')" "MUTATION preset ignored (first run): the preset end no longer closes the review (red)"
restore "$INT"; restore "$ENG"

# M5 reuse always on: the stored verdict's binding and the seat file key stop depending on the packet
mut "$STO" "root, safeCampaign, \`\${station}-\${inputBinding}\`, \`seat-\${seatIndex + 1}.json\`," "root, safeCampaign, \`\${station}\`, \`seat-\${seatIndex + 1}.json\`,"
mut "$STO" "|| artifact.input_binding !== expect.inputBinding" "|| false"
mut "$STO" "|| result.tree_sha !== expect.treeSha" "|| false"
mut "$STO" "if (SHA256.test(expect.packetHash || '') && expect.packetHash !== result.packet_hash) {" "if (false) {"
run_in "$MC" m5 ",$FIX"',"steps":[{"continuation":"return","move":"forward",'"$SHIP_ENV"'}]' ok
eq "true" "$(jf m5 'j.steps[0].review_calls_delta !== 3')" "MUTATION always-reuse: a returned head reuses the old head's verdicts instead of 3 fresh reviews (red)"
restore "$STO"
run_in "$MC" m5r ",$FIX"',"steps":[{"continuation":"return","move":"forward",'"$SHIP_ENV"'}]' ok
eq "3" "$(jf m5r 'j.steps[0].review_calls_delta')" "MUTATION restored: the returned head is reviewed fresh again (green)"

# M6 run-time quorum reverted to the old reading
mut "$ENG" "const authorFamilyExcluded = input.reviewCandidate === true;" "const authorFamilyExcluded = false;"
run_in "$MC" m6 "$RTQ_SEATS"',"failModel":"gemini-3-pro"' ok
eq "true" "$(jf m6 'j.status === "converged"')" "MUTATION old quorum reading: the same lost seat now counts as a met quorum (red)"
restore "$ENG"
run_in "$MC" m6r "$RTQ_SEATS"',"failModel":"gemini-3-pro"' ok
eq "blocked" "$(jf m6r 'j.status')" "MUTATION restored: the RO7 reading refuses it again (green)"

# M7 short-panel code removed
mut "$ENG" "{ code: 'review_candidate_panel_short' }" "{}"
run_in "$MC" m7 "$RTQ_SEATS"',"failModel":"gemini-3-pro","steps":[{'"$GEM"'},{'"$GEM"'},{'"$GEM"'}]' ok
eq "true" "$(jf m7 'j.steps[2].code !== "review_candidate_panel_short"')" "MUTATION short-panel code removed: the terminal carries no code (red)"
restore "$ENG"

# M8 (P3 merge): the --resume path must hand reviewOnly to the readiness bootstrap, or a resume probes the
# implementer seat again. The CLI builds the bootstrap before the run, first run and resume alike.
CLI_PRELOAD="$RC/cli-options-preload.cjs"
cat > "$CLI_PRELOAD" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const mod = require(path.join(process.env.CLI_OPTS_ROOT, 'src', 'readiness', 'provider-bootstrap.js'));
mod.createStrictL5ProviderBootstrap = (options) => {
  fs.writeFileSync(process.env.CLI_OPTS_OUT, JSON.stringify(options));
  throw new Error('options captured');
};
NODE
printf '{"schema_version":1,"base_sha":"%s","branch":"external/x","adoption":{"head_sha":"%s"}}\n' \
  "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" > "$RC/cli-contract.json"
echo spec > "$RC/cli-spec.md"
cli_opts() { # <root> <out>
  rm -f "$2"
  CLI_OPTS_ROOT="$1" CLI_OPTS_OUT="$2" NODE_OPTIONS="--require=$CLI_PRELOAD" AUTOPILOT_LEVEL=l4 \
    node "$1/bin/autopilot.js" engine review-candidate --campaign-contract "$RC/cli-contract.json" \
    --spec-file "$RC/cli-spec.md" --cwd "$RC" --resume --campaign-continuation end > "$2.out" 2>&1
  cat "$2" 2>/dev/null
}
WANT='{"cwd":"'"$RC"'","level":"l4","reviewOnly":true}'
eq "$WANT" "$(cli_opts "$REPO_ROOT" "$RC/cli-resume.json")" "RO12 resume: the CLI passes reviewOnly:true to the bootstrap on --resume"
mut "bin/autopilot.js" "...(reviewCandidateMode ? { reviewOnly: true } : {})," ""
eq "true" "$([ "$(cli_opts "$MC" "$RC/cli-resume-mut.json")" != "$WANT" ] && echo true || echo false)" "MUTATION reviewOnly dropped: the resume bootstrap no longer carries it (red)"
restore "bin/autopilot.js"
eq "$WANT" "$(cli_opts "$MC" "$RC/cli-resume-r.json")" "MUTATION restored: the resume bootstrap carries reviewOnly again (green)"

finalize_test
