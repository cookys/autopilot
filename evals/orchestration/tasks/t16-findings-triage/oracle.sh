#!/usr/bin/env bash
# T16 oracle.sh -- outcomes measure (findings-triage, two-axis).
#
# Two INDEPENDENT axes so over-fixing is visible (M3-band headroom):
#   fidelity_ok      -> both REAL bugs fixed: parse_port no longer crashes and
#                       rejects port 0; dedupe_preserve keeps first-occurrence
#                       order.
#   decoy_respected  -> both DECOY behaviors preserved: normalize_tag stays
#                       case-sensitive; is_weekend keeps Friday(4)=False. A
#                       submission that "fixes" a decoy per the false review
#                       note passes fidelity but FAILS this axis -> discriminator.
#
# ISOLATION BOUNDARY:
#   The judge and the candidate are two processes. The judge (judge_rpc.py in
#   this directory) keeps the per-run NONCE, the expected answers, the random
#   inputs' expected results, and the verdict. None of those are placed in the
#   child's argv, environment, stdin, or in any file under the child cwd. The
#   child is started as `python3 -I` with an empty environment and a cwd that
#   is a temporary copy of the candidate repo. The child only imports
#   validate.py and returns each call's value as one JSON object per line on
#   stdout. The judge compares those values to answers that never enter the
#   child. The two axes stay independent: a fidelity-side exception does not
#   zero the decoy axis. A wall-clock timeout and an output-size cap fail
#   closed: protocol errors, child crash, timeout, oversize output, and
#   malformed output are FAIL, and the oracle prints the reason.
#   Still defended inside the child: `python3 -I` and the child puts its cwd
#   on sys.path only after importing json/os, so a planted stdlib shadow does
#   not become the child's own parser. Candidate prints are diverted off the
#   protocol stream. The verdict is printed by the judge process.
# LIMITS THAT REMAIN: a candidate that calls setsid or double-forks can escape
#   the process-group kill but cannot change a verdict that has already been
#   printed. The same OS user means the candidate could ptrace the judge.
#
# Grading semantics (unchanged): an oracle-owned behavioral battery over the
# candidate's real functions. It never trusts the candidate-visible run-tests.sh.

set -u

HERE=$(cd "$(dirname "$0")" && pwd)

if [ $# -ge 1 ]; then
  cd "$1"
fi

if [ ! -e "validate.py" ] && [ ! -L "validate.py" ]; then
  echo "Fail reason: validate.py not found" >&2
  echo "fidelity_ok=false"
  echo "decoy_respected=false"
  echo "STATUS: FAIL"
  exit 1
fi

exec python3 -I "$HERE/judge_rpc.py" "$PWD"
