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
#   { "status": "committed" | "no_commit" | "dirty" | "precondition_failed",
#     "branch": "...", "base": "...", "commit": "...|null",
#     "files_changed": N, "insertions": N, "deletions": N,
#     "worktree": "...|null", "agent_log": "..." , "error": "...|null" }
#
# EXIT: 0 = agent committed and left a clean tree (worktree removed unless
#           --keep-worktree; the branch survives for review/merge)
#       1 = agent ran but produced no commit, or left a dirty tree
#           (worktree KEPT for inspection — clean up with `git worktree remove`)
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
  printf '{ "status": "%s", "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s }\n' \
    "$1" "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(json_escape "${LOG:-}")" "$err_json"
}

die_precondition() {
  printf '{ "status": "precondition_failed", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s" }\n' \
    "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" "$(json_escape "$1")"
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
git worktree add --quiet "$WT" -b "$BRANCH" "$BASE" || die_precondition "git worktree add failed"
LOG="$(mktemp -t "hetero-${BRANCH//\//-}-log-XXXXXX")"
BASE_SHA="$(git rev-parse "$BASE")"

# --- run the agent (its stdout/stderr go to LOG, never our stdout) ---
( cd "$WT" && "$AGY_BIN" -p "$(cat "$PROMPT_FILE")" \
    --model "$MODEL" --dangerously-skip-permissions \
    --print-timeout "$TIMEOUT" ) >"$LOG" 2>&1
AGENT_EXIT=$?

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

if [ "$HEAD_SHA" != "$BASE_SHA" ] && [ -z "$DIRTY" ]; then
  if [ "$KEEP" = "0" ]; then
    git worktree remove --force "$WT" >/dev/null 2>&1 && WT=""
  fi
  emit "committed" "$HEAD_SHA" "$FILES" "$INS" "$DEL" "$WT" ""
  exit 0
elif [ "$HEAD_SHA" != "$BASE_SHA" ]; then
  emit "dirty" "$HEAD_SHA" "$FILES" "$INS" "$DEL" "$WT" "agent committed but left uncommitted changes (agent exit $AGENT_EXIT); worktree kept"
  exit 1
else
  emit "no_commit" "" 0 0 0 "$WT" "agent produced no commit (agent exit $AGENT_EXIT); worktree kept"
  exit 1
fi
