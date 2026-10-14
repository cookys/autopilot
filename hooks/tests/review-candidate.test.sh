#!/usr/bin/env bash
# review-candidate (BL-0090 P1): `autopilot engine review-candidate` reviews ONE externally produced
# base..head range with no writer. Every scenario runs in its own throwaway git repo (ledger in that
# repo's own common dir) through hooks/tests/lib/review-candidate-driver.js, which stubs only the
# seat transport (dispatch-review.sh) and the operator-side git worktree helpers.
#
# RO1 no writer          RO2 range re-derived          RO3 range fixed at admission
# RO4 malformed ranges   RO5 verify on the adopted tree RO6 modes cannot cross
# RO7 declaration only adds an exclusion              RO8 honest terminal outcome
# Negative controls are asserted in-suite (a broken case must be refused/seen); the GATE MUTATION block
# replaces the admission re-derivation with an always-ready stub and asserts each RO3/RO4 refusal then
# DISAPPEARS (i.e. the real assertions above would go red). RO9 is the regression suites, run separately.
TEST_NAME="review-candidate"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

DRIVER="$REPO_ROOT/hooks/tests/lib/review-candidate-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/review-candidate-stub-review.sh"
RC="$TEST_TMP/rc"; mkdir -p "$RC"
# eq <expected> <actual> <msg> (lib assert_eq takes actual first)
eq() { assert_eq "$2" "$1" "$3"; }

# run_sc <scenario> [extra json fields, leading comma]  -> $RC/<scenario>.json (last stdout line)
run_sc() {
  local sc="$1" extra="${2:-}"
  rm -rf "$RC/$sc"
  printf '{"root":"%s","tmp":"%s","tag":"%s","stub":"%s","scenario":"%s"%s}' \
    "$REPO_ROOT" "$RC" "$sc" "$STUB" "$sc" "$extra" > "$RC/$sc.ctx.json"
  node "$DRIVER" "$RC/$sc.ctx.json" < /dev/null > "$RC/$sc.out" 2> "$RC/$sc.err"
  tail -n 1 "$RC/$sc.out" > "$RC/$sc.json"
}
# jf <scenario> <js expression over j>
jf() { node -e "const j=JSON.parse(require('fs').readFileSync('$RC/$1.json','utf8'));const v=($2);process.stdout.write(String(v))" 2>/dev/null; }

seat() { printf '{"role":"qc","runner":"cc-shim","model":"%s","effort":"high","endpoint":null,"family":"%s"}' "$1" "$2"; }
ANTH_ANTH_OPENAI='"seats":['"$(seat claude-opus-4-6 anthropic),$(seat claude-sonnet-4-6 anthropic),$(seat gpt-5.4 openai)"']'
ANTH_OPENAI_GOOGLE='"seats":['"$(seat claude-opus-4-6 anthropic),$(seat gpt-5.4 openai),$(seat gemini-3-pro google)"']'
TWO_SEATS='"seats":['"$(seat claude-opus-4-6 anthropic),$(seat gpt-5.4 openai)"']'
ALL_ANTHROPIC='"seats":[{"role":"qc","runner":"cc-shim","model":"claude-opus-4-6","effort":"high","endpoint":null,"family":"anthropic"},{"role":"qc","runner":"cc-shim","model":"claude-sonnet-4-6","effort":"high","endpoint":null,"family":"anthropic"},{"role":"qc","runner":"cc-shim","model":"claude-haiku-4-5","effort":"high","endpoint":null,"family":"anthropic"}]'

# ---- RO1/RO8: ready path, no writer ----------------------------------------------------------------
run_sc ok
eq "converged" "$(jf ok 'j.status')" "RO8 ready: zero findings, green verify, met quorum -> converged"
eq "campaign_terminal_ready" "$(jf ok 'j.phase')" "RO8 ready ends in the terminal-ready campaign receipt"
eq "TERMINAL_READY" "$(jf ok 'j.campaign_phase')" "RO8 the real ledger projects TERMINAL_READY"
eq "0" "$(jf ok 'j.impl')" "RO1 ready path: implementer dispatch count is exactly 0"
eq "3" "$(jf ok 'j.review_calls')" "RO8 the sealed panel's three seats each reviewed once"
eq "candidate_adopted,vertical_verified,review_completed,terminal_ready" \
  "$(jf ok 'j.events.join(String.fromCharCode(44))')" "ready path journals adoption (no implementation_started), verify, review, terminal"
