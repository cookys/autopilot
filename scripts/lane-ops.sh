#!/usr/bin/env bash
# lane-ops.sh — e2e lane 日常重複指令封裝腳本（取代手動重複輸入與輪詢迴圈）。
#
# 效率規範：禁止使用 until-grep / sleep 輪詢迴圈（polling loops）；等待任務請一律使用 `lane-ops.sh wait` 或 `fleet watch`。
#
# 子指令（Subcommands）：
#   land <sha> <msg-file> <label>                                    — 封裝 $SCRATCH/par/land.sh 著陸流程並驗證參數
#   dispatch <runner> <endpoint> <model> <branch> <base> <brief> <timeout-min> — 封裝 sg lanegit / env -u AUTOPILOT_TOKEN_SEAT 與 dispatch-hetero.sh 派發及 log 路徑慣例
#   wait <log-file> [pattern]                                        — 以 fleet watch（有 session 時）或單次有界等待取代 until-grep 輪詢
#   audit                                                            — 以 timeout 280 nice -n 10 < /dev/null 執行三項常用稽核並各印一行 PASS/FAIL
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/lane-ops.sh land <sha> <msg-file> <label>
  scripts/lane-ops.sh dispatch <runner> <endpoint> <model> <branch> <base> <brief> <timeout-min>
  scripts/lane-ops.sh wait <log-file> [pattern]
  scripts/lane-ops.sh audit
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

CMD="$1"
shift

case "$CMD" in
  -h|--help)
    usage
    exit 0
    ;;
  land)
    if [[ $# -ne 3 ]]; then
      echo "lane-ops.sh land: expected <sha> <msg-file> <label>" >&2
      exit 2
    fi
    SHA="$1"
    MSG_FILE="$2"
    LABEL="$3"
    if [[ -z "$SHA" || -z "$MSG_FILE" || -z "$LABEL" ]]; then
      echo "lane-ops.sh land: arguments must be non-empty" >&2
      exit 2
    fi
    if [[ ! -f "$MSG_FILE" ]]; then
      echo "lane-ops.sh land: msg-file not found: $MSG_FILE" >&2
      exit 2
    fi
    LAND_SCRIPT="${LANE_OPS_LAND_SCRIPT:-${SCRATCH:-/tmp}/par/land.sh}"
    if [[ ! -e "$LAND_SCRIPT" ]]; then
      echo "lane-ops.sh land: landing script not found: $LAND_SCRIPT" >&2
      exit 1
    fi
    exec bash "$LAND_SCRIPT" "$SHA" "$MSG_FILE" "$LABEL"
    ;;
  dispatch)
    if [[ $# -ne 7 ]]; then
      echo "lane-ops.sh dispatch: expected <runner> <endpoint> <model> <branch> <base> <brief> <timeout-min>" >&2
      exit 2
    fi
    RUNNER="$1"
    ENDPOINT="$2"
    MODEL="$3"
    BRANCH="$4"
    BASE="$5"
    BRIEF="$6"
    TIMEOUT_MIN="$7"
    if [[ -z "$RUNNER" || -z "$ENDPOINT" || -z "$MODEL" || -z "$BRANCH" || -z "$BASE" || -z "$BRIEF" || -z "$TIMEOUT_MIN" ]]; then
      echo "lane-ops.sh dispatch: all 7 arguments must be non-empty" >&2
      exit 2
    fi
    DISPATCH_BIN="${LANE_OPS_DISPATCH_BIN:-$SCRIPT_DIR/dispatch-hetero.sh}"
    LOG_DIR="${LANE_OPS_LOG_DIR:-${TMPDIR:-/tmp}}"
    SAFE_BRANCH="${BRANCH//\//_}"
    LOG_FILE="$LOG_DIR/lane-ops-dispatch-${SAFE_BRANCH}.log"
    DISPATCH_CMD=(
      env -u AUTOPILOT_TOKEN_SEAT
      bash "$DISPATCH_BIN"
      --runner "$RUNNER"
      --endpoint "$ENDPOINT"
      --model "$MODEL"
      --branch "$BRANCH"
      --base "$BASE"
      --prompt-file "$BRIEF"
      --timeout-min "$TIMEOUT_MIN"
    )
    if command -v sg >/dev/null 2>&1 && [[ "${LANE_OPS_USE_SG:-1}" != "0" ]]; then
      printf -v QUOTED_CMD '%q ' "${DISPATCH_CMD[@]}"
      exec sg lanegit -c "$QUOTED_CMD > $(printf '%q' "$LOG_FILE") 2>&1"
    else
      exec "${DISPATCH_CMD[@]}" > "$LOG_FILE" 2>&1
    fi
    ;;
  wait)
    if [[ $# -lt 1 || $# -gt 2 ]]; then
      echo "lane-ops.sh wait: expected <log-file> [pattern]" >&2
      exit 2
    fi
    LOG_FILE="$1"
    PATTERN="${2:-}"
    if [[ -z "$LOG_FILE" ]]; then
      echo "lane-ops.sh wait: log-file must be non-empty" >&2
      exit 2
    fi
    FLEET_CMD="${FLEET_BIN:-fleet}"
    if command -v "$FLEET_CMD" >/dev/null 2>&1 && [[ -n "${FLEET_SESSION:-${AUTOPILOT_SESSION:-}}" || -n "${LANE_OPS_FORCE_FLEET:-}" ]]; then
      if [[ -n "$PATTERN" ]]; then
        exec "$FLEET_CMD" watch --file "$LOG_FILE" --pattern "$PATTERN"
      else
        exec "$FLEET_CMD" watch --file "$LOG_FILE"
      fi
    fi
    # Fallback when no fleet session context is available: single bounded wait (never a polling loop).
    BOUNDED_SECS="${LANE_OPS_WAIT_SECONDS:-5}"
    sleep "$BOUNDED_SECS"
    if [[ -n "$PATTERN" ]]; then
      if [[ -f "$LOG_FILE" ]] && grep -qE "$PATTERN" "$LOG_FILE"; then
        exit 0
      fi
      exit 1
    fi
    [[ -f "$LOG_FILE" ]]
    ;;
  audit)
    if [[ $# -ne 0 ]]; then
      echo "lane-ops.sh audit: takes no arguments" >&2
      exit 2
    fi
    AUDIT_DIR="${LANE_OPS_AUDIT_DIR:-$REPO_ROOT/hooks/tests}"
    AUDITS=(
      "check-claude-md-inventory.test.sh"
      "test-suite-finalize-gate.test.sh"
      "check-config-docs.test.sh"
    )
    RC=0
    for TEST_NAME in "${AUDITS[@]}"; do
      TEST_PATH="$AUDIT_DIR/$TEST_NAME"
      if timeout 280 nice -n 10 bash "$TEST_PATH" < /dev/null >/dev/null 2>&1; then
        echo "PASS $TEST_NAME"
      else
        echo "FAIL $TEST_NAME"
        RC=1
      fi
    done
    exit "$RC"
    ;;
  *)
    echo "lane-ops.sh: unknown subcommand: $CMD" >&2
    usage >&2
    exit 2
    ;;
esac
