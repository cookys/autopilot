#!/usr/bin/env bash
# FINDINGS* write-instruction scan (docs/plans/2026-10-24-findings-batch.md iv, P2 mechanism commit).
# Shipped guidance (skills/, references/, agents/) must never tell a subagent to Write a
# FINDINGS* / report-style file: findings reach depth 0 as text. A line violates when it has a
# write-verb followed by a FINDINGS filename token and carries no negation word.
# Negative control: a planted violating line must be flagged (RED); a planted negated line must not.
. "$(dirname "$0")/lib.sh"

# scan_findings_writes <dir>...: prints "file:line:text" for each violating line.
scan_findings_writes() {
  grep -rnE --include='*.md' \
    '([Ww]rite|[Ww]rites|[Ss]ave|[Ss]aves|[Cc]reate|[Cc]reates|[Dd]ump|[Ee]mit|[Pp]ut)[^.;]{0,80}FINDINGS([A-Za-z0-9_-]*\.[a-z]+|\*|[A-Za-z0-9_-]+)' "$@" 2>/dev/null \
    | grep -viE "never|do not|don't|does not|not a |no brief|forbid|refus|must not|without"
}

HITS="$(cd "$REPO_ROOT" && scan_findings_writes skills references agents)"
assert_eq "$HITS" "" "shipped guidance has no instruction to Write a FINDINGS* file"

# Negative control: plant a violation in a sandbox and require the scan to flag it.
SBX="$TEST_TMP/scan"
mkdir -p "$SBX/skills/x"
printf '%s\n' 'Each lane must Write its report to FINDINGS-A.md before returning.' > "$SBX/skills/x/bad.md"
printf '%s\n' 'Never ask a Claude subagent to write a FINDINGS file; return text.' > "$SBX/skills/x/ok.md"
PLANTED="$(cd "$SBX" && scan_findings_writes skills)"
assert_contains "$PLANTED" "bad.md" "planted violation is flagged"
assert_not_contains "$PLANTED" "ok.md" "negated line is not flagged"

finalize_test
