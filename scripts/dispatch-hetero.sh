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
#       [--runner auto|codex|agy|grok|cc-shim|pi|qoderclicn] # default auto: *gpt*/*codex*→codex,
#                                              #   *grok*/*composer*→grok, *qwen*/*qwq*→qoderclicn, else agy.
#                                              #   Explicit wins (don't rely on name luck).
#                                              #   grok models: grok-4.5 (ex-grok-build), grok-composer-2.5-fast
#                                              #   cc-shim (EXPLICIT only): Claude Code CLI
#                                              #   driving an Anthropic-compatible endpoint —
#                                              #   needs ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
#                                              #   in env (e.g. MiniMax-M3, GLM-*).
#                                              #   pi (EXPLICIT only): pi coding agent over RPC
#                                              #   (duplex supervisor scripts/lib/pi-rpc-run.js;
#                                              #   provider default minimax via PI_RPC_PROVIDER).
#       [--effort xhigh]                       # codex reasoning effort (low|medium|high|xhigh|max)
#       [--endpoint <name>]                    # cc-shim only: resolve creds via
#                                              #   resolve-endpoint.sh (AUTOPILOT_ENDPOINT_<NAME>_*)
#                                              #   into ANTHROPIC_BASE_URL/AUTH_TOKEN; raw env
#                                              #   still used when omitted (byte-identical)
#       [--context-window off|warn|block]      # pre-dispatch context-window gate (default:
#                                              #   block; also AUTOPILOT_CONTEXT_WINDOW_GATE).
#                                              #   Over budget ⇒ fail closed BEFORE the runner
#                                              #   spawns and before the worktree exists.
#                                              #   See references/hetero-dispatch.md
#                                              #   § Context-window gate.
#       [--skill-mode off|prompt|native|auto]  # skill transport mode (default: off)
#       [--skill <name>]                       # repeatable skill name (0+)
#       [--base develop]                       # default
#       [--timeout 9m]                         # agy --print-timeout (default 5m is too short)
#       [--agy-bin agy]                        # alternate binary (test seam)
#       [--grok-bin grok]                      # alternate binary (test seam)
#       [--codex-bin codex]                    # alternate/pinned codex (test seam; avoids a
#                                              #   stale codex earlier in PATH lacking the flag)
#       [--pi-bin pi]                          # alternate/pinned pi executable (test seam)
#       [--qoder-bin qoderclicn]               # alternate/pinned Qoder CLI CN (test seam)
#       [--strict-contract]                     # required together with --contract-file
#       [--contract-file <path>]                # required together with --strict-contract
#       [--keep-worktree]                      # keep worktree even on success
#   scripts/dispatch-hetero.sh --gc            # marker-scoped stale worktree reaper
#       [--reap-unmarked --yes]                # recovery: reap unmarked hetero-* only
#   ⏳ TIMEOUT: the implementer run can take MANY minutes. Under Claude Code's Bash tool,
#   pass a generous `timeout` — the 120s tool default SIGTERMs long runs (exit 143). Persist
#   once with BASH_DEFAULT_TIMEOUT_MS (and BASH_MAX_TIMEOUT_MS) in ~/.claude/settings.json `env`.
#
# OUTPUT: one JSON object on stdout (agent stdout goes to a log file, never
# stdout — keeps the JSON parseable):
#   { "status": "committed" | "no_op" | "question_suspected" | "dirty"
#               | "failure" | "precondition_failed",
#     "runner": "codex"|"agy"|"grok"|"cc-shim"|"pi"|"qoderclicn", "model": "...",   # engine provenance (model = --model)
#     "containment": "...", "contained": true|false,  # teardown-hygiene provenance
#     "branch": "...", "base": "...", "commit": "...|null",
#     "files_changed": N, "insertions": N, "deletions": N,
#     "worktree": "...|null", "agent_log": "..." , "error": "...|null",
#     "skill_mode_effective": "...", "skills_injected": [...],
#     "orphan_worktree": "...|null" }          # non-null iff remove failed and dir remains
# --gc OUTPUT: { "reaped":[…], "skipped_live":n, "skipped_fresh":n,
#     "skipped_unmatched":n, "lock_unsupported":n, "kept_orphan":[…] }
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
MODEL_SUPPLIED=0
BASE_SUPPLIED=0
RUNNER_SUPPLIED=0
TIMEOUT_SUPPLIED=0
AGY_BIN="agy"
GROK_BIN="grok"
CODEX_BIN="codex"    # test seam / explicit pin — resolve a specific codex (PATH ambiguity: a
                     # stale codex earlier in PATH lacks --dangerously-bypass-hook-trust)
QODER_BIN="qoderclicn"  # Qoder CLI CN runner (Qwen3.8-Max-Preview etc.); test seam via --qoder-bin
KEEP=0
BRANCH=""
PROMPT_FILE=""
RUNNER="auto"
EFFORT="xhigh"
ENDPOINT=""          # optional named endpoint (cc-shim only) → resolve-endpoint.sh
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env (best-effort;
# a rejected/absent file is a no-op and the cc-shim precondition fires normally). Loaded BEFORE
# any endpoint/env consumption. resolution contract stays AUTOPILOT_ENDPOINT_<NAME>_* env vars.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/load-endpoints-env.sh" ] && . "$SELF_DIR/load-endpoints-env.sh" && autopilot_load_endpoints_env || true
# Startup retention prune of OUR OWN aged ${TMPDIR} residue (logs/prompt temps/pi
# sessions — NEVER worktrees; those are lock/marker-gated in worktree-reap.sh /
# dispatch-status.js --reap). Best-effort; AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 disables.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/lib/prune-tmp-residue.sh" ] && . "$SELF_DIR/lib/prune-tmp-residue.sh" \
  && prune_tmp_residue "${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}" \
       'hetero-*-log-*' 'dispatch-hetero-*' 'pi-rpc-session-*' 'hetero-detach-state-*' || true
# Pre-dispatch context-window gate (lib/context-window.sh). Best-effort source: a missing
# helper degrades to "no gate", never to a dispatch outage.
# shellcheck source=/dev/null
[ -r "$SELF_DIR/lib/context-window.sh" ] && . "$SELF_DIR/lib/context-window.sh" || true
CONTEXT_WINDOW_GATE=""     # off|warn|block; empty ⇒ AUTOPILOT_CONTEXT_WINDOW_GATE, else block
IS_CODEX=0            # set in runner-selection; init early so emit/die before that are -u-safe
IS_GROK=0
IS_CCSHIM=0           # claude-code CLI pointed at an arbitrary Anthropic-compatible endpoint
IS_PI=0
PI_BIN="pi"
GROK_PROMPT_FILE=""   # grok-only combined prompt temp; init early so the INT/TERM trap can reap it
CCSHIM_PROMPT_FILE="" # cc-shim combined prompt temp; same trap-reap rationale
QODER_PROMPT_FILE=""  # qoder combined prompt temp; init early so it is SET for the detach declare -p
CONTAINMENT="plain"   # plain|setsid|cgroup — set when the worker actually runs
CONTAINED=0           # 1 iff the container was provably reaped empty (setsid-proof only for cgroup)
IDENTITY_DRIFT=0      # 1 iff worker mutated consuming-repo user.name/email via shared .git/config
IDENTITY_PRE_NAME=""  # snapshot of consuming-repo user.name before runner
IDENTITY_PRE_EMAIL="" # snapshot of consuming-repo user.email before runner
IDENTITY_REPO_ROOT="" # host repo root captured at pre-snapshot (for explicit git -C restore)
SKILL_MODE="off"
SKILLS=()
EFFECTIVE_SKILL_MODE="off"
SKILLS_INJECTED_JSON="[]"
PACKED_PROMPT_TEMP=""
SKILL_PACK_CONTENT_TEMP=""
STRICT_CONTRACT=0
CONTRACT_FILE=""
CONTRACT_FILE_SUPPLIED=0
STRICT_CONTRACT_RESULT_FIELDS=0
STRICT_UNIT_ID=""
STRICT_CONTRACT_SHA=""
STRICT_SPEC_SHA=""
STRICT_GO=""
STRICT_SCOPE_ALLOW_PATHS=()
STRICT_SCOPE_DENY_PATHS=()
STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS=()
STRICT_SCOPE_MAX_FILES=""
STRICT_SCOPE_MAX_DIFF_LINES=""
STRICT_OUTPUT_PATHS=()
STRICT_POSTCHECK_OK=0
STRICT_POSTCHECK_STATUS=""
STRICT_POSTCHECK_ERROR=""
# ORPHAN_LOG must be set BEFORE the INT/TERM trap is armed (round-2 MiniMax §2f) so a
# trap firing mid-run appends to a real path instead of an undefined one. Keep the
# predictable log and lock inside a private per-user directory: shared /tmp names
# let another user deny service or redirect either path before startup.
ORPHAN_STATE_DIR="${AUTOPILOT_ORPHAN_STATE_DIR:-${TMPDIR:-/tmp}/autopilot-${UID:-$(id -u)}}"
_init_orphan_state_dir() {
  local dir="$1" mode
  if [ -e "$dir" ] || [ -L "$dir" ]; then
    [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  else
    (umask 077; mkdir "$dir") || return 1
  fi
  mode="$(stat -c '%a' "$dir" 2>/dev/null || stat -f '%Lp' "$dir" 2>/dev/null)" || return 1
  case "$mode" in 700|0700) ;; *) return 1 ;; esac
}
if ! _init_orphan_state_dir "$ORPHAN_STATE_DIR"; then
  printf 'ERROR: unsafe orphan state directory: %s\n' "$ORPHAN_STATE_DIR" >&2
  exit 2
fi
ORPHAN_LOG="$ORPHAN_STATE_DIR/autopilot-orphan-worktrees.log"

