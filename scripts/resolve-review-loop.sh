#!/usr/bin/env bash
# resolve-review-loop.sh — resolve the per-project review-loop engine roster + loop
# policy → JSON. Turns the hand-typed "/l5 generation-adversarial heterogeneous"
# prompt into DATA consumed by /l5 (ceo-agent level-front-door). Sibling of
# resolve-qc-gate.sh / resolve-doa.sh — same precedence chain.
#
# Usage:
#   scripts/resolve-review-loop.sh                 # emit resolved config JSON
#   scripts/resolve-review-loop.sh --field reviewer_engine   # one raw field (for shell)
#   scripts/resolve-review-loop.sh --check-scorecard --scorecard-scope-file <scope.json>
#     --scorecard-identity-file <identity.json>   # exact evidence-required gate
#   Risk inputs (optional): --source-trust high|low --diff-lines N --protected-path 0|1
#     --oracle-available 0|1 --security-surface 0|1  (drive deterministic review_risk)
#   --check-scorecard  # include scorecard gate signal in output (opt-in, no extra keys by default)
#   --scale-by-capability  # config: density_scaling (on|off). Scale verification density by capability tier and risk. Low/unknown fail-closed upward; high-tier/low-risk caps cheap rounds and emits verify_first.
#   --enforce  # OPT-IN hard gate: exit 3 (still emits JSON/field) when the policy says BLOCK
#              # — a high-risk change whose required cross-family decorrelation is unsatisfied
#              # (e.g. "panel spans 1 distinct famil(y/ies), 2 required").
#              # Default (no --enforce) stays exit-0 data mode like resolve-doa/resolve-qc-gate;
#              # the resolver REPORTS, the caller (depth-0 loop / pre-push) ENFORCES.
#
# Order of precedence (first existing file wins):
#   1. $REVIEW_LOOP_CONFIG_OVERRIDE
#   2. $PWD/.claude/review-loop-config.md          (consuming project's cwd)
#   3. $REPO_ROOT/.claude/review-loop-config.md    (autopilot's own repo, dogfood)
#   4. project-config-template/review-loop-config.md  (shipped default)
#   5. Built-in defaults below
#
# Output: JSON — the authoritative field set lives in schemas/review-loop-contract.schema.json
#   (SSOT; drift-gated by scripts/check-contract-schema.js). Core roster fields:
#   reviewer_* / implementer_* / verification_author_* seats, loop policy
#   (loop_max_rounds, loop_convergence_verdict, spec_review, independent_harness),
#   qc_panel(+aggregation, min_panel_size), risk tier (review_risk, required_review_families,
#   l1_required, cross_family_*), endpoints, fallback ladder + preferences, telemetry
#   (work_domain, domain_source, capability_state_source, quota_*), source / config_path.
# (qc_panel = disjoint-family terminal gate; warns on stderr if the panel shares the
#  implementer family. qc_panel_aggregation: union-on-verified-critical; majority forbidden.
#  review_diff_scope: how much the per-round reviewer reads — full | incremental-mitigated.)
#
# Exit codes: 0 success / 2 usage / 3 invalid or inconsistent config.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Built-in defaults (the user's stated good-loop roster; agy is NOT the default
# implementer because it corrupts the autopilot repo — see config gotchas).
DEF_REV_ENGINE="gpt-5.5"
DEF_REV_EFFORT="xhigh"
DEF_REV_RUNNER="codex"
DEF_IMPL_ENGINE="gpt-5.3-codex-spark"
DEF_IMPL_EFFORT="high"
DEF_IMPL_RUNNER="auto"
DEF_REV_ENDPOINT=""
DEF_IMPL_ENDPOINT=""
DEF_VER_AUTHOR_PRESENT="false"
DEF_VER_AUTHOR_ENGINE=""
DEF_VER_AUTHOR_RUNNER=""
DEF_VER_AUTHOR_EFFORT=""
DEF_VER_AUTHOR_ENDPOINT=""
DEF_REV_ENGINE_LOW_RISK=""   # risk-tiered overlay: empty = tiering OFF (loop reviewer = reviewer_engine at every risk)
DEF_REV_EFFORT_LOW_RISK=""
DEF_MAX_ROUNDS="5"
DEF_CONVERGE="SHIP-AS-IS"
DEF_SPEC_REVIEW="on"
DEF_PLAN_REVIEW="off"
DEF_PLAN_MAX_GENERATIONS="2"
DEF_PLAN_MAX_WALL_SECONDS="7200"
DEF_PLAN_GROWTH_WARN_RATIO="1.25"
DEF_PLAN_GROWTH_STOP_RATIO="1.50"
DEF_HARNESS="on"
# Terminal depth-0 qc panel (v2.25.9): a DISJOINT-FAMILY panel, not a single reviewer.
# Default spans OpenAI / Anthropic / Google so ≥1 family differs from any implementer.
DEF_QC_PANEL="gpt-5.5, claude-opus, gemini-flash"
DEF_QC_PANEL_RUNNERS="codex, claude-native, agy"
DEF_QC_PANEL_EFFORTS="xhigh, high, high"
DEF_QC_PANEL_ENDPOINTS="@none, @none, @none"
# Engines with recorded reviewer calibration/spike evidence (qc_panel: all-calibrated roster)
QC_ALL_CALIBRATED="gpt-5.5, claude-opus, gemini-flash, grok-4.5, MiniMax-M3"
DEF_QC_AGG="union-on-verified-critical"
DEF_PROVIDER_READINESS_RECEIPT_TTL_SECONDS="300"
DEF_PROVIDER_READINESS_FAMILY_CONSTRAINT="different"
# review_diff_scope: how much the per-round reviewer reads.
#   full                  — re-read the whole base..HEAD diff every round (safe; cost
#                           grows O(n) with the accumulating diff). DEFAULT.
#   incremental-mitigated — read prev-round..HEAD, but ALSO re-read the full content of
#                           files touched this round + a standing invariants list, do a
#                           full re-read every few rounds / on critical-path touches, and
#                           ALWAYS a final full base..HEAD review before merge. Cheaper on
#                           long loops; only safe WITH those mitigations (naive
#                           incremental-only misses cross-file regressions). Architect-
#                           reviewed 2026-06-26; pairs with independent_harness running the
#                           FULL suite, not just touched-file tests.
DEF_DIFF_SCOPE="full"
DEF_MIN_PANEL_SIZE="3"
DEF_ON_ENGINE_UNAVAILABLE="ask"
# in-loop reviewer family-conflict policy (engine reviewDiff): fallback = walk the
# cross-family qualified scorecard ladder; block = hard-block (pre-v2.32.25 behavior).
# Garbage → block (fail-closed: the engine treats anything but "fallback" as block).
DEF_ON_FAMILY_CONFLICT="fallback"

FIELD=""
SOURCE_TRUST=""
CONFIG_PATH=""
DIFF_LINES=0
PROTECTED_PATH=0
ORACLE_AVAILABLE=1
SECURITY_SURFACE=0
ENFORCE=0
CHECK_SCORECARD=0
SCORECARD_SCOPE_FILE=""
SCORECARD_IDENTITY_FILE=""
SCALE_BY_CAPABILITY=0
DWORK_DOMAIN="mixed"
DOMAIN_SOURCE="none"
AUTO_DOMAIN=0
AUTO_RANGE="changed"
CAPABILITY_STATE=""
# Optional: bytes of input the caller intends to feed the resolved seats. When set, the
# resolver reports (never silently rewrites) a seat whose context window cannot hold it.
INPUT_BYTES=0
STORE_PATH=""
NOW_VAL=""
SKILL_MODE_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:-}"; shift 2 ;;
    --source-trust) SOURCE_TRUST="${2:-}"; shift 2 ;;
    --diff-lines) DIFF_LINES="${2:-}"; shift 2 ;;
    --protected-path) PROTECTED_PATH="${2:-}"; shift 2 ;;
    --oracle-available) ORACLE_AVAILABLE="${2:-}"; shift 2 ;;
    --security-surface) SECURITY_SURFACE="${2:-}"; shift 2 ;;
    --capability-state) CAPABILITY_STATE="${2:-}"; shift 2 ;;
    --input-bytes) INPUT_BYTES="${2:-0}"; shift 2 ;;
    --store) STORE_PATH="${2:-}"; shift 2 ;;
    --now) NOW_VAL="${2:-}"; shift 2 ;;
    --skill-mode) SKILL_MODE_OVERRIDE="${2:-}"; shift 2 ;;
    --domain)
      DOMAIN_OVERRIDE="${2:-}"
      case "$DOMAIN_OVERRIDE" in
        rust|backend-cli|frontend|docs|mixed) : ;;
        *) echo "invalid --domain: $DOMAIN_OVERRIDE" >&2; exit 2 ;;
      esac
      DWORK_DOMAIN="$DOMAIN_OVERRIDE"
      DOMAIN_SOURCE="explicit"
      shift 2
      ;;
    --auto-domain)
      AUTO_DOMAIN=1
      shift
      if [[ "${1:-}" != --* && "${1:-}" != "" && ( "$1" == *..* || "$1" == *...* ) ]]; then
        AUTO_RANGE="$1"
        shift
      else
        AUTO_RANGE="changed"
      fi
      ;;
    --check-scorecard) CHECK_SCORECARD=1; shift ;;
    --scorecard-scope-file) SCORECARD_SCOPE_FILE="${2:-}"; shift 2 ;;
    --scorecard-identity-file) SCORECARD_IDENTITY_FILE="${2:-}"; shift 2 ;;
    --enforce) ENFORCE=1; shift ;;
    --scale-by-capability) SCALE_BY_CAPABILITY=1; shift ;;
    -h|--help) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"
# shellcheck source=lib/resolve-config.sh
. "$(dirname "$0")/lib/resolve-config.sh"

