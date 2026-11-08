#!/usr/bin/env bash
# hooks/tests/review-jury.test.sh — scripts/review-jury.js with a fake dispatch-review, fake scorecard and
# fake runner binaries. No real model is called. Each case runs on the real script (must hold) and on a
# sed_mutant of it (must NOT hold): the negative control, shown red before green.
. "$(dirname "$0")/lib.sh"

JURY="$REPO_ROOT/scripts/review-jury.js"
MUT="$REPO_ROOT/scripts/review-jury-mutant.js"
NODE="$(command -v node)"
trap 'rm -f "$REPO_ROOT/scripts/review-jury-mutant.js"' EXIT
"$NODE" --check "$JURY"; assert_exit_code "$?" "0" "node --check"

STUBS="$TEST_TMP/stubs"; mkdir -p "$STUBS"
printf '#!/bin/sh\nexit 0\n' > "$STUBS/grok"; printf '#!/bin/sh\nexit 0\n' > "$STUBS/kimi"; chmod +x "$STUBS/grok" "$STUBS/kimi"

# Fake dispatch-review: logs the model, answers from $FAKE_DIR/<model with / as _>.json or a clean SHIP-AS-IS.
cat > "$TEST_TMP/fake-dispatch.sh" <<'FAKE'
#!/bin/sh
allargs="$*"; model=""; while [ $# -gt 0 ]; do [ "$1" = "--model" ] && model="$2"; shift; done
echo "$model" >> "$FAKE_DIR/calls.log"
echo "$allargs" >> "$FAKE_DIR/args.log"
f="$FAKE_DIR/$(echo "$model" | tr / _).json"
if [ -f "$f" ]; then cat "$f"; else printf '{"runner":"x","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"FINDINGS: none"}\n' "$model"; fi
FAKE
chmod +x "$TEST_TMP/fake-dispatch.sh"
# Fake scorecard: grok-4.7 and glm-5.3 are qualified reviewers, everything else has no record.
cat > "$TEST_TMP/fake-scorecard.js" <<'FAKE'
const a = process.argv; const e = a[a.indexOf('--engine') + 1];
console.log(JSON.stringify({ admission_status: (e === 'grok-4.7' || e === 'glm-5.3') ? 'qualified' : 'no_record' }));
FAKE
echo "diff --git a/x b/x" > "$TEST_TMP/pack.txt"

# run_jury <script> <case-dir> <env assignments for reach: kimi|nokimi> <endpoints: yes|no> args...
run_jury() {
  local script="$1" dir="$2" kimi="$3" eps="$4"; shift 4
  mkdir -p "$dir/fake" "$dir/home"
  local p="$STUBS:/usr/bin:/bin"
  [ "$kimi" = nokimi ] && { mkdir -p "$dir/stubs"; cp "$STUBS/grok" "$dir/stubs/"; p="$dir/stubs:/usr/bin:/bin"; }
  local epenv=()
  [ "$eps" = yes ] && epenv=(AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid AUTOPILOT_ENDPOINT_GLM_TOKEN=FAKE-glm AUTOPILOT_ENDPOINT_MINIMAX_URL=https://mm.example.invalid AUTOPILOT_ENDPOINT_MINIMAX_TOKEN=FAKE-mm)
  env -i PATH="$p" HOME="$dir/home" AUTOPILOT_ENDPOINTS_ENV="$dir/none.env" FAKE_DIR="$dir/fake" "${epenv[@]}" \
    "$NODE" "$script" run --pack "$TEST_TMP/pack.txt" --dispatch-bin "$TEST_TMP/fake-dispatch.sh" --scorecard-bin "$TEST_TMP/fake-scorecard.js" \
    --out "$dir/out" "$@" > "$dir/stdout" 2> "$dir/stderr" < /dev/null
  echo $? > "$dir/rc"
}
jq_eval() { "$NODE" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const r=eval(process.argv[2]); process.stdout.write(String(r))' "$1" "$2" 2>/dev/null; }

# case_* <script> <tag>: prints "ok" when the expectation holds.
case_family() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" kimi yes --implementer-family xai
  [ "$(jq_eval "$d/out/merged.json" 'j.seat_states.grok.status')" = excluded_family ] && ! grep -q grok-4.7 "$d/fake/calls.log" && echo ok
}
case_unavailable() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" nokimi yes --implementer-family anthropic
  [ "$(jq_eval "$d/out/merged.json" 'j.seat_states.kimi.status')" = unavailable ] && [ "$(cat "$d/rc")" = 0 ] && [ "$(jq_eval "$d/out/merged.json" 'j.round_valid')" = true ] && echo ok
}
case_one_valid() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" nokimi no --implementer-family anthropic
  [ "$(jq_eval "$d/out/merged.json" 'j.round_valid')" = false ] && [ "$(cat "$d/rc")" = 1 ] && echo ok
}
case_advisory() {
  local d="$TEST_TMP/$2"; mkdir -p "$d/fake"
  printf '%s\n' '{"runner":"kimi","model":"kimi-code/k3","status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"FINDINGS:\n🟠 [k-bug] MUST-FIX kimi only claim"}' > "$d/fake/kimi-code_k3.json"
  run_jury "$1" "$d" kimi yes --implementer-family anthropic
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'j.qualified_seats.join()')" = "grok,glm" ] && [ "$(jq_eval "$m" 'j.advisory_seats.join()')" = "kimi,minimax" ] \
    && [ "$(jq_eval "$m" 'j.findings[0].blocking_candidate+","+j.findings[0].blocking_candidate_qualified')" = "true,false" ] && echo ok
}
case_merge() {
  local d="$TEST_TMP/$2" a b; a="$d/a"; b="$d/b"; mkdir -p "$a/seats" "$b/seats"
  printf '%s\n' '{"implementer_family":"x","seats":{"grok":{"state":"dispatched","qualified":true,"family":"xai"},"kimi":{"state":"unavailable","qualified":false}}}' > "$a/run.json"
  printf '%s\n' '{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🟠 [shared] MUST-FIX one\n🟡 [only-a] CUT/FOLLOW-UP a"}' > "$a/seats/grok.json"
  printf '%s\n' '{"implementer_family":"x","seats":{"glm":{"state":"dispatched","qualified":true,"family":"zhipu"}}}' > "$b/run.json"
  printf '%s\n' '{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🟠 [shared] MUST-FIX two\n🟠 [only-b] MUST-FIX b"}' > "$b/seats/glm.json"
  env -i PATH="/usr/bin:/bin" "$NODE" "$1" merge --out "$d/out" "$a" "$b" > "$d/stdout" 2>&1 < /dev/null; local rc=$?
  local m="$d/out/merged.json"
  [ "$rc" = 0 ] && [ "$(jq_eval "$m" 'j.findings.map(f=>f.id).sort().join()')" = "only-a,only-b,shared" ] \
    && [ "$(jq_eval "$m" 'j.findings.find(f=>f.id==="shared").sources.length')" = 2 ] && echo ok
}

