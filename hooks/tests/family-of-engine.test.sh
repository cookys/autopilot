#!/usr/bin/env bash
# familyOfEngine names deepseek, longcat (Meituan) and beam (Reflection AI) before the generic flash arm.
# RED at the base: deepseek-v4.1-flash -> google, longcat-2.0 -> unknown, beam-free -> unknown.
. "$(dirname "$0")/lib.sh"
SW="$REPO_ROOT/scripts/lib/stage-write.js"
fam() { node -e 'process.stdout.write(require(process.argv[1]).familyOfEngine(process.argv[2]))' "$SW" "$1"; }
assert_eq "$(fam deepseek-v4.1-flash)" "deepseek" "deepseek-v4.1-flash is deepseek, not google"
assert_eq "$(fam opencode-go/deepseek-v4.1-flash)" "deepseek" "provider-prefixed deepseek id"
assert_eq "$(fam longcat-2.0)" "meituan" "longcat-2.0 is meituan"
assert_eq "$(fam beam-free)" "reflection" "beam-free is reflection"
assert_eq "$(fam gemini-3.7-flash)" "google" "gemini-3.7-flash unchanged"
assert_eq "$(fam MiniMax-M3.1-Flash)" "minimax" "MiniMax-M3.1-Flash unchanged"

# The four other family tables, each called through its real function (script-embedded ones are
# extracted verbatim from the shipped file, so a drifted copy cannot hide).
EXTRACT='const fs=require("fs");const src=fs.readFileSync(process.argv[1],"utf8");const a=src.search(/^function familyOf\(/m);const b=src.indexOf("\n}\n",a)+3;eval(src.slice(a,b)+";process.stdout.write(familyOf(process.argv[2]))")'
tfam() { node -e "$EXTRACT" "$1" "$2"; }
mfam() { node -e 'const m=require(process.argv[1]);process.stdout.write((m.modelFamilyOfEngine||m.familyOf)(process.argv[2]))' "$1" "$2"; }
for pair in "opencode-go/deepseek-v4.1-flash:deepseek" "opencode-go/longcat-2.0:meituan" "opencode-go/beam-free:reflection" "gemini-3.7-flash:google" "MiniMax-M3.1-Flash:minimax"; do
  id="${pair%%:*}"; want="${pair##*:}"
  assert_eq "$(tfam "$REPO_ROOT/scripts/resolve-review-loop.sh" "$id")" "$want" "resolve-review-loop.sh familyOf $id"
  assert_eq "$(tfam "$REPO_ROOT/scripts/resolve-dispatch-topology.js" "$id")" "$want" "resolve-dispatch-topology familyOf $id"
  assert_eq "$(mfam "$REPO_ROOT/src/engine/campaign-intake.js" "$id")" "$want" "campaign-intake modelFamilyOfEngine $id"
  assert_eq "$(mfam "$REPO_ROOT/src/readiness/status.js" "$id")" "$want" "readiness/status familyOf $id"
done
finalize_test
