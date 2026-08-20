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
for pair in "low:low" "medium:medium" "high:high" "xhigh:xhigh" "max:xhigh"; do
  want="${pair##*:}"; got="$(grok_effort_clamp "${pair%%:*}")"
  [ "$got" = "$want" ] || fail "clamp ${pair%%:*}: want $want, got $got"
done
# Unknown/empty degrade to the grok ceiling rather than emitting an invalid value.
[ "$(grok_effort_clamp '')" = xhigh ] || fail "clamp empty should be the grok ceiling"
[ "$(grok_effort_clamp 'nonsense')" = xhigh ] || fail "clamp unknown should be the grok ceiling"

# The clamp must NEVER emit a value grok rejects. This is the load-bearing invariant.
for e in low medium high xhigh max '' nonsense; do
  case "$(grok_effort_clamp "$e")" in
    low|medium|high|xhigh) ;;
    *) fail "clamp('$e') emitted a non-grok level" ;;
  esac
done

# ---- 2. note only fires on an actual clamp -------------------------------------------
note_of() { grok_effort_note "$1" ctx 2>&1 >/dev/null; }
[ -z "$(note_of high)" ]   || fail "no note expected when effort already grok-legal (high)"
[ -z "$(note_of medium)" ] || fail "no note expected for medium"
[ -z "$(note_of xhigh)" ]  || fail "no note expected now that grok accepts xhigh"
[ -n "$(note_of max)" ]    || fail "expected a stderr note when clamping max"
# DISPATCH_QUIET silences it like the other dispatch heads-ups.
[ -z "$(DISPATCH_QUIET=1 note_of max)" ] || fail "DISPATCH_QUIET should silence the note"

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

# ---- 4. live probe: read the CLI's LIVE enum and fail if the clamp has gone stale -----
# The previous version of this probe only asserted that xhigh was REJECTED, and treated
# "grok did not reject it" as INCONCLUSIVE. So when xAI shipped xhigh (grok 1.0.5, seen
# 2026-08-19) the suite stayed green while the clamp silently downgraded every xhigh
# dispatch to high for a month, printing a confident note saying the level did not exist.
# A capability table that can only fail in the restrictive direction is not a test.
#
# grok validates --effort against an enum and names the whole live enum in its own error,
# so one bogus value is a complete, cheap capability probe.
if command -v grok >/dev/null 2>&1; then
  raw_enum="$(timeout 40 grok --effort __autopilot_probe__ -p hi </dev/null 2>&1 | head -2 || true)"
  if printf '%s' "$raw_enum" | grep -q 'unknown effort level'; then
    live_enum="$(printf '%s' "$raw_enum" | sed -n 's/.*use one of: //p' | head -1 | tr -d ' ' )"
    [ -n "$live_enum" ] || fail "could not read grok's live effort enum from: $raw_enum"
    # Every level the clamp can emit must be in the live enum...
    for e in low medium high xhigh max '' nonsense; do
      c="$(grok_effort_clamp "$e")"
      printf '%s' ",$live_enum," | grep -q ",$c," \
        || fail "clamp emits '$c' for '$e' but grok's live enum is: $live_enum"
    done
    # ...and any level grok accepts that autopilot also names must pass through unclamped,
    # or we are under-delivering a level the engine can honour.
    for e in low medium high xhigh; do
      if printf '%s' ",$live_enum," | grep -q ",$e,"; then
        [ "$(grok_effort_clamp "$e")" = "$e" ] \
          || fail "grok accepts '$e' but the clamp downgrades it to '$(grok_effort_clamp "$e")' — stale table, re-probe"
      fi
    done
    printf 'test-grok-effort: live probe OK (grok enum: %s)\n' "$live_enum"
  else
    printf 'test-grok-effort: live probe INCONCLUSIVE — grok did not report an enum. Raw: %s\n' \
      "$(printf '%s' "$raw_enum" | tr -d '\n' | cut -c1-160)" >&2
  fi
else
  printf 'test-grok-effort: live probe SKIPPED (grok CLI not installed)\n' >&2
fi

printf '%s\n' 'test-grok-effort: PASS'
