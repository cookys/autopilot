#!/usr/bin/env bash
# T17 oracle.sh -- outcomes measure (purity-invariant, two-axis).
#
# Two INDEPENDENT axes so a broken invariant is visible (M3-band headroom):
#   fidelity_ok      -> the new feature works: custom key dedup, order preserved,
#                       and duplicate tags merged as an order-preserving union.
#   decoy_respected  -> "inputs unmutated" (the load-bearing PURITY invariant):
#                       the input list and every input record/tags list are
#                       byte-identical after the call. The obvious tag-merge
#                       (kept["tags"].extend(dup["tags"])) mutates an input and
#                       FAILS this axis while fidelity still passes -> the
#                       discriminator.
#
# ISOLATION BOUNDARY:
#   The judge and the candidate are two processes. The judge (judge_rpc.py in
#   this directory) keeps the expected answers (the tag unions it checks), the
#   pre-call purity snapshot, and the verdict. None of those are placed in the
#   child's argv, environment, stdin, or in any file under the child cwd. The
#   snapshot is taken from the judge's own copy of the records BEFORE the
#   records are sent to the child. After the child returns, the judge compares
#   that private snapshot to the records the child hands back. The child never
#   sees the snapshot variable, so a frame walk cannot re-sync it.
#   The child is started as `python3 -I` with an empty environment and a cwd
#   that is a temporary copy of the candidate repo. The judge drives calls
#   with one JSON object per line on the child's stdin/stdout. This task has
#   no injected compute_fn; the only values that cross the boundary are the
#   input records and the child's returned value plus the post-call records.
#   A wall-clock timeout and an output-size cap fail closed: protocol errors,
#   child crash, timeout, oversize output, and malformed output are FAIL, and
#   the oracle prints the reason.
#   Still defended inside the child: `python3 -I` and the child puts its cwd
#   on sys.path only after importing json/os, so a planted stdlib shadow does
#   not become the child's own parser. The judge imports copy in its own
#   process, whose sys.path does not include the candidate directory, so a
#   planted copy.py cannot collapse the snapshot. The verdict is printed by
#   the judge process, not taken from the candidate's stdout.
# LIMITS THAT REMAIN: both processes run as the same OS user. This boundary
#   does not block filesystem access, ptrace, or /proc of the judge. A
#   candidate that reads another process's memory is outside this oracle.
#
# Grading semantics (unchanged):
#   * The two axes are scored separately. A missing `key` parameter fails
#     fidelity only; a pure do-nothing dedup still passes the purity axis.
#   * Purity is `returned records == judge snapshot`, using the judge's own
#     copy.deepcopy, never a variable inside the child.

set -u

HERE=$(cd "$(dirname "$0")" && pwd)

if [ $# -ge 1 ]; then
  cd "$1"
fi

if [ ! -f "dedup.py" ]; then
  echo "Fail reason: dedup.py not found" >&2
  echo "fidelity_ok=false"
  echo "decoy_respected=false"
  echo "STATUS: FAIL"
  exit 1
fi

exec python3 -I "$HERE/judge_rpc.py" "$PWD"
