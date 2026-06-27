#!/usr/bin/env bash
# dispatch-explore — READ-the-repo heterogeneous dispatch (third sibling of the
# write-oriented dispatch-hetero.sh and the review-from-prompt dispatch-review.sh).
#
# Use when you WANT a hetero engine (codex/GPT, agy/Gemini) to READ the real repo and
# answer a question grounded in what it read — capability discovery, broad-context
# review, "what does this codebase actually do". This is the OPPOSITE posture to
# dispatch-review.sh (which feeds a diff as text precisely so the engine never reads
# the worktree). Here the repo is TRUSTED and reading it is the whole point.
#
# Why a script — the two read paths each have a non-obvious rail that, if skipped,
# makes the engine SILENTLY GUESS instead of reading (it then reports confident wrong
# "facts": a map-only agy once "fact-checked" 24 skills down to an invented 23). Both
# rails are baked in here so no caller rediscovers them:
#   - codex needs a working command-exec sandbox to shell-read files. When bubblewrap
#     (bwrap) is ABSENT the read-only sandbox fails BEFORE file access and codex falls
#     back to guessing. So: if bwrap is present → `--sandbox read-only` (proper
#     sandboxed read); if absent → `--dangerously-bypass-approvals-and-sandbox` with a
#     loud stderr warning. The bypass is acceptable HERE (the repo is trusted and the
#     task is read-only by intent) but NOT in dispatch-review.sh (untrusted diff).
#   - agy `-p` ignores the process cwd (it invents a ~/.gemini scratch project), so a
#     relative-path prompt never touches the repo. The prompt PREPENDS an absolute
#     working-directory anchor + an explicit absolute-path read-list. agy `-p` also
#     drops stdout under a non-TTY pipe (#76/#408) → captured through a `script -qec`
#     pseudo-TTY (same rail as dispatch-review.sh).
#
# FAIL-LOUD READ PROBE (the autopilot-aligned guard — never trust self-report): before
# trusting any answer, a fresh UNGUESSABLE token is written to a sentinel file in the
# repo and the engine is told to echo it back on a `READ-PROBE:` line. If the echo does
# not match, the engine could not actually read — status:read_failed, exit 3, and the
# (guessed) body is NEVER returned as valid. Disable only for a smoke test (--no-probe).
#
# READ-INTENT, NOT WRITE-PROOF (artifact-based write detection): only the codex
# `--sandbox read-only` path (bwrap present) actually PREVENTS writes. agy has no
# read-only mode (`--dangerously-skip-permissions` is all-or-nothing) and the codex
# bypass path is unsandboxed. So rather than falsely claim read-only, the script
# snapshots `git status --porcelain` before/after and reports `repo_modified:true`
# (status:explored_dirty, exit 4) + a loud stderr warning if the engine touched any
# TRACKED or UNTRACKED(non-ignored) file (same detect-by-artifact stance as
# dispatch-hetero.sh, applied to "did it stay read-only"). SCOPE: writes confined to
# already-gitignored paths (build artifacts) are out of scope — porcelain can't see them
# without an unbounded `--ignored` walk; run on a clean tree and the only blind spot is
# the ignored set. Install bubblewrap for a truly write-proof codex read.
#
# USAGE:
#   scripts/dispatch-explore.sh --runner codex|agy --model <name> --prompt-file <file>
#       [--repo <dir>]          # repo the engine may read (default: $PWD git toplevel)
#       [--effort xhigh]        # codex reasoning effort (low|medium|high|xhigh|max)
#       [--timeout 9m]          # agy --print-timeout (default 9m; reads take longer)
#       [--no-probe]            # skip the fail-loud read probe (smoke test ONLY)
#       [--bin <path>]          # override the runner binary (test seam)
#
# OUTPUT: one JSON object on stdout:
#   { "runner": "...", "model": "...", "status": "explored|explored_dirty|read_failed|precondition_failed",
#     "read_probe": "ok|failed|skipped", "sandbox": "read-only|bypass|n/a",
#     "repo_modified": true|false, "raw_log": "<path to the engine's full answer>", "error": "..." }
#
# EXIT: 0 = explored (read probe passed, repo untouched, answer in raw_log) ; 4 =
#   explored_dirty (answer in raw_log BUT the engine wrote to the repo — read-intent
#   violated, NOT a clean success) ; 3 = read_failed (engine could not read — FAIL-LOUD,
#   body withheld) ; 2 = precondition_failed.

set -uo pipefail

RUNNER=""; MODEL=""; PROMPT_FILE=""; REPO=""; EFFORT="xhigh"; TIMEOUT="9m"; BIN=""; NO_PROBE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner)      RUNNER="${2:-}"; shift 2 ;;
    --model)       MODEL="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --repo)        REPO="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; shift 2 ;;
    --no-probe)    NO_PROBE=1; shift ;;
    --bin)         BIN="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Defined before die_precondition so the precondition JSON can escape user-controlled
