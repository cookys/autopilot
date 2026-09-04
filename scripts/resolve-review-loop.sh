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
DEF_PLAN_REVIEW="auto"
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
# Two seats the roster gained 2026-08-27 (Board: per-role heterogeneous routing).
# Both default EMPTY = seat unconfigured, which is byte-identical to the previous
# behaviour for every existing roster: `consult` callers hand-type dispatch-review.sh
# argv, and `discuss` has no executable consumer at all yet.
DEF_CONSULT_ENGINE=""
DEF_CONSULT_EFFORT=""
DEF_CONSULT_RUNNER=""
DEF_CONSULT_ENDPOINT=""
DEF_DISCUSS_ENGINE=""
DEF_DISCUSS_EFFORT=""
DEF_DISCUSS_RUNNER=""
DEF_DISCUSS_ENDPOINT=""
# consult_dispatch / discuss_dispatch (v2.34.44+, D6): whether the consult/discuss
# RAIL is live (scripts/dispatch-consult.sh / dispatch-discuss.js), independent of
# whether the seat tuple above is configured. DEFAULT OFF on both — off is today's
# behavior byte-for-byte: the seat stays data a caller may read by hand, no new
# dispatch, no new refusal. The switch-ON qualification gate (role evidence /
# override enforcement) is implemented further below (D7, "the keystone") —
# this field plumbing only defines/reads the switch itself.
DEF_CONSULT_DISPATCH="auto"
DEF_DISCUSS_DISPATCH="off"
DEF_HETERO_REVIEW="auto"
# Board ruling 2026-08-27: dual-seat occupancy by an UNQUALIFIED (override-admitted)
# runner is configurable but DEFAULT CLOSED. See the schema description for why the
# axis is the runner and not the model family.
DEF_ALLOW_DUAL_SEAT="off"
# in-loop reviewer family-conflict policy (engine reviewDiff): fallback = walk the
# cross-family qualified scorecard ladder; block = hard-block (pre-v2.32.25 behavior).
# Garbage → block (fail-closed: the engine treats anything but "fallback" as block).
DEF_ON_FAMILY_CONFLICT="fallback"

# ── UNQUALIFIED RUNNERS (role-admission table) ──────────────────────────────
# A runner listed here is nameable in a roster (its token is in the runner enums)
# but has NO recorded qualification for ANY role. Naming one in a seat is REFUSED
# (exit 3) unless AUTOPILOT_QUALIFICATION_OVERRIDE carries a matching, unexpired
# entry for that engine/runner/role — in which case the seat is admitted, warned
# about on stderr, and recorded in override_admitted_seats.
#
# WHY A DECLARED LIST RATHER THAN A DERIVATION. There is no 1:1 map from runner
# token to harness capability record: cc-shim, anthropic-compatible, qoderclicn,
# kimi and pi have no record at all, so "absent record => unqualified" would
# refuse rosters that ship today, and "absent record => qualified" would mean
# DELETING cursor.json opens the gate. The list is therefore explicit AND
# mechanically reconciled: hooks/tests/resolve-review-loop-role-admission.test.sh
# fails if any runner enum token has a capability record with status "unverified"
# and is missing from this list. Same inline-seed-table + same-commit-ritual shape
# as scripts/check-canonical-invariants.sh.
#
# Today the set is exactly {cursor}: src/harness/capabilities/cursor.json is
# status "unverified", tier H0, all eight capability fields "unverified", and
# Phase 5 (Stage-1 implementer qualification) of the cursor-cli-adaptor plan has
# not run. copilot-cli is also "unverified" but is not a runner enum token.
#
# 🔴 This list is NOT a qualification ledger and membership in a runner enum is
# NOT evidence of anything. The enum says "spellable"; this table says "needs an
# operator override to be routed". ADR-0001: an override is a recorded operator
# decision re-derived from the override file on every resolve — never an
# attestation, never tamper-evidence.
UNQUALIFIED_RUNNERS="cursor"

FIELD=""
SOURCE_TRUST=""
CONFIG_PATH=""
DIFF_LINES=0
PROTECTED_PATH=0
VERIFY_STRENGTH_ARG=""
ORACLE_AVAILABLE=1
SECURITY_SURFACE=0
PRIOR_STATUS="none"
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
    --prior-status) PRIOR_STATUS="${2:-}"; shift 2 ;;
    --security-surface) SECURITY_SURFACE="${2:-}"; shift 2 ;;
    --capability-state) CAPABILITY_STATE="${2:-}"; shift 2 ;;
    --input-bytes) INPUT_BYTES="${2:-0}"; shift 2 ;;
    --store) STORE_PATH="${2:-}"; shift 2 ;;
    --now) NOW_VAL="${2:-}"; shift 2 ;;
    --skill-mode) SKILL_MODE_OVERRIDE="${2:-}"; shift 2 ;;
    --verify-strength)
      VERIFY_STRENGTH_ARG="${2:-}"
      case "$VERIFY_STRENGTH_ARG" in
        weak|medium|strong|inconclusive) : ;;
        *) echo "invalid --verify-strength: $VERIFY_STRENGTH_ARG (must be weak|medium|strong|inconclusive)" >&2; exit 2 ;;
      esac
      shift 2
      ;;
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

if config_has_field "$CONFIG" reviewer_engine; then
  REV_ENGINE="$(read_explicit_field "$CONFIG" reviewer_engine)"
else
  REV_ENGINE="$DEF_REV_ENGINE"
fi
if config_has_field "$CONFIG" reviewer_effort; then
  REV_EFFORT="$(read_explicit_field "$CONFIG" reviewer_effort)"
else
  REV_EFFORT="$DEF_REV_EFFORT"
fi
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
IMPL_LADDER_RAW="$(read_field "$CONFIG" implementer_ladder "")"
LADDER_START_RUNG_JUDGMENT="$(read_field "$CONFIG" ladder_start_rung_judgment "0")"
[[ "$LADDER_START_RUNG_JUDGMENT" =~ ^[01]$ ]] || LADDER_START_RUNG_JUDGMENT="0"
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
    codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn|cursor) ;;
    *)
      echo "resolve-review-loop: invalid verification_author_runner (must be codex|agy|grok|cc-shim|anthropic-compatible|qoderclicn|cursor): $VER_AUTH_RUNNER" >&2
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
HETERO_REVIEW="$(read_field "$CONFIG" hetero_review "$DEF_HETERO_REVIEW")"
PLAN_REV_ENGINE="$(read_field "$CONFIG" plan_reviewer_engine "")"
PLAN_REV_EFFORT="$(read_field "$CONFIG" plan_reviewer_effort "")"
PLAN_REV_RUNNER="$(read_field "$CONFIG" plan_reviewer_runner "")"
PLAN_REV_ENDPOINT="$(read_field "$CONFIG" plan_reviewer_endpoint "")"
PLAN_DEEP_ENGINE="$(read_field "$CONFIG" plan_deep_reviewer_engine "")"
PLAN_DEEP_EFFORT="$(read_field "$CONFIG" plan_deep_reviewer_effort "")"
PLAN_DEEP_RUNNER="$(read_field "$CONFIG" plan_deep_reviewer_runner "")"
PLAN_DEEP_ENDPOINT="$(read_field "$CONFIG" plan_deep_reviewer_endpoint "")"
CONSULT_ENGINE="$(read_field "$CONFIG" consult_engine "$DEF_CONSULT_ENGINE")"
CONSULT_EFFORT="$(read_field "$CONFIG" consult_effort "$DEF_CONSULT_EFFORT")"
CONSULT_RUNNER="$(read_field "$CONFIG" consult_runner "$DEF_CONSULT_RUNNER")"
CONSULT_ENDPOINT="$(read_field "$CONFIG" consult_endpoint "$DEF_CONSULT_ENDPOINT")"
DISCUSS_ENGINE="$(read_field "$CONFIG" discuss_engine "$DEF_DISCUSS_ENGINE")"
DISCUSS_EFFORT="$(read_field "$CONFIG" discuss_effort "$DEF_DISCUSS_EFFORT")"
DISCUSS_RUNNER="$(read_field "$CONFIG" discuss_runner "$DEF_DISCUSS_RUNNER")"
DISCUSS_ENDPOINT="$(read_field "$CONFIG" discuss_endpoint "$DEF_DISCUSS_ENDPOINT")"
CONSULT_DISPATCH="$(read_field "$CONFIG" consult_dispatch "$DEF_CONSULT_DISPATCH")"
DISCUSS_DISPATCH="$(read_field "$CONFIG" discuss_dispatch "$DEF_DISCUSS_DISPATCH")"
ALLOW_DUAL_SEAT="$(read_field "$CONFIG" allow_same_runner_dual_seat "$DEF_ALLOW_DUAL_SEAT")"
PLAN_MAX_GENERATIONS="$(read_field "$CONFIG" plan_review_max_generations "$DEF_PLAN_MAX_GENERATIONS")"
PLAN_MAX_WALL_SECONDS="$(read_field "$CONFIG" plan_review_max_wall_seconds "$DEF_PLAN_MAX_WALL_SECONDS")"
PLAN_GROWTH_WARN_RATIO="$(read_field "$CONFIG" plan_review_growth_warn_ratio "$DEF_PLAN_GROWTH_WARN_RATIO")"
PLAN_GROWTH_STOP_RATIO="$(read_field "$CONFIG" plan_review_growth_stop_ratio "$DEF_PLAN_GROWTH_STOP_RATIO")"

case "$PLAN_REVIEW" in auto|on|off) ;; *)
  echo "resolve-review-loop: invalid plan_review (must be auto|on|off): $PLAN_REVIEW" >&2
  exit 3
