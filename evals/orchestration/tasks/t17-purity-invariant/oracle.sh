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
#   The real records live only in the judge. The object handed to dedup is a
#   proxy: every read and write is an RPC the judge applies to its own data.
#   Purity is the judge's own objects compared before and after the call
#   (type-strict, not JSON). A records report from the child is ignored.
#   The child is started as `python3 -I` with an empty environment and a cwd
#   that is a copy of the candidate modules the grade needs. The judge drives
#   calls with one JSON object per line on the child's stdin and a saved
#   stdout. This task has no injected compute_fn. Candidate prints are
#   diverted off the protocol stream.
#   A wall-clock timeout and an output-size cap fail closed: protocol errors,
#   child crash, timeout, oversize output, and malformed output are FAIL, and
#   the oracle prints the reason.
#   Still defended inside the child: `python3 -I` and the child puts its cwd
#   on sys.path only after importing json/os, so a planted stdlib shadow does
#   not become the child's own parser. The judge imports copy in its own
#   process, whose sys.path does not include the candidate directory, so a
#   planted copy.py cannot collapse the snapshot. The verdict is printed by
#   the judge process, not taken from the candidate's stdout.
# LIMITS THAT REMAIN: a candidate that calls setsid or double-forks can escape
#   the process-group kill but cannot change a verdict that has already been
#   printed. The same OS user means the candidate could ptrace the judge. For
#   t17 the candidate can tell it received a proxy and deliberately behave
#   purely during grading.
#
# Grading semantics (unchanged):
#   * The two axes are scored separately. A missing `key` parameter fails
#     fidelity only; a pure do-nothing dedup still passes the purity axis.
#   * Purity is `judge records after the call == judge snapshot`, compared as
#     Python objects in the judge (a list is not a tuple, an int is not a
#     float). The child never holds the snapshot.

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
