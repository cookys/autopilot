#!/usr/bin/env bash
# engine-qualify — Stage-1 reviewer qualification harness.
#
# Runs calibration over a corpus with the existing
# scripts/calibration.sh run-known-bad harness and emits a verdict object.
# Optional --emit-row emits an engine-scorecard.js-compatible row.
#
# Exit codes:
#   0 = qualification passed
#   1 = qualified=false (or run failed)
#   2 = usage/precondition error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CALIBRATION_SRC="$SCRIPT_DIR/calibration.sh"
DEFAULT_CORPUS="$REPO_ROOT/evals/known-bad"

usage() {
  cat <<'USAGE'
Usage:
  scripts/engine-qualify.sh reviewer --engine <id> --runner <name> --family <family> --panel-cmd '<cmd>' [--corpus <path>] [--emit-row]

Subcommand:
  reviewer

Exit codes:
  0 = qualification passed
  1 = qualification failed
  2 = usage/precondition error
USAGE
}

die_usage() {
  usage
  exit 2
}

die() {
  printf '%s\n' "$1"
  usage
  exit 2
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'
}

extract_field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

require_arg() {
  local opt="$1"
  local count="$2"
  if [ "$count" -lt 2 ]; then
    die "missing value for $opt"
  fi
}

action_reason() {
  if [ -z "$REASON" ]; then
    REASON="$1"
  else
    REASON="$REASON; $1"
  fi
}

now_date() {
  date -u +%Y-%m-%d
}

add_days_iso() {
  local plus_days="$1"
  if out="$(date -u -d "+${plus_days} days" +%Y-%m-%d 2>/dev/null)"; then
    printf '%s' "$out"
    return 0
  fi
  if out="$(date -u -v +${plus_days}d +%Y-%m-%d 2>/dev/null)"; then
    printf '%s' "$out"
    return 0
  fi
  printf '%s' '2099-01-01'
}

SUBCMD="${1:-}"
if [ -z "$SUBCMD" ]; then
  die_usage
fi

case "$SUBCMD" in
  -h|--help)
    usage
    exit 0
    ;;
  reviewer)
    ;;
  *)
    die "unknown subcommand: $SUBCMD"
    ;;
esac

shift

ENGINE=""
RUNNER=""
FAMILY=""
PANEL_CMD=""
CORPUS="$DEFAULT_CORPUS"
EMIT_ROW=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engine)
      require_arg "$1" "$#"
      ENGINE="${2:-}"
      shift 2
      ;;
    --runner)
      require_arg "$1" "$#"
      RUNNER="${2:-}"
      shift 2
      ;;
    --family)
      require_arg "$1" "$#"
      FAMILY="${2:-}"
      shift 2
      ;;
    --panel-cmd)
      require_arg "$1" "$#"
      PANEL_CMD="${2:-}"
      shift 2
      ;;
    --corpus)
      require_arg "$1" "$#"
      CORPUS="${2:-}"
      shift 2
      ;;
    --emit-row)
      EMIT_ROW=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ -n "$ENGINE" ] || die "--engine is required"
[ -n "$RUNNER" ] || die "--runner is required"
[ -n "$FAMILY" ] || die "--family is required"
[ -n "$PANEL_CMD" ] || die "--panel-cmd is required"

