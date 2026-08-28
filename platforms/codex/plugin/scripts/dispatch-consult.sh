#!/usr/bin/env bash
# dispatch-consult.sh — the consult consumer (plan
# docs/plans/2026-08-28-consult-discuss-qualification.md D8). Resolver-driven
# consult dispatch: switch resolution AND dispatch invocation live in this
# script, so there is a real entry point a shell test can drive (round-2
# finding [6]). Replaces the hand-copied `references/hetero-dispatch.md:551-560`
# recipe (KR5).
#
# Transport: scripts/dispatch-author.sh — the raw-prompt rail. dispatch-review.sh
# is ruled out (round-2 finding [0]): it only succeeds after parsing exactly one
# SHIP-AS-IS/FIX-THEN-SHIP verdict, which a contract-compliant consult answer
# must never carry. Consult rides the same raw-prompt rail as discuss, with the
# frozen consult JSON response schema (evals/consult-eval-rubric.md, D1) and NO
# review-verdict protocol anywhere in the prompt, the parser, or the output.
#
# Output is ADVICE ONLY (plan §2.5 Global Constraints): this script never
# emits, implies, or is routed into a ship/no-ship verdict, and rejects any
# response carrying a loop-convergence verdict token as protocol_violation.
#
# USAGE:
#   scripts/dispatch-consult.sh --question-file <path> --artifact <path> [--artifact <path> ...]
#       [--repo-root <path>] [--timeout <dur>] [--dispatch-author-bin <path>]
#
#   --question-file   the original bounded question (REQUIRED). Baseline text —
#                      defines the goal, never an implementer's account of it.
#   --artifact         a repo-grounded artifact file (diff, source file, test
#                       output, ...). Repeatable; at least one required.
#   --repo-root         defaults to $PWD; forwarded to resolve-review-loop.sh's
#                       cwd-relative config lookup.
#   --timeout           forwarded to dispatch-author.sh (default:
#                       $AUTOPILOT_CONSULT_TIMEOUT or 5m).
#   --dispatch-author-bin / AUTOPILOT_DISPATCH_AUTHOR_BIN  TEST SEAM ONLY:
#                       overrides the dispatch-author.sh binary invoked for
#                       transport (default: the sibling
#                       scripts/dispatch-author.sh; same seam family as
#                       scripts/dispatch-discuss.js's --dispatch-author-bin —
#                       explicit override, no PATH-shadowing magic). This is
#                       the documented seam a test substitutes to record
#                       argv / stub responses without a live network call.
#
# BLIND-EVIDENCE PREFLIGHT (structural, not advisory — references/blind-dispatch.md
# § Verifier isolation; plan §2.5): before any transport spawn, every supplied
# file (question + artifacts) is scanned by scripts/check-blind-evidence.sh. A
# payload carrying an implementer's self-report, summary, or self-verdict is
# refused — a self-report-bearing bundle can never reach a consult engine.
#
# OUTPUT: one JSON object on stdout:
#   { "role": "consult", "status": "advised|switch_off|qualification_failed|
#       blind_evidence_violation|transport_failed|protocol_violation|verdict_rejected",
#     "engine": "...", "runner": "...", "effort": "...", "endpoint": "..."|null,
#     "response": <frozen consult schema>|null, "error": "..."|null }
#
# EXIT: 0 = advised. 2 = consult_dispatch off (usage-shaped refusal — no
#   transport spawned). 3 = qualification/config gate refused the seat
#   (resolve-review-loop.sh's own message is surfaced, never re-invented). 4 =
#   blind-evidence preflight violation. 5 = transport/protocol failure
#   (dispatch-author.sh non-authored result, malformed/non-schema response, or
#   a verdict token in the response).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/json-emit.sh
. "$SCRIPT_DIR/lib/json-emit.sh"

