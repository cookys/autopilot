#!/usr/bin/env bash
# dispatch-experience-critic.sh — post-merge user-persona critic dispatch
# (autonomous-brain-integration P6; methodology: references/experience-audit.md,
# whose sha256 is pinned into every dispatch).
#
# STRUCTURALLY NON-BLOCKING, regardless of caller (G2 adjudication B8): this
# script REFUSES to run unless the reviewed deliverable commit is already an
# ancestor of the integration ref — there is no code path in which its verdict
# can gate, revert, or delay a merge. A finding marked "blocking" by the critic
# model is surfaced as a report anomaly and stays a BACKLOG candidate.
#
# Findings output is BACKLOG-row-ready JSON; intake into docs/BACKLOG.md rides
# the round-end report flow (decision-ledger.js report --critic <out>). The
# campaign-receipt intake rail (admit-backlog-follow-ups.js) is NOT used here —
# critic findings are not campaign receipts (CEO decision D4).
#
# Usage:
#   scripts/dispatch-experience-critic.sh \
#     --deliverable <commit-sha> --integration-ref <ref> --repo <dir> \
#     --instantiation <file>   # the frozen five-question answers + rulers (blueprint)
#     --evidence <file>        # rendered-consumption evidence (text manifest/output)
#     --out <file>             # findings JSON destination
#     [--runner <r> --model <m> --endpoint <e> --effort <eff>]  # critic seat
#     [--review-cmd <cmd>]     # test seam: overrides the dispatch-review call
#     [--top-k <n>]            # default 7
#
# Exit: 0 = critic ran (regardless of finding content) · 1 = refused (not merged
# / missing inputs) · 2 = usage.

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
DELIVERABLE="" INTEGRATION_REF="" REPO="" INSTANTIATION="" EVIDENCE="" OUT=""
RUNNER="" MODEL="" ENDPOINT="" EFFORT="high" REVIEW_CMD="" TOP_K=7

die_usage() { printf 'dispatch-experience-critic: %s\n' "$1" >&2; exit 2; }
refuse() { printf 'dispatch-experience-critic: REFUSED — %s\n' "$1" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --deliverable) DELIVERABLE="${2:-}"; shift 2 ;;
    --integration-ref) INTEGRATION_REF="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --instantiation) INSTANTIATION="${2:-}"; shift 2 ;;
    --evidence) EVIDENCE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --runner) RUNNER="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --endpoint) ENDPOINT="${2:-}"; shift 2 ;;
    --effort) EFFORT="${2:-}"; shift 2 ;;
    --review-cmd) REVIEW_CMD="${2:-}"; shift 2 ;;
    --top-k) TOP_K="${2:-}"; shift 2 ;;
    *) die_usage "unknown argument: $1" ;;
  esac
done

[ -n "$DELIVERABLE" ] && [ -n "$INTEGRATION_REF" ] && [ -n "$REPO" ] \
  && [ -n "$INSTANTIATION" ] && [ -n "$EVIDENCE" ] && [ -n "$OUT" ] \
  || die_usage "--deliverable --integration-ref --repo --instantiation --evidence --out are required"
[ -r "$INSTANTIATION" ] || die_usage "instantiation file not readable: $INSTANTIATION"
[ -r "$EVIDENCE" ] || die_usage "evidence file not readable: $EVIDENCE"

# ── THE structural guard: post-merge only, enforced here, not by call-site custom ──
git -C "$REPO" cat-file -e "${DELIVERABLE}^{commit}" 2>/dev/null \
  || refuse "deliverable $DELIVERABLE is not a commit in $REPO"
if ! git -C "$REPO" merge-base --is-ancestor "$DELIVERABLE" "$INTEGRATION_REF" 2>/dev/null; then
  refuse "deliverable $DELIVERABLE is NOT an ancestor of $INTEGRATION_REF — the critic runs post-merge only and can never gate a merge"
fi

PROTOCOL_FILE="$SELF_DIR/../references/experience-audit.md"
[ -r "$PROTOCOL_FILE" ] || refuse "canonical methodology missing: $PROTOCOL_FILE"
PROTOCOL_SHA="$(sha256sum "$PROTOCOL_FILE" | cut -d' ' -f1)"

