#!/usr/bin/env bash
set -euo pipefail
# ladder-run — the ACCEPTANCE-DELEGATION LADDER harness (ROADMAP P2.2).
#
# WHY (ROADMAP §0): cookys is progressively removed from the acceptance loop by moving a
# task CLASS up a ladder — T0 (cookys per-item) → T1 (agent verifies, cookys samples X%) →
# T2 (agent verifies, cookys audits only). A class may only move up when the MEASURED QC
# escape rate stays below a threshold over enough samples. The escape gate is the WHOLE
# point — so this harness is built so a real escape can actually be recorded and counted.
#
# SUBCOMMANDS
#   run   (default) — run ONE cycle: impl artifact → decorrelated ISOLATED verify →
#                     emit QC event → deterministic cookys-sample flag → per-class report.
#   audit           — record a LATER-STAGE finding/escape for an ALREADY-RUN change_id
#                     (a defect let through in-cycle but caught later by depth-0 /
#                     publish-review / cookys audit). Because its caught_at_stage is later
#                     than the verdict stage, qc_metric.py's union-merge counts it as a
#                     CLASS ESCAPE — which is how a class is honestly kept off T1 until its
#                     escape rate is really low. Without this path the in-cycle verifier is
#                     blind to its own escapes and the promotion gate is vacuous.
#
# The in-cycle verifier is a WEAK oracle (esp. diff-only for doc-sync): a clean in-cycle
# pass is caught_at_stage=depth0_panel = the verdict stage, so it is NOT an escape. The
# escape rate only becomes meaningful once later/stronger review records its finds via the
# `audit` path. See docs/ladder-run.md.
#
# Verifier isolation is STRUCTURAL: verify calls dispatch-review.sh, whose prompt is the
# DIFF TEXT ONLY — the implementer's self-report never reaches the verifier
# (references/blind-dispatch.md § "Verifier isolation").
#
# EXIT: 0 = ran + datapoint recorded cleanly ; 2 = usage / precondition ;
#       3 = needs_human (verifier no-verdict, OR the calculator failed → FAIL-CLOSED:
#           never a clean PROMOTE when the measurement could not be computed).

# ------------------------------------------------------------------ shared helpers
die() { echo "ladder-run: $*" >&2; exit 2; }
STAGES=(depth0_panel publish_hetero_review post_merge cookys_audit)
stage_idx() { local s="$1" i; for i in "${!STAGES[@]}"; do [ "${STAGES[$i]}" = "$s" ] && { echo "$i"; return 0; }; done; echo -1; }

usage() {
  cat <<'EOF'
ladder-run.sh — acceptance-delegation ladder harness (ROADMAP P2.2)

  ladder-run.sh [run] <run-opts>     run one ladder cycle (default subcommand)
  ladder-run.sh audit  <audit-opts>  record a later-stage finding/escape for a prior change

RUN (required):
  --task-class <name>  --change-id <id>  --repo <name>  --state-file <path>
  --base-sha <sha>  --head-sha <sha>
RUN artifact (exactly one — providing both is rejected):
  --diff-file <path>                              already-produced change diff (verifier reads this only)
  --impl-prompt-file <f> --branch <name> [--impl-runner codex] [--impl-model M]
RUN verify/measure:
  --reviewer-runner <r> (codex)   --reviewer-model <m> (gpt-5.6-sol)   --lenses a,b (doc-accuracy,link-integrity)
  --gate-cmd '<shell>'   MECHANICAL oracle run IN-CYCLE alongside the LLM verifier (e.g. the doc-drift
                         Layer-1 gate, a test suite, a version-sync check). Exit 0 = pass; non-zero = fail;
                         the cycle passes only if BOTH the gate and the verifier pass (union of catches).
                         Runs with cwd = the repo checkout; its stdout/stderr tail is kept on the finding.
                         Without it the in-cycle oracle is the diff-only LLM alone — a WEAK oracle for any
                         claim that points outside the diff (version numbers, counts, file existence).
  --mock-verdict SHIP-AS-IS|FIX-THEN-SHIP   TEST SEAM only (never a real datapoint)
  --store <path> ($QC_METRIC_STORE)   --qc-metric-py <path>   --sample-rate <f>   --dry-run

AUDIT (required):
  --task-class <name>  --change-id <id> (must already be in the class ledger)  --repo <name>
  --state-file <path>  --base-sha <sha>  --head-sha <sha>
  --finding-id <slug>  --severity critical|high|medium|low  --lens <name>
  --caught-at-stage publish_hetero_review|post_merge|cookys_audit   (must be LATER than depth0_panel)
AUDIT optional:
  --endorsed true|false|null (default false — an audited-and-defective ship is not endorsed)
  --store <path>   --qc-metric-py <path>

SAMPLING is keyed on head_sha (+ optional secret salt $LADDER_SAMPLE_SALT), NOT change_id —
the implementer cannot rename change_id to dodge sampling; identical diffs sample identically.
EOF
}

# Resolve stores. Sets STORE/QC_PY globals.
resolve_stores() {
  : "${STORE:=${QC_METRIC_STORE:-$HOME/projects/llm-playground/qc-metrics/events.jsonl}}"
  : "${QC_PY:=$HOME/projects/llm-playground/qc-metrics/qc_metric.py}"
}

