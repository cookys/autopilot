#!/usr/bin/env bash
# BL-0146 D4: end to end, a returned head of a review-only campaign in a throwaway repo through the real
# runCampaignComposition (hooks/tests/lib/review-candidate-driver.js, stub dispatch-review.sh). Both modes:
#   - adoption.return_review absent / "full": the existing behaviour, bytes unchanged, no new receipt fields;
#   - "incremental": the seats receive the re-check set only and the prior-round addendum (owner ruling
#     d-3cf4dc4c: the seat is given the list) appended to the spec; the receipt discloses review_scope. A seat
#     that stays silent about the earlier finding does NOT close it (the round parks again); seats that answer
#     it with resolutions[] do (converged); one seat answering for only some ids leaves the rest open. A
#     second return falls back to a full round.
# Negative controls (MUTATION block): each guard is broken in a private copy of the source tree and the matching
# scenario must flip; the copy is restored and the scenario shown green again.
TEST_NAME="review-candidate-incremental"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

DRIVER_REL="hooks/tests/lib/review-candidate-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/review-candidate-stub-review.sh"
RC="$TEST_TMP/rci"; mkdir -p "$RC"
eq() { assert_eq "$2" "$1" "$3"; }

run_in() {
  local root="$1" sc="$2" extra="${3:-}"
  rm -rf "$RC/$sc"
  printf '{"root":"%s","tmp":"%s","tag":"%s","stub":"%s","scenario":"%s"%s}' \
    "$root" "$RC" "$sc" "$STUB" "${4:-$sc}" "$extra" > "$RC/$sc.ctx.json"
  node "$root/$DRIVER_REL" "$RC/$sc.ctx.json" < /dev/null > "$RC/$sc.out" 2> "$RC/$sc.err"
  tail -n 1 "$RC/$sc.out" > "$RC/$sc.json"
}
run_sc() { run_in "$REPO_ROOT" "$1" "${2:-}" "${3:-multi}"; }
jf() { node -e "const j=JSON.parse(require('fs').readFileSync('$RC/$1.json','utf8'));const v=($2);process.stdout.write(String(v))" 2>/dev/null; }
sf() { jf "$1" "j.steps[$2].$3"; }

FIX='"verdict":"fix"'
SHIP_ENV='"env":{"RC_VERDICT":"ship"}'
RET='{"continuation":"return","move":"forward",'"$SHIP_ENV"'}'
# The cumulative diff of the one fixed file, the bytes an incremental seat must receive.
DIFF_FLAGS="--no-renames --no-color --no-ext-diff --no-textconv --binary --full-index --src-prefix=a/ --dst-prefix=b/ -U3 --ignore-submodules=none"
fixed_diff() { # <scenario> <head from the run's json> -> sha256 of git diff base..head -- src/value.txt
  local sc="$1" head="$2" repo
  repo="$RC/$sc/repo"
  local base; base="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -n 1)"
  git -C "$repo" diff $DIFF_FLAGS "$base" "$head" -- src/value.txt | sha256sum | cut -d' ' -f1
}
full_diff() {
  local sc="$1" head="$2" repo
  repo="$RC/$sc/repo"
  local base; base="$(git -C "$repo" rev-list --max-parents=0 HEAD | head -n 1)"
  git -C "$repo" diff --no-ext-diff --no-textconv "$base..$head" | sha256sum | cut -d' ' -f1
}
seat_diff_sha() { jf "$1" "require('crypto').createHash('sha256').update(j.steps[$2].seat_inputs['claude-opus-4-6'].diff).digest('hex')"; }

# ---- default and explicit full: unchanged ---------------------------------------------------------------------
run_sc d_def ",$FIX"',"steps":['"$RET"']'
eq "converged" "$(sf d_def 0 status)" "default: a returned head converges as before"
eq "3" "$(sf d_def 0 review_calls_delta)" "default: all three seats review the new head fresh"
eq "$(full_diff d_def "$(jf d_def 'j.final_head')")" "$(seat_diff_sha d_def 0)" "default: the seats receive the whole base..head diff"
eq "7" "$(jf d_def 'j.steps[0].seat_inputs["claude-opus-4-6"].tree.split("\n").filter(Boolean).length')" "default: the seat packet holds the whole tree (no incremental cut)"
eq "null" "$(sf d_def 0 disclosure)" "default: the receipt carries no review_scope field"
eq "0" "$(jf d_def 'j.steps[0].store_files.filter((f) => f.startsWith("round-") || f.includes("/round-")).length')" "default: no round index is written"
run_sc d_full ",$FIX"',"returnReview":"full","steps":['"$RET"']'
eq "converged" "$(sf d_full 0 status)" "return_review full: converges like the default"
eq "$(full_diff d_full "$(jf d_full 'j.final_head')")" "$(seat_diff_sha d_full 0)" "return_review full: the seats receive the whole base..head diff"
eq "null" "$(sf d_full 0 disclosure)" "return_review full: no review_scope field"