# --- locate the config file (4-tier -r ladder) ---
resolve_config_ladder "review-loop-config.md" "REVIEW_LOOP_CONFIG_OVERRIDE" "builtin-default"

# A missing runner key may use the built-in default. An explicitly configured
# runner (including an empty value) is an operator decision and must never be
# rewritten to a different transport. Keep this stricter extraction local to
# runner fields so legacy fallback semantics for other fields remain unchanged.
config_has_field() {
  local config_path="$1" key="$2"
  [[ -n "$config_path" && -r "$config_path" ]] || return 1
  grep -qiE "^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:" "$config_path"
}

read_explicit_field() {
  local config_path="$1" key="$2"
  grep -iE "^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:" "$config_path" 2>/dev/null \
    | head -1 \
    | sed -E "s/^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:[[:space:]]*//I" \
    | sed -E 's/[[:space:]]+$//'
}

REV_ENGINE="$(read_field "$CONFIG" reviewer_engine "$DEF_REV_ENGINE")"
REV_EFFORT="$(read_field "$CONFIG" reviewer_effort "$DEF_REV_EFFORT")"
if config_has_field "$CONFIG" reviewer_runner; then
  REV_RUNNER="$(read_explicit_field "$CONFIG" reviewer_runner)"
else
  REV_RUNNER="$DEF_REV_RUNNER"
fi
IMPL_ENGINE="$(read_field "$CONFIG" implementer_engine "$DEF_IMPL_ENGINE")"
IMPL_EFFORT="$(read_field "$CONFIG" implementer_effort "$DEF_IMPL_EFFORT")"
if config_has_field "$CONFIG" implementer_runner; then
  IMPL_RUNNER="$(read_explicit_field "$CONFIG" implementer_runner)"
else
  IMPL_RUNNER="$DEF_IMPL_RUNNER"
fi
REV_ENDPOINT="$(read_field "$CONFIG" reviewer_endpoint "$DEF_REV_ENDPOINT")"
REV_LIMITATION="$(read_field "$CONFIG" reviewer_limitation "")"
IMPL_ENDPOINT="$(read_field "$CONFIG" implementer_endpoint "$DEF_IMPL_ENDPOINT")"
VER_AUTH_PRESENT="$(read_field "$CONFIG" verification_author_present "$DEF_VER_AUTHOR_PRESENT")"
VER_AUTH_ENGINE="$(read_field "$CONFIG" verification_author_engine "$DEF_VER_AUTHOR_ENGINE")"
VER_AUTH_RUNNER="$(read_field "$CONFIG" verification_author_runner "$DEF_VER_AUTHOR_RUNNER")"
VER_AUTH_EFFORT="$(read_field "$CONFIG" verification_author_effort "$DEF_VER_AUTHOR_EFFORT")"
VER_AUTH_ENDPOINT="$(read_field "$CONFIG" verification_author_endpoint "$DEF_VER_AUTHOR_ENDPOINT")"
# Endpoint names feed dispatch-*.sh --endpoint (→ resolve-endpoint.sh env-var suffix); allow
# [A-Za-z0-9_] only (empty = none). A bad value → "" so it can't inject into the --endpoint
# arg or the emitted JSON (same fail-closed stance as resolve-endpoint.sh's NAME_RE).
[[ -z "$REV_ENDPOINT"  || "$REV_ENDPOINT"  =~ ^[A-Za-z0-9_]+$ ]] || { echo "resolve-review-loop: ignoring invalid reviewer_endpoint (must be [A-Za-z0-9_]): $REV_ENDPOINT" >&2; REV_ENDPOINT=""; }
[[ -z "$IMPL_ENDPOINT" || "$IMPL_ENDPOINT" =~ ^[A-Za-z0-9_]+$ ]] || { echo "resolve-review-loop: ignoring invalid implementer_endpoint (must be [A-Za-z0-9_]): $IMPL_ENDPOINT" >&2; IMPL_ENDPOINT=""; }
[[ -z "$VER_AUTH_ENDPOINT" || "$VER_AUTH_ENDPOINT" =~ ^[A-Za-z0-9_]+$ ]] || { echo "resolve-review-loop: invalid verification_author_endpoint (must be [A-Za-z0-9_]): $VER_AUTH_ENDPOINT" >&2; exit 3; }
# The exact MiniMax diff-only tuple has a recorded false-central-claim limitation.
# Keep calibration telemetry out of capability_warnings: that array is an operational
# dispatch channel. A diagnostic makes every exact-seat resolution non-silent, and
# the exact tuple unconditionally requires the limitation tag. The legacy
# reviewer_limitation_required field is compatibility metadata, never guard authority.
if [[ "$REV_ENGINE" == "MiniMax-M3" && "$REV_RUNNER" == "cc-shim" && "$REV_ENDPOINT" == "minimax" ]]; then
  echo "resolve-review-loop: ADVISORY — MiniMax-M3 diff-only reviewer limitation: 5/6 recorded central claims were false; findings require independent verification." >&2
  if [[ "$REV_LIMITATION" != "minimax-false-central-claim-5-of-6" ]]; then
    echo "resolve-review-loop: MiniMax-M3 cc-shim/minimax reviewer requires reviewer_limitation=minimax-false-central-claim-5-of-6" >&2
    exit 3
  fi
fi
case "$VER_AUTH_PRESENT" in
  true|false) ;;
  *)
    echo "resolve-review-loop: invalid verification_author_present (must be true|false): $VER_AUTH_PRESENT" >&2
    exit 3
    ;;
esac
if [[ "$VER_AUTH_PRESENT" == "false" ]]; then
  if [[ -n "$VER_AUTH_ENGINE" || -n "$VER_AUTH_RUNNER" || -n "$VER_AUTH_EFFORT" || -n "$VER_AUTH_ENDPOINT" ]]; then
    echo "resolve-review-loop: inconsistent verification_author tuple: present=false requires all empty values" >&2
    exit 3
  fi
else
  if [[ -z "$VER_AUTH_ENGINE" || -z "$VER_AUTH_RUNNER" || -z "$VER_AUTH_EFFORT" ]]; then
    echo "resolve-review-loop: incomplete verification_author tuple: present=true requires engine, runner, effort" >&2
    exit 3
  fi
  case "$VER_AUTH_RUNNER" in
    codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn) ;;
    *)
      echo "resolve-review-loop: invalid verification_author_runner (must be codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn): $VER_AUTH_RUNNER" >&2
      exit 3
      ;;
  esac
  case "$VER_AUTH_EFFORT" in
    low|medium|high|xhigh|max) ;;
    *)
      echo "resolve-review-loop: invalid verification_author_effort (must be low|medium|high|xhigh|max): $VER_AUTH_EFFORT" >&2
      exit 3
      ;;
  esac
fi
if [[ -n "$CONFIG" ]]; then
  if ! CONFIG_DIR="$(cd "$(dirname -- "$CONFIG")" 2>/dev/null && pwd -P)"; then
    echo "resolve-review-loop: unable to canonicalize config path from CONFIG: $CONFIG" >&2
    exit 3
  fi
  CONFIG_PATH="$CONFIG_DIR/$(basename -- "$CONFIG")"
fi
# Risk-tiered low-risk reviewer overlay (ADDITIVE): when BOTH keys are set the caller
# (/l5 /l6 front-door) uses this pair as the LOOP reviewer for computed review_risk=low;
# high risk always uses reviewer_engine/reviewer_effort. Empty = tiering off (unchanged
# behavior). Garbage effort → "" (tiering off), never a bogus effort value — the
# fail-safe direction is "review with the stronger incumbent", not "skip".
REV_ENGINE_LOW_RISK="$(read_field "$CONFIG" reviewer_engine_low_risk "$DEF_REV_ENGINE_LOW_RISK")"
REV_EFFORT_LOW_RISK="$(read_field "$CONFIG" reviewer_effort_low_risk "$DEF_REV_EFFORT_LOW_RISK")"
case "$REV_EFFORT_LOW_RISK" in
  ''|low|medium|high|xhigh|max) ;;
  *) echo "resolve-review-loop: ignoring invalid reviewer_effort_low_risk (must be low|medium|high|xhigh|max): $REV_EFFORT_LOW_RISK" >&2; REV_EFFORT_LOW_RISK="" ;;
esac
ON_FAMILY_CONFLICT="$(read_field "$CONFIG" on_family_conflict "$DEF_ON_FAMILY_CONFLICT")"
case "$ON_FAMILY_CONFLICT" in
  fallback|block) ;;
  *) echo "resolve-review-loop: invalid on_family_conflict (must be fallback|block): $ON_FAMILY_CONFLICT — using block (fail-closed)" >&2; ON_FAMILY_CONFLICT="block" ;;