case_pack() {
  local d="$TEST_TMP/$2" pk; pk="$d/pk"; mkdir -p "$pk" "$d/fake"
  echo "diff" > "$pk/a.diff"; echo "questions" > "$pk/QUESTIONS.md"; echo "ctx-note" > "$pk/NOTE.md"
  (cd "$pk" && sha256sum a.diff QUESTIONS.md NOTE.md > FILES.sha256)
  cat > "$d/argdump.sh" <<'DUMP'
#!/bin/sh
echo "$@" >> "$FAKE_DIR/args.log"
echo '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"FINDINGS: none"}'
DUMP
  chmod +x "$d/argdump.sh"
  mkdir -p "$d/home"
  env -i PATH="$STUBS:/usr/bin:/bin" HOME="$d/home" FAKE_DIR="$d/fake" "$NODE" "$1" run --pack "$pk" --seats grok --implementer-family anthropic \
    --dispatch-bin "$d/argdump.sh" --scorecard-bin "$TEST_TMP/fake-scorecard.js" --out "$d/out1" > /dev/null 2>&1 < /dev/null
  local a; a="$(cat "$d/fake/args.log" 2>/dev/null)"
  case "$a" in *"a.diff"*"--spec-file"*"QUESTIONS.md"*"--pack-file"*"context.txt"*) ;; *) return ;; esac
  grep -q "ctx-note" "$d/out1/context.txt" || return
  echo tampered >> "$pk/QUESTIONS.md"
  env -i PATH="$STUBS:/usr/bin:/bin" HOME="$d/home" FAKE_DIR="$d/fake" "$NODE" "$1" run --pack "$pk" --seats grok --implementer-family anthropic \
    --dispatch-bin "$d/argdump.sh" --scorecard-bin "$TEST_TMP/fake-scorecard.js" --out "$d/out2" > /dev/null 2>&1 < /dev/null
  [ "$?" = 2 ] && echo ok
}
case_override() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" kimi yes --implementer-family anthropic \
    --seat-model kimi=kimi-code/k3.1-pro --seat-effort kimi=medium --seat-model minimax=MiniMax-M3.1-Flash
  grep -qx 'kimi-code/k3.1-pro' "$d/fake/calls.log" && grep -qx 'MiniMax-M3.1-Flash' "$d/fake/calls.log" \
    && ! grep -q 'kimi-code/k3$' "$d/fake/calls.log" \
    && [ "$(jq_eval "$d/out/merged.json" 'j.seat_states.kimi.model+","+j.seat_states.kimi.effort')" = "kimi-code/k3.1-pro,medium" ] \
    && [ "$(jq_eval "$d/out/run.json" 'j.seats.minimax.model')" = MiniMax-M3.1-Flash ] && echo ok
}
case_override_bad() {
  local d="$TEST_TMP/$2" rc1 rc2
  run_jury "$1" "$d" kimi yes --implementer-family anthropic --seat-model nosuch=x; rc1="$(cat "$d/rc")"
  run_jury "$1" "$d" kimi yes --implementer-family anthropic --seat-effort kimi; rc2="$(cat "$d/rc")"
  [ "$rc1$rc2" = 22 ] && echo ok
}

