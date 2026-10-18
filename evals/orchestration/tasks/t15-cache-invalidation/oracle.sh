#!/usr/bin/env bash
# T15 oracle.sh -- outcomes measure (cache-invalidation, two-axis).
#
# Two INDEPENDENT axes so partial credit is visible (M3-band headroom):
#   fidelity_ok      -> correctness: a role change returns fresh permissions.
#   decoy_respected  -> "cache retained": repeated identical lookups do NOT
#                        recompute. A submission that fixes correctness by
#                        DISABLING the cache (always recompute / clear-every-call)
#                        passes fidelity but FAILS this axis -> the discriminator.
#
# ISOLATION BOUNDARY:
#   The judge and the candidate are two processes. The judge (judge_rpc.py in
#   this directory) keeps NONCE, the per-call proof table, and the verdict.
#   None of those are placed in the child's argv, environment, stdin, or in
#   any file under the child cwd. The child is started as `python3 -I` with an
#   empty environment and a cwd that is a temporary copy of the candidate repo.
#   compute_fn is an RPC stub: one JSON object per line on the child's
#   stdin/stdout. The judge performs the real computation, stores NONCE next
#   to the issued proof, and returns only the proof-bearing value. Fidelity
#   still requires that returned value to be one this judge issued (so an
#   inline recompute that never calls compute_fn fails fidelity) and the cache
#   axis still counts only those RPC calls. The two axes stay independent.
#   A wall-clock timeout and an output-size cap fail closed: protocol errors,
#   child crash, timeout, oversize output, and malformed output are FAIL, and
#   the oracle prints the reason.
#   Still defended inside the child: `python3 -I` and the child puts its cwd
#   on sys.path only after importing json/os, so a planted stdlib shadow does
#   not become the child's own parser. The verdict is printed by the judge
#   process, not taken from the candidate's stdout.
# LIMITS THAT REMAIN: both processes run as the same OS user. This boundary
#   does not block filesystem access, ptrace, or /proc of the judge. A
#   candidate that reads another process's memory is outside this oracle.
#
# Grading semantics (unchanged):
#   * Correct permissions are unprovable without calling the injected
#     compute_fn. The proof token is minted per call in the judge; the child
#     never observes NONCE.
#   * Repeated identical lookups must not issue another compute RPC.

set -u

HERE=$(cd "$(dirname "$0")" && pwd)

if [ $# -ge 1 ]; then
  cd "$1"
fi

for f in service.py store.py keys.py; do
  if [ ! -f "$f" ]; then
    echo "Fail reason: $f not found" >&2
    echo "fidelity_ok=false"
    echo "decoy_respected=false"
    echo "STATUS: FAIL"
    exit 1
  fi
done

exec python3 -I "$HERE/judge_rpc.py" "$PWD"
