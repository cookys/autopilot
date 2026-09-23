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

# ---- 2b. per-model clamp against a stub CLI (the enum is per MODEL, not per CLI) --------
# 2026-09-23: grok-4.5 rejects xhigh ("use one of: high, medium, low") while 4.6/4.7 accept it,
# in the SAME grok build. A global table cannot be right for both; the clamp must ask the model.
stub_dir="$(mktemp -d)"; trap 'rm -rf "$stub_dir"' EXIT
cat > "$stub_dir/grok" <<'STUB'
#!/usr/bin/env bash
m=""; while [ $# -gt 0 ]; do [ "$1" = --model ] && m="$2"; shift; done
case "$m" in
  old) e="high, medium, low" ;;
  new) e="xhigh, high, medium, low" ;;
  only-high) e="high" ;;
  *) echo "some unrelated failure"; exit 3 ;;
esac
echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: $e"
exit 2
STUB
chmod +x "$stub_dir/grok"
for row in "xhigh old high" "max old high" "low old low" "xhigh new xhigh" "max new xhigh" \
           "low only-high high" "xhigh only-high high" "xhigh unparseable xhigh"; do
  set -- $row
  got="$(grok_effort_clamp "$1" "$2" "$stub_dir/grok")"
  [ "$got" = "$3" ] || fail "per-model clamp($1, model=$2): want $3, got $got"
done
# No model ⇒ static table (no probe); probe disabled ⇒ static table.
[ "$(grok_effort_clamp xhigh '' "$stub_dir/grok")" = xhigh ] || fail "no model must fall back to the static table"
[ "$(AUTOPILOT_GROK_EFFORT_PROBE=0 grok_effort_clamp xhigh old "$stub_dir/grok")" = xhigh ] \
  || fail "AUTOPILOT_GROK_EFFORT_PROBE=0 must skip the live probe"
# The note names the model and fires only on an actual clamp.
[ -n "$(grok_effort_note xhigh ctx old "$stub_dir/grok" 2>&1 >/dev/null)" ] || fail "expected a note when model 'old' clamps xhigh"
[ -z "$(grok_effort_note xhigh ctx new "$stub_dir/grok" 2>&1 >/dev/null)" ] || fail "no note when model 'new' accepts xhigh"

# ---- 3. all three rails actually pass --reasoning-effort to grok ----------------------
# Guards the real regression: the flag existed in the CLI but was wired in none of them.
for f in dispatch-hetero.sh dispatch-review.sh dispatch-author.sh; do
  grep -q 'lib/grok-effort.sh' "$script_dir/$f" \
    || fail "$f does not source lib/grok-effort.sh"
  grep -q 'grok_effort_clamp' "$script_dir/$f" \
    || fail "$f does not clamp effort for the grok invocation"
  # ...and must clamp against the dispatched MODEL (per-model enum), not the CLI default.
  grep -q 'grok_effort_clamp "\$EFFORT" "\$MODEL"' "$script_dir/$f" \
    || fail "$f clamps effort without passing \$MODEL (per-model enum ignored)"
  if grep -q 'grok_effort_clamp "\$EFFORT")' "$script_dir/$f"; then
    fail "$f still has a model-less grok_effort_clamp call"
  fi
done
# The QRP transport (qualification-review-provider.js) must delegate to the bash lib, not restate a table
# (its old "Node mirror" carried the same global-table defect).
grep -q "lib', 'grok-effort.sh'" "$script_dir/qualification-review-provider.js" \
  || fail "qualification-review-provider.js does not delegate grok effort clamping to lib/grok-effort.sh"
grep -q 'grokEffortClamp(effort, model, bin)' "$script_dir/qualification-review-provider.js" \
  || fail "qualification-review-provider.js does not pass the model to the grok clamp"
# The qoder rail already had its own --reasoning-effort; it must not have been disturbed.
grep -q -- '--reasoning-effort "\$4"' "$script_dir/dispatch-review.sh" \
  || fail "dispatch-review.sh: qoder --reasoning-effort wiring was disturbed"

# ---- 4. live probe: read EACH MODEL's live enum and fail if the clamp would emit a rejected level
# The previous probe only asked the CLI's DEFAULT model, so it stayed green while an explicit
# `--model grok-4.5` dispatch failed rc=1 on xhigh. Probe the models we actually dispatch.
if command -v grok >/dev/null 2>&1; then
  for model in "" ${AUTOPILOT_GROK_PROBE_MODELS:-grok-4.5 grok-4.7}; do
    label="${model:-<default>}"
    raw_enum="$(timeout 40 grok ${model:+--model "$model"} --effort __autopilot_probe__ -p hi </dev/null 2>&1 | head -3 || true)"
    if ! grep -q 'unknown effort level' < <(printf '%s' "$raw_enum"); then
      printf 'test-grok-effort: live probe INCONCLUSIVE for %s — no enum. Raw: %s\n' \
        "$label" "$(printf '%s' "$raw_enum" | tr -d '\n' | cut -c1-160)" >&2
      continue
    fi
    live_enum="$(printf '%s' "$raw_enum" | sed -n 's/.*use one of: //p' | head -1 | tr -d ' ')"
    [ -n "$live_enum" ] || fail "could not read grok's live effort enum for $label from: $raw_enum"
    for e in low medium high xhigh max '' nonsense; do
      c="$(grok_effort_clamp "$e" "$model")"
      grep -q ",$c," < <(printf '%s' ",$live_enum,") \
        || fail "clamp emits '$c' for '$e' on $label but its live enum is: $live_enum"
    done
    # Any level this model accepts must pass through unclamped (no silent under-delivery).
    for e in low medium high xhigh; do
      if grep -q ",$e," < <(printf '%s' ",$live_enum,"); then
        [ "$(grok_effort_clamp "$e" "$model")" = "$e" ] \
          || fail "$label accepts '$e' but the clamp downgrades it to '$(grok_effort_clamp "$e" "$model")'"
      fi
    done
    printf 'test-grok-effort: live probe OK for %s (enum: %s)\n' "$label" "$live_enum"
  done
else
  printf 'test-grok-effort: live probe SKIPPED (grok CLI not installed)\n' >&2
fi

printf '%s\n' 'test-grok-effort: PASS'
