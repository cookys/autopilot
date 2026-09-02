#!/usr/bin/env bash
# Vocabulary parity between the qualifier and the recorder, plus the model-id charset.
#
# Why this exists: on 2026-08-20 a reviewer qualification PASSED and then its own
# emitted row was REJECTED by `engine-scorecard.js record` —
#   ERROR: invalid version_source 'operator-asserted'   (scorecard knew runtime|manual)
#   ERROR: invalid effort 'none'                        (scorecard knew low..max)
# Every CLI-transport qualification was therefore unrecordable, and nothing was red:
# the qualifier validates its own flags, the scorecard validates its own rows, and
# no test ever asked whether one side can accept what the other side produces.
#
# Same run also found that the identity TOKEN could not express two real vendor
# model ids ("Gemini 3.7 Flash (High)", "kimi-code/k3-256k"), which made those
# engines unqualifiable for a NAMING reason rather than a capability one.
#
# Deterministic: parses source + exercises the two CLIs. No network, no model spend.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QUALIFY_JS="$ROOT/scripts/engine-qualify.js"
QUALIFY_SH="$ROOT/scripts/engine-qualify.sh"
SCORECARD="$ROOT/scripts/engine-scorecard.js"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

# ── Store isolation (REQUIRED — this file writes) ────────────────────────────
# This test does not source hooks/tests/lib.sh, so it did not inherit lib.sh's
# per-file store redirection, and it invokes the REAL engine-qualify.sh. For the
# model ids that are legitimately ACCEPTED, the qualifier runs far enough to
# APPEND a real evidence row — so every run of this file added rows to the
# operator's own ~/.autopilot/engine-capability/qualification-evidence.jsonl.
# Measured on this host 2026-09-02: 356 of 404 rows in that store came from here.
#
# The rejected-id cases wrote nothing (they die at argv validation), which is why
# the leak was small per run and invisible: two rows, no failure, suite green.
# hooks/tests/run.sh's real-store fingerprint guard is what found it — a static
# grep for the store env vars did not, because this file never names them.
VOCAB_TMP="$(mktemp -d "${TMPDIR:-/tmp}/autopilot-test-qualify-vocab-XXXXXX")"
trap 'rm -rf "$VOCAB_TMP"' EXIT
export ENGINE_CAPABILITY_DIR="$VOCAB_TMP/engine-capability"
export ENGINE_SCORECARD_DIR="$VOCAB_TMP/engine-scorecard"
mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"

# ---------------------------------------------------------------- vocabulary
# Both sides enumerated FROM SOURCE. A hand-written expectation here would drift
# exactly the way the two validators drifted from each other.
QUALIFIER_VS="$(sed -n "s/.*--version-source must be \([a-z-]*\) or \([a-z-]*\).*/\1 \2/p" "$QUALIFY_JS" | head -n 1)"
SCORECARD_VS="$(sed -n "s/^const VALID_VERSION_SOURCES = new Set(\[\(.*\)\]).*/\1/p" "$SCORECARD" \
  | tr -d " '" | tr ',' ' ')"

if [ -z "$QUALIFIER_VS" ] || [ -z "$SCORECARD_VS" ]; then
  bad "could not parse the version_source vocabularies (qualifier='$QUALIFIER_VS' scorecard='$SCORECARD_VS') — a parser drifted; fix it before trusting this file"
else
  ok "parsed version_source vocabularies from both sources"
  for v in $QUALIFIER_VS; do
    case " $SCORECARD_VS " in
      *" $v "*) ok "scorecard accepts version_source '$v' that the qualifier can emit" ;;
      *)        bad "qualifier can emit version_source '$v' but engine-scorecard.js rejects it — the qualification would pass and then be unrecordable" ;;
    esac
  done
fi