# Compute the CLASS's escape/endorsement metrics from the store, FAIL-CLOSED.
# Filters the store to the class's change_ids (+ $2 extra id, may be empty), runs the
# unmodified qc_metric.py on the slice. Sets globals:
#   CLASS_REAL CLASS_ESC_PCT CLASS_ESC_FRAC ENDORSE_PCT ENDORSE_FRAC VERIFIED_CYCLES CALC_OK
# CALC_OK=0 ⇒ the calculator failed / gave no parseable report ⇒ callers MUST fail closed
# (no clean PROMOTE). Never dies (so an emitted event is always followed by a state write).
class_metrics() {
  local task_class="$1" extra_id="${2:-}" src_store="${3:-$STORE}"
  local ids tmp rc report cid
  ids=$(jq -r --arg c "$task_class" '.classes[$c].change_ids[]?' "$STATE_FILE" 2>/dev/null || true)
  if [ -n "$extra_id" ]; then ids="$ids
$extra_id"; fi
  # DISTINCT change_ids — wc -l always emits ONE integer and exits 0 (empty ids → "0"),
  # unlike `grep -c . || echo 0` which on empty input printed "0" AND exited 1 → "0\n0" (#4).
  VERIFIED_CYCLES=$(printf '%s\n' "$ids" | sed '/^$/d' | sort -u | wc -l | tr -d '[:space:]')
  tmp="$(mktemp)"
  if [ -f "$src_store" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      cid=$(printf '%s' "$line" | jq -r '.change_id' 2>/dev/null || echo "")
      [ -n "$cid" ] || continue
      if printf '%s\n' "$ids" | grep -qxF "$cid"; then printf '%s\n' "$line" >> "$tmp"; fi
    done < "$src_store"
  fi
  set +e
  report=$(python3 "$QC_PY" --store "$tmp" report 2>/dev/null); rc=$?
  set -e
  rm -f "$tmp"
  # grep -c (not -q) avoids the pipefail/SIGPIPE false-negative
  if [ $rc -ne 0 ] || ! printf '%s\n' "$report" | grep -c 'OVERALL escape rate' > /dev/null; then
    CALC_OK=0; CLASS_REAL=0; CLASS_ESC_PCT=""; CLASS_ESC_FRAC=""; ENDORSE_PCT=""; ENDORSE_FRAC=""
    return 0
  fi
  CALC_OK=1
  # NB: grep can legitimately no-match on an "n/a" line; with `pipefail` that would fail the
  # substitution and (under set -e) kill the run AFTER emit → `|| true` keeps it non-fatal.
  CLASS_REAL=$(printf '%s\n' "$report" | awk -F: '/real defects/{gsub(/[^0-9]/,"",$2);print $2; exit}'); : "${CLASS_REAL:=0}"
  CLASS_ESC_PCT=$(printf '%s\n' "$report" | awk -F: '/OVERALL escape rate/{print $2; exit}' | grep -oE '[0-9.]+' | head -1 || true)
  ENDORSE_PCT=$(printf '%s\n' "$report" | awk -F: '/endorsement rate/{print $2; exit}' | grep -oE '[0-9.]+' | head -1 || true)
  # n/a → empty pct → escape treated as 0 (genuinely no real defects); endorsement UNKNOWN.
  CLASS_ESC_FRAC=$(awk -v p="${CLASS_ESC_PCT:-0}" 'BEGIN{printf "%.4f", (p=="")?0:p/100.0}')
  if [ -z "$ENDORSE_PCT" ]; then ENDORSE_FRAC=""; else ENDORSE_FRAC=$(awk -v p="$ENDORSE_PCT" 'BEGIN{printf "%.4f", p/100.0}'); fi  # C1: /100 to a fraction
}

# Decide promotion recommendation from class metrics + tier. Sets PROMO, REASON, NEEDS_HUMAN_PROMO.
# FAIL-CLOSED: CALC_OK=0 ⇒ never PROMOTE.
promotion_decision() {
  local tier="$1"
  NEEDS_HUMAN_PROMO=0
  if [ "${CALC_OK:-0}" != "1" ]; then
    PROMO="HOLD-ERROR"; REASON="measurement calculator failed — FAIL-CLOSED, needs_human (no promotion on uncomputable escape rate)"
    NEEDS_HUMAN_PROMO=1; return 0
  fi
  local escaped under_esc enough ok_end
  escaped=$(awk -v e="${CLASS_ESC_FRAC:-0}" 'BEGIN{print (e>0)?1:0}')
  under_esc=$(awk -v e="${CLASS_ESC_FRAC:-0}" -v m="$ESCAPE_MAX" 'BEGIN{print (e<m)?1:0}')
  enough=$(awk -v v="${VERIFIED_CYCLES:-0}" -v m="$MIN_SAMPLES" 'BEGIN{print (v>=m)?1:0}')
  if [ "$DEMOTE_ON_ESCAPE" = "true" ] && [ "$escaped" = "1" ]; then
    case "$tier" in
      T0) PROMO="HOLD@T0"; REASON="real escape in class (escape_rate=${CLASS_ESC_PCT}% > 0) → NOT T1-eligible (demote-on-escape; already at floor)";;
      T1) PROMO="DEMOTE→T0"; REASON="real escape (escape_rate=${CLASS_ESC_PCT}%) → demote per policy";;
      T2) PROMO="DEMOTE→T1"; REASON="real escape (escape_rate=${CLASS_ESC_PCT}%) → demote per policy";;
    esac
    return 0
  fi
  case "$tier" in
    T0)
      if [ "$enough" = "1" ] && [ "$under_esc" = "1" ]; then
        PROMO="PROMOTE→T1"; REASON="escape_rate ${CLASS_ESC_PCT:-0}% < ${ESCAPE_MAX} over ${VERIFIED_CYCLES}≥${MIN_SAMPLES} cycles"
      else
        PROMO="HOLD@T0"; REASON="need escape_rate<${ESCAPE_MAX} over ≥${MIN_SAMPLES} cycles; have ${CLASS_ESC_PCT:-0}% over ${VERIFIED_CYCLES}"
      fi ;;
    T1)
      # endorsement fraction must be KNOWN and above the bar (C1: compared as a fraction)
      if [ -z "${ENDORSE_FRAC}" ]; then ok_end=0; else ok_end=$(awk -v x="$ENDORSE_FRAC" -v m="$ENDORSE_MIN" 'BEGIN{print (x>m)?1:0}'); fi
      if [ "$enough" = "1" ] && [ "$under_esc" = "1" ] && [ "$ok_end" = "1" ]; then
        PROMO="PROMOTE→T2"; REASON="escape ${CLASS_ESC_PCT}%<${ESCAPE_MAX}, endorsement ${ENDORSE_PCT:-n/a}% (frac ${ENDORSE_FRAC})>${ENDORSE_MIN}, ${VERIFIED_CYCLES}≥${MIN_SAMPLES}"
      else
        PROMO="HOLD@T1"; REASON="need escape<${ESCAPE_MAX} & endorsement>${ENDORSE_MIN} (frac) over ≥${MIN_SAMPLES}; have escape ${CLASS_ESC_PCT:-0}%, endorsement frac ${ENDORSE_FRAC:-n/a}"
      fi ;;
    T2) PROMO="AT-T2"; REASON="already audit-only; demote-on-escape still armed";;
  esac
}