esac
case "$HETERO_REVIEW" in auto|on|off) ;; *)
  echo "resolve-review-loop: invalid hetero_review (must be auto|on|off): $HETERO_REVIEW" >&2
  exit 3
esac
case "$PLAN_REV_RUNNER" in ''|codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor) ;; *)
  echo "resolve-review-loop: invalid plan_reviewer_runner: $PLAN_REV_RUNNER" >&2
  exit 3
esac
case "$PLAN_DEEP_RUNNER" in ''|codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|cursor) ;; *)
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
# ── consult / discuss seat validation (same tuple discipline as plan_deep_reviewer:
# wholly empty, or engine+runner+effort all present) ───────────────────────────
for _seat in consult discuss; do
  case "$_seat" in
    consult) _s_eng="$CONSULT_ENGINE"; _s_eff="$CONSULT_EFFORT"; _s_run="$CONSULT_RUNNER"; _s_ep="$CONSULT_ENDPOINT" ;;
    discuss) _s_eng="$DISCUSS_ENGINE"; _s_eff="$DISCUSS_EFFORT"; _s_run="$DISCUSS_RUNNER"; _s_ep="$DISCUSS_ENDPOINT" ;;
  esac
  case "$_s_run" in
    ''|codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor) ;;
    *) echo "resolve-review-loop: invalid ${_seat}_runner: $_s_run" >&2; exit 3 ;;
  esac
  case "$_s_eff" in
    ''|low|medium|high|xhigh|max) ;;
    *) echo "resolve-review-loop: invalid ${_seat}_effort: $_s_eff" >&2; exit 3 ;;
  esac
  [[ -z "$_s_ep" || "$_s_ep" =~ ^[A-Za-z0-9_]+$ ]] || {
    echo "resolve-review-loop: invalid ${_seat}_endpoint: $_s_ep" >&2; exit 3; }
  if [[ -n "$_s_eng" || -n "$_s_run" || -n "$_s_eff" || -n "$_s_ep" ]]; then
    if [[ -z "$_s_eng" || -z "$_s_run" || -z "$_s_eff" ]]; then
      echo "resolve-review-loop: ${_seat} tuple must be wholly empty or include engine, runner, and effort" >&2
      exit 3
    fi
  fi
done

case "$ALLOW_DUAL_SEAT" in
  off|on) ;;
  *)
    echo "resolve-review-loop: invalid allow_same_runner_dual_seat (must be off|on): $ALLOW_DUAL_SEAT" >&2
    exit 3
    ;;
esac

# consult_dispatch / discuss_dispatch (D6 field validation; the switch-ON
# qualification gate over role evidence/overrides lives further below, D7).
case "$CONSULT_DISPATCH" in
  auto|on|off) ;;
  *)
    echo "resolve-review-loop: invalid consult_dispatch (must be auto|on|off): $CONSULT_DISPATCH" >&2
    exit 3
    ;;
esac
case "$DISCUSS_DISPATCH" in
  off|on) ;;
  *)
    echo "resolve-review-loop: invalid discuss_dispatch (must be off|on): $DISCUSS_DISPATCH" >&2
    exit 3
    ;;
esac

# consult_dispatch/discuss_dispatch=on with an empty seat tuple is a
# misconfiguration, never a silent no-op (plan §4 D6, evidence-discipline §14).
# Tuple-presence only here — the switch-on QUALIFICATION gate over role
# evidence (D7) runs later, once the seat rows exist below.
if [[ "$CONSULT_DISPATCH" == "on" && ( -z "$CONSULT_ENGINE" || -z "$CONSULT_RUNNER" || -z "$CONSULT_EFFORT" ) ]]; then
  echo "resolve-review-loop: consult_dispatch=on requires consult_engine, consult_runner, and consult_effort" >&2
  exit 3
fi
if [[ "$DISCUSS_DISPATCH" == "on" && ( -z "$DISCUSS_ENGINE" || -z "$DISCUSS_RUNNER" || -z "$DISCUSS_EFFORT" ) ]]; then
  echo "resolve-review-loop: discuss_dispatch=on requires discuss_engine, discuss_runner, and discuss_effort" >&2
  exit 3
fi

if [[ "$HETERO_REVIEW" == "on" && ( -z "$REV_ENGINE" || -z "$REV_RUNNER" || -z "$REV_EFFORT" ) ]]; then
  echo "resolve-review-loop: hetero_review=on requires reviewer_engine, reviewer_runner, and reviewer_effort" >&2
  exit 3
fi

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
# Deliberate, recorded escape from strict /l5 byte-equal policy coverage.
# Empty = off (fail-closed, unchanged). Non-empty = the operator's reason, which
# provider-bootstrap surfaces on every derivation and records in the result.
STRICT_L5_POLICY_OVERRIDE="$(read_field "$CONFIG" strict_l5_policy_override "")"
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
    *kimi*|*moonshot*)                       echo moonshot ;;
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
      codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor) ;;
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
  codex|auto|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor) ;;
  *)
    echo "resolve-review-loop: invalid reviewer_runner (must be codex|auto|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor): ${REV_RUNNER:-<empty>}" >&2
    exit 3
    ;;
esac
case "$REV_EFFORT" in low|medium|high|xhigh|max) ;; *) REV_EFFORT="$DEF_REV_EFFORT" ;; esac
case "$IMPL_EFFORT" in low|medium|high|xhigh|max) ;; *) IMPL_EFFORT="$DEF_IMPL_EFFORT" ;; esac
case "$IMPL_RUNNER" in
  auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode) ;;
  *)
    echo "resolve-review-loop: invalid implementer_runner (must be auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode): ${IMPL_RUNNER:-<empty>}" >&2
    exit 3
    ;;
esac
# Optional implementer_ladder: comma list of engine/effort@runner, or 'auto'. Absent/empty
# ⇒ [] (the three implementer_* fields remain the single implicit rung).
CAP_WARNINGS_JSON="[]"
IMPL_LADDER_JSON="[]"
if [[ "$IMPL_LADDER_RAW" == "auto" ]]; then
  _topo_file="${AUTOPILOT_TOPOLOGY_FILE:-$HOME/.autopilot/topology.json}"
  # Exit protocol: 0 + JSON array on stdout = valid non-empty ladder; 2 = topology
  # file exists but implementer_ladder is empty/absent (keep implicit rung, warn);
  # 1 = no readable/parseable topology file at all (keep implicit rung, warn);
  # 3 + error message on stdout = a rung's runner failed the same enum check the
  # comma-list path applies (a stale topology file must not smuggle an invalid
  # runner past the resolver).
  _auto_ladder="$(node -e '
const fs = require("fs");
const VALID_RUNNERS = new Set(["auto","codex","agy","grok","cc-shim","pi","qoderclicn","cursor","opencode"]);
const file = process.argv[1];
let raw;
try {
  raw = fs.readFileSync(file, "utf8");
} catch {
  process.exit(1);
}
let doc;
try {
  doc = JSON.parse(raw);
} catch {
  process.exit(1);
}
if (!Array.isArray(doc.implementer_ladder) || doc.implementer_ladder.length === 0) {
  process.exit(2);
}
const rungs = doc.implementer_ladder.map((r) => ({
  engine: r.engine,
  effort: r.effort,
  runner: r.runner,
}));
for (const r of rungs) {
  if (!VALID_RUNNERS.has(r.runner)) {
    process.stdout.write(
      "invalid implementer_ladder runner (must be auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode): " +
      r.engine + "/" + r.effort + "@" + r.runner
    );
    process.exit(3);
  }
}
process.stdout.write(JSON.stringify(rungs));
process.exit(0);
' "$_topo_file" 2>/dev/null)"
  _auto_status=$?
  case "$_auto_status" in
    0)
      IMPL_LADDER_JSON="$_auto_ladder"
      ;;
    3)
      echo "resolve-review-loop: ${_auto_ladder}" >&2
      exit 3
      ;;
    2)
      IMPL_LADDER_JSON="[]"
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "implementer_ladder auto: no qualified hetero implementer on this host — hands run native (haiku→sonnet), see claude_fallback_ladder" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
      ;;
    *)
      IMPL_LADDER_JSON="[]"
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "implementer_ladder auto: no host topology (run scripts/resolve-dispatch-topology.js)" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
      ;;
  esac
elif [[ -n "$IMPL_LADDER_RAW" ]]; then
  IMPL_LADDER_JSON="["
  _ladder_first=1
  _ladder_work="${IMPL_LADDER_RAW},"
  while [[ -n "$_ladder_work" ]]; do
    _item="${_ladder_work%%,*}"
    _ladder_work="${_ladder_work#*,}"
    _item="${_item#"${_item%%[![:space:]]*}"}"
    _item="${_item%"${_item##*[![:space:]]}"}"
    [[ -z "$_item" ]] && continue
    # engine may itself contain "/" (opencode provider/model ids such as
    # opencode-go/muse-spark-1.3-contributor): the greedy first group splits at the LAST "/".
    if [[ ! "$_item" =~ ^([^@[:space:]]+)/([^/@[:space:]]+)@([^/@[:space:]]+)$ ]]; then
      echo "resolve-review-loop: invalid implementer_ladder item (expected engine/effort@runner): ${_item}" >&2
      exit 3
    fi
    _le="${BASH_REMATCH[1]}"
    _lf="${BASH_REMATCH[2]}"
    _lr="${BASH_REMATCH[3]}"
    case "$_lf" in
      low|medium|high|xhigh|max) ;;
      *)
        echo "resolve-review-loop: invalid implementer_ladder effort (must be low|medium|high|xhigh|max): ${_item}" >&2
        exit 3
        ;;
    esac
    case "$_lr" in
      auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode) ;;
      *)
        echo "resolve-review-loop: invalid implementer_ladder runner (must be auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode): ${_item}" >&2
        exit 3
        ;;
    esac
    if [[ "$_ladder_first" -eq 1 ]]; then
      _ladder_first=0
    else
      IMPL_LADDER_JSON+=", "
    fi
    IMPL_LADDER_JSON+="{\"engine\": \"$(json_escape "$_le")\", \"effort\": \"${_lf}\", \"runner\": \"${_lr}\"}"
  done
  IMPL_LADDER_JSON+="]"
  [[ "$_ladder_first" -eq 1 ]] && IMPL_LADDER_JSON="[]"