# Effort: whatever the scorecard accepts must include every level the qualifier's
# own dispatch surface uses, plus `none` for effort-less transports.
# Anchor on `includes(row.effort)`, NOT on any particular value: anchoring on
# 'none' made a REGRESSION of the vocabulary look like a parser failure, which
# points the reader at the wrong file.
# v2.35.9: the vocabulary moved out of an inline array literal into the named EFFORT_VALUES
# const (it now has several consumers — record validation, seat-status --effort, the seat
# partition). Parse the const, and separately assert the row guard still consults it, so
# "the const exists" cannot pass while the guard reads something else.
SCORECARD_EFFORTS="$(sed -n "s/^const EFFORT_VALUES = \[\(.*\)\];/\1/p" "$SCORECARD" \
  | tr -d " '" | tr ',' ' ')"
if grep -q '!EFFORT_VALUES.includes(row.effort)' "$SCORECARD"; then
  ok "the record-time effort guard consults EFFORT_VALUES"
else
  bad "the record-time effort guard no longer consults EFFORT_VALUES — the vocabulary has a second source"
fi
if [ -z "$SCORECARD_EFFORTS" ]; then
  bad "could not parse the scorecard effort vocabulary — parser drifted"
else
  ok "parsed scorecard effort vocabulary"
  for e in none low medium high xhigh max; do
    case " $SCORECARD_EFFORTS " in
      *" $e "*) ok "scorecard accepts effort '$e'" ;;
      *)        bad "scorecard rejects effort '$e'; http/agy/kimi tuples have no effort dimension and codex runs at max — a row using it cannot be recorded" ;;
    esac
  done
fi

# ---------------------------------------------------------------- model id charset
# Drive the real CLI: a unit-level regex check would not prove --model actually
# uses the wider validator.
# NOTE: capture into a variable, never `probe_model ... | grep -q`. This file runs
# under `set -o pipefail` and engine-qualify exits 2 on a usage error, so piping the
# call into the matcher makes the pipeline's status 2 regardless of whether the
# pattern matched — every `if` would take the else branch and the whole check would
# silently measure nothing. (Caught while writing this test: the first version
# reported all 11 unsafe ids as ACCEPTED *and* got its 4 positive cases right for
# the same wrong reason.)
probe_model() {
  local m="$1" h
  h="$(printf 'a%.0s' $(seq 64))"
  bash "$QUALIFY_SH" reviewer --engine x --model "$m" --model-version v \
    --runner r --runner-version 1 --family f --harness-version 1 --effort high \
    --prompt-config-hash "$h" --semantic-fingerprint "$h" --containment-fingerprint "$h" \
    --task-class t --domain d --language l --tool t --panel-cmd true 2>&1 | head -n 1
  return 0
}
model_rejected() {
  local out
  out="$(probe_model "$1")"
  case "$out" in *"--model must be"*) return 0 ;; *) return 1 ;; esac
}

# Real vendor ids that MUST be expressible. Aliasing them is not an escape hatch:
# engine-qualify.js cross-checks `receipt.model !== panelConfig.model`.
while IFS= read -r m; do
  [ -n "$m" ] || continue
  if model_rejected "$m"; then
    bad "real vendor model id '$m' is rejected — that engine becomes unqualifiable for a naming reason, not a capability one"
  else
    ok "accepts real vendor model id '$m'"
  fi
done <<'MODELS'
gpt-5.6-sol
glm-5.3
kimi-code/k3-256k
Gemini 3.7 Flash (High)
MODELS

# Shell metacharacters and ambiguous whitespace must STAY rejected. The value is
# only ever an argv element today; this keeps it safe if that ever changes.
while IFS= read -r m; do
  [ -n "$m" ] || continue
  if model_rejected "$m"; then
    ok "rejects unsafe model id $(printf '%q' "$m")"
  else
    bad "model id $(printf '%q' "$m") was ACCEPTED — the widened charset let a shell metacharacter or ambiguous-whitespace identity through"
  fi
done <<'BADMODELS'
a;rm -rf /
a$(id)
a`id`
a|b
a&b
a>b
a"b
a'b
a\b
BADMODELS

# Whitespace-bearing cases are built in code, NOT in a heredoc: a leading/trailing
# space in a heredoc line is invisible and gets stripped by editors and formatters
# (this test shipped a broken `trailing ` case for exactly that reason, and it
# passed as a legitimate id). Ambiguous whitespace matters — " x" and "x" must not
# be two spellings of one model identity.
for m in " leading" "trailing " " both " "	tab-lead" "tab-trail	"; do
  if model_rejected "$m"; then
    ok "rejects whitespace-ambiguous model id $(printf '%q' "$m")"
  else
    bad "model id $(printf '%q' "$m") was ACCEPTED — leading/trailing whitespace gives one model two spellings"
  fi