load_policy() {
  jq -e --arg c "$TASK_CLASS" '.classes[$c]' "$STATE_FILE" >/dev/null 2>&1 \
    || die "task-class '$TASK_CLASS' not defined in $STATE_FILE"
  TIER=$(jq -r --arg c "$TASK_CLASS" '.classes[$c].tier' "$STATE_FILE")
  ESCAPE_MAX=$(jq -r '.policy.escape_rate_max' "$STATE_FILE")
  ENDORSE_MIN=$(jq -r '.policy.endorsement_rate_min' "$STATE_FILE")
  MIN_SAMPLES=$(jq -r '.policy.min_samples' "$STATE_FILE")
  DEMOTE_ON_ESCAPE=$(jq -r '.policy.demote_on_escape' "$STATE_FILE")
  [ -n "${SAMPLE_RATE:-}" ] || SAMPLE_RATE=$(jq -r '.policy.t1_sample_rate' "$STATE_FILE")
}

# ------------------------------------------------------------------ subcommand dispatch
SUB="run"
case "${1:-}" in
  run)   SUB="run"; shift;;
  audit) SUB="audit"; shift;;
  -h|--help) usage; exit 0;;
esac

# ------------------------------------------------------------------ AUDIT subcommand
if [ "$SUB" = "audit" ]; then
  TASK_CLASS=""; CHANGE_ID=""; REPO=""; STATE_FILE=""; BASE_SHA=""; HEAD_SHA=""
  FINDING_ID=""; SEVERITY=""; LENS=""; CAUGHT_STAGE=""; ENDORSED="false"; STORE=""; QC_PY=""; SAMPLE_RATE="x"
  while [ $# -gt 0 ]; do case "$1" in
    --task-class) TASK_CLASS="$2"; shift 2;;
    --change-id) CHANGE_ID="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --state-file) STATE_FILE="$2"; shift 2;;
    --base-sha) BASE_SHA="$2"; shift 2;;
    --head-sha) HEAD_SHA="$2"; shift 2;;
    --finding-id) FINDING_ID="$2"; shift 2;;
    --severity) SEVERITY="$2"; shift 2;;
    --lens) LENS="$2"; shift 2;;
    --caught-at-stage) CAUGHT_STAGE="$2"; shift 2;;
    --endorsed) ENDORSED="$2"; shift 2;;
    --store) STORE="$2"; shift 2;;
    --qc-metric-py) QC_PY="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "audit: unknown arg: $1";;
  esac; done
  for v in TASK_CLASS CHANGE_ID REPO STATE_FILE BASE_SHA HEAD_SHA FINDING_ID SEVERITY LENS CAUGHT_STAGE; do
    [ -n "${!v}" ] || die "audit: missing --$(echo "$v" | tr 'A-Z_' 'a-z-')"
  done
  [ -f "$STATE_FILE" ] || die "state file not found: $STATE_FILE"
  command -v jq >/dev/null 2>&1 || die "jq is required"
  [ "$(stage_idx "$CAUGHT_STAGE")" -gt 0 ] || die "audit: --caught-at-stage must be LATER than depth0_panel (publish_hetero_review|post_merge|cookys_audit)"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; EMIT="$SCRIPT_DIR/qc-metric-emit.js"
  [ -f "$EMIT" ] || die "qc-metric-emit.js not found next to this script"
  resolve_stores; load_policy
  jq -e --arg c "$TASK_CLASS" --arg id "$CHANGE_ID" '.classes[$c].change_ids | index($id)' "$STATE_FILE" >/dev/null 2>&1 \
    || die "audit: change_id '$CHANGE_ID' is not in class '$TASK_CLASS' ledger (audit records a LATER find on a prior cycle)"

  echo "== ladder-run audit: class=$TASK_CLASS change=$CHANGE_ID finding=$FINDING_ID caught_at=$CAUGHT_STAGE =="
  # verdict_stage stays depth0_panel (the gate); the finding is caught LATER ⇒ an ESCAPE.
  # panel_verdict=pass (union-merge keeps the earliest depth0 pass; escape ⇔ pass + later catch).
  FINDINGS_JSON=$(jq -n --arg id "$FINDING_ID" --arg sev "$SEVERITY" --arg lens "$LENS" --arg st "$CAUGHT_STAGE" \
    '[{id:$id, severity:$sev, lens:$lens, verified:"real", caught_at_stage:$st}]')
  ESCAPES_JSON=$(jq -n --arg id "$FINDING_ID" --arg st "$CAUGHT_STAGE" '[{defect:$id, found_at_stage:$st}]')
  EMIT_CORE=(--change-id "$CHANGE_ID" --repo "$REPO" --base-sha "$BASE_SHA" --head-sha "$HEAD_SHA"
    --verdict pass --stage depth0_panel --lenses "$LENS" --findings "$FINDINGS_JSON" --escapes "$ESCAPES_JSON"
    --autonomous --endorsed "$ENDORSED")

  # ATOMIC emit + state (both-or-neither, #3): compute on a TEMP store, then STATE first,
  # then the STORE append LAST; roll back on any real-write failure.
  TMP_METRIC="$(mktemp)"; cat "$STORE" > "$TMP_METRIC" 2>/dev/null || true
  node "$EMIT" --store "$TMP_METRIC" "${EMIT_CORE[@]}" >/dev/null || { rm -f "$TMP_METRIC"; die "audit event failed schema validation — nothing written"; }
  class_metrics "$TASK_CLASS" "" "$TMP_METRIC"
  promotion_decision "$TIER"
  rm -f "$TMP_METRIC"
  echo ""
  echo "== ladder report (post-audit): class=$TASK_CLASS tier=$TIER =="
  echo "   class escape rate: ${CLASS_ESC_PCT:-n/a}%  (real defects: ${CLASS_REAL}, cycles: ${VERIFIED_CYCLES})  calc_ok=${CALC_OK}"
  echo "   endorsement rate : ${ENDORSE_PCT:-n/a}%"
  echo "   promotion        : $PROMO — $REASON"
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  AUD=$(jq -n --arg cid "$CHANGE_ID" --arg fid "$FINDING_ID" --arg st "$CAUGHT_STAGE" --arg sev "$SEVERITY" \
    --arg lens "$LENS" --arg ts "$TS" --arg esc "${CLASS_ESC_PCT:-}" --arg promo "$PROMO" --arg reason "$REASON" \
    --arg endorsed "$ENDORSED" \
    '{type:"audit", change_id:$cid, finding_id:$fid, caught_at_stage:$st, severity:$sev, lens:$lens,
      endorsed:$endorsed, timestamp:$ts, class_escape_rate_pct:($esc|tonumber? // null),
      promotion:$promo, reason:$reason}')
  STATE_BAK="$(mktemp)"; cat "$STATE_FILE" > "$STATE_BAK"
  TMP_STATE="$(mktemp)"
  set +e
  jq --arg c "$TASK_CLASS" --argjson a "$AUD" '.classes[$c].cycles += [$a] | .updated=(now|todateiso8601)' \
    "$STATE_FILE" > "$TMP_STATE" 2>/dev/null
  if [ $? -ne 0 ] || [ ! -s "$TMP_STATE" ]; then set -e; rm -f "$TMP_STATE" "$STATE_BAK"; echo "ladder-run: audit state build failed — nothing emitted (both-or-neither); needs_human" >&2; exit 4; fi
  mv "$TMP_STATE" "$STATE_FILE" 2>/dev/null || { set -e; rm -f "$STATE_BAK"; echo "ladder-run: audit state write failed — nothing emitted; needs_human" >&2; exit 4; }
  node "$EMIT" --store "$STORE" "${EMIT_CORE[@]}" >/dev/null
  if [ $? -ne 0 ]; then cat "$STATE_BAK" > "$STATE_FILE"; rm -f "$STATE_BAK"; set -e; echo "ladder-run: audit emit failed after state write — rolled back state (both-or-neither); needs_human" >&2; exit 4; fi
  set -e; rm -f "$STATE_BAK"
  echo "   committed        : event → $STORE ; audit → $STATE_FILE"
  [ "${NEEDS_HUMAN_PROMO:-0}" = "1" ] && exit 3 || exit 0
fi

# ------------------------------------------------------------------ RUN subcommand
TASK_CLASS=""; CHANGE_ID=""; REPO=""; STATE_FILE=""; BASE_SHA=""; HEAD_SHA=""
DIFF_FILE=""; IMPL_PROMPT=""; BRANCH=""; IMPL_RUNNER="codex"; IMPL_MODEL=""
REVIEWER_RUNNER="codex"; REVIEWER_MODEL="gpt-5.6-sol"; LENSES="doc-accuracy,link-integrity"
MOCK_VERDICT=""; STORE=""; QC_PY=""; SAMPLE_RATE=""; DRY_RUN=0; GATE_CMD=""; GATE_DIR=""
while [ $# -gt 0 ]; do case "$1" in
  --task-class) TASK_CLASS="$2"; shift 2;;
  --change-id) CHANGE_ID="$2"; shift 2;;
  --repo) REPO="$2"; shift 2;;
  --state-file) STATE_FILE="$2"; shift 2;;
  --base-sha) BASE_SHA="$2"; shift 2;;
  --head-sha) HEAD_SHA="$2"; shift 2;;
  --diff-file) DIFF_FILE="$2"; shift 2;;
  --impl-prompt-file) IMPL_PROMPT="$2"; shift 2;;
  --branch) BRANCH="$2"; shift 2;;
  --impl-runner) IMPL_RUNNER="$2"; shift 2;;
  --impl-model) IMPL_MODEL="$2"; shift 2;;
  --reviewer-runner) REVIEWER_RUNNER="$2"; shift 2;;
  --reviewer-model) REVIEWER_MODEL="$2"; shift 2;;
  --lenses) LENSES="$2"; shift 2;;
  --mock-verdict) MOCK_VERDICT="$2"; shift 2;;
  --gate-cmd) GATE_CMD="$2"; shift 2;;
  --gate-dir) GATE_DIR="$2"; shift 2;;
  --store) STORE="$2"; shift 2;;
  --qc-metric-py) QC_PY="$2"; shift 2;;
  --sample-rate) SAMPLE_RATE="$2"; shift 2;;
  --dry-run) DRY_RUN=1; shift;;
  -h|--help) usage; exit 0;;
  *) die "run: unknown arg: $1";;
