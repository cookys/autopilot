#!/usr/bin/env bash
# check-holdout-coverage.sh — holdout-verification gate for high-risk diffs (four-layer
# Kernel rule K3, docs/plans/2026-08-16-four-layer-redesign.md D5; survey basis: SpecBench —
# gaming of VISIBLE evidence gates grows ~27pp per 10x LOC, so high-risk work needs checks
# the implementer could not see at authoring time).
#
# Two subcommands:
#
#   run   — execute a holdout instrument and MATERIALIZE its receipt (the instruments write
#           stdout only; this subcommand stamps the result with the diff head SHA so `check`
#           can bind it):
#             run --range <base..head> --evidence-dir <dir> --instrument mutation \
#                 --probe-cmd <cmd> --mutate-cmd <cmd> [--repo <dir>]
#             run --range <base..head> --evidence-dir <dir> --instrument strength \
#                 --signals-file <json> [--repo <dir>]
#           Writes <evidence-dir>/holdout-<instrument>.json:
#             {instrument, head_sha, passing, exit_code, result}
#
#   check — the gate. Reads the diff risk (a classify-diff-risk.sh output JSON via
#           --risk-file, or computes it from --range) and, when the diff is high-risk
#           (adversarial_review=true), requires at least one receipt in <evidence-dir> that
#           (a) parses, (b) is BOUND to the current head SHA of the range, (c) records a
#           passing result. Absent, malformed, stale, or failed receipts FAIL CLOSED.
#             check --range <base..head> --evidence-dir <dir> [--risk-file <json>] [--repo <dir>]
#
# Caller: a numbered quality-pipeline gate step (same standing as completeness-scan.sh).
# Exit: 0 pass / not-high-risk · 1 gate failure · 2 usage error
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die_usage() { echo "check-holdout-coverage: $1" >&2; exit 2; }

CMD="${1:-}"; shift || true
[ "$CMD" = "run" ] || [ "$CMD" = "check" ] || die_usage "subcommand must be run|check"

RANGE="" EVDIR="" REPO="$(pwd)" INSTRUMENT="" PROBE_CMD="" MUTATE_CMD="" SIGNALS="" RISK_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --range) shift; RANGE="${1:-}";;
    --evidence-dir) shift; EVDIR="${1:-}";;
    --repo) shift; REPO="${1:-}";;
    --instrument) shift; INSTRUMENT="${1:-}";;
    --probe-cmd) shift; PROBE_CMD="${1:-}";;
    --mutate-cmd) shift; MUTATE_CMD="${1:-}";;
    --signals-file) shift; SIGNALS="${1:-}";;
    --risk-file) shift; RISK_FILE="${1:-}";;
    *) die_usage "unknown arg: $1";;
  esac
  shift || true
done
[ -n "$RANGE" ] || die_usage "--range is required"
[ -n "$EVDIR" ] || die_usage "--evidence-dir is required"

HEAD_REF="${RANGE##*..}"
HEAD_SHA="$(git -C "$REPO" rev-parse "${HEAD_REF:-HEAD}" 2>/dev/null)" \
  || die_usage "cannot resolve head of range '$RANGE' in $REPO"

if [ "$CMD" = "run" ]; then
  mkdir -p "$EVDIR"
  case "$INSTRUMENT" in
    mutation)
      [ -n "$PROBE_CMD" ] && [ -n "$MUTATE_CMD" ] || die_usage "mutation needs --probe-cmd and --mutate-cmd"
      OUT="$(node "$SCRIPT_DIR/probe-mutation.js" --repo "$REPO" --ref "$HEAD_SHA" \
        --probe "$PROBE_CMD" --mutate "$MUTATE_CMD" --json 2>&1)"; RC=$?
      ;;
    strength)
      [ -n "$SIGNALS" ] || die_usage "strength needs --signals-file"
      OUT="$(node "$SCRIPT_DIR/verify-strength.js" score --signals "$(cat "$SIGNALS")" 2>&1)"; RC=$?
      ;;
    *) die_usage "--instrument must be mutation|strength";;
  esac
  node -e '
    const [instrument, headSha, rc, out, dest] = process.argv.slice(1);
    let result = null;
    try { result = JSON.parse(out); } catch { result = { raw: out.slice(0, 2000) }; }
    const receipt = {
      instrument, head_sha: headSha,
      exit_code: Number(rc), passing: Number(rc) === 0,
      result,
    };
    require("fs").writeFileSync(dest, JSON.stringify(receipt, null, 2) + "\n");
    process.stdout.write(`holdout receipt: ${dest} (passing=${receipt.passing})\n`);
  ' "$INSTRUMENT" "$HEAD_SHA" "$RC" "$OUT" "$EVDIR/holdout-$INSTRUMENT.json"
  exit $RC
fi

# ── check ──
if [ -n "$RISK_FILE" ]; then
  [ -f "$RISK_FILE" ] || die_usage "no such --risk-file: $RISK_FILE"
  RISK_JSON="$(cat "$RISK_FILE")"
else
  RISK_JSON="$(cd "$REPO" && bash "$SCRIPT_DIR/classify-diff-risk.sh" --range "$RANGE")" \
    || { echo "check-holdout-coverage: classify-diff-risk failed" >&2; exit 1; }
fi

node -e '
  const fs = require("fs");
  const path = require("path");
  const [riskJson, evdir, headSha] = process.argv.slice(1);
  let risk;
  try { risk = JSON.parse(riskJson); } catch { console.error("check-holdout-coverage: risk JSON is malformed — failing closed"); process.exit(1); }
  if (risk.adversarial_review !== true) {
    console.log("check-holdout-coverage: diff is not high-risk — holdout not required");
    process.exit(0);
  }
  let names = [];
  try { names = fs.readdirSync(evdir).filter((n) => /^holdout-.*\.json$/.test(n)); } catch { /* no dir */ }
  if (names.length === 0) {
    console.error("check-holdout-coverage: HIGH-RISK diff with NO holdout receipt — run the mutation/strength instruments (see references/four-layer-design.md K3)");
    process.exit(1);
  }
  const reasons = [];
  for (const n of names) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(evdir, n), "utf8")); }
    catch { reasons.push(`${n}: malformed`); continue; }
    if (r.head_sha !== headSha) { reasons.push(`${n}: STALE (bound to ${String(r.head_sha).slice(0, 12)}, diff head is ${headSha.slice(0, 12)})`); continue; }
    if (r.passing !== true) { reasons.push(`${n}: probe result not passing (exit ${r.exit_code})`); continue; }
    console.log(`check-holdout-coverage: bound passing receipt ${n} — holdout satisfied`);
    process.exit(0);
  }
  console.error(`check-holdout-coverage: high-risk diff, no VALID receipt:\n  ${reasons.join("\n  ")}`);
  process.exit(1);
' "$RISK_JSON" "$EVDIR" "$HEAD_SHA"