# ---- incremental ----------------------------------------------------------------------------------------------
run_sc d_inc ",$FIX"',"returnReview":"incremental","steps":['"$RET"']'
eq "awaiting_disposition" "$(jf d_inc 'j.status')" "incremental: the first (full) round parks on the planted finding"
eq "awaiting_disposition" "$(sf d_inc 0 status)" "incremental: the earlier finding is not closed by silence, so the returned round parks again"
eq "3" "$(sf d_inc 0 review_calls_delta)" "incremental: each seat is dispatched once"
eq "incremental" "$(sf d_inc 0 disclosure.review_scope)" "incremental: the receipt discloses review_scope incremental"
eq "src/value.txt" "$(jf d_inc 'j.steps[0].disclosure.incremental.recheck.map((e) => e.path).join()')" "incremental: the re-check set is the fixed file"
eq "src/a.txt,src/b.txt,src/c.txt,src/d.txt" "$(jf d_inc 'j.steps[0].disclosure.incremental.carried.map((e) => e.path).join()')" "incremental: the other four files are carried"
eq "$(fixed_diff d_inc "$(jf d_inc 'j.final_head')")" "$(seat_diff_sha d_inc 0)" "incremental: the seats receive the cumulative diff of the fixed file only"
eq "./src/value.txt" "$(jf d_inc 'j.steps[0].seat_inputs["claude-opus-4-6"].tree.trim()')" "incremental: the seat packet holds the re-check file only (A1: no carried file in any seat input)"
eq "true" "$(jf d_inc 'j.steps[0].seat_inputs["gpt-5.4"].delta.includes("external-2")')" "incremental: delta.diff (H0..H1) rides in the packet"
eq "true" "$(jf d_inc 'j.steps[0].store_files.some((f) => f.includes("final-panel-incremental-"))')" "incremental: the verdicts are stored under the incremental station"
eq "true" "$(jf d_inc 'j.steps[0].store_files.some((f) => f.includes("round-"))')" "incremental: the round index is written for an opted-in campaign"
eq "true" "$(jf d_inc 'j.steps[0].disclosure.incremental.carried.every((e) => /^[0-9a-f]{64}$/.test(e.file_digest))')" "incremental: every carried path discloses its file_digest"