esac; done

[ -n "$TASK_CLASS" ] || die "missing --task-class"
[ -n "$CHANGE_ID" ]  || die "missing --change-id"
[ -n "$REPO" ]       || die "missing --repo"
[ -n "$STATE_FILE" ] || die "missing --state-file"
[ -n "$BASE_SHA" ]   || die "missing --base-sha"
[ -n "$HEAD_SHA" ]   || die "missing --head-sha"
[ -f "$STATE_FILE" ] || die "state file not found: $STATE_FILE"
command -v jq >/dev/null 2>&1 || die "jq is required"
if [ -n "$DIFF_FILE" ] && [ -n "$IMPL_PROMPT" ]; then die "provide EITHER --diff-file OR --impl-prompt-file, not both (ambiguous)"; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMIT="$SCRIPT_DIR/qc-metric-emit.js"; REVIEW="$SCRIPT_DIR/dispatch-review.sh"; HETERO="$SCRIPT_DIR/dispatch-hetero.sh"
[ -f "$EMIT" ] || die "qc-metric-emit.js not found next to this script"
resolve_stores; load_policy
echo "== ladder-run: class=$TASK_CLASS tier=$TIER change=$CHANGE_ID repo=$REPO =="

# ---- 1. IMPL ----
if [ -n "$IMPL_PROMPT" ]; then
  [ -n "$BRANCH" ] || die "--impl-prompt-file requires --branch"
  [ -f "$HETERO" ] || die "dispatch-hetero.sh not found (needed for --impl-prompt-file)"
  echo "-- impl: dispatching worktree-isolated implementer ($IMPL_RUNNER) --"
  HARGS=(--branch "$BRANCH" --prompt-file "$IMPL_PROMPT" --runner "$IMPL_RUNNER" --base "$BASE_SHA")
  [ -n "$IMPL_MODEL" ] && HARGS+=(--model "$IMPL_MODEL")
  IMPL_JSON="$("$HETERO" "${HARGS[@]}")" || die "dispatch-hetero failed: $IMPL_JSON"
  [ "$(printf '%s' "$IMPL_JSON" | jq -r '.status')" = "committed" ] || die "implementer did not commit ($(printf '%s' "$IMPL_JSON" | jq -r '.status'))"
  IMPL_COMMIT=$(printf '%s' "$IMPL_JSON" | jq -r '.commit // empty')
  [ -n "$IMPL_COMMIT" ] || die "implementer returned committed status without a commit sha"
  git rev-parse --verify --quiet "${IMPL_COMMIT}^{commit}" >/dev/null \
    || die "implementer returned commit not visible from this repo: $IMPL_COMMIT"
  IMPL_COMMIT=$(git rev-parse "$IMPL_COMMIT")
  IMPL_BRANCH=$(printf '%s' "$IMPL_JSON" | jq -r '.branch // empty')
  [ "$IMPL_BRANCH" = "$BRANCH" ] || die "implementer returned branch '$IMPL_BRANCH' but expected '$BRANCH'"
  BRANCH_TIP=$(git rev-parse --verify --quiet "refs/heads/${BRANCH}^{commit}") \
    || die "implementer branch not visible from this repo: refs/heads/$BRANCH"
  [ "$BRANCH_TIP" = "$IMPL_COMMIT" ] \
    || die "implementer returned commit $IMPL_COMMIT but refs/heads/$BRANCH points to $BRANCH_TIP"
  git merge-base --is-ancestor "$BASE_SHA" "$IMPL_COMMIT" \
    || die "implementer returned commit does not descend from base: $IMPL_COMMIT (base $BASE_SHA)"
  DIFF_FILE="$(mktemp)"
  git diff "$BASE_SHA..$IMPL_COMMIT" > "$DIFF_FILE"
  HEAD_SHA=$(git rev-parse "$IMPL_COMMIT")