esac
# Fallback preference lists (v2.32.26): HUMAN-ordered engine ids consulted by the
# engine's family-conflict fallback BEFORE ladder order (every candidate still
# passes all fallback guards). _low_risk applies when computed review_risk=low
# (empty = use the main list). Empty lists = pure ladder order (unchanged).
csv_to_json_array() { # csv -> compact-ish JSON array (qc_panel style ", " sep)
  local _raw="$1" _out="[" _first=1 _p
  IFS=',' read -ra _parts <<< "$_raw"
  for _p in "${_parts[@]}"; do
    _p="$(printf '%s' "$_p" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$_p" ]] && continue
    [[ $_first -eq 0 ]] && _out+=", "
    _out+="\"$(json_escape "$_p")\""
    _first=0
  done
  _out+="]"
  [[ "$_out" == "[]" || "$_out" == "[" ]] && _out="[]"
  printf '%s' "$_out"
}
REV_FB_PREF_RAW="$(read_field "$CONFIG" reviewer_fallback_preference "")"
REV_FB_PREF_LOW_RAW="$(read_field "$CONFIG" reviewer_fallback_preference_low_risk "")"
REV_FB_PREF_JSON="$(csv_to_json_array "$REV_FB_PREF_RAW")"
REV_FB_PREF_LOW_JSON="$(csv_to_json_array "$REV_FB_PREF_LOW_RAW")"
MAX_ROUNDS="$(read_field "$CONFIG" loop_max_rounds "$DEF_MAX_ROUNDS")"
CONVERGE="$(read_field "$CONFIG" loop_convergence_verdict "$DEF_CONVERGE")"
SPEC_REVIEW="$(read_field "$CONFIG" spec_review "$DEF_SPEC_REVIEW")"
PLAN_REVIEW="$(read_field "$CONFIG" plan_review "$DEF_PLAN_REVIEW")"
PLAN_REV_ENGINE="$(read_field "$CONFIG" plan_reviewer_engine "")"
PLAN_REV_EFFORT="$(read_field "$CONFIG" plan_reviewer_effort "")"
PLAN_REV_RUNNER="$(read_field "$CONFIG" plan_reviewer_runner "")"
PLAN_REV_ENDPOINT="$(read_field "$CONFIG" plan_reviewer_endpoint "")"
PLAN_DEEP_ENGINE="$(read_field "$CONFIG" plan_deep_reviewer_engine "")"
PLAN_DEEP_EFFORT="$(read_field "$CONFIG" plan_deep_reviewer_effort "")"
PLAN_DEEP_RUNNER="$(read_field "$CONFIG" plan_deep_reviewer_runner "")"
PLAN_DEEP_ENDPOINT="$(read_field "$CONFIG" plan_deep_reviewer_endpoint "")"
PLAN_MAX_GENERATIONS="$(read_field "$CONFIG" plan_review_max_generations "$DEF_PLAN_MAX_GENERATIONS")"
PLAN_MAX_WALL_SECONDS="$(read_field "$CONFIG" plan_review_max_wall_seconds "$DEF_PLAN_MAX_WALL_SECONDS")"
PLAN_GROWTH_WARN_RATIO="$(read_field "$CONFIG" plan_review_growth_warn_ratio "$DEF_PLAN_GROWTH_WARN_RATIO")"
PLAN_GROWTH_STOP_RATIO="$(read_field "$CONFIG" plan_review_growth_stop_ratio "$DEF_PLAN_GROWTH_STOP_RATIO")"

case "$PLAN_REVIEW" in on|off) ;; *)
  echo "resolve-review-loop: invalid plan_review (must be on|off): $PLAN_REVIEW" >&2
  exit 3
esac
case "$PLAN_REV_RUNNER" in ''|codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn) ;; *)
  echo "resolve-review-loop: invalid plan_reviewer_runner: $PLAN_REV_RUNNER" >&2
  exit 3
esac
case "$PLAN_DEEP_RUNNER" in ''|codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn) ;; *)
  echo "resolve-review-loop: invalid plan_deep_reviewer_runner: $PLAN_DEEP_RUNNER" >&2
  exit 3
esac
case "$PLAN_REV_EFFORT" in ''|low|medium|high|xhigh|max) ;; *)
  echo "resolve-review-loop: invalid plan_reviewer_effort: $PLAN_REV_EFFORT" >&2
  exit 3
esac
case "$PLAN_DEEP_EFFORT" in ''|low|medium|high|xhigh|max) ;; *)
  echo "resolve-review-loop: invalid plan_deep_reviewer_effort: $PLAN_DEEP_EFFORT" >&2
  exit 3
esac
[[ -z "$PLAN_REV_ENDPOINT" || "$PLAN_REV_ENDPOINT" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "resolve-review-loop: invalid plan_reviewer_endpoint: $PLAN_REV_ENDPOINT" >&2
  exit 3
}
[[ -z "$PLAN_DEEP_ENDPOINT" || "$PLAN_DEEP_ENDPOINT" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "resolve-review-loop: invalid plan_deep_reviewer_endpoint: $PLAN_DEEP_ENDPOINT" >&2
  exit 3
}
if [[ "$PLAN_REVIEW" == "on" && ( -z "$PLAN_REV_ENGINE" || -z "$PLAN_REV_RUNNER" || -z "$PLAN_REV_EFFORT" ) ]]; then
  echo "resolve-review-loop: plan_review=on requires plan_reviewer_engine, plan_reviewer_runner, and plan_reviewer_effort" >&2
  exit 3
fi
if [[ -n "$PLAN_DEEP_ENGINE" || -n "$PLAN_DEEP_RUNNER" || -n "$PLAN_DEEP_EFFORT" || -n "$PLAN_DEEP_ENDPOINT" ]]; then
  if [[ -z "$PLAN_DEEP_ENGINE" || -z "$PLAN_DEEP_RUNNER" || -z "$PLAN_DEEP_EFFORT" ]]; then
    echo "resolve-review-loop: plan_deep_reviewer tuple must be wholly empty or include engine, runner, and effort" >&2
    exit 3
  fi
fi
if ! { [[ "$PLAN_MAX_GENERATIONS" =~ ^[0-9]+$ ]] && [[ "$PLAN_MAX_GENERATIONS" -ge 1 ]] && [[ "$PLAN_MAX_GENERATIONS" -le 2 ]]; }; then
  echo "resolve-review-loop: plan_review_max_generations must be 1 or 2" >&2
  exit 3
fi
if ! { [[ "$PLAN_MAX_WALL_SECONDS" =~ ^[0-9]+$ ]] && [[ "$PLAN_MAX_WALL_SECONDS" -ge 1 ]] && [[ "$PLAN_MAX_WALL_SECONDS" -le 7200 ]]; }; then
  echo "resolve-review-loop: plan_review_max_wall_seconds must be 1..7200" >&2
  exit 3
fi
if ! node -e '
const warn = Number(process.argv[1]);
const stop = Number(process.argv[2]);
process.exit(Number.isFinite(warn) && Number.isFinite(stop) && warn > 0 && warn <= 1.25 && stop > warn && stop <= 1.5 ? 0 : 1);
' "$PLAN_GROWTH_WARN_RATIO" "$PLAN_GROWTH_STOP_RATIO"; then
  echo "resolve-review-loop: plan growth ratios must satisfy 0 < warn <= 1.25 < stop <= 1.50" >&2
  exit 3
fi
SKILL_MODE_REQ="$(read_field "$CONFIG" skill_mode "")"
if [[ -n "${SKILL_MODE_OVERRIDE:-}" ]]; then
  SKILL_MODE_REQ="$SKILL_MODE_OVERRIDE"
fi
[[ -z "$SKILL_MODE_REQ" ]] && SKILL_MODE_REQ="off"
# Enum-validate (config or override could carry arbitrary text, incl. quotes that would break
# the emitted JSON — gpt-5.5 batch3 review). Unknown → safe-default "off", same as other enums.
case "$SKILL_MODE_REQ" in
  off|prompt|native|auto) ;;
  *) SKILL_MODE_REQ="off" ;;
esac

if [[ -z "$CAPABILITY_STATE" ]]; then
  CAPABILITY_STATE="on"
fi
case "$CAPABILITY_STATE" in
  off) ;;
  *) CAPABILITY_STATE="on" ;;
esac
HARNESS="$(read_field "$CONFIG" independent_harness "$DEF_HARNESS")"
QC_PANEL_RAW="$(read_field "$CONFIG" qc_panel "$DEF_QC_PANEL")"
if config_has_field "$CONFIG" qc_panel; then
  QC_PANEL_RUNNERS_RAW="$(read_field "$CONFIG" qc_panel_runners "")"
  QC_PANEL_EFFORTS_RAW="$(read_field "$CONFIG" qc_panel_efforts "")"
  QC_PANEL_ENDPOINTS_RAW="$(read_field "$CONFIG" qc_panel_endpoints "")"
else
  QC_PANEL_RUNNERS_RAW="$DEF_QC_PANEL_RUNNERS"
  QC_PANEL_EFFORTS_RAW="$DEF_QC_PANEL_EFFORTS"
  QC_PANEL_ENDPOINTS_RAW="$DEF_QC_PANEL_ENDPOINTS"
fi
QC_AGG="$(read_field "$CONFIG" qc_panel_aggregation "$DEF_QC_AGG")"
PROVIDER_READINESS_RECEIPT_TTL_SECONDS="$(read_field "$CONFIG" provider_readiness_receipt_ttl_seconds "$DEF_PROVIDER_READINESS_RECEIPT_TTL_SECONDS")"
if ! [[ "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS" =~ ^[0-9]+$ ]] \
    || [[ "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS" -lt 1 ]] \
    || [[ "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS" -gt 86400 ]]; then
  PROVIDER_READINESS_RECEIPT_TTL_SECONDS="$DEF_PROVIDER_READINESS_RECEIPT_TTL_SECONDS"
fi
PROVIDER_READINESS_FAMILY_CONSTRAINT="$(read_field "$CONFIG" provider_readiness_fallback_family_constraint "$DEF_PROVIDER_READINESS_FAMILY_CONSTRAINT")"
case "$PROVIDER_READINESS_FAMILY_CONSTRAINT" in
  any|different) ;;
  *) PROVIDER_READINESS_FAMILY_CONSTRAINT="$DEF_PROVIDER_READINESS_FAMILY_CONSTRAINT" ;;
esac
DIFF_SCOPE="$(read_field "$CONFIG" review_diff_scope "$DEF_DIFF_SCOPE")"
MIN_PANEL_SIZE="$(read_field "$CONFIG" min_panel_size "$DEF_MIN_PANEL_SIZE")"
# Fail-safe: must be an integer >= 1, else fall back to the safe default. Standalone —
# NOT coupled to required_review_families (lens diversity != family decorrelation).
if ! { [[ "$MIN_PANEL_SIZE" =~ ^[0-9]+$ ]] && [[ "$MIN_PANEL_SIZE" -ge 1 ]]; }; then
  MIN_PANEL_SIZE="$DEF_MIN_PANEL_SIZE"