QUESTION_FILE=""
declare -a ARTIFACTS=()
REPO_ROOT="$PWD"
TIMEOUT="${AUTOPILOT_CONSULT_TIMEOUT:-5m}"
AUTHOR_BIN="${AUTOPILOT_DISPATCH_AUTHOR_BIN:-$SCRIPT_DIR/dispatch-author.sh}"

while [ $# -gt 0 ]; do
  case "$1" in
    --question-file) QUESTION_FILE="${2:-}"; shift 2 ;;
    --artifact) ARTIFACTS+=("${2:-}"); shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --dispatch-author-bin) AUTHOR_BIN="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "dispatch-consult: unknown arg: $1" >&2; exit 2 ;;
  esac
done

emit() {
  local status="$1" engine="$2" runner="$3" effort="$4" endpoint="$5" response_json="$6" error="$7" exit_code="$8"
  local endpoint_json="null"
  [ -n "$endpoint" ] && endpoint_json="\"$(json_escape "$endpoint")\""
  local error_json="null"
  [ -n "$error" ] && error_json="\"$(json_escape "$error")\""
  [ -z "$response_json" ] && response_json="null"
  printf '{ "role": "consult", "status": "%s", "engine": "%s", "runner": "%s", "effort": "%s", "endpoint": %s, "response": %s, "error": %s }\n' \
    "$(json_escape "$status")" "$(json_escape "$engine")" "$(json_escape "$runner")" "$(json_escape "$effort")" \
    "$endpoint_json" "$response_json" "$error_json"
  exit "$exit_code"
}

[ -n "$QUESTION_FILE" ] && [ -r "$QUESTION_FILE" ] || { echo "dispatch-consult: --question-file is required and must be readable" >&2; exit 2; }
[ "${#ARTIFACTS[@]}" -gt 0 ] || { echo "dispatch-consult: at least one --artifact is required" >&2; exit 2; }
for _a in "${ARTIFACTS[@]}"; do
  [ -r "$_a" ] || { echo "dispatch-consult: --artifact not readable: $_a" >&2; exit 2; }
done
[ -x "$AUTHOR_BIN" ] || { echo "dispatch-consult: --dispatch-author-bin not executable: $AUTHOR_BIN" >&2; exit 2; }

# ── 1. Resolve the roster, once. This is also where the D7 switch-on
# qualification gate lives (resolve-review-loop.sh D7) — a seat that fails it
# exits 3 with its own message; this script surfaces that message rather than
# inventing its own (plan D8 contract).
RESOLVE_ERR="$(mktemp "${TMPDIR:-/tmp}/dispatch-consult-resolve.XXXXXX.err")"
RESOLVED_JSON="$(cd "$REPO_ROOT" && "$SCRIPT_DIR/resolve-review-loop.sh" 2>"$RESOLVE_ERR")"
RESOLVE_RC=$?
RESOLVE_ERR_TEXT="$(cat "$RESOLVE_ERR" 2>/dev/null)"
rm -f "$RESOLVE_ERR"
if [ "$RESOLVE_RC" -ne 0 ]; then
  [ -n "$RESOLVE_ERR_TEXT" ] && echo "$RESOLVE_ERR_TEXT" >&2
  emit "qualification_failed" "" "" "" "" "" "resolve-review-loop.sh exited $RESOLVE_RC: ${RESOLVE_ERR_TEXT:-no message}" 3
fi

json_field() { # key -> raw value ("" for null/missing)
  node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  let j; try { j = JSON.parse(s); } catch { process.stdout.write(""); return; }
  const v = j[process.argv[1]];
  process.stdout.write(v === null || v === undefined ? "" : String(v));
});' "$1" <<<"$RESOLVED_JSON"
}

CONSULT_DISPATCH="$(json_field consult_dispatch)"
if [ "$CONSULT_DISPATCH" != "on" ]; then
  echo "dispatch-consult: consult_dispatch is off — refusing (no transport dispatched)" >&2
  emit "switch_off" "" "" "" "" "" "consult_dispatch is off" 2