elif [ -n "$DIFF_FILE" ]; then
  [ -f "$DIFF_FILE" ] || die "diff file not found: $DIFF_FILE"
  echo "-- impl: using pre-produced artifact $DIFF_FILE ($(wc -l <"$DIFF_FILE") lines) --"
else
  die "provide exactly one artifact source: --diff-file OR --impl-prompt-file"
fi
[ -s "$DIFF_FILE" ] || die "diff artifact is empty — nothing to verify"

# ---- 2. VERIFY (decorrelated, isolated: diff text only) ----
if [ -n "$MOCK_VERDICT" ]; then
  echo "-- verify: MOCK verdict=$MOCK_VERDICT (TEST SEAM — not a real datapoint) --" >&2
  VERDICT_RAW="$MOCK_VERDICT"; VSTATUS="reviewed"; VRUNNER="mock"; VMODEL="mock"
else
  [ -f "$REVIEW" ] || die "dispatch-review.sh not found (needed for verification)"
  echo "-- verify: decorrelated hetero verifier ($REVIEWER_RUNNER/$REVIEWER_MODEL), diff-only --"
  set +e
  VJSON="$("$REVIEW" --runner "$REVIEWER_RUNNER" --model "$REVIEWER_MODEL" --diff-file "$DIFF_FILE")"; set -e
  # Fail-closed on empty/invalid verifier JSON: jq on empty/malformed input errors,
  # which under `set -e` would abort BEFORE the fail-closed event is emitted. The
  # `2>/dev/null || echo` fallbacks route empty/invalid → no_verdict → panel_verdict=fail.
  VSTATUS=$(printf '%s' "$VJSON" | jq -r '.status // "no_verdict"' 2>/dev/null || echo "no_verdict")
  VERDICT_RAW=$(printf '%s' "$VJSON" | jq -r '.verdict // "null"' 2>/dev/null || echo "null")
  VRUNNER=$(printf '%s' "$VJSON" | jq -r '.runner // "?"' 2>/dev/null || echo "?")
  VMODEL=$(printf '%s' "$VJSON" | jq -r '.model // "?"' 2>/dev/null || echo "?")