fi

ON_ENGINE_UNAVAILABLE="$(read_field "$CONFIG" on_engine_unavailable "$DEF_ON_ENGINE_UNAVAILABLE")"
case "$ON_ENGINE_UNAVAILABLE" in
  ask|solo-fallback|wait-reset) ;;
  *)
    echo "resolve-review-loop: ignoring invalid on_engine_unavailable (must be ask|solo-fallback|wait-reset): $ON_ENGINE_UNAVAILABLE" >&2
    ON_ENGINE_UNAVAILABLE="$DEF_ON_ENGINE_UNAVAILABLE"
    ;;
esac

DENSITY_SCALING_CFG="$(read_field "$CONFIG" density_scaling "off")"
case "$DENSITY_SCALING_CFG" in on|off) ;; *) DENSITY_SCALING_CFG="off" ;; esac

# Map an engine name → vendor family (for the decorrelation overlap warning).
family_of() {
  local e; e="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$e" in
    *gpt*|*codex*|*o1*|*o3*|*o4*)            echo openai ;;
    *claude*|*opus*|*sonnet*|*haiku*)        echo anthropic ;;
    *qwen*|*qwq*)                            echo alibaba ;;
    *gemini*|*flash*|*bison*)                echo google ;;
    *grok*|*composer*)                       echo xai ;;
    *minimax*|*abab*)                        echo minimax ;;
    *glm*|*zhipu*)                           echo zhipu ;;
    *)                                       echo unknown ;;
  esac
}

# Canonical agy slug observed by the committed 1.1.9 model-inventory probe.
# Dispatch rails still re-query `agy models` immediately before spend and fail
# closed if the installed host no longer offers this slug.
normalize_agy_alias() {
  case "$1" in
    gemini-flash) printf '%s' 'gemini-3.6-flash-high' ;;
    *) printf '%s' "$1" ;;
  esac
}

# Expand the "all-calibrated" preset to the calibrated 5-family roster if matched exactly (trimmed/case-insensitive)
_qc_panel_norm="$(printf '%s' "$QC_PANEL_RAW" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
if [[ "$_qc_panel_norm" == "all-calibrated" ]]; then
  QC_PANEL_RAW="$QC_ALL_CALIBRATED"
fi

# Parse qc_panel (comma list) → trimmed array + a JSON array string.
QC_PANEL=(); QC_PANEL_JSON="["
_first=1
IFS=',' read -ra _parts <<< "$QC_PANEL_RAW"
for _p in "${_parts[@]}"; do
  _p="$(printf '%s' "$_p" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  [[ -z "$_p" ]] && continue
  _p="$(normalize_agy_alias "$_p")"
  QC_PANEL+=("$_p")
  [[ $_first -eq 0 ]] && QC_PANEL_JSON+=", "
  QC_PANEL_JSON+="\"$(json_escape "$_p")\""
  _first=0
done
QC_PANEL_JSON+="]"
[[ ${#QC_PANEL[@]} -eq 0 ]] && QC_PANEL_JSON="[]"

# Exact QC companion metadata is positional and fail-closed. A model-only
# qc_panel remains valid for the legacy review controller, but readiness cannot
# invent its runner/effort/endpoint and therefore emits complete=false.
QC_PANEL_RUNNERS=()
QC_PANEL_EFFORTS=()
QC_PANEL_ENDPOINTS=()
for _raw_name in QC_PANEL_RUNNERS_RAW QC_PANEL_EFFORTS_RAW QC_PANEL_ENDPOINTS_RAW; do
  _raw_value="${!_raw_name}"
  _parsed=()
  IFS=',' read -ra _raw_parts <<< "$_raw_value"
  for _raw_part in "${_raw_parts[@]}"; do
    _raw_part="$(printf '%s' "$_raw_part" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -n "$_raw_part" ]] && _parsed+=("$_raw_part")
  done
  case "$_raw_name" in
    QC_PANEL_RUNNERS_RAW) QC_PANEL_RUNNERS=("${_parsed[@]}") ;;
    QC_PANEL_EFFORTS_RAW) QC_PANEL_EFFORTS=("${_parsed[@]}") ;;
    QC_PANEL_ENDPOINTS_RAW) QC_PANEL_ENDPOINTS=("${_parsed[@]}") ;;
  esac
done

QC_PANEL_SEATS_COMPLETE="true"
QC_PANEL_SEATS_JSON="[]"
if [[ ${#QC_PANEL_RUNNERS[@]} -ne ${#QC_PANEL[@]} \
      || ${#QC_PANEL_EFFORTS[@]} -ne ${#QC_PANEL[@]} \
      || ${#QC_PANEL_ENDPOINTS[@]} -ne ${#QC_PANEL[@]} ]]; then
  QC_PANEL_SEATS_COMPLETE="false"
fi
if [[ "$QC_PANEL_SEATS_COMPLETE" == "true" ]]; then
  for _i in "${!QC_PANEL[@]}"; do
    case "${QC_PANEL_RUNNERS[$_i]}" in
      codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn) ;;
      *) QC_PANEL_SEATS_COMPLETE="false" ;;
    esac
    case "${QC_PANEL_EFFORTS[$_i]}" in
      low|medium|high|xhigh|max) ;;
      *) QC_PANEL_SEATS_COMPLETE="false" ;;
    esac
    if [[ "${QC_PANEL_ENDPOINTS[$_i]}" != "@none" \
          && ! "${QC_PANEL_ENDPOINTS[$_i]}" =~ ^[A-Za-z0-9_]+$ ]]; then
      QC_PANEL_SEATS_COMPLETE="false"
    fi
  done
fi
if [[ "$QC_PANEL_SEATS_COMPLETE" == "true" ]]; then
  QC_PANEL_SEATS_JSON="["
  _first=1
  for _i in "${!QC_PANEL[@]}"; do
    [[ $_first -eq 0 ]] && QC_PANEL_SEATS_JSON+=","
    _endpoint_json="null"
    if [[ "${QC_PANEL_ENDPOINTS[$_i]}" != "@none" ]]; then
      _endpoint_json="\"$(json_escape "${QC_PANEL_ENDPOINTS[$_i]}")\""
    fi
    QC_PANEL_SEATS_JSON+="{\"role\":\"qc\",\"runner\":\"$(json_escape "${QC_PANEL_RUNNERS[$_i]}")\",\"model\":\"$(json_escape "${QC_PANEL[$_i]}")\",\"effort\":\"$(json_escape "${QC_PANEL_EFFORTS[$_i]}")\",\"endpoint\":${_endpoint_json},\"family\":\"$(json_escape "$(family_of "${QC_PANEL[$_i]}")")\"}"
    _first=0
  done
  QC_PANEL_SEATS_JSON+="]"
fi

# Runner identity selects the actual transport. Unknown or blank explicit values
# fail loudly: silently substituting a different runner misattributes the review.
case "$REV_RUNNER" in
  codex|auto|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn) ;;
  *)
    echo "resolve-review-loop: invalid reviewer_runner (must be codex|auto|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn): ${REV_RUNNER:-<empty>}" >&2
    exit 3
    ;;
esac
case "$REV_EFFORT" in low|medium|high|xhigh|max) ;; *) REV_EFFORT="$DEF_REV_EFFORT" ;; esac
case "$IMPL_EFFORT" in low|medium|high|xhigh|max) ;; *) IMPL_EFFORT="$DEF_IMPL_EFFORT" ;; esac
case "$IMPL_RUNNER" in
  auto|codex|agy|grok|cc-shim|pi|qoderclicn) ;;
  *)
    echo "resolve-review-loop: invalid implementer_runner (must be auto|codex|agy|grok|cc-shim|pi|qoderclicn): ${IMPL_RUNNER:-<empty>}" >&2
    exit 3
    ;;
esac
case "$SPEC_REVIEW" in on|off) ;; *) SPEC_REVIEW="$DEF_SPEC_REVIEW" ;; esac
case "$HARNESS" in on|off) ;; *) HARNESS="$DEF_HARNESS" ;; esac
case "$DIFF_SCOPE" in full|incremental-mitigated) ;; *) DIFF_SCOPE="$DEF_DIFF_SCOPE" ;; esac
[[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]] || MAX_ROUNDS="$DEF_MAX_ROUNDS"
# Aggregation enum: union-on-verified-critical is the safe default; majority is FORBIDDEN
# (it would suppress a single-track blind-spot catch — the whole point of a panel). Any
# unknown value (including "majority") falls back to the safe union default.
case "$QC_AGG" in union-on-verified-critical|unanimous-ship) ;; *) QC_AGG="$DEF_QC_AGG" ;; esac
# Family family and CLI-derived review-risk controls:
case "$DIFF_LINES" in
  ''|*[!0-9]*) DIFF_LINES=0 ;;
  *) : ;;
esac
case "$PROTECTED_PATH" in 0|1) ;; *) PROTECTED_PATH=0 ;; esac
case "$ORACLE_AVAILABLE" in 0|1) ;; *) ORACLE_AVAILABLE=1 ;; esac
case "$SECURITY_SURFACE" in 0|1) ;; *) SECURITY_SURFACE=0 ;; esac

# Decorrelation overlap warning (ADVISORY, stderr — never alters output / exit code):
# if NO panel member is a different family from the implementer, the panel can't catch the
# implementer's family-correlated blind spots.
IMPL_FAMILY="$(family_of "$IMPL_ENGINE")"
REV_FAMILY="$(family_of "$REV_ENGINE")"
VER_AUTH_FAMILY="$(family_of "$VER_AUTH_ENGINE")"
_diff_family=0
_distinct_families=""
_distinct_count=0
for _m in "${QC_PANEL[@]}"; do
  _mf="$(family_of "$_m")"
  # An 'unknown' family does NOT count as cross-family (it could be the implementer's
  # family under an unrecognized codename) — else it would mask a real overlap.
  if [[ "$_mf" != "unknown" ]]; then
    [[ "$IMPL_FAMILY" != "unknown" && "$_mf" != "$IMPL_FAMILY" ]] && _diff_family=1
    if [[ " $_distinct_families " != *" $_mf "* ]]; then
      _distinct_families="$_distinct_families $_mf"
      _distinct_count=$((_distinct_count + 1))
    fi
  fi