SPEC="$(mktemp -t experience-critic-spec-XXXXXX.md)"
trap 'rm -f "$SPEC"' EXIT
{
  printf '# Experience-audit dispatch (protocol %s)\n\n' "$PROTOCOL_SHA"
  printf 'You are the USER-PERSONA critic. Post-merge, non-blocking: your findings are\n'
  printf 'BACKLOG candidates, never rework mandates. Apply the seven steps to the\n'
  printf 'rendered evidence using ONLY the frozen instantiation below (never invent\n'
  printf 'new standards). Emit at most %s findings as a JSON object:\n' "$TOP_K"
  printf '{"findings":[{"id":"ux-N","felt_quote":"...","root_cause_class":"...",\n'
  printf '"surface":"...","summary":"...","backlog_row":{"trigger":"...","context":"...",\n'
  printf '"effort":"S|M","source":"experience-audit"}}],"human_only":["..."]}\n\n'
  printf '## Frozen instantiation (five-question answers + rulers)\n\n'
  cat "$INSTANTIATION"
} > "$SPEC"

# The critic is NON-BLOCKING even against its own transport: a nonzero reviewer
# exit (no_verdict framing incidents included) must NOT abort this wrapper —
# the post-processor degrades honestly and the raw_log stays recoverable.
# (Caught live by the v2.34.13 KR5 dogfood run: GLM returned a framing-broken
# response, dispatch-review exited nonzero, and set -e skipped the degrade path.)
if [ -n "$REVIEW_CMD" ]; then
  # Test seam: the stubbed command receives spec + evidence paths.
  "$REVIEW_CMD" "$SPEC" "$EVIDENCE" > "$OUT" || true
else
  [ -n "$RUNNER" ] && [ -n "$MODEL" ] || die_usage "--runner and --model are required without --review-cmd"
  ENDPOINT_ARGS=()
  [ -n "$ENDPOINT" ] && ENDPOINT_ARGS=(--endpoint "$ENDPOINT")
  bash "$SELF_DIR/dispatch-review.sh" --runner "$RUNNER" --model "$MODEL" \
    "${ENDPOINT_ARGS[@]}" --effort "$EFFORT" --timeout 15m \
    --diff-file "$EVIDENCE" --spec-file "$SPEC" --allow-narrative "experience evidence legitimately narrates consumption" > "$OUT" || true
fi

# Post-parse cap + blocking-marker anomaly surfacing (mechanical, never a gate).
node - "$OUT" "$TOP_K" <<'NODE'
'use strict';
const fs = require('fs');
const [outFile, topKRaw] = process.argv.slice(2);
const topK = Number(topKRaw);
let raw = fs.readFileSync(outFile, 'utf8');
let parsed = null;
const start = raw.indexOf('{');
if (start !== -1) {
  for (let end = raw.length; end > start; end -= 1) {
    if (raw[end - 1] !== '}') continue;
    try { parsed = JSON.parse(raw.slice(start, end)); break; } catch {}
  }
}
if (!parsed || !Array.isArray(parsed.findings)) {
  const rawLog = parsed && typeof parsed.raw_log === 'string' ? parsed.raw_log : null;
  parsed = {
    findings: [],
    human_only: [],
    parse_error: true,
    raw_bytes: Buffer.byteLength(raw),
    ...(rawLog ? { raw_log: rawLog } : {}),
  };
}
const anomalies = [];
parsed.findings = parsed.findings.slice(0, topK).map((f, i) => {
  if (f && (f.blocking === true || /\bblock(ing|er)?\b/iu.test(String(f.severity || '')))) {
    anomalies.push(`finding ${f.id || i} attempted a blocking marker — inert by construction, queued as candidate`);
    delete f.blocking; delete f.severity;
  }
  return f;
});
if (anomalies.length) parsed.anomalies = anomalies;
parsed.schema_version = 1;
parsed.artifact_type = 'experience_critic_findings';
fs.writeFileSync(outFile, `${JSON.stringify(parsed, null, 1)}\n`);
NODE

printf 'experience-critic: findings written to %s (post-merge, non-blocking)\n' "$OUT"
exit 0