fi

PLAN_REVIEW_RESOLVED_FROM=""
HETERO_REVIEW_RESOLVED_FROM=""
CONSULT_RESOLVED_FROM=""

if [[ "$PLAN_REVIEW" == "auto" || "$HETERO_REVIEW" == "auto" || "$CONSULT_DISPATCH" == "auto" ]]; then
  _topo_file="${AUTOPILOT_TOPOLOGY_FILE:-$HOME/.autopilot/topology.json}"
  _auto_out="$(node -e '
const fs = require("fs");
const file = process.argv[1];
let raw;
try {
  raw = fs.readFileSync(file, "utf8");
} catch {
  process.exit(1);
}
let doc;
try {
  doc = JSON.parse(raw);
} catch {
  process.exit(1);
}
const res = {
  plan_review_panel: Array.isArray(doc.plan_review_panel) ? doc.plan_review_panel : [],
  reviewer_ladder: Array.isArray(doc.reviewer_ladder) ? doc.reviewer_ladder : [],
  consult_ladder: Array.isArray(doc.consult_ladder) ? doc.consult_ladder : []
};
process.stdout.write(JSON.stringify(res));
process.exit(0);
' "$_topo_file" 2>/dev/null)"
  _topo_ok=$?
  _topo_json="$_auto_out"

  if [[ "$PLAN_REVIEW" == "auto" ]]; then
    _seat0_json=""
    _seat1_json=""
    if [[ "$_topo_ok" -eq 0 && -n "$_topo_json" ]]; then
      _seats_extracted="$(node -e '
try {
  const d = JSON.parse(process.argv[1]);
  const implRunner = process.argv[2] || "";
  const p = d.plan_review_panel;
  if (Array.isArray(p) && p.length >= 1) {
    // Skip any panel seat that would collide with the resolved implementer
    // runner under the same-runner-dual-seat guard (a plan_reviewer seat is
    // a loop review seat like any other for that guard). "auto" is not a
    // rail identity and never collides. Fall through to the next panel
    // seat; when none survive, the caller falls back to native.
    const survivors = p.filter((seat) => {
      const r = seat && seat.runner;
      if (!r) return true;
      if (!implRunner || implRunner === "auto") return true;
      return r !== implRunner;
    });
    if (survivors.length >= 1) {
      const s0 = survivors[0] || {};
      const s1 = survivors.length >= 2 ? (survivors[1] || {}) : null;
      process.stdout.write(JSON.stringify({ s0, s1 }));
      process.exit(0);
    }
  }
} catch {}
process.exit(1);
' "$_topo_json" "$IMPL_RUNNER" 2>/dev/null)"
      if [[ $? -eq 0 && -n "$_seats_extracted" ]]; then
        _seat0_json="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).s0))' "$_seats_extracted" 2>/dev/null)"
        _seat1_json="$(node -e 'const s1 = JSON.parse(process.argv[1]).s1; process.stdout.write(s1 ? JSON.stringify(s1) : "");' "$_seats_extracted" 2>/dev/null)"
      fi
    fi

    if [[ -n "$_seat0_json" ]]; then
      PLAN_REV_ENGINE="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).engine || ""))' "$_seat0_json" 2>/dev/null)"
      PLAN_REV_EFFORT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).effort || ""))' "$_seat0_json" 2>/dev/null)"
      PLAN_REV_RUNNER="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).runner || ""))' "$_seat0_json" 2>/dev/null)"
      PLAN_REV_ENDPOINT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).endpoint || ""))' "$_seat0_json" 2>/dev/null)"

      if [[ -n "$_seat1_json" ]]; then
        PLAN_DEEP_ENGINE="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).engine || ""))' "$_seat1_json" 2>/dev/null)"
        PLAN_DEEP_EFFORT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).effort || ""))' "$_seat1_json" 2>/dev/null)"
        PLAN_DEEP_RUNNER="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).runner || ""))' "$_seat1_json" 2>/dev/null)"
        PLAN_DEEP_ENDPOINT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).endpoint || ""))' "$_seat1_json" 2>/dev/null)"
      fi
      PLAN_REVIEW_RESOLVED_FROM="topology"
    else
      PLAN_REV_ENGINE="opus"
      PLAN_REV_EFFORT="high"
      PLAN_REV_RUNNER="claude-native"
      PLAN_REV_ENDPOINT=""
      PLAN_REVIEW_RESOLVED_FROM="native-fallback"
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
    fi
  fi

  if [[ "$HETERO_REVIEW" == "auto" ]]; then
    _has_rev_ladder=0
    if [[ "$_topo_ok" -eq 0 && -n "$_topo_json" ]]; then
      node -e '
try {
  const d = JSON.parse(process.argv[1]);
  if (Array.isArray(d.reviewer_ladder) && d.reviewer_ladder.length >= 1) {
    process.exit(0);
  }
} catch {}
process.exit(1);
' "$_topo_json" 2>/dev/null && _has_rev_ladder=1
    fi

    if [[ "$_has_rev_ladder" -eq 1 ]]; then
      HETERO_REVIEW_RESOLVED_FROM="topology"
    else
      HETERO_REVIEW_RESOLVED_FROM="native-fallback"
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
    fi
  fi

  if [[ "$CONSULT_DISPATCH" == "auto" ]]; then
    _consult_picked=""
    if [[ "$_topo_ok" -eq 0 && -n "$_topo_json" ]]; then
      _qc_panel_arg="${QC_PANEL[*]:-}"
      _qc_panel_runners_arg="${QC_PANEL_RUNNERS[*]:-}"
      _qc_panel_efforts_arg="${QC_PANEL_EFFORTS[*]:-}"
      _consult_picked="$(node -e '
try {
  const d = JSON.parse(process.argv[1]);
  const ladder = d.consult_ladder;
  if (!Array.isArray(ladder) || ladder.length === 0) process.exit(1);

  const qcPanels = (process.argv[2] || "").split(" ").filter(Boolean);
  const qcRunners = (process.argv[3] || "").split(" ").filter(Boolean);
  const qcEfforts = (process.argv[4] || "").split(" ").filter(Boolean);
  const implRunner = process.argv[5] || "";

  const excluded = new Set();
  const maxIdx = Math.min(qcPanels.length, qcRunners.length, qcEfforts.length);
  for (let i = 0; i < maxIdx; i++) {
    const eng = qcPanels[i];
    const run = qcRunners[i];
    const eff = qcEfforts[i];
    if (run && eff) {
      excluded.add(`${eng}|${run}|${eff}`);
    }
  }

  for (const entry of ladder) {
    if (!entry || !entry.engine || !entry.runner || !entry.effort) continue;
    // Skip any ladder seat that would collide with the resolved implementer
    // runner under the same-runner-dual-seat guard — consult is a loop
    // review seat like any other for that guard. "auto" is not a rail
    // identity and never collides.
    if (implRunner && implRunner !== "auto" && entry.runner === implRunner) continue;
    const key = `${entry.engine}|${entry.runner}|${entry.effort}`;
    if (!excluded.has(key)) {
      process.stdout.write(JSON.stringify(entry));
      process.exit(0);
    }
  }
} catch {}
process.exit(1);
' "$_topo_json" "$_qc_panel_arg" "$_qc_panel_runners_arg" "$_qc_panel_efforts_arg" "$IMPL_RUNNER" 2>/dev/null)"
    fi

    if [[ -n "$_consult_picked" ]]; then
      CONSULT_ENGINE="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).engine || ""))' "$_consult_picked" 2>/dev/null)"
      CONSULT_EFFORT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).effort || ""))' "$_consult_picked" 2>/dev/null)"
      CONSULT_RUNNER="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).runner || ""))' "$_consult_picked" 2>/dev/null)"
      CONSULT_ENDPOINT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).endpoint || ""))' "$_consult_picked" 2>/dev/null)"
      CONSULT_RESOLVED_FROM="topology"
    else
      CONSULT_ENGINE="sonnet"
      CONSULT_EFFORT="high"
      CONSULT_RUNNER="claude-native"
      CONSULT_ENDPOINT=""
      CONSULT_RESOLVED_FROM="native-fallback"
      CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
    fi
  fi
fi

if [[ "$PLAN_REVIEW" == "on" ]]; then
  PLAN_REVIEW_RESOLVED_FROM="explicit"
elif [[ "$PLAN_REVIEW" == "off" ]]; then
  PLAN_REVIEW_RESOLVED_FROM="off"
fi

if [[ "$HETERO_REVIEW" == "on" ]]; then
  HETERO_REVIEW_RESOLVED_FROM="explicit"
elif [[ "$HETERO_REVIEW" == "off" ]]; then
  HETERO_REVIEW_RESOLVED_FROM="off"
fi

if [[ "$CONSULT_DISPATCH" == "on" ]]; then
  CONSULT_RESOLVED_FROM="explicit"