done

# Derive source trust from implementer family when not explicitly set:
# trusted vendors are OpenAI/Anthropic/Google; unknown or custom stacks default to low trust.
case "$SOURCE_TRUST" in
  high|low) ;;
  *)
    case "$IMPL_FAMILY" in
      openai|anthropic|google) SOURCE_TRUST="high" ;;
      *) SOURCE_TRUST="low" ;;
    esac
    ;;
esac

# Deterministic risk computation:
# high iff source trust is low, diff lines > 150, protected-path, security-surface, or oracle disabled.
if [[ "$SOURCE_TRUST" == "low" || "$DIFF_LINES" -gt 150 || "$PROTECTED_PATH" -eq 1 || "$SECURITY_SURFACE" -eq 1 || "$ORACLE_AVAILABLE" -eq 0 ]]; then
  REVIEW_RISK="high"
  REQUIRED_REVIEW_FAMILIES=2
  L1_REQUIRED="true"
else
  REVIEW_RISK="low"
  REQUIRED_REVIEW_FAMILIES=1
  L1_REQUIRED="false"
fi

DENSITY_SOURCE="off"
if [[ "$SCALE_BY_CAPABILITY" -eq 1 ]]; then
  DENSITY_SOURCE="flag"
elif [[ "$DENSITY_SCALING_CFG" == "on" ]]; then
  DENSITY_SOURCE="config"
fi

CAPABILITY_TIER="unknown"
DENSITY_SCALED="false"
VERIFY_FIRST="false"

if [[ "$DENSITY_SOURCE" != "off" ]]; then
  SCORECARD_IMPL="$(node "$SCRIPT_DIR/engine-scorecard.js" current --role implementer 2>/dev/null || true)"
  if [[ -n "$SCORECARD_IMPL" ]]; then
    IMPL_TIER="$(printf '%s' "$SCORECARD_IMPL" | node -e '
const fs = require("fs");
const engine = process.argv[1];
const runner = process.argv[2];
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let rows;
try { rows = JSON.parse(raw); } catch { process.exit(0); }
if (!Array.isArray(rows)) process.exit(0);
let found = false;
for (const row of rows) {
  if (row && String(row.engine) === String(engine) && (String(runner) === "auto" || String(row.runner) === String(runner)) && typeof row.status === "string") {
    if (row.status === "qualified"
        && row.authority_status === "session_local"
        && row.admissible === true) {
      process.stdout.write("high");
    } else if (row.status === "failed" || row.status === "expired") {
      process.stdout.write("low");
    } else {
      process.stdout.write("unknown");
    }
    found = true;
    break;
  }
}
if (!found) process.stdout.write("unknown");
' "$IMPL_ENGINE" "$IMPL_RUNNER" || true)"
    if [[ -n "$IMPL_TIER" ]]; then
      CAPABILITY_TIER="$IMPL_TIER"
    fi
  fi

  if [[ "$CAPABILITY_TIER" == "low" || "$CAPABILITY_TIER" == "unknown" ]]; then
    DENSITY_SCALED="true"
    # Scale +2 capped at 7, but NEVER below the user-configured base for
    # low/unknown implementers.
    BASE_ROUNDS="$MAX_ROUNDS"
    MAX_ROUNDS=$(( MAX_ROUNDS + 2 ))
    [[ "$MAX_ROUNDS" -gt 7 ]] && MAX_ROUNDS=$(( BASE_ROUNDS > 7 ? BASE_ROUNDS : 7 ))
    [[ "$REQUIRED_REVIEW_FAMILIES" -lt 2 ]] && REQUIRED_REVIEW_FAMILIES=2
    L1_REQUIRED="true"
  elif [[ "$CAPABILITY_TIER" == "high" && "$REVIEW_RISK" == "low" ]]; then
    DENSITY_SCALED="true"
    VERIFY_FIRST="true"
    [[ "$MAX_ROUNDS" -gt 2 ]] && MAX_ROUNDS=2
  fi
fi

# If the implementer's family is unknown, a single known reviewer family cannot prove
# decorrelation (it might be the implementer's actual family). Placed AFTER the risk AND
# density-scaling blocks so REQUIRED_REVIEW_FAMILIES is final — referencing it earlier was
# an unbound-variable crash under set -u (qc2-security executed repro, 2026-07-05).
if [[ "$IMPL_FAMILY" == "unknown" && "$_distinct_count" -ge 1 ]]; then
  # Compatibility bar: for required_review_families=1, the value must remain identical
  # to the legacy behavior. For required >= 2, we strictly need >= 2 distinct known
  # families — by pigeonhole at least one then differs from the unknown implementer.
  if [[ "$_distinct_count" -ge 2 || "$REQUIRED_REVIEW_FAMILIES" -lt 2 ]]; then
    _diff_family=1
  fi
fi

# Cross-family review is required whenever L2 review runs (a non-empty panel) AND always at
# high risk (or scaled density) — an EMPTY panel at high risk is itself a violation (no reviewers at all, let alone
# cross-family), so it must be required+unsatisfied so --enforce blocks it (gpt-5.5 round-2).
if [[ ${#QC_PANEL[@]} -gt 0 || "$REVIEW_RISK" == "high" || "$REQUIRED_REVIEW_FAMILIES" -ge 2 ]]; then
  CROSS_FAMILY_REQUIRED="true"
else
  CROSS_FAMILY_REQUIRED="false"
fi
if [[ "$_diff_family" -eq 1 && "$_distinct_count" -ge "$REQUIRED_REVIEW_FAMILIES" ]]; then
  CROSS_FAMILY_SATISFIED="true"
else
  CROSS_FAMILY_SATISFIED="false"
fi

if [[ "$CROSS_FAMILY_REQUIRED" == "true" && "$CROSS_FAMILY_SATISFIED" == "false" ]]; then
  _cross_severity="WARNING"
  [[ "$REVIEW_RISK" == "high" || "$REQUIRED_REVIEW_FAMILIES" -ge 2 ]] && _cross_severity="ERROR"
  if [[ "$_distinct_count" -lt "$REQUIRED_REVIEW_FAMILIES" ]]; then
    printf 'resolve-review-loop: %s — cross-family: qc_panel spans %d distinct famil(y/ies), %d required. Add more diverse panel members.\n' "$_cross_severity" "$_distinct_count" "$REQUIRED_REVIEW_FAMILIES" >&2
  else
    printf 'resolve-review-loop: %s — cross-family: qc_panel shares the implementer family (%s); no cross-family decorrelation. Add a panel member from a different vendor.\n' "$_cross_severity" "$IMPL_FAMILY" >&2
  fi
fi

# --enforce (opt-in hard gate; default emits data exit-0 like the resolve-* siblings).
# The resolver normally REPORTS and the caller (depth-0 loop / pre-push) ENFORCES. With
# --enforce, a caller can use the resolver itself AS the gate: exit 3 when the policy says
# BLOCK — i.e. a high-risk change whose required cross-family decorrelation is unsatisfied
# (the gpt-5.5-flagged hole: high-risk + cross_family_required + !satisfied must not pass).
# JSON / --field is still emitted so the gate also gets the data; only the exit code differs.
ENFORCE_EXIT=0
if [[ "$ENFORCE" == "1" && "$CROSS_FAMILY_REQUIRED" == "true" \
      && "$CROSS_FAMILY_SATISFIED" == "false" && ( "$REVIEW_RISK" == "high" || "$REQUIRED_REVIEW_FAMILIES" -ge 2 ) ]]; then
  ENFORCE_EXIT=3
fi

probe_diff_bytes() {
  local mode="$1" base=""
  case "$mode" in
    changed)
      if ! base="$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)"; then
        return 1
      fi
      git diff --numstat -z -M -C "${base}...HEAD" | wc -c
      ;;
    staged)
      git diff --numstat -z -M -C --cached | wc -c
      ;;
    *)
      git diff --numstat -z -M -C "$mode" | wc -c
      ;;
  esac
}

probe_field_str() {
  local json="$1" key="$2"
  printf '%s' "$json" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
}
probe_field_num() {
  local json="$1" key="$2"
  printf '%s' "$json" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\\([0-9]\\+\\).*/\\1/p" | head -n1
}

if [[ "$AUTO_DOMAIN" -eq 1 && "$DOMAIN_SOURCE" != "explicit" ]]; then
  AUTO_DIFF_BYTES=""
  if AUTO_DIFF_BYTES="$(probe_diff_bytes "$AUTO_RANGE")"; then
    AUTO_DIFF_BYTES="${AUTO_DIFF_BYTES//$'\n'/}"
    # `|| AUTO_OUT=""` is defensive: this script has no `set -e` today (a probe
    # failure already falls through to mixed/none via the -n guard below), but the
    # explicit reset future-proofs against a later `set -e` killing the resolver
    # instead of preserving its exit code (round-3 reviewer 🟠).
    AUTO_OUT="$(bash "$SCRIPT_DIR/probe-diff-domain.sh" "$AUTO_RANGE" 2>/dev/null)" || AUTO_OUT=""
    if [[ "$AUTO_DIFF_BYTES" -gt 0 && -n "$AUTO_OUT" ]]; then
      AUTO_PARSED="$(probe_field_str "$AUTO_OUT" work_domain)"
      AUTO_WEIGHT_CLASSIFIED="$(probe_field_num "$AUTO_OUT" weight_classified)"
      AUTO_WEIGHT_EXCLUDED="$(probe_field_num "$AUTO_OUT" weight_excluded)"
      AUTO_WEIGHT_UNCLASSIFIED="$(probe_field_num "$AUTO_OUT" weight_unclassified)"
      if [[ -n "$AUTO_PARSED" && -n "$AUTO_WEIGHT_CLASSIFIED" && -n "$AUTO_WEIGHT_EXCLUDED" && -n "$AUTO_WEIGHT_UNCLASSIFIED" ]]; then
        DWORK_DOMAIN="$AUTO_PARSED"
        DOMAIN_SOURCE="auto"
      fi
    fi
  fi
