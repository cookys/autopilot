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
model=""; while [ $# -gt 0 ]; do [ "$1" = "--model" ] && model="$2"; shift; done
echo "$model" >> "$FAKE_DIR/calls.log"
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
check case_merge merge "s/for (const d of dirs) {/for (const d of dirs.slice(0, 1)) {/"

check case_pack pack "s/if (r.status !== 0) die(\`pack refused/if (false) die(\`pack refused/"

finalize_test