check() { # check <case> <name> <sed command for the mutant>
  local c="$1" name="$2" sedcmd="$3"
  assert_eq "$("$c" "$JURY" "${name}_real")" ok "$name holds on the real script"
  sed_mutant "$JURY" "$MUT" "$sedcmd" || return
  assert_neq "$("$c" "$MUT" "${name}_mut")" ok "$name goes red on the mutant"
}
check case_family family "s/if (family === o\['implementer-family'\])/if (false)/"
check case_unavailable unavailable "s/if (!reach) {/if (false) {/"
check case_one_valid onevalid "s/const MIN_VALID = 2;/const MIN_VALID = 1;/"
check case_advisory advisory "s/qualified: isQualified(s, scorecardBin)/qualified: true/"
check case_merge merge "s/const runs = dirs.map(/const runs = dirs.slice(0, 1).map(/"
check case_override override "s/eff\\[m\\[1\\]\\]\\[field\\] = m\\[2\\];/void 0;/"
check case_override_bad overridebad "s/if (!eff\[m\[1\]\]) die(/if (false) die(/"

check case_pack pack "s/if (r.status !== 0) die(\`pack refused/if (false) die(\`pack refused/"

# ---- pack hardening, family and question/answer cases ----
mkpack() { # mkpack <dir>: diff + QUESTIONS (Q1, Q2) + NOTE + a matching FILES.sha256
  local pk="$1"; mkdir -p "$pk"; echo diff > "$pk/a.diff"; printf 'Q1 first question?\nQ2 second question?\n' > "$pk/QUESTIONS.md"; echo note > "$pk/NOTE.md"
  (cd "$pk" && sha256sum a.diff QUESTIONS.md NOTE.md > FILES.sha256)
}
run_pack() { # run_pack <script> <case-dir> <pack> args...: rc in <case-dir>/rc
  local script="$1" d="$2" pk="$3"; shift 3; mkdir -p "$d/fake" "$d/home"
  env -i PATH="$STUBS:/usr/bin:/bin" HOME="$d/home" AUTOPILOT_ENDPOINTS_ENV="$d/none.env" FAKE_DIR="$d/fake" \
    "$NODE" "$script" run --pack "$pk" --dispatch-bin "$TEST_TMP/fake-dispatch.sh" --scorecard-bin "$TEST_TMP/fake-scorecard.js" --out "$d/out" "$@" \
    > "$d/stdout" 2> "$d/stderr" < /dev/null
  echo $? > "$d/rc"
}
refused() { # refused <case-dir> <stderr fragment>: rc 2, the fragment in stderr, no seat dispatched
  [ "$(cat "$1/rc")" = 2 ] && grep -q -- "$2" "$1/stderr" && [ ! -s "$1/fake/calls.log" ]
}
SEATS2=(--seats grok,kimi --implementer-family anthropic)