fi

# Parse and compact JSON safely from stdin for inline injection (or emit exit non-zero).
json_parse_array_compact() {
  node -e 'const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(1);

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  process.exit(1);
}

if (!Array.isArray(parsed)) process.exit(1);
process.stdout.write(JSON.stringify(parsed));'
}

# Optional scorecard qualification validation for reviewer role; default remains byte-identical
# (no flag → no extra fields, no scorecard IO).
REVIEWER_QUALIFIED="false"
FALLBACK_LADDER_JSON="[]"
if [[ "$CHECK_SCORECARD" -eq 1 ]]; then
  SCORECARD_CURRENT=""
  SCORECARD_LADDER=""
  if [[ -r "$SCORECARD_SCOPE_FILE" && -r "$SCORECARD_IDENTITY_FILE" ]]; then
    SCORECARD_CURRENT="$(node "$SCRIPT_DIR/engine-scorecard.js" current \
      --role reviewer --require-evidence \
      --scope-file "$SCORECARD_SCOPE_FILE" \
      --identity-file "$SCORECARD_IDENTITY_FILE" 2>/dev/null || true)"
    SCORECARD_LADDER="$(node "$SCRIPT_DIR/engine-scorecard.js" ladder \
      --role reviewer --require-evidence \
      --scope-file "$SCORECARD_SCOPE_FILE" \
      --implementer-family "$IMPL_FAMILY" 2>/dev/null || true)"
  fi
  FALLBACK_LADDER_JSON="$(printf '%s' "$SCORECARD_LADDER" | json_parse_array_compact || printf '%s' "[]")"

  REVIEWER_STATUS=""
  if [[ -n "$SCORECARD_CURRENT" ]]; then
    REVIEWER_STATUS="$(printf '%s' "$SCORECARD_CURRENT" | node -e 'const fs = require("fs");
const engine = process.argv[1];
const runner = process.argv[2];
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);

let rows;
try {
  rows = JSON.parse(raw);
} catch {
  process.exit(0);
}

if (!Array.isArray(rows)) process.exit(0);

for (const row of rows) {
  if (
    row &&
    String(row.engine) === String(engine) &&
    (String(runner) === "auto" || String(row.runner) === String(runner)) &&
    row.authority_status === "session_local" &&
    row.admissible === true &&
    typeof row.status === "string"
  ) {
    process.stdout.write(row.status);
    break;
  }
}
' "$REV_ENGINE" "$REV_RUNNER" || true
)"
  fi

  if [[ "$REVIEWER_STATUS" == "qualified" ]]; then
    REVIEWER_QUALIFIED=true
  else
    REVIEWER_QUALIFIED=false
    [[ "$ENFORCE" -eq 1 ]] && ENFORCE_EXIT=3
  fi
fi

CAP_STATE_SOURCE="unknown"
CAP_QUOTA_STATUS="unknown"
CAP_QUOTA_RESET_AT=null
CAP_SKILL_MODE_REQ="${SKILL_MODE_REQ:-off}"
CAP_SKILL_MODE_EFF="$CAP_SKILL_MODE_REQ"
CAP_WARNINGS_JSON="[]"

# When capability-state consultation is explicitly OFF, the source is "none" (deliberately
# not consulted) — distinct from "unknown" (consulted but the store had no fresh data).
if [[ "$CAPABILITY_STATE" != "on" ]]; then
  CAP_STATE_SOURCE="none"
fi

if [[ "$CAPABILITY_STATE" == "on" ]]; then
  export REPO_ROOT IMPL_RUNNER IMPL_ENGINE REV_RUNNER REV_ENGINE CAPABILITY_STATE STORE_PATH NOW_VAL SKILL_MODE_REQ
  _node_out="$(node -e '
const cp = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const repoRoot = process.env.REPO_ROOT || "";
const implRunner = process.env.IMPL_RUNNER || "";
const implEngine = process.env.IMPL_ENGINE || "";
const revRunner = process.env.REV_RUNNER || "";
const revEngine = process.env.REV_ENGINE || "";
const capabilityState = process.env.CAPABILITY_STATE || "on";
const storePath = process.env.STORE_PATH || "";
const nowVal = process.env.NOW_VAL || "";
const skillModeReq = process.env.SKILL_MODE_REQ || "off";

