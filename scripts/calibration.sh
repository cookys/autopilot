#!/usr/bin/env bash
# calibration.sh — verdict-vs-outcome sample store and agreement reporter.
#
# Stores panel-vs-authoritative verdict pairs so the QC panel's actual
# accuracy can be measured before any authority shift (KR3).
#
# SUBCOMMANDS:
#   add-sample  --panel-verdict <pass|fail>
#               --authoritative-verdict <pass|fail>
#               [--baseline <self-report|reviewer>]  default: reviewer
#               [--outcome <ok|defect-found>]
#               [--class <critical|major|minor>]
#               [--tokens <n>]
#               [--source <id>]
#
#   report      → JSON: {sample_count, agreement_rate, false_pass_on_critical,
#                         per_class, cumulative_token_estimate,
#                         self_report_sample_count,
#                         graduation: {criteria, met, unmet_reasons}}
#
#              Agreement rate, false_pass_on_critical, sample_count, and ALL
#              graduation math are computed ONLY over baseline=="reviewer"
#              samples (or records lacking the field, treated as reviewer for
#              backward compat).  self_report_sample_count is reported
#              separately and excluded from graduation math.
#
#   run-known-bad --panel-cmd '<cmd>'
#               Feeds each diff in evals/known-bad/ to the panel command and
#               records false-passes per class into the sample store.
#               The panel-cmd receives the diff on stdin; it must exit 0 and
#               print a JSON object containing {"verdict":"pass"|"fail"} on the
#               last line (or anywhere extractable with the last-JSON heuristic).
#
#               TRUST NOTE (internal tool): --panel-cmd value executes as shell
#               via eval.  Callers must treat this as a trusted-caller interface
#               — only pass panel-cmd values from the same trust boundary as
#               this script.
#
# DATA DIR: ~/.autopilot/calibration/ (seam: CALIBRATION_DATA_DIR env override)
#
# EXIT CODES:
#   0  success
#   1  usage / validation error
#   2  data store write failure
#
set -uo pipefail

# ── Graduation criteria (DATA — locally calibratable) ────────────────────────
# To recalibrate: change the values here. The script reads these at report time.
# Each criterion is annotated calibrate-me.
GRAD_MIN_SAMPLES=50          # calibrate-me: minimum sample count for graduation
GRAD_MIN_AGREEMENT="0.80"    # calibrate-me: minimum agreement rate (0.0–1.0)
GRAD_H1_REPLAY_DONE=0        # calibrate-me: set to 1 after H1 replay experiment completes
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${CALIBRATION_DATA_DIR:-$HOME/.autopilot/calibration}"
SAMPLES_FILE="$DATA_DIR/samples.jsonl"
KNOWN_BAD_DIR="$REPO_ROOT/evals/known-bad"

usage() {
  cat <<'EOF'
calibration.sh — QC panel verdict calibration store

SUBCOMMANDS:

  add-sample  --panel-verdict <pass|fail>
              --authoritative-verdict <pass|fail>
              [--baseline <self-report|reviewer>]   default: reviewer
              [--outcome <ok|defect-found>]
              [--class <critical|major|minor>]
              [--tokens <n>]
              [--source <id>]

  report      Print JSON calibration report including graduation status.
              Agreement rate and graduation math use only baseline==reviewer
              samples. self_report_sample_count is listed separately.

  run-known-bad --panel-cmd '<cmd>'
              Feed each diff in evals/known-bad/ to the panel command and
              record false-passes.  Panel cmd reads diff on stdin, writes
              JSON containing {"verdict":"pass"|"fail"} to stdout.

              TRUST NOTE: --panel-cmd executes as shell via eval.  This is
              an internal tool; panel-cmd must come from the same trust
              boundary as this script.

EXIT CODES:
  0  success
  1  usage / validation error
  2  data store write failure

ENV:
  CALIBRATION_DATA_DIR  Override default ~/.autopilot/calibration/
EOF
}