eq "true" "$(jf ok 'j.operator_status_clean')" "operator checkout stays clean (no worktree or file left on it)"
# RO1 control: the same driver through implement-review sees the implementer counter move
run_sc implement_control
eq "converged" "$(jf implement_control 'j.status')" "RO1 control: implement-review on the same fixture converges"
eq "true" "$(jf implement_control 'j.impl >= 1')" "RO1 control: implement-review records >= 1 implementer call (counter sees calls)"
# RO1 control: the implement adapter, forced reachable, is refusing
run_sc forced_writer
eq "true" "$(jf forced_writer 'j.forced_called')" "RO1 control planted: the composer calls the implement adapter"
eq "false" "$(jf forced_writer 'j.forced_result.committed')" "RO1 forced implement adapter does not commit"
eq "review_candidate_no_writer" "$(jf forced_writer 'j.forced_result.phase')" "RO1 forced implement adapter names its refusal"
eq "false" "$(jf forced_writer 'j.forced_result.dispatcher_called')" "RO1 forced implement adapter dispatches nothing"
eq "0" "$(jf forced_writer 'j.impl')" "RO1 forced implement adapter: implementer dispatch count stays 0"

# ---- strict readiness: the implementer_family override lands AFTER the host roster digest check ----------------------
run_sc strict_readiness
eq "converged" "$(jf strict_readiness 'j.status')" "strict l4 readiness with a roster-digesting bootstrap: review-only converges (no roster drift)"
eq "true" "$(jf strict_readiness 'j.strict_readiness_ready')" "strict readiness was really consumed (strict_l5_provider_readiness:ready in the ledger)"
eq "0" "$(jf strict_readiness 'j.impl')" "strict readiness path: 0 implementer calls"

# ---- RO12 (BL-0090 P3): review-only admission asks only for the seats it uses -------------------------------------
# The fixture's implementer provider is EXHAUSTED (its live probe is blocked), as on the host whose grok quota ran out.
COMMA='String.fromCharCode(44)'
run_sc strict_readiness_review_only
eq "converged" "$(jf strict_readiness_review_only 'j.status')" "RO12 l4 review-only converges although the implementer provider is exhausted"
eq "0" "$(jf strict_readiness_review_only 'j.impl')" "RO12 review-only: 0 implementer calls"
eq "reviewer,qc:1,qc:2,qc:3" "$(jf strict_readiness_review_only "j.probed_seats.filter((v,i,a)=>a.indexOf(v)===i).join($COMMA)")" "RO12 probe log: only reviewer and the QC panel are probed (no implementer, no verification author)"
run_sc strict_readiness_review_only ',"level":"l5","withVerificationAuthor":true'
eq "converged" "$(jf strict_readiness_review_only 'j.status')" "RO12 l5 review-only with a configured verification author and exhausted implementer converges"
eq "reviewer,qc:1,qc:2,qc:3" "$(jf strict_readiness_review_only "j.probed_seats.filter((v,i,a)=>a.indexOf(v)===i).join($COMMA)")" "RO12 l5 probe log excludes implementer and verification author"
# control: the same fixture WITHOUT the review-only profile probes the implementer and is blocked by it
run_sc strict_readiness_review_only ',"omitReviewOnlyFlag":true'
eq "true" "$(jf strict_readiness_review_only "j.probed_seats.includes('implementer')")" "RO12 control: the implement profile probes the implementer seat"
eq "false" "$(jf strict_readiness_review_only "j.status === 'converged'")" "RO12 control: the exhausted implementer blocks the implement profile"
RO_PROFILE="$(node -e "
const b = require('$REPO_ROOT/src/readiness/provider-bootstrap');
const base = { reviewer_engine: 'r', reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_family: 'anthropic', reviewer_endpoint: null,
  implementer_engine: 'i', implementer_effort: 'high', implementer_runner: 'fixture', implementer_family: 'fixture', implementer_endpoint: null,
  qc_panel_seats_complete: true, qc_panel_seats: [{ role: 'qc', runner: 'cc-shim', model: 'q1', effort: 'high', endpoint: null, family: 'openai' }] };