function expandTilde(raw) {
  if (!raw) return raw;
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~" + path.sep) || raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

let storeFile = process.env.ENGINE_CAPABILITY_FILE;
let storeDir = process.env.ENGINE_CAPABILITY_DIR;

if (storePath) {
  const resolvedPath = path.resolve(expandTilde(storePath));
  try {
    if (fs.existsSync(resolvedPath)) {
      if (!fs.statSync(resolvedPath).isDirectory()) {
        storeFile = resolvedPath;
      } else {
        storeDir = resolvedPath;
        storeFile = path.join(storeDir, "capability.jsonl");
      }
    } else {
      if (resolvedPath.endsWith(".jsonl")) {
        storeFile = resolvedPath;
      } else {
        storeDir = resolvedPath;
        storeFile = path.join(storeDir, "capability.jsonl");
      }
    }
  } catch (e) {
    if (resolvedPath.endsWith(".jsonl")) {
      storeFile = resolvedPath;
    } else {
      storeDir = resolvedPath;
      storeFile = path.join(storeDir, "capability.jsonl");
    }
  }
} else {
  if (storeDir) {
    storeDir = path.resolve(expandTilde(storeDir));
    storeFile = storeFile ? path.resolve(expandTilde(storeFile)) : path.join(storeDir, "capability.jsonl");
  } else {
    storeDir = path.resolve(expandTilde(path.join("~", ".autopilot", "engine-capability")));
    storeFile = storeFile ? path.resolve(expandTilde(storeFile)) : path.join(storeDir, "capability.jsonl");
  }
}

const storeExists = fs.existsSync(storeFile);
// "store" ONLY when fresh matching data is actually found (set below after the queries);
// a store that exists but yields nothing fresh must report "unknown", not hide a probe gap
// behind a bare file-exists check (gpt-5.5 batch3 R2 Q1).
let stateSource = "unknown";

const scriptPath = path.join(repoRoot, "scripts", "engine-capability-state.js");

function getCap(runner, model, role) {
  const args = [
    scriptPath,
    "current",
    "--runner", runner,
    "--model", model,
    "--role", role
  ];
  if (storePath) {
    args.push("--store", storePath);
  }
  if (nowVal) {
    args.push("--now", nowVal);
  }
  try {
    const res = cp.spawnSync("node", args, { encoding: "utf8" });
    if (res.status === 0) {
      return JSON.parse(res.stdout);
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

const implCap = getCap(implRunner, implEngine, "implementer");
const revCap = getCap(revRunner, revEngine, "reviewer");

const implQuota = implCap && implCap.capability && implCap.capability.quota;
const revQuota = revCap && revCap.capability && revCap.capability.quota;

const implStatus = implQuota ? implQuota.status : "unknown";
const revStatus = revQuota ? revQuota.status : "unknown";

const implConfidence = implQuota ? implQuota.confidence : "low";
const revConfidence = revQuota ? revQuota.confidence : "low";

const implResetAt = implQuota ? implQuota.reset_at : null;
const revResetAt = revQuota ? revQuota.reset_at : null;

let quotaStatus = "unknown";
if (implStatus === "exhausted" || revStatus === "exhausted") {
  quotaStatus = "exhausted";
} else if (implStatus === "limited" || revStatus === "limited") {
  quotaStatus = "limited";
} else if (implStatus === "available" || revStatus === "available") {
  quotaStatus = "available";
}

let quotaResetAt = null;
if (implStatus === "exhausted" && implResetAt) {
  quotaResetAt = implResetAt;
} else if (revStatus === "exhausted" && revResetAt) {
  quotaResetAt = revResetAt;
} else if (implStatus === "limited" && implResetAt) {
  quotaResetAt = implResetAt;
} else if (revStatus === "limited" && revResetAt) {
  quotaResetAt = revResetAt;
} else {
  if (implResetAt && revResetAt) {
    quotaResetAt = new Date(implResetAt) > new Date(revResetAt) ? implResetAt : revResetAt;
  } else {
    quotaResetAt = implResetAt || revResetAt || null;
  }
}

// Q1: source is "store" only if the store existed AND a fresh matching signal was found
// (a real quota status, or a non-unknown skill_transport field for either engine).
const _implST = (implCap && implCap.capability && implCap.capability.skill_transport) || {};
const _revST = (revCap && revCap.capability && revCap.capability.skill_transport) || {};
const foundFresh = implStatus !== "unknown" || revStatus !== "unknown"
  || (_implST.native && _implST.native !== "unknown")
  || (_implST.prompt_pack && _implST.prompt_pack !== "unknown")
  || (_revST.native && _revST.native !== "unknown")
  || (_revST.prompt_pack && _revST.prompt_pack !== "unknown");
if (storeExists && foundFresh) stateSource = "store";

const warnings = [];

function familyOf(engineName) {
  const e = String(engineName).toLowerCase();
  if (e.includes("gpt") || e.includes("codex") || e.includes("o1") || e.includes("o3") || e.includes("o4")) return "openai";
  if (e.includes("claude") || e.includes("opus") || e.includes("sonnet") || e.includes("haiku")) return "anthropic";
  if (e.includes("qwen") || e.includes("qwq")) return "alibaba";
  if (e.includes("gemini") || e.includes("flash") || e.includes("bison")) return "google";
  if (e.includes("grok") || e.includes("composer")) return "xai";
  if (e.includes("minimax") || e.includes("abab")) return "minimax";
  if (e.includes("glm") || e.includes("zhipu")) return "zhipu";
  return "unknown";
}

const implFamily = familyOf(implEngine);
const isL4 = (implFamily === "anthropic");

if (!isL4) {
  if (implStatus === "exhausted" && implConfidence === "high") {
    warnings.push("Demoted implementer: " + implRunner + " (" + implEngine + ") is exhausted.");
  }
  if (revStatus === "exhausted" && revConfidence === "high") {
    warnings.push("Demoted reviewer: " + revRunner + " (" + revEngine + ") is exhausted.");
  }
}

const implSkill = implCap && implCap.capability && implCap.capability.skill_transport;
const nativeStatus = implSkill ? implSkill.native : "unknown";
const promptStatus = implSkill ? implSkill.prompt_pack : "unknown";

const requestedMode = skillModeReq || "off";
if (!isL4 && requestedMode === "native" && nativeStatus !== "supported") {
  warnings.push("Runner " + implRunner + " (" + implEngine + ") does not support native skills (native skill transport is " + nativeStatus + ").");
}

let effectiveMode = "off";
if (requestedMode === "off") {
  effectiveMode = "off";
} else if (requestedMode === "prompt") {
  effectiveMode = "prompt";
} else if (requestedMode === "native") {
  effectiveMode = "native";
} else if (requestedMode === "auto") {
  if (nativeStatus === "supported") {
    effectiveMode = "native";
  } else if (promptStatus !== "unsupported") {
    effectiveMode = "prompt";
  } else {
    effectiveMode = "off";
  }
}

console.log(stateSource);
console.log(quotaStatus);
console.log(quotaResetAt ? JSON.stringify(quotaResetAt) : "null");  // JSON.stringify escapes safely (gpt-5.5 batch3 R2 Q2)
console.log(requestedMode);
console.log(effectiveMode);
console.log(JSON.stringify(warnings));
' 2>/dev/null)" || _node_out=""

  if [[ -n "$_node_out" ]]; then
    {
      read -r CAP_STATE_SOURCE
      read -r CAP_QUOTA_STATUS
      read -r CAP_QUOTA_RESET_AT
      read -r CAP_SKILL_MODE_REQ
      read -r CAP_SKILL_MODE_EFF
      read -r CAP_WARNINGS_JSON
    } <<< "$_node_out"
  fi
fi

# --- context-window fitness (REPORT-ONLY) ---
# This resolver reports state; it never rewrites the roster. Same posture as the quota
# path above: an exhausted quota yields quota_status + a warning and the CONSUMER decides
# per on_engine_unavailable. A seat whose window cannot hold the intended input is the
# same class of fact, so it lands in the same capability_warnings array rather than in a
# new field — check-context-window.js stays the single source of window truth.
if [[ "${INPUT_BYTES:-0}" =~ ^[0-9]+$ ]] && [[ "${INPUT_BYTES:-0}" -gt 0 ]]; then
  _CB_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/check-context-window.js"
  if [[ -r "$_CB_SCRIPT" ]] && command -v node > /dev/null 2>&1; then
    # PARALLEL ARRAYS, never a space-joined string: model ids legitimately contain
    # spaces ("Gemini 3.5 Flash (High)"), and word-splitting a joined string invents
    # phantom seats named after each word.
    _seat_names=(reviewer implementer)
    _seat_engines=("${REV_ENGINE:-}" "${IMPL_ENGINE:-}")
    if [[ "${VER_AUTH_PRESENT:-false}" == "true" ]]; then
      _seat_names+=(verification_author)
      _seat_engines+=("${VER_AUTH_ENGINE:-}")
    fi
    _cb_new_warnings="[]"
    for _i in "${!_seat_names[@]}"; do
      _seat_name="${_seat_names[$_i]}"
      _seat_engine="${_seat_engines[$_i]}"
      [[ -n "$_seat_engine" ]] || continue
      _cb_args=(--model "$_seat_engine" --bytes "$INPUT_BYTES" --quiet)
      [[ -n "${CAPABILITY_STATE:-}" ]] && [[ -r "${CAPABILITY_STATE:-}" ]] \
        && _cb_args+=(--capability-state "$CAPABILITY_STATE")
      _cb_out="$(node "$_CB_SCRIPT" "${_cb_args[@]}" 2> /dev/null || true)"
      [[ -n "$_cb_out" ]] || continue
      _cb_new_warnings="$(printf '%s' "$_cb_out" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const seat = process.argv[1];
  let acc = [];
  try { acc = JSON.parse(process.argv[2]); } catch { acc = []; }
  try {
    const v = JSON.parse(s);
    // ONLY over-budget is actionable. UNKNOWN_WINDOW is the normal state for any
    // engine without a recorded observation (2 of the 3 default seats today), so
    // warning on it would emit constant noise that drowns the real signal.
    if (v.verdict === "OVER_BUDGET") {
      acc.push(`${seat} seat (${v.model}) context window ${v.window} cannot hold the intended input: ${v.reason}`);
    }
  } catch { /* unparseable verdict is not a warning */ }
  process.stdout.write(JSON.stringify(acc));
});' "$_seat_name" "$_cb_new_warnings" 2> /dev/null || printf '%s' "$_cb_new_warnings")"
    done
    if [[ "$_cb_new_warnings" != "[]" ]]; then
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
let b = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
try { b = JSON.parse(process.argv[2]); } catch { b = []; }
process.stdout.write(JSON.stringify([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]));
' "$CAP_WARNINGS_JSON" "$_cb_new_warnings" 2> /dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
    fi
  fi
fi

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    reviewer_engine) printf '%s\n' "$REV_ENGINE" ;;
    reviewer_effort) printf '%s\n' "$REV_EFFORT" ;;
    reviewer_runner) printf '%s\n' "$REV_RUNNER" ;;
    implementer_engine) printf '%s\n' "$IMPL_ENGINE" ;;
    implementer_effort) printf '%s\n' "$IMPL_EFFORT" ;;
    implementer_runner) printf '%s\n' "$IMPL_RUNNER" ;;
    reviewer_endpoint) printf '%s\n' "$REV_ENDPOINT" ;;
    reviewer_family) printf '%s\n' "$REV_FAMILY" ;;
    implementer_endpoint) printf '%s\n' "$IMPL_ENDPOINT" ;;
    verification_author_present) printf '%s\n' "$VER_AUTH_PRESENT" ;;
    verification_author_engine) printf '%s\n' "$VER_AUTH_ENGINE" ;;
    verification_author_runner) printf '%s\n' "$VER_AUTH_RUNNER" ;;
    verification_author_effort) printf '%s\n' "$VER_AUTH_EFFORT" ;;
    verification_author_endpoint) printf '%s\n' "$VER_AUTH_ENDPOINT" ;;
    verification_author_family) printf '%s\n' "$VER_AUTH_FAMILY" ;;
    implementer_family) printf '%s\n' "$IMPL_FAMILY" ;;
    config_path) printf '%s\n' "$CONFIG_PATH" ;;
    reviewer_engine_low_risk) printf '%s\n' "$REV_ENGINE_LOW_RISK" ;;
    reviewer_effort_low_risk) printf '%s\n' "$REV_EFFORT_LOW_RISK" ;;
    on_family_conflict) printf '%s\n' "$ON_FAMILY_CONFLICT" ;;
    reviewer_fallback_preference) printf '%s\n' "$REV_FB_PREF_JSON" ;;
    reviewer_fallback_preference_low_risk) printf '%s\n' "$REV_FB_PREF_LOW_JSON" ;;
    loop_max_rounds) printf '%s\n' "$MAX_ROUNDS" ;;
    loop_convergence_verdict) printf '%s\n' "$CONVERGE" ;;
    spec_review) printf '%s\n' "$SPEC_REVIEW" ;;
    plan_review) printf '%s\n' "$PLAN_REVIEW" ;;
    plan_reviewer_engine) printf '%s\n' "$PLAN_REV_ENGINE" ;;
    plan_reviewer_effort) printf '%s\n' "$PLAN_REV_EFFORT" ;;
    plan_reviewer_runner) printf '%s\n' "$PLAN_REV_RUNNER" ;;
    plan_reviewer_endpoint) printf '%s\n' "$PLAN_REV_ENDPOINT" ;;
    plan_deep_reviewer_engine) printf '%s\n' "$PLAN_DEEP_ENGINE" ;;
    plan_deep_reviewer_effort) printf '%s\n' "$PLAN_DEEP_EFFORT" ;;
    plan_deep_reviewer_runner) printf '%s\n' "$PLAN_DEEP_RUNNER" ;;
    plan_deep_reviewer_endpoint) printf '%s\n' "$PLAN_DEEP_ENDPOINT" ;;
    plan_review_max_generations) printf '%s\n' "$PLAN_MAX_GENERATIONS" ;;
    plan_review_max_wall_seconds) printf '%s\n' "$PLAN_MAX_WALL_SECONDS" ;;
    plan_review_growth_warn_ratio) printf '%s\n' "$PLAN_GROWTH_WARN_RATIO" ;;
    plan_review_growth_stop_ratio) printf '%s\n' "$PLAN_GROWTH_STOP_RATIO" ;;
    independent_harness) printf '%s\n' "$HARNESS" ;;
    qc_panel) printf '%s\n' "${QC_PANEL[*]}" ;;
    qc_panel_seats) printf '%s\n' "$QC_PANEL_SEATS_JSON" ;;
    qc_panel_seats_complete) printf '%s\n' "$QC_PANEL_SEATS_COMPLETE" ;;
    qc_panel_aggregation) printf '%s\n' "$QC_AGG" ;;
    provider_readiness_receipt_ttl_seconds) printf '%s\n' "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS" ;;
    provider_readiness_fallback_family_constraint) printf '%s\n' "$PROVIDER_READINESS_FAMILY_CONSTRAINT" ;;
    review_risk) printf '%s\n' "$REVIEW_RISK" ;;
    required_review_families) printf '%s\n' "$REQUIRED_REVIEW_FAMILIES" ;;
    l1_required) printf '%s\n' "$L1_REQUIRED" ;;
    cross_family_required) printf '%s\n' "$CROSS_FAMILY_REQUIRED" ;;
    cross_family_satisfied) printf '%s\n' "$CROSS_FAMILY_SATISFIED" ;;
    reviewer_qualified)
      if [[ "$CHECK_SCORECARD" -ne 1 ]]; then
        echo "unknown field: reviewer_qualified (use --check-scorecard)" >&2
        exit 2
      fi
      printf '%s\n' "$REVIEWER_QUALIFIED"
      ;;
    fallback_ladder)
      if [[ "$CHECK_SCORECARD" -ne 1 ]]; then
        echo "unknown field: fallback_ladder (use --check-scorecard)" >&2
        exit 2
      fi
      printf '%s\n' "$FALLBACK_LADDER_JSON"
      ;;
    review_diff_scope) printf '%s\n' "$DIFF_SCOPE" ;;
    min_panel_size) printf '%s\n' "$MIN_PANEL_SIZE" ;;
    on_engine_unavailable) printf '%s\n' "$ON_ENGINE_UNAVAILABLE" ;;
    source) printf '%s\n' "$SOURCE" ;;
    work_domain) printf '%s\n' "$DWORK_DOMAIN" ;;
    domain_source) printf '%s\n' "$DOMAIN_SOURCE" ;;
    capability_tier)
      if [[ "$DENSITY_SOURCE" == "off" ]]; then
        echo "unknown field: capability_tier (feature off)" >&2
        exit 2
      fi
      printf '%s\n' "$CAPABILITY_TIER"
      ;;
    density_scaled)
      if [[ "$DENSITY_SOURCE" == "off" ]]; then
        echo "unknown field: density_scaled (feature off)" >&2
        exit 2
      fi
      printf '%s\n' "$DENSITY_SCALED"
      ;;
    density_source)
      if [[ "$DENSITY_SOURCE" == "off" ]]; then
        echo "unknown field: density_source (feature off)" >&2
        exit 2
      fi
      printf '%s\n' "$DENSITY_SOURCE"
      ;;
    verify_first)
      if [[ "$DENSITY_SOURCE" == "off" ]]; then
        echo "unknown field: verify_first (feature off)" >&2
        exit 2
      fi
      printf '%s\n' "$VERIFY_FIRST"
      ;;
    capability_state_source) printf '%s\n' "$CAP_STATE_SOURCE" ;;
    quota_status) printf '%s\n' "$CAP_QUOTA_STATUS" ;;
    quota_reset_at)
      if [[ "$CAP_QUOTA_RESET_AT" == "null" ]]; then
        printf '\n'
      else
        # NOT `local` — this case is at top level, not inside a function (gpt-5.5 batch3 review).
        _t="${CAP_QUOTA_RESET_AT#\"}"
        _t="${_t%\"}"
        printf '%s\n' "$_t"
      fi
      ;;
    skill_mode_requested) printf '%s\n' "$CAP_SKILL_MODE_REQ" ;;
    skill_mode_effective) printf '%s\n' "$CAP_SKILL_MODE_EFF" ;;
    capability_warnings) printf '%s\n' "$CAP_WARNINGS_JSON" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit "$ENFORCE_EXIT"