fi
NEEDS_HUMAN=0
case "$VSTATUS/$VERDICT_RAW" in
  reviewed/SHIP-AS-IS)    LLM_VERDICT="pass";;
  reviewed/FIX-THEN-SHIP) LLM_VERDICT="fail";;
  *)                      LLM_VERDICT="fail"; NEEDS_HUMAN=1;;   # no_verdict/precondition — fail-closed
esac
# Keep WHAT the verifier said, not just that it said no. Before 2026-09-03 only the verdict
# survived; a `fail` then cost a second full dispatch-review to become actionable (fuchikoma
# doc-sync cycles #3–#4). Text is untrusted model output: cap it, strip control chars.
VFINDINGS_TEXT=""
if [ -z "$MOCK_VERDICT" ]; then
  VFINDINGS_TEXT=$(printf '%s' "$VJSON" | jq -r '(.findings // "") | if type=="array" then join("") else tostring end' 2>/dev/null \
    | tr -d '\000-\010\013\014\016-\037\177' | head -c 2000 || true)
fi
echo "   verifier: status=$VSTATUS verdict=$VERDICT_RAW → llm_verdict=$LLM_VERDICT needs_human=$NEEDS_HUMAN"

# ---- 2b. MECHANICAL ORACLE (optional, --gate-cmd) — runs in-cycle, union with the LLM ----
# The diff-only verifier is structurally blind to any claim that points OUTSIDE the diff
# (a version literal that moved after the diff was written, a count, a path that does not
# exist). A deterministic gate reads the repo, not the text. Both must pass; either catch is
# a depth0_panel catch (not an escape). Gate output is kept on the finding for triage.
GATE_VERDICT="n/a"; GATE_RC=""; GATE_TAIL=""
if [ -n "$GATE_CMD" ]; then
  GATE_WD="${GATE_DIR:-$PWD}"
  echo "-- gate: mechanical oracle in $GATE_WD: $GATE_CMD --"
  set +e
  GATE_OUT=$(cd "$GATE_WD" && bash -c "$GATE_CMD" 2>&1); GATE_RC=$?
  set -e
  GATE_TAIL=$(printf '%s' "$GATE_OUT" | tail -c 1500 | tr -d '\000-\010\013\014\016-\037\177')
  if [ "$GATE_RC" = "0" ]; then GATE_VERDICT="pass"; else GATE_VERDICT="fail"; fi
  echo "   gate: rc=$GATE_RC → gate_verdict=$GATE_VERDICT"