const roles = (o, lvl, opt) => b.deriveStrictL5InvocationPolicy(o, lvl, opt).invocation_policy.map((e) => e.tuple.role).sort().join('+');
const out = [];
out.push('ro=' + roles(base, 'l5', { reviewOnly: true }));
out.push('impl_l5_va_missing=' + (() => { try { roles(base, 'l5'); return 'accepted'; } catch (e) { return e.code; } })());
out.push('impl_l4=' + roles(base, 'l4'));
out.push('ro_no_qc=' + (() => { try { roles({ ...base, qc_panel_seats_complete: false, qc_panel_seats: [] }, 'l4', { reviewOnly: true }); return 'accepted'; } catch (e) { return e.code; } })());
out.push('impl_l5_with_va=' + roles({ ...base, verification_author_present: true, verification_author_engine: 'v', verification_author_runner: 'fixture', verification_author_effort: 'high', verification_author_endpoint: null, verification_author_family: 'f' }, 'l5'));
process.stdout.write(out.join('\n'));
")"
assert_contains "$RO_PROFILE" "ro=qc+reviewer" "RO12 review-only policy at l5 holds only reviewer and qc seats"
assert_contains "$RO_PROFILE" "impl_l5_va_missing=strict_l5_provider_roster_incomplete" "RO12 l5 implement-review still requires the verification-author seat"
assert_contains "$RO_PROFILE" "impl_l4=implementer+qc+reviewer" "RO12 l4 implement-review profile still requires the implementer"
assert_contains "$RO_PROFILE" "ro_no_qc=strict_l5_provider_roster_incomplete" "RO12/Q2 review-only requires a complete QC panel at l4 too"
assert_contains "$RO_PROFILE" "impl_l5_with_va=implementer+qc+reviewer+verification_author" "RO12 l5 implement-review requires implementer and verification-author"

# ---- the CLI itself hands reviewOnly to the bootstrap (the driver builds its own bootstrap and cannot see this) ------------
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
for mode in review-candidate implement-review; do
  rm -f "$RC/cli-opts-$mode.json"
  if [ "$mode" = review-candidate ]; then
    MODE_ARGS=(engine review-candidate --campaign-contract "$RC/cli-contract.json" --spec-file "$RC/cli-spec.md" --cwd "$RC")
  else
    MODE_ARGS=(engine implement-review --prompt-file "$RC/cli-spec.md" --branch b --base "$(printf 'a%.0s' $(seq 40))" --cwd "$RC" --campaign-contract "$RC/cli-contract.json")
  fi
  CLI_OPTS_ROOT="$REPO_ROOT" CLI_OPTS_OUT="$RC/cli-opts-$mode.json" NODE_OPTIONS="--require=$CLI_PRELOAD" \
    AUTOPILOT_LEVEL=l4 node "$REPO_ROOT/bin/autopilot.js" "${MODE_ARGS[@]}" > "$RC/cli-$mode.out" 2>&1
done
eq '{"cwd":"'"$RC"'","level":"l4","reviewOnly":true}' "$(cat "$RC/cli-opts-review-candidate.json" 2>/dev/null)" "RO12 the CLI passes reviewOnly:true to the bootstrap for engine review-candidate"
eq '{"cwd":"'"$RC"'","level":"l4"}' "$(cat "$RC/cli-opts-implement-review.json" 2>/dev/null)" "RO12 the CLI does not pass reviewOnly for engine implement-review"

# ---- context gate measures the reviewer seat in review-only -------------------------------------------------------
CTX_OUT="$(node -e "
const intake = require('$REPO_ROOT/src/engine/campaign-intake');
const f = '$RC/ctx-prompt.md'; require('fs').writeFileSync(f, 'small prompt\\n');
const run = (contract, roster) => { const r = intake.defaultContextGate({ contract, roster, promptFile: f, contractPath: f, repo: '$REPO_ROOT' }); return (r.code || r.rejection_code || (r.receipt && r.receipt.model) || r.status); };
const both = { reviewer_engine: 'rev-model-x', implementer_engine: 'impl-model-y' };
const out = [];
out.push('ro_both=' + run({ adoption: { head_sha: 'x' } }, both));
out.push('impl_both=' + run({}, both));
out.push('ro_implementer_only=' + run({ adoption: { head_sha: 'x' } }, { implementer_engine: 'impl-model-y' }));
out.push('impl_reviewer_only=' + run({}, { reviewer_engine: 'rev-model-x' }));
process.stdout.write(out.join('\\n'));
")"
assert_contains "$CTX_OUT" "ro_both=rev-model-x" "context gate: review-only measures the reviewer seat"
assert_contains "$CTX_OUT" "impl_both=impl-model-y" "context gate: implement-review still measures the implementer seat"
assert_contains "$CTX_OUT" "ro_implementer_only=reviewer_identity_missing" "context gate: review-only does not fall back to the implementer seat"
assert_contains "$CTX_OUT" "impl_reviewer_only=implementer_identity_missing" "context gate: implement-review still needs the implementer identity"

