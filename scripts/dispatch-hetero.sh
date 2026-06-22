#!/usr/bin/env bash
# dispatch-hetero — heterogeneous implementer dispatch (Claude Code → agy
# headless) with MANDATORY git-worktree isolation.
#
# Why a script (not prose): the safety rails must be impossible to skip.
# agy has no `--allowedTools`-grade granular allowlist — its
# `--dangerously-skip-permissions` is all-or-nothing — so mutation work MUST
# run in a throwaway worktree, never the main checkout. And the agent's
# self-report is not evidence: this script verifies by artifacts (commit
# presence, diff stats, tree cleanliness). Empirical basis:
# references/multi-agent-portability.md § "Verified by Spike (agy 1.0.5
# headless dispatch, 2026-06-11)".
#
# Contract: this script only IMPLEMENTS. Verdict stays at depth 0 — the
# dispatching session reviews the branch diff (quality-pipeline) before any
# merge. See references/hetero-dispatch.md for the full ritual.
#
# USAGE:
#   scripts/dispatch-hetero.sh --branch <name> --prompt-file <file>
#       [--model "Gemini 3.5 Flash (High)"]   # default; names from `agy models`
#       [--base develop]                       # default
#       [--timeout 9m]                         # agy --print-timeout (default 5m is too short)
#       [--agy-bin agy]                        # alternate binary (test seam)
#       [--keep-worktree]                      # keep worktree even on success
#
# OUTPUT: one JSON object on stdout (agent stdout goes to a log file, never
# stdout — keeps the JSON parseable):
#   { "status": "committed" | "no_op" | "question_suspected" | "dirty"
#               | "precondition_failed",
#     "runner": "agy", "model": "...",   # engine provenance (model = --model)
#     "branch": "...", "base": "...", "commit": "...|null",
#     "files_changed": N, "insertions": N, "deletions": N,
#     "worktree": "...|null", "agent_log": "..." , "error": "...|null" }
#
# OUTCOME states (the no-commit case is split by HOW the worker ended so a legit
# no-op task is not confused with a stalled/paused one — see
# references/hetero-dispatch.md § "Outcome states"):
#   committed          — new commit + clean tree + agent exit 0 → success.
#   dirty              — new commit but tree left uncommitted-dirty → failure.
#   no_op              — exit 0, no new commit → agent legitimately judged
#                        nothing was needed; NOT a failure of the dispatch.
#   question_suspected — timeout or non-zero exit, no new commit → worker likely
#                        paused on a clarifying question (auto-approve does NOT
#                        silence the model's own question — see
#                        references/blind-dispatch.md § "Clarifying questions
#                        survive auto-approve") or otherwise stalled.
#   CLI-agnostic: reuses the git read + the already-captured AGENT_EXIT, adds
#   ZERO stream parsing.
#
# EXIT: 0 = committed (new commit + clean tree + agent exit 0; worktree removed
#           unless --keep-worktree; the branch survives for review/merge)
#       1 = ran but did not yield a reviewable clean commit — one of: failure,
#           dirty, no_op, question_suspected (worktree KEPT for inspection — clean up
#           with `git worktree remove`)
#       2 = precondition failure (nothing was created)

set -uo pipefail

MODEL="Gemini 3.5 Flash (High)"
BASE="develop"
TIMEOUT="9m"
AGY_BIN="agy"
KEEP=0
BRANCH=""
PROMPT_FILE=""

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; }

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '; }

emit() { # status commit files ins del worktree error
  local commit_json="null" wt_json="null" err_json="null"
  [ -n "${2:-}" ] && commit_json="\"$2\""
  [ -n "${6:-}" ] && wt_json="\"$(json_escape "$6")\""
  [ -n "${7:-}" ] && err_json="\"$(json_escape "$7")\""
  printf '{ "status": "%s", "runner": "agy", "model": "%s", "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s }\n' \
    "$1" "$(json_escape "$MODEL")" "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(json_escape "${LOG:-}")" "$err_json"
}

die_precondition() {
  printf '{ "status": "precondition_failed", "runner": "agy", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s" }\n' \
    "$(json_escape "$MODEL")" "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" "$(json_escape "$1")"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --agy-bin) AGY_BIN="${2:-}"; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die_precondition "unknown argument: $1" ;;
  esac
done