fi

if [ "$LLM_VERDICT" = "pass" ] && [ "$GATE_VERDICT" != "fail" ]; then PANEL_VERDICT="pass"; else PANEL_VERDICT="fail"; fi
echo "   panel: llm=$LLM_VERDICT gate=$GATE_VERDICT → panel_verdict=$PANEL_VERDICT"

# Findings caught at THIS gate are caught_at_stage=depth0_panel = verdict stage ⇒ a CATCH,
# NOT an escape. Escapes are recorded later via the `audit` subcommand. Clean pass ⇒ [].
FINDINGS_JSON=$(jq -cn --arg nh "$NEEDS_HUMAN" --arg llm "$LLM_VERDICT" --arg gate "$GATE_VERDICT" \
  --arg vtext "$VFINDINGS_TEXT" --arg gtail "$GATE_TAIL" --arg gcmd "$GATE_CMD" --arg grc "$GATE_RC" '
  ( if $nh == "1" then
      [{"id":"verifier-no-verdict","severity":"high","lens":"verifier-isolation","verified":"unverified","caught_at_stage":"depth0_panel"}]
    elif $llm == "fail" then
      [{"id":"verifier-flagged-onstage","severity":"medium","lens":"doc-accuracy","verified":"unverified","caught_at_stage":"depth0_panel",
        "detail": $vtext}]
    else [] end )
  + ( if $gate == "fail" then
      [{"id":"mechanical-gate-failed","severity":"medium","lens":"mechanical-gate","verified":"real","caught_at_stage":"depth0_panel",
        "detail": ("gate `" + $gcmd + "` rc=" + $grc + "\n" + $gtail)}]
    else [] end )')

# ---- 4. SAMPLE (H1: keyed on head_sha + optional secret salt, NOT change_id) ----
SALT="${LADDER_SAMPLE_SALT:-}"
HASHHEX=$(printf '%s' "${SALT}|${HEAD_SHA}" | sha256sum | cut -c1-8)
BUCKET=$(awk -v h="$((16#$HASHHEX))" 'BEGIN{printf "%.6f", (h % 100000)/100000.0}')
SAMPLED=$(awk -v b="$BUCKET" -v r="$SAMPLE_RATE" 'BEGIN{print (b < r) ? "true" : "false"}')
echo "-- sample: rate=$SAMPLE_RATE key=head_sha$([ -n "$SALT" ] && echo "+salt") bucket=$BUCKET → cookys_sample=$SAMPLED --"

# acceptance is agent-HELD: a PASS ships on the agent's verdict (autonomous=true, endorsed
# pending). A FAIL / needs_human did NOT ship on acceptance ⇒ autonomous=false so it does
# not dilute the endorsement denominator (L1).
if [ "$PANEL_VERDICT" = "pass" ]; then AUTONOMOUS_FLAG=(--autonomous); AUTON_STATE="true"; else AUTONOMOUS_FLAG=(); AUTON_STATE="false"; fi

if [ "$DRY_RUN" = "1" ]; then
  echo "-- DRY-RUN: would emit change_id=$CHANGE_ID verdict=$PANEL_VERDICT autonomous=$AUTON_STATE findings=$FINDINGS_JSON --"
  echo "-- DRY-RUN: no store write, no state update --"; exit 0
fi

# ---- 3+5+persist: ATOMIC emit + state (both-or-neither, #3) ----
# The event under review, as flags (store passed per-call):
EMIT_CORE=(--change-id "$CHANGE_ID" --repo "$REPO" --base-sha "$BASE_SHA" --head-sha "$HEAD_SHA"
  --verdict "$PANEL_VERDICT" --stage depth0_panel --lenses "$LENSES" --findings "$FINDINGS_JSON"
  "${AUTONOMOUS_FLAG[@]}" --endorsed null)

# Phase A — compute the report on a TEMP store (real store + candidate event); NO real write
# yet. If the event is invalid, nothing is written anywhere.
TMP_METRIC="$(mktemp)"; cat "$STORE" > "$TMP_METRIC" 2>/dev/null || true
node "$EMIT" --store "$TMP_METRIC" "${EMIT_CORE[@]}" >/dev/null || { rm -f "$TMP_METRIC"; die "event failed schema validation — nothing written"; }
class_metrics "$TASK_CLASS" "$CHANGE_ID" "$TMP_METRIC"
promotion_decision "$TIER"
if [ "${NEEDS_HUMAN_PROMO:-0}" = "1" ]; then NEEDS_HUMAN=1; fi
rm -f "$TMP_METRIC"
echo ""
echo "== ladder report: class=$TASK_CLASS tier=$TIER =="
echo "   verifier         : $VRUNNER/$VMODEL → $LLM_VERDICT"
echo "   mechanical gate  : ${GATE_CMD:-(none)} → $GATE_VERDICT"
echo "   panel verdict    : $PANEL_VERDICT"
if [ "$LLM_VERDICT" = "fail" ] && [ -n "$VFINDINGS_TEXT" ]; then
  echo "   verifier findings: $(printf '%s' "$VFINDINGS_TEXT" | head -c 400 | tr '\n' ' ')"
fi
if [ "$GATE_VERDICT" = "fail" ]; then
  echo "   gate output tail : $(printf '%s' "$GATE_TAIL" | tail -c 400 | tr '\n' ' ')"
fi
echo "   cookys sample    : $SAMPLED (rate $SAMPLE_RATE)"
echo "   class escape rate: ${CLASS_ESC_PCT:-n/a}%  (real defects: ${CLASS_REAL:-0}, cycles: ${VERIFIED_CYCLES:-0})  calc_ok=${CALC_OK}"
echo "   endorsement rate : ${ENDORSE_PCT:-n/a}%"
echo "   promotion        : $PROMO — $REASON"

# Phase B — the two REAL writes, both-or-neither. STATE first (single-writer, backed up so it
# can be restored); the STORE append is LAST (append-only → safe under concurrent store
# writers; never truncated). If EITHER real write fails, roll back so the store and the state
# never disagree, and exit 4 (needs_human reconcile).
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CYCLE=$(jq -n --arg cid "$CHANGE_ID" --arg repo "$REPO" --arg ts "$TS" --arg verdict "$PANEL_VERDICT" \
  --arg sampled "$SAMPLED" --arg reviewer "$VRUNNER/$VMODEL" --arg esc "${CLASS_ESC_PCT:-}" \
  --arg real "${CLASS_REAL:-0}" --arg cycles "${VERIFIED_CYCLES:-0}" --arg promo "$PROMO" \
  --arg reason "$REASON" --arg nh "$NEEDS_HUMAN" --arg auton "$AUTON_STATE" --arg calc "${CALC_OK:-0}" \
  --arg llm "$LLM_VERDICT" --arg gate "$GATE_VERDICT" --arg gcmd "$GATE_CMD" --argjson findings "$FINDINGS_JSON" \
  '{type:"cycle", change_id:$cid, repo:$repo, timestamp:$ts, verdict:$verdict, autonomous:($auton=="true"),
    cookys_sample:($sampled=="true"), reviewer:$reviewer, llm_verdict:$llm, gate_verdict:$gate,
    gate_cmd:(if $gcmd=="" then null else $gcmd end), findings:$findings,
    class_escape_rate_pct:($esc|tonumber? // null),
    class_real_defects:($real|tonumber? // 0), class_verified_cycles:($cycles|tonumber? // 0),
    calc_ok:($calc=="1"), needs_human:($nh=="1"), promotion:$promo, reason:$reason}')
STATE_BAK="$(mktemp)"; cat "$STATE_FILE" > "$STATE_BAK"
TMP_STATE="$(mktemp)"
set +e
jq --arg c "$TASK_CLASS" --arg cid "$CHANGE_ID" --argjson cyc "$CYCLE" \
  '.classes[$c].change_ids |= (. + [$cid] | unique) | .classes[$c].cycles += [$cyc] | .updated=(now|todateiso8601)' \
  "$STATE_FILE" > "$TMP_STATE" 2>/dev/null
if [ $? -ne 0 ] || [ ! -s "$TMP_STATE" ]; then
  set -e; rm -f "$TMP_STATE" "$STATE_BAK"
  echo "ladder-run: state build failed — nothing emitted to store (both-or-neither); needs_human reconcile" >&2; exit 4
fi
mv "$TMP_STATE" "$STATE_FILE" 2>/dev/null
if [ $? -ne 0 ]; then set -e; rm -f "$STATE_BAK"; echo "ladder-run: state write failed — nothing emitted (both-or-neither); needs_human" >&2; exit 4; fi
# state committed → the LAST write: append the event to the REAL store
node "$EMIT" --store "$STORE" "${EMIT_CORE[@]}" >/dev/null
if [ $? -ne 0 ]; then
  cat "$STATE_BAK" > "$STATE_FILE"      # roll state back → neither store nor state recorded it
  rm -f "$STATE_BAK"; set -e
  echo "ladder-run: store emit failed after state write — rolled back state (both-or-neither); needs_human" >&2; exit 4
fi
set -e
rm -f "$STATE_BAK"
echo "   committed        : event → $STORE ; cycle → $STATE_FILE"
[ "$NEEDS_HUMAN" = "1" ] && exit 3 || exit 0
