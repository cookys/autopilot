#!/usr/bin/env bash
# resolve-review-loop.sh — resolve the per-project review-loop engine roster + loop
# policy → JSON. Turns the hand-typed "/l5 generation-adversarial heterogeneous"
# prompt into DATA consumed by /l5 (ceo-agent level-front-door). Sibling of
# resolve-qc-gate.sh / resolve-doa.sh — same precedence chain.
#
# Usage:
#   scripts/resolve-review-loop.sh                 # emit resolved config JSON
#   scripts/resolve-review-loop.sh --field reviewer_engine   # one raw field (for shell)
#   scripts/resolve-review-loop.sh --check-scorecard   # include reviewer_qualified + fallback_ladder
#   Risk inputs (optional): --source-trust high|low --diff-lines N --protected-path 0|1
#     --oracle-available 0|1 --security-surface 0|1  (drive deterministic review_risk)
#   --check-scorecard  # include scorecard gate signal in output (opt-in, no extra keys by default)
#   --scale-by-capability  # config: density_scaling (on|off). Increase verification density for low/unknown capability tier implementers (fail-closed). Evidence: campaign R1/R2 proved mechanical contracts move behavior.
#   --enforce  # OPT-IN hard gate: exit 3 (still emits JSON/field) when the policy says BLOCK
#              # — a high-risk change whose required cross-family decorrelation is unsatisfied.
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
# Output: JSON {reviewer_engine, reviewer_effort, reviewer_runner,
#   implementer_engine, implementer_effort, implementer_runner,
#   loop_max_rounds, loop_convergence_verdict, spec_review, independent_harness,
#   qc_panel (array), qc_panel_aggregation, review_risk, required_review_families,
#   l1_required, cross_family_required, cross_family_satisfied, review_diff_scope, source,
#   work_domain, domain_source}
# (qc_panel = disjoint-family terminal gate; warns on stderr if the panel shares the
#  implementer family. qc_panel_aggregation: union-on-verified-critical; majority forbidden.
#  review_diff_scope: how much the per-round reviewer reads — full | incremental-mitigated.)
#
# Exit codes: 0 success / 2 usage.

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
DEF_MAX_ROUNDS="5"
DEF_CONVERGE="SHIP-AS-IS"
DEF_SPEC_REVIEW="on"
DEF_HARNESS="on"
# Terminal depth-0 qc panel (v2.25.9): a DISJOINT-FAMILY panel, not a single reviewer.
# Default spans OpenAI / Anthropic / Google so ≥1 family differs from any implementer.
DEF_QC_PANEL="gpt-5.5, claude-opus, gemini-flash"
# Engines with recorded reviewer calibration/spike evidence (qc_panel: all-calibrated roster)
QC_ALL_CALIBRATED="gpt-5.5, claude-opus, gemini-flash, grok-build, MiniMax-M3"
DEF_QC_AGG="union-on-verified-critical"
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

FIELD=""
SOURCE_TRUST=""
DIFF_LINES=0
PROTECTED_PATH=0
ORACLE_AVAILABLE=1
SECURITY_SURFACE=0
ENFORCE=0
CHECK_SCORECARD=0
SCALE_BY_CAPABILITY=0
DWORK_DOMAIN="mixed"
DOMAIN_SOURCE="none"
AUTO_DOMAIN=0
AUTO_RANGE="changed"
CAPABILITY_STATE=""
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
    --enforce) ENFORCE=1; shift ;;
    --scale-by-capability) SCALE_BY_CAPABILITY=1; shift ;;
    -h|--help) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

CONFIG=""
SOURCE="builtin-default"
if [[ -n "${REVIEW_LOOP_CONFIG_OVERRIDE:-}" && -r "${REVIEW_LOOP_CONFIG_OVERRIDE:-}" ]]; then
  CONFIG="$REVIEW_LOOP_CONFIG_OVERRIDE"; SOURCE="override"
elif [[ -r "$PWD/.claude/review-loop-config.md" ]]; then
  CONFIG="$PWD/.claude/review-loop-config.md"; SOURCE="project-cwd"
elif [[ -r "$REPO_ROOT/.claude/review-loop-config.md" ]]; then
  CONFIG="$REPO_ROOT/.claude/review-loop-config.md"; SOURCE="project-repo"
elif [[ -r "$REPO_ROOT/project-config-template/review-loop-config.md" ]]; then
  CONFIG="$REPO_ROOT/project-config-template/review-loop-config.md"; SOURCE="template"
fi

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

read_field() { # key default
  local key="$1" def="$2" val=""
  if [[ -n "$CONFIG" ]]; then
    val="$(grep -iE "^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:" "$CONFIG" 2>/dev/null \
            | head -1 | sed -E "s/^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:[[:space:]]*//I" \
            | sed -E 's/[[:space:]]+$//')"
  fi
  [[ -z "$val" ]] && val="$def"
  printf '%s' "$val"
}