# ---- governance enforce: a named refusal at seal time ------------------------------------------------------------------
run_sc enforce_seal
eq "3" "$(jf enforce_seal 'j.seal_status')" "enforce-mode adoption seal is refused"
assert_contains "$(jf enforce_seal 'j.seal_error')" "review_candidate_governance_enforce" "enforce-mode adoption seal carries the named code"
assert_contains "$(jf enforce_seal 'j.seal_error')" "governance off or shadow" "the refusal says review-only needs governance off or shadow"
assert_not_contains "$(jf enforce_seal 'j.seal_error')" "mission_grant_ref: required" "the generic missing-field error is replaced, not appended"

# ---- RO2: the range is re-derived, never supplied ----------------------------------------------------
eq "3" "$(jf ok 'j.seat_diff_count')" "RO2 each seat received a diff file"
eq "true" "$(jf ok 'j.seat_diff_parity')" "RO2 bytes every seat received equal an independent git diff base..head"
eq "false" "$(jf ok 'j.seat_diff_perturbed_parity')" "RO2 control: a one-byte perturbed copy fails parity"
CLI="$REPO_ROOT/bin/autopilot.js"
HELP="$(node "$CLI" --help 2>&1)"
REVCMD="$(printf '%s\n' "$HELP" | grep -c 'engine review-candidate --campaign-contract')"
eq "1" "$REVCMD" "RO2 the review-candidate usage line carries only contract, seal, spec, authority, cwd and resume"
assert_not_contains "$(printf '%s\n' "$HELP" | grep 'engine review-candidate --campaign-contract')" "--diff" "RO2 no flag carries a diff"
assert_not_contains "$(printf '%s\n' "$HELP" | grep 'engine review-candidate --campaign-contract')" "--base" "RO2 no flag carries a base"
assert_not_contains "$(printf '%s\n' "$HELP" | grep 'engine review-candidate --campaign-contract')" "--verify-cmd" "RO2 no flag carries a test result or command"
assert_not_contains "$(printf '%s\n' "$HELP" | grep 'engine review-candidate --campaign-contract')" "--branch" "RO2 no flag carries the range ref"
BADFLAG="$(node "$CLI" engine review-candidate --campaign-contract x --spec-file y --diff z 2>&1)"; BADRC=$?
eq "2" "$BADRC" "RO2 an unknown flag such as --diff is a usage error"
assert_contains "$BADFLAG" "unknown engine review-candidate option: --diff" "RO2 --diff is named as unknown"

# ---- RO3: the range is fixed at admission -------------------------------------------------------------
run_sc moved_before
eq "blocked" "$(jf moved_before 'j.status')" "RO3 tip moved before admission is refused"
assert_contains "$(jf moved_before 'j.reason')" "is not the reviewed head" "RO3 the refusal says the tip is not the reviewed head (P2 wording: after a return the reviewed head is the new one)"
eq "review_candidate_branch_moved" "$(jf moved_before 'j.code')" "RO3 moved-before carries the named code at the top level"
eq "0" "$(jf moved_before 'j.review_calls')" "RO3 moved-before: 0 review calls"
eq "0" "$(jf moved_before 'j.impl')" "RO3 moved-before: 0 implementer calls"
run_sc moved_after
eq "blocked" "$(jf moved_after 'j.status')" "RO3 branch moved after admission (during verification) is refused"
eq "review_candidate_branch_moved" "$(jf moved_after 'j.code')" "RO3 moved-after carries the named code review_candidate_branch_moved"
eq "0" "$(jf moved_after 'j.review_calls')" "RO3 moved-after: 0 further review calls"
eq "TERMINAL_STOP" "$(jf moved_after 'j.campaign_phase')" "RO3 a drifted branch terminalizes the campaign (no state whose only exit is a re-refusal)"
eq "1" "$(jf moved_after 'j.verify_runs')" "RO3 control: the verify step really ran before the move was caught"
RESUME_OUT="$(node "$CLI" engine review-candidate --campaign-contract c.json --spec-file s.md --resume 2>&1)"; RESUME_RC=$?
# P2: --resume is a real path now (review-candidate-resume.test.sh); the P1 "resume unsupported" refusal is gone.
# With no readable contract it is refused by the contract check, naming that and spending nothing.
eq "1" "$RESUME_RC" "RO3 --resume with an unreadable contract is refused (exit non-zero)"
assert_not_contains "$RESUME_OUT" "review_candidate_resume_unsupported" "RO3 the P1 resume refusal no longer exists"
assert_contains "$RESUME_OUT" "campaign_contract_unreadable" "RO3 --resume refusal is named by the contract check"
assert_contains "$RESUME_OUT" '"model_calls":0' "RO3 --resume refusal spends nothing"