case_symlink_file() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo outside > "$d/outside.txt"; rm "$d/pk/NOTE.md"; ln -s "$d/outside.txt" "$d/pk/NOTE.md"
  (cd "$d/pk" && sha256sum a.diff QUESTIONS.md NOTE.md > FILES.sha256)
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'symlink or a special file' && echo ok
}
case_symlink_dir() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; ln -s / "$d/pk/sub"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'symlink or a special file' && echo ok
}
case_symlink_diff() { # --diff names a symlink to a file outside the pack
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo outside > "$d/outside.diff"; ln -s "$d/outside.diff" "$d/pk/b.link"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}" --diff b.link; refused "$d" 'symlink or a special file' && echo ok
}
case_diff_dotdot() { # --diff ../x resolves outside the pack
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo outside > "$d/outside.diff"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}" --diff ../outside.diff; refused "$d" 'resolves outside the pack' && echo ok
}
case_tar_bad() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; (cd "$d/pk" && tar --transform 's,^\./,../,' -cf "$d/dots.tar" .)
  tar -tf "$d/dots.tar" | grep -q '^\.\./' || return
  run_pack "$1" "$d" "$d/dots.tar" "${SEATS2[@]}"; refused "$d" 'absolute or ".." name' || return
  [ ! -e "$d/a.diff" ] || return
  rm -f "$d/dots.tar"; tar -cPf "$d/abs.tar" "$d/pk/a.diff"
  run_pack "$1" "$d" "$d/abs.tar" "${SEATS2[@]}"; refused "$d" 'absolute or ".." name' && echo ok
}
case_tar_link() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; ln -s / "$d/pk/sub"; (cd "$d/pk" && tar -cf "$d/link.tar" .)
  run_pack "$1" "$d" "$d/link.tar" "${SEATS2[@]}"; refused "$d" 'tar member is a link' && echo ok
}
case_manifest_missing() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; rm "$d/pk/FILES.sha256"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'FILES.sha256 is missing' && echo ok
}
case_manifest_extra() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo unlisted > "$d/pk/EXTRA.md"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'not listed: EXTRA.md' && echo ok
}
case_manifest_absent() { # listed but not in the pack
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo gone > "$d/pk/GONE.md"; (cd "$d/pk" && sha256sum a.diff QUESTIONS.md NOTE.md GONE.md > FILES.sha256); rm "$d/pk/GONE.md"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'listed but absent: GONE.md' && echo ok
}
case_manifest_dotdot() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; echo outside > "$d/outside.txt"; printf '%s  ../outside.txt\n' "$(sha256sum "$d/outside.txt" | cut -d' ' -f1)" >> "$d/pk/FILES.sha256"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; refused "$d" 'absolute or contains' || return
  mkpack "$d/pk2"; printf '%s  /etc/hostname\n' "$(sha256sum /etc/hostname | cut -d' ' -f1)" >> "$d/pk2/FILES.sha256"
  rm -rf "$d/fake"; run_pack "$1" "$d" "$d/pk2" "${SEATS2[@]}"; refused "$d" 'absolute or contains' && echo ok
}
case_patch_default() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mv "$d/pk/a.diff" "$d/pk/a.patch"; (cd "$d/pk" && sha256sum a.patch QUESTIONS.md NOTE.md > FILES.sha256)
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; grep -q 'a.patch' "$d/fake/args.log" 2>/dev/null && echo ok
}
case_family_fixed() { # the family belongs to the seat, not to --seat-model
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" kimi yes --implementer-family xai --seat-model grok=kimi-code/k3
  [ "$(jq_eval "$d/out/run.json" 'j.seats.grok.state+","+j.seats.grok.family')" = excluded_family,xai ] && echo ok
}
case_kimi_excluded() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" kimi yes --implementer-family moonshot
  [ "$(jq_eval "$d/out/merged.json" 'j.seat_states.kimi.status+","+j.seat_states.kimi.family')" = excluded_family,moonshot ] && ! grep -q 'kimi-code/k3' "$d/fake/calls.log" && echo ok
}
case_family_unknown() {
  local d="$TEST_TMP/$2"; run_jury "$1" "$d" kimi yes --implementer-family nosuchfamily; local rc1; rc1="$(cat "$d/rc")"
  run_jury "$1" "$d" kimi yes --implementer-family claude; [ "$rc1$(cat "$d/rc")" = 20 ] && echo ok
}
case_merge_family_mismatch() {
  local d="$TEST_TMP/$2" a b; a="$d/a"; b="$d/b"; mkdir -p "$a/seats" "$b/seats"
  printf '%s\n' '{"implementer_family":"xai","seats":{}}' > "$a/run.json"; printf '%s\n' '{"implementer_family":"anthropic","seats":{}}' > "$b/run.json"
  env -i PATH="/usr/bin:/bin" "$NODE" "$1" merge --out "$d/out" "$a" "$b" > "$d/stdout" 2> "$d/stderr" < /dev/null; [ "$?" = 2 ] && grep -q 'disagree on implementer_family' "$d/stderr" && echo ok
}
case_merge_excluded() { # a run.json written elsewhere cannot make the implementer's own family count as valid
  local d="$TEST_TMP/$2" a; a="$d/a"; mkdir -p "$a/seats"
  printf '%s\n' '{"implementer_family":"xai","seats":{"grok":{"state":"dispatched","qualified":true,"family":"anthropic"},"glm":{"state":"dispatched","qualified":true},"minimax":{"state":"dispatched","qualified":false}}}' > "$a/run.json"
  for n in grok glm minimax; do printf '%s\n' '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"none"}' > "$a/seats/$n.json"; done
  env -i PATH="/usr/bin:/bin" "$NODE" "$1" merge --out "$d/out" "$a" > "$d/stdout" 2>&1 < /dev/null
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'j.seat_states.grok.status+","+j.valid_seat_count+","+j.seat_states.grok.family')" = excluded_family,2,xai ] && echo ok
}

