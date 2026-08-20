#!/usr/bin/env bash
# check-blind-evidence.sh — anti-laundering linter for the ASSEMBLED reviewer payload.
#
# Threat model (docs/plans/2026-08-16-four-layer-redesign.md D2; survey: a "secure"
# narrative dropped a reviewer's detection rate 97.2%→3.6% on identical code): no direct
# implementer→reviewer channel exists on the dispatch-review rail — but an orchestrator
# composing --spec-file can PASTE implementer output, so completion claims enter wearing
# the dispatcher's trust. This linter scans the payload the reviewer will actually see
# (spec + any prompt packs) for implementer-narrative classes, regardless of who pasted
# them. It is the mirror of check-dispatch-suppression.sh, which guards the OPPOSITE
# direction (controller coaching the reviewer to ignore/downgrade); the pattern sets are
# disjoint by construction.
#
# Narrative classes (each pattern carries its rationale; extend here, never inline in
# callers — no second canonical statement):
#   C1 first-person completion claims      — "I have implemented/fixed/completed ..."
#   C2 self-assessed quality               — "the implementation is correct/robust/clean"
#   C3 test-outcome assertion, no receipt  — "all tests pass" with no receipt/log path
#                                            on the same line
# A receipt path (a "/" or ".log"/".json" token on the same line) downgrades C3 — bound
# claims are evidence, not narrative.
#
# Usage:
#   check-blind-evidence.sh --payload <file> [--payload <file> ...] [--json]
# Exit: 0 clean · 1 findings · 2 usage error
# JSON (--json): {"findings":[{"file","line","class","excerpt"}...],"ok":bool}
set -uo pipefail

PAYLOADS=()
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --payload) shift; [ $# -gt 0 ] || { echo "check-blind-evidence: --payload needs a file" >&2; exit 2; }; PAYLOADS+=("$1");;
    --json) JSON=1;;
    -h|--help) sed -n '2,26p' "$0"; exit 0;;
    *) echo "check-blind-evidence: unknown arg: $1" >&2; exit 2;;
  esac
  shift
done
[ "${#PAYLOADS[@]}" -gt 0 ] || { echo "check-blind-evidence: at least one --payload required" >&2; exit 2; }

C1='(^|[^A-Za-z])[Ii] (have |'"'"'ve )?(implemented|fixed|completed|finished|resolved|addressed|done)'
C2='(implementation|fix|change|code|solution) (is|was|looks) (correct|complete|robust|clean|solid|production.ready|working)'
C3='(all|the) tests? (pass|passed|passing|are green|is green)|test suite (is )?(green|passing)'
RECEIPT='(/[A-Za-z0-9._-]+)+|\.log|\.json|exit code [0-9]'

FINDINGS='[]'
count=0
for f in "${PAYLOADS[@]}"; do
  [ -f "$f" ] || { echo "check-blind-evidence: no such payload: $f" >&2; exit 2; }
  n=0
  while IFS= read -r line; do
    n=$((n + 1))
    cls=""
    if [[ "$line" =~ $C1 ]]; then cls="C1"
    elif echo "$line" | grep -qiE "$C2"; then cls="C2"
    elif echo "$line" | grep -qiE "$C3" && ! echo "$line" | grep -qE "$RECEIPT"; then cls="C3"
    fi
    if [ -n "$cls" ]; then
      count=$((count + 1))
      excerpt="$(printf '%s' "$line" | cut -c1-120)"
      FINDINGS="$(node -e '
        const [f, l, c, e] = process.argv.slice(1, 5);
        const arr = JSON.parse(process.argv[5]);
        arr.push({ file: f, line: Number(l), class: c, excerpt: e });
        process.stdout.write(JSON.stringify(arr));
      ' "$f" "$n" "$cls" "$excerpt" "$FINDINGS")"
    fi
  done < "$f"
done

if [ "$JSON" -eq 1 ]; then
  node -e '
    const findings = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + "\n");
  ' "$FINDINGS"
else
  if [ "$count" -gt 0 ]; then
    echo "check-blind-evidence: $count implementer-narrative finding(s) in the reviewer payload:" >&2
    node -e '
      for (const f of JSON.parse(process.argv[1]))
        process.stderr.write(`  ${f.file}:${f.line} [${f.class}] ${f.excerpt}\n`);
    ' "$FINDINGS"
    echo "Fix: strip the narrative — a reviewer payload carries obligations, diff, and receipts, never the implementer's claims about them." >&2
  fi
fi
[ "$count" -eq 0 ] && exit 0 || exit 1