# --- preconditions (exit 2, nothing created) ---
[ -n "$BRANCH" ] || die_precondition "--branch is required"
[ -n "$PROMPT_FILE" ] || die_precondition "--prompt-file is required"
[ -r "$PROMPT_FILE" ] || die_precondition "prompt file not readable: $PROMPT_FILE"
command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN (install Antigravity CLI or pass --agy-bin)"
git rev-parse --git-dir >/dev/null 2>&1 || die_precondition "not inside a git repository"
git rev-parse --verify --quiet "$BASE" >/dev/null || die_precondition "base ref not found: $BASE"
if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  die_precondition "branch already exists: $BRANCH"
fi

# --- isolated worktree (the non-skippable safety rail) ---
WT="$(mktemp -u -d -t "hetero-${BRANCH//\//-}-XXXXXX")"  # -u: path only; git worktree add creates it
if ! git worktree add --quiet "$WT" -b "$BRANCH" "$BASE"; then
  # `git worktree add -b` creates the branch ref BEFORE the dir, so the ref leaks
  # even when dir creation fails (verified 2026-06-22). Reap it before bailing.
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  die_precondition "git worktree add failed"
fi
LOG="$(mktemp -t "hetero-${BRANCH//\//-}-log-XXXXXX")"
BASE_SHA="$(git rev-parse "$BASE")"

# Interrupt during the long agy run orphans worktree + branch with no JSON. Trap
# INT/TERM to reap both, then DISARM once agy returns (the keep/remove logic below
# owns the worktree from that point — a clean exit must not trip this).
trap 'git worktree remove --force "$WT" >/dev/null 2>&1; git branch -D "$BRANCH" >/dev/null 2>&1; exit 2' INT TERM

# --- run the agent (its stdout/stderr go to LOG, never our stdout) ---
( cd "$WT" && "$AGY_BIN" -p "$(cat "$PROMPT_FILE")" \
    --model "$MODEL" --dangerously-skip-permissions \
    --print-timeout "$TIMEOUT" ) >"$LOG" 2>&1
AGENT_EXIT=$?
trap - INT TERM

# --- verify by artifacts, never by self-report ---
HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
DIRTY="$(git -C "$WT" status --porcelain)"
FILES=0; INS=0; DEL=0
if [ "$HEAD_SHA" != "$BASE_SHA" ]; then
  SHORTSTAT="$(git -C "$WT" diff --shortstat "$BASE_SHA..$HEAD_SHA")"
  FILES="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ file' | grep -o '[0-9]\+' || echo 0)"
  INS="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ insertion' | grep -o '[0-9]\+' || echo 0)"
  DEL="$(printf '%s' "$SHORTSTAT" | grep -o '[0-9]\+ deletion' | grep -o '[0-9]\+' || echo 0)"
fi

if [ "$HEAD_SHA" != "$BASE_SHA" ]; then
  # --- a new commit exists ---
  if [ -n "$DIRTY" ]; then
    # committed but left the tree dirty → failure regardless of exit code
    emit "dirty" "$HEAD_SHA" "$FILES" "$INS" "$DEL" "$WT" "agent committed but left uncommitted changes (agent exit $AGENT_EXIT); worktree kept"
    exit 1
  elif [ "$AGENT_EXIT" -ne 0 ]; then
    # clean commit but the worker exited non-zero — NOT scored success (KR1):
    # the abnormal exit means the run can't be trusted as a clean implementation.
    emit "failure" "$HEAD_SHA" "$FILES" "$INS" "$DEL" "$WT" "agent left a clean commit but exited non-zero (agent exit $AGENT_EXIT); worktree kept"
    exit 1
  else
    # new commit + clean tree + agent exit 0 → the only success path
    if [ "$KEEP" = "0" ]; then
      git worktree remove --force "$WT" >/dev/null 2>&1 && WT=""
    fi
    emit "committed" "$HEAD_SHA" "$FILES" "$INS" "$DEL" "$WT" ""
    exit 0
  fi
else
  # --- no new commit: split by HOW the worker ended ---
  if [ "$AGENT_EXIT" -eq 0 ]; then
    # clean exit, nothing committed → agent legitimately decided nothing was needed
    emit "no_op" "" 0 0 0 "$WT" "agent exited cleanly with no commit — judged nothing was needed (agent exit 0); worktree kept"
    exit 1
  else
    # timeout or non-zero exit, nothing committed → likely paused on a clarifying
    # question (auto-approve does not silence the model's own question) or stalled
    emit "question_suspected" "" 0 0 0 "$WT" "agent produced no commit and ended abnormally (agent exit $AGENT_EXIT) — likely paused on a clarifying question or stalled; worktree kept"
    exit 1
  fi
fi