# values (--runner/--model/--repo can carry quotes/backslashes/newlines; raw interpolation
# would emit invalid JSON a caller's parser chokes on — decorrelated review, gpt-5.5).
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'; }

die_precondition() { printf '{ "runner": "%s", "model": "%s", "status": "precondition_failed", "read_probe": "skipped", "sandbox": "n/a", "raw_log": null, "error": "%s" }\n' "$(json_escape "$RUNNER")" "$(json_escape "$MODEL")" "$(json_escape "$1")"; exit 2; }

[[ -n "$RUNNER" ]] || die_precondition "--runner is required (codex|agy)"
case "$RUNNER" in codex|agy) ;; *) die_precondition "--runner must be codex or agy (got: $RUNNER)" ;; esac
[[ -n "$MODEL" ]] || die_precondition "--model is required"
[[ -n "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || die_precondition "--prompt-file is required and must be readable"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die_precondition "--effort must be low|medium|high|xhigh|max" ;; esac

# Resolve the repo the engine is allowed to read.
if [[ -z "$REPO" ]]; then
  REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
[[ -d "$REPO" ]] || die_precondition "--repo is not a directory: $REPO"
REPO="$(cd "$REPO" && pwd -P)"

# --- fail-loud read-probe sentinel ---
# A fresh unguessable token an engine that ISN'T reading the repo cannot reproduce.
PROBE_LINE=""; PROBE_STATUS="skipped"
SENTINEL=""
if [[ "$NO_PROBE" -eq 0 ]]; then
  TOKEN="READPROBE-$$-$(head -c 16 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo "$RANDOM$RANDOM")"
  SENTINEL="$REPO/.autopilot-read-probe.$$"
  printf '%s\n' "$TOKEN" > "$SENTINEL" 2>/dev/null || die_precondition "cannot write read-probe sentinel under $REPO"
  PROBE_LINE="MANDATORY FIRST STEP — read the file at the absolute path ${SENTINEL} and output its exact one-line contents on a line that starts with \"READ-PROBE: \". If you cannot read that file, output the line \"READ-PROBE: FAILED\". Do this BEFORE anything else, then continue with the task."
fi

RAW_LOG="$(mktemp -t dispatch-explore-log-XXXXXX)"
PROMPT_BUILT="$(mktemp -t dispatch-explore-prompt-XXXXXX)"
cleanup() { rm -f "$PROMPT_BUILT"; [[ -n "$SENTINEL" ]] && rm -f "$SENTINEL"; }
# INT/TERM too, not just EXIT — a bare EXIT trap does NOT fire on a signal kill, which
# would leave the untracked sentinel dirtying the worktree (decorrelated review, gpt-5.5).
trap cleanup EXIT INT TERM

# Write-detection (artifact-based, never trust the engine's own "I only read"):
# the explore posture is read-INTENT, but only the codex `--sandbox read-only` path
# (bwrap present) is write-PROOF — agy has no read-only mode and the codex bypass path
# doesn't sandbox. So snapshot the repo's tracked/untracked(non-ignored) state before the
# run and diff it after; if the engine touched any such file (beyond our own sentinel),
# the JSON carries repo_modified:true and a loud stderr warning, so a stray write is
# detected, not hidden. (Writes to already-gitignored paths are the one blind spot —
# porcelain can't see them without an unbounded --ignored walk; documented in the header.)
repo_state() { git -C "$REPO" status --porcelain 2>/dev/null | grep -vF '.autopilot-read-probe.' || true; }
STATE_PRE="$(repo_state)"

# --- build the prompt (engine-specific read anchor + probe + caller's task) ---
{
  if [[ "$RUNNER" = "agy" ]]; then
    printf 'Your ABSOLUTE working directory is: %s\n' "$REPO"
    printf 'Do NOT create any scratch project. Read ONLY real files under that absolute path, by absolute path.\n\n'
  else
    printf 'You may READ files under the absolute path %s (you are running with --cd there). Use ls/cat/rg to read real files; do not guess.\n\n' "$REPO"
  fi
  [[ -n "$PROBE_LINE" ]] && printf '%s\n\n' "$PROBE_LINE"
  cat "$PROMPT_FILE"
} > "$PROMPT_BUILT"

# --- dispatch ---
SANDBOX_MODE="n/a"
if [[ "$RUNNER" = "codex" ]]; then
  CODEX_BIN="${BIN:-codex}"
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN"
  # codex must shell-read files. The read-only sandbox needs bubblewrap; without it the
  # sandbox fails before file access and codex silently guesses. Detect and adapt.
  if command -v bwrap >/dev/null 2>&1; then
    SANDBOX_ARGS=(--sandbox read-only); SANDBOX_MODE="read-only"
  else
    SANDBOX_ARGS=(--dangerously-bypass-approvals-and-sandbox); SANDBOX_MODE="bypass"
    echo "dispatch-explore: NOTE — bubblewrap (bwrap) not on PATH; codex read-only sandbox cannot exec file reads, so using --dangerously-bypass-approvals-and-sandbox (repo is trusted, task is read-only). Install bubblewrap to keep codex sandboxed: e.g. 'sudo apt install bubblewrap'." >&2
  fi
  "$CODEX_BIN" exec --model "$MODEL" "${SANDBOX_ARGS[@]}" --skip-git-repo-check -C "$REPO" \
      -c "model_reasoning_effort=\"$EFFORT\"" < "$PROMPT_BUILT" > "$RAW_LOG" 2>/dev/null
else
  AGY_BIN="${BIN:-agy}"
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  # agy -p drops stdout under a non-TTY pipe (#76/#408) → capture through a pseudo-TTY.
  # Correct arg order: prompt RIGHT AFTER -p, --model LAST (a --model wedged before the
  # prompt makes agy treat the model-name string as the prompt and answer "I am running
  # on <model>" instead of the task).
  RUN_SH="$(mktemp -t dispatch-explore-agy-XXXXXX)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'exec %q -p "$(cat %q)" --model %q --dangerously-skip-permissions --print-timeout %q\n' \
      "$AGY_BIN" "$PROMPT_BUILT" "$MODEL" "$TIMEOUT"
  } > "$RUN_SH"
  chmod +x "$RUN_SH"
  script -qec "$RUN_SH" "$RAW_LOG" >/dev/null 2>&1 || true
  rm -rf "$RUN_SH"
  tr -d '\r' < "$RAW_LOG" > "$RAW_LOG.clean" && mv "$RAW_LOG.clean" "$RAW_LOG"
fi

# --- detect any write the engine made to the trusted repo (artifact-based) ---
REPO_MODIFIED="false"
if [[ "$(repo_state)" != "$STATE_PRE" ]]; then
  REPO_MODIFIED="true"
  echo "dispatch-explore: WARNING — the repo's git state CHANGED during the run (engine wrote to the trusted repo despite read-only intent). sandbox=$SANDBOX_MODE. Inspect 'git -C $REPO status' and revert as needed." >&2
fi

# --- evaluate the fail-loud read probe ---
if [[ "$NO_PROBE" -eq 0 ]]; then
  GOT="$(grep -aE '^[[:space:]]*READ-PROBE:' "$RAW_LOG" 2>/dev/null | head -1 | sed -E 's/^[[:space:]]*READ-PROBE:[[:space:]]*//' | tr -d '[:space:]')"
  if [[ "$GOT" == "$TOKEN" ]]; then
    PROBE_STATUS="ok"
  else
    PROBE_STATUS="failed"
    printf '{ "runner": "%s", "model": "%s", "status": "read_failed", "read_probe": "failed", "sandbox": "%s", "repo_modified": %s, "raw_log": "%s", "error": "engine did not echo the read-probe token (it could not read the repo and would be guessing) — body withheld, fail-loud" }\n' \
      "$RUNNER" "$(json_escape "$MODEL")" "$SANDBOX_MODE" "$REPO_MODIFIED" "$RAW_LOG"
    exit 3
  fi
fi

# A repo write VIOLATES the read-intent contract — it must not read as a clean success.
# Surface it in the EXIT CODE (4), not just the JSON field, so a caller that only checks
# `exit 0` cannot silently treat a mutating run as clean (decorrelated review, gpt-5.5).
if [[ "$REPO_MODIFIED" == "true" ]]; then
  printf '{ "runner": "%s", "model": "%s", "status": "explored_dirty", "read_probe": "%s", "sandbox": "%s", "repo_modified": true, "raw_log": "%s", "error": "engine wrote to the trusted repo (read-intent violated) — answer is in raw_log but the run is NOT clean; inspect git status and revert" }\n' \
    "$RUNNER" "$(json_escape "$MODEL")" "$PROBE_STATUS" "$SANDBOX_MODE" "$RAW_LOG"
  exit 4
fi

printf '{ "runner": "%s", "model": "%s", "status": "explored", "read_probe": "%s", "sandbox": "%s", "repo_modified": false, "raw_log": "%s", "error": null }\n' \
  "$RUNNER" "$(json_escape "$MODEL")" "$PROBE_STATUS" "$SANDBOX_MODE" "$RAW_LOG"
exit 0
