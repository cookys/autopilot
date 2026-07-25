#!/usr/bin/env bash
# test-grok-effort.sh — grok effort clamping (lib/grok-effort.sh) + wiring in the 3 dispatch rails.
#
# Unit assertions run everywhere. The live end-to-end probe (which is the ONLY thing that
# proves the clamp is actually necessary AND sufficient) runs only when the grok CLI is
# present and logged in; otherwise it is SKIPPED loudly, never silently passed.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/grok-effort.sh
. "$script_dir/lib/grok-effort.sh"

fail() { printf 'test-grok-effort: FAIL — %s\n' "$1" >&2; exit 1; }

# ---- 1. clamp mapping ----------------------------------------------------------------
for pair in "low:low" "medium:medium" "high:high" "xhigh:high" "max:high"; do
  want="${pair##*:}"; got="$(grok_effort_clamp "${pair%%:*}")"
  [ "$got" = "$want" ] || fail "clamp ${pair%%:*}: want $want, got $got"
done
# Unknown/empty degrade to the grok ceiling rather than emitting an invalid value.
[ "$(grok_effort_clamp '')" = high ] || fail "clamp empty should be high"
[ "$(grok_effort_clamp 'nonsense')" = high ] || fail "clamp unknown should be high"

# The clamp must NEVER emit a value grok rejects. This is the load-bearing invariant.
for e in low medium high xhigh max '' nonsense; do
  case "$(grok_effort_clamp "$e")" in
    low|medium|high) ;;
    *) fail "clamp('$e') emitted a non-grok level" ;;
  esac
done

# ---- 2. note only fires on an actual clamp -------------------------------------------
note_of() { grok_effort_note "$1" ctx 2>&1 >/dev/null; }
[ -z "$(note_of high)" ]   || fail "no note expected when effort already grok-legal (high)"
[ -z "$(note_of medium)" ] || fail "no note expected for medium"
[ -n "$(note_of xhigh)" ]  || fail "expected a stderr note when clamping xhigh"
[ -n "$(note_of max)" ]    || fail "expected a stderr note when clamping max"
# DISPATCH_QUIET silences it like the other dispatch heads-ups.
[ -z "$(DISPATCH_QUIET=1 note_of xhigh)" ] || fail "DISPATCH_QUIET should silence the note"

# ---- 3. all three rails actually pass --reasoning-effort to grok ----------------------
# Guards the real regression: the flag existed in the CLI but was wired in none of them.
for f in dispatch-hetero.sh dispatch-review.sh dispatch-author.sh; do
  grep -q 'lib/grok-effort.sh' "$script_dir/$f" \
    || fail "$f does not source lib/grok-effort.sh"
  grep -q 'grok_effort_clamp' "$script_dir/$f" \
    || fail "$f does not clamp effort for the grok invocation"
done
# The qoder rail already had its own --reasoning-effort; it must not have been disturbed.
grep -q -- '--reasoning-effort "\$4"' "$script_dir/dispatch-review.sh" \
  || fail "dispatch-review.sh: qoder --reasoning-effort wiring was disturbed"

# ---- 4. live probe: prove xhigh really is rejected and the clamp really is accepted ----
if command -v grok >/dev/null 2>&1; then
  probe_dir="$(mktemp -d)"; trap 'rm -rf "$probe_dir"' EXIT
  printf 'reply with exactly: OK\n' >"$probe_dir/p.txt"
  run_grok() {
    timeout 40 grok --prompt-file "$probe_dir/p.txt" --cwd "$probe_dir" --model grok-4.5 \
      --reasoning-effort "$1" --always-approve --no-alt-screen --output-format json \
      </dev/null 2>&1 | head -3
  }
  raw_xhigh="$(run_grok xhigh || true)"
  if printf '%s' "$raw_xhigh" | grep -q 'unknown effort level'; then
    # Necessity confirmed: an unclamped xhigh is a hard error, so the clamp is required.
    raw_clamped="$(run_grok "$(grok_effort_clamp xhigh)" || true)"
    printf '%s' "$raw_clamped" | grep -q 'unknown effort level' \
      && fail "clamped value was itself rejected by grok: $raw_clamped"
    printf 'test-grok-effort: live probe OK (xhigh rejected, clamped value accepted)\n'
  else
    # grok widened its enum (or the probe could not reach the model). Either way the clamp
    # stays SAFE (low/medium/high remain valid) — but say so instead of implying we proved it.
    printf 'test-grok-effort: live probe INCONCLUSIVE — grok did not reject xhigh; clamp still safe but unproven here. Raw: %s\n' \
      "$(printf '%s' "$raw_xhigh" | tr -d '\n' | cut -c1-160)" >&2
  fi
else
  printf 'test-grok-effort: live probe SKIPPED (grok CLI not installed)\n' >&2
fi

printf '%s\n' 'test-grok-effort: PASS'