# ---- RO4: malformed ranges are refused before spend, each with a reason -----------------------------------
for sc in out_of_scope file_cap not_ancestor dirty_operator; do run_sc "$sc"; done
eq "blocked" "$(jf out_of_scope 'j.status')" "RO4 a path outside the allowed prefixes is refused"
assert_contains "$(jf out_of_scope 'j.reason')" "docs/leak.md" "RO4 out-of-scope names the offending path"
eq "review_candidate_out_of_scope" "$(jf out_of_scope 'j.code')" "RO4 out-of-scope carries its code at the top level"
eq "0" "$(jf out_of_scope 'j.review_calls')" "RO4 out-of-scope: 0 review calls"
eq "blocked" "$(jf file_cap 'j.status')" "RO4 file cap exceeded is refused"
assert_contains "$(jf file_cap 'j.reason')" "the sealed cap is 1" "RO4 file-cap names the cap"
eq "review_candidate_file_cap" "$(jf file_cap 'j.code')" "RO4 file-cap carries its code at the top level"
eq "0" "$(jf file_cap 'j.review_calls')" "RO4 file-cap: 0 review calls"
eq "blocked" "$(jf not_ancestor 'j.status')" "RO4 base not an ancestor of head is refused"
assert_contains "$(jf not_ancestor 'j.reason')" "is not an ancestor" "RO4 not-ancestor names the reason"
eq "review_candidate_base_not_ancestor" "$(jf not_ancestor 'j.code')" "RO4 not-ancestor carries its code at the top level"
eq "0" "$(jf not_ancestor 'j.review_calls')" "RO4 not-ancestor: 0 review calls"
run_sc head_equals_base
eq "3" "$(jf head_equals_base 'j.seal_status')" "RO4 head equal to base is refused at seal"
assert_contains "$(jf head_equals_base 'j.seal_error')" "must differ from base_sha" "RO4 head==base names the reason"
run_sc missing_head
eq "3" "$(jf missing_head 'j.seal_status')" "RO4 a head that is not in the repository is refused at seal"
assert_contains "$(jf missing_head 'j.seal_error')" "commit does not exist" "RO4 missing head names the reason"
run_sc churn_warn
eq "converged" "$(jf churn_warn 'j.status')" "RO4 control: a churn-limit breach is a warning, never a refusal"
eq "TERMINAL_READY" "$(jf churn_warn 'j.campaign_phase')" "RO4 churn warning still reaches terminal ready"
eq "true" "$(jf out_of_scope 'j.events.length === 0')" "RO4 refused ranges journal nothing (no spend)"

# ---- RO5: verification runs on the adopted tree, not the operator checkout -----------------------------
eq "blocked" "$(jf dirty_operator 'j.status')" "RO5 an untracked file in the operator checkout is refused (dirty tree)"
assert_contains "$(jf dirty_operator 'j.reason')" "uncommitted changes" "RO5 dirty refusal names the reason"
eq "0" "$(jf dirty_operator 'j.review_calls')" "RO5 dirty refusal: 0 review calls"
run_sc ignored_marker
eq "blocked" "$(jf ignored_marker 'j.status')" "RO5 a gitignored file that would make verify_cmd pass does not: the run is not ready"
eq "TERMINAL_STOP" "$(jf ignored_marker 'j.campaign_phase')" "RO5 ignored-file case ends in a terminal stop"
eq "0" "$(jf ignored_marker 'j.review_calls')" "RO5 red verify: 0 review calls"
run_sc marker_committed
eq "converged" "$(jf marker_committed 'j.status')" "RO5 control: the same verify_cmd passes when the file is part of the adopted tree"