ANS='ANSWER Q%s | conclusion=%s | basis=%s | counterexample=%s'
answer_seat() { # answer_seat <fake-dir> <file> <verdict> <findings text with \n escapes>
  printf '{"status":"reviewed","verdict":"%s","findings":"%s"}\n' "$3" "$4" > "$1/$2"
}
case_answers_full() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 a2; a1="$(printf "$ANS" 1 no a.js:3 none-because-x)"; a2="$(printf "$ANS" 2 yes a.js:9 none-because-y)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n$a2"; answer_seat "$d/fake" kimi-code_k3.json SHIP-AS-IS "none\n$a1\n$a2"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  local m="$d/out/merged.json"
  [ "$(cat "$d/rc")" = 0 ] && [ "$(jq_eval "$m" 'j.questions.join()+"|"+Object.keys(j.answers["1"]).join()+"|"+j.answers["2"].kimi.basis+"|"+j.missing_answers.length')" = "1,2|grok,kimi|a.js:9|0" ] \
    && [ "$(jq_eval "$d/out/seats/grok.json" 'j.answers.length')" = 2 ] && [ "$(jq_eval "$m" 'Object.keys(j.unparsed_finding_lines).length')" = 0 ] \
    && grep -q 'ANSWER Q<n> | conclusion=' "$d/out/spec.txt" && grep -q '^Q2 second question' "$d/out/spec.txt" && grep -q -- "--spec-file $d/out/spec.txt" "$d/fake/args.log" \
    && bash "$REPO_ROOT/scripts/check-blind-evidence.sh" --payload "$d/out/spec.txt" > /dev/null 2>&1 && echo ok
}
case_answers_missing() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 a2; a1="$(printf "$ANS" 1 no a.js:3 none-because-x)"; a2="$(printf "$ANS" 2 yes a.js:9 none-because-y)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n$a2"; answer_seat "$d/fake" kimi-code_k3.json SHIP-AS-IS "none\n$a1"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'JSON.stringify(j.missing_answers)+","+j.round_valid')" = '[{"seat":"kimi","questions":["2"]}],true' ] && [ "$(cat "$d/rc")" = 0 ] && echo ok
}
case_answers_blank() { # an answer with an empty field is not a valid answer
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 a2 b2; a1="$(printf "$ANS" 1 no a.js:3 none-because-x)"; a2="$(printf "$ANS" 2 yes a.js:9 none-because-y)"; b2="$(printf "$ANS" 2 yes a.js:9 '')"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n$a2"; answer_seat "$d/fake" kimi-code_k3.json SHIP-AS-IS "none\n$a1\n$b2"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  [ "$(jq_eval "$d/out/merged.json" 'JSON.stringify(j.missing_answers)')" = '[{"seat":"kimi","questions":["2"]}]' ] && echo ok
}
proof_seat() { # proof_seat <fake-dir> <file> <findings> <no_finding_proof>: a seat whose answers sit after the findings text
  "$NODE" -e 'process.stdout.write(JSON.stringify({status:"reviewed",verdict:"SHIP-AS-IS",findings:process.argv[1],no_finding_proof:process.argv[2]})+"\n")' "$3" "$4" > "$1/$2"
}
case_answers_proof() { # the shape a real grok-4.7 run produced: findings none, every ANSWER on ONE line inside no_finding_proof
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local p='checked=a.diff; evidence=x; conclusion=ok ANSWER Q1 | conclusion=PASS | basis=a.js:3-9; b.js:1 | counterexample=none: unchanged ANSWER Q2 | conclusion=FAIL | basis=a.js:9 | counterexample=none: the | pipe is inside'
  proof_seat "$d/fake" grok-4.7.json none "$p"; proof_seat "$d/fake" kimi-code_k3.json none "$p"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'j.missing_answers.length+","+j.answers["1"].grok.conclusion+","+j.answers["1"].grok.basis+","+j.answers["2"].kimi.conclusion+","+j.answers["2"].kimi.counterexample')" = "0,PASS,a.js:3-9; b.js:1,FAIL,none: the | pipe is inside" ] \
    && [ "$(jq_eval "$d/out/seats/grok.json" 'j.answers.length')" = 2 ] && echo ok
}
case_answers_placeholder() { # the format request echoed back (conclusion=<your answer>) is not an answer
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 a2; a1="$(printf "$ANS" 1 no a.js:3 none-because-x)"; a2="$(printf "$ANS" 2 yes a.js:9 none-because-y)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n$a2"
  proof_seat "$d/fake" kimi-code_k3.json none "checked=x; evidence=y; conclusion=z ANSWER Q1 | conclusion=no | basis=a.js:3 | counterexample=none: x ANSWER Q2 | conclusion=<your answer> | basis=<file:line, one or more> | counterexample=<a concrete counterexample>"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  [ "$(jq_eval "$d/out/merged.json" 'JSON.stringify(j.missing_answers)')" = '[{"seat":"kimi","questions":["2"]}]' ] && echo ok
}
case_answers_duplicate() { # the same question twice: the first one stands, the repeat is recorded
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 b1 a2; a1="$(printf "$ANS" 1 first a.js:3 none-x)"; b1="$(printf "$ANS" 1 second a.js:4 none-y)"; a2="$(printf "$ANS" 2 yes a.js:9 none-z)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n$b1\n$a2"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'j.answers["1"].grok.conclusion+","+JSON.stringify(j.seat_states.grok.duplicate_answers)')" = 'first,["1"]' ] \
    && [ "$(jq_eval "$d/out/seats/grok.json" 'JSON.stringify(j.duplicate_answers)+","+j.answers.length')" = '["1"],2' ] && echo ok
}
case_answers_quoted() { # a finding line quoting an answer string is not an answer; the real ANSWER line on the next line is
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local q1 r1 a2; q1="$(printf "$ANS" 1 PASS a.js:3 none-quoted)"; r1="$(printf "$ANS" 1 FAIL a.js:4 none-real)"; a2="$(printf "$ANS" 2 yes a.js:9 none-z)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n[x] MUST-FIX fixture used $q1\n$r1\n$a2"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  local m="$d/out/merged.json"
  [ "$(jq_eval "$m" 'j.answers["1"].grok.conclusion+","+JSON.stringify(j.seat_states.grok.duplicate_answers||[])')" = 'FAIL,[]' ] \
    && [ "$(jq_eval "$d/out/seats/grok.json" 'JSON.stringify(j.duplicate_answers)')" = '[]' ] && echo ok
}
case_answers_quoted_missing() { # a finding line quoting ANSWER Q2 does not answer Q2
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; mkdir -p "$d/fake"
  local a1 q2; a1="$(printf "$ANS" 1 no a.js:3 none-x)"; q2="$(printf "$ANS" 2 yes a.js:9 none-quoted)"
  answer_seat "$d/fake" grok-4.7.json SHIP-AS-IS "none\n$a1\n[x] MUST-FIX fixture used $q2"
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  [ "$(jq_eval "$d/out/merged.json" 'JSON.stringify(j.missing_answers.filter(x=>x.seat==="grok"))')" = '[{"seat":"grok","questions":["2"]}]' ] && echo ok
}
case_numbered_questions() { # "1." and "2)" question lines count, a number inside a sentence does not
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; printf 'intro\n1. first?\n2) second?\n70 of 71 receipts fail\n' > "$d/pk/QUESTIONS.md"
  (cd "$d/pk" && sha256sum a.diff QUESTIONS.md NOTE.md > FILES.sha256)
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"; [ "$(jq_eval "$d/out/merged.json" 'j.questions.join()')" = "1,2" ] && echo ok
}
case_skipped() {
  local d="$TEST_TMP/$2"; mkpack "$d/pk"; head -c 350000 /dev/zero | tr '\0' 'x' > "$d/pk/big.txt"
  (cd "$d/pk" && sha256sum a.diff QUESTIONS.md NOTE.md big.txt > FILES.sha256)
  run_pack "$1" "$d" "$d/pk" "${SEATS2[@]}"
  [ "$(jq_eval "$d/out/run.json" 'j.skipped_files[0].path+","+j.skipped_files[0].bytes+","+/context cap/.test(j.skipped_files[0].reason)')" = "big.txt,350000,true" ] \
    && [ "$(head -n1 "$d/out/context.txt")" = "以下檔案因大小未附：big.txt" ] && [ "$(jq_eval "$d/out/merged.json" 'j.skipped_files.map(x=>x.path).join()')" = big.txt ] && echo ok
}