fi

FMT_SUFFIX=" }\n"
ARGS_SUFFIX=()
READINESS_FMT=', "qc_panel_seats": %s, "qc_panel_seats_complete": %s, "provider_readiness_receipt_ttl_seconds": %s, "provider_readiness_fallback_family_constraint": "%s"'
READINESS_ARGS=(
  "$QC_PANEL_SEATS_JSON"
  "$QC_PANEL_SEATS_COMPLETE"
  "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS"
  "$PROVIDER_READINESS_FAMILY_CONSTRAINT"
)
PLAN_FMT=', "plan_review": "%s", "plan_reviewer_engine": "%s", "plan_reviewer_effort": "%s", "plan_reviewer_runner": "%s", "plan_reviewer_endpoint": "%s", "plan_deep_reviewer_engine": "%s", "plan_deep_reviewer_effort": "%s", "plan_deep_reviewer_runner": "%s", "plan_deep_reviewer_endpoint": "%s", "plan_review_max_generations": %s, "plan_review_max_wall_seconds": %s, "plan_review_growth_warn_ratio": %s, "plan_review_growth_stop_ratio": %s'
PLAN_ARGS=(
  "$PLAN_REVIEW"
  "$(json_escape "$PLAN_REV_ENGINE")"
  "$PLAN_REV_EFFORT"
  "$PLAN_REV_RUNNER"
  "$(json_escape "$PLAN_REV_ENDPOINT")"
  "$(json_escape "$PLAN_DEEP_ENGINE")"
  "$PLAN_DEEP_EFFORT"
  "$PLAN_DEEP_RUNNER"
  "$(json_escape "$PLAN_DEEP_ENDPOINT")"
  "$PLAN_MAX_GENERATIONS"
  "$PLAN_MAX_WALL_SECONDS"
  "$PLAN_GROWTH_WARN_RATIO"
  "$PLAN_GROWTH_STOP_RATIO"
)
if [[ "$DENSITY_SOURCE" != "off" ]]; then
  FMT_SUFFIX=", \"capability_tier\": \"%s\", \"density_scaled\": %s, \"density_source\": \"%s\", \"verify_first\": %s }\n"
  ARGS_SUFFIX=("$CAPABILITY_TIER" "$DENSITY_SCALED" "$DENSITY_SOURCE" "$VERIFY_FIRST")
fi

if [[ "$CHECK_SCORECARD" == "1" ]]; then
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "reviewer_qualified": %s, "fallback_ladder": %s, "fallback_ladder_implementer_family": "%s", "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "reviewer_family": "%s", "implementer_endpoint": "%s", "verification_author_present": %s, "verification_author_engine": "%s", "verification_author_runner": "%s", "verification_author_effort": "%s", "verification_author_endpoint": "%s", "verification_author_family": "%s", "implementer_family": "%s", "config_path": "%s", "min_panel_size": %s, "on_engine_unavailable": "%s", "reviewer_engine_low_risk": "%s", "reviewer_effort_low_risk": "%s", "on_family_conflict": "%s", "reviewer_fallback_preference": %s, "reviewer_fallback_preference_low_risk": %s'"${READINESS_FMT}""${PLAN_FMT}""${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$REVIEWER_QUALIFIED" "$FALLBACK_LADDER_JSON" "$IMPL_FAMILY" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$(json_escape "$REV_FAMILY")" "$IMPL_ENDPOINT" "$VER_AUTH_PRESENT" "$(json_escape "$VER_AUTH_ENGINE")" "$(json_escape "$VER_AUTH_RUNNER")" "$(json_escape "$VER_AUTH_EFFORT")" "$(json_escape "$VER_AUTH_ENDPOINT")" "$(json_escape "$VER_AUTH_FAMILY")" "$(json_escape "$IMPL_FAMILY")" "$(json_escape "$CONFIG_PATH")" \
    "$MIN_PANEL_SIZE" "$(json_escape "$ON_ENGINE_UNAVAILABLE")" "$(json_escape "$REV_ENGINE_LOW_RISK")" "$REV_EFFORT_LOW_RISK" "$ON_FAMILY_CONFLICT" "$REV_FB_PREF_JSON" "$REV_FB_PREF_LOW_JSON" "${READINESS_ARGS[@]}" "${PLAN_ARGS[@]}" "${ARGS_SUFFIX[@]}"
else
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "reviewer_family": "%s", "implementer_endpoint": "%s", "verification_author_present": %s, "verification_author_engine": "%s", "verification_author_runner": "%s", "verification_author_effort": "%s", "verification_author_endpoint": "%s", "verification_author_family": "%s", "implementer_family": "%s", "config_path": "%s", "min_panel_size": %s, "on_engine_unavailable": "%s", "reviewer_engine_low_risk": "%s", "reviewer_effort_low_risk": "%s", "on_family_conflict": "%s", "reviewer_fallback_preference": %s, "reviewer_fallback_preference_low_risk": %s'"${READINESS_FMT}""${PLAN_FMT}""${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$(json_escape "$REV_FAMILY")" "$IMPL_ENDPOINT" "$VER_AUTH_PRESENT" "$(json_escape "$VER_AUTH_ENGINE")" "$(json_escape "$VER_AUTH_RUNNER")" "$(json_escape "$VER_AUTH_EFFORT")" "$(json_escape "$VER_AUTH_ENDPOINT")" "$(json_escape "$VER_AUTH_FAMILY")" "$(json_escape "$IMPL_FAMILY")" "$(json_escape "$CONFIG_PATH")" \
    "$MIN_PANEL_SIZE" "$(json_escape "$ON_ENGINE_UNAVAILABLE")" "$(json_escape "$REV_ENGINE_LOW_RISK")" "$REV_EFFORT_LOW_RISK" "$ON_FAMILY_CONFLICT" "$REV_FB_PREF_JSON" "$REV_FB_PREF_LOW_JSON" "${READINESS_ARGS[@]}" "${PLAN_ARGS[@]}" "${ARGS_SUFFIX[@]}"
fi
exit "$ENFORCE_EXIT"