die() { printf 'calibration.sh: %s\n' "$*" >&2; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────

ensure_data_dir() {
  if ! mkdir -p "$DATA_DIR" 2>/dev/null; then
    printf 'calibration.sh: cannot create data dir: %s\n' "$DATA_DIR" >&2
    exit 2
  fi
}

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Append one JSON line to samples.jsonl.
# Direct append; atomic for lines < PIPE_BUF (typically 4096 bytes on Linux).
append_sample() {
  local line="$1"
  ensure_data_dir
  printf '%s\n' "$line" >> "$SAMPLES_FILE" 2>/dev/null || {
    printf 'calibration.sh: write to %s failed\n' "$SAMPLES_FILE" >&2
    exit 2
  }
}

# ── add-sample ────────────────────────────────────────────────────────────────

cmd_add_sample() {
  local panel_verdict="" auth_verdict="" baseline="reviewer" outcome="" class="" tokens="" source_id=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --panel-verdict)       panel_verdict="${2:-}";  shift 2 ;;
      --authoritative-verdict) auth_verdict="${2:-}"; shift 2 ;;
      --baseline)            baseline="${2:-}";        shift 2 ;;
      --outcome)             outcome="${2:-}";         shift 2 ;;
      --class)               class="${2:-}";           shift 2 ;;
      --tokens)              tokens="${2:-}";          shift 2 ;;
      --source)              source_id="${2:-}";       shift 2 ;;
      --help|-h)             usage; exit 0 ;;
      *) die "add-sample: unknown argument: $1" ;;
    esac
  done

  [ -n "$panel_verdict" ]  || die "add-sample: --panel-verdict is required"
  [ -n "$auth_verdict" ]   || die "add-sample: --authoritative-verdict is required"

  case "$panel_verdict" in pass|fail) ;; *) die "add-sample: --panel-verdict must be pass or fail" ;; esac
  case "$auth_verdict"  in pass|fail) ;; *) die "add-sample: --authoritative-verdict must be pass or fail" ;; esac
  case "$baseline" in self-report|reviewer) ;; *) die "add-sample: --baseline must be self-report or reviewer" ;; esac

  if [ -n "$outcome" ]; then
    case "$outcome" in ok|defect-found) ;; *) die "add-sample: --outcome must be ok or defect-found" ;; esac
  fi
  if [ -n "$tokens" ]; then
    case "$tokens" in
      ''|*[!0-9]*) die "add-sample: --tokens must be a non-negative integer" ;;
    esac
  fi
  if [ -n "$class" ]; then
    case "$class" in critical|major|minor) ;; *) die "add-sample: --class must be critical|major|minor" ;; esac
  fi

  local ts
  ts="$(now_iso)"
  local agreed="false"
  [ "$panel_verdict" = "$auth_verdict" ] && agreed="true"

  # Build JSON — baseline field is always emitted so the report can filter
  local json
  json="$(printf '{"ts":"%s","panel_verdict":"%s","authoritative_verdict":"%s","agreed":%s,"baseline":"%s"' \
    "$ts" "$panel_verdict" "$auth_verdict" "$agreed" "$baseline")"
  [ -n "$outcome" ]   && json="$json$(printf ',"outcome":"%s"' "$outcome")"
  [ -n "$class" ]     && json="$json$(printf ',"class":"%s"' "$class")"
  [ -n "$tokens" ]    && json="$json$(printf ',"tokens":%s' "$tokens")"
  [ -n "$source_id" ] && json="$json$(printf ',"source":"%s"' "$source_id")"
  json="$json}"

  append_sample "$json"
}

# ── report ─────────────────────────────────────────────────────────────────────

