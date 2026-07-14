#!/usr/bin/env bash
# stub-dispatch.sh — deterministic fixture "engine" for the Phase-0 matrix proof. Emits the
# shared review JSON {status, verdict, findings, raw_log} that scripts/dispatch-review.sh would.
# NO network, NO LLM. Behavior is a fixed scenario so report.js output is predictable, proving:
# resume-by-cell, shuffled-seed recording, no_verdict fail-closed accounting, format_conflict
# guard, and discordant-pair computation. Selected by STUB_SCENARIO (default: delta2).
#
# Scenario delta2 (default): known-bad cases all "caught" in every arm EXCEPT cases 05 & 06,
# which are caught ONLY in the pack arm (reviewer pack) -> pack-vs-nopack delta = +2; placebo
# behaves like nopack -> placebo delta = 0; no no_verdict anywhere -> format_conflict=false.
# Clean cases ship-as-is (no over-flag). Proves discordant/placebo/majority/specificity.
#
# Scenario format_conflict: pack arm emits an empty capture (no_verdict) for 2 known-bad cases
# (01 & 02) -> pack no_verdict CASE count exceeds nopack by > 1 -> report.js format_conflict=true.
# Proves the fail-closed no_verdict accounting AND the per-case format-conflict guard.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MATCH_DIR="$HERE/../match"
SCENARIO="${STUB_SCENARIO:-delta2}"

DIFF=""; PACK=""
while [ $# -gt 0 ]; do case "$1" in
  --diff-file) DIFF="$2"; shift 2 ;;
  --pack-file) PACK="$2"; shift 2 ;;
  --runner|--model|--endpoint|--timeout|--spec-file|--checklists|--bin|--effort|--ledger|--run-id|--stage) shift 2 ;;
  *) shift ;;
esac; done

CID="$(basename "$DIFF" .diff)"
# arm: nopack (no pack), pack (reviewer pack), placebo (placebo pack)
ARM="nopack"
if [ -n "$PACK" ]; then case "$PACK" in *placebo*) ARM="placebo" ;; *) ARM="pack" ;; esac; fi

RAWLOG="$(mktemp -t stub-review-XXXXXX.log)"
printf '{"usage":{"input_tokens":120,"output_tokens":45}}\n' > "$RAWLOG"

emit(){ # $1 status  $2 verdict-or-empty  $3 findings
  local status="$1" verdict="$2" findings="$3"
  node -e '
    const [status,verdict,findings,raw]=process.argv.slice(1);
    process.stdout.write(JSON.stringify({runner:"stub",model:"stub",status,verdict:verdict||null,findings:findings||"",raw_log:raw})+"\n");
  ' "$status" "$verdict" "$findings" "$RAWLOG"
}

# defect_summary carries the predicate anchor terms -> guarantees a predicate match when "caught".
caught_findings(){ node -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.defect_summary||"defect present")}catch(e){process.stdout.write("defect present")}' "$MATCH_DIR/$CID.match.json"; }

is_known_bad(){ [ -f "$MATCH_DIR/$CID.match.json" ]; }

if ! is_known_bad; then
  # clean case -> ship-as-is (no over-flag)
  emit reviewed "SHIP-AS-IS" "none"; exit 0
fi

case "$SCENARIO" in
  delta2)
    if [ "$CID" = "05-off-by-one" ] || [ "$CID" = "06-removed-test-assertion" ]; then
      if [ "$ARM" = "pack" ]; then emit reviewed "FIX-THEN-SHIP" "$(caught_findings)"; else emit reviewed "SHIP-AS-IS" "none"; fi
      exit 0
    fi
    emit reviewed "FIX-THEN-SHIP" "$(caught_findings)"; exit 0
    ;;
  format_conflict)
    if [ "$ARM" = "pack" ]; then
      case "$CID" in
        01-*|02-*) emit no_verdict "" ""; exit 0 ;;
      esac
    fi
    emit reviewed "FIX-THEN-SHIP" "$(caught_findings)"; exit 0
    ;;
  *) echo "unknown STUB_SCENARIO: $SCENARIO" >&2; exit 2 ;;
esac
