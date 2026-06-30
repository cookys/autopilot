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
#       [--model "Gemini 3.5 Flash (High)"]   # default; names: `agy models` / `grok models`
#       [--runner auto|codex|agy|grok|cc-shim] # default auto: *gpt*/*codex*→codex,
#                                              #   *grok*/*composer*→grok, else agy.
#                                              #   Explicit wins (don't rely on name luck).
#                                              #   grok models: grok-build, grok-composer-2.5-fast
#                                              #   cc-shim (EXPLICIT only): Claude Code CLI
#                                              #   driving an Anthropic-compatible endpoint —
#                                              #   needs ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
#                                              #   in env (e.g. MiniMax-M3, GLM-*).
#       [--effort xhigh]                       # codex reasoning effort (low|medium|high|xhigh|max)
#       [--base develop]                       # default
#       [--timeout 9m]                         # agy --print-timeout (default 5m is too short)
#       [--agy-bin agy]                        # alternate binary (test seam)
#       [--grok-bin grok]                      # alternate binary (test seam)
#       [--keep-worktree]                      # keep worktree even on success
#
# OUTPUT: one JSON object on stdout (agent stdout goes to a log file, never
# stdout — keeps the JSON parseable):
#   { "status": "committed" | "no_op" | "question_suspected" | "dirty"
#               | "failure" | "precondition_failed",
#     "runner": "codex"|"agy"|"grok", "model": "...",   # engine provenance (model = --model)
#     "containment": "...", "contained": true|false,  # teardown-hygiene provenance
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
GROK_BIN="grok"
KEEP=0
BRANCH=""
PROMPT_FILE=""
RUNNER="auto"
EFFORT="xhigh"
IS_CODEX=0            # set in runner-selection; init early so emit/die before that are -u-safe
IS_GROK=0
IS_CCSHIM=0           # claude-code CLI pointed at an arbitrary Anthropic-compatible endpoint
GROK_PROMPT_FILE=""   # grok-only combined prompt temp; init early so the INT/TERM trap can reap it
CCSHIM_PROMPT_FILE="" # cc-shim combined prompt temp; same trap-reap rationale
CONTAINMENT="plain"   # plain|setsid|cgroup — set when the worker actually runs
CONTAINED=0           # 1 iff the container was provably reaped empty (setsid-proof only for cgroup)

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; }

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '; }

emit() { # status commit files ins del worktree error
  local commit_json="null" wt_json="null" err_json="null"
  [ -n "${2:-}" ] && commit_json="\"$2\""
  [ -n "${6:-}" ] && wt_json="\"$(json_escape "$6")\""
  [ -n "${7:-}" ] && err_json="\"$(json_escape "$7")\""
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  local contained_json="false"; [ "${CONTAINED:-0}" -eq 1 ] && contained_json="true"
  printf '{ "status": "%s", "runner": "%s", "model": "%s", "containment": "%s", "contained": %s, "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s }\n' \
    "$1" "$runner" "$(json_escape "$MODEL")" "$CONTAINMENT" "$contained_json" "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(json_escape "${LOG:-}")" "$err_json"
}

die_precondition() {
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s" }\n' \
    "$runner" "$(json_escape "$MODEL")" "$(json_escape "$BRANCH")" "$(json_escape "$BASE")" "$(json_escape "$1")"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --runner) RUNNER="${2:-}"; shift 2 ;;
    --effort) EFFORT="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --agy-bin) AGY_BIN="${2:-}"; shift 2 ;;
    --grok-bin) GROK_BIN="${2:-}"; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die_precondition "unknown argument: $1" ;;
  esac
done