done

# ------------------------------------------------- twin validator (broker side)
# The model charset is enforced in TWO files. The first version of this test only
# drove engine-qualify's arg parsing, so widening one side left the broker still
# rejecting `kimi-code/k3-256k` — the qualification died with "model must be a
# bounded protocol token" AFTER passing arg validation. Byte-identity is the
# invariant: the broker compares the returned model against the expected one, so
# any divergence turns a legitimate identity into provider_identity_mismatch.
BROKER="$ROOT/scripts/qualification-case-broker.js"
# ENUMERATE the copies, never hard-code the pair. This charset was fixed in two files
# and the run still died on a THIRD copy in src/engine/capability-evidence.js — which a
# `scripts/*.js` search could not see. A hand-written file list would have the same
# blind spot; enumeration also flags a fourth copy the day someone adds one.
CHARSET='\[A-Za-z0-9 ._:()/-\]{1,128}'
mapfile -t CHARSET_FILES < <(cd "$ROOT" && grep -rl "$CHARSET" --include='*.js' scripts src 2>/dev/null | sort)
if [ "${#CHARSET_FILES[@]}" -lt 3 ]; then
  bad "expected the model-id charset in at least 3 places (qualifier, broker, capability-evidence) but found ${#CHARSET_FILES[@]}: ${CHARSET_FILES[*]:-none} — a hop that still uses the strict TOKEN will kill a legitimate identity"
else
  ok "model-id charset present in ${#CHARSET_FILES[@]} validators: ${CHARSET_FILES[*]}"
  # Compare with FIXED STRINGS, not a lookahead pattern: grep is not PCRE, so
  # `grep -o '(?!...)'` matches nothing and every file compares equal-to-empty —
  # which reported each file as differing from ITSELF on the first attempt.
  DIVERGED=0
  for f in "${CHARSET_FILES[@]}"; do
    for piece in '(?![\s])' '(?<![\s])'; do
      if ! grep -qF -- "$piece" "$ROOT/$f"; then
        bad "model-id charset in $f is missing the anchor $piece — leading/trailing whitespace would give one model two spellings at this hop"
        DIVERGED=1
      fi
    done
  done
  [ "$DIVERGED" -eq 0 ] && ok "every model-id validator carries both whitespace anchors and the same character class"
fi

# Drive the broker itself: identical regexes still prove nothing if the broker
# applies its copy to the wrong field.
# Key on the machine-readable error CODE, not on message wording: the broker emits
# {"error":{"code":"invalid_argument"}} and does NOT echo the message, so a
# text matcher reports every rejection as an acceptance (this test did exactly
# that on its first run). A valid model gets past validation and fails later with
# a different code, which is what makes the code discriminating.
broker_rejects_model() {
  local out
  out="$(node "$BROKER" run --role reviewer --provider p --model "$1" \
    --provider-cmd true --timeout-ms 1000 </dev/null 2>&1 | head -n 1)"
  case "$out" in *'"code":"invalid_argument"'*) return 0 ;; *) return 1 ;; esac
}
while IFS= read -r m; do
  [ -n "$m" ] || continue
  if broker_rejects_model "$m"; then
    bad "broker rejects real vendor model id '$m' — arg validation would pass and the run would die inside the broker"
  else
    ok "broker accepts real vendor model id '$m'"
  fi
done <<'BROKERMODELS'
gpt-5.6-sol
kimi-code/k3-256k
Gemini 3.7 Flash (High)
BROKERMODELS
for m in 'a;rm -rf /' 'a$(id)' "trailing "; do
  if broker_rejects_model "$m"; then
    ok "broker rejects unsafe model id $(printf '%q' "$m")"
  else
    bad "broker ACCEPTED unsafe model id $(printf '%q' "$m")"
  fi
done

printf '\nqualify-scorecard-vocabulary: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