fi

CONSULT_ENGINE="$(json_field consult_engine)"
CONSULT_RUNNER="$(json_field consult_runner)"
CONSULT_EFFORT="$(json_field consult_effort)"
CONSULT_ENDPOINT="$(json_field consult_endpoint)"
if [ -z "$CONSULT_ENGINE" ] || [ -z "$CONSULT_RUNNER" ] || [ -z "$CONSULT_EFFORT" ]; then
  echo "dispatch-consult: consult_dispatch=on but the consult seat did not resolve engine/runner/effort — refusing" >&2
  emit "qualification_failed" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "consult seat unresolved" 3
fi

# ── 2. Blind-evidence preflight (references/blind-dispatch.md § Verifier
# isolation; plan §2.5). Structural, not advisory: refuses BEFORE any
# transport spawn. Never fed the implementer's self-report/summary/verdict —
# only the question baseline + artifacts.
BLIND_PAYLOAD_ARGS=(--payload "$QUESTION_FILE")
for _a in "${ARTIFACTS[@]}"; do BLIND_PAYLOAD_ARGS+=(--payload "$_a"); done
BLIND_OUT="$("$SCRIPT_DIR/check-blind-evidence.sh" "${BLIND_PAYLOAD_ARGS[@]}" 2>&1)"
BLIND_RC=$?
if [ "$BLIND_RC" -ne 0 ]; then
  echo "dispatch-consult: blind-evidence preflight refused the payload:" >&2
  echo "$BLIND_OUT" >&2
  emit "blind_evidence_violation" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "payload carries implementer self-report/summary/self-verdict" 4
fi

# ── 3. Assemble the raw prompt (no local review template — dispatch-author.sh
# forwards raw bytes verbatim). Carries the frozen consult response contract
# (evals/consult-eval-rubric.md), never a review-verdict protocol.
PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/dispatch-consult-prompt.XXXXXX")"
CORPUS_MANIFEST="$REPO_ROOT_DEFAULT/evals/consult-capability-evidence-corpus.json"
QC_TOKEN="qc@depth-0"
if [ -r "$CORPUS_MANIFEST" ]; then
  QC_TOKEN="$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.qc_reference_token||"qc@depth-0");}catch{process.stdout.write("qc@depth-0");}' "$CORPUS_MANIFEST")"
fi
{
  echo "You are a consult seat: a bounded, repo-grounded second opinion under"
  echo "blind-evidence rules. You receive ONE question and an artifact bundle"
  echo "(diffs, files, test output, or the original task). You never see any"
  echo "implementer self-report or self-verdict."
  echo
  echo "YOUR ANSWER MUST BE:"
  echo "- correct against the bundle alone — you have no other source of truth;"
  echo "- grounded ONLY in the supplied artifacts;"
  echo "- bounded to the question asked — a real, unrelated issue elsewhere in"
  echo "  the bundle is an ASIDE, never folded into the answer or escalated;"
  echo "- advice, never authority — you never decide whether to ship. If the"
  echo "  question is phrased as a decision request, give your opinion and"
  echo "  explicitly REFUSE the decision, naming that ship/no-ship authority"
  echo "  sits at ${QC_TOKEN}, not with this seat."
  echo
  echo "If the bundle lacks the fact needed to answer, say insufficient_evidence"
  echo "and name the missing artifact — that is the honest answer, not a failure."
  echo
  echo 'OUTPUT CONTRACT — exactly ONE JSON object, no prose, no markdown fences:'
  echo '{ "answer": { "label": "<one label>", "artifact_ref": "<one id|null>" },'
  echo '  "aside": [ { "note": "..." } ],'
  echo "  \"authority\": { \"refused\": <true|false>, \"reference\": \"<${QC_TOKEN} when refused, else null>\" } }"
  echo
  echo "HARD RULES: emit ONLY these three top-level fields; answer.label is a"
  echo "SINGLE value (never assert insufficient_evidence together with a"
  echo "confident artifact_ref); answer.artifact_ref names AT MOST ONE"
  echo "artifact; never emit a ship/no-ship verdict token of any kind."
  echo
  echo "=== QUESTION ==="
  cat "$QUESTION_FILE"
  echo
  for _a in "${ARTIFACTS[@]}"; do
    echo "=== ARTIFACT: $_a ==="
    cat "$_a"
    echo
  done
} > "$PROMPT_FILE"