REV_ENGINE="$(read_field reviewer_engine "$DEF_REV_ENGINE")"
REV_EFFORT="$(read_field reviewer_effort "$DEF_REV_EFFORT")"
REV_RUNNER="$(read_field reviewer_runner "$DEF_REV_RUNNER")"
IMPL_ENGINE="$(read_field implementer_engine "$DEF_IMPL_ENGINE")"
IMPL_EFFORT="$(read_field implementer_effort "$DEF_IMPL_EFFORT")"
IMPL_RUNNER="$(read_field implementer_runner "$DEF_IMPL_RUNNER")"
REV_ENDPOINT="$(read_field reviewer_endpoint "$DEF_REV_ENDPOINT")"
IMPL_ENDPOINT="$(read_field implementer_endpoint "$DEF_IMPL_ENDPOINT")"
# Endpoint names feed dispatch-*.sh --endpoint (→ resolve-endpoint.sh env-var suffix); allow
# [A-Za-z0-9_] only (empty = none). A bad value → "" so it can't inject into the --endpoint
# arg or the emitted JSON (same fail-closed stance as resolve-endpoint.sh's NAME_RE).
[[ -z "$REV_ENDPOINT"  || "$REV_ENDPOINT"  =~ ^[A-Za-z0-9_]+$ ]] || { echo "resolve-review-loop: ignoring invalid reviewer_endpoint (must be [A-Za-z0-9_]): $REV_ENDPOINT" >&2; REV_ENDPOINT=""; }
[[ -z "$IMPL_ENDPOINT" || "$IMPL_ENDPOINT" =~ ^[A-Za-z0-9_]+$ ]] || { echo "resolve-review-loop: ignoring invalid implementer_endpoint (must be [A-Za-z0-9_]): $IMPL_ENDPOINT" >&2; IMPL_ENDPOINT=""; }
MAX_ROUNDS="$(read_field loop_max_rounds "$DEF_MAX_ROUNDS")"
CONVERGE="$(read_field loop_convergence_verdict "$DEF_CONVERGE")"
SPEC_REVIEW="$(read_field spec_review "$DEF_SPEC_REVIEW")"
SKILL_MODE_REQ="$(read_field skill_mode "")"
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
HARNESS="$(read_field independent_harness "$DEF_HARNESS")"
QC_PANEL_RAW="$(read_field qc_panel "$DEF_QC_PANEL")"
QC_AGG="$(read_field qc_panel_aggregation "$DEF_QC_AGG")"
DIFF_SCOPE="$(read_field review_diff_scope "$DEF_DIFF_SCOPE")"

DENSITY_SCALING_CFG="$(read_field density_scaling "off")"
case "$DENSITY_SCALING_CFG" in on|off) ;; *) DENSITY_SCALING_CFG="off" ;; esac

# Map an engine name → vendor family (for the decorrelation overlap warning).
family_of() {
  local e; e="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$e" in
    *gpt*|*codex*|*o1*|*o3*|*o4*)            echo openai ;;
    *claude*|*opus*|*sonnet*|*haiku*)        echo anthropic ;;
    *gemini*|*flash*|*bison*)                echo google ;;
    *grok*|*composer*)                       echo xai ;;
    *minimax*|*abab*)                        echo minimax ;;
    *glm*|*zhipu*)                           echo zhipu ;;
    *)                                       echo unknown ;;
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
  QC_PANEL+=("$_p")
  [[ $_first -eq 0 ]] && QC_PANEL_JSON+=", "
  QC_PANEL_JSON+="\"$(json_escape "$_p")\""
  _first=0