# Runner selection. Explicit --runner wins; `auto` detects codex from the model
# name. The OLD bug: only `*gpt-5.5*` matched, so other codex models
# (gpt-5.3-codex-spark, gpt-5.x-codex, …) silently fell through to the agy branch
# — which on this repo writes its plugin install copy (no_op + false self-report,
# memory: agy-writes-install-dir). Match the codex FAMILY, not one string.
IS_CODEX=0
IS_GROK=0
IS_CCSHIM=0
case "$RUNNER" in
  codex)   IS_CODEX=1 ;;
  agy)     ;;
  grok)    IS_GROK=1 ;;
  cc-shim) IS_CCSHIM=1 ;;   # EXPLICIT only (never auto) — it needs ANTHROPIC_BASE_URL set
  auto)
    # case-insensitive family match: gpt*/...codex* → codex; grok*/composer* → grok
    # (composer-2.5 ships inside the grok CLI on the Grok Build plan); else agy.
    # cc-shim is never auto-selected: it is a base-url shim that requires env vars, so
    # a bare model name must NOT silently route there.
    model_lc="$(printf '%s' "$MODEL" | tr '[:upper:]' '[:lower:]')"
    if [[ "$model_lc" == *gpt* || "$model_lc" == *codex* ]]; then
      IS_CODEX=1
    elif [[ "$model_lc" == *grok* || "$model_lc" == *composer* ]]; then
      IS_GROK=1
    fi
    ;;
  *) die_precondition "--runner must be one of auto|codex|agy|grok|cc-shim (got: $RUNNER)" ;;
esac

case "$EFFORT" in
  low|medium|high|xhigh|max) ;;
  *) die_precondition "--effort must be one of low|medium|high|xhigh|max (got: $EFFORT)" ;;
esac

# --- preconditions (exit 2, nothing created) ---
[ -n "$BRANCH" ] || die_precondition "--branch is required"
[ -n "$PROMPT_FILE" ] || die_precondition "--prompt-file is required"
[ -r "$PROMPT_FILE" ] || die_precondition "prompt file not readable: $PROMPT_FILE"

if [ "$IS_CODEX" -eq 1 ]; then
  command -v "codex" >/dev/null 2>&1 || die_precondition "codex binary not found (install OpenAI Codex or ensure it is in PATH)"