# ---- the prior-round addendum (owner ruling d-3cf4dc4c) ------------------------------------------------------------
ADDSPEC='j.steps[0].seat_inputs["claude-opus-4-6"].spec'
DEFSPEC='j.steps[0].seat_inputs["claude-opus-4-6"].spec'
eq "true" "$(jf d_inc "$ADDSPEC.includes('== Prior round')")" "addendum: an incremental seat's spec carries the prior-round addendum"
eq "3" "$(jf d_inc "$ADDSPEC.split('\\n').filter((l) => /^- \\[prior:s[123]\\.rc-001\\] \\| critical \\| src\\/value.txt:1 \\| /.test(l)).length")" "addendum: one line per carried finding, id | severity | path:line | claim"
eq "false" "$(jf d_inc "/author follow-up|external-2|SHIP-AS-IS|FIX-THEN-SHIP|VERDICT/.test($ADDSPEC.slice($ADDSPEC.indexOf('== Prior round')))")" "A8: the addendum holds no commit message, no verdict, no author text"
jf d_inc "$ADDSPEC" > "$RC/d_inc.seat-spec.md"
bash "$REPO_ROOT/scripts/check-blind-evidence.sh" --payload "$RC/d_inc.seat-spec.md" >/dev/null 2>&1
eq "0" "$?" "A8: check-blind-evidence.sh passes on the spec an incremental seat actually received (assembled spec, no suppression)"
eq "true" "$(jf d_inc "/\`delta\.diff\`/.test($ADDSPEC) && /\`diff\.patch\`/.test($ADDSPEC) && /\`tree\/\`/.test($ADDSPEC) && !/recheck\.diff/.test($ADDSPEC)")" "addendum header names the files the packet really holds (delta.diff, diff.patch, tree/), not recheck.diff"
eq "false" "$(jf d_def "$DEFSPEC.includes('Prior round')")" "A9: the default (full) path's spec has no addendum"
eq "false" "$(jf d_full "$DEFSPEC.includes('Prior round')")" "A9: return_review full: the spec has no addendum"
eq "true" "$(jf d_inc "$ADDSPEC.startsWith(j.steps[0].seat_inputs['claude-opus-4-6'].spec.slice(0, $ADDSPEC.indexOf('\\n== Prior round') + 1))")" "addendum: appended after the unmodified campaign spec"
eq "$(jf d_def "$DEFSPEC")" "$(jf d_inc "$ADDSPEC.slice(0, $ADDSPEC.indexOf('\\n== Prior round'))")" "addendum: the part before it is byte-identical to the full path's spec"
run_sc d_res ",$FIX"',"returnReview":"incremental","steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"resolve"}}]'
eq "converged" "$(sf d_res 0 status)" "resolutions: every seat answering every carried finding with evidence closes them and the return converges"
eq "incremental" "$(sf d_res 0 disclosure.review_scope)" "resolutions: and the round was incremental"
run_sc d_part ",$FIX"',"returnReview":"incremental","steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"resolve_s1"}}]'
eq "awaiting_disposition" "$(sf d_part 0 status)" "resolutions: ids only some were answered stay open, so the return parks again"

# ---- round index, written then read back (BL-0146 D5) ------------------------------------------------------------------
# The engine writes one pointer per reviewed head; a later return reads it through readRoundRecord. Compare what
# the engine wrote with what the wiring module reads back and with what the receipt disclosed.
RTRIP="require(process.env.REPO_ROOT + '/src/engine/review-increment-wiring').readRoundRecord"
rr() { # <scenario> <js over: s (the step), read(head)>; reads back through the wiring of ${RR_ROOT:-$REPO_ROOT}
  REPO_ROOT="${RR_ROOT:-$REPO_ROOT}" node -e "
    const j=JSON.parse(require('fs').readFileSync('$RC/$1.json','utf8'));const s=j.steps[0];
    const readRoundRecord=$RTRIP;
    const read=(head)=>{const row=s.round_records.find((r)=>r.record.head===head);return row?readRoundRecord({root:s.store_root,campaignId:row.campaign,head}):null;};
    process.stdout.write(String($2));" 2>/dev/null
}
eq "2" "$(jf d_inc 'j.steps[0].round_records.length')" "round index: one record for the first (full) head and one for the returned head"
eq "true" "$(rr d_inc "s.round_records.every((r) => read(r.record.head) !== null && JSON.stringify(read(r.record.head)) === JSON.stringify(r.record))")" "round index: every record the engine wrote reads back identically through readRoundRecord"
eq "full" "$(rr d_inc "read(s.round_records.find((r) => r.record.mode !== 'incremental').record.head).mode")" "round index: the first head's record says it was a full round"
eq "true" "$(rr d_inc "read(s.head).mode === 'incremental' && read(s.head).binding === s.disclosure.incremental.incremental_binding")" "round index: the returned head's record carries the incremental binding the receipt disclosed"

# item 5: the mode and the binding sit at the top level of the prepared review; the authority keeps the
# full_diff_generation digest of its own payload and carries neither field.
run_sc d_cap ",$FIX"',"returnReview":"incremental","capturePrepared":true,"steps":['"$RET"']'
CAPLAST='j.prepared_captures[j.prepared_captures.length - 1]'
eq "incremental_return" "$(jf d_cap "$CAPLAST.top_mode")" "item 5: prepared review carries review_input_mode at the top level"
eq "true" "$(jf d_cap "/^[0-9a-f]{64}\$/.test($CAPLAST.top_binding)")" "item 5: prepared review carries a canonical incremental_binding at the top level"
eq "null" "$(jf d_cap "$CAPLAST.authority_mode")" "item 5: the authority does not carry the mode"
eq "full_diff_generation" "$(jf d_cap "$CAPLAST.payload_mode")" "item 5: the composition payload stays full_diff_generation"
eq "true" "$(jf d_cap "$CAPLAST.authority_review_input_digest === $CAPLAST.payload_digest")" "item 5: authority.review_input_digest binds that full_diff_generation payload"
eq "false" "$(jf d_cap "$CAPLAST.authority_keys.includes('incremental_binding')")" "item 5: the authority has no incremental_binding"
run_sc d_cap_full ",$FIX"',"capturePrepared":true,"steps":['"$RET"']'
eq "null" "$(jf d_cap_full "$CAPLAST.top_mode")" "item 5 default: no top-level mode on a full round"

# ---- two consecutive returns: incremental, then full (A13) --------------------------------------------------------
RET2='{"continuation":"return","move":"forward",'"$SHIP_ENV"'}'
run_sc d_two ",$FIX"',"returnReview":"incremental","steps":['"$RET"','"$RET2"']'
eq "awaiting_disposition" "$(sf d_two 0 status)" "two returns: the first is incremental and parks again"
eq "incremental" "$(sf d_two 0 disclosure.review_scope)" "two returns: the first return is incremental"
eq "converged" "$(sf d_two 1 status)" "two returns: the second return converges"
eq "full" "$(sf d_two 1 disclosure.review_scope)" "two returns: the second return is a full round"
eq "prior_round_incremental" "$(sf d_two 1 disclosure.incremental_fallback_reason)" "two returns: no conclusion is inherited through an incremental round"
eq "$(full_diff d_two "$(jf d_two 'j.final_head')")" "$(seat_diff_sha d_two 1)" "two returns: the second round's seats receive the whole base..head diff"

# ---- a shared-surface fix falls back to full ---------------------------------------------------------------------------
run_sc d_shared ",$FIX"',"returnReview":"incremental","steps":[{"continuation":"return","move":"forward_shared",'"$SHIP_ENV"'}]'
eq "converged" "$(sf d_shared 0 status)" "shared surface: the returned round runs full and converges"
eq "shared_surface" "$(sf d_shared 0 disclosure.incremental_fallback_reason)" "shared surface: the fallback reason is named in the receipt"
eq "$(full_diff d_shared "$(jf d_shared 'j.final_head')")" "$(seat_diff_sha d_shared 0)" "shared surface: the seats receive the whole base..head diff"

# ---- contract field (A11) ---------------------------------------------------------------------------------------------
run_sc c_bad ',"returnReview":"bogus"'
eq "true" "$(jf c_bad 'j.seal_status !== undefined && j.seal_status !== 0')" "contract: an unknown adoption.return_review value is refused by the sealer"
eq "true" "$(jf c_bad '/return_review/.test(j.seal_error)')" "contract: the refusal names the field"
run_sc c_ok ',"returnReview":"incremental"'
eq "true" "$(jf c_ok 'j.seal_status === undefined && j.status === "converged"')" "contract: incremental is accepted (a first run is a full review and converges)"

# ---- MUTATION: break each guard in a private copy of the tree; the matching scenario must flip --------------------------
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
ENG="src/engine/autopilot-engine.js"
CHK="scripts/implementation-campaign-check.js"

# M1 the carry removed: the packet keeps every path, not just the re-check set (A1)
mut "$ENG" "tree_paths: inc.recheck.map((e) => e.path)," "tree_paths: [...inc.recheck, ...inc.carried].map((e) => e.path),"
run_in "$MC" m1 ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
eq "true" "$(jf m1 'j.steps[0].seat_inputs["claude-opus-4-6"] === undefined || j.steps[0].seat_inputs["claude-opus-4-6"].tree.trim() !== "./src/value.txt"')" "MUTATION carry removed: carried files reach the seats (red)"
restore "$ENG"
run_in "$MC" m1r ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
eq "./src/value.txt" "$(jf m1r 'j.steps[0].seat_inputs["claude-opus-4-6"].tree.trim()')" "MUTATION restored: the seats see the re-check file only (green)"

# M6 the addendum never appended: the incremental seat gets the bare spec (and nothing for it to answer)
mut "$ENG" "fs.readFileSync(promptFile), Buffer.from(decision.addendum, 'utf8')," "fs.readFileSync(promptFile), Buffer.alloc(0),"
run_in "$MC" m6 ",$FIX"',"returnReview":"incremental","steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"resolve"}}]' multi
eq "true" "$(jf m6 'j.steps[0].seat_inputs["claude-opus-4-6"].spec.includes("== Prior round") === false')" "MUTATION addendum not appended: the seat's spec has no addendum (red)"
eq "awaiting_disposition" "$(sf m6 0 status)" "MUTATION addendum not appended: nothing to answer, the return parks instead of converging (red)"
restore "$ENG"

# M7 the generator call removed from the decision: no addendum is built
mut "src/engine/review-increment-wiring.js" "addendum = buildPriorRoundAddendum(" "addendum = ((...unused) => '')("
run_in "$MC" m7 ",$FIX"',"returnReview":"incremental","steps":[{"continuation":"return","move":"forward","env":{"RC_VERDICT":"resolve"}}]' multi
eq "awaiting_disposition" "$(sf m7 0 status)" "MUTATION generator call removed: no addendum, the incremental return cannot converge (red)"
restore "src/engine/review-increment-wiring.js"

# M10h the addendum header names a file the packet does not hold (recheck.diff, review finding ffcba031)
mut "src/engine/review-resolution.js" "re-check set: cumulative diff in \\\`diff.patch\\\`, complete files in \\\`tree/\\\`" "changed files in full: \\\`recheck.diff\\\`"
run_in "$MC" m10h ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
eq "false" "$(jf m10h "!/recheck\\.diff/.test(j.steps[0].seat_inputs['claude-opus-4-6'].spec)")" "MUTATION header names recheck.diff again: the file-name assertion sees it (red)"
restore "src/engine/review-resolution.js"

# M8 a commit-message / narrative line planted in the addendum: the scanner on the received spec goes red
mut "$ENG" "fs.readFileSync(promptFile), Buffer.from(decision.addendum, 'utf8')," "fs.readFileSync(promptFile), Buffer.from(\`\${decision.addendum}commit 3f2a: The implementation is correct and robust.\\n\`, 'utf8'),"
run_in "$MC" m8 ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
jf m8 "j.steps[0].seat_inputs['claude-opus-4-6'].spec" > "$RC/m8.seat-spec.md"
bash "$REPO_ROOT/scripts/check-blind-evidence.sh" --payload "$RC/m8.seat-spec.md" >/dev/null 2>&1
eq "1" "$?" "MUTATION commit-message line planted in the addendum: the blind-evidence scan on the seat's spec fails (red)"
restore "$ENG"

# M9 a full-path seat is handed an addendum: the full spec is no longer byte-identical (A9)
mut "$ENG" "if (incrementalSeat && isStr(decision.addendum) && decision.addendum.length > 0) {" "if (decision === null || decision.mode !== 'incremental') { decision = { mode: 'full', addendum: '\\n== Prior round (planted on a full path) ==\\n' }; }
      if (true) {"
mut "$ENG" "const composed = path.join(ownedIncrementalDir, 'spec.md');" "const composed = path.join(ownedIncrementalDir || os.tmpdir(), 'spec-' + process.pid + '.md');"
run_in "$MC" m9 ",$FIX"',"steps":['"$RET"']' multi
eq "true" "$(jf m9 "$DEFSPEC.includes('Prior round')")" "MUTATION addendum on the full path: the full spec now carries it (red)"
restore "$ENG"
run_in "$MC" m9r ",$FIX"',"steps":['"$RET"']' multi
eq "false" "$(jf m9r "$DEFSPEC.includes('Prior round')")" "MUTATION restored: the full path's spec is untouched (green)"

# M10 the round index cannot be read back: a record the engine wrote is not found again
mut "src/engine/review-increment-wiring.js" "&& parsed.head === head ? parsed : null;" "&& false ? parsed : null;"
run_in "$MC" m10 ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
RR_ROOT="$MC" eq "false" "$(RR_ROOT="$MC" rr m10 "s.round_records.length > 0 && s.round_records.every((r) => read(r.record.head) !== null)")" "MUTATION round index read-back broken: the engine's own records are not found again (red)"
restore "src/engine/review-increment-wiring.js"

# M5 the mode and binding placed inside the authority instead of at the top level (item 5)
mut "$ENG" "preparedReceipt.review_input_mode = 'incremental_return';
        preparedReceipt.incremental_binding = decision.binding;" "preparedReceipt.authority.review_input_mode = 'incremental_return';
        preparedReceipt.authority.incremental_binding = decision.binding;"
run_in "$MC" m5 ",$FIX"',"returnReview":"incremental","capturePrepared":true,"steps":['"$RET"']' multi
eq "true" "$(jf m5 "j.prepared_captures.length === 0 || $CAPLAST.top_mode !== \"incremental_return\" || $CAPLAST.authority_mode !== null")" "MUTATION mode placed in the authority: the top-level check fails (red)"
restore "$ENG"

# M2 the opt-in ignored: a sealed incremental return runs the full path
mut "$ENG" "if (returnedHead && sealedAdoption.return_review === 'incremental') {" "if (false) {"
run_in "$MC" m2 ",$FIX"',"returnReview":"incremental","steps":['"$RET"']' multi
eq "converged" "$(sf m2 0 status)" "MUTATION opt-in ignored: the return runs full and converges instead of parking (red)"
restore "$ENG"

# M3 the sealer accepts any value (A11)
mut "$CHK" "&& !['full', 'incremental'].includes(adoption.return_review)) {" "&& false) {"
run_in "$MC" m3 ',"returnReview":"bogus"' multi
eq "true" "$(jf m3 'j.seal_status === undefined')" "MUTATION value check removed: the sealer accepts an unknown return_review (red)"
restore "$CHK"

finalize_test