# ---- RO6: modes cannot cross ---------------------------------------------------------------------------------
run_sc adopt_under_implement
eq "blocked" "$(jf adopt_under_implement 'j.status')" "RO6 an adoption contract under implement-review is refused"
eq "review_candidate_mode_mismatch" "$(jf adopt_under_implement 'j.code')" "RO6 adoption-under-implement carries its code"
assert_contains "$(jf adopt_under_implement 'j.reason')" "use engine review-candidate" "RO6 adoption-under-implement names review-candidate"
eq "0" "$(jf adopt_under_implement 'j.impl')" "RO6 adoption-under-implement: 0 implementer calls"
run_sc impl_under_candidate
eq "blocked" "$(jf impl_under_candidate 'j.status')" "RO6 an implementation contract under review-candidate is refused"
assert_contains "$(jf impl_under_candidate 'j.reason')" "requires a sealed adoption contract" "RO6 implementation-under-candidate names the reason"
eq "0" "$(jf impl_under_candidate 'j.review_calls')" "RO6 implementation-under-candidate: 0 review calls"
run_sc adoption_with_strict_dispatch
eq "3" "$(jf adoption_with_strict_dispatch 'j.seal_status')" "RO6 an adoption contract carrying strict-dispatch fields is refused at seal"
assert_contains "$(jf adoption_with_strict_dispatch 'j.seal_error')" "strict_dispatch must be absent for a review-only contract" "RO6 names the crossed field"
# CLI: a contract that is not an adoption contract is refused before any engine exists
CFILE="$RC/impl_under_candidate/campaign.json"
CLI_OUT="$(node "$CLI" engine review-candidate --campaign-contract "$CFILE" --spec-file "$RC/impl_under_candidate/spec.md" --cwd "$RC/impl_under_candidate/repo" 2>&1)"; CLI_RC=$?
eq "1" "$CLI_RC" "RO6 CLI refuses a non-adoption contract (exit 1)"
assert_contains "$CLI_OUT" "review_candidate_mode_mismatch" "RO6 CLI refusal is named"
assert_contains "$CLI_OUT" '"dispatcher_called":false' "RO6 CLI refusal dispatches nothing"

# ---- RO7: a declaration cannot weaken the panel ------------------------------------------------------------------
# The declared family is EXCLUDED from the family count; what remains must still meet the sealed minimum.
run_sc declared_family ',"authorFamily":"anthropic"'
eq "converged" "$(jf declared_family 'j.status')" "RO7 a declared family that leaves a diverse panel still converges"
eq "3" "$(jf declared_family 'j.review_calls')" "RO7 a declaration removes no seat from the review, only from the family count"
run_sc excl_leaves_one ",$ANTH_ANTH_OPENAI"',"authorFamily":"openai"'
eq "blocked" "$(jf excl_leaves_one 'j.status')" "RO7 (a) anthropic,anthropic,openai declaring openai leaves one family: the panel fails"
eq "review_candidate_panel_incomplete" "$(jf excl_leaves_one 'j.code')" "RO7 (a) fails with the named panel code"
assert_contains "$(jf excl_leaves_one 'j.reason')" "1 families outside the declared author family openai" "RO7 (a) names the families that remain"
eq "0" "$(jf excl_leaves_one 'j.review_calls')" "RO7 (a): 0 review calls"
run_sc excl_leaves_two ",$ANTH_OPENAI_GOOGLE"',"authorFamily":"openai"'
eq "converged" "$(jf excl_leaves_two 'j.status')" "RO7 (b) anthropic,openai,google declaring openai leaves two families: the panel passes"
eq "3" "$(jf excl_leaves_two 'j.review_calls')" "RO7 (b) all three seats review"
run_sc same_family ",$ALL_ANTHROPIC"',"authorFamily":"anthropic"'
eq "blocked" "$(jf same_family 'j.status')" "RO7 (c) control: declared family equal to every seat's family is refused"
eq "review_candidate_panel_incomplete" "$(jf same_family 'j.code')" "RO7 (c) carries the named panel code"
assert_contains "$(jf same_family 'j.reason')" "complete sealed panel" "RO7 (c) refusal names the panel rule"
eq "0" "$(jf same_family 'j.review_calls')" "RO7 (c) same-family panel: 0 review calls"
run_sc undeclared_same_family ",$ALL_ANTHROPIC"
eq "blocked" "$(jf undeclared_same_family 'j.status')" "RO7 a single-family panel fails with no declaration at all (Q2: sealed minimum families)"
eq "0" "$(jf undeclared_same_family 'j.review_calls')" "RO7 undeclared single-family panel: 0 review calls"