elif [ "$IS_CCSHIM" -eq 1 ]; then
  command -v "claude" >/dev/null 2>&1 || die_precondition "claude binary not found (cc-shim drives the Claude Code CLI)"
  # cc-shim is a base-url SHIM by design: without ANTHROPIC_BASE_URL it would dispatch to
  # vanilla Claude (homogeneous, and burning the user's own quota). Require it + the token.
  [ -n "${ANTHROPIC_BASE_URL:-}" ] || die_precondition "cc-shim requires ANTHROPIC_BASE_URL in env (point it at an Anthropic-compatible endpoint, e.g. https://api.minimax.io/anthropic)"
  # Require ANTHROPIC_AUTH_TOKEN specifically (the bearer token the shim uses), NOT
  # ANTHROPIC_API_KEY: the dispatch deliberately `env -u ANTHROPIC_API_KEY`s so a user's
  # real-Anthropic key can't take precedence over the shim token — so accepting API_KEY
  # here would pass the precondition then leave the run with no usable auth (gpt-5.5 review).
  [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || die_precondition "cc-shim requires ANTHROPIC_AUTH_TOKEN in env (the shim's bearer token; ANTHROPIC_API_KEY is intentionally NOT used — it is unset before launching claude so it cannot override the shim token)"
elif [ "$IS_GROK" -eq 1 ]; then
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN (install xAI Grok Build CLI or pass --grok-bin)"
else
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN (install Antigravity CLI or pass --agy-bin)"
fi

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

# --- worker containment (BEST-EFFORT teardown — NOT a malicious-worker boundary) ---
# Purpose: reap escaped descendants so a long/aborted run doesn't leak background
# processes. A plain process-GROUP kill misses a `setsid`-escaped child; a cgroup
# catches it (verified: setsid child stays in cgroup.procs, dies on cgroup.kill).
# Containment tier (provenance only):
#   cgroup  — systemd-run --user --scope; cgroup.kill reaps the subtree incl. setsid
#             escapes; emits CONTAINMENT=cgroup + CONTAINED=1 when the scope verifies
#             empty.
#   setsid  — own session, reaped by session-pgroup kill (catches ordinary children,
#             not a deliberate inner setsid). CONTAINMENT=setsid.
#   plain   — no container available. CONTAINMENT=plain.
# IMPORTANT — NOT malicious-proof: a same-user worker can `systemd-run --user --scope`
# a SIBLING cgroup OUTSIDE this scope (gpt-5.5 review 2026-06-26 verified the sibling
# survives our reap), so `contained:true` is teardown hygiene, NOT a security
# attestation. It does NOT (and must not) unlock the L1 block-mode override — closing
# that needs a real isolation boundary (separate UID / sandbox / no user systemd bus).
# See BACKLOG "dispatch-hetero descendant-containment".
SCOPE_UNIT=""; WORKER_SID=""
HAVE_CGROUP=0
if command -v systemd-run >/dev/null 2>&1 \
   && systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
  HAVE_CGROUP=1
fi
HAVE_SETSID=0; command -v setsid >/dev/null 2>&1 && setsid --help 2>&1 | grep -q -- --wait && HAVE_SETSID=1

reap_container() { # reaps the worker container on ANY exit path; sets CONTAINED
  if [ -n "$SCOPE_UNIT" ]; then
    systemctl --user kill "$SCOPE_UNIT" --signal=SIGKILL >/dev/null 2>&1 || true
    systemctl --user stop "$SCOPE_UNIT" >/dev/null 2>&1 || true
    # verify the cgroup is gone/empty — the genuine setsid-proof containment proof
    local i cg
    for i in 1 2 3 4 5 6 7 8 9 10; do
      systemctl --user is-active "$SCOPE_UNIT" >/dev/null 2>&1 || { CONTAINED=1; break; }
      sleep 0.3
    done
    cg="$(systemctl --user show "$SCOPE_UNIT" -p ControlGroup --value 2>/dev/null)"
    if [ -n "$cg" ] && [ -s "/sys/fs/cgroup${cg}/cgroup.procs" ]; then CONTAINED=0; fi
  elif [ -n "$WORKER_SID" ]; then
    kill -TERM "-$WORKER_SID" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do kill -0 "-$WORKER_SID" 2>/dev/null || break; sleep 0.3; done
    kill -KILL "-$WORKER_SID" 2>/dev/null || true
    sleep 0.2
    kill -0 "-$WORKER_SID" 2>/dev/null || CONTAINED=1   # session empty
  fi
}

# A TERM during the long run orphans the worktree + branch AND can leave worker
# descendants. Trap it to reap the container first, then the worktree + branch.
trap 'reap_container; [ -n "$GROK_PROMPT_FILE" ] && rm -f "$GROK_PROMPT_FILE"; [ -n "$CCSHIM_PROMPT_FILE" ] && rm -f "$CCSHIM_PROMPT_FILE"; git worktree remove --force "$WT" >/dev/null 2>&1; git branch -D "$BRANCH" >/dev/null 2>&1; exit 2' INT TERM

# Build the worker command line, then run it inside the strongest available
# container. The command cd's into the worktree itself (we cannot rely on a
# subshell cwd surviving the container boundary).
run_worker() { # "$@" = argv of the worker; redirects to LOG; sets AGENT_EXIT + CONTAINMENT
  if [ "$HAVE_CGROUP" -eq 1 ]; then
    SCOPE_UNIT="hetero-${BRANCH//\//-}-$$.scope"
    CONTAINMENT="cgroup"
    systemd-run --user --scope --quiet --unit="$SCOPE_UNIT" -- "$@" >"$LOG" 2>&1 &
    local rp=$!; wait "$rp"; AGENT_EXIT=$?
  elif [ "$HAVE_SETSID" -eq 1 ]; then
    CONTAINMENT="setsid"
    setsid --wait "$@" >"$LOG" 2>&1 &
    local rp=$!
    # the setsid'd worker is its own session leader; capture its sid (= the child pgid)
    WORKER_SID="$(ps -o pid= --ppid "$rp" 2>/dev/null | tr -d ' ' | head -1)"
    [ -z "$WORKER_SID" ] && WORKER_SID="$rp"
    wait "$rp"; AGENT_EXIT=$?
  else
    CONTAINMENT="plain"
    "$@" >"$LOG" 2>&1
    AGENT_EXIT=$?
  fi
  reap_container   # reap on the NORMAL exit path too (catch escaped survivors), set CONTAINED
}

# --- run the agent (its stdout/stderr go to LOG, never our stdout) ---
if [ "$IS_CODEX" -eq 1 ]; then
  run_worker bash -c 'cd "$1" && exec codex exec --model "$2" \
      --dangerously-bypass-approvals-and-sandbox \
      --dangerously-bypass-hook-trust \
      -c "model_reasoning_effort=\"$3\"" < "$4"' _ "$WT" "$MODEL" "$EFFORT" "$PROMPT_FILE"
elif [ "$IS_CCSHIM" -eq 1 ]; then
  # cc-shim: the Claude Code CLI (`claude -p`) driving an arbitrary Anthropic-compatible
  # endpoint via ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN from the env. The MODEL (e.g.
  # MiniMax-M3, GLM-*) is what writes the code — for an IMPLEMENTER the model matters, not
  # the driver. Spike-verified 2026-06-29: claude -p via MiniMax-M3 edited files in cwd
  # (clean tool_use, no reasoning leak), reading the prompt from STDIN (dodges ARG_MAX).
  # EDIT-ONLY + wrapper-commit (same rail as agy/grok). `cd $WT` so claude works in the
  # worktree; ANTHROPIC_API_KEY is unset so the shim token is the sole auth.
  CCSHIM_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

"
  CCSHIM_PROMPT_FILE="$(mktemp -t dispatch-hetero-ccshim-prompt-XXXXXX)"
  printf '%s' "${CCSHIM_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$CCSHIM_PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec env -u ANTHROPIC_API_KEY claude -p --model "$2" \
      --dangerously-skip-permissions < "$3"' _ "$WT" "$MODEL" "$CCSHIM_PROMPT_FILE"
  rm -f "$CCSHIM_PROMPT_FILE"
elif [ "$IS_GROK" -eq 1 ]; then
  # grok (xAI Grok Build CLI; models grok-build / grok-composer-2.5-fast). Unlike agy,
  # grok `-p` HONORS --cwd (verified Spike 2026-06-29: grok-composer-2.5-fast and
  # grok-build both created files inside --cwd, exit 0) — so NO absolute-path anchor
  # is needed. We still run grok EDIT-ONLY + wrapper-commit (same robust rail as agy):
  # the verdict is read from git artifacts, never from grok committing on its own.
  # Flags are all Spike-verified present: --prompt-file, --cwd, --model, --always-approve
  # (headless tool auto-approve), --no-alt-screen (clean capture under a pipe),
  # --output-format json. (Do NOT add unverified flags like --no-auto-update.)
  GROK_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

"
  # Feed via --prompt-file (NOT -p "$(cat …)"): a large task prompt as a single argv arg
  # can hit ARG_MAX before grok runs. The combined file MUST be an absolute path — grok
  # resolves --prompt-file relative to --cwd (Spike-verified 2026-06-29). mktemp is absolute.
  GROK_PROMPT_FILE="$(mktemp -t dispatch-hetero-grok-prompt-XXXXXX)"
  printf '%s' "${GROK_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$GROK_PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec "$2" --prompt-file "$3" --cwd "$1" --model "$4" \
      --always-approve --no-alt-screen --output-format json' \
      _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL"
  rm -f "$GROK_PROMPT_FILE"
else
  printf '%s\n' "dispatch-hetero: NOTE — agy/Gemini directory-targeting is now RELIABLE: the directive below PREPENDS an absolute-worktree anchor (agy -p ignores process cwd, so a relative-path prompt made it invent a scratch project = the old no_op; the anchor points its edits at the real worktree — verified single- and multi-file). agy stays EDIT-ONLY for a DIFFERENT reason: run_command foreground-caps at 10s so the agent cannot RUN build/test/git mid-turn (the -p turn yields first). So agy edits, the wrapper commits, the reviewer verifies. For tasks where the agent itself must run build/test mid-flight, prefer --model gpt-5.5 (codex). See memory: agy-writes-install-dir (RESOLVED)." >&2
  # agy (Gemini) in -p print mode CANNOT reliably run a long command then commit:
  # its run_command tool foreground-caps at 10s, backgrounds anything longer, and
  # the single print turn yields ("you'll be notified, stop calling tools") before
  # the commit ever runs → silent no_op/hallucination. So we run agy EDIT-ONLY and
  # the wrapper commits its edits below. (gotcha: agy-headless-dispatch-unreliable.)
  AGY_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Your ABSOLUTE working directory is: $WT
Every file path in the task below resolves UNDER this directory. Convert every relative
path to absolute by prefixing it with '$WT/', and read/write ONLY absolute paths under
'$WT'. The files to edit ALREADY EXIST there. NEVER create a project, NEVER use a scratch
directory, NEVER use ~/.gemini, NEVER initialise a new git repo — edit the existing files
in place at '$WT'. (agy -p does not honor the process cwd, so this absolute anchor is the
only thing that points your edits at the real worktree instead of an invented scratch dir.)

You run in ONE non-interactive turn and you CANNOT wait for any background task. Therefore
do NOT use run_command / the shell AT ALL — no search, grep, find, ls, cat, install, build,
test, lint, or git. ANY shell command is moved to the background and your turn ends before
your edits are saved (that is the #1 cause of lost work here). Use ONLY your file read/edit
tools, on the exact paths named in the task. Make all file edits, then stop. The harness
commits your edits and a separate review verifies them — ignore any instruction below to
run build/test or to commit.
===

"
  run_worker bash -c 'cd "$1" && exec "$2" -p "$3" --model "$4" --dangerously-skip-permissions --print-timeout "$5"' \
      _ "$WT" "$AGY_BIN" "${AGY_EDIT_ONLY}$(cat "$PROMPT_FILE")" "$MODEL" "$TIMEOUT"
fi
trap - INT TERM

# agy/grok run edit-only → the wrapper makes the commit (deterministic). Only fires
# when the worker left edits but no commit; codex commits itself. If the worker
# already committed (HEAD moved) or left nothing, this is a no-op.
#
# --no-verify is MANDATORY: this wrapper commit is a mechanical artifact-CAPTURE of the
# edit-only worker's edits, NOT the quality gate (the contract puts verdict at depth 0 —
# the dispatching session reviews the branch diff before any merge). Running the TARGET
# repo's pre-commit hook here is both redundant and harmful: a hook that builds (e.g.
# codepower's `vue-tsc -b` on staged .ts/.vue) emits untracked artifacts that leave the
# tree dirty AND can `exit 1` to ABORT the commit — silently swallowing legitimately-correct
# edits as a false `dirty`/`no_op`. codex doesn't hit this because it cleans its own build
# artifacts before self-committing; the edit-only path has no such cleanup, so it must not
# trigger the hook at all. (Root cause of the 2026-06-30 agy/cc-shim `status:dirty` runs.)
if [ "$IS_CODEX" -eq 0 ] \
   && [ "$(git -C "$WT" rev-parse HEAD)" = "$BASE_SHA" ] \
   && [ -n "$(git -C "$WT" status --porcelain)" ]; then
  _runner_label="agy"; [ "$IS_GROK" -eq 1 ] && _runner_label="grok"; [ "$IS_CCSHIM" -eq 1 ] && _runner_label="cc-shim"
  git -C "$WT" add -A
  git -C "$WT" -c commit.gpgsign=false commit --no-verify -q -m "dispatch-hetero($_runner_label): edits on $BRANCH" >/dev/null 2>&1
fi

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
  if [ -n "$DIRTY" ]; then
    # edits exist but were never committed — e.g. the agy wrapper-commit above failed,
    # or the worker hand-edited without committing. Surface it (don't mis-score no_op).
    emit "dirty" "" 0 0 0 "$WT" "edits left uncommitted, no commit made (wrapper commit may have failed; agent exit $AGENT_EXIT); worktree kept"
    exit 1
  elif [ "$AGENT_EXIT" -eq 0 ]; then
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
