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
finalize_test