# ---- RO8: honest terminal outcomes --------------------------------------------------------------------------------
run_sc red_verify
eq "blocked" "$(jf red_verify 'j.status')" "RO8 red verify is not ready"
eq "TERMINAL_STOP" "$(jf red_verify 'j.campaign_phase')" "RO8 red verify terminalizes the campaign"
assert_contains "$(jf red_verify 'j.reason')" "vertical acceptance absent" "RO8 red verify names its reason"
eq "0" "$(jf red_verify 'j.review_calls')" "RO8 red verify: 0 review calls"
eq "0" "$(jf red_verify 'j.impl')" "RO8 red verify: 0 repair or implementer calls"
run_sc findings ',"verdict":"fix"'
eq "awaiting_disposition" "$(jf findings 'j.status')" "RO8 must-fix findings park for the caller's disposition, not ready"
eq "AWAITING_DISPOSITION" "$(jf findings 'j.campaign_phase')" "RO8 the findings park is a durable campaign state"
eq "0" "$(jf findings 'j.impl')" "RO8 findings: 0 writer or repair calls (autopilot never repairs here)"
run_sc quorum ',"failModel":"gpt-5.4"'
eq "blocked" "$(jf quorum 'j.status')" "RO8 an unmet quorum is not ready"
assert_contains "$(jf quorum 'j.reason')" "final_panel_seat_transport_failed" "RO8 unmet quorum names the failing seat condition"
eq "0" "$(jf quorum 'j.impl')" "RO8 unmet quorum: 0 writer calls"
run_sc short_panel ",$TWO_SEATS"
eq "blocked" "$(jf short_panel 'j.status')" "RO8 a panel smaller than the sealed minimum is not ready"
assert_contains "$(jf short_panel 'j.reason')" "must satisfy min_panel_size" "RO8 the short panel is refused for its size (a roster fact), not as a transport failure"
eq "0" "$(jf short_panel 'j.review_calls')" "RO8 short panel: 0 review calls and 0 writer calls"
eq "0" "$(jf short_panel 'j.impl')" "RO8 short panel: 0 writer calls"
# ADR-0001: depth-0 re-derives the terminal state from the ledger through `campaign inspect`
INSPECT="$(node "$CLI" campaign inspect --campaign-id "$(jf ok 'j.campaign_id')" --ledger "$(jf ok 'j.ledger_path')" 2>&1)"; INSPECT_RC=$?
eq "0" "$INSPECT_RC" "RO8 campaign inspect reads the adopted-range ledger"
assert_contains "$INSPECT" "TERMINAL_READY" "RO8 campaign inspect shows the ready terminal"
INSPECT_STOP="$(node "$CLI" campaign inspect --campaign-id "$(jf red_verify 'j.campaign_id')" --ledger "$(jf red_verify 'j.ledger_path')" 2>&1)"
assert_contains "$INSPECT_STOP" "TERMINAL_STOP" "RO8 campaign inspect shows the red-verify terminal stop"
INSPECT_PARK="$(node "$CLI" campaign inspect --campaign-id "$(jf findings 'j.campaign_id')" --ledger "$(jf findings 'j.ledger_path')" 2>&1)"
assert_contains "$INSPECT_PARK" "AWAITING_DISPOSITION" "RO8 campaign inspect shows the findings park"

# ---- GATE MUTATION: replace the admission re-derivation with an always-ready stub ---------------------------------------
# With the gate gone every RO3/RO4 refusal must disappear. Each assertion below is the NEGATION of the
# real refusal assertion above, so a vacuous suite (one that passes with the gate removed) fails here.
MUT=',"stubAdmission":true'
for sc in moved_before moved_after out_of_scope file_cap not_ancestor; do run_sc "$sc" "$MUT"; done
for sc in moved_before moved_after out_of_scope file_cap not_ancestor; do
  eq "converged" "$(jf "$sc" 'j.status')" "GATE MUTATION: with the admission re-derivation stubbed, $sc is no longer refused (real RO3/RO4 assertion would be red)"
  eq "3" "$(jf "$sc" 'j.review_calls')" "GATE MUTATION: with the admission re-derivation stubbed, $sc spends review calls"
done
eq "true" "$(jf moved_before 'j.admission_stub_calls >= 1')" "GATE MUTATION: the stub really replaced the gate (it was called)"

finalize_test