check case_symlink_file symlinkfile "s/if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) die(/if (false) die(/"
check case_symlink_dir symlinkdir "s/if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) die(/if (false) die(/"
check case_symlink_diff symlinkdiff "s/if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) die(/if (false) die(/"
check case_diff_dotdot diffdotdot "s/if (!rp.startsWith(rootReal + path.sep)) die(/if (false) die(/"
check case_tar_bad tarbad "s/if (n && badTarName(n)) die(/if (false) die(/"
check case_tar_link tarlink "s/if (\/^\[lh\]\/.test(l)) die(/if (false) die(/"
check case_manifest_missing manifestmissing "s/if (!files.includes(sums)) die(/if (false) die(/"
check case_manifest_extra manifestextra "s/if (extra.length || missing.length) die(/if (false) die(/"
check case_manifest_absent manifestabsent "s/if (extra.length || missing.length) die(/if (false) die(/"
check case_manifest_dotdot manifestdotdot "s/ || p.split('\/').includes('..')) die(/) die(/"
check case_patch_default patchdefault "s/ || f.endsWith('.patch')//"
check case_family_fixed familyfixed "s/const family = SEATS\[n\].family;/const family = s.model.startsWith('kimi') ? 'moonshot' : SEATS[n].family;/"
check case_kimi_excluded kimiexcluded "s/const family = SEATS\[n\].family;/const family = 'none';/"
check case_family_unknown familyunknown "s/if (!KNOWN_FAMILIES.has(o\['implementer-family'\])) die(/if (false) die(/"
check case_merge_family_mismatch mergemismatch "s/if (run.implementer_family !== implFamily) die(/if (false) die(/"
check case_merge_excluded mergeexcluded "s/if (st.family === implFamily) status = 'excluded_family';/if (false) status = 'excluded_family';/"
check case_answers_full answersfull "s/s.answers = pa.answers;/s.answers = [];/"
check case_answers_missing answersmissing "s/if (miss.length) missingAnswers.push(/if (false) missingAnswers.push(/"
check case_answers_blank answersblank "s/if (!conclusion || !basis || !counterexample || /if (false || /"
check case_answers_proof answersproof "s/texts.map((t) => String(t || ''))/texts.slice(0, 1).map((t) => String(t || ''))/"
check case_answers_placeholder answersplaceholder "s/ || \\/^<\\[^>\\]\\*>\\$\\/\\.test(conclusion)//"
check case_answers_duplicate answersduplicate "s/if (seen.has(m\\[1\\])) {/if (false) {/"
check case_answers_quoted answersquoted "s/filter((l) => l.trim().startsWith('ANSWER Q'))/filter((l) => l.includes('ANSWER Q'))/"
check case_answers_quoted_missing answersquotedmissing "s/filter((l) => l.trim().startsWith('ANSWER Q'))/filter((l) => l.includes('ANSWER Q'))/"
check case_numbered_questions numbered "s/const id = m && (m\[1\] || m\[2\]);/const id = m && m[1];/"
check case_skipped skipped "s/if (skipped.length) {/if (false) {/"
check case_skipped skippedmerged "s/skipped_files: skippedFiles,/skipped_files: [],/"