CORPUS_ABS="$CORPUS"
case "$CORPUS" in
  /*) ;;
  *) CORPUS_ABS="$REPO_ROOT/$CORPUS" ;;
esac
if [ ! -d "$CORPUS_ABS" ]; then
  die "--corpus not found: $CORPUS_ABS"
fi

CALIB_DATA_DIR="$(mktemp -d -t engine-qualify-caldata-XXXXXX)"
TMP_ROOT=""
trap 'if [ -n "$TMP_ROOT" ]; then rm -rf "$TMP_ROOT"; fi; rm -rf "$CALIB_DATA_DIR"' EXIT

CALIBRATION_WORK="$REPO_ROOT"
CALIBRATION_SCRIPT="$CALIBRATION_SRC"
if [ "$CORPUS_ABS" != "$DEFAULT_CORPUS" ]; then
  TMP_ROOT="$(mktemp -d -t engine-qualify-cal-XXXXXX)"
  mkdir -p "$TMP_ROOT/scripts" "$TMP_ROOT/evals"
  cp "$CALIBRATION_SRC" "$TMP_ROOT/scripts/calibration.sh"
  chmod +x "$TMP_ROOT/scripts/calibration.sh"
  mkdir -p "$TMP_ROOT/evals/known-bad"
  (cd "$CORPUS_ABS" && cp -R . "$TMP_ROOT/evals/known-bad")
  CALIBRATION_WORK="$TMP_ROOT"
  CALIBRATION_SCRIPT="$TMP_ROOT/scripts/calibration.sh"
fi

RUN_STARTED="$(date +%s)"
RUN_RC=0
RUN_OUT=""
RUN_OUT="$(
  (cd "$CALIBRATION_WORK" && \
    CALIBRATION_DATA_DIR="$CALIB_DATA_DIR" "$CALIBRATION_SCRIPT" run-known-bad --panel-cmd "$PANEL_CMD")
)" || RUN_RC=$?
RUN_ENDED="$(date +%s)"

RUN_SAMPLES="$CALIB_DATA_DIR/samples.jsonl"
REASON=""
QUALIFIED=0

if [ "$RUN_RC" -ne 0 ]; then
  action_reason "calibration harness failed with exit=$RUN_RC"
fi
if [ ! -f "$RUN_SAMPLES" ]; then
  action_reason "calibration samples missing"
fi

TOTAL_COUNT=0
CATCH_COUNT=0
FALSE_PASS_CRITICAL=0
CLEAN_COUNT=0
CLEAN_FALSE_FIX=0
CRIT_COUNT=0
CRIT_CATCH=0

if [ -f "$RUN_SAMPLES" ]; then
  while IFS= read -r sample_line || [ -n "$sample_line" ]; do
    [ -z "$sample_line" ] && continue

    PANEL_VERDICT="$(extract_field "$sample_line" panel_verdict)"
    AUTH_VERDICT="$(extract_field "$sample_line" authoritative_verdict)"
    CLASS="$(extract_field "$sample_line" class)"

    [ -n "$PANEL_VERDICT" ] || continue
    [ -n "$AUTH_VERDICT" ] || continue

    TOTAL_COUNT=$((TOTAL_COUNT + 1))

    if [ "$PANEL_VERDICT" = "fail" ]; then
      CATCH_COUNT=$((CATCH_COUNT + 1))
    fi

    if [ "$AUTH_VERDICT" = "pass" ]; then
      CLEAN_COUNT=$((CLEAN_COUNT + 1))
      if [ "$PANEL_VERDICT" = "fail" ]; then
        CLEAN_FALSE_FIX=$((CLEAN_FALSE_FIX + 1))
      fi
    fi

    if [ "$AUTH_VERDICT" = "fail" ] && [ "$CLASS" = "critical" ]; then
      CRIT_COUNT=$((CRIT_COUNT + 1))
      if [ "$PANEL_VERDICT" = "fail" ]; then
        CRIT_CATCH=$((CRIT_CATCH + 1))
      fi
      if [ "$PANEL_VERDICT" = "pass" ]; then
        FALSE_PASS_CRITICAL=$((FALSE_PASS_CRITICAL + 1))
      fi
    fi
  done < "$RUN_SAMPLES"
fi

if [ "$TOTAL_COUNT" -eq 0 ]; then
  action_reason "no calibration samples were counted"
fi

if [ "$TOTAL_COUNT" -gt 0 ]; then
  SENSITIVITY_RATIO="$(awk "BEGIN { printf \"%.6f\", $CATCH_COUNT / $TOTAL_COUNT }")"
  SENSITIVITY_OK=0
  if awk "BEGIN { print ($CATCH_COUNT / $TOTAL_COUNT >= 0.9 ? 1 : 0) }" | grep -q '^1$'; then
    SENSITIVITY_OK=1
  fi
else
  SENSITIVITY_RATIO="0.000000"
  SENSITIVITY_OK=0
fi

CRITICAL_RATIO="0.000000"
if [ "$CRIT_COUNT" -gt 0 ]; then
  CRITICAL_RATIO="$(awk "BEGIN { printf \"%.6f\", $CRIT_CATCH / $CRIT_COUNT }")"
fi

SPECIFICITY_OK=1
if [ "$CLEAN_COUNT" -gt 0 ] && [ "$CLEAN_FALSE_FIX" -gt 0 ]; then
  SPECIFICITY_OK=0
fi

if [ "$FALSE_PASS_CRITICAL" -gt 0 ]; then
  action_reason "false_pass_on_critical=$FALSE_PASS_CRITICAL"
fi
if [ "$TOTAL_COUNT" -lt 10 ]; then
  action_reason "insufficient corpus size (total=$TOTAL_COUNT)"
fi
if [ "$CATCH_COUNT" -lt 9 ]; then
  action_reason "insufficient absolute sensitivity (caught=$CATCH_COUNT)"
fi
if [ "$SENSITIVITY_OK" -ne 1 ]; then
  action_reason "sensitivity below threshold (ratio=$SENSITIVITY_RATIO)"
fi
if [ "$SPECIFICITY_OK" -ne 1 ]; then
  action_reason "specificity failed on clean diffs ($CLEAN_FALSE_FIX/$CLEAN_COUNT clean false FIX)"
fi

if [ -z "$REASON" ] && [ "$RUN_RC" -eq 0 ] && [ "$FALSE_PASS_CRITICAL" -eq 0 ] && [ "$CLEAN_FALSE_FIX" -eq 0 ] \
   && [ "$TOTAL_COUNT" -ge 10 ] && [ "$CATCH_COUNT" -ge 9 ] && [ "$SENSITIVITY_OK" -eq 1 ]; then
  QUALIFIED=1
  REASON="passed"
else
  [ -n "$REASON" ] || REASON="qualification failed"
fi

if [ "$QUALIFIED" -eq 1 ]; then
  QUALIFIED_BOOL=true
  ROW_STATUS="qualified"
else
  QUALIFIED_BOOL=false
  ROW_STATUS="failed"
fi

if [ "$CORPUS_ABS" = "$DEFAULT_CORPUS" ]; then
  CORPUS_VERSION="known-bad@v1"
else
  CORPUS_VERSION="$(basename "$CORPUS_ABS")@v1"
fi

QUAL_DATE="$(now_date)"
EXPIRES_DATE="$(add_days_iso 90)"
SAMPLE_WALL_TIME=$((RUN_ENDED - RUN_STARTED))

QUALITY_JSON="{\"corpus_pass\":\"${CATCH_COUNT}/${TOTAL_COUNT}\",\"false_pass_critical\":${FALSE_PASS_CRITICAL},\"specificity\":\"${CLEAN_FALSE_FIX}/${CLEAN_COUNT}\"}"
METRICS_JSON="{\"sensitivity_ratio\":${SENSITIVITY_RATIO},\"sensitivity\":\"${CATCH_COUNT}/${TOTAL_COUNT}\",\"false_pass_on_critical\":${FALSE_PASS_CRITICAL},\"specificity\":\"${CLEAN_FALSE_FIX}/${CLEAN_COUNT}\"}"

VERDICT_JSON="{\"engine\":\"$(json_escape "$ENGINE")\",\"runner\":\"$(json_escape "$RUNNER")\",\"role\":\"reviewer\",\"qualified\":${QUALIFIED_BOOL},\"metrics\":${METRICS_JSON},\"reason\":\"$(json_escape "$REASON")\"}"

ROW_JSON="{\"engine\":\"$(json_escape "$ENGINE")\",\"runner\":\"$(json_escape "$RUNNER")\",\"family\":\"$(json_escape "$FAMILY")\",\"role\":\"reviewer\",\"model_version\":\"unknown\",\"version_source\":\"manual\",\"corpus_version\":\"$(json_escape "$CORPUS_VERSION")\",\"harness_version\":\"engine-qualify@1.0.0\",\"runner_version\":\"unknown\",\"prompt_config_hash\":\"sha256:reviewer:v1\",\"date\":\"$QUAL_DATE\",\"quality\":$QUALITY_JSON,\"capability_score\":${CRITICAL_RATIO},\"cost\":{\"source\":\"unknown\",\"usd_per_mtok_input\":0,\"usd_per_mtok_output\":0,\"sample_tokens\":0},\"latency\":{\"sample_wall_time_s\":${SAMPLE_WALL_TIME}},\"status\":\"$ROW_STATUS\",\"qualified_at\":\"$QUAL_DATE\",\"expires\":\"$EXPIRES_DATE\"}"

if [ "$EMIT_ROW" -eq 1 ]; then
  printf '%s\n' "$ROW_JSON"
else
  printf '%s\n' "$VERDICT_JSON"
fi

if [ "$EMIT_ROW" -eq 1 ]; then
  printf '%s\n' "$VERDICT_JSON" >&2
fi

if [ "$QUALIFIED" -eq 1 ]; then
  exit 0
fi
exit 1