# ── 4. Dispatch — the raw-prompt dispatch-author.sh rail. Tuple → argv:
# consult_runner → --runner, consult_engine → --model, consult_effort →
# --effort, consult_endpoint → --endpoint (omitted when empty).
declare -a AUTHOR_ARGS=(--runner "$CONSULT_RUNNER" --model "$CONSULT_ENGINE" --effort "$CONSULT_EFFORT" --prompt-file "$PROMPT_FILE" --timeout "$TIMEOUT")
[ -n "$CONSULT_ENDPOINT" ] && AUTHOR_ARGS+=(--endpoint "$CONSULT_ENDPOINT")

AUTHOR_ERR="$(mktemp "${TMPDIR:-/tmp}/dispatch-consult-author.XXXXXX.err")"
AUTHOR_OUT="$("$AUTHOR_BIN" "${AUTHOR_ARGS[@]}" 2>"$AUTHOR_ERR")"
AUTHOR_RC=$?
[ -s "$AUTHOR_ERR" ] && cat "$AUTHOR_ERR" >&2
rm -f "$AUTHOR_ERR" "$PROMPT_FILE"

AUTHOR_STATUS="$(printf '%s' "$AUTHOR_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.status||"");}catch{process.stdout.write("");}})' 2>/dev/null || true)"
AUTHOR_RAW_LOG="$(printf '%s' "$AUTHOR_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.raw_log||"");}catch{process.stdout.write("");}})' 2>/dev/null || true)"

if [ "$AUTHOR_RC" -ne 0 ] || [ "$AUTHOR_STATUS" != "authored" ]; then
  echo "dispatch-consult: transport did not produce an authored result (status=${AUTHOR_STATUS:-unknown}, exit=$AUTHOR_RC)" >&2
  emit "transport_failed" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "transport status=${AUTHOR_STATUS:-unknown}" 5
fi

[ -n "$AUTHOR_RAW_LOG" ] && [ -r "$AUTHOR_RAW_LOG" ] || {
  echo "dispatch-consult: authored result carried no readable raw_log" >&2
  emit "transport_failed" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "no raw_log from transport" 5
}
RESPONSE_TEXT="$(cat "$AUTHOR_RAW_LOG")"

# ── 5. Verdict-token post-filter (evals/consult-capability-evidence-corpus.json
# verdict_tokens — the same pinned list D1's grader consumes). A consult answer
# never carries a loop-convergence verdict, now a coherent rule because the
# transport no longer requires one (plan D8).
VERDICT_HIT="$(node -e '
const fs = require("fs");
let tokens = ["ship it","ready to ship","do not ship","no-ship","approved to merge","blocking, do not merge","ship-as-is","fix-then-ship"];
try {
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (Array.isArray(j.verdict_tokens) && j.verdict_tokens.length) tokens = j.verdict_tokens;
} catch {}
const text = fs.readFileSync(process.argv[2], "utf8").toLowerCase();
const hit = tokens.find(t => text.includes(String(t).toLowerCase()));
process.stdout.write(hit || "");
' "$CORPUS_MANIFEST" "$AUTHOR_RAW_LOG" 2>/dev/null || true)"
if [ -n "$VERDICT_HIT" ]; then
  echo "dispatch-consult: response rejected — carries a loop-convergence verdict token: $VERDICT_HIT" >&2
  emit "verdict_rejected" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "verdict token present: $VERDICT_HIT" 5
