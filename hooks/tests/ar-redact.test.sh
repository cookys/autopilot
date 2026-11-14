#!/usr/bin/env bash
# AR layer 2, block 1: scripts/ar-redact.js end to end through the real CLI.
# Fake sensitive values are built at run time (scripts/lib/ar-redact-fixtures.js): no secret-shaped
# literal lives in this file. Covered: planted values gone (value + 12-char fragments) and counts ==
# planted; split / \n-escaped / URL-encoded variants; negative control through the test-only module
# seam (empty rule set -> the values survive, shown RED); fail-closed exits (malformed line, a rule
# that throws, a rule gap the re-scan catches) with no out file; no matched value on stdout/stderr/report.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID 2>/dev/null || true
CLI="$REPO_ROOT/scripts/ar-redact.js"
FIX="$REPO_ROOT/scripts/lib/ar-redact-fixtures.js"
W="$TEST_TMP/ar"; mkdir -p "$W"

# build the input transcripts and the needle list (values + 12-char windows) at run time
node - "$FIX" "$W" <<'NODE'
const fs = require('fs'), path = require('path');
const [fix, w] = process.argv.slice(2);
const { planted, plantedLines, needles } = require(fix);
const p = planted(); const L = plantedLines(p);
const mk = (o) => JSON.stringify(o) + '\n';
fs.writeFileSync(path.join(w, 'in.jsonl'),
  mk({ type: 'assistant', message: { content: [{ type: 'text', text: L.slice(0, 5).join('\n') }, { type: 'tool_use', input: { command: L[7] } }] } }) +
  mk({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: L[5] + '\n' + L[6] + '\n' + L[8] + '\n' + 'pad '.repeat(100) }] } }));
fs.writeFileSync(path.join(w, 'variants.jsonl'),
  mk({ message: { content: [{ type: 'text', text: p.github.slice(0, 17) }, { type: 'text', text: p.github.slice(17) }] } }) +
  mk({ message: { content: [{ type: 'text', text: 'a\\n' + L[6] + '\\nb' }] } }) +
  mk({ message: { content: [{ type: 'text', text: 'q=' + encodeURIComponent(p.password) + '&r=1' }] } }));
fs.writeFileSync(path.join(w, 'needles.txt'), needles(p).join('\n') + '\n');
fs.writeFileSync(path.join(w, 'bad.jsonl'), '{"a": "' + p.github + '"\n');
NODE
leak_count() { # <file>: how many needles occur in the file
  node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const n=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean);console.log(n.filter((x)=>t.includes(x)).length)' "$1" "$W/needles.txt"
}

# (1) planted values: gone, counted
node "$CLI" --in "$W/in.jsonl" --out "$W/out.jsonl" --report "$W/rep.json" > "$W/o1" 2>&1 < /dev/null; EXIT=$?
assert_eq "0" "$EXIT" "(1) cli exit 0"
assert_eq "0" "$(leak_count "$W/out.jsonl")" "(1) no planted value or 12-char fragment in the excerpt"
assert_eq "9" "$(node -e 'const r=require(process.argv[1]);console.log(Object.values(r.counts).reduce((a,b)=>a+b,0))' "$W/rep.json")" "(1) report counts == planted (9)"
cat "$W/o1" "$W/rep.json" > "$W/o1.all"
assert_eq "0" "$(leak_count "$W/o1.all")" "(1) no value in stdout/stderr/report"
assert_eq "ar-redact/1 false" "$(node -e 'const r=require(process.argv[1]);console.log(r.schema,r.dropped)' "$W/rep.json")" "(1) report schema + dropped:false"

# (2) variants: split across blocks, \n-escaped, URL-encoded
node "$CLI" --in "$W/variants.jsonl" --out "$W/vout.jsonl" < /dev/null; EXIT=$?
assert_eq "0" "$EXIT" "(2) variants exit 0"
assert_eq "0" "$(leak_count "$W/vout.jsonl")" "(2) split / \\n-escaped / URL-encoded values all masked"
assert_contains "$(cat "$W/vout.jsonl")" "[REDACTED:split]" "(2) split value replaced by the split marker"

# (3) negative control through the test-only seam: empty rule sets -> the planted values SURVIVE
node -e 'const ar=require(process.argv[1]);process.exit(ar.run({in:process.argv[2],out:process.argv[3],rules:[],rescanRules:[],err:{write(){}}}))' "$CLI" "$W/in.jsonl" "$W/neg.jsonl" < /dev/null; EXIT=$?
assert_eq "0" "$EXIT" "(3) empty rule sets: run succeeds"
SURV="$(leak_count "$W/neg.jsonl")"
if [ "$SURV" -gt 0 ]; then echo "RED (expected, negative control): $SURV needles survive an empty rule set"; NEG=red; else NEG=green; fi
assert_eq "red" "$NEG" "(3) negative control is red: without rules the planted values survive the check (1) asserts"

# (4) fail-closed
node "$CLI" --in "$W/bad.jsonl" --out "$W/bad.out" --report "$W/bad.rep" < /dev/null > "$W/bad.stdout" 2> "$W/bad.stderr"; EXIT=$?
assert_eq "4" "$EXIT" "(4a) malformed line -> exit 4"
assert_eq "no" "$([ -e "$W/bad.out" ] && echo yes || echo no)" "(4a) no out file"
cat "$W/bad.stdout" "$W/bad.stderr" "$W/bad.rep" > "$W/bad.all"
assert_eq "0" "$(leak_count "$W/bad.all")" "(4a) no value printed on failure"
node -e 'const ar=require(process.argv[1]);process.exit(ar.run({in:process.argv[2],out:process.argv[3],rules:[{cls:"boom",apply(){throw new Error("x")}}],err:{write(){}}}))' "$CLI" "$W/in.jsonl" "$W/throw.out" < /dev/null; EXIT=$?
assert_eq "4" "$EXIT" "(4b) injected throw -> exit 4"
assert_eq "no" "$([ -e "$W/throw.out" ] && echo yes || echo no)" "(4b) no out file"
node -e 'const ar=require(process.argv[1]);process.exit(ar.run({in:process.argv[2],out:process.argv[3],rules:[],err:{write(){}}}))' "$CLI" "$W/in.jsonl" "$W/gap.out" < /dev/null; EXIT=$?
assert_eq "4" "$EXIT" "(4c) rule gap caught by the re-scan -> exit 4"
assert_eq "no" "$([ -e "$W/gap.out" ] && echo yes || echo no)" "(4c) no out file"
node "$CLI" --in "$W/in.jsonl" < /dev/null 2>/dev/null; EXIT=$?
assert_eq "2" "$EXIT" "(4d) missing --out -> usage exit 2"

finalize_test