done
QC_PANEL_JSON+="]"
[[ ${#QC_PANEL[@]} -eq 0 ]] && QC_PANEL_JSON="[]"

# Validate enums; fall back to defaults on garbage (fail toward the safe roster).
case "$REV_RUNNER" in codex|auto|agy|grok|cc-shim) ;; *) REV_RUNNER="$DEF_REV_RUNNER" ;; esac
case "$REV_EFFORT" in low|medium|high|xhigh|max) ;; *) REV_EFFORT="$DEF_REV_EFFORT" ;; esac
case "$IMPL_EFFORT" in low|medium|high|xhigh|max) ;; *) IMPL_EFFORT="$DEF_IMPL_EFFORT" ;; esac
case "$IMPL_RUNNER" in auto|codex|agy|grok|cc-shim) ;; *) IMPL_RUNNER="$DEF_IMPL_RUNNER" ;; esac
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
_diff_family=0
for _m in "${QC_PANEL[@]}"; do
  _mf="$(family_of "$_m")"
  # An 'unknown' family does NOT count as cross-family (it could be the implementer's
  # family under an unrecognized codename) — else it would mask a real overlap.
  [[ "$_mf" != "unknown" && "$_mf" != "$IMPL_FAMILY" ]] && { _diff_family=1; break; }
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
    if (row.status === "qualified") {
      process.stdout.write("high");
    } else {
      process.stdout.write("low");
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
    # Scale +2 capped at 7, but NEVER below the user-configured base — density
    # scaling only ever increases verification density (round-3 review finding).
    BASE_ROUNDS="$MAX_ROUNDS"
    MAX_ROUNDS=$(( MAX_ROUNDS + 2 ))
    [[ "$MAX_ROUNDS" -gt 7 ]] && MAX_ROUNDS=$(( BASE_ROUNDS > 7 ? BASE_ROUNDS : 7 ))
    [[ "$REQUIRED_REVIEW_FAMILIES" -lt 2 ]] && REQUIRED_REVIEW_FAMILIES=2
    L1_REQUIRED="true"
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
if [[ "$_diff_family" -eq 1 ]]; then
  CROSS_FAMILY_SATISFIED="true"
else
  CROSS_FAMILY_SATISFIED="false"
fi

if [[ "$CROSS_FAMILY_REQUIRED" == "true" && "$CROSS_FAMILY_SATISFIED" == "false" ]]; then
  _cross_severity="WARNING"
  [[ "$REVIEW_RISK" == "high" || "$REQUIRED_REVIEW_FAMILIES" -ge 2 ]] && _cross_severity="ERROR"
  printf 'resolve-review-loop: %s — cross-family: qc_panel shares the implementer family (%s); no cross-family decorrelation. Add a panel member from a different vendor.\n' "$_cross_severity" "$IMPL_FAMILY" >&2
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
  SCORECARD_CURRENT="$(node "$SCRIPT_DIR/engine-scorecard.js" current --role reviewer 2>/dev/null || true)"
  SCORECARD_LADDER="$(node "$SCRIPT_DIR/engine-scorecard.js" ladder --role reviewer 2>/dev/null || true)"
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



if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    reviewer_engine) printf '%s\n' "$REV_ENGINE" ;;
    reviewer_effort) printf '%s\n' "$REV_EFFORT" ;;
    reviewer_runner) printf '%s\n' "$REV_RUNNER" ;;
    implementer_engine) printf '%s\n' "$IMPL_ENGINE" ;;
    implementer_effort) printf '%s\n' "$IMPL_EFFORT" ;;
    implementer_runner) printf '%s\n' "$IMPL_RUNNER" ;;
    reviewer_endpoint) printf '%s\n' "$REV_ENDPOINT" ;;
    implementer_endpoint) printf '%s\n' "$IMPL_ENDPOINT" ;;
    loop_max_rounds) printf '%s\n' "$MAX_ROUNDS" ;;
    loop_convergence_verdict) printf '%s\n' "$CONVERGE" ;;
    spec_review) printf '%s\n' "$SPEC_REVIEW" ;;
    independent_harness) printf '%s\n' "$HARNESS" ;;
    qc_panel) printf '%s\n' "${QC_PANEL[*]}" ;;
    qc_panel_aggregation) printf '%s\n' "$QC_AGG" ;;
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
if [[ "$DENSITY_SOURCE" != "off" ]]; then
  FMT_SUFFIX=", \"capability_tier\": \"%s\", \"density_scaled\": %s, \"density_source\": \"%s\" }\n"
  ARGS_SUFFIX=("$CAPABILITY_TIER" "$DENSITY_SCALED" "$DENSITY_SOURCE")
fi

if [[ "$CHECK_SCORECARD" == "1" ]]; then
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "reviewer_qualified": %s, "fallback_ladder": %s, "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "implementer_endpoint": "%s"'"${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$REVIEWER_QUALIFIED" "$FALLBACK_LADDER_JSON" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$IMPL_ENDPOINT" "${ARGS_SUFFIX[@]}"
else
  printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "qc_panel": %s, "qc_panel_aggregation": "%s", "review_risk": "%s", "required_review_families": %s, "l1_required": %s, "cross_family_required": %s, "cross_family_satisfied": %s, "review_diff_scope": "%s", "source": "%s", "work_domain": "%s", "domain_source": "%s", "capability_state_source": "%s", "quota_status": "%s", "quota_reset_at": %s, "skill_mode_requested": "%s", "skill_mode_effective": "%s", "capability_warnings": %s, "reviewer_endpoint": "%s", "implementer_endpoint": "%s"'"${FMT_SUFFIX}" \
    "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
    "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" \
    "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" \
    "$QC_PANEL_JSON" "$(json_escape "$QC_AGG")" "$REVIEW_RISK" \
    "$REQUIRED_REVIEW_FAMILIES" "$L1_REQUIRED" "$CROSS_FAMILY_REQUIRED" "$CROSS_FAMILY_SATISFIED" "$DIFF_SCOPE" "$SOURCE" "$DWORK_DOMAIN" "$DOMAIN_SOURCE" \
    "$CAP_STATE_SOURCE" "$CAP_QUOTA_STATUS" "$CAP_QUOTA_RESET_AT" "$CAP_SKILL_MODE_REQ" "$CAP_SKILL_MODE_EFF" "$CAP_WARNINGS_JSON" \
    "$REV_ENDPOINT" "$IMPL_ENDPOINT" "${ARGS_SUFFIX[@]}"
fi
exit "$ENFORCE_EXIT"