elif [[ "$CONSULT_DISPATCH" == "off" ]]; then
  CONSULT_RESOLVED_FROM="off"
fi
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
# --prior-status no_verdict|ambiguous (four-layer P2, cascade): a prior review round that
# produced no usable verdict elevates risk to high, reusing the SAME families/cross-family
# escalation path — the next round seats a fresh disjoint-family reviewer instead of retrying
# the identical seat. Producer: the engine review-args assembly on round N+1. Default `none`
# is byte-identical to previous behavior (pinned by fixture in autopilot-cli.test.sh).
case "$PRIOR_STATUS" in none|no_verdict|ambiguous) ;; *) echo "invalid --prior-status: $PRIOR_STATUS (must be none|no_verdict|ambiguous)" >&2; exit 2 ;; esac
if [[ "$PRIOR_STATUS" == "no_verdict" || "$PRIOR_STATUS" == "ambiguous" ]]; then
  SOURCE_TRUST="low"
fi
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
    // Calendar tooth (b) pulled 2026-08-22 (no-confidence-decay P2): the tier
    // decision keys on the strike-decay projection admission_status, never
    // on a calendar date or the legacy TTL-derived status literal. expiry
    // warning (advisory-only) never changes the tier.
    if (row.admission_status === "requalify_required") {
      process.stdout.write("low");
    } else if (row.status === "failed") {
      process.stdout.write("low");
    } else if (row.status === "qualified"
        && row.authority_status === "session_local"
        && row.admissible === true) {
      process.stdout.write("high");
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

# D7 A13 — verify_strength as a density input (fail-safe: unknown/inconclusive → weak).
# Does not emit a new always-on schema key (schemas/ is frozen); folds into loop_max_rounds
# and l1_required. Protected-path / source-trust minima never reduce.
VERIFY_STRENGTH="$(read_field "$CONFIG" verify_strength "")"
if [[ -n "$VERIFY_STRENGTH_ARG" ]]; then
  VERIFY_STRENGTH="$VERIFY_STRENGTH_ARG"
fi
case "$VERIFY_STRENGTH" in
  weak|medium|strong|inconclusive) : ;;
  '' ) VERIFY_STRENGTH="" ;;
  *) VERIFY_STRENGTH="weak" ;; # invalid → weakest
esac
if [[ -n "$VERIFY_STRENGTH" ]]; then
  case "$VERIFY_STRENGTH" in
    weak|inconclusive)
      # More review: +1 loop, never below user base after other scalers.
      MAX_ROUNDS=$(( MAX_ROUNDS + 1 ))
      [[ "$MAX_ROUNDS" -gt 7 ]] && MAX_ROUNDS=7
      L1_REQUIRED="true"
      DENSITY_SCALED="true"
      ;;
    medium)
      # Neutral — no reduction, no increase.
      :
      ;;
    strong)
      # At most -1 loop, and NEVER when protected-path or low source-trust.
      if [[ "$PROTECTED_PATH" -eq 0 && "$SOURCE_TRUST" != "low" && "$SECURITY_SURFACE" -eq 0 ]]; then
        if [[ "$MAX_ROUNDS" -gt 1 ]]; then
          MAX_ROUNDS=$(( MAX_ROUNDS - 1 ))
          DENSITY_SCALED="true"
        fi
      fi
      # Strong never clears l1_required that was already set by protected-path/high risk.
      ;;
  esac
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

  _early_cap_warnings="$CAP_WARNINGS_JSON"
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
  if [[ -n "$_early_cap_warnings" && "$_early_cap_warnings" != "[]" ]]; then
    CAP_WARNINGS_JSON="$(node -e '
let cur = [], early = [];
try { cur = JSON.parse(process.argv[1]); } catch { cur = []; }
try { early = JSON.parse(process.argv[2]); } catch { early = []; }
if (!Array.isArray(cur)) cur = [];
if (!Array.isArray(early)) early = [];
for (const w of early) {
  if (!cur.includes(w)) cur.push(w);
}
process.stdout.write(JSON.stringify(cur));
' "$CAP_WARNINGS_JSON" "$_early_cap_warnings" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
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

# --- implementer scorecard admissibility (REPORT-ONLY, --check-scorecard only) ---
# BACKLOG "Implementer scorecard lapses on runner-version drift, silently degrading
# every /l5": dispatch-contract.js check NO-GOes on an expired/failed implementer row
# and the foreman then degrades L5→inline with no roster-time signal. Surface the
# fact HERE, where the /l5 preflight already looks — same capability_warnings posture
# as the quota and context-window facts above (the resolver reports, the consumer
# decides per on_engine_unavailable).
if [[ "$CHECK_SCORECARD" -eq 1 ]]; then
  _impl_rows="$(node "$SCRIPT_DIR/engine-scorecard.js" current --role implementer 2>/dev/null || true)"
  _impl_warn="$(printf '%s' "$_impl_rows" | node -e '
const engine = process.argv[1];
const runner = process.argv[2];
const overrideFile = process.argv[3] || "";
const fs = require("fs");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let rows = null;
  try { rows = JSON.parse(s); } catch { rows = null; }
  if (!Array.isArray(rows)) {
    process.stdout.write(
      `implementer seat (${engine}/${runner}) is not admissible: scorecard store unreadable — /l5 dispatch-contract will NO-GO; requalify via engine-onboarding`,
    );
    return;
  }
  const row = rows.find((r) => r && String(r.engine) === engine
    && (runner === "auto" || String(r.runner) === runner));
  const admissible = row && (row.status === "qualified"
    || (row.status === "provisional" && row.observed_status === "qualified"));
  if (admissible) return;
  // P7/KR6: an explicit operator override file (AUTOPILOT_QUALIFICATION_OVERRIDE)
  // covering the tuple flips the warning from refusal guidance to a LOUD
  // evidence-free-admission notice — never silent, never a third path.
  if (overrideFile && fs.existsSync(overrideFile)) {
    try {
      const doc = JSON.parse(fs.readFileSync(overrideFile, "utf8"));
      const today = new Date().toISOString().slice(0, 10);
      const isCalendarDate = (value) => typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
        && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
      const match = doc && doc.schema === 1 && Array.isArray(doc.overrides)
        ? doc.overrides.find((o) => o && o.engine === engine
          && (runner === "auto" || o.runner === runner)
          && o.role === "implementer"
          && typeof o.reason === "string" && o.reason.trim()
          && typeof o.operator === "string" && o.operator.trim()
          && isCalendarDate(o.expires) && o.expires >= today)
        : null;
      if (match) {
        process.stdout.write(
          `implementer seat (${engine}/${runner}) runs on an EVIDENCE-FREE operator override (reason: ${match.reason}; expires ${match.expires}) — pass --qualification-override to dispatch-contract check`,
        );
        return;
      }
    } catch { /* unreadable override never admits */ }
  }
  const detail = row ? `scorecard row status=${row.status}` : "no scorecard row";
  process.stdout.write(
    `implementer seat (${engine}/${runner}) is not admissible: ${detail} — /l5 dispatch-contract will NO-GO; requalify via engine-onboarding or provide a per-invocation qualification override`,
  );
});' "$IMPL_ENGINE" "$IMPL_RUNNER" "${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" 2>/dev/null || true)"
  if [[ -n "$_impl_warn" ]]; then
    CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "$_impl_warn" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
  fi
fi

# ── Brain-seat standing (P7/KR4, plan 2026-08-17-brain-seat-exam-suite P4) ─────────
# Canonical seat context: the pinned incumbent identity file comes from config
# (brain_seat_identity_file); a proposed non-incumbent identity arrives via
# AUTOPILOT_BRAIN_SEAT_IDENTITY. Three-way standing (no_record / qualified /
# requalification_required); both non-qualified states = absence of standing —
# the per-invocation override STILL admits (two-path rule); only absence AND no
# override refuses (candidate) or loudly annotates (incumbent, Board 2026-08-16
# advisory bootstrap semantics).
BRAIN_SEAT_JSON='null'
BRAIN_IDENTITY_FILE="$(read_field "$CONFIG" brain_seat_identity_file "")"
# Seat-pin scope guard (review 2026-08-17 MUST-FIX): a brain seat is per-project
# governance. Only a config the CALLER owns may seat one — an explicit override
# or the caller-cwd project config. When the ladder fell back to the autopilot
# repo's own config (SOURCE=project-repo) or the template, the pin must NOT
# project onto the consumer (it would announce the maintainer's seat, and its
# relative path would resolve against the wrong cwd).
case "$SOURCE" in
  override|project-cwd) ;;
  *) BRAIN_IDENTITY_FILE="" ;;