# Retry signal-handler orphan entries once before the normal marker/age GC pass.
# The log can contain both paths and redirected git stderr, so only exact,
# registered linked-worktree paths are actionable; everything else is either
# pruned as noise/stale state or preserved as a recoverable live path.
rewrite_orphan_log() {
  [ -e "$ORPHAN_LOG" ] || return 0
  local tmp lock_fd path gitfile_line common_raw common_dir registered line rc list err probe_fd
  [ -f "$ORPHAN_LOG" ] || { printf 'WARN: orphan log is not a regular file: %s\n' "$ORPHAN_LOG" >&2; return 1; }
  _wt_open_lock_fd "${ORPHAN_LOG}.lock" || return 1
  lock_fd="$_WT_SAFE_LOCK_FD"
  flock -x "$lock_fd" || { exec {lock_fd}>&-; return 1; }
  mapfile -t orphan_entries < "$ORPHAN_LOG" || { exec {lock_fd}>&-; return 1; }
  tmp="$(mktemp "${ORPHAN_LOG}.tmp.XXXXXX")" || { exec {lock_fd}>&-; return 1; }

  for path in "${orphan_entries[@]}"; do
    case "$path" in
      /*) ;;
      *) continue ;;
    esac
    [ -d "$path" ] || continue

    if [ ! -O "$path" ]; then
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    fi
    if [ ! -f "$path/.git" ]; then
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    fi
    IFS= read -r gitfile_line < "$path/.git" || gitfile_line=""
    case "$gitfile_line" in
      gitdir:\ *) ;;
      *) printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }; continue ;;
    esac

    common_raw="$(git -C "$path" rev-parse --git-common-dir 2>/dev/null)" || {
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    }
    common_dir="$(cd "$path" 2>/dev/null && cd "$common_raw" 2>/dev/null && pwd -P)" || {
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    }

    list="$(mktemp "${ORPHAN_LOG}.worktrees.XXXXXX")" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
    err="$(mktemp "${ORPHAN_LOG}.worktrees-err.XXXXXX")" || { rm -f "$tmp" "$list"; exec {lock_fd}>&-; return 1; }
    if ! git --git-dir="$common_dir" worktree list --porcelain >"$list" 2>"$err"; then
      rm -f "$tmp" "$list" "$err"; exec {lock_fd}>&-; return 1
    fi
    rm -f "$err"
    registered=0
    while IFS= read -r line; do
      if [ "$line" = "worktree $path" ]; then
        registered=1
        break
      fi
    done < "$list"
    rc=$?; rm -f "$list"
    [ "$rc" -eq 0 ] || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
    if [ "$registered" -ne 1 ]; then
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    fi

    _wt_is_live "$path"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      # A held lifetime lock is live; an unsupported/unsafe probe is ambiguous.
      # Both stay actionable in the orphan log and must never be removed.
      printf '%s\n' "$path" >> "$tmp" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
      continue
    fi
    probe_fd="$_WT_PROBE_FD"
    if ! git --git-dir="$common_dir" worktree remove --force "$path" >/dev/null 2>&1; then
      printf '%s\n' "$path" >> "$tmp" || {
        exec {probe_fd}>&- || true
        rm -f "$tmp"; exec {lock_fd}>&-; return 1
      }
    fi
    # Hold the lifetime proof continuously across worktree removal.
    exec {probe_fd}>&- || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
  done

  if [ -n "${AUTOPILOT_ORPHAN_REWRITE_TEST_HOOK:-}" ]; then
    AUTOPILOT_ORPHAN_REWRITE_LOCK_FD="$lock_fd" "${AUTOPILOT_ORPHAN_REWRITE_TEST_HOOK}" "$ORPHAN_LOG" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
  fi

  if [ -s "$tmp" ]; then
    mv -f "$tmp" "$ORPHAN_LOG" || { rm -f "$tmp"; exec {lock_fd}>&-; return 1; }
  else
    rm -f "$tmp" || { exec {lock_fd}>&-; return 1; }
    rm -f "$ORPHAN_LOG" || { exec {lock_fd}>&-; return 1; }
  fi
  exec {lock_fd}>&-
}
# --- dispatch-observability Stage 1 (run manifest; ALL ADDITIVE) ---
# A START-time manifest under $MANIFEST_DIR_PATH names this run's identity (run_id,
# log path, worktree, lock, predicted containment) so depth-0 / dispatch-status.js can
# locate and liveness-probe the run MID-FLIGHT instead of waiting for the final JSON.
# Best-effort sidecar: a manifest write failure NEVER fails the dispatch. Disable with
# AUTOPILOT_DISPATCH_MANIFEST=0 (legacy byte-identical escape hatch, minus the new
# final-JSON fields). Telemetry only — no verdict/status semantics change.
MANIFEST_DIR_PATH="${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}"
DISPATCH_RUN_ID=""
DISPATCH_STARTED_EPOCH=""
MANIFEST_FILE=""
MANIFEST_CONTAINMENT="plain"
MANIFEST_SCOPE_UNIT=""
MANIFEST_PID_RECORDED=""
MANIFEST_ENDED_AT=""
MANIFEST_ENDED_EPOCH=""
MANIFEST_FINAL_STATUS=""
OUTCOME_ORPHAN=""     # non-empty path when worktree remove failed and dir remains
WT_LOCK_FD=""         # dedicated fd holding exclusive lifetime flock on the worktree lock
DO_GC=0               # --gc subcommand (stale reaper; no dispatch)
REAP_UNMARKED=0       # --reap-unmarked recovery flag (requires --yes)
GC_YES=0              # --yes confirmation for destructive recovery flags
# --- R1 detach / durable-result plumbing (all OPTIONAL; absent ⇒ byte-identical legacy behavior) ---
# When --ledger/--run-id/--stage are ALL supplied AND detach is on (DISPATCH_DETACH!=0, the
# default), the long-running engine worker is run inside a `setsid` session that SURVIVES the
# caller (the wrapper / 900s-capped bash tool) being killed. That detached session heartbeats to
# the R0 ledger, writes its final outcome JSON atomically to a deterministic result path, and
# records the committed stage — so a killed caller loses no work (recover via run-ledger resume).
# When any coord is absent OR DISPATCH_DETACH=0, NONE of this engages: the inline path below runs
# exactly as it did before R1 (proven byte-identical by the detach test + existing hetero tests).
LEDGER=""
RUN_ID=""
STAGE=""
RESULTS_DIR=""
RESULT_FILE=""
EXIT_FILE=""
HEARTBEAT_SECS="${DISPATCH_HEARTBEAT_SECS:-20}"
OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT=""; OUTCOME_ERR=""; OUTCOME_EXIT=1
CLASSIFIED_ERROR=""   # set by passive_capture (classify-error once per outcome); read by classify_outcome
# shellcheck source=/dev/null
. "$SELF_DIR/lib/worktree-reap.sh"
cleanup() {
  [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
  [ -n "${SKILL_PACK_CONTENT_TEMP:-}" ] && rm -f "$SKILL_PACK_CONTENT_TEMP"
}
trap cleanup EXIT

usage() { sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; }

# shellcheck source=lib/json-emit.sh
. "$SELF_DIR/lib/json-emit.sh"
# Class A: flatten newlines before shared RFC escape (flatten stays VISIBLE here).
_flat_json_escape() { json_escape "$(printf '%s' "$1" | tr '\n' ' ')"; }

extract_json_value() {
  local key="" json=""
  if [ "$#" -eq 1 ]; then
    key="$1"
    json="$(cat)"
  else
    json="${1-}"
    key="${2-}"
  fi
  [ -n "$json" ] || return 1
  printf '%s' "$json" | node -e '
const fs = require("fs");
const key = process.argv[1];
const raw = fs.readFileSync(0, "utf8").trim();
let data;
try { data = JSON.parse(raw); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$key"
}

extract_last_json() {
  node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").split(/\r?\n/);
for (let i = lines.length - 1; i >= 0; i--) {
  const line = String(lines[i] || "").trim();
  if (!line) continue;
  try {
    JSON.parse(line);
    process.stdout.write(line);
    process.exit(0);
  } catch (e) {}
}
process.exit(1);
'
}

extract_file_json_value() {
  local path="$1" key="$2"
  node -e '
const fs = require("fs");
const path = process.argv[1];
const key = process.argv[2];
let data;
try { data = JSON.parse(fs.readFileSync(path, "utf8")); } catch (e) { process.exit(1); }
const parts = key.split(".");
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(2);
  }
  cur = cur[part];
}
if (cur === null || cur === undefined) process.exit(3);
if (typeof cur === "object") {
  process.stdout.write(JSON.stringify(cur));
} else {
  process.stdout.write(String(cur));
}
' "$path" "$key"
}

read_contract_array_lines() { # $1=contract-json $2=dot-path
  local contract_path="$1" dot_path="$2"
  node -e '
const fs = require("fs");
const contractPath = process.argv[1];
const dotPath = process.argv[2];
const parts = String(dotPath || "").split(".").filter(Boolean);
let data;
try {
  data = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (e) {
  process.exit(1);
}
let cur = data;
for (const part of parts) {
  if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
    process.exit(0);
  }
  cur = cur[part];
}
if (!Array.isArray(cur)) process.exit(0);
for (const value of cur) {
  if (typeof value === "string") {
    console.log(value);
  }
}
' "$contract_path" "$dot_path"
}

json_array_to_lines() {
  local json=""
  if [ "$#" -ge 1 ]; then
    json="$1"
  else
    json="$(cat)"
  fi
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let values;
try {
  values = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}
if (!Array.isArray(values)) process.exit(0);
for (const value of values) {
  if (typeof value === "string") {
    console.log(value);
  }
}'
 <<< "$json"
}

json_array_first() {
  local json=""
  if [ "$#" -ge 1 ]; then
    json="$1"
  else
    json="$(cat)"
  fi
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let values;
try {
  values = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}
if (!Array.isArray(values) || values.length === 0) process.exit(0);
const value = values[0];
if (typeof value === "string") {
  process.stdout.write(value);
} else if (value !== undefined && value !== null) {
  process.stdout.write(String(value));
}
' <<< "$json"
}

normalize_timeout_seconds() {
  node -e '
const v = String(process.argv[1] || "").trim().toLowerCase();
if (!v) process.exit(1);
if (/^\d+$/.test(v)) {
  process.stdout.write(String(parseInt(v, 10)));
  process.exit(0);
}
if (/^\d+\s*s$/.test(v)) {
  process.stdout.write(String(parseInt(v.slice(0, -1), 10)));
  process.exit(0);
}
if (/^\d+\s*m$/.test(v)) {
  const m = parseInt(v, 10);
  process.stdout.write(String(m * 60));
  process.exit(0);
}
process.exit(2);
' "$1"
}

emit() { # status commit files ins del worktree error
  # Identity containment rail (shared emit path — every outcome): compare post-run
  # consuming-repo user.name/email to the pre-run snapshot; restore + flag on drift.
  # A bare `git config user.*` inside a worktree writes through the shared .git/config.
  # Always use git -C "$IDENTITY_REPO_ROOT" so restore does not depend on dispatcher cwd.
  if [ -n "${IDENTITY_REPO_ROOT:-}" ]; then
    local post_name post_email
    # --local: shared .git/config is local scope; empty pre restores inheritance via --unset.
    post_name="$(git -C "$IDENTITY_REPO_ROOT" config --local user.name 2>/dev/null || true)"
    post_email="$(git -C "$IDENTITY_REPO_ROOT" config --local user.email 2>/dev/null || true)"
    if [ "$post_name" != "$IDENTITY_PRE_NAME" ] || [ "$post_email" != "$IDENTITY_PRE_EMAIL" ]; then
      IDENTITY_DRIFT=1
      # Explicit if/else — never fall through to --unset when a non-empty set fails.
      if [ -n "$IDENTITY_PRE_NAME" ]; then
        git -C "$IDENTITY_REPO_ROOT" config --local user.name "$IDENTITY_PRE_NAME" \
          || echo "WARNING: identity restore failed — could not set local user.name" >&2
      else
        git -C "$IDENTITY_REPO_ROOT" config --local --unset user.name 2>/dev/null || true
      fi
      if [ -n "$IDENTITY_PRE_EMAIL" ]; then
        git -C "$IDENTITY_REPO_ROOT" config --local user.email "$IDENTITY_PRE_EMAIL" \
          || echo "WARNING: identity restore failed — could not set local user.email" >&2
      else
        git -C "$IDENTITY_REPO_ROOT" config --local --unset user.email 2>/dev/null || true
      fi
      echo "WARNING: identity drift detected — worker changed the consuming repo's git identity; restored the original values" >&2
    fi
  fi
  local commit_json="null" wt_json="null" err_json="null" orphan_json="null"
  [ -n "${2:-}" ] && commit_json="\"$2\""
  [ -n "${6:-}" ] && wt_json="\"$(_flat_json_escape "$6")\""
  [ -n "${7:-}" ] && err_json="\"$(_flat_json_escape "$7")\""
  [ -n "${OUTCOME_ORPHAN:-}" ] && orphan_json="\"$(_flat_json_escape "$OUTCOME_ORPHAN")\""
  local strict_unit_json="null" strict_contract_sha_json="null" strict_spec_sha_json="null" strict_go_json="null"
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    [ -n "${STRICT_UNIT_ID:-}" ] && strict_unit_json="\"$(_flat_json_escape "$STRICT_UNIT_ID")\""
    [ -n "${STRICT_CONTRACT_SHA:-}" ] && strict_contract_sha_json="\"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\""
    [ -n "${STRICT_SPEC_SHA:-}" ] && strict_spec_sha_json="\"$(_flat_json_escape "$STRICT_SPEC_SHA")\""
    [ -n "${STRICT_GO:-}" ] && strict_go_json="\"$(_flat_json_escape "$STRICT_GO")\""
  fi
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  local contained_json="false"; [ "${CONTAINED:-0}" -eq 1 ] && contained_json="true"
  # --- observability fields (ADDITIVE; consumers tolerate unknown fields — implementer.js
  # validates required-field presence, not a closed set). usage is parsed from the HARNESS
  # event stream in $LOG by dispatch-status.js (--usage-only prints ONE line: an object or
  # `null`, never fails) — NOT worker self-report. Any parse/node failure ⇒ null.
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local usage_json="null"
  if [ "${AGENT_EXIT:-1}" -eq 0 ] && [ -n "${LOG:-}" ] && [ -r "${LOG:-/nonexistent}" ] \
     && [ -r "$SELF_DIR/dispatch-status.js" ] && command -v node >/dev/null 2>&1; then
    # Format is DECLARED by runner (this script knows its own invocation flags: codex =
    # chrome text, grok = --output-format json, agy/cc-shim = plain) — never content-
    # sniffed, so a worker printing JSON/fake-chrome cannot self-report telemetry.
    # AGENT_EXIT==0 gate: on a clean exit the harness footer always owns the log tail,
    # so the parser's tail-anchored token read cannot be spoofed; on an abnormal exit
    # the tail is worker-controlled → usage stays null (honest, not fabricated).
    local log_format="plain"
    [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
    [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
    [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
    usage_json="$(node "$SELF_DIR/dispatch-status.js" --log "$LOG" --format "$log_format" --usage-only 2>/dev/null)" || usage_json="null"
    case "$usage_json" in
      '{'*'}') ;;   # single-line JSON object — accepted
      *) usage_json="null" ;;
    esac
  fi
  local wall_json="null"
  [ -n "${DISPATCH_STARTED_EPOCH:-}" ] && wall_json="$(( $(date +%s) - DISPATCH_STARTED_EPOCH ))"
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  local strict_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    strict_fields=", \"unit_id\": $strict_unit_json, \"contract_sha256\": $strict_contract_sha_json, \"spec_sha256\": $strict_spec_sha_json, \"go\": $strict_go_json"
  fi
  local strict_boundary_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ] && [ "$1" = "committed" ] && [ "${STRICT_POSTCHECK_OK:-0}" -eq 1 ]; then
    strict_boundary_fields=', "boundary": "ok", "acceptance": "ok"'
  fi
  # ADDITIVE identity_drift — only when the rail detected a mutation (clean runs omit the key).
  local identity_fields=""
  if [ "${IDENTITY_DRIFT:-0}" -eq 1 ]; then
    identity_fields=', "identity_drift": true'
  fi
  printf '{ "status": "%s", "runner": "%s", "model": "%s", "containment": "%s", "contained": %s, "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s, "skill_mode_effective": "%s", "skills_injected": %s, "orphan_worktree": %s, "run_id": %s, "usage": %s, "wall_secs": %s, "duplex": %s%s%s%s }\n' \
    "$1" "$runner" "$(_flat_json_escape "$MODEL")" "$CONTAINMENT" "$contained_json" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(_flat_json_escape "${LOG:-}")" "$err_json" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$orphan_json" \
    "$run_id_json" "$usage_json" "$wall_json" "$duplex_json" "$strict_fields" "$strict_boundary_fields" "$identity_fields"
}

check_session_mode_gate() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker level consumed_repo normalized_repo
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -n "$consumed_repo" ] || return 0
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  for marker in "$marker_dir"/*.json; do
    [ -f "$marker" ] || continue
    if level="$(node -e 'const fs = require("fs"); const path = require("path"); const file = process.argv[1]; const root = path.resolve(process.argv[2] || ""); const now = Date.now(); try { const data = JSON.parse(fs.readFileSync(file, "utf8")); if (!data || typeof data !== "object") process.exit(1); if (data.level !== "l5" && data.level !== "l6") process.exit(1); if (!data.expires_at) process.exit(1); const exp = Date.parse(data.expires_at); if (!Number.isFinite(exp) || exp <= now) process.exit(1); if (path.resolve(String(data.repo_root || "")) !== root) process.exit(1); process.stdout.write(String(data.level || "")); process.exit(0); } catch (e) { process.exit(1); }' "$marker" "$normalized_repo")"; then
      die_precondition "active session-mode=$level blocks non-strict dispatch (repo=$consumed_repo)"
    fi
  done
}

run_strict_contract_preflight() {
  local contract_check_out="" contract_check_json=""
  local verdict strict_model strict_runner contract_base contract_wall_seconds checker_reasons
  local normalized_timeout caller_timeout
  local tmp_json
  local rc

  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] || die_precondition "--strict-contract requires --contract-file"
  [ -r "$CONTRACT_FILE" ] || die_precondition "contract file not readable: $CONTRACT_FILE"

  CONSUMING_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$CONSUMING_REPO_ROOT" ] || die_precondition "not inside a git repository"

  contract_check_out="$(node "$SELF_DIR/dispatch-contract.js" check --contract "$CONTRACT_FILE" --repo "$CONSUMING_REPO_ROOT" --json 2>&1)"
  rc=$?

  contract_check_json="$(printf '%s' "$contract_check_out" | extract_last_json)"
  if [ "$rc" -ne 0 ] || [ -z "$contract_check_json" ]; then
    checker_reasons="$(extract_json_value "$contract_check_json" reasons 2>/dev/null || true)"
    if [ -z "$checker_reasons" ]; then
      checker_reasons="$(printf '%s' "$contract_check_out" | tr '\n' ' ')"
    fi
    [ -n "$checker_reasons" ] || checker_reasons="contract check failed"
    die_precondition "contract checker failed: $checker_reasons"
  fi

  verdict="$(extract_json_value "$contract_check_json" verdict 2>/dev/null || true)"
  [ "$verdict" = "GO" ] || die_precondition "contract checker verdict is $verdict"

  STRICT_CONTRACT_RESULT_FIELDS=1
  STRICT_UNIT_ID="$(extract_json_value "$contract_check_json" unit_id 2>/dev/null || true)"
  STRICT_CONTRACT_SHA="$(extract_json_value "$contract_check_json" contract_sha256 2>/dev/null || true)"
  STRICT_SPEC_SHA="$(extract_json_value "$contract_check_json" spec_sha256 2>/dev/null || true)"
  strict_model="$(extract_json_value "$contract_check_json" resolved_engine.model 2>/dev/null || true)"
  strict_runner="$(extract_json_value "$contract_check_json" resolved_engine.runner 2>/dev/null || true)"
  STRICT_GO="$verdict"

  [ -n "$STRICT_UNIT_ID" ] || die_precondition "contract checker returned empty unit_id"
  [ -n "$STRICT_CONTRACT_SHA" ] || die_precondition "contract checker returned empty contract_sha256"
  [ -n "$STRICT_SPEC_SHA" ] || die_precondition "contract checker returned empty spec_sha256"
  [ -n "$strict_model" ] || die_precondition "contract checker returned empty resolved_engine.model"
  [ -n "$strict_runner" ] || die_precondition "contract checker returned empty resolved_engine.runner"

  contract_base="$(extract_file_json_value "$CONTRACT_FILE" "base_sha" 2>/dev/null || true)"
  [ -n "$contract_base" ] || die_precondition "contract missing base_sha"
  contract_wall_seconds="$(extract_file_json_value "$CONTRACT_FILE" "budget.wall_seconds" 2>/dev/null || true)"
  [ -n "$contract_wall_seconds" ] || die_precondition "contract missing budget.wall_seconds"
  STRICT_SCOPE_MAX_FILES="$(extract_file_json_value "$CONTRACT_FILE" "scope.max_files" 2>/dev/null || true)"
  [ -n "$STRICT_SCOPE_MAX_FILES" ] || die_precondition "contract missing scope.max_files"
  STRICT_SCOPE_MAX_DIFF_LINES="$(extract_file_json_value "$CONTRACT_FILE" "scope.max_diff_lines" 2>/dev/null || true)"
  [ -n "$STRICT_SCOPE_MAX_DIFF_LINES" ] || die_precondition "contract missing scope.max_diff_lines"

  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_ALLOW_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.allow_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_DENY_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.deny_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "scope.generated_mirrors.allow_paths")
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_OUTPUT_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "output.paths")
  unset __strict_path
  [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -gt 0 ] || die_precondition "contract missing scope.allow_paths"

  if [ "$BASE_SUPPLIED" -eq 0 ]; then
    BASE="$contract_base"
  elif [ "$BASE" != "$contract_base" ]; then
    die_precondition "caller --base ($BASE) disagrees with contract base_sha ($contract_base)"
  fi

  if [ "$MODEL_SUPPLIED" -eq 0 ]; then
    MODEL="$strict_model"
  elif [ "$MODEL" != "$strict_model" ]; then
    die_precondition "caller --model ($MODEL) disagrees with checker resolved_engine.model ($strict_model)"
  fi
  if [ "$RUNNER_SUPPLIED" -eq 0 ]; then
    RUNNER="$strict_runner"
  elif [ "$RUNNER" != "$strict_runner" ]; then
    die_precondition "caller --runner ($RUNNER) disagrees with checker resolved_engine.runner ($strict_runner)"
  fi

  if [ "$TIMEOUT_SUPPLIED" -eq 0 ]; then
    TIMEOUT="${contract_wall_seconds}s"
  else
    normalized_timeout="$(normalize_timeout_seconds "$TIMEOUT" 2>/dev/null || true)"
    [ -n "$normalized_timeout" ] || die_precondition "invalid --timeout value: $TIMEOUT"
    if [ "$normalized_timeout" -ne "$contract_wall_seconds" ]; then
      die_precondition "caller --timeout ($TIMEOUT) disagrees with contract budget.wall_seconds (${contract_wall_seconds}s)"
    fi
  fi
}

die_precondition() {
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s", "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "duplex": %s }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$1")" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$run_id_json" "$duplex_json"
  exit 2
}

# write_manifest [pid] — (re)write the run manifest atomically. Best-effort: ANY failure
# is swallowed (the manifest is a telemetry sidecar, never a dispatch dependency).
# Called at three points: pre-dispatch (parent pid), detached-child start (child pid —
# the parent pid dies with a killed caller while the child lives on), and finalize.
write_manifest() {
  [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" = "0" ] && return 0
  [ -n "${DISPATCH_RUN_ID:-}" ] || return 0
  { mkdir -p "$MANIFEST_DIR_PATH"; } 2>/dev/null || return 0
  [ -n "${1:-}" ] && MANIFEST_PID_RECORDED="$1"
  local safe_id; safe_id="$(printf '%s' "$DISPATCH_RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
  MANIFEST_FILE="$MANIFEST_DIR_PATH/${safe_id}.manifest.json"
  local tmp="$MANIFEST_FILE.tmp.$$"
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  # log_format = dispatcher-DECLARED stream format (see emit(): codex chrome text /
  # grok --output-format json / agy+cc-shim plain). dispatch-status.js trusts this
  # over content sniffing so worker output can never self-report telemetry.
  local log_format="plain"
  [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
  [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
  [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  local scope_json="null"; [ -n "${MANIFEST_SCOPE_UNIT:-}" ] && scope_json="\"$(_flat_json_escape "$MANIFEST_SCOPE_UNIT")\""
  local ledger_json="null"; [ -n "${LEDGER:-}" ] && ledger_json="\"$(_flat_json_escape "$LEDGER")\""
  local stage_json="null"; [ -n "${STAGE:-}" ] && stage_json="\"$(_flat_json_escape "$STAGE")\""
  local pid_json="null"; [ -n "${MANIFEST_PID_RECORDED:-}" ] && pid_json="$MANIFEST_PID_RECORDED"
  local ended_json="null" endep_json="null" final_json="null"
  [ -n "${MANIFEST_ENDED_AT:-}" ] && ended_json="\"$MANIFEST_ENDED_AT\""
  [ -n "${MANIFEST_ENDED_EPOCH:-}" ] && endep_json="$MANIFEST_ENDED_EPOCH"
  [ -n "${MANIFEST_FINAL_STATUS:-}" ] && final_json="\"$(_flat_json_escape "$MANIFEST_FINAL_STATUS")\""
  local parent_json="null"; [ -n "${LINEAGE_PARENT:-}" ] && parent_json="\"$(_flat_json_escape "$LINEAGE_PARENT")\""
  local root_json="null"; [ -n "${LINEAGE_ROOT:-}" ] && root_json="\"$(_flat_json_escape "$LINEAGE_ROOT")\""
  local depth_json="${LINEAGE_DEPTH:-0}"; case "$depth_json" in *[!0-9]*|"") depth_json=0 ;; esac; depth_json=$((10#$depth_json))
  local strict_manifest_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ]; then
    strict_manifest_fields=", \"unit_id\": \"$(_flat_json_escape "$STRICT_UNIT_ID")\", \"contract_sha256\": \"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\", \"go\": \"$(_flat_json_escape "$STRICT_GO")\""
  fi
  {
    printf '{ "schema": 1, "run_id": "%s", "role": "implementer", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "base_sha": "%s", "worktree": "%s", "lock_path": "%s", "log_path": "%s", "log_format": "%s", "duplex": %s, "aux_log": null, "pid": %s, "scope_unit": %s, "containment_planned": "%s", "started_at": "%s", "started_epoch": %s, "prompt_file": "%s", "ledger": %s, "stage": %s, "ended_at": %s, "ended_epoch": %s, "final_status": %s, "parent_run_id": %s, "root_run_id": %s, "depth": %s%s }\n' \
      "$(_flat_json_escape "$DISPATCH_RUN_ID")" "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
      "${BASE_SHA:-}" "$(_flat_json_escape "${WT:-}")" "$(_flat_json_escape "${WT:-}/.autopilot-worktree.lock")" "$(_flat_json_escape "${LOG:-}")" \
      "$log_format" "$duplex_json" "$pid_json" "$scope_json" "${MANIFEST_CONTAINMENT:-plain}" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DISPATCH_STARTED_EPOCH:-null}" "$(_flat_json_escape "${PROMPT_FILE:-}")" \
      "$ledger_json" "$stage_json" "$ended_json" "$endep_json" "$final_json" "$parent_json" "$root_json" "$depth_json" "$strict_manifest_fields" > "$tmp"
  } 2>/dev/null && mv -f "$tmp" "$MANIFEST_FILE" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 0; }
  return 0
}

# manifest_finalize <final-status> — stamp ended_at/final_status so dispatch-status.js
# reports phase:"exited" even after all processes/locks are gone. Best-effort.
manifest_finalize() {
  [ -n "${MANIFEST_FILE:-}" ] || return 0
  MANIFEST_FINAL_STATUS="${1:-}"
  MANIFEST_ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  MANIFEST_ENDED_EPOCH="$(date +%s)"
  write_manifest
}

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; MODEL_SUPPLIED=1; shift 2 ;;
    --runner) RUNNER="${2:-}"; RUNNER_SUPPLIED=1; shift 2 ;;
    --effort) EFFORT="${2:-}"; shift 2 ;;
    --context-window) CONTEXT_WINDOW_GATE="${2:-}"; shift 2 ;;
    --endpoint) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--endpoint requires a non-empty value"; ENDPOINT="$2"; shift 2 ;;
    --base) BASE="${2:-}"; BASE_SUPPLIED=1; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; TIMEOUT_SUPPLIED=1; shift 2 ;;
    --agy-bin) AGY_BIN="${2:-}"; shift 2 ;;
    --grok-bin) GROK_BIN="${2:-}"; shift 2 ;;
    --pi-bin) PI_BIN="${2:-}"; shift 2 ;;
    --codex-bin) CODEX_BIN="${2:-}"; shift 2 ;;
    --qoder-bin) QODER_BIN="${2:-}"; shift 2 ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --skill-mode) SKILL_MODE="${2:-}"; shift 2 ;;
    --skill) SKILLS+=("${2:-}"); shift 2 ;;
    --store) export ENGINE_CAPABILITY_DIR="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    --gc) DO_GC=1; shift ;;
    --reap-unmarked) REAP_UNMARKED=1; shift ;;
    --yes) GC_YES=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die_precondition "unknown argument: $1" ;;
  esac
done

# --- --gc subcommand (standalone stale reaper; no dispatch) ---
if [ "$DO_GC" -ne 1 ] && { [ "$REAP_UNMARKED" -eq 1 ] || [ "$GC_YES" -eq 1 ]; }; then
  die_precondition "--reap-unmarked/--yes are --gc flags; pass --gc"
fi
if [ "$DO_GC" -eq 1 ]; then
  if [ "$REAP_UNMARKED" -eq 1 ] && [ "$GC_YES" -ne 1 ]; then
    echo "error: --reap-unmarked requires --yes (recovery escape hatch)" >&2
    exit 2
  fi
  # Export flags for gc_stale_worktrees (reads REAP_UNMARKED).
  export REAP_UNMARKED GC_YES
  rewrite_orphan_log || { echo "error: orphan-log rewrite failed; original preserved" >&2; exit 2; }
  gc_stale_worktrees
  exit $?
fi

# Run identity for the observability manifest: reuse the ledger --run-id when supplied
# (one id across ledger + manifest + final JSON), else generate a unique one. Set BEFORE
# preconditions so even a precondition_failed JSON carries a correlatable run_id.
DISPATCH_STARTED_EPOCH="$(date +%s)"
if [ -n "$RUN_ID" ]; then
  DISPATCH_RUN_ID="$RUN_ID"
else
  DISPATCH_RUN_ID="hetero-${DISPATCH_STARTED_EPOCH}-$$-$(head -c2 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID:-}"
LINEAGE_ROOT=""
LINEAGE_DEPTH=0
if [ -n "${AUTOPILOT_PARENT_RUN_ID:-}" ]; then
  LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID}"
  LINEAGE_ROOT="${AUTOPILOT_ROOT_RUN_ID:-$LINEAGE_PARENT}"
  LINEAGE_DEPTH="${AUTOPILOT_DISPATCH_DEPTH:-1}"
  case "$LINEAGE_DEPTH" in *[!0-9]*|"") LINEAGE_DEPTH=1 ;; esac
else
  LINEAGE_ROOT="$DISPATCH_RUN_ID"
  LINEAGE_DEPTH=0
fi
# Sanitize inherited lineage ids (a hostile/odd env value with control chars would
# corrupt the manifest JSON — readers then skip the whole file: telemetry blackout)
# and force base-10 depth ("08"/"09" pass the digits-only case but are octal-invalid
# in $((...)), freezing the child depth un-incremented).
[ -n "$LINEAGE_PARENT" ] && LINEAGE_PARENT="$(printf '%s' "$LINEAGE_PARENT" | tr -c 'A-Za-z0-9._-' '-')"
[ -n "$LINEAGE_ROOT" ] && LINEAGE_ROOT="$(printf '%s' "$LINEAGE_ROOT" | tr -c 'A-Za-z0-9._-' '-')"
LINEAGE_DEPTH=$((10#$LINEAGE_DEPTH))
export AUTOPILOT_PARENT_RUN_ID="$DISPATCH_RUN_ID"
export AUTOPILOT_ROOT_RUN_ID="$LINEAGE_ROOT"
export AUTOPILOT_DISPATCH_DEPTH="$(( LINEAGE_DEPTH + 1 ))"

set_runner_flags() {
  # Runner selection. Explicit --runner wins; `auto` detects codex from the model
  # name. The OLD bug: only `*gpt-5.5*` matched, so other codex models
  # (gpt-5.3-codex-spark, gpt-5.x-codex, …) silently fell through to the agy branch
  # — which on this repo writes its plugin install copy (no_op + false self-report,
  # memory: agy-writes-install-dir). Match the codex FAMILY, not one string.
  IS_CODEX=0
  IS_GROK=0
  IS_CCSHIM=0
  IS_PI=0
  IS_QODER=0
  case "$RUNNER" in
    codex)   IS_CODEX=1 ;;
    agy)     ;;
    grok)    IS_GROK=1 ;;
    cc-shim) IS_CCSHIM=1 ;;   # EXPLICIT only (never auto) — it needs ANTHROPIC_BASE_URL set
    pi)      IS_PI=1 ;;        # EXPLICIT only (never auto) — it requires v0.80.6 + models.json
    qoderclicn) IS_QODER=1 ;;  # Qoder CLI CN (Qwen); honors -w/--cwd + edit-only (grok-shaped rail)
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
      elif [[ "$model_lc" == *qwen* || "$model_lc" == *qwq* ]]; then
        IS_QODER=1
      fi
      ;;
    *) die_precondition "--runner must be one of auto|codex|agy|grok|cc-shim|pi|qoderclicn (got: $RUNNER)" ;;
  esac
}

case "$EFFORT" in
  low|medium|high|xhigh|max) ;;
  *) die_precondition "--effort must be one of low|medium|high|xhigh|max (got: $EFFORT)" ;;
esac

case "$SKILL_MODE" in
  off|prompt|native|auto) ;;
  *) die_precondition "--skill-mode must be one of off|prompt|native|auto (got: $SKILL_MODE)" ;;
esac

# --- preconditions (exit 2, nothing created) ---
[ -n "$BRANCH" ] || die_precondition "--branch is required"
[ -n "$PROMPT_FILE" ] || die_precondition "--prompt-file is required"
[ -r "$PROMPT_FILE" ] || die_precondition "prompt file not readable: $PROMPT_FILE"
[ "$STRICT_CONTRACT" -eq 1 ] && [ "$CONTRACT_FILE_SUPPLIED" -eq 0 ] && die_precondition "--contract-file requires --strict-contract"
[ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] && [ "$STRICT_CONTRACT" -eq 0 ] && die_precondition "--strict-contract requires --contract-file"

if [ "$STRICT_CONTRACT" -eq 1 ]; then
  run_strict_contract_preflight
else
  check_session_mode_gate
fi
set_runner_flags

if [ "${#SKILLS[@]}" -gt 0 ]; then
  for skill in "${SKILLS[@]}"; do
    skill_no_ns="${skill#autopilot:}"
    # The charset below permits '.' so it must NOT stand alone as '.' or '..': those are
    # path segments that escape the skills/<name>/ boundary (skills/.. resolves to repo root)
    # even though '/' is blocked. Reject them explicitly. (gpt-5.5 P6 F3)
    if [[ ! "$skill_no_ns" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$skill_no_ns" == "." ]] || [[ "$skill_no_ns" == ".." ]]; then
      die_precondition "invalid skill name: $skill"
    fi
  done
fi


# --- optional --endpoint: resolve named-endpoint creds into the cc-shim env (ADDITIVE).
# When absent, every existing caller is byte-identical (raw ANTHROPIC_BASE_URL/
# ANTHROPIC_AUTH_TOKEN env still used). resolve-endpoint.sh emits only the token's env
# NAME; we read the value via ${!name} in-script (set +x so it can't leak) and export it. ---
if [ -n "$ENDPOINT" ]; then
  [ "$IS_CCSHIM" -eq 1 ] || die_precondition "--endpoint applies only to --runner cc-shim (got runner: $RUNNER)"
  # Readiness is the resolver's EXIT CODE (0=ready), NOT a grep of stdout — matching a
  # "ready":true substring could be spoofed by attacker-controlled field content, and the
  # exit code is the resolver's authoritative fail-closed signal (gpt-5.5 R5).
  _ep_json="$("$SELF_DIR/resolve-endpoint.sh" "$ENDPOINT" 2>/dev/null)"; _ep_rc=$?
  [ "$_ep_rc" -eq 0 ] || die_precondition "--endpoint '$ENDPOINT' not ready: $(printf '%s' "$_ep_json" | sed -n 's/.*\("missing":\[[^]]*\]\).*/\1/p')"
  _ep_url="$(printf '%s' "$_ep_json" | sed -n 's/.*"base_url":"\([^"]*\)".*/\1/p')"
  _ep_tokenv="$(printf '%s' "$_ep_json" | sed -n 's/.*"token_env":"\([^"]*\)".*/\1/p')"
  # fail closed if extraction yielded nothing — never silently fall through to ambient env (R6)
  { [ -n "$_ep_url" ] && [ -n "$_ep_tokenv" ]; } || die_precondition "--endpoint '$ENDPOINT' resolved an empty base_url/token_env"
  set +x
  export ANTHROPIC_BASE_URL="$_ep_url"
  export ANTHROPIC_AUTH_TOKEN="${!_ep_tokenv-}"
  unset _ep_json _ep_url _ep_tokenv
fi
# Heads-up on stderr ONLY (stdout carries the JSON contract): the implementer run below can
# take many minutes. Under Claude Code's Bash tool the 120s default timeout will SIGTERM it
# (exit 143). Raise BASH_DEFAULT_TIMEOUT_MS (~/.claude/settings.json env) or pass a high
# per-call timeout. Silence with DISPATCH_QUIET=1.
[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: ${RUNNER}/${MODEL} (effort=${EFFORT}) may run for MANY minutes — ensure a high Bash-tool timeout (BASH_DEFAULT_TIMEOUT_MS); the 120s default SIGTERMs long runs." >&2

if [ "$IS_CODEX" -eq 1 ]; then
  # A path-form --codex-bin (contains /) is feature-detected here in the CALLER cwd but
  # exec'd by the worker AFTER `cd "$WT"` — a RELATIVE path would resolve to a different
  # binary (or fail) inside the worktree. Absolutize it first (POSIX cd/pwd, not realpath)
  # so both resolve the SAME binary. A bare command name (no /) PATH-resolves consistently
  # since the worker inherits the same PATH (gpt-5.5 review).
  case "$CODEX_BIN" in
    */*)
      # Resolve the dir into a var and validate it — inlining `$(cd .. && pwd)/$(basename)`
      # would let a FAILED cd (empty pwd) silently yield `/<basename>` because the `||` sees
      # basename's (successful) exit, not cd's, and could then exec an unintended /codex (gpt-5.5 R2).
      _cb_dir="$(cd "$(dirname "$CODEX_BIN")" 2>/dev/null && pwd)" || true
      [ -n "$_cb_dir" ] || die_precondition "--codex-bin path not resolvable: $CODEX_BIN"
      CODEX_BIN="$_cb_dir/$(basename "$CODEX_BIN")"
      ;;
  esac
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die_precondition "codex binary not found: $CODEX_BIN (install OpenAI Codex, ensure it is in PATH, or pass --codex-bin)"
  # Feature-detect the flag the worker uses. A STALE codex earlier in PATH (e.g. an old
  # npm-global codex in an nvm node's bin, ahead of ~/.local/bin) lacks
  # --dangerously-bypass-hook-trust; without this check it would exit 2 mid-run with a
  # cryptic "unexpected argument" and get MISCLASSIFIED as question_suspected. Fail loud
  # here instead, naming the resolved path + version so the caller fixes PATH / --codex-bin.
  if ! "$CODEX_BIN" exec --help 2>&1 | grep -q -- '--dangerously-bypass-hook-trust'; then
    _cx_path="$(command -v "$CODEX_BIN")"; _cx_ver="$("$CODEX_BIN" --version 2>&1 | head -1)"
    die_precondition "resolved codex ($_cx_path, $_cx_ver) does not support --dangerously-bypass-hook-trust — it is too old / the wrong binary. Update it, fix PATH so the newer codex wins, or pass --codex-bin <path>."
  fi
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
elif [ "$IS_PI" -eq 1 ]; then
  command -v node >/dev/null 2>&1 || die_precondition "node not found (pi runner requires Node for the RPC supervisor)"
  command -v "$PI_BIN" >/dev/null 2>&1 || die_precondition "pi binary not found: $PI_BIN"
  [ -r "$SELF_DIR/lib/pi-rpc-run.js" ] || die_precondition "pi supervisor not found: $SELF_DIR/lib/pi-rpc-run.js"
  _pi_models_json="${PI_MODELS_JSON:-$HOME/.pi/agent/models.json}"
  [ -r "$_pi_models_json" ] || die_precondition "pi models.json not readable: $_pi_models_json"
elif [ "$IS_GROK" -eq 1 ]; then
  command -v "$GROK_BIN" >/dev/null 2>&1 || die_precondition "grok binary not found: $GROK_BIN (install xAI Grok Build CLI or pass --grok-bin)"
elif [ "$IS_QODER" -eq 1 ]; then
  command -v "$QODER_BIN" >/dev/null 2>&1 || die_precondition "qoder binary not found: $QODER_BIN (install Qoder CLI CN or pass --qoder-bin)"
else
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN (install Antigravity CLI or pass --agy-bin)"
fi

git rev-parse --git-dir >/dev/null 2>&1 || die_precondition "not inside a git repository"
git rev-parse --verify --quiet "$BASE" >/dev/null || die_precondition "base ref not found: $BASE"
if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  die_precondition "branch already exists: $BRANCH"
fi

# Resolve effective skill mode and build prompt-pack if requested
if [[ "$SKILL_MODE" != "off" ]]; then
  EFFECTIVE_SKILL_MODE="$SKILL_MODE"
  local_runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && local_runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && local_runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && local_runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && local_runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && local_runner="qoderclicn"

  if [[ "$SKILL_MODE" == "auto" ]]; then
    cap_state="$(node "$SELF_DIR/engine-capability-state.js" current --runner "$local_runner" --model "$MODEL" --role implementer 2>/dev/null)"
    is_native_supported_fresh="$(node -e '
      try {
        const data = JSON.parse(process.argv[1]);
        const st = data.capability.skill_transport;
        // Freshness MUST be judged on the native field OWN observation time, not the
        // aggregate observed_at (which follows the latest event of any field — a fresh
        // quota-only event would otherwise make a stale native signal look fresh). Missing
        // per-field timestamp ⇒ treat as not-fresh (fail-safe). (gpt-5.5 P6 F4)
        if (st.native === "supported" && st.native_observed_at) {
          const observed = Date.parse(st.native_observed_at);
          const now = Date.now();
          if (Number.isFinite(observed) && (now - observed) <= 86400 * 1000) {
            console.log("yes");
            process.exit(0);
          }
        }
      } catch (e) {}
      console.log("no");
    ' "$cap_state")"

    if [[ "$is_native_supported_fresh" == "yes" ]]; then
      EFFECTIVE_SKILL_MODE="native"
    elif [[ ${#SKILLS[@]} -gt 0 ]]; then
      EFFECTIVE_SKILL_MODE="prompt"
    else
      EFFECTIVE_SKILL_MODE="off"
    fi
  elif [[ "$SKILL_MODE" == "native" ]]; then
    cap_state="$(node "$SELF_DIR/engine-capability-state.js" current --runner "$local_runner" --model "$MODEL" --role implementer 2>/dev/null)"
    is_native_supported="$(node -e '
      try {
        const data = JSON.parse(process.argv[1]);
        if (data.capability.skill_transport.native === "supported") {
          console.log("yes");
          process.exit(0);
        }
      } catch (e) {}
      console.log("no");
    ' "$cap_state")"

    if [[ "$is_native_supported" != "yes" ]]; then
      die_precondition "Native skill transport is not supported for runner $local_runner model $MODEL"
    fi
  fi

  if [[ "$EFFECTIVE_SKILL_MODE" == "prompt" ]]; then
    if [[ ${#SKILLS[@]} -gt 0 ]]; then
      PACKED_PROMPT_TEMP="$(mktemp -t dispatch-hetero-packed-prompt-XXXXXX)"
      local_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
      SKILL_PACK_CONTENT_TEMP="$(mktemp -t dispatch-hetero-skill-pack-XXXXXX)"

      for skill in "${SKILLS[@]}"; do
        skill_no_ns="${skill#autopilot:}"
        skill_dir="$local_repo_root/skills/$skill_no_ns"
        if [ ! -d "$skill_dir" ]; then
          rm -f "$SKILL_PACK_CONTENT_TEMP"
          die_precondition "skill directory does not exist: skills/$skill_no_ns for skill: $skill"
        fi
        skill_file="$skill_dir/SKILL.md"
        if [ ! -f "$skill_file" ]; then
          rm -f "$SKILL_PACK_CONTENT_TEMP"
          die_precondition "skill file does not exist: skills/$skill_no_ns/SKILL.md for skill: $skill"
        fi
      done

      for skill in "${SKILLS[@]}"; do
        skill_no_ns="${skill#autopilot:}"
        skill_file="$local_repo_root/skills/$skill_no_ns/SKILL.md"
        printf '=== SKILL: %s ===\n' "$skill" >> "$SKILL_PACK_CONTENT_TEMP"
        cat "$skill_file" >> "$SKILL_PACK_CONTENT_TEMP"
        printf '\n=== END SKILL ===\n\n' >> "$SKILL_PACK_CONTENT_TEMP"
      done

      pack_size=$(wc -c < "$SKILL_PACK_CONTENT_TEMP" | tr -d ' ')
      SKILL_PACK_MAX_BYTES=60000
      if [ "$pack_size" -gt "$SKILL_PACK_MAX_BYTES" ]; then
        rm -f "$SKILL_PACK_CONTENT_TEMP"
        die_precondition "skill pack size ($pack_size bytes) exceeds budget of $SKILL_PACK_MAX_BYTES bytes"
      fi

      cat "$SKILL_PACK_CONTENT_TEMP" > "$PACKED_PROMPT_TEMP"
      cat "$PROMPT_FILE" >> "$PACKED_PROMPT_TEMP"
      rm -f "$SKILL_PACK_CONTENT_TEMP"

      PROMPT_FILE="$PACKED_PROMPT_TEMP"

      SKILLS_INJECTED_JSON="$(node -e '
        const skills = process.argv.slice(1);
        console.log(JSON.stringify(skills));
      ' "${SKILLS[@]}")"
    fi
  fi
else
  EFFECTIVE_SKILL_MODE="off"
fi

# --- context-window gate ---
# Placed AFTER skill-pack concatenation (the pack inflates PROMPT_FILE, and the engine
# pays for the packed size, not the original) and BEFORE the worktree exists, so an
# over-budget unit costs neither tokens nor a worktree to reap. This generalizes the
# skill-pack's own SKILL_PACK_MAX_BYTES check above from one input to the whole payload.
if declare -F context_window_gate > /dev/null 2>&1; then
  _CB_MODE="$(context_window_mode "${CONTEXT_WINDOW_GATE:-}")"
  if ! context_window_gate "$_CB_MODE" "$SELF_DIR" "$MODEL" "${PROMPT_FILE:-}"; then
    die_precondition "context budget exceeded: ${CONTEXT_WINDOW_REASON:-over budget}"
  fi
fi

# --- isolated worktree (the non-skippable safety rail) ---
WT="$(mktemp -u -d -t "hetero-${BRANCH//\//-}-XXXXXX")"  # -u: path only; git worktree add creates it
if ! git worktree add --quiet "$WT" -b "$BRANCH" "$BASE"; then
  # `git worktree add -b` creates the branch ref BEFORE the dir, so the ref leaks
  # even when dir creation fails (verified 2026-06-22). Reap it before bailing.
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  die_precondition "git worktree add failed"
fi
# Marker = --gc eligibility token (name-independent). Lifetime flock = liveness gate
# (kernel-released on process death incl. SIGKILL; no pid checks — plan §2a/§2c).
# Both names are registered in the COMMON git dir's info/exclude below: the wrapper
# commits with `git add -A`, so without the exclude both bookkeeping files would
# land in every dispatched commit, and `git status --porcelain` cleanliness checks
# would see them as untracked.
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "$BRANCH"
  printf 'schema=1\n'
} > "$WT/.autopilot-worktree"
# Hold exclusive lock on a dedicated fd for the whole dispatch life. Never close
# early; never exec-replace this shell (would release the lock silently).
# On lock failure, clean up the just-created worktree+branch before dying —
# die_precondition alone would leak them (panel round-2 finding).
_wt_lock_fail() {
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  die_precondition "$1"
}
_wt_open_lock_fd "$WT/.autopilot-worktree.lock" || _wt_lock_fail "cannot open worktree lifetime lock"
WT_LOCK_FD="$_WT_SAFE_LOCK_FD"
flock -x "$WT_LOCK_FD" || _wt_lock_fail "cannot acquire worktree lifetime lock"
# Keep bookkeeping files invisible to git status / git add -A inside the worktree.
# For linked worktrees, git reads info/exclude from the COMMON git dir (shared
# repo-wide). The per-worktree gitdir's info/exclude is ignored by git — a name
# written there still shows in git status. Append is idempotent because the common
# exclude is shared by the consuming repo and all its worktrees; repeated
# dispatches must not accumulate duplicate lines.
if ! {
  if _wt_common_dir="$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && [ -n "$_wt_common_dir" ]; then
    true
  else
    # Older git lacks --path-format=absolute; fall back and absolutize if relative.
    _wt_common_dir="$(git -C "$WT" rev-parse --git-common-dir)" &&
    case "$_wt_common_dir" in
      /*) true ;;
      *) _wt_common_dir="$(cd "$WT/$_wt_common_dir" && pwd)" ;;
    esac
  fi &&
  mkdir -p "$_wt_common_dir/info" &&
  _wt_exclude="$_wt_common_dir/info/exclude" &&
  for _wt_name in .autopilot-worktree .autopilot-worktree.lock; do
    grep -qxF "$_wt_name" "$_wt_exclude" 2>/dev/null || printf '%s\n' "$_wt_name" >> "$_wt_exclude"
  done
}; then
  echo "dispatch-hetero: WARNING — failed to register worktree bookkeeping files in git exclude (git status / git add -A may see them)" >&2
fi
unset _wt_common_dir _wt_exclude _wt_name
LOG="$(mktemp -t "hetero-${BRANCH//\//-}-log-XXXXXX")"
BASE_SHA="$(git rev-parse "$BASE")"

# Snapshot consuming-repo git identity BEFORE the runner (worktrees share .git/config;
# a bare `git config user.name` inside the worktree would silently rewrite the host repo).
# Capture host repo root once so emit() restore uses git -C (cwd-independent).
IDENTITY_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$IDENTITY_REPO_ROOT" ]; then
  # --local only: effective-scope reads would materialize a global identity as local on restore.
  IDENTITY_PRE_NAME="$(git -C "$IDENTITY_REPO_ROOT" config --local user.name 2>/dev/null || true)"
  IDENTITY_PRE_EMAIL="$(git -C "$IDENTITY_REPO_ROOT" config --local user.email 2>/dev/null || true)"
fi

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
# descendants. Trap it to reap the container first, then minimal worktree remove
# (no project hook — signal-safe) + branch -D (sole branch-delete site) + exit 2.
trap 'reap_container; [ -n "$GROK_PROMPT_FILE" ] && rm -f "$GROK_PROMPT_FILE"; [ -n "$CCSHIM_PROMPT_FILE" ] && rm -f "$CCSHIM_PROMPT_FILE"; [ -n "$QODER_PROMPT_FILE" ] && rm -f "$QODER_PROMPT_FILE"; [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"; reap_worktree_minimal "$WT"; git branch -D "$BRANCH" >/dev/null 2>&1; exit 2' INT TERM

# Build the worker command line, then run it inside the strongest available
# container. The command cd's into the worktree itself (we cannot rely on a
# subshell cwd surviving the container boundary).
run_worker() { # "$@" = argv of the worker; redirects to LOG; sets AGENT_EXIT + CONTAINMENT
  if [ "${IN_DETACHED_CHILD:-0}" -eq 1 ]; then
    # In the detached child we already ARE the surviving `setsid` session (created at launch),
    # so run the worker plainly IN-session — its descendants share our session and die/finish
    # with us; there is no nested container to reap on this path.
    CONTAINMENT="setsid"
    "$@" >"$LOG" 2>&1
    AGENT_EXIT=$?
    return 0
  fi
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

# --- the agent runner (its stdout/stderr go to LOG, never our stdout) ---
# Extracted verbatim into a function so BOTH the inline path and the detached child dispatch
# the SAME engine invocation with ZERO behavioral difference.
run_agent() {
if [ "$IS_CODEX" -eq 1 ]; then
  run_worker bash -c 'cd "$1" && exec "$5" exec --model "$2" \
      --dangerously-bypass-approvals-and-sandbox \
      --dangerously-bypass-hook-trust \
      -c "model_reasoning_effort=\"$3\"" < "$4"' _ "$WT" "$MODEL" "$EFFORT" "$PROMPT_FILE" "$CODEX_BIN"
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
  # grok (xAI Grok Build CLI; models grok-4.5 (ex-grok-build) / grok-composer-2.5-fast). Unlike agy,
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
elif [ "$IS_QODER" -eq 1 ]; then
  # qoder (Qoder CLI CN; gateway to Qwen3.8-Max-Preview / GLM-5.2 / DeepSeek-V4 / …).
  # Spike-verified 2026-07-24: qoderclicn `-p` HONORS -w/--cwd (edits land in the target
  # worktree, NOT an invented scratch project — so, unlike agy, NO absolute-path anchor is
  # needed) and is EDIT-ONLY (leaves edits uncommitted; HEAD stays at BASE). The wrapper
  # commits its edits below and the reviewer verifies — same robust rail as grok/agy.
  # --no-session-persistence stops the -p run persisting a resumable session; effort maps to
  # --reasoning-effort (qoder tolerates autopilot's low|medium|high|xhigh|max at the CLI
  # layer — an unhonored level degrades to default, never a hard fail).
  QODER_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

"
  # Feed the prompt via STDIN (qoder -p reads stdin — Spike-verified 2026-07-24), NOT a
  # positional argv arg: a large task prompt as one arg can hit ARG_MAX before qoder runs.
  # -w anchors edits at the real worktree (qoder honors --cwd, so no agy-style absolute
  # path anchor is needed). Same edit-only + wrapper-commit rail as grok.
  QODER_PROMPT_FILE="$(mktemp -t dispatch-hetero-qoder-prompt-XXXXXX)"
  printf '%s' "${QODER_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$QODER_PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec "$2" -p --model "$4" -w "$1" \
      --reasoning-effort "$5" --dangerously-skip-permissions --no-session-persistence < "$3"' \
      _ "$WT" "$QODER_BIN" "$QODER_PROMPT_FILE" "$MODEL" "$EFFORT"
  rm -f "$QODER_PROMPT_FILE"
elif [ "$IS_PI" -eq 1 ]; then
  # Directive channel (Phase 2): forward the R0 ledger coords to the supervisor so a
  # depth-0 `directive-send` actually DELIVERS mid-run on the production pi path (the
  # supervisor polls + steers + acks; it gates cleanly on absence). Gated on ALL three
  # coords — a partial set forwards nothing (supervisor would refuse anyway; keep the
  # no-coords invocation byte-identical to pre-Phase-2).
  if [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ]; then
    run_worker bash -c 'cd "$1" && exec node "$2" --pi-bin "$3" --provider "$4" --model "$5" --cwd "$1" --prompt-file "$6" --ledger "$7" --run-id "$8" --stage "$9"' _ "$WT" "$SELF_DIR/lib/pi-rpc-run.js" "$PI_BIN" "${PI_RPC_PROVIDER:-minimax}" "$MODEL" "$PROMPT_FILE" "$LEDGER" "$RUN_ID" "$STAGE"
  else
    run_worker bash -c 'cd "$1" && exec node "$2" --pi-bin "$3" --provider "$4" --model "$5" --cwd "$1" --prompt-file "$6"' _ "$WT" "$SELF_DIR/lib/pi-rpc-run.js" "$PI_BIN" "${PI_RPC_PROVIDER:-minimax}" "$MODEL" "$PROMPT_FILE"
  fi
else
  printf '%s\n' "dispatch-hetero: NOTE — agy/Gemini directory-targeting is now RELIABLE: the directive below PREPENDS an absolute-worktree anchor (agy -p ignores process cwd, so a relative-path prompt made it invent a scratch project = the old no_op; the anchor points its edits at the real worktree — verified single- and multi-file). agy stays EDIT-ONLY for a DIFFERENT reason: run_command foreground-caps at ~10s then AUTO-BACKGROUNDS longer commands and waits (empirically a 75s command DID complete and return stdout, bounded by --print-timeout — the old 'hard 10s cap / cannot run build/test' framing is REFUTED, agy 1.0.14 2026-07-02); what stays unreliable is chaining run-long-command THEN git-commit in ONE -p turn (the turn can yield after the backgrounded task). So agy edits, the wrapper commits, the reviewer verifies. For tasks where the agent itself must run build/test AND self-commit mid-flight, prefer --model gpt-5.5 (codex). See memory: agy-writes-install-dir (RESOLVED)." >&2
  # agy (Gemini) in -p print mode CANNOT reliably run a long command THEN commit in
  # one turn: run_command foreground-caps at ~10s and AUTO-BACKGROUNDS longer commands
  # (it DOES complete them and return stdout, bounded by --print-timeout — the '10s
  # wall / cannot run build/test' claim is REFUTED, agy 1.0.14 2026-07-02); but the
  # single print turn can yield ("you'll be notified, stop calling tools") after the
  # backgrounded task, before a follow-up commit runs → silent no_op/hallucination.
  # So we run agy EDIT-ONLY and the wrapper commits its edits below; verify by
  # artifact. (gotcha: agy-headless-dispatch-unreliable.)
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
}

compute_artifacts() {
# agy/grok/codex run edit-only → the wrapper makes the commit (deterministic). It fires
# whenever the worker left edits but did NOT move HEAD (HEAD==BASE && dirty), REGARDLESS of
# runner; if the worker already committed (HEAD moved) or left nothing, this is a no-op.
# Universal fallback (was IS_CODEX-excluded): some codex runs — e.g. gpt-5.3-codex-spark —
# leave edits uncommitted, esp. for net-new files (verified e2e 2026-06-30). Safe because it
# only fires when HEAD hasn't moved, so a self-committing codex run is never double-committed.
#
# --no-verify is MANDATORY: this wrapper commit is a mechanical artifact-CAPTURE of the
# edit-only worker's edits, NOT the quality gate (the contract puts verdict at depth 0 —
# the dispatching session reviews the branch diff before any merge). Running the TARGET
# repo's pre-commit hook here is both redundant and harmful: a hook that builds (e.g.
# codepower's `vue-tsc -b` on staged .ts/.vue) emits untracked artifacts that leave the
# tree dirty AND can `exit 1` to ABORT the commit — silently swallowing legitimately-correct
# edits as a false `dirty`/`no_op`. The edit-only path has no build-artifact cleanup, so it
# must not trigger the hook at all. (Root cause of the 2026-06-30 agy/cc-shim `status:dirty` runs.)
if [ "$(git -C "$WT" rev-parse HEAD)" = "$BASE_SHA" ] \
   && [ -n "$(git -C "$WT" status --porcelain)" ]; then
  _runner_label="agy"; [ "$IS_CODEX" -eq 1 ] && _runner_label="codex"; [ "$IS_GROK" -eq 1 ] && _runner_label="grok"; [ "$IS_CCSHIM" -eq 1 ] && _runner_label="cc-shim"; [ "$IS_PI" -eq 1 ] && _runner_label="pi"; [ "$IS_QODER" -eq 1 ] && _runner_label="qoderclicn"
  git -C "$WT" add -A
  _identity_args=()
  if ! git -C "$WT" var GIT_AUTHOR_IDENT >/dev/null 2>&1 \
     || ! git -C "$WT" var GIT_COMMITTER_IDENT >/dev/null 2>&1; then
    _identity_args=(-c user.email=autopilot@example.invalid -c user.name=Autopilot)
  fi
  git -C "$WT" -c commit.gpgsign=false "${_identity_args[@]}" commit --no-verify -q -m "dispatch-hetero($_runner_label): edits on $BRANCH" >/dev/null 2>&1
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
}

run_strict_acceptance_checks() {
  STRICT_POSTCHECK_ERROR=""
  STRICT_POSTCHECK_STATUS=""
  local acceptance_out acceptance_status index expected actual command err
  acceptance_out="$(node -e '
const fs = require("fs");
const cp = require("child_process");
const contractPath = process.argv[1];
const worktree = process.argv[2];
const logPath = process.argv[3];

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

let contract;
try {
  contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (e) {
  emit({ status: "acceptance_failed", error: "invalid contract json" });
  process.exit(1);
}

const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
if (!acceptance.length) {
  emit({ status: "acceptance_failed", error: "contract acceptance list is empty" });
  process.exit(1);
}

let logFd = null;
if (logPath) {
  try { logFd = fs.openSync(logPath, "a"); } catch (e) { logFd = null; }
}

const stdio = logFd !== null ? ["ignore", logFd, logFd] : ["ignore", "ignore", "ignore"];

for (let i = 0; i < acceptance.length; i++) {
  const entry = acceptance[i] || {};
  const argv = Array.isArray(entry.argv) ? entry.argv : [];
  const expected = Number(entry.exit);
  if (!Array.isArray(argv) || argv.length === 0) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv || []), expected: expected, actual: 1, error: "acceptance argv must be a non-empty array" });
    process.exit(1);
  }
  if (!Number.isInteger(expected) || expected < 0 || expected > 255) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: 1, error: "acceptance exit must be an integer 0..255" });
    process.exit(1);
  }

  let result;
  try {
    result = cp.spawnSync(argv[0], argv.slice(1), { cwd: worktree, stdio });
  } catch (err) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: 1, error: String(err && err.message ? err.message : err) });
    process.exit(1);
  }

  const actual = (typeof result.status === "number") ? result.status : (result.signal ? 128 : 1);
  if (actual !== expected) {
    if (logFd !== null) fs.closeSync(logFd);
    emit({ status: "acceptance_failed", index: i + 1, command: JSON.stringify(argv), expected: expected, actual: actual, error: "exit-code mismatch" });
    process.exit(1);
  }
}

if (logFd !== null) {
  fs.closeSync(logFd);
}
emit({ status: "ok" });
process.exit(0);
  ' "$CONTRACT_FILE" "$WT" "$LOG")"
  local acceptance_rc=$?
  acceptance_status="$(printf '%s' "$acceptance_out" | extract_json_value status 2>/dev/null || true)"
  if [ "$acceptance_rc" -ne 0 ] || [ "$acceptance_status" != "ok" ]; then
    index="$(printf '%s' "$acceptance_out" | extract_json_value index 2>/dev/null || true)"
    command="$(printf '%s' "$acceptance_out" | extract_json_value command 2>/dev/null || true)"
    expected="$(printf '%s' "$acceptance_out" | extract_json_value expected 2>/dev/null || true)"
    actual="$(printf '%s' "$acceptance_out" | extract_json_value actual 2>/dev/null || true)"
    err="$(printf '%s' "$acceptance_out" | extract_json_value error 2>/dev/null || true)"
    STRICT_POSTCHECK_STATUS="acceptance_failed"
    STRICT_POSTCHECK_ERROR="acceptance_failed"
    if [ -n "$command" ]; then
      STRICT_POSTCHECK_ERROR="acceptance_failed: command #${index:-?} $command (expected exit ${expected:-?}, got ${actual:-?})"
      [ -n "$err" ] && STRICT_POSTCHECK_ERROR="$STRICT_POSTCHECK_ERROR: $err"
    elif [ -n "$err" ]; then
      STRICT_POSTCHECK_ERROR="acceptance_failed: $err"
    fi
    return 1
  fi

  STRICT_POSTCHECK_STATUS="ok"
  return 0
}

run_strict_boundary_postcheck() {
  local allow_file deny_file boundary_out boundary_rc diff_total
  local -a changed_paths=()
  local -A changed_set=()
  local out_dir
  local temp_path
  local undeclared deny_hits

  if [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -eq 0 ] && [ "${#STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}" -eq 0 ]; then
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: missing scope allow paths"
    return 1
  fi

  allow_file="$(mktemp -t "hetero-strict-allow-XXXXXX")" || {
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate allow path temp file"
    return 1
  }
  for out_dir in "${STRICT_SCOPE_ALLOW_PATHS[@]}" "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
    [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$allow_file"
  done

  if [ "${#STRICT_SCOPE_DENY_PATHS[@]}" -gt 0 ]; then
    deny_file="$(mktemp -t "hetero-strict-deny-XXXXXX")" || {
      rm -f "$allow_file"
      STRICT_POSTCHECK_STATUS="boundary_rejected"
      STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate deny path temp file"
      return 1
    }
    for out_dir in "${STRICT_SCOPE_DENY_PATHS[@]}"; do
      [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$deny_file"
    done
  else
    deny_file=""
  fi

  if [ -n "$deny_file" ]; then
    if boundary_out="$( "$SELF_DIR/check-disjointness.sh" validate --range "$BASE_SHA..$HEAD_SHA" --repo "$WT" --no-default-deny --allow-file "$allow_file" --deny-file "$deny_file" 2>&1 )"; then
      boundary_rc=0
    else
      boundary_rc=$?
    fi
  else
    if boundary_out="$( "$SELF_DIR/check-disjointness.sh" validate --range "$BASE_SHA..$HEAD_SHA" --repo "$WT" --no-default-deny --allow-file "$allow_file" 2>&1 )"; then
      boundary_rc=0
    else
      boundary_rc=$?
    fi
  fi
  rm -f "$allow_file"
  [ -n "$deny_file" ] && rm -f "$deny_file"

  if [ "$boundary_rc" -ne 0 ]; then
    local undeclared_touches deny_hits_json
    undeclared_touches="$(printf '%s' "$boundary_out" | extract_json_value undeclared_touches 2>/dev/null || true)"
    deny_hits_json="$(printf '%s' "$boundary_out" | extract_json_value denylist_hits 2>/dev/null || true)"
    if [ -n "$deny_hits_json" ] && [ "$deny_hits_json" != "null" ]; then
      temp_path="$(printf '%s' "$deny_hits_json" | json_array_first)"
    elif [ -n "$undeclared_touches" ] && [ "$undeclared_touches" != "null" ]; then
      temp_path="$(printf '%s' "$undeclared_touches" | json_array_first)"
    else
      temp_path=""
    fi
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    if [ -n "$temp_path" ]; then
      STRICT_POSTCHECK_ERROR="boundary_rejected: changed path violates scope '${temp_path}'"
    else
      STRICT_POSTCHECK_ERROR="boundary_rejected: changed path violates scope (see diff below); ${boundary_out}"
    fi
    return 1
  fi

  # budget checks from shortstat to avoid re-parsing git output twice
  diff_total=$((INS + DEL))
  if [ "$FILES" -gt "$STRICT_SCOPE_MAX_FILES" ] || [ "$diff_total" -gt "$STRICT_SCOPE_MAX_DIFF_LINES" ]; then
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: budget exceeded (max_files=$STRICT_SCOPE_MAX_FILES, max_diff_lines=$STRICT_SCOPE_MAX_DIFF_LINES; files=$FILES, insertions+deletions=$diff_total)"
    return 1
  fi

  # output.paths must be a subset of changed files (exact paths, exact paths)
  while IFS= read -r temp_path; do
    [ -n "$temp_path" ] && changed_paths+=("$temp_path")
  done < <(git -C "$WT" diff --name-only "$BASE_SHA..$HEAD_SHA")

  for temp_path in "${changed_paths[@]}"; do
    changed_set["$temp_path"]=1
  done

  for out_dir in "${STRICT_OUTPUT_PATHS[@]}"; do
    if [ -z "${changed_set["$out_dir"]+x}" ]; then
      STRICT_POSTCHECK_STATUS="boundary_rejected"
      STRICT_POSTCHECK_ERROR="boundary_rejected: output path '$out_dir' missing from changed files"
      return 1
    fi
  done

  STRICT_POSTCHECK_STATUS="ok"
  return 0
}

run_strict_contract_postchecks() {
  STRICT_POSTCHECK_ERROR=""
  STRICT_POSTCHECK_STATUS=""
  STRICT_POSTCHECK_OK=0

  if ! run_strict_boundary_postcheck; then
    return 1
  fi

  if ! run_strict_acceptance_checks; then
    return 1
  fi

  if ! run_strict_boundary_postcheck; then
    return 1
  fi

  STRICT_POSTCHECK_STATUS="ok"
  STRICT_POSTCHECK_OK=1
  return 0
}

passive_capture() {
  local status="${1:-}"
  CLASSIFIED_ERROR=""
  if { [ "$status" = "no_op" ] || [ "$status" = "question_suspected" ] || [ "$status" = "failure" ] || [ "$status" = "dirty" ] || [ "$status" = "no_verdict" ]; } && [ -n "${LOG:-}" ] && [ -r "${LOG}" ]; then
    # Classify once, outside the recording subshell, so classify_outcome can reuse the result.
    CLASSIFIED_ERROR="$("$SELF_DIR/engine-capability-state.js" classify-error --file "$LOG" --exit-code "${AGENT_EXIT:-0}" 2>/dev/null)" || CLASSIFIED_ERROR=""
    (
      if [ "$CLASSIFIED_ERROR" = "quota_exhausted" ] || [ "$CLASSIFIED_ERROR" = "rate_limited" ]; then
        local quota_status="unknown" confidence="low"
        case "$CLASSIFIED_ERROR" in
          quota_exhausted) quota_status="exhausted"; confidence="high" ;;
          rate_limited)    quota_status="limited"; confidence="medium" ;;
        esac
        local runner="agy"
        [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
        [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
        [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
        [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
        [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
        local observed_at; observed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        local payload
        payload="$(OBSERVED_AT="$observed_at" RUNNER="$runner" MODEL="$MODEL" STATUS="$quota_status" CONFIDENCE="$confidence" node -e '
          const p = process.env;
          const payload = {
            schema_version: 1,
            observed_at: p.OBSERVED_AT,
            runner: p.RUNNER,
            model: p.MODEL,
            role: "implementer",
            runner_version: null,
            capability: {
              quota: {
                status: p.STATUS,
                reset_at: null,
                confidence: p.CONFIDENCE,
                evidence: "Passive capture from dispatch failure",
                ttl_seconds: 3600
              }
            }
          };
          console.log(JSON.stringify(payload));
        ')"
        local record_args=()
        if [ -n "${ENGINE_CAPABILITY_DIR:-}" ]; then
          record_args+=(--store "$ENGINE_CAPABILITY_DIR")
        fi
        echo "$payload" | node "$SELF_DIR/engine-capability-state.js" record "${record_args[@]}" >/dev/null 2>&1
      fi
    ) || true
  fi
}

# True when classify-error named a known engine-unavailability signal (not network/unknown).
_is_engine_unavailable() {
  case "${1:-}" in
    quota_exhausted|rate_limited|auth_failed|overloaded) return 0 ;;
    *) return 1 ;;
  esac
}

# classify_outcome — the SINGLE source of truth for status/exit/JSON-fields, shared by the
# inline path (→ emit to stdout + exit) and the detached child (→ write-result + ledger). It
# sets OUTCOME_* and performs the outcome-specific side effects (passive_capture; worktree
# removal on clean success) EXACTLY as the pre-R1 inline tree did — the existing hetero tests
# assert the resulting stdout/exit byte-for-byte, guarding this refactor.
classify_outcome() {
  OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"; OUTCOME_ERR=""; OUTCOME_EXIT=1
  if [ "$HEAD_SHA" != "$BASE_SHA" ]; then
    # --- a new commit exists ---
    if [ -n "$DIRTY" ]; then
      # committed but left the tree dirty → failure regardless of exit code
      passive_capture "dirty"
      OUTCOME_STATUS="dirty"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent committed but left uncommitted changes (agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
    elif [ "$AGENT_EXIT" -ne 0 ]; then
      # clean commit but the worker exited non-zero — NOT scored success (KR1):
      # the abnormal exit means the run can't be trusted as a clean implementation.
      # Prefer engine_unavailable when the log is a known quota/auth/overload signal.
      passive_capture "failure"
      OUTCOME_STATUS="failure"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent left a clean commit but exited non-zero (agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
      if _is_engine_unavailable "$CLASSIFIED_ERROR"; then
        OUTCOME_STATUS="engine_unavailable"
        OUTCOME_ERR="engine unavailable ($CLASSIFIED_ERROR): worker exited non-zero (agent exit $AGENT_EXIT); worktree kept"
      fi
    else
      if [ "$STRICT_CONTRACT" -eq 1 ] && ! run_strict_contract_postchecks; then
        # strict-mode post-return boundary and acceptance checks are authoritative.
        OUTCOME_STATUS="$STRICT_POSTCHECK_STATUS"
        OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"
        OUTCOME_ERR="$STRICT_POSTCHECK_ERROR"
        OUTCOME_EXIT=1
      else
        # new commit + clean tree + agent exit 0 → the only success path
        if [ "$KEEP" = "0" ]; then
          # Full reap (project teardown_hook + remove). NEVER branch -D here — the
          # branch survives for review/merge. On remove failure: loud WARN +
          # OUTCOME_ORPHAN set; exit code unchanged (D4).
          OUTCOME_ORPHAN=""
          reap_worktree "$WT"
        fi
        OUTCOME_STATUS="committed"; OUTCOME_COMMIT="$HEAD_SHA"; OUTCOME_FILES="$FILES"; OUTCOME_INS="$INS"; OUTCOME_DEL="$DEL"; OUTCOME_WT="$WT"; OUTCOME_ERR=""; OUTCOME_EXIT=0
      fi
    fi
  else
    # --- no new commit: split by HOW the worker ended ---
    if [ -n "$DIRTY" ]; then
      # edits exist but were never committed — e.g. the agy wrapper-commit above failed,
      # or the worker hand-edited without committing. Surface it (don't mis-score no_op).
      passive_capture "dirty"
      OUTCOME_STATUS="dirty"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="edits left uncommitted, no commit made (wrapper commit may have failed; agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
    elif [ "$AGENT_EXIT" -eq 0 ]; then
      # clean exit, nothing committed → agent legitimately decided nothing was needed
      passive_capture "no_op"
      OUTCOME_STATUS="no_op"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent exited cleanly with no commit — judged nothing was needed (agent exit 0); worktree kept"; OUTCOME_EXIT=1
    else
      # timeout or non-zero exit, nothing committed → likely paused on a clarifying
      # question (auto-approve does not silence the model's own question) or stalled.
      # Prefer engine_unavailable when the log is a known quota/auth/overload signal
      # (closes the "402 misclassified as question_suspected" gap).
      passive_capture "question_suspected"
      OUTCOME_STATUS="question_suspected"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="agent produced no commit and ended abnormally (agent exit $AGENT_EXIT) — likely paused on a clarifying question or stalled; worktree kept"; OUTCOME_EXIT=1
      if _is_engine_unavailable "$CLASSIFIED_ERROR"; then
        OUTCOME_STATUS="engine_unavailable"
        OUTCOME_ERR="engine unavailable ($CLASSIFIED_ERROR): worker exited non-zero (agent exit $AGENT_EXIT); worktree kept"
      fi
    fi
  fi
  # Observability: stamp the manifest so post-mortem status reads phase:"exited" with the
  # final status even after processes/locks are gone (both inline and detached paths).
  manifest_finalize "$OUTCOME_STATUS"
}

# ============================ R1 DETACH (setsid kill-survival) ============================
# heartbeat_loop — periodic liveness beat to the ledger, keyed to the detached child's lease
# (generation/nonce/pid). Immediate first beat, then every HEARTBEAT_SECS. Runs backgrounded
# inside the detached child and is killed once the worker completes.
heartbeat_loop() {
  local run_ledger="$SELF_DIR/run-ledger.sh"
  while :; do
    bash "$run_ledger" stage-heartbeat --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
      --generation "$DETACH_GEN" --nonce "$DETACH_NONCE" --pid "$DETACH_SELF_PID" >/dev/null 2>&1 || true
    sleep "${HEARTBEAT_SECS:-20}"
  done
}

# detached_main — runs INSIDE the setsid session (sourced state + functions via declare). It owns
# the full lifecycle so a killed caller loses nothing: acquire lease → heartbeat → run engine →
# wrapper-commit + verify → write outcome JSON atomically to RESULT_FILE → record committed stage.
detached_main() {
  set -uo pipefail
  IN_DETACHED_CHILD=1
  local run_ledger="$SELF_DIR/run-ledger.sh"
  # Keep the worktree in detach mode: it is the git-truth a `resume` uses to adopt the work,
  # and the orchestrator (not this leaf) owns its later cleanup.
  KEEP=1
  local packed_prompt_for_child="${PACKED_PROMPT_TEMP:-}"
  # Decouple from the caller's prompt temp lifecycle: copy it into a child-owned file so the
  # parent's EXIT cleanup cannot yank it mid-run.
  local child_prompt="$RESULTS_DIR/${RUN_ID}.${STAGE}.prompt"
  if cp -f "$PROMPT_FILE" "$child_prompt" 2>/dev/null; then PROMPT_FILE="$child_prompt"; fi
  # Acquire the lease AS THIS detached process (records our pid/start_time → the watchdog can
  # tell alive-vs-dead). --allow-reopen so an orchestrator pre-lease is renewed, not rejected.
  DETACH_SELF_PID="$$"
  # Rewrite the manifest with the DETACHED child's pid: the parent pid dies with a killed
  # caller while this session survives — the manifest must point liveness probes here.
  write_manifest "$DETACH_SELF_PID"
  local acq; acq="$(bash "$run_ledger" stage-acquire --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
    --pid "$DETACH_SELF_PID" --git-ref "refs/heads/$BRANCH" --worktree "$WT" --allow-reopen 2>/dev/null || true)"
  DETACH_GEN="$(printf '%s' "$acq" | jq -r '.generation // empty' 2>/dev/null || true)"
  DETACH_NONCE="$(printf '%s' "$acq" | jq -r '.nonce // empty' 2>/dev/null || true)"
  local hb_pid=""
  if [ -n "$DETACH_GEN" ] && [ -n "$DETACH_NONCE" ]; then
    heartbeat_loop &
    hb_pid=$!
  fi
  # run the engine worker (in-session), then finalize by artifact
  run_agent
  [ -n "$hb_pid" ] && { kill "$hb_pid" 2>/dev/null || true; wait "$hb_pid" 2>/dev/null || true; }
  compute_artifacts
  classify_outcome
  # Build the SAME outcome JSON the inline path would print, and land it atomically.
  local json; json="$(emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR")"
  local payload_tmp="$RESULT_FILE.payload.$$"
  printf '%s' "$json" > "$payload_tmp"
  bash "$run_ledger" write-result --path "$RESULT_FILE" --payload-file "$payload_tmp" >/dev/null 2>&1 || true
  rm -f "$payload_tmp"
  # exit-code sidecar (atomic) so the supervising parent relays the SAME exit code
  printf '%s' "$OUTCOME_EXIT" > "$EXIT_FILE.tmp.$$" && mv "$EXIT_FILE.tmp.$$" "$EXIT_FILE"
  # Record the committed stage so the work is recoverable via `run-ledger resume` (git-truth).
  if [ "$OUTCOME_STATUS" = "committed" ] && [ -n "$DETACH_GEN" ] && [ -n "$DETACH_NONCE" ]; then
    bash "$run_ledger" stage-transition --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
      --generation "$DETACH_GEN" --nonce "$DETACH_NONCE" --to-state committed \
      --git-sha "$OUTCOME_COMMIT" --worktree "$WT" >/dev/null 2>&1 || true
  fi
  rm -f "$child_prompt" 2>/dev/null || true
  [ -n "$packed_prompt_for_child" ] && rm -f "$packed_prompt_for_child" 2>/dev/null || true
  exit "$OUTCOME_EXIT"
}

# dispatch_detached_run — the PARENT side. Serializes state+functions, launches detached_main in a
# NEW SESSION (setsid) so a killed caller cannot take the worker down, then blocks-and-relays the
# SAME stdout JSON + exit code as the inline path (transparent normal case). NEVER returns.
dispatch_detached_run() {
  mkdir -p "$RESULTS_DIR"
  rm -f "$RESULT_FILE" "$EXIT_FILE"
  local state_file; state_file="$(mktemp -t hetero-detach-state-XXXXXX)"
  {
  declare -p MODEL BASE TIMEOUT AGY_BIN GROK_BIN CODEX_BIN QODER_BIN KEEP BRANCH PROMPT_FILE RUNNER EFFORT \
      SELF_DIR IS_CODEX IS_GROK IS_CCSHIM IS_PI IS_QODER PI_BIN CONTAINMENT CONTAINED IDENTITY_DRIFT IDENTITY_PRE_NAME IDENTITY_PRE_EMAIL IDENTITY_REPO_ROOT EFFECTIVE_SKILL_MODE SKILLS_INJECTED_JSON \
      WT LOG BASE_SHA HAVE_CGROUP HAVE_SETSID SCOPE_UNIT WORKER_SID GROK_PROMPT_FILE CCSHIM_PROMPT_FILE QODER_PROMPT_FILE \
      PACKED_PROMPT_TEMP LEDGER RUN_ID STAGE RESULTS_DIR RESULT_FILE EXIT_FILE HEARTBEAT_SECS \
      STRICT_CONTRACT STRICT_CONTRACT_RESULT_FIELDS STRICT_UNIT_ID STRICT_CONTRACT_SHA STRICT_SPEC_SHA STRICT_GO CONSUMING_REPO_ROOT CONTRACT_FILE_SUPPLIED CONTRACT_FILE \
      OUTCOME_STATUS OUTCOME_COMMIT OUTCOME_FILES OUTCOME_INS OUTCOME_DEL OUTCOME_WT OUTCOME_ERR OUTCOME_EXIT \
      CLASSIFIED_ERROR \
      ORPHAN_LOG OUTCOME_ORPHAN WT_LOCK_FD LINEAGE_PARENT LINEAGE_ROOT LINEAGE_DEPTH \
      STRICT_SCOPE_ALLOW_PATHS STRICT_SCOPE_DENY_PATHS STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS STRICT_SCOPE_MAX_FILES STRICT_SCOPE_MAX_DIFF_LINES STRICT_OUTPUT_PATHS STRICT_POSTCHECK_OK STRICT_POSTCHECK_STATUS STRICT_POSTCHECK_ERROR \
      DISPATCH_RUN_ID DISPATCH_STARTED_EPOCH MANIFEST_DIR_PATH MANIFEST_FILE MANIFEST_CONTAINMENT \
      MANIFEST_SCOPE_UNIT MANIFEST_PID_RECORDED MANIFEST_ENDED_AT MANIFEST_ENDED_EPOCH MANIFEST_FINAL_STATUS 2>/dev/null
    declare -p ENGINE_CAPABILITY_DIR 2>/dev/null || true
    declare -f json_escape _flat_json_escape emit reap_container run_worker run_agent compute_artifacts passive_capture \
      _is_engine_unavailable classify_outcome heartbeat_loop detached_main write_manifest manifest_finalize run_strict_contract_postchecks run_strict_acceptance_checks \
      reap_worktree reap_worktree_minimal _wt_append_orphan_path _wt_open_lock_fd _wt_ensure_config _wt_validate_path _wt_git_worktree_remove \
      _wt_has_control_chars _wt_resolve_repo_root _wt_read_marker_created_at _wt_json_escape _wt_is_live \
      gc_stale_worktrees 2>/dev/null || true
  } > "$state_file"
  # In detach mode the DETACHED child owns the worktree/branch lifecycle. A caller signal must
  # NOT reap the worktree out from under it — replace the reaping trap with a bare exit.
  trap 'exit 143' INT TERM
  # Prevent the top-level EXIT cleanup from deleting the prompt temp under a detached child.
  # The detached child now owns and removes this prompt copy.
  unset PACKED_PROMPT_TEMP
  # The child removes the state file right after sourcing (before the long run) so a caller-kill
  # of the parent — which skips the parent's own cleanup below — cannot leak it.
  setsid bash -c 'IN_DETACHED_CHILD=1; source "$1"; rm -f "$1"; detached_main' bash "$state_file" >/dev/null 2>&1 &
  local child=$!
  wait "$child"; local wait_rc=$?
  # Reaching here means the caller was NOT killed → relay the durable result transparently.
  local out_rc="$wait_rc"
  if [ -f "$EXIT_FILE" ]; then out_rc="$(cat "$EXIT_FILE" 2>/dev/null || echo "$wait_rc")"; fi
  if [ -f "$RESULT_FILE" ]; then
    cat "$RESULT_FILE"; printf '\n'
  else
    emit "failure" "" 0 0 0 "$WT" "detached worker produced no result file (run-id=$RUN_ID stage=$STAGE)"
    out_rc=1
  fi
  rm -f "$state_file"
  exit "$out_rc"
}

# ---- dispatch decision ----
# Detach is ON by default; DISPATCH_DETACH=0 (or false/no/off) forces the legacy inline path.
detach_on() {
  case "${DISPATCH_DETACH:-1}" in
    0|false|FALSE|no|NO|off|OFF|No|Off) return 1 ;;
    *) return 0 ;;
  esac
}
# --- observability manifest (pre-dispatch; predicted containment) ---
# Written BEFORE the worker starts so the run is locatable from second zero. The
# scope-unit prediction matches run_worker's inline naming ("hetero-<branch>-$$.scope");
# in detach mode the child runs in-session (setsid), no scope exists.
if detach_on && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ] && [ "${HAVE_SETSID:-0}" -eq 1 ]; then
  MANIFEST_CONTAINMENT="setsid-detached"
elif [ "$HAVE_CGROUP" -eq 1 ]; then
  MANIFEST_CONTAINMENT="cgroup"
  MANIFEST_SCOPE_UNIT="hetero-${BRANCH//\//-}-$$.scope"
elif [ "$HAVE_SETSID" -eq 1 ]; then
  MANIFEST_CONTAINMENT="setsid"
else
  MANIFEST_CONTAINMENT="plain"
fi
write_manifest "$$"
[ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: run_id=${DISPATCH_RUN_ID} manifest=${MANIFEST_FILE:-none} log=${LOG} (watch: scripts/dispatch-status.js --run ${DISPATCH_RUN_ID})" >&2
if detach_on && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ] && [ "${HAVE_SETSID:-0}" -eq 1 ]; then
  RESULTS_DIR="${LEDGER}.results"
  RESULT_FILE="$RESULTS_DIR/${RUN_ID}.${STAGE}.result.json"
  EXIT_FILE="$RESULTS_DIR/${RUN_ID}.${STAGE}.exit"
  dispatch_detached_run   # never returns
fi

# ---- inline path (DISPATCH_DETACH=0 OR no ledger coords): byte-identical to pre-R1 behavior ----
run_agent
[ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
trap - INT TERM
compute_artifacts
classify_outcome
emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR"
exit "$OUTCOME_EXIT"