fi

# ── 6. Validate the frozen consult response schema (evals/consult-eval-rubric.md
# "Response schema (CLOSED)"): { answer: {label, artifact_ref}, aside: [{note}],
# authority: {refused, reference} } — no extra keys, single answer, exclusivity.
VALIDATION="$(node -e '
const fs = require("fs");
let j;
try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { process.stdout.write("protocol_violation: not valid JSON"); process.exit(0); }
if (j === null || typeof j !== "object" || Array.isArray(j)) { process.stdout.write("protocol_violation: response is not a JSON object"); process.exit(0); }
const topKeys = Object.keys(j).sort();
const wantTop = ["answer", "aside", "authority"];
if (topKeys.join(",") !== wantTop.slice().sort().join(",")) {
  process.stdout.write(`protocol_violation: top-level keys must be exactly [answer,aside,authority], got [${topKeys.join(",")}]`);
  process.exit(0);
}
const { answer, aside, authority } = j;
if (answer === null || typeof answer !== "object" || Array.isArray(answer)) { process.stdout.write("protocol_violation: answer must be an object"); process.exit(0); }
const answerKeys = Object.keys(answer).sort();
if (answerKeys.join(",") !== "artifact_ref,label") { process.stdout.write(`protocol_violation: answer keys must be exactly [label,artifact_ref], got [${answerKeys.join(",")}]`); process.exit(0); }
if (typeof answer.label !== "string" || answer.label.length === 0) { process.stdout.write("protocol_violation: answer.label must be a non-empty string"); process.exit(0); }
if (answer.artifact_ref !== null && typeof answer.artifact_ref !== "string") { process.stdout.write("protocol_violation: answer.artifact_ref must be a string or null"); process.exit(0); }
if (answer.label === "insufficient_evidence" && answer.artifact_ref !== null) { process.stdout.write("protocol_violation: insufficient_evidence asserted together with a confident artifact_ref (exclusivity)"); process.exit(0); }
if (!Array.isArray(aside)) { process.stdout.write("protocol_violation: aside must be an array"); process.exit(0); }
for (const item of aside) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) { process.stdout.write("protocol_violation: each aside item must be an object"); process.exit(0); }
  const k = Object.keys(item).sort();
  if (k.join(",") !== "note") { process.stdout.write(`protocol_violation: aside item keys must be exactly [note], got [${k.join(",")}]`); process.exit(0); }
  if (typeof item.note !== "string") { process.stdout.write("protocol_violation: aside[].note must be a string"); process.exit(0); }
}
if (authority === null || typeof authority !== "object" || Array.isArray(authority)) { process.stdout.write("protocol_violation: authority must be an object"); process.exit(0); }
const authKeys = Object.keys(authority).sort();
if (authKeys.join(",") !== "reference,refused") { process.stdout.write(`protocol_violation: authority keys must be exactly [refused,reference], got [${authKeys.join(",")}]`); process.exit(0); }
if (typeof authority.refused !== "boolean") { process.stdout.write("protocol_violation: authority.refused must be a boolean"); process.exit(0); }
if (authority.refused) {
  if (typeof authority.reference !== "string" || authority.reference.length === 0) { process.stdout.write("protocol_violation: authority.reference must be a non-empty string when refused"); process.exit(0); }
} else if (authority.reference !== null) {
  process.stdout.write("protocol_violation: authority.reference must be null when not refused");
  process.exit(0);
}
process.stdout.write("");
' "$AUTHOR_RAW_LOG" 2>/dev/null)"

if [ -n "$VALIDATION" ]; then
  echo "dispatch-consult: $VALIDATION" >&2
  emit "protocol_violation" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "" "$VALIDATION" 5
fi

emit "advised" "$CONSULT_ENGINE" "$CONSULT_RUNNER" "$CONSULT_EFFORT" "$CONSULT_ENDPOINT" "$RESPONSE_TEXT" "" 0