esac
# A relative pin resolves against the CONFIG's own directory (the file travels
# with the config that declares it), never against the caller's cwd.
if [[ -n "$BRAIN_IDENTITY_FILE" && "$BRAIN_IDENTITY_FILE" != /* ]]; then
  BRAIN_IDENTITY_FILE="$(cd "$(dirname -- "$CONFIG")" 2>/dev/null && pwd -P)/../$BRAIN_IDENTITY_FILE"
fi
PROPOSED_BRAIN_IDENTITY="${AUTOPILOT_BRAIN_SEAT_IDENTITY:-}"
if [[ -n "$BRAIN_IDENTITY_FILE" || -n "$PROPOSED_BRAIN_IDENTITY" ]]; then
  _brain_seat_class="incumbent"
  _brain_ident="$BRAIN_IDENTITY_FILE"
  if [[ -n "$PROPOSED_BRAIN_IDENTITY" && "$PROPOSED_BRAIN_IDENTITY" != "$BRAIN_IDENTITY_FILE" ]]; then
    _brain_seat_class="candidate"
    _brain_ident="$PROPOSED_BRAIN_IDENTITY"
  fi
  _brain_status_json="$(node "$SCRIPT_DIR/engine-capability-state.js" brain-status --identity-file "$_brain_ident" 2>/dev/null || true)"
  _brain_eval="$(node -e '
const fs = require("fs");
let status = null;
try { status = JSON.parse(process.argv[1]); } catch { status = null; }
const seatClass = process.argv[2];
const overrideFile = process.argv[3] || "";
let identity = null;
try { identity = JSON.parse(fs.readFileSync(process.argv[4], "utf8")); } catch { identity = null; }
const standing = status && status.status === "qualified";
const state = status ? status.status : "status_unavailable";
let admission = "admitted";
let warning = "";
if (!standing) {
  let override = null;
  if (overrideFile && fs.existsSync(overrideFile) && identity) {
    try {
      const doc = JSON.parse(fs.readFileSync(overrideFile, "utf8"));
      const today = new Date().toISOString().slice(0, 10);
      override = doc && doc.schema === 1 && Array.isArray(doc.overrides)
        ? doc.overrides.find((o) => o && o.role === "owner"
          && (o.engine === identity.model_alias || o.engine === identity.identity)
          && typeof o.reason === "string" && o.reason.trim()
          && typeof o.expires === "string" && o.expires >= today)
        : null;
    } catch { override = null; }
  }
  if (override) {
    admission = "override_admitted";
    warning = `brain seat (${seatClass}) runs on an EVIDENCE-FREE operator override (reason: ${override.reason}; expires ${override.expires}) — standing status: ${state}`;
  } else if (seatClass === "candidate") {
    admission = "refused";
    warning = `brain seat (candidate) REFUSED: standing status ${state} — the two legal paths are a standing exam pass (engine-qualify.sh brain) or a per-invocation qualification override (AUTOPILOT_QUALIFICATION_OVERRIDE, role owner)`;
  } else {
    admission = "advisory";
    warning = `brain seat (incumbent) has NO standing qualification (status ${state}) — advisory per Board 2026-08-16 bootstrap semantics; sit the exam (engine-qualify.sh brain) or provide a per-invocation override`;
  }
}
process.stdout.write(JSON.stringify({
  brain_seat: {
    seat_class: seatClass,
    status: state,
    admission,
    strikes_since_pass: status ? status.strikes_since_pass : null,
  },
  warning,
}));
' "$_brain_status_json" "$_brain_seat_class" "${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" "$_brain_ident" 2>/dev/null || printf '{"brain_seat":null,"warning":""}')"
  BRAIN_SEAT_JSON="$(printf '%s' "$_brain_eval" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.stringify(JSON.parse(s).brain_seat));}catch{process.stdout.write("null");}})' 2>/dev/null || printf 'null')"
  _brain_warn="$(printf '%s' "$_brain_eval" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).warning||"");}catch{}})' 2>/dev/null || true)"
  if [[ -n "$_brain_warn" ]]; then
    CAP_WARNINGS_JSON="$(node -e '
let a = [];
try { a = JSON.parse(process.argv[1]); } catch { a = []; }
if (!Array.isArray(a)) a = [];
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));
' "$CAP_WARNINGS_JSON" "$_brain_warn" 2>/dev/null || printf '%s' "$CAP_WARNINGS_JSON")"
  fi
  # Refusal ENFORCEMENT rides the shipped --enforce rail (report-mode emits JSON and
  # the CALLER enforces; with --enforce the resolver itself is the gate — same split
  # every other admission signal uses). A refused candidate seating exits 3.
  if [[ "$ENFORCE" == "1" ]]; then
    _brain_admission="$(printf '%s' "$BRAIN_SEAT_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).admission||"");}catch{}})' 2>/dev/null || true)"
    [[ "$_brain_admission" == "refused" ]] && ENFORCE_EXIT=3
  fi
fi

# NOTE (first-pass qc 🔴 admission-field-bypass): this block MUST run BEFORE the
# --field dispatch below. It originally sat just above the JSON emission, which meant
# `--field reviewer_runner` on an unqualified roster returned "cursor" with exit 0 and no
# refusal at all — and the documented consult caller in references/hetero-dispatch.md reads
# the seat with exactly that flag, so the gate was bypassed by its own recipe. Field mode is
# a read of the SAME resolved roster; it must be refused on the same terms as the JSON.
# Every input it needs is already computed by here (families at ~692, qc panel arrays ~530).
# ══ ROLE ADMISSION (Board ruling 2026-08-27) ══════════════════════════════════
# A seat whose runner is in UNQUALIFIED_RUNNERS is REFUSED unless the operator
# override file names that exact engine/runner/role and has not expired. Refusal
# is exit 3, not a warning: unlike the implementer seat — whose admissibility is
# reported here and ENFORCED downstream by dispatch-contract.js — the
# reviewer-class, consult and discuss seats have NO mechanical enforcing caller,
# so a report-only refusal would be the quiet bypass Ruling 1 forbids. The
# resolver is the enforcer for those seats.
#
# The override contract is the SAME file and the SAME shape the implementer
# admissibility block already consumes (AUTOPILOT_QUALIFICATION_OVERRIDE, schema
# 1, overrides[] with engine/runner/role/reason/operator/expires) — no new
# concept, no new file, no new vocabulary.
OVERRIDE_ADMITTED_JSON="[]"
SAME_RUNNER_DUAL_SEAT="false"

_seat_roles=()
_seat_runners=()
_seat_engines=()
# Effort is part of the seat identity (v2.35.9): a seat qualified at one effort must not answer
# for another. Real data — grok-4.6@high FAILED, grok-4.6@low QUALIFIED — collapsed to one seat
# under the old three-field identity. An EMPTY effort here means the legacy partition (rows
# recorded before effort partitioning), which is a distinct seat, not a wildcard.
_seat_efforts=()
_add_seat() {
  _seat_roles+=("$1"); _seat_engines+=("$2"); _seat_runners+=("$3"); _seat_efforts+=("${4:-}")
}

# EVERY SELECTABLE ENGINE gets a seat row. "Selectable" means the resolver can
# hand this engine to a dispatcher on some code path — not merely "is the primary
# tuple". Ruling 1 is per exact engine + runner + ROLE, so an override for one
# engine must never admit a sibling engine that happens to share the runner.
_add_seat "reviewer" "$REV_ENGINE" "$REV_RUNNER" "$REV_EFFORT"
# depth-0 panel 🔴 #1: the risk-tiered overlay is a SECOND selectable reviewer
# engine on the same runner, and it was never gated. A roster could carry an
# override for the primary reviewer engine and put a completely unqualified,
# unoverridden engine in reviewer_engine_low_risk — which the resolver then
# emits for every low-risk round. It is the reviewer ROLE (wantRole normalizes
# the _low_risk suffix away), so the operator writes role "reviewer" and must
# list EACH engine separately. That is the point: per exact engine.
[[ -n "$REV_ENGINE_LOW_RISK" ]] && _add_seat "reviewer_low_risk" "$REV_ENGINE_LOW_RISK" "$REV_RUNNER" "$REV_EFFORT_LOW_RISK"
_add_seat "implementer" "$IMPL_ENGINE" "$IMPL_RUNNER" "$IMPL_EFFORT"
[[ "$VER_AUTH_PRESENT" == "true" ]] && _add_seat "verification_author" "$VER_AUTH_ENGINE" "$VER_AUTH_RUNNER" "$VER_AUTH_EFFORT"
[[ -n "$PLAN_REV_RUNNER" ]] && _add_seat "plan_reviewer" "$PLAN_REV_ENGINE" "$PLAN_REV_RUNNER" "$PLAN_REV_EFFORT"
[[ -n "$PLAN_DEEP_RUNNER" ]] && _add_seat "plan_deep_reviewer" "$PLAN_DEEP_ENGINE" "$PLAN_DEEP_RUNNER" "$PLAN_DEEP_EFFORT"
[[ -n "$CONSULT_RUNNER" ]] && _add_seat "consult" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT"
[[ -n "$DISCUSS_RUNNER" ]] && _add_seat "discuss" "$DISCUSS_ENGINE" "$DISCUSS_RUNNER" "$DISCUSS_EFFORT"
# depth-0 panel 🔴 #2: panel seats used to be gated only when
# QC_PANEL_SEATS_COMPLETE was true, so a cursor seat sitting next to ONE ragged
# or invalid sibling was skipped entirely and resolved clean. An aggregate
# validity flag must never be the precondition for a per-seat security check —
# the incomplete panel is exactly when a bad seat is most likely present. Every
# PARSED seat is now inspected on its own: walk the union of the engine and
# runner index sets so a ragged array cannot hide a row, and gate any index that
# names a runner at all.
_qc_max=${#QC_PANEL[@]}
[[ ${#QC_PANEL_RUNNERS[@]} -gt $_qc_max ]] && _qc_max=${#QC_PANEL_RUNNERS[@]}
# _panel_div_runners drives the runner-DIVERSITY rule below and is deliberately
# NOT the same set as the admission rows. A ragged index that carries a runner but
# no engine is an unusable orphan: it cannot review anything. Counting it as a
# panel seat would let it dilute the overlap ratio — every engine-bearing seat
# could sit on the implementer's own rail while one orphan runner kept
# overlap < total, downgrading a TOTAL loss of runner decorrelation to a warning.
# (Found by re-review of the round-2 fixes; reproduced before fixing.) Admission
# still walks the union, because an orphan row can still NAME an unqualified rail
# and must be refused on that ground.
_panel_div_runners=""
for (( _i = 0; _i < _qc_max; _i++ )); do
  _qc_run="${QC_PANEL_RUNNERS[$_i]:-}"
  [[ -n "$_qc_run" ]] || continue
  _qc_eng="${QC_PANEL[$_i]:-}"
  _add_seat "qc_panel[$_i]" "${_qc_eng:-<unspecified>}" "$_qc_run" "${QC_PANEL_EFFORTS[$_i]:-}"
  [[ -n "$_qc_eng" ]] && _panel_div_runners="$_panel_div_runners $_qc_run"
done

# A seat is "reviewer-class" when its judgement is the thing being decorrelated
# from the implementer's work. Everything that is not the implementer seat is.
_is_unqualified_runner() {
  local r="$1" u
  for u in $UNQUALIFIED_RUNNERS; do [[ "$u" == "$r" ]] && return 0; done
  return 1
}

# ── D7: the switch-on qualification gate (plan 2026-08-28-consult-discuss-
# qualification.md D7, "the keystone") ─────────────────────────────────────
# When consult_dispatch/discuss_dispatch is "on", that role's seat must
# additionally satisfy ONE of: (a) a recorded, non-demoted role-qualification
# row for the exact {engine,runner,role}, or (b) an unexpired operator
# override — same file/shape/vocabulary the block below already consumes.
# This is STRICTLY ADDITIONAL and INERT when the switch is off: a consult/
# discuss seat only enters this gate at all when its own switch is "on";
# every other seat (and every consult/discuss seat with its switch off)
# keeps exactly today's UNQUALIFIED_RUNNERS-only behavior below, unchanged.
#
# The listed-runner clause: when the switch is on, a matching qualification
# row ALSO satisfies the existing listed-runner (UNQUALIFIED_RUNNERS)
# admission check for that same seat — otherwise a genuinely-qualified
# cursor seat would still be refused for lack of an override, making an exam
# pass decorative for the one runner the gate already refuses (plan D7,
# cases xv/xvi).
_consult_discuss_switch_on() {
  local role="$1"
  [[ "$role" == "consult" && "$CONSULT_DISPATCH" == "on" ]] && return 0
  [[ "$role" == "discuss" && "$DISCUSS_DISPATCH" == "on" ]] && return 0
  return 1
}

# Returns via globals: _QUALROW_RESULT ("admit" | "no-row" | "scope-fail")
# and _QUALROW_JSON (the seat-status projection, when _QUALROW_RESULT=admit).
# "scope-fail" is a HARD refusal — the frozen applicability-scope manifest
# could not be derived — and is never treated as "no row found": the gate
# never silently skips the scope check (plan D7, case xix).
_try_qualification_row() {
  # $4 is the seat's effort partition. EMPTY means the legacy partition (rows recorded before
  # effort was part of the seat identity) — it is a distinct seat, never a wildcard, so an empty
  # effort must not be passed to --effort at all.
  local role="$1" eng="$2" run="$3" eff="${4:-}"
  _QUALROW_RESULT="no-row"
  _QUALROW_JSON=""
  local scope_file err_file
  scope_file="$(mktemp "${TMPDIR:-/tmp}/qual-scope.XXXXXX")" || { _QUALROW_RESULT="scope-fail"; return; }
  err_file="${scope_file}.err"
  # D7's gate DERIVES the applicability scope itself, from the same frozen
  # corpus-manifest constant the qualifier's own emitted evidence derives
  # from — it never reads an operator-supplied --scorecard-scope-file (case
  # xx: a caller-supplied, wider scope must never change this decision).
  if ! node "$SCRIPT_DIR/lib/qualification-applicability-scope.js" write-scope --role "$role" --out "$scope_file" 2>"$err_file"; then
    echo "resolve-review-loop: ${role} seat (${eng}/${run}) applicability-scope manifest could not be derived — $(cat "$err_file" 2>/dev/null) — refusing" >&2
    rm -f "$scope_file" "$err_file"
    _QUALROW_RESULT="scope-fail"
    return
  fi
  local seat_json rc err_text
  local -a effort_args=()
  [[ -n "$eff" ]] && effort_args=(--effort "$eff")
  seat_json="$(node "$SCRIPT_DIR/engine-scorecard.js" seat-status \
    --engine "$eng" --runner "$run" --role "$role" "${effort_args[@]}" \
    --require-evidence --scope-file "$scope_file" 2>"$err_file")"
  rc=$?
  err_text="$(cat "$err_file" 2>/dev/null)"
  rm -f "$scope_file" "$err_file"
  if [[ $rc -ne 0 ]]; then
    # Strict-path refusal (absent/unreadable/malformed store, forged row,
    # missing/mismatched anchor — plan D7 cases ix-xiv): never a qualifying
    # row. Not fatal by itself here — falls through to the override-only
    # path below, exactly like "no evidence at all".
    [[ -n "$err_text" ]] && echo "resolve-review-loop: ${role} seat (${eng}/${run}) strict qualification-evidence read failed: ${err_text}" >&2
    return
  fi
  local admission
  admission="$(printf '%s' "$seat_json" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.admission_status||"");}catch{}})' 2>/dev/null || true)"
  if [[ "$admission" != "qualified" ]]; then
    # no_record (case ii/iii/xviii — different role, no row, or scope
    # mismatch) or requalify_required (case vii — demoted standing,
    # critical_trigger, or enforced strike threshold): falls through.
    return
  fi
  # Advisory warnings that never change the admission decision: calendar
  # expiry on the ROW is advisory-only (case vi), and a shadow-mode
  # would_requalify is deliberate Board policy, not a hole (finding [1]
  # PARTIAL OVERRULE) — surfaced on stderr either way.
  local warn
  warn="$(printf '%s' "$seat_json" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let j;
  try { j = JSON.parse(s); } catch { process.exit(0); }
  const lines = [];
  if (j.expiry_warning) lines.push("qualification row is past its calendar expiry — advisory only, standing is not demoted, admitting");
  if (j.would_requalify) lines.push(`would_requalify (strikes_since_pass=${j.strikes_since_pass}/${j.strike_threshold}) — shadow-mode admission is deliberate Board policy (references/strike-decay.md), not a hole`);
  process.stdout.write(lines.join(""));
});' 2>/dev/null || true)"
  if [[ -n "$warn" ]]; then
    IFS=$'\x1f' read -r -a _warn_lines <<<"$warn"
    for _w in "${_warn_lines[@]}"; do
      [[ -n "$_w" ]] && echo "resolve-review-loop: ⚠ ${role} seat (${eng}/${run}): ${_w}" >&2
    done
  fi
  _QUALROW_RESULT="admit"
  _QUALROW_JSON="$seat_json"
}

QUALROW_ADMITTED_JSON="[]"

for _i in "${!_seat_roles[@]}"; do
  _role="${_seat_roles[$_i]}"; _eng="${_seat_engines[$_i]}"; _run="${_seat_runners[$_i]}"
  _eff="${_seat_efforts[$_i]:-}"
  _cd_switch_role="${_role%%[*}"
  if _consult_discuss_switch_on "$_cd_switch_role"; then
    _try_qualification_row "$_cd_switch_role" "$_eng" "$_run" "$_eff"
    if [[ "$_QUALROW_RESULT" == "scope-fail" ]]; then
      # Fail-closed, not skip (plan D7): a manifest that cannot be derived
      # refuses the whole gate — even an operator override cannot rescue a
      # structurally broken scope contract.
      exit 3
    fi
    if [[ "$_QUALROW_RESULT" == "admit" ]]; then
      QUALROW_ADMITTED_JSON="$(node -e '
let a = []; try { a = JSON.parse(process.argv[1]); } catch { process.exit(1); }
if (!Array.isArray(a)) process.exit(1);
a.push(process.argv[2]);
process.stdout.write(JSON.stringify(a));' "$QUALROW_ADMITTED_JSON" "$_role" 2>/dev/null)" || {
        echo "resolve-review-loop: ${_role} seat (${_eng}/${_run}) was row-admitted but could not be recorded — refusing" >&2
        exit 3
      }
      continue
    fi
    # No qualifying row: this seat now ALSO requires the override-only check
    # below, regardless of whether its runner is in UNQUALIFIED_RUNNERS —
    # that is the vacuum D7 closes (plan §0a): "switch on, no evidence, no
    # override" refuses for EVERY runner, not only cursor (case ii).
  else
    _is_unqualified_runner "$_run" || continue
  fi
  _ovr="$(AUTOPILOT_QUALIFICATION_OVERRIDE="${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" node -e '
const fs = require("fs");
const [engine, runner, role] = process.argv.slice(1);
const file = process.env.AUTOPILOT_QUALIFICATION_OVERRIDE || "";
if (!file || !fs.existsSync(file)) process.exit(1);
let doc = null;
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(1); }
if (!doc || doc.schema !== 1 || !Array.isArray(doc.overrides)) process.exit(1);
const today = new Date().toISOString().slice(0, 10);
const isCalendarDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`))
  && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
// role is matched EXACTLY: an override for the implementer role does not admit
// the same engine to a reviewer seat. A qc_panel[N] seat matches role
// "qc_panel"; the risk-tiered overlay seat "reviewer_low_risk" matches role
// "reviewer" (it IS the reviewer role, just the low-risk engine of it) — the
// ENGINE still has to match exactly, which is what stops one override from
// covering both tiers.
const wantRole = role.replace(/\[[0-9]+\]$/, "").replace(/_low_risk$/, "");
const m = doc.overrides.find((o) => o && o.engine === engine && o.runner === runner
  && o.role === wantRole
  && typeof o.reason === "string" && o.reason.trim()
  && typeof o.operator === "string" && o.operator.trim()
  && isCalendarDate(o.expires) && o.expires >= today);
if (!m) process.exit(1);
process.stdout.write(`${m.reason}\u001f${m.expires}\u001f${m.operator}`);
' "$_eng" "$_run" "$_role" 2>/dev/null)" || _ovr=""
  if [[ -z "$_ovr" ]]; then
    echo "resolve-review-loop: ${_role} seat (${_eng}/${_run}) is NOT qualified for any role and has no matching operator override — add an unexpired entry for engine/runner/role '${_role%%[*}' to \$AUTOPILOT_QUALIFICATION_OVERRIDE, or qualify the engine via engine-onboarding. Naming an unqualified runner in a roster is refused, not downgraded." >&2
    exit 3
  fi
  _reason="${_ovr%%$'\x1f'*}"; _rest="${_ovr#*$'\x1f'}"; _expires="${_rest%%$'\x1f'*}"; _operator="${_rest##*$'\x1f'}"
  echo "resolve-review-loop: ⚠ ${_role} seat (${_eng}/${_run}) runs on an EVIDENCE-FREE operator override (operator: ${_operator}; reason: ${_reason}; expires ${_expires}) — this is a RECORDED OPERATOR DECISION, not earned qualification." >&2
  # depth-0 panel 🟠 #4: the recording is not decoration — Ruling 1 requires an
  # evidence-free admission to be AUDITABLE, and override_admitted_seats is the
  # record. Falling back to the previous array on failure would let the admission
  # succeed while the seat vanished from the record, which is the one outcome the
  # ruling forbids. Append failure is now fatal: an admission we cannot record is
  # an admission we do not grant.
  _next_admitted="$(node -e '
let a = []; try { a = JSON.parse(process.argv[1]); } catch { process.exit(1); }
if (!Array.isArray(a)) process.exit(1);
a.push(process.argv[2]);
const out = JSON.stringify(a);
if (!out || out[0] !== "[") process.exit(1);
process.stdout.write(out);' "$OVERRIDE_ADMITTED_JSON" "$_role" 2>/dev/null)" || _next_admitted=""
  if [[ -z "$_next_admitted" ]]; then
    echo "resolve-review-loop: ${_role} seat (${_eng}/${_run}) was override-admitted but the admission could NOT be recorded in override_admitted_seats — refusing. An evidence-free admission that leaves no auditable record is not a recorded operator decision." >&2
    exit 3
  fi
  OVERRIDE_ADMITTED_JSON="$_next_admitted"
done

# ── dual-seat occupancy (LOOP seats) ─────────────────────────────────────────
# depth-0 panel 🟠 #3: this used to see only OVERRIDE-ADMITTED runners, so a
# QUALIFIED runner in both halves of the loop sailed through. The Board's
# rationale — one vendor, one auth, one server-side prompt layer is not
# decorrelation — has no qualified-engine exemption: gpt-5.6-sol reviewing
# gpt-5.6-sol's own work is the same decorrelation loss whether or not both seats
# are qualified. The test now runs over EVERY seat.
#
# THE TRAP, and why this is not just "compare the runners". A naive comparison of
# RESOLVED runners rejects the shipped template, whose `implementer_runner: auto`
# resolves to the very `codex` its reviewer seat names — the identical failure
# mode that disqualified the model-family axis. So the comparison is over the
# CONFIGURED TOKEN: template `auto` != `codex` does not trip, while an operator
# who explicitly writes `codex` in both seats does. `auto` is a delegation of the
# choice, not a statement that both seats share a rail; an operator who wants the
# gate's opinion on that should name the runner. Pinned by tests over both the
# shipped template and this repo's own dogfood config.
# SCOPE: the LOOP seats only. The terminal qc_panel is deliberately NOT subject to
# this binary gate — hetero consult ruling (E), 2026-08-27. A panel is a
# multi-seat body with min_panel_size 3 and union-on-verified-critical
# aggregation (majority forbidden), so ONE seat sharing the implementer's rail
# still leaves two independent rails, each able to block on its own. Applying a
# binary fail per member would reject otherwise well-decorrelated panels. The
# panel instead gets its own proportionate runner-axis governance below — which
# it needed anyway, because its existing control is FAMILY-based and this whole
# change exists because one rail can serve several families.
_impl_runner_tokens=""
_loop_review_runner_tokens=""
for _i in "${!_seat_roles[@]}"; do
  case "${_seat_roles[$_i]}" in
    implementer) _impl_runner_tokens="$_impl_runner_tokens ${_seat_runners[$_i]}" ;;
    qc_panel\[*) : ;;  # panel diversity uses _panel_div_runners (engine-bearing seats only)
    *) _loop_review_runner_tokens="$_loop_review_runner_tokens ${_seat_runners[$_i]}" ;;
  esac
done

# ── qc_panel runner diversity (its OWN governance, not the loop gate) ────────
# The panel's pre-existing decorrelation control is FAMILY-based
# (cross_family_required/satisfied, and the "shares the implementer family"
# warning). That control cannot see the hazard this release is about: ONE rail
# serving several model families — a single `cursor` rail hosting both GPT and
# Grok ids shows up as two DIFFERENT families and the family check says nothing.
# So the panel gets the runner axis too, at a severity that matches how a panel
# decides: any overlap with the implementer's rail is WARNED and recorded, and
# only TOTAL overlap — every seat on the implementer's own rail, i.e. zero
# runner decorrelation anywhere in the terminal gate — is refused, and even that
# is openable with the same explicit key. One overlapping seat among three
# remains permissible by design (consult ruling (E)).
_panel_total=0
_panel_overlap=0
for _pr in $_panel_div_runners; do
  _panel_total=$((_panel_total + 1))
  for _ir in $_impl_runner_tokens; do
    [[ "$_ir" == "auto" ]] && continue
    [[ "$_pr" == "$_ir" ]] && _panel_overlap=$((_panel_overlap + 1)) && break
  done
done
# PARTIAL overlap is deliberately SILENT. The shipped default panel is
# `codex, claude-native, agy` — three distinct rails on purpose — so a codex
# implementer overlaps exactly one of them in the repo's own RECOMMENDED
# configuration. A warning that fires on the recommended setup is noise, and it
# trains readers to ignore the channel carrying the real signal. It also
# demonstrably broke a caller: dispatch-author.sh --strict-contract turned the
# extra stderr line into an empty result (dispatch-author-contract dropped from
# 46 assertions to 33 until this was removed). Partial overlap is not invisible
# either — the pre-existing cross-family control still reports when the panel
# shares the implementer's FAMILY.
#
# TOTAL overlap keeps its teeth: every usable seat on the implementer's own rail
# means the terminal gate has no runner decorrelation anywhere. Only that sets
# same_runner_dual_seat, which keeps the field a fact worth putting in a run
# summary rather than a restatement of the default roster.
if [[ "$_panel_total" -gt 0 && "$_panel_overlap" -eq "$_panel_total" ]]; then
  SAME_RUNNER_DUAL_SEAT="true"
  if [[ "$ALLOW_DUAL_SEAT" != "on" ]]; then
    echo "resolve-review-loop: EVERY qc_panel seat ($_panel_total of $_panel_total) runs on the implementer's own runner — the terminal gate has no runner decorrelation at all. Model families do not help here: one rail can serve several. Add a panel member on a different runner, or set allow_same_runner_dual_seat: on to accept it deliberately." >&2
    exit 3
  fi
  echo "resolve-review-loop: ⚠ allow_same_runner_dual_seat is ON and EVERY qc_panel seat runs on the implementer's runner — the terminal gate has no runner decorrelation." >&2
fi

for _ir in $_impl_runner_tokens; do
  # `auto` is not a rail identity — it is "you pick". It can never collide.
  [[ "$_ir" == "auto" ]] && continue
  for _rr in $_loop_review_runner_tokens; do
    [[ "$_ir" != "$_rr" ]] && continue
    if [[ "$ALLOW_DUAL_SEAT" != "on" ]]; then
      echo "resolve-review-loop: runner '${_ir}' is named explicitly in BOTH an implementer seat and a reviewer-class loop seat. One vendor, one auth and one server-side prompt layer is not decorrelation, even when the two seats name different model families or both engines are qualified. Set allow_same_runner_dual_seat: on to accept that reduced decorrelation deliberately." >&2
      exit 3
    fi
    SAME_RUNNER_DUAL_SEAT="true"
    echo "resolve-review-loop: ⚠ allow_same_runner_dual_seat is ON and runner '${_ir}' occupies both an implementer seat and a reviewer-class loop seat (implementer family: ${IMPL_FAMILY}, reviewer family: ${REV_FAMILY}). The loop's independence is reduced to one vendor/auth/prompt layer regardless of the model families shown." >&2
  done
done

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    reviewer_engine) printf '%s\n' "$REV_ENGINE" ;;
    reviewer_effort) printf '%s\n' "$REV_EFFORT" ;;
    reviewer_runner) printf '%s\n' "$REV_RUNNER" ;;
    implementer_engine) printf '%s\n' "$IMPL_ENGINE" ;;
    implementer_effort) printf '%s\n' "$IMPL_EFFORT" ;;
    implementer_runner) printf '%s\n' "$IMPL_RUNNER" ;;
    implementer_ladder) printf '%s\n' "$IMPL_LADDER_JSON" ;;
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
    ladder_start_rung_judgment) printf '%s\n' "$LADDER_START_RUNG_JUDGMENT" ;;
    loop_convergence_verdict) printf '%s\n' "$CONVERGE" ;;
    spec_review) printf '%s\n' "$SPEC_REVIEW" ;;
    plan_review) printf '%s\n' "$PLAN_REVIEW" ;;
    hetero_review) printf '%s\n' "$HETERO_REVIEW" ;;
    plan_review_resolved_from) printf '%s\n' "$PLAN_REVIEW_RESOLVED_FROM" ;;
    hetero_review_resolved_from) printf '%s\n' "$HETERO_REVIEW_RESOLVED_FROM" ;;
    consult_resolved_from) printf '%s\n' "$CONSULT_RESOLVED_FROM" ;;
    plan_reviewer_engine) printf '%s\n' "$PLAN_REV_ENGINE" ;;
    plan_reviewer_effort) printf '%s\n' "$PLAN_REV_EFFORT" ;;
    plan_reviewer_runner) printf '%s\n' "$PLAN_REV_RUNNER" ;;
    plan_reviewer_endpoint) printf '%s\n' "$PLAN_REV_ENDPOINT" ;;
    plan_deep_reviewer_engine) printf '%s\n' "$PLAN_DEEP_ENGINE" ;;
    plan_deep_reviewer_effort) printf '%s\n' "$PLAN_DEEP_EFFORT" ;;
    plan_deep_reviewer_runner) printf '%s\n' "$PLAN_DEEP_RUNNER" ;;
    plan_deep_reviewer_endpoint) printf '%s\n' "$PLAN_DEEP_ENDPOINT" ;;
    consult_engine) printf '%s\n' "$CONSULT_ENGINE" ;;
    consult_effort) printf '%s\n' "$CONSULT_EFFORT" ;;
    consult_runner) printf '%s\n' "$CONSULT_RUNNER" ;;
    consult_endpoint) printf '%s\n' "$CONSULT_ENDPOINT" ;;
    discuss_engine) printf '%s\n' "$DISCUSS_ENGINE" ;;
    discuss_effort) printf '%s\n' "$DISCUSS_EFFORT" ;;
    discuss_runner) printf '%s\n' "$DISCUSS_RUNNER" ;;
    discuss_endpoint) printf '%s\n' "$DISCUSS_ENDPOINT" ;;
    consult_dispatch) printf '%s\n' "$CONSULT_DISPATCH" ;;
    discuss_dispatch) printf '%s\n' "$DISCUSS_DISPATCH" ;;
    allow_same_runner_dual_seat) printf '%s\n' "$ALLOW_DUAL_SEAT" ;;
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
    strict_l5_policy_override) printf '%s\n' "$STRICT_L5_POLICY_OVERRIDE" ;;
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
    brain_seat) printf '%s\n' "$BRAIN_SEAT_JSON" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit "$ENFORCE_EXIT"
fi

FMT_SUFFIX=" }\n"
ARGS_SUFFIX=()
READINESS_FMT=', "qc_panel_seats": %s, "qc_panel_seats_complete": %s, "provider_readiness_receipt_ttl_seconds": %s, "provider_readiness_fallback_family_constraint": "%s", "strict_l5_policy_override": "%s", "brain_seat": %s'
READINESS_ARGS=(
  "$QC_PANEL_SEATS_JSON"
  "$QC_PANEL_SEATS_COMPLETE"
  "$PROVIDER_READINESS_RECEIPT_TTL_SECONDS"
  "$PROVIDER_READINESS_FAMILY_CONSTRAINT"
  "$(json_escape "$STRICT_L5_POLICY_OVERRIDE")"
  "$BRAIN_SEAT_JSON"
)
SEATS_FMT=', "consult_engine": "%s", "consult_effort": "%s", "consult_runner": "%s", "consult_endpoint": "%s", "discuss_engine": "%s", "discuss_effort": "%s", "discuss_runner": "%s", "discuss_endpoint": "%s", "consult_dispatch": "%s", "consult_resolved_from": "%s", "discuss_dispatch": "%s", "allow_same_runner_dual_seat": "%s", "same_runner_dual_seat": %s, "override_admitted_seats": %s'
SEATS_ARGS=(
  "$(json_escape "$CONSULT_ENGINE")" "$CONSULT_EFFORT" "$CONSULT_RUNNER" "$CONSULT_ENDPOINT"
  "$(json_escape "$DISCUSS_ENGINE")" "$DISCUSS_EFFORT" "$DISCUSS_RUNNER" "$DISCUSS_ENDPOINT"
  "$CONSULT_DISPATCH" "$CONSULT_RESOLVED_FROM" "$DISCUSS_DISPATCH"
  "$ALLOW_DUAL_SEAT" "$SAME_RUNNER_DUAL_SEAT" "$OVERRIDE_ADMITTED_JSON"
)
PLAN_FMT=', "plan_review": "%s", "plan_review_resolved_from": "%s", "hetero_review": "%s", "hetero_review_resolved_from": "%s", "plan_reviewer_engine": "%s", "plan_reviewer_effort": "%s", "plan_reviewer_runner": "%s", "plan_reviewer_endpoint": "%s", "plan_deep_reviewer_engine": "%s", "plan_deep_reviewer_effort": "%s", "plan_deep_reviewer_runner": "%s", "plan_deep_reviewer_endpoint": "%s", "plan_review_max_generations": %s, "plan_review_max_wall_seconds": %s, "plan_review_growth_warn_ratio": %s, "plan_review_growth_stop_ratio": %s'
PLAN_ARGS=(
  "$PLAN_REVIEW"
  "$PLAN_REVIEW_RESOLVED_FROM"
  "$HETERO_REVIEW"
  "$HETERO_REVIEW_RESOLVED_FROM"
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
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "implementer_ladder": %s, "ladder_start_rung_judgment": %s, "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "reviewer_qualified": %s, "fallback_ladder": %s, "fallback_ladder_implementer_family": "%s", "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "reviewer_family": "%s", "implementer_endpoint": "%s", "verification_author_present": %s, "verification_author_engine": "%s", "verification_author_runner": "%s", "verification_author_effort": "%s", "verification_author_endpoint": "%s", "verification_author_family": "%s", "implementer_family": "%s", "config_path": "%s", "min_panel_size": %s, "on_engine_unavailable": "%s", "reviewer_engine_low_risk": "%s", "reviewer_effort_low_risk": "%s", "on_family_conflict": "%s", "reviewer_fallback_preference": %s, "reviewer_fallback_preference_low_risk": %s'"${READINESS_FMT}""${PLAN_FMT}""${SEATS_FMT}""${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" "$IMPL_LADDER_JSON" "$LADDER_START_RUNG_JUDGMENT" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$REVIEWER_QUALIFIED" "$FALLBACK_LADDER_JSON" "$IMPL_FAMILY" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$(json_escape "$REV_FAMILY")" "$IMPL_ENDPOINT" "$VER_AUTH_PRESENT" "$(json_escape "$VER_AUTH_ENGINE")" "$(json_escape "$VER_AUTH_RUNNER")" "$(json_escape "$VER_AUTH_EFFORT")" "$(json_escape "$VER_AUTH_ENDPOINT")" "$(json_escape "$VER_AUTH_FAMILY")" "$(json_escape "$IMPL_FAMILY")" "$(json_escape "$CONFIG_PATH")" \
    "$MIN_PANEL_SIZE" "$(json_escape "$ON_ENGINE_UNAVAILABLE")" "$(json_escape "$REV_ENGINE_LOW_RISK")" "$REV_EFFORT_LOW_RISK" "$ON_FAMILY_CONFLICT" "$REV_FB_PREF_JSON" "$REV_FB_PREF_LOW_JSON" "${READINESS_ARGS[@]}" "${PLAN_ARGS[@]}" "${SEATS_ARGS[@]}" "${ARGS_SUFFIX[@]}"
else
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "implementer_ladder": %s, "ladder_start_rung_judgment": %s, "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "reviewer_family": "%s", "implementer_endpoint": "%s", "verification_author_present": %s, "verification_author_engine": "%s", "verification_author_runner": "%s", "verification_author_effort": "%s", "verification_author_endpoint": "%s", "verification_author_family": "%s", "implementer_family": "%s", "config_path": "%s", "min_panel_size": %s, "on_engine_unavailable": "%s", "reviewer_engine_low_risk": "%s", "reviewer_effort_low_risk": "%s", "on_family_conflict": "%s", "reviewer_fallback_preference": %s, "reviewer_fallback_preference_low_risk": %s'"${READINESS_FMT}""${PLAN_FMT}""${SEATS_FMT}""${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" "$IMPL_LADDER_JSON" "$LADDER_START_RUNG_JUDGMENT" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$(json_escape "$REV_FAMILY")" "$IMPL_ENDPOINT" "$VER_AUTH_PRESENT" "$(json_escape "$VER_AUTH_ENGINE")" "$(json_escape "$VER_AUTH_RUNNER")" "$(json_escape "$VER_AUTH_EFFORT")" "$(json_escape "$VER_AUTH_ENDPOINT")" "$(json_escape "$VER_AUTH_FAMILY")" "$(json_escape "$IMPL_FAMILY")" "$(json_escape "$CONFIG_PATH")" \
    "$MIN_PANEL_SIZE" "$(json_escape "$ON_ENGINE_UNAVAILABLE")" "$(json_escape "$REV_ENGINE_LOW_RISK")" "$REV_EFFORT_LOW_RISK" "$ON_FAMILY_CONFLICT" "$REV_FB_PREF_JSON" "$REV_FB_PREF_LOW_JSON" "${READINESS_ARGS[@]}" "${PLAN_ARGS[@]}" "${SEATS_ARGS[@]}" "${ARGS_SUFFIX[@]}"
fi
exit "$ENFORCE_EXIT"