cmd_report() {
  ensure_data_dir

  # Reviewer-baseline counters (used for agreement math + graduation)
  local sample_count=0
  local agreed_count=0
  local false_pass_on_critical=0
  local token_total=0
  # per-class: critical, major, minor (reviewer-baseline only)
  local crit_total=0 crit_agreed=0 crit_false_pass=0
  local maj_total=0  maj_agreed=0  maj_false_pass=0
  local min_total=0  min_agreed=0  min_false_pass=0

  # Self-report-baseline counter (reported separately; excluded from graduation)
  local self_report_count=0

  # Known-bad synthetic counters (subset of reviewer-baseline; broken out so
  # the Board can see agreement-rate composition before graduation)
  local known_bad_count=0
  local known_bad_agreed=0

  if [ -f "$SAMPLES_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "$line" ] && continue

      # Extract fields with grep+sed (no jq dependency)
      local pv av agreed_val cls tok bl
      pv="$(printf '%s' "$line"   | grep -o '"panel_verdict":"[^"]*"'        | cut -d'"' -f4)"
      av="$(printf '%s' "$line"   | grep -o '"authoritative_verdict":"[^"]*"' | cut -d'"' -f4)"
      agreed_val="$(printf '%s' "$line" | grep -o '"agreed":[a-z]*'          | cut -d: -f2)"
      cls="$(printf '%s' "$line"  | grep -o '"class":"[^"]*"'                | cut -d'"' -f4)"
      tok="$(printf '%s' "$line"  | grep -o '"tokens":[0-9]*'                | cut -d: -f2)"
      bl="$(printf '%s' "$line"   | grep -o '"baseline":"[^"]*"'             | cut -d'"' -f4)"

      # Records lacking the baseline field count as reviewer (legacy compat)
      if [ "$bl" = "self-report" ]; then
        self_report_count=$((self_report_count + 1))
        [ -n "$tok" ] && token_total=$((token_total + tok))
        continue
      fi

      # -- Reviewer-baseline record --
      sample_count=$((sample_count + 1))
      [ "$agreed_val" = "true" ] && agreed_count=$((agreed_count + 1))
      [ -n "$tok" ] && token_total=$((token_total + tok))

      # Known-bad synthetic subset breakout (source: "known-bad:<name>")
      local src
      src="$(printf '%s' "$line" | grep -o '"source":"[^"]*"' | cut -d'"' -f4)"
      case "$src" in
        known-bad:*)
          known_bad_count=$((known_bad_count + 1))
          [ "$agreed_val" = "true" ] && known_bad_agreed=$((known_bad_agreed + 1))
          ;;
      esac

      # false-pass-on-critical: panel=pass, authoritative=fail, class=critical
      if [ "$pv" = "pass" ] && [ "$av" = "fail" ] && [ "$cls" = "critical" ]; then
        false_pass_on_critical=$((false_pass_on_critical + 1))
      fi

      case "$cls" in
        critical)
          crit_total=$((crit_total + 1))
          [ "$agreed_val" = "true" ] && crit_agreed=$((crit_agreed + 1))
          [ "$pv" = "pass" ] && [ "$av" = "fail" ] && crit_false_pass=$((crit_false_pass + 1))
          ;;
        major)
          maj_total=$((maj_total + 1))
          [ "$agreed_val" = "true" ] && maj_agreed=$((maj_agreed + 1))
          [ "$pv" = "pass" ] && [ "$av" = "fail" ] && maj_false_pass=$((maj_false_pass + 1))
          ;;
        minor)
          min_total=$((min_total + 1))
          [ "$agreed_val" = "true" ] && min_agreed=$((min_agreed + 1))
          [ "$pv" = "pass" ] && [ "$av" = "fail" ] && min_false_pass=$((min_false_pass + 1))
          ;;
      esac
    done < "$SAMPLES_FILE"
  fi

  # Agreement rate (scaled × 10000 then formatted; bc is optional so use awk)
  local agreement_rate="0.00"
  if [ "$sample_count" -gt 0 ]; then
    agreement_rate="$(awk "BEGIN { printf \"%.4f\", $agreed_count / $sample_count }")"
  fi

  # Known-bad subset rate
  local known_bad_rate="null"
  [ "$known_bad_count" -gt 0 ] && known_bad_rate="$(awk "BEGIN { printf \"%.4f\", $known_bad_agreed / $known_bad_count }")"

  # Per-class breakdown
  local crit_rate="null" maj_rate="null" min_rate="null"
  [ "$crit_total" -gt 0 ] && crit_rate="$(awk "BEGIN { printf \"%.4f\", $crit_agreed / $crit_total }")"
  [ "$maj_total"  -gt 0 ] && maj_rate="$(awk  "BEGIN { printf \"%.4f\", $maj_agreed  / $maj_total  }")"
  [ "$min_total"  -gt 0 ] && min_rate="$(awk  "BEGIN { printf \"%.4f\", $min_agreed  / $min_total  }")"

  # Graduation check (uses reviewer-baseline counts only)
  local grad_met="false"
  local unmet_json="[]"
  local unmet=""

  # Criterion 1: sample count (reviewer-baseline)
  [ "$sample_count" -lt "$GRAD_MIN_SAMPLES" ] && \
    unmet="$unmet,\"need >= $GRAD_MIN_SAMPLES samples (have $sample_count)\""

  # Criterion 2: agreement rate
  local rate_ok
  rate_ok="$(awk "BEGIN { print ($agreement_rate >= $GRAD_MIN_AGREEMENT) ? 1 : 0 }")"
  [ "$rate_ok" = "0" ] && \
    unmet="$unmet,\"need agreement >= $GRAD_MIN_AGREEMENT (have $agreement_rate)\""

  # Criterion 3: false-pass on critical = 0
  [ "$false_pass_on_critical" -gt 0 ] && \
    unmet="$unmet,\"false_pass_on_critical must be 0 (is $false_pass_on_critical)\""

  # Criterion 4: H1 replay done
  [ "$GRAD_H1_REPLAY_DONE" = "0" ] && \
    unmet="$unmet,\"h1_replay_done flag not set (calibrate-me in calibration.sh)\""

  if [ -z "$unmet" ]; then
    grad_met="true"
    unmet_json="[]"
  else
    unmet_json="[${unmet#,}]"
  fi

  local criteria_json
  criteria_json="$(printf '{"min_samples":%d,"min_agreement":%s,"false_pass_on_critical_must_be_zero":true,"h1_replay_done":"%s"}' \
    "$GRAD_MIN_SAMPLES" "$GRAD_MIN_AGREEMENT" "$([ "$GRAD_H1_REPLAY_DONE" = "1" ] && echo true || echo false)")"

  printf '{
  "sample_count": %d,
  "self_report_sample_count": %d,
  "known_bad_sample_count": %d,
  "known_bad_agreement_rate": %s,
  "agreement_rate": %s,
  "false_pass_on_critical": %d,
  "per_class": {
    "critical": {"total": %d, "agreed": %d, "agreement_rate": %s, "false_pass": %d},
    "major":    {"total": %d, "agreed": %d, "agreement_rate": %s, "false_pass": %d},
    "minor":    {"total": %d, "agreed": %d, "agreement_rate": %s, "false_pass": %d}
  },
  "cumulative_token_estimate": %d,
  "graduation": {
    "criteria": %s,
    "met": %s,
    "unmet_reasons": %s
  }
}
' \
    "$sample_count" "$self_report_count" \
    "$known_bad_count" "$known_bad_rate" "$agreement_rate" \
    "$false_pass_on_critical" \
    "$crit_total" "$crit_agreed" "$crit_rate" "$crit_false_pass" \
    "$maj_total"  "$maj_agreed"  "$maj_rate"  "$maj_false_pass" \
    "$min_total"  "$min_agreed"  "$min_rate"  "$min_false_pass" \
    "$token_total" \
    "$criteria_json" \
    "$grad_met" \
    "$unmet_json"
}

# ── run-known-bad ──────────────────────────────────────────────────────────────

cmd_run_known_bad() {
  local panel_cmd=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --panel-cmd) panel_cmd="${2:-}"; shift 2 ;;
      --help|-h)   usage; exit 0 ;;
      *) die "run-known-bad: unknown argument: $1" ;;
    esac
  done

  [ -n "$panel_cmd" ] || die "run-known-bad: --panel-cmd is required"
  [ -d "$KNOWN_BAD_DIR" ] || die "run-known-bad: evals/known-bad/ not found at $KNOWN_BAD_DIR"

  local any_diff=0
  local false_passes=0
  local total_run=0

  for diff_file in "$KNOWN_BAD_DIR"/*.diff; do
    [ -f "$diff_file" ] || continue
    any_diff=1
    local base
    base="$(basename "$diff_file" .diff)"
    local expected_file="$KNOWN_BAD_DIR/$base.expected.json"

    [ -f "$expected_file" ] || { printf 'calibration.sh: run-known-bad: missing sidecar %s\n' "$expected_file" >&2; continue; }

    local expected_class
    expected_class="$(grep -o '"class":"[^"]*"' "$expected_file" | cut -d'"' -f4)"
    [ -n "$expected_class" ] || { printf 'calibration.sh: run-known-bad: cannot parse class from %s\n' "$expected_file" >&2; continue; }

    total_run=$((total_run + 1))

    # Run panel command with diff on stdin; capture stdout
    local panel_out
    panel_out="$(eval "$panel_cmd" < "$diff_file" 2>/dev/null)" || true
    # Extract panel verdict from last JSON object containing "verdict" key
    local panel_verdict
    panel_verdict="$(printf '%s' "$panel_out" | grep -o '"verdict":"[^"]*"' | tail -1 | cut -d'"' -f4)"
    [ -n "$panel_verdict" ] || panel_verdict="fail"  # treat non-parseable as fail (conservative)

    # Authoritative verdict for known-bad: always "fail" (injected defect present)
    local auth_verdict="fail"

    # Record sample
    cmd_add_sample \
      --panel-verdict "$panel_verdict" \
      --authoritative-verdict "$auth_verdict" \
      --outcome "defect-found" \
      --class "$expected_class" \
      --source "known-bad:$base"

    if [ "$panel_verdict" = "pass" ]; then
      false_passes=$((false_passes + 1))
      printf 'calibration.sh: run-known-bad: FALSE PASS on %s (class=%s)\n' "$base" "$expected_class" >&2
    fi
  done

  [ "$any_diff" = "1" ] || die "run-known-bad: no .diff files found in $KNOWN_BAD_DIR"

  printf '{"total_run":%d,"false_passes":%d}\n' "$total_run" "$false_passes"
}

# ── entrypoint ────────────────────────────────────────────────────────────────

SUBCMD="${1:-}"

case "$SUBCMD" in
  add-sample)    shift; cmd_add_sample "$@" ;;
  report)        shift; cmd_report "$@" ;;
  run-known-bad) shift; cmd_run_known_bad "$@" ;;
  --help|-h)     usage; exit 0 ;;
  "")            usage >&2; exit 1 ;;
  *)             die "unknown subcommand: $SUBCMD (try --help)" ;;
esac