# 8d53f188: the real dispatch-review.sh parsing section (stub runner, no model) keeps SHIP-AS-IS and the ANSWER lines
# when the block is SHIP-AS-IS + FINDINGS: none + ANSWER lines + NO-FINDING-PROOF.
cat > "$TEST_TMP/answer-runner.sh" <<'STUB'
#!/usr/bin/env bash
prompt=""; i=1
while [ "$i" -le "$#" ]; do
  arg="${!i}"
  if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then ni=$((i+1)); na="${!ni}"; if [ -n "$na" ] && [ -f "$na" ]; then prompt="$(cat "$na")"; else prompt="$na"; fi; break; fi
  i=$((i+1))
done
[ -z "$prompt" ] && prompt="$(cat)"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
[ -z "$begin" ] || [ -z "$end" ] && exit 0
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nANSWER Q1 | conclusion=PASS | basis=x.js:1 | counterexample=none: unchanged\nANSWER Q2 | conclusion=FAIL | basis=x.js:2 | counterexample=none: guarded\nNO-FINDING-PROOF: checked=fixture diff and acceptance contract; evidence=changed assignment is present in captured diff; conclusion=specified assignment change has no blocking failure\n%s\n' "$begin" "$end"
STUB
chmod +x "$TEST_TMP/answer-runner.sh"
printf 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n' > "$TEST_TMP/dr.diff"
echo 'Review the diff against the spec.' > "$TEST_TMP/dr-spec.txt"
bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/dr.diff" --spec-file "$TEST_TMP/dr-spec.txt" \
  --bin "$TEST_TMP/answer-runner.sh" > "$TEST_TMP/dr-out.json" 2> "$TEST_TMP/dr-err.txt" < /dev/null
