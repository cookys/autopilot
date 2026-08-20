#!/usr/bin/env bash
# Coverage parity between the dispatcher and the probe.
#
# Why this exists: runners are added to dispatch-review.sh (where a mistake is loud —
# dispatch simply fails) but the probe is a separate file where the same omission is
# SILENT: an unknown runner falls through to `command -v "$RUNNER"`, which can never
# succeed, and the probe reports `unknown / Binary for runner X not found`. That reads
# as "not measured yet", not as "this probe cannot see this runner at all".
#
# The drift really happened: 2026-08-20 the dispatcher supported 8 runners and the probe
# knew 5 (anthropic-compatible / claude-native / kimi were invisible), with nothing red.
# This test is the missing red.
#
# Deterministic: parses source, spends nothing, needs no binary and no network.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DISPATCH="$ROOT/scripts/dispatch-review.sh"
PROBE="$ROOT/scripts/probe-engine-capability.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

# --- Runner roster: read from the dispatcher's own validation case, never hand-written.
# A hand-written list would drift the same way the probe did (see CLAUDE.md §2d-2:
# scanner rosters are enumerated from code, never typed out).
ROSTER="$(sed -n 's/^case "\$RUNNER" in \(.*\)) ;; \*).*/\1/p' "$DISPATCH" | head -n 1 | tr '|' '\n' | sed '/^$/d')"
ROSTER_N="$(printf '%s\n' "$ROSTER" | grep -c .)"

if [ "$ROSTER_N" -lt 2 ]; then
  bad "could not parse the runner roster out of dispatch-review.sh (got $ROSTER_N) — the parser drifted, fix it before trusting this file"
  printf '\nprobe-runner-coverage: %d passed, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi
ok "parsed $ROSTER_N runners from dispatch-review.sh"

# --- Each roster runner must have an explicit branch in BOTH probe case statements.
# Extract the two case bodies separately so a branch present in one but not the other
# is caught (presence without a live method is exactly as broken as neither).
BINARY_CASE="$(sed -n '/^BINARY_FOUND=0/,/^esac/p' "$PROBE")"
LIVE_CASE="$(sed -n '/No live spend method defined for runner/q;/case "\$RUNNER" in/,$p' "$PROBE" | tail -n +2)"

for r in $ROSTER; do
  # A branch label may be alternated (`cc-shim|anthropic-compatible)`) — match the token
  # anywhere in a label line, not just at its start.
  if printf '%s\n' "$BINARY_CASE" | grep -qE "^[[:space:]]*([a-z0-9-]+\|)*${r}(\|[a-z0-9-]+)*\)"; then
    ok "binary-presence branch exists for runner '$r'"
  else
    bad "runner '$r' is dispatchable but has NO binary-presence branch — probe will fall through to \`command -v $r\` and report a permanent false 'not found'"
  fi
  if printf '%s\n' "$LIVE_CASE" | grep -qE "^[[:space:]]*([a-z0-9-]+\|)*${r}(\|[a-z0-9-]+)*\)"; then
    ok "live-spend branch exists for runner '$r'"
  else
    bad "runner '$r' is dispatchable but has NO live-spend branch — --live-spend can never observe it"
  fi
done

# --- Effort consumers must agree with the dispatcher.
# Only codex/grok/qoderclicn receive an effort flag in dispatch-review.sh. If the probe
# authorized an effort tuple for any other runner it would stamp `available` on an
# identity that dispatch never actually applies.
EFFORT_LINE="$(grep -n 'codex|grok|qoderclicn) _EFFORT_CONSUMER=1' "$PROBE" | head -n 1)"
if [ -n "$EFFORT_LINE" ]; then
  ok "probe restricts effort-tuple authorization to the three runners that consume it"
else
  bad "probe's effort-consumer set no longer matches dispatch-review.sh (codex/grok/qoderclicn) — re-read both files before changing this assertion"
fi

# --- Endpoint consumers likewise.
ENDPOINT_LINE="$(grep -n 'cc-shim|anthropic-compatible) _ENDPOINT_CONSUMER=1' "$PROBE" | head -n 1)"
if [ -n "$ENDPOINT_LINE" ]; then
  ok "probe restricts endpoint-tuple authorization to the two Anthropic-transport runners"
else
  bad "probe's endpoint-consumer set no longer matches the transports that read ANTHROPIC_BASE_URL"
fi

printf '\nprobe-runner-coverage: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