assert_exit_code "$?" "0" "dispatch-review with ANSWER lines: rc 0"
assert_eq "$("$NODE" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const a=j.findings.split("\n").filter(l=>/^ANSWER Q\d \|/.test(l));process.stdout.write(j.verdict+","+j.status+","+a.length+","+(j.no_finding_proof||"").startsWith("checked="))' "$TEST_TMP/dr-out.json")" "SHIP-AS-IS,reviewed,2,true" "dispatch-review keeps SHIP-AS-IS, both ANSWER lines and the proof"

# the fixed seat families agree with familyOfEngine() for each seat's default model
"$NODE" -e '
const { familyOfEngine } = require(process.argv[1] + "/scripts/lib/stage-write");
const src = require("fs").readFileSync(process.argv[1] + "/scripts/review-jury.js", "utf8");
const bad = [];
for (const m of src.matchAll(/^  (\w+): \{[^}]*model: \x27([^\x27]+)\x27[^}]*family: \x27(\w+)\x27 \}/gm)) if (familyOfEngine(m[2]) !== m[3]) bad.push(m[1]);
process.exit(bad.length || !src.includes("family: \x27xai\x27") ? 1 : 0);' "$REPO_ROOT"
assert_exit_code "$?" "0" "seat families agree with familyOfEngine"

finalize_test
