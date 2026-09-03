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
#       [--model gemini-flash-high]          # default (agy alias, resolved against the LIVE
#                                             # `agy models` inventory); names: `agy models` /
#                                             # `grok models`. Required for any non-agy runner.
#       [--runner auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode] # default auto: *gpt*/*codex*→codex,
#                                              #   *grok*/*composer*→grok, *qwen*/*qwq*→qoderclicn, else agy.
#                                              #   Explicit wins (don't rely on name luck).
#                                              #   grok models: grok-4.5 (ex-grok-build), grok-composer-2.5-fast
#                                              #   cc-shim (EXPLICIT only): Claude Code CLI
#                                              #   driving an Anthropic-compatible endpoint —
#                                              #   needs ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
#                                              #   in env (e.g. MiniMax-M3, GLM-*).
#                                              #   opencode (EXPLICIT only): OpenCode CLI
#                                              #   `opencode run` headless; --model is a
#                                              #   provider/model id from `opencode models`
#                                              #   (e.g. opencode-go/muse-spark-1.3-contributor).
#                                              #   pi (EXPLICIT only): pi coding agent over RPC
#                                              #   (duplex supervisor scripts/lib/pi-rpc-run.js;
#                                              #   provider default minimax via PI_RPC_PROVIDER).
#                                              #   cursor (EXPLICIT only, never auto — every cursor
#                                              #   model id contains grok/gpt/codex/claude, so
#                                              #   auto-selection cannot disambiguate vendor-hosted
#                                              #   from vendor-native): Cursor CLI (cursor-agent),
#                                              #   one OAuth login over ~60 models. --model names a
#                                              #   family alias (grok46|codex53) resolved by
#                                              #   lib/cursor-model.sh, or a full model id verbatim.
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
#       [--cursor-bin cursor-agent]            # alternate/pinned Cursor CLI (test seam)
#       [--opencode-bin opencode]              # alternate/pinned OpenCode CLI (test seam)
#       [--cursor-fast]                        # cursor: opt into the `-fast` model-id lane
#                                              #   (default non-fast). Runner-scoped: any other
#                                              #   --runner is a die_precondition, same posture as
#                                              #   --endpoint with a non-cc-shim runner. Also a
#                                              #   die_precondition together with a --model that
#                                              #   already names a full id (mapper bypassed there).
#       [--campaign-contract <path>]            # sealed ICC boundary, prepended to prompt
#       [--campaign-contract-sha256 <digest>]    # intake-bound digest for private snapshot
#       [--campaign-seal <path>]                # intake-validated seal, rechecked at leaf admission
#       [--strict-contract]                     # required together with --contract-file
#       [--contract-file <path>]                # required together with --strict-contract
#       [--conformance-intent <path>]           # REQUIRED when the contract carries
#                                               #   frozen_four_tuple: the round's declared
#                                               #   intent, gated pre-spawn by
#                                               #   check-blueprint-conformance.js preflight
#       [--keep-worktree]                      # keep worktree even on success
#       [--retain-owner <id> --retain-reason <text> --retain-until <epoch>]
#       [--reuse-worktree <absolute-path>]      # campaign repair: reuse an exact retained
#       [--expected-worktree-instance <sha256>] # required identity fence for retained reuse
#       [--resume-session <uuid>]               # Grok repair: resume the exact prior session
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
#     "runner": "codex"|"agy"|"grok"|"cc-shim"|"pi"|"qoderclicn"|"cursor"|"opencode", "model": "...",   # engine provenance (model = --model)
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

# Default is the agy *alias*, never a literal vendor id: agy_resolve_model_alias() resolves it
# against the live `agy models` inventory and fails closed when no tier match exists. A literal
# id rots silently — "Gemini 3.5 Flash (High)" outlived its own model and every --model-less
# dispatch died at the vendor. The alias is agy-only, so a non-agy runner without --model is
# refused rather than handed a Gemini id (see MODEL_IS_DEFAULT below).
MODEL="gemini-flash-high"
MODEL_IS_DEFAULT=1
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
MANAGED_CODEX_HOME="" # per-run child home: credentials only, never controller plugins/config
QODER_BIN="qoderclicn"  # Qoder CLI CN runner (Qwen3.8-Max-Preview etc.); test seam via --qoder-bin
CURSOR_BIN="cursor-agent"  # Cursor CLI runner; test seam via --cursor-bin
OPENCODE_BIN="opencode"    # OpenCode CLI runner (`opencode run`); test seam via --opencode-bin
KEEP=0
RETENTION_OWNER=""
RETENTION_REASON=""
RETENTION_REASON_SHA256=""
RETENTION_EXPIRES_AT=""
REUSE_WORKTREE=""
EXPECTED_WORKTREE_INSTANCE=""
RESUME_SESSION_ID=""
PROVIDER_SESSION_ID=""
PROVIDER_SESSION_REUSED=0
WORKTREE_REUSED=0
BRANCH=""
PROMPT_FILE=""
CONTINUATION_CHECKPOINT=""
CONTINUATION_DURABLE=""
CAMPAIGN_CONTRACT_FILE=""
CAMPAIGN_CONTRACT_SHA256=""
CAMPAIGN_SEAL_FILE=""
CAMPAIGN_CONTRACT_SNAPSHOT=""
CAMPAIGN_ID=""
MISSION_CAMPAIGN_ID=""
CAMPAIGN_MISSION_MODE=""
MISSION_NOOP_SHORT_CIRCUIT=0
MISSION_NOOP_RECEIPT_DIGEST=""
MISSION_NOOP_GRAPH_NODE=""
CAMPAIGN_STRICT_AUTHORITY=0
CAMPAIGN_PROJECTION_BOUND=0
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
RUNNER_RESOLVED=0     # 1 only after set_runner_flags completes; die_precondition uses this to
                       # distinguish "agy selected" from "resolution never happened" (FINDING 1)
IS_GROK=0
IS_CCSHIM=0           # claude-code CLI pointed at an arbitrary Anthropic-compatible endpoint
IS_PI=0
PI_BIN="pi"
GROK_PROMPT_FILE=""   # grok-only combined prompt temp; init early so the INT/TERM trap can reap it
CCSHIM_PROMPT_FILE="" # cc-shim combined prompt temp; same trap-reap rationale
QODER_PROMPT_FILE=""  # qoder combined prompt temp; init early so it is SET for the detach declare -p
CURSOR_PROMPT_FILE=""  # cursor combined prompt temp; init early so it is SET for the detach declare -p
OPENCODE_PROMPT_FILE=""  # opencode combined prompt temp; init early so it is SET for the detach declare -p
CURSOR_FAST=0          # --cursor-fast opt-in (default non-fast); runner-scoped, see usage above
SCAFFOLD_TIER_ARG="auto"      # --scaffold-tier auto|T0|T1|T2 (explicit may only ADD scaffolding)
SCAFFOLD_TIER_EFFECTIVE="off" # recorded in the run manifest
SCAFFOLD_PROMPT_FILE=""       # tier-envelope temp; init early for trap reap
AGY_ENVELOPE=""       # private native JSON stdout; never exposed as agent_log
AGY_STDERR=""         # private native stderr, copied to agent_log only on failure
AGY_PARSED=""         # validated derived {response,usage}; native envelope parsed once
AGY_USAGE_JSON="null"
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
CAMPAIGN_PROMPT_FILE=""
SKILL_PACK_CONTENT_TEMP=""
STRICT_CONTRACT=0
CONTRACT_FILE=""
CONTRACT_FILE_SUPPLIED=0
CONFORMANCE_INTENT_FILE=""
STRICT_CONTRACT_RESULT_FIELDS=0
STRICT_UNIT_ID=""
STRICT_CONTRACT_SHA=""
STRICT_SPEC_SHA=""
STRICT_GO=""
STRICT_ENGINE_ASSURANCE=""
STRICT_SCOPE_ALLOW_PATHS=()
STRICT_SCOPE_DENY_PATHS=()
STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS=()
STRICT_SCOPE_MAX_FILES=""
STRICT_SCOPE_MAX_DIFF_LINES=""
STRICT_OUTPUT_PATHS=()
STRICT_REQUIRED_CHANGE_PATHS=()
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
WT_BUDGET_LOCK_FD=""  # common-dir creation transaction lock (managed lineage only)
WT_PENDING_RECORD=""  # crash-recovery record published before git worktree add
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
DETACH_PRECLAIM_GEN=""
DETACH_PRECLAIM_NONCE=""
OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT=""; OUTCOME_ERR=""; OUTCOME_EXIT=1
OUTCOME_DISPATCHER_CALLED=1
OUTCOME_MODEL_CALLS=1
OUTCOME_MUTATION_ATTEMPTS=1
OUTCOME_GATE_ATTEMPTS=0
OUTCOME_RESOURCES_CREATED=0
OUTCOME_ZERO_DIFF_RECEIPT_DIGEST=""
CLASSIFIED_ERROR=""   # set by passive_capture (classify-error once per outcome); read by classify_outcome
# FINDING 6 fix (2026-08-22 review repair): AUTOPILOT_STRIKE_WRITER=off is a debug
# escape hatch that suppresses seat_strike_capture's write. Left silent, a suppressed
# strike is indistinguishable from "nothing was strike-eligible" — the exact
# "existing is not evidence it is running" failure family (CLAUDE.md /
# evidence-discipline.md §1). These two vars are set ONLY when a strike WOULD have
# been written and the hatch suppressed it; write_manifest emits them into the
# manifest sidecar (never into this script's own stdout/exit code) so a suppressed
# strike is visible in the run's artifacts. Empty/unset = not suppressed = no
# marker in the manifest at all (default-on behavior stays byte-identical).
STRIKE_WRITER_SUPPRESSED=""
STRIKE_WRITER_SUPPRESSED_SEAT=""
# shellcheck source=/dev/null
. "$SELF_DIR/lib/worktree-reap.sh"
# When dispatch_new claims a Work Order, terminal finalizer must fail closed (never swallow).
_CONT_WO_CLAIMED_ROOT=""
_CONT_WO_CLAIMED_STAGE="implement"
_CONT_WO_PARENT_TRANSFERRED=0
_cont_terminal_on_exit() {
  local _root="${_CONT_WO_CLAIMED_ROOT:-}"
  [ -n "$_root" ] || return 0
  local _status=failed
  # Prefer recorded outcome; committed/success only when outcome says so.
  if [ -n "${OUTCOME_STATUS:-}" ]; then
    case "$OUTCOME_STATUS" in
      success|ok|attached|consumed|committed) _status=success ;;
      *) _status=failed ;;
    esac
  elif [ "${OUTCOME_EXIT:-1}" = "0" ]; then
    _status=success
  fi
  local _term_out _term_st _term_rc _cwd
  _cwd="$(pwd 2>/dev/null || echo .)"
  _term_out="$(node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$_cwd" \
    --root-run-id "$_root" --graph-node "${_CONT_WO_CLAIMED_STAGE:-implement}" --attempt 1 \
    --owner-pid "$$" --runner self --terminal-status "$_status" --disposition consumed 2>/dev/null)" || {
    echo "dispatch-hetero: work order terminal finalizer failed closed for root=$_root" >&2
    return 1
  }
  _term_st="$(printf '%s' "$_term_out" | jq -r '.status // empty' 2>/dev/null || true)"
  if [ "$_term_st" = "written" ]; then return 0; fi
  _term_rc="$(printf '%s' "$_term_out" | jq -r '.reason_code // empty' 2>/dev/null || true)"
  if [ "$_term_st" = "reject" ] && [ "$_term_rc" = "not_found" ]; then return 0; fi
  echo "dispatch-hetero: work order terminal finalizer rejected: ${_term_rc:-$_term_st}" >&2
  return 1
}
# Inline/detached success path: finalize WO before emit; clear claim so EXIT does not re-run.
_cont_finalize_or_die() {
  [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ] || return 0
  if ! _cont_terminal_on_exit; then
    echo "dispatch-hetero: refusing success JSON with nonterminal work order" >&2
    return 1
  fi
  _CONT_WO_CLAIMED_ROOT=""
  return 0
}
cleanup() {
  trap - EXIT
  [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
  [ -n "${CAMPAIGN_PROMPT_FILE:-}" ] && rm -f "$CAMPAIGN_PROMPT_FILE"
  [ -n "${CAMPAIGN_CONTRACT_SNAPSHOT:-}" ] && rm -f "$CAMPAIGN_CONTRACT_SNAPSHOT"
  [ -n "${SKILL_PACK_CONTENT_TEMP:-}" ] && rm -f "$SKILL_PACK_CONTENT_TEMP"
  [ -n "${AGY_ENVELOPE:-}" ] && rm -f "$AGY_ENVELOPE"
  [ -n "${AGY_STDERR:-}" ] && rm -f "$AGY_STDERR"
  [ -n "${AGY_PARSED:-}" ] && rm -f "$AGY_PARSED"
  # Fail closed: claimed WO must get a terminal disposition; never swallow finalizer failures.
  # Parent that transferred claim to detached child must not mark WO failed on its EXIT.
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ] && [ "${_CONT_WO_PARENT_TRANSFERRED:-0}" != "1" ]; then
    if ! _cont_terminal_on_exit; then
      echo "dispatch-hetero: terminal finalizer failed closed on exit" >&2
      exit 1
    fi
    _CONT_WO_CLAIMED_ROOT=""
  fi
}
trap cleanup EXIT

usage() { sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; }

# shellcheck source=lib/json-emit.sh
. "$SELF_DIR/lib/json-emit.sh"
# shellcheck source=lib/grok-effort.sh
. "$SELF_DIR/lib/grok-effort.sh"
# shellcheck source=lib/cursor-model.sh
. "$SELF_DIR/lib/cursor-model.sh"
# shellcheck source=lib/agy-argv-ceiling.sh
# agy has no --prompt-file: the agy branch below passes the whole prompt as ONE argv string,
# which execve refuses over MAX_ARG_STRLEN before agy ever starts. Unconditional source (same
# hard-fail posture as the libs above) so the guard can never be silently absent.
. "$SELF_DIR/lib/agy-argv-ceiling.sh"
# shellcheck source=lib/agy-model-alias.sh
. "$SELF_DIR/lib/agy-model-alias.sh"

# agy_edit_only_directive <worktree> — the harness directive prepended to every agy task
# prompt. A FUNCTION, not an inline string, because the argv-ceiling guard has to measure the
# exact bytes that will be exec'd and it runs before the worktree exists; a second copy of
# this text would let the guard measure something the dispatch does not actually send.
agy_edit_only_directive() {
  local WT="$1"
  printf '%s' "=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
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
}

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
  local provider_session_json="null" provider_reused_json="false" worktree_reused_json="false"
  local retention_lease_json="null"
  [ -n "${2:-}" ] && commit_json="\"$2\""
  [ -n "${6:-}" ] && wt_json="\"$(_flat_json_escape "$6")\""
  [ -n "${7:-}" ] && err_json="\"$(_flat_json_escape "$7")\""
  [ -n "${OUTCOME_ORPHAN:-}" ] && orphan_json="\"$(_flat_json_escape "$OUTCOME_ORPHAN")\""
  [ -n "${PROVIDER_SESSION_ID:-}" ] \
    && provider_session_json="\"$(_flat_json_escape "$PROVIDER_SESSION_ID")\""
  [ "${PROVIDER_SESSION_REUSED:-0}" -eq 1 ] && provider_reused_json="true"
  [ "${WORKTREE_REUSED:-0}" -eq 1 ] && worktree_reused_json="true"
  if [ -n "${RETENTION_OWNER:-}" ] \
    && [[ "${RETENTION_REASON_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "${RETENTION_EXPIRES_AT:-}" =~ ^[1-9][0-9]*$ ]]; then
    retention_lease_json="$(printf \
      '{"owner":"%s","reason_sha256":"%s","expires_at":%s}' \
      "$(_flat_json_escape "$RETENTION_OWNER")" \
      "$RETENTION_REASON_SHA256" "$RETENTION_EXPIRES_AT")"
  fi
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
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
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
    # chrome text, grok = --output-format json, agy = response-only plain log with a
    # separately validated native envelope, cc-shim = plain) — never content-
    # sniffed, so a worker printing JSON/fake-chrome cannot self-report telemetry.
    # AGENT_EXIT==0 gate: on a clean exit the harness footer always owns the log tail,
    # so the parser's tail-anchored token read cannot be spoofed; on an abnormal exit
    # the tail is worker-controlled → usage stays null (honest, not fabricated).
    if [ "${IS_CODEX:-0}" -eq 0 ] && [ "${IS_GROK:-0}" -eq 0 ] \
       && [ "${IS_CCSHIM:-0}" -eq 0 ] && [ "${IS_PI:-0}" -eq 0 ] \
       && [ "${IS_QODER:-0}" -eq 0 ] && [ "${IS_CURSOR:-0}" -eq 0 ] \
       && [ "${IS_OPENCODE:-0}" -eq 0 ]; then
      usage_json="${AGY_USAGE_JSON:-null}"
    else
      local log_format="plain"
      [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
      [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
      [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
      [ "${IS_CURSOR:-0}" -eq 1 ] && log_format="jsonl"
      usage_json="$(node "$SELF_DIR/dispatch-status.js" --log "$LOG" --format "$log_format" --usage-only 2>/dev/null)" || usage_json="null"
    fi
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
    if [ -n "${STRICT_ENGINE_ASSURANCE:-}" ]; then
      strict_fields+=", \"engine_assurance\": \"$(_flat_json_escape "$STRICT_ENGINE_ASSURANCE")\""
    fi
  fi
  local campaign_fields=""
  if [ "${CAMPAIGN_PROJECTION_BOUND:-0}" -eq 1 ]; then
    campaign_fields=", \"campaign_contract_sha256\": \"$(_flat_json_escape "$CAMPAIGN_CONTRACT_SHA256")\", \"unit_contract_sha256\": \"$(_flat_json_escape "$STRICT_CONTRACT_SHA")\""
  fi
  local strict_boundary_fields=""
  if [ "${STRICT_CONTRACT_RESULT_FIELDS:-0}" -eq 1 ] && [ "$1" = "committed" ] && [ "${STRICT_POSTCHECK_OK:-0}" -eq 1 ]; then
    strict_boundary_fields=', "boundary": "ok", "acceptance": "ok"'
  fi
  # First-class boundary_rejected outcome: parseable reason + candidate ref, never
  # collapsed into unknown/mutation_failed. Possibly-effectful tips stay attached.
  local boundary_reject_fields=""
  if [ "$1" = "boundary_rejected" ]; then
    local boundary_reason_json="null" boundary_code_json="\"scope_or_budget_boundary\""
    local possibly_effectful_json="false"
    [ -n "${7:-}" ] && boundary_reason_json="\"$(_flat_json_escape "$7")\""
    [ -n "${2:-}" ] && possibly_effectful_json="true"
    case "${7:-}" in
      *'outside sealed output surface'*) boundary_code_json="\"unauthorized_output_path\"" ;;
      *'missing from changed files'*) boundary_code_json="\"required_output_missing\"" ;;
      *'violates scope'*) boundary_code_json="\"scope_violation\"" ;;
      *'budget exceeded'*) boundary_code_json="\"budget_exceeded\"" ;;
      *'missing scope allow'*) boundary_code_json="\"scope_misconfigured\"" ;;
    esac
    boundary_reject_fields="$(printf \
      ', "boundary": "rejected", "boundary_code": %s, "boundary_reason": %s, "candidate_ref": %s, "possibly_effectful": %s, "mutation_failed": false, "unknown_status": false' \
      "$boundary_code_json" "$boundary_reason_json" "$commit_json" "$possibly_effectful_json")"
  fi
  # ADDITIVE identity_drift — only when the rail detected a mutation (clean runs omit the key).
  local identity_fields=""
  if [ "${IDENTITY_DRIFT:-0}" -eq 1 ]; then
    identity_fields=', "identity_drift": true'
  fi
  local dispatcher_called_json="true" zero_diff_receipt_json="null"
  [ "${OUTCOME_DISPATCHER_CALLED:-1}" -eq 0 ] && dispatcher_called_json="false"
  if [[ "${OUTCOME_ZERO_DIFF_RECEIPT_DIGEST:-}" =~ ^[0-9a-f]{64}$ ]]; then
    zero_diff_receipt_json="\"$OUTCOME_ZERO_DIFF_RECEIPT_DIGEST\""
  fi
  printf '{ "status": "%s", "runner": "%s", "model": "%s", "containment": "%s", "contained": %s, "branch": "%s", "base": "%s", "commit": %s, "files_changed": %s, "insertions": %s, "deletions": %s, "worktree": %s, "agent_log": "%s", "error": %s, "dispatcher_called": %s, "model_calls": %s, "mutation_attempts": %s, "gate_attempts": %s, "resources_created": %s, "zero_diff_receipt_digest": %s, "skill_mode_effective": "%s", "skills_injected": %s, "orphan_worktree": %s, "run_id": %s, "usage": %s, "wall_secs": %s, "duplex": %s, "provider_session_id": %s, "provider_session_reused": %s, "worktree_reused": %s, "retention_lease": %s%s%s%s%s%s }\n' \
    "$1" "$runner" "$(_flat_json_escape "$MODEL")" "$CONTAINMENT" "$contained_json" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$commit_json" "${3:-0}" "${4:-0}" "${5:-0}" \
    "$wt_json" "$(_flat_json_escape "${LOG:-}")" "$err_json" \
    "$dispatcher_called_json" "${OUTCOME_MODEL_CALLS:-1}" \
    "${OUTCOME_MUTATION_ATTEMPTS:-1}" "${OUTCOME_GATE_ATTEMPTS:-0}" \
    "${OUTCOME_RESOURCES_CREATED:-0}" "$zero_diff_receipt_json" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$orphan_json" \
    "$run_id_json" "$usage_json" "$wall_json" "$duplex_json" \
    "$provider_session_json" "$provider_reused_json" "$worktree_reused_json" "$retention_lease_json" \
    "$strict_fields" "$campaign_fields" "$strict_boundary_fields" "$boundary_reject_fields" "$identity_fields"
}

check_session_mode_gate() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker marker_state marker_rc consumed_repo normalized_repo
  local markers
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -n "$consumed_repo" ] || return 0
  [ -r "$marker_dir" ] && [ -x "$marker_dir" ] \
    || die_precondition "authoritative session-mode marker directory is unreadable"
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  markers=("$marker_dir"/*.json)
  for marker in "${markers[@]}"; do
    if [ "$marker" = "$marker_dir/*.json" ] && [ ! -e "$marker" ]; then
      continue
    fi
    [ -f "$marker" ] \
      || die_precondition "authoritative session-mode marker is not a regular file: $marker"
    marker_state="$(
      node - "$marker" "$normalized_repo" <<'NODE' 2>&1
'use strict';
const fs = require('fs');
const path = require('path');
const [file, repo] = process.argv.slice(2);
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('marker must be an object');
  }
  if (!new Set(['l3', 'l4', 'l5', 'l6']).has(data.level)) {
    throw new TypeError('marker level is invalid');
  }
  if (typeof data.repo_root !== 'string' || !path.isAbsolute(data.repo_root)) {
    throw new TypeError('marker repo_root is invalid');
  }
  const startedAt = Date.parse(data.started_at);
  const expiresAt = Date.parse(data.expires_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw new TypeError('marker timestamps are invalid');
  }
  if (expiresAt <= Date.now()
      || path.resolve(data.repo_root) !== path.resolve(repo)
      || (data.level !== 'l5' && data.level !== 'l6')) {
    process.stdout.write('INACTIVE');
  } else {
    process.stdout.write(`ACTIVE:${data.level}`);
  }
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
    )"
    marker_rc=$?
    if [ "$marker_rc" -ne 0 ]; then
      die_precondition "authoritative session-mode marker is invalid: $marker_state"
    fi
    if [[ "$marker_state" == ACTIVE:* ]]; then
      die_precondition "active session-mode=${marker_state#ACTIVE:} requires a sealed campaign strict projection (repo=$consumed_repo)"
    fi
  done
}

run_strict_contract_preflight() {
  local contract_check_out="" contract_check_json=""
  local verdict strict_model strict_runner contract_base contract_wall_seconds checker_reasons
  local normalized_timeout caller_timeout
  local tmp_json
  local rc
  local -a contract_check_args

  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] || die_precondition "--strict-contract requires --contract-file"
  [ -r "$CONTRACT_FILE" ] || die_precondition "contract file not readable: $CONTRACT_FILE"

  CONSUMING_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$CONSUMING_REPO_ROOT" ] || die_precondition "not inside a git repository"

  contract_check_args=(
    check
    --contract "$CONTRACT_FILE"
    --repo "$CONSUMING_REPO_ROOT"
    --json
  )
  if [ -n "${AUTOPILOT_QUALIFICATION_OVERRIDE:-}" ]; then
    contract_check_args+=(--qualification-override "$AUTOPILOT_QUALIFICATION_OVERRIDE")
  fi
  contract_check_out="$(node "$SELF_DIR/dispatch-contract.js" "${contract_check_args[@]}" 2>&1)"
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

  # frozen_four_tuple conformance preflight (autonomous-brain P1, KR1): a frozen
  # contract REQUIRES a declared per-round intent, and the declared intent must
  # conform BEFORE any runner spawns. Contracts without the block are unchanged.
  __fft_probe="$(extract_file_json_value "$CONTRACT_FILE" "frozen_four_tuple.granularity_digest" 2>/dev/null || true)"
  if [ -n "$__fft_probe" ]; then
    [ -n "$CONFORMANCE_INTENT_FILE" ] \
      || die_precondition "contract carries frozen_four_tuple: --conformance-intent <file> is required"
    [ -r "$CONFORMANCE_INTENT_FILE" ] \
      || die_precondition "conformance intent file not readable: $CONFORMANCE_INTENT_FILE"
    if ! node "$SELF_DIR/check-blueprint-conformance.js" preflight \
        --contract "$CONTRACT_FILE" --intent "$CONFORMANCE_INTENT_FILE" \
        --repo "$CONSUMING_REPO_ROOT" >&2; then
      die_precondition "blueprint conformance preflight refused the declared intent"
    fi
  fi
  unset __fft_probe

  STRICT_CONTRACT_RESULT_FIELDS=1
  STRICT_UNIT_ID="$(extract_json_value "$contract_check_json" unit_id 2>/dev/null || true)"
  STRICT_CONTRACT_SHA="$(extract_json_value "$contract_check_json" contract_sha256 2>/dev/null || true)"
  STRICT_SPEC_SHA="$(extract_json_value "$contract_check_json" spec_sha256 2>/dev/null || true)"
  STRICT_ENGINE_ASSURANCE="$(extract_json_value "$contract_check_json" assurance 2>/dev/null || true)"
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
  while IFS= read -r __strict_path; do
    [ -n "$__strict_path" ] && STRICT_REQUIRED_CHANGE_PATHS+=("$__strict_path")
  done < <(read_contract_array_lines "$CONTRACT_FILE" "output.required_change_paths")
  unset __strict_path
  [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -gt 0 ] || die_precondition "contract missing scope.allow_paths"

  if [ "$BASE_SUPPLIED" -eq 0 ]; then
    BASE="$contract_base"
  elif [ "$BASE" != "$contract_base" ]; then
    die_precondition "caller --base ($BASE) disagrees with contract base_sha ($contract_base)"
  fi

  if [ "$MODEL_SUPPLIED" -eq 0 ]; then
    MODEL="$strict_model"
    MODEL_IS_DEFAULT=0   # the contract named it; the built-in default is no longer in play
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

run_campaign_contract_preflight() {
  local campaign_check_out="" campaign_check_json="" checker_reasons=""
  local verdict checked_digest rc

  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  CONSUMING_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$CONSUMING_REPO_ROOT" ] || die_precondition "not inside a git repository"

  campaign_check_out="$(
    node - "$SELF_DIR/implementation-campaign-check.js" \
      "$CAMPAIGN_CONTRACT_FILE" "$CAMPAIGN_SEAL_FILE" "$CONSUMING_REPO_ROOT" <<'NODE' 2>&1
'use strict';
const path = require('path');
const [checkerPath, contractPath, sealPath, repoPath] = process.argv.slice(2);
try {
  const { inspectSealedCampaignContract } = require(checkerPath);
  const result = inspectSealedCampaignContract({
    contractPath,
    sealPath,
    repoPath,
  });
  // Durable ICC identity is always campaign-v1 from raw contract bytes.
  // Seal campaign_id under mission-subject-v2 is Mission provenance only.
  let campaignId = null;
  let missionCampaignId = null;
  const strictAuthority = Boolean(
    result.contract
      && typeof result.contract === 'object'
      && result.contract.mission_runtime
      && result.contract.strict_dispatch,
  );
  if (result.ok === true) {
    const { campaignIdFor } = require(path.resolve(
      path.dirname(checkerPath),
      '..',
      'src',
      'engine',
      'implementation-campaign',
    ));
    campaignId = campaignIdFor(
      result.repo_identity,
      result.contract.ticket,
      result.contract_sha256,
    );
    if (result.identity_scheme === 'mission-subject-v2'
        && typeof result.campaign_id === 'string'
        && /^campaign-v2-[0-9a-f]{64}$/.test(result.campaign_id)) {
      missionCampaignId = result.campaign_id;
    }
  }
  process.stdout.write(`${JSON.stringify({
    verdict: result.verdict,
    contract_sha256: result.contract_sha256 || null,
    campaign_id: campaignId,
    mission_campaign_id: missionCampaignId,
    mission_mode: result.mission_mode || null,
    strict_authority: strictAuthority,
    reasons: result.errors || result.drift || [],
  })}\n`);
  process.exit(result.ok === true ? 0 : 3);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    verdict: 'REJECTED',
    contract_sha256: null,
    reasons: [error.message || String(error)],
  })}\n`);
  process.exit(3);
}
NODE
  )"
  rc=$?
  campaign_check_json="$(printf '%s' "$campaign_check_out" | extract_last_json)"
  if [ "$rc" -ne 0 ] || [ -z "$campaign_check_json" ]; then
    checker_reasons="$(extract_json_value "$campaign_check_json" reasons 2>/dev/null || true)"
    if [ -z "$checker_reasons" ]; then
      checker_reasons="$(printf '%s' "$campaign_check_out" | tr '\n' ' ')"
    fi
    [ -n "$checker_reasons" ] || checker_reasons="campaign contract check failed"
    die_precondition "campaign contract checker failed: $checker_reasons"
  fi

  verdict="$(extract_json_value "$campaign_check_json" verdict 2>/dev/null || true)"
  [ "$verdict" = "VALID" ] || die_precondition "campaign contract checker verdict is $verdict"
  checked_digest="$(extract_json_value "$campaign_check_json" contract_sha256 2>/dev/null || true)"
  [ "$checked_digest" = "$CAMPAIGN_CONTRACT_SHA256" ] \
    || die_precondition "campaign contract digest changed after intake"
  CAMPAIGN_ID="$(extract_json_value "$campaign_check_json" campaign_id 2>/dev/null || true)"
  MISSION_CAMPAIGN_ID="$(extract_json_value "$campaign_check_json" mission_campaign_id 2>/dev/null || true)"
  CAMPAIGN_MISSION_MODE="$(extract_json_value "$campaign_check_json" mission_mode 2>/dev/null || true)"
  [ "$(extract_json_value "$campaign_check_json" strict_authority 2>/dev/null || true)" = "true" ] \
    && CAMPAIGN_STRICT_AUTHORITY=1
  case "$CAMPAIGN_MISSION_MODE" in
    off|shadow|enforce) ;;
    *) die_precondition "campaign contract checker returned invalid mission mode" ;;
  esac
  # --run-id and lifecycle roots must match ICC v1 only.
  [[ "$CAMPAIGN_ID" =~ ^campaign-v1-[0-9a-f]{64}$ ]] \
    || die_precondition "campaign contract checker returned invalid ICC campaign identity"
  if [ -n "$MISSION_CAMPAIGN_ID" ] && [ "$MISSION_CAMPAIGN_ID" != "null" ]; then
    [[ "$MISSION_CAMPAIGN_ID" =~ ^campaign-v2-[0-9a-f]{64}$ ]] \
      || die_precondition "campaign contract checker returned invalid Mission campaign identity"
  else
    MISSION_CAMPAIGN_ID=""
  fi
}

run_campaign_projection_preflight() {
  local projection_out="" projection_rc=0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  if [ "$STRICT_CONTRACT" -ne 1 ]; then
    [ "$CAMPAIGN_STRICT_AUTHORITY" -ne 1 ] || \
      die_precondition "sealed strict campaign dispatch requires --strict-contract"
    return 0
  fi
  [ -n "$RUN_ID" ] || die_precondition "sealed campaign strict projection requires --run-id"
  [ -n "$STAGE" ] || die_precondition "sealed campaign strict projection requires --stage"
  [ "$RUN_ID" = "$CAMPAIGN_ID" ] \
    || die_precondition "caller --run-id disagrees with sealed campaign identity"
  projection_out="$(
    node - "$SELF_DIR/../src/engine/campaign-dispatch-projection.js" \
      "$CAMPAIGN_CONTRACT_FILE" "$CONTRACT_FILE" "$CAMPAIGN_CONTRACT_SHA256" \
      "$CAMPAIGN_ID" "$BRANCH" "$BASE" "$RUNNER" "$MODEL" "$STAGE" "$LINEAGE_ROOT" <<'NODE' 2>&1
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const [
  helperPath,
  campaignPath,
  unitPath,
  campaignContractSha256,
  campaignId,
  branch,
  base,
  runner,
  model,
  stage,
  rootRunId,
] = process.argv.slice(2);
try {
  const campaignBytes = fs.readFileSync(campaignPath);
  const actualCampaignDigest = crypto.createHash('sha256').update(campaignBytes).digest('hex');
  if (actualCampaignDigest !== campaignContractSha256) {
    throw new TypeError('campaign contract digest changed before projection');
  }
  const campaignContract = JSON.parse(campaignBytes.toString('utf8'));
  const unitContract = JSON.parse(fs.readFileSync(unitPath, 'utf8'));
  const { verifyCampaignDispatchUnit } = require(helperPath);
  verifyCampaignDispatchUnit({
    campaignContract,
    campaignContractSha256,
    campaignId,
    branch,
    base,
    runner,
    model,
    stage,
    rootRunId,
    unitContract,
    ...(unitContract
      && unitContract.output
      && unitContract.output.zero_diff_receipt
      ? { zeroDiffReceipt: unitContract.output.zero_diff_receipt } : {}),
  });
  process.stdout.write('BOUND\n');
} catch (error) {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(3);
}
NODE
  )" || projection_rc=$?
  if [ "$projection_rc" -ne 0 ] || [ "$projection_out" != "BOUND" ]; then
    projection_out="$(printf '%s' "$projection_out" | tr '\n' ' ')"
    [ -n "$projection_out" ] || projection_out="campaign dispatch projection check failed"
    die_precondition "campaign dispatch projection rejected: $projection_out"
  fi
  CAMPAIGN_PROJECTION_BOUND=1
}

# Marker → sealed campaign admission bridge (zero-runner under enforce mismatch).
# Active L5/L6 markers and L3 fallbacks whose entry_level is L4-L6 must carry the
# same repo/policy/graph digests as the sealed campaign mission_runtime. Caller
# flags and environment variables are never substitutes for sealed contract bytes
# or marker admission bytes.
check_marker_campaign_admission_bridge() {
  local marker_dir="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  local marker bridge_state bridge_rc consumed_repo normalized_repo
  local markers
  [ "$CAMPAIGN_PROJECTION_BOUND" -eq 1 ] || return 0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] || return 0
  [ "$marker_dir" != "/.autopilot/session-mode" ] || return 0
  [ -d "$marker_dir" ] || return 0
  [ -r "$marker_dir" ] && [ -x "$marker_dir" ] \
    || die_precondition "authoritative session-mode marker directory is unreadable"
  normalized_repo="$(cd "$consumed_repo" && pwd -P 2>/dev/null || echo "$consumed_repo")"
  markers=("$marker_dir"/*.json)
  for marker in "${markers[@]}"; do
    if [ "$marker" = "$marker_dir/*.json" ] && [ ! -e "$marker" ]; then
      continue
    fi
    [ -f "$marker" ] \
      || die_precondition "authoritative session-mode marker is not a regular file: $marker"
    bridge_state="$(
      node - "$marker" "$normalized_repo" "$CAMPAIGN_CONTRACT_FILE" \
        "$CAMPAIGN_MISSION_MODE" "$SELF_DIR/session-mode.js" <<'NODE' 2>&1
'use strict';
const fs = require('fs');
const path = require('path');
const [
  markerPath,
  repo,
  campaignPath,
  missionMode,
  sessionModePath,
] = process.argv.slice(2);
const managedLevels = new Set(['l5', 'l6']);
const fallbackEntryLevels = new Set(['l4', 'l5', 'l6']);
try {
  const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('marker must be an object');
  }
  if (!new Set(['l3', 'l4', 'l5', 'l6']).has(data.level)) {
    throw new TypeError('marker level is invalid');
  }
  if (typeof data.repo_root !== 'string' || !path.isAbsolute(data.repo_root)) {
    throw new TypeError('marker repo_root is invalid');
  }
  const startedAt = Date.parse(data.started_at);
  const expiresAt = Date.parse(data.expires_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw new TypeError('marker timestamps are invalid');
  }
  if (expiresAt <= Date.now()
      || path.resolve(data.repo_root) !== path.resolve(repo)) {
    process.stdout.write('INACTIVE');
    process.exit(0);
  }
  const isManaged = managedLevels.has(data.level)
    || (data.level === 'l3' && fallbackEntryLevels.has(data.entry_level));
  if (!isManaged) {
    process.stdout.write('INACTIVE');
    process.exit(0);
  }
  // off/shadow keep compatibility when authoritative policy permits it.
  if (missionMode === 'off' || missionMode === 'shadow') {
    process.stdout.write(`COMPAT:${missionMode}`);
    process.exit(0);
  }
  if (missionMode !== 'enforce') {
    throw new TypeError(`invalid mission mode for marker bridge: ${missionMode}`);
  }
  const campaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
  if (!campaign || typeof campaign !== 'object' || !campaign.mission_runtime) {
    throw new TypeError('sealed campaign is missing mission_runtime for marker bridge');
  }
  const expected = {
    repo_identity: campaign.repo_identity,
    mission_policy_digest: campaign.mission_runtime.mission_policy_digest,
    mission_graph_digest: campaign.mission_runtime.mission_graph_digest,
  };
  const { verifyMissionRoutingProjection } = require(sessionModePath);
  const verdict = verifyMissionRoutingProjection(data, expected);
  if (!verdict.valid) {
    throw new TypeError(verdict.reason || 'marker Mission admission does not match campaign');
  }
  const nodeId = campaign.mission_runtime.graph_node_id;
  const noOpSet = verdict.mission_noop;
  const adoption = noOpSet && noOpSet.noop_short_circuit === true
    ? noOpSet.noop_adoptions.find((item) => item.graph_node_id === nodeId)
    : null;
  if (adoption) {
    process.stdout.write(`NOOP:${nodeId}:${adoption.noop_receipt_digest}`);
  } else {
    process.stdout.write(`BOUND:${data.level}`);
  }
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}

NODE
    )"
    bridge_rc=$?
    if [ "$bridge_rc" -ne 0 ]; then
      die_precondition "marker-to-campaign admission bridge failed: $bridge_state"
    fi
    case "$bridge_state" in
      NOOP:*)
        _noop_payload="${bridge_state#NOOP:}"
        _noop_node="${_noop_payload%%:*}"
        _noop_digest="${_noop_payload#*:}"
        [[ "$_noop_digest" =~ ^[0-9a-f]{64}$ ]] \
          || die_precondition "marker Mission no-op receipt digest is invalid"
        if [ "$MISSION_NOOP_SHORT_CIRCUIT" -eq 1 ] \
            && { [ "$MISSION_NOOP_GRAPH_NODE" != "$_noop_node" ] \
              || [ "$MISSION_NOOP_RECEIPT_DIGEST" != "$_noop_digest" ]; }; then
          die_precondition "conflicting active Mission no-op marker authorities"
        fi
        MISSION_NOOP_SHORT_CIRCUIT=1
        MISSION_NOOP_GRAPH_NODE="$_noop_node"
        MISSION_NOOP_RECEIPT_DIGEST="$_noop_digest"
        ;;
    esac
  done
}

check_managed_dev_flow_admission() {
  local consumed_repo admission_out admission_rc
  [ "$CAMPAIGN_PROJECTION_BOUND" -eq 1 ] || return 0
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] || return 0
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] \
    || die_dev_flow_admission "session marker repository mismatch: no Git repository"
  admission_out="$(
    node - "$SELF_DIR/session-mode.js" "$consumed_repo" \
      "${AUTOPILOT_LEVEL:-}" "$CAMPAIGN_CONTRACT_FILE" <<'NODE' 2>&1
'use strict';
const [sessionModePath, repoRoot, effectiveLevel, campaignContract] = process.argv.slice(2);
try {
  const { validateManagedDevFlowAdmission } = require(sessionModePath);
  const result = validateManagedDevFlowAdmission({
    repoRoot,
    effectiveLevel: String(effectiveLevel || '').toLowerCase(),
    campaignContract,
  });
  if (!result.valid) {
    process.stdout.write(result.reason);
    process.exit(3);
  }
  process.stdout.write('READY');
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
  )"
  admission_rc=$?
  [ "$admission_rc" -eq 0 ] && [ "$admission_out" = "READY" ] \
    || die_dev_flow_admission "${admission_out:-session marker admission validation failed}"
}

check_mission_enforcement_gate() {
  local consumed_repo mission_mode mission_rc
  consumed_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$consumed_repo" ] || return 0
  if [ ! -e "$consumed_repo/.claude/owner-kernel-governance.json" ] \
      && [ ! -L "$consumed_repo/.claude/owner-kernel-governance.json" ]; then
    return 0
  fi
  mission_mode="$(
    node - "$SELF_DIR/implementation-campaign-check.js" "$consumed_repo" <<'NODE' 2>/dev/null
'use strict';
const [checkerPath, repo] = process.argv.slice(2);
try {
  const { projectMissionMode } = require(checkerPath);
  process.stdout.write(projectMissionMode(repo));
} catch (error) {
  process.stdout.write(error.message || String(error));
  process.exit(3);
}
NODE
  )"
  mission_rc=$?
  [ "$mission_rc" -eq 0 ] \
    || die_precondition "authoritative Mission governance is invalid: $mission_mode"
  case "$mission_mode" in
    off|shadow) ;;
    enforce)
      die_precondition "Mission enforce mode requires a sealed campaign strict projection"
      ;;
    *)
      die_precondition "authoritative Mission governance returned invalid mode: $mission_mode"
      ;;
  esac
}

die_precondition() {
  # agy is the DEFAULT rail — it has no IS_AGY flag, it is the else-case. So "no IS_*
  # set" is ambiguous between "agy was selected" and "resolution has not happened yet".
  # RUNNER_RESOLVED disambiguates: only trust the else-case "agy" once set_runner_flags
  # has actually completed (FINDING 1). Before that, emit the sentinel "unresolved" —
  # not "agy", not "auto" (the latter is also a valid --runner INPUT value, so a caller
  # who passed --runner grok and failed an early precondition must never see "auto" in
  # the output despite never saying it).
  local runner="unresolved"
  if [ "${RUNNER_RESOLVED:-0}" -eq 1 ]; then
    runner="agy"
    [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
    [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
    [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
    [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
    [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
    [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  fi
  local run_id_json="null"
  [ -n "${DISPATCH_RUN_ID:-}" ] && run_id_json="\"$(_flat_json_escape "$DISPATCH_RUN_ID")\""
  local duplex_json="null"
  [ "${IS_PI:-0}" -eq 1 ] && duplex_json="\"rpc\""
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "%s", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "duplex": %s, "retention_lease": null, "usage": null }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$1")" \
    "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" "$run_id_json" "$duplex_json"
  exit 2
}

die_dev_flow_admission() {
  printf '{ "status": "blocked", "phase": "dev_flow_admission", "rejection_code": "DEV_FLOW_ADMISSION_REQUIRED_OR_STALE", "reason": "%s", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "resources_created": 0 }\n' \
    "$(_flat_json_escape "$1")"
  exit 2
}

emit_mission_noop() {
  printf '{ "status": "no_op", "runner": "mission-admission", "model": null, "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "mission_noop": true, "graph_node_id": "%s", "noop_receipt_digest": "%s", "skill_mode_effective": "off", "skills_injected": [], "retention_lease": null }\n' \
    "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
    "$(_flat_json_escape "$MISSION_NOOP_GRAPH_NODE")" "$MISSION_NOOP_RECEIPT_DIGEST"
  exit 0
}

emit_sealed_zero_diff_if_authorized() {
  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  [ -n "${CONTRACT_FILE:-}" ] && [ -r "$CONTRACT_FILE" ] || return 0
  [ -z "${STRICT_NOOP_RECEIPT_PATH:-}" ] \
    || die_precondition "ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
  local repo base_sha result rc validator
  repo="${CONSUMING_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
  [ -n "$repo" ] || die_precondition "sealed zero-diff admission requires repository root"
  base_sha="$(git -C "$repo" rev-parse "${BASE}^{commit}" 2>/dev/null)" \
    || die_precondition "sealed zero-diff admission cannot resolve immutable base"
  # Single production sealed zero-diff validator (D2 A06) — shared with
  # dispatch-contract.js and campaign-dispatch-projection.js.
  validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
  if result="$(
    node "$validator" validate \
      --contract "$CONTRACT_FILE" \
      --repo "$repo" \
      --base "$base_sha" \
      --verify-bytes \
      ${MISSION_NOOP_RECEIPT_DIGEST:+--mission-noop-digest "$MISSION_NOOP_RECEIPT_DIGEST"} \
      ${MISSION_NOOP_GRAPH_NODE:+--mission-noop-node "$MISSION_NOOP_GRAPH_NODE"}
  )"; then
    printf '{ "status": "no_op", "runner": "sealed-zero-diff-admission", "model": null, "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": "%s", "skill_mode_effective": "off", "skills_injected": [], "retention_lease": null }\n' \
      "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" "$result"
    exit 0
  else
    rc=$?
  fi
  [ "$rc" -eq 3 ] && return 0
  die_precondition "sealed zero_diff_receipt rejected before effects: ${result:-verification_failed}"
}

die_resource_budget() {
  local count="$1" limit="$2"
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  printf '{ "status": "precondition_failed", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "commit": null, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": "resource_budget exhausted", "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0, "resources_created": 0, "zero_diff_receipt_digest": null, "resource_budget": { "resource": "leaf_worktrees", "root_run_id": "%s", "count": %s, "limit": %s }, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": "%s", "duplex": null, "usage": null }\n' \
    "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" \
    "$(_flat_json_escape "$BASE")" "$(_flat_json_escape "$WORKTREE_ROOT_RUN_ID")" \
    "$count" "$limit" "$EFFECTIVE_SKILL_MODE" "$SKILLS_INJECTED_JSON" \
    "$(_flat_json_escape "$DISPATCH_RUN_ID")"
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
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  # log_format = dispatcher-DECLARED stream format (see emit(): codex chrome text /
  # grok --output-format json / agy response-only plain log with a separate private
  # native envelope / cc-shim plain).
  # dispatch-status.js trusts this
  # over content sniffing so worker output can never self-report telemetry.
  local log_format="plain"
  [ "${IS_CODEX:-0}" -eq 1 ] && log_format="codex-chrome"
  [ "${IS_GROK:-0}" -eq 1 ] && log_format="jsonl"
  [ "${IS_PI:-0}" -eq 1 ] && log_format="pi-rpc"
  [ "${IS_CURSOR:-0}" -eq 1 ] && log_format="jsonl"
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
  # FINDING 6 fix: only present when seat_strike_capture actually suppressed a
  # would-have-fired strike under AUTOPILOT_STRIKE_WRITER=off — absent (not just
  # false) in the default-on case, so the field's mere presence is the signal.
  local strike_suppressed_fields=""
  if [ "${STRIKE_WRITER_SUPPRESSED:-}" = "1" ]; then
    strike_suppressed_fields=", \"strike_writer_suppressed\": true, \"strike_writer_suppressed_seat\": \"$(_flat_json_escape "$STRIKE_WRITER_SUPPRESSED_SEAT")\""
  fi
  {
    printf '{ "schema": 1, "run_id": "%s", "role": "implementer", "runner": "%s", "model": "%s", "branch": "%s", "base": "%s", "base_sha": "%s", "worktree": "%s", "lock_path": "%s", "log_path": "%s", "log_format": "%s", "duplex": %s, "aux_log": null, "pid": %s, "scope_unit": %s, "containment_planned": "%s", "started_at": "%s", "started_epoch": %s, "prompt_file": "%s", "scaffold_tier": "%s", "ledger": %s, "stage": %s, "ended_at": %s, "ended_epoch": %s, "final_status": %s, "parent_run_id": %s, "root_run_id": %s, "depth": %s%s%s }\n' \
      "$(_flat_json_escape "$DISPATCH_RUN_ID")" "$runner" "$(_flat_json_escape "$MODEL")" "$(_flat_json_escape "$BRANCH")" "$(_flat_json_escape "$BASE")" \
      "${BASE_SHA:-}" "$(_flat_json_escape "${WT:-}")" "$(_flat_json_escape "${WT:-}/.autopilot-worktree.lock")" "$(_flat_json_escape "${LOG:-}")" \
      "$log_format" "$duplex_json" "$pid_json" "$scope_json" "${MANIFEST_CONTAINMENT:-plain}" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DISPATCH_STARTED_EPOCH:-null}" "$(_flat_json_escape "${PROMPT_FILE:-}")" "${SCAFFOLD_TIER_EFFECTIVE:-off}" \
      "$ledger_json" "$stage_json" "$ended_json" "$endep_json" "$final_json" "$parent_json" "$root_json" "$depth_json" "$strict_manifest_fields" "$strike_suppressed_fields" > "$tmp"
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
    --scaffold-tier) SCAFFOLD_TIER_ARG="${2:-}"; shift 2 ;;
    --campaign-contract) CAMPAIGN_CONTRACT_FILE="${2:-}"; shift 2 ;;
    --campaign-contract-sha256) CAMPAIGN_CONTRACT_SHA256="${2:-}"; shift 2 ;;
    --campaign-seal) CAMPAIGN_SEAL_FILE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; MODEL_SUPPLIED=1; MODEL_IS_DEFAULT=0; shift 2 ;;
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
    --cursor-bin) CURSOR_BIN="${2:-}"; shift 2 ;;
    --opencode-bin) OPENCODE_BIN="${2:-}"; shift 2 ;;
    --cursor-fast) CURSOR_FAST=1; shift ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --conformance-intent) CONFORMANCE_INTENT_FILE="${2:-}"; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --retain-owner) RETENTION_OWNER="${2:-}"; shift 2 ;;
    --retain-reason) RETENTION_REASON="${2:-}"; shift 2 ;;
    --retain-until) RETENTION_EXPIRES_AT="${2:-}"; shift 2 ;;
    --reuse-worktree) REUSE_WORKTREE="${2:-}"; shift 2 ;;
    --expected-worktree-instance) EXPECTED_WORKTREE_INSTANCE="${2:-}"; shift 2 ;;
    --resume-session) RESUME_SESSION_ID="${2:-}"; shift 2 ;;
    --skill-mode) SKILL_MODE="${2:-}"; shift 2 ;;
    --skill) SKILLS+=("${2:-}"); shift 2 ;;
    --store) export ENGINE_CAPABILITY_DIR="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    --continuation-checkpoint) CONTINUATION_CHECKPOINT="${2:-}"; shift 2 ;;
    --continuation-durable) CONTINUATION_DURABLE="${2:-}"; shift 2 ;;
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
WORKTREE_ROOT_RUN_ID=""
LINEAGE_DEPTH=0
if [ -n "${AUTOPILOT_PARENT_RUN_ID:-}" ]; then
  LINEAGE_PARENT="${AUTOPILOT_PARENT_RUN_ID}"
  LINEAGE_ROOT="${AUTOPILOT_ROOT_RUN_ID:-$LINEAGE_PARENT}"
  LINEAGE_DEPTH="${AUTOPILOT_DISPATCH_DEPTH:-1}"
  case "$LINEAGE_DEPTH" in *[!0-9]*|"") LINEAGE_DEPTH=1 ;; esac
  if [ "${#LINEAGE_DEPTH}" -gt 7 ]; then
    LINEAGE_DEPTH=1
  elif [ "$((10#$LINEAGE_DEPTH))" -eq 0 ] \
      || [ "$((10#$LINEAGE_DEPTH))" -gt 1000000 ]; then
    LINEAGE_DEPTH=1
  fi
else
  # NOTE: AUTOPILOT_ROOT_RUN_ID is deliberately NOT read here. Without a parent
  # there is no lineage to attach to, so this dispatch becomes its own lineage
  # root. That does not discard the variable: the continuation/rehydration
  # resolver below still honours it (see `_cont_root`), which is how a dispatch
  # re-attaches to an existing root after compaction — exercised by
  # hooks/tests/codex-compaction-rehydration.test.sh with ROOT set and no PARENT.
  # ⇒ Do NOT "fail closed" on root-without-parent; that rejects a supported
  # configuration. (Tried 2026-07-31; it broke 8 assertions in that test.)
  # The sealed-campaign rail is the case that needs BOTH — see
  # references/hetero-dispatch.md § Trace lineage contract.
  LINEAGE_ROOT="$DISPATCH_RUN_ID"
  LINEAGE_DEPTH=0
fi
# Sanitize inherited lineage ids (a hostile/odd env value with control chars would
# corrupt the manifest JSON — readers then skip the whole file: telemetry blackout)
# and force base-10 depth ("08"/"09" pass the digits-only case but are octal-invalid
# in $((...)), freezing the child depth un-incremented).
[ -n "$LINEAGE_PARENT" ] && LINEAGE_PARENT="$(printf '%s' "$LINEAGE_PARENT" | tr -c 'A-Za-z0-9._-' '-')"
[ -n "$LINEAGE_ROOT" ] && LINEAGE_ROOT="$(printf '%s' "$LINEAGE_ROOT" | tr -c 'A-Za-z0-9._-' '-')"
INHERITED_WORKTREE_ROOT_RUN_ID="${AUTOPILOT_WORKTREE_ROOT_RUN_ID:-}"
WORKTREE_MANAGED=0
if [ -n "$INHERITED_WORKTREE_ROOT_RUN_ID" ]; then
  [[ "$INHERITED_WORKTREE_ROOT_RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die_precondition "AUTOPILOT_WORKTREE_ROOT_RUN_ID must match [A-Za-z0-9._-]+"
  WORKTREE_ROOT_RUN_ID="$INHERITED_WORKTREE_ROOT_RUN_ID"
  WORKTREE_MANAGED=1
else
  WORKTREE_ROOT_RUN_ID="$LINEAGE_ROOT"
  [ -n "$WORKTREE_ROOT_RUN_ID" ] \
    && WORKTREE_ROOT_RUN_ID="$(
      printf '%s' "$WORKTREE_ROOT_RUN_ID" | tr -c 'A-Za-z0-9._-' '-'
    )"
fi
LINEAGE_DEPTH=$((10#$LINEAGE_DEPTH))
export AUTOPILOT_PARENT_RUN_ID="$DISPATCH_RUN_ID"
export AUTOPILOT_ROOT_RUN_ID="$LINEAGE_ROOT"
if [ "$WORKTREE_MANAGED" -eq 1 ]; then
  export AUTOPILOT_WORKTREE_ROOT_RUN_ID="$WORKTREE_ROOT_RUN_ID"
else
  export AUTOPILOT_WORKTREE_ROOT_RUN_ID=""
fi
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
  IS_CURSOR=0
  IS_OPENCODE=0
  case "$RUNNER" in
    codex)   IS_CODEX=1 ;;
    agy)     ;;
    grok)    IS_GROK=1 ;;
    cc-shim) IS_CCSHIM=1 ;;   # EXPLICIT only (never auto) — it needs ANTHROPIC_BASE_URL set
    pi)      IS_PI=1 ;;        # EXPLICIT only (never auto) — it requires v0.80.6 + models.json
    qoderclicn) IS_QODER=1 ;;  # Qoder CLI CN (Qwen); honors -w/--cwd + edit-only (grok-shaped rail)
    cursor)  IS_CURSOR=1 ;;    # Cursor CLI (cursor-agent). EXPLICIT only, never auto — see the
                               # auto-branch fail-closed guard below (R-1).
    opencode) IS_OPENCODE=1 ;; # OpenCode CLI (`opencode run`). EXPLICIT only, never auto: its
                               # model ids are provider/model (opencode-go/…, opencode/…) with no
                               # vendor family to match on; the provider prefix is the route.
    auto)
      # case-insensitive family match: gpt*/...codex* → codex; grok*/composer* → grok
      # (composer-2.5 ships inside the grok CLI on the Grok Build plan); else agy.
      # cc-shim is never auto-selected: it is a base-url shim that requires env vars, so
      # a bare model name must NOT silently route there.
      model_lc="$(printf '%s' "$MODEL" | tr '[:upper:]' '[:lower:]')"
      # 🔴 auto MUST NEVER SELECT cursor. This is a REFUSAL, not a route — placed before
      # the *grok*/*gpt* tests below on purpose. Every cursor model id contains grok, gpt,
      # codex, or claude (R-1, docs/plans/2026-08-26-cursor-cli-adaptor.md §6), so
      # auto-selection cannot disambiguate a vendor-hosted (Cursor) id from a vendor-native
      # one. Match semantics defined ONCE here (§3a):
      #   (a) prefix-open: ANY "cursor-" prefixed id fails closed, in or out of the Phase 1
      #       table (cursor-grok-4.5-high must NOT reach the *grok* branch either) — the
      #       prefix is unambiguous, so it can be closed openly. Names --runner cursor only.
      #   (b) table-closed: a NON-prefixed id fails closed IFF cursor_is_enabled_id "$MODEL"
      #       — a bare gpt-5.3-codex-* id is ALSO a real native-codex family and must not be
      #       over-captured, so this arm names BOTH --runner codex and --runner cursor and
      #       lets the caller choose. No id list of its own: it calls cursor_is_enabled_id,
      #       the single source of truth in lib/cursor-model.sh — three hand-maintained
      #       copies would drift while the test stayed green.
      if [[ "$model_lc" == cursor-* ]]; then
        die_precondition "auto-routing refuses Cursor-hosted model id '$MODEL' (cursor- prefix) — pass --runner cursor explicitly"
      elif cursor_is_enabled_id "$MODEL"; then
        die_precondition "auto-routing refuses ambiguous model id '$MODEL' (also a Cursor-hosted id) — pass --runner codex or --runner cursor explicitly"
      elif [[ "$model_lc" == *gpt* || "$model_lc" == *codex* ]]; then
        IS_CODEX=1
      elif [[ "$model_lc" == *grok* || "$model_lc" == *composer* ]]; then
        IS_GROK=1
      elif [[ "$model_lc" == *qwen* || "$model_lc" == *qwq* ]]; then
        IS_QODER=1
      fi
      ;;
    *) die_precondition "--runner must be one of auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode (got: $RUNNER)" ;;
  esac
  # Only reached if resolution actually completed (no die_precondition fired above,
  # including the cursor auto-guard refusals inside the `auto` arm). See RUNNER_RESOLVED
  # init comment and die_precondition (FINDING 1).
  RUNNER_RESOLVED=1
}

D2_AGY_RESPONSE_CLAIM="cap-v1-2ed283539393bd31ecd5012719b95aecf3eb5e146cafb6393494224d0eaf52f4"
D2_AGY_USAGE_CLAIM="cap-v1-c631dffdbdbd4d5fecc97d90510392c397a896fde25182f10371776f30006b3e"
D2_AGY_EXPECTED_IDS="[\"$D2_AGY_RESPONSE_CLAIM\",\"$D2_AGY_USAGE_CLAIM\"]"
validate_d2_agy_claims() {
  local receipt validator observed rc=0
  receipt="${AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT:-$SELF_DIR/../docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json}"
  validator="$SELF_DIR/platform-capability-claims.js"
  [ -r "$receipt" ] && [ -r "$validator" ] && command -v node >/dev/null 2>&1 \
    || die_precondition "D2 capability claim validation failed"
  observed="$(node "$validator" validate-consumer --receipt "$receipt" --consumer D2 \
    --claim-id "$D2_AGY_RESPONSE_CLAIM" --claim-id "$D2_AGY_USAGE_CLAIM" \
    --emit-claim-ids --reprobe --reprobe-binary "$AGY_BIN" 2>/dev/null)" || rc=$?
  [ "$rc" -eq 0 ] && [ "$observed" = "$D2_AGY_EXPECTED_IDS" ] \
    || die_precondition "D2 capability claim validation failed"
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
if [ "$KEEP" -eq 1 ]; then
  [[ "$RETENTION_OWNER" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die_precondition "--keep-worktree requires --retain-owner matching [A-Za-z0-9._-]+"
  [ -n "$RETENTION_REASON" ] \
    || die_precondition "--keep-worktree requires --retain-reason"
  [[ "$RETENTION_EXPIRES_AT" =~ ^[0-9]+$ ]] \
    || die_precondition "--keep-worktree requires --retain-until epoch seconds"
  [ "$RETENTION_EXPIRES_AT" -gt "$(date +%s)" ] \
    || die_precondition "--retain-until must be in the future"
  RETENTION_REASON_SHA256="$(
    printf '%s' "$RETENTION_REASON" | sha256sum | awk '{print $1}'
  )"
elif [ -n "$RETENTION_OWNER$RETENTION_REASON$RETENTION_EXPIRES_AT" ]; then
  die_precondition "retention metadata requires --keep-worktree"
fi
if [ -n "$REUSE_WORKTREE" ]; then
  [ "$KEEP" -eq 1 ] || die_precondition "--reuse-worktree requires --keep-worktree"
  [[ "$REUSE_WORKTREE" = /* ]] || die_precondition "--reuse-worktree must be absolute"
  [[ "$EXPECTED_WORKTREE_INSTANCE" =~ ^[0-9a-f]{64}$ ]] \
    || die_precondition "--reuse-worktree requires --expected-worktree-instance SHA-256"
elif [ -n "$EXPECTED_WORKTREE_INSTANCE" ]; then
  die_precondition "--expected-worktree-instance requires --reuse-worktree"
fi
if [ -n "$RESUME_SESSION_ID" ]; then
  [ "$RUNNER" = "grok" ] \
    || die_precondition "--resume-session is only verified for --runner grok"
  [[ "$RESUME_SESSION_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || die_precondition "--resume-session must be a lowercase UUID"
fi
[ -z "$CAMPAIGN_CONTRACT_FILE" ] || [ -r "$CAMPAIGN_CONTRACT_FILE" ] \
  || die_precondition "campaign contract file not readable: $CAMPAIGN_CONTRACT_FILE"
if [ -n "$CAMPAIGN_CONTRACT_FILE" ] || [ -n "$CAMPAIGN_CONTRACT_SHA256" ] \
    || [ -n "$CAMPAIGN_SEAL_FILE" ]; then
  [ -n "$CAMPAIGN_CONTRACT_FILE" ] && [ -n "$CAMPAIGN_CONTRACT_SHA256" ] \
    && [ -n "$CAMPAIGN_SEAL_FILE" ] \
    || die_precondition "--campaign-contract, --campaign-contract-sha256, and --campaign-seal are required together"
  [[ "$CAMPAIGN_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || die_precondition "--campaign-contract-sha256 must be a lowercase SHA-256 digest"
  [ -r "$CAMPAIGN_SEAL_FILE" ] \
    || die_precondition "campaign seal file not readable: $CAMPAIGN_SEAL_FILE"
fi
[ "$STRICT_CONTRACT" -eq 1 ] && [ "$CONTRACT_FILE_SUPPLIED" -eq 0 ] && die_precondition "--contract-file requires --strict-contract"
[ "$CONTRACT_FILE_SUPPLIED" -eq 1 ] && [ "$STRICT_CONTRACT" -eq 0 ] && die_precondition "--strict-contract requires --contract-file"

if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  run_campaign_contract_preflight
fi
if [ "$STRICT_CONTRACT" -eq 1 ]; then
  run_strict_contract_preflight
fi
if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  run_campaign_projection_preflight
fi
if [ "$CAMPAIGN_PROJECTION_BOUND" -ne 1 ]; then
  check_session_mode_gate
  check_mission_enforcement_gate
else
  # Sealed strict projection is present: still bind active L5/L6 (and L3
  # fallback) markers to the campaign's policy/graph digests before spend.
  check_managed_dev_flow_admission
  check_marker_campaign_admission_bridge
fi
emit_sealed_zero_diff_if_authorized
if [ "$MISSION_NOOP_SHORT_CIRCUIT" -eq 1 ]; then
  die_precondition \
    "Mission no-op marker requires the exact matching sealed zero_diff_receipt"
fi
set_runner_flags

# --- --cursor-fast: runner-scoped, never a silent no-op (§3a, Global Constraint 5). ---
if [ "$CURSOR_FAST" -eq 1 ]; then
  [ "$IS_CURSOR" -eq 1 ] || die_precondition "--cursor-fast applies only to --runner cursor (got runner: $RUNNER)"
fi

# --- cursor effort resolution (post-parse): a family alias (grok46|codex53) is resolved
# to a full model id via lib/cursor-model.sh; a full id already supplied passes through
# untouched, and --cursor-fast against a full id is a die_precondition (the mapper is
# bypassed on that path, so the flag would otherwise be silently ignored).
# The alias test uses cursor_is_family_alias (lib/cursor-model.sh's single source of
# truth over _CURSOR_FAMILIES) rather than a literal `grok46|codex53` case pattern here:
# a family added to _CURSOR_FAMILIES and not to a hand-restated pattern would silently
# fall through as an already-full id instead of being resolved. ---
if [ "$IS_CURSOR" -eq 1 ]; then
  if cursor_is_family_alias "$MODEL"; then
    MODEL="$(cursor_model_for "$CURSOR_BIN" "$MODEL" "$EFFORT" "$CURSOR_FAST")" \
      || die_precondition "cursor model resolution failed for family '$MODEL' effort '$EFFORT'"
  else
    [ "$CURSOR_FAST" -eq 1 ] \
      && die_precondition "--cursor-fast applies only when --model names a family alias; pass the -fast id directly"
  fi
fi

if [ "$IS_CODEX" -eq 0 ] && [ "$IS_GROK" -eq 0 ] && [ "$IS_CCSHIM" -eq 0 ] \
   && [ "$IS_PI" -eq 0 ] && [ "$IS_QODER" -eq 0 ] && [ "$IS_CURSOR" -eq 0 ] && [ "$IS_OPENCODE" -eq 0 ]; then
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN"
  validate_d2_agy_claims
fi


if [ "$IS_CODEX" -eq 0 ] && [ "$IS_GROK" -eq 0 ] && [ "$IS_CCSHIM" -eq 0 ] \
   && [ "$IS_PI" -eq 0 ] && [ "$IS_QODER" -eq 0 ] && [ "$IS_CURSOR" -eq 0 ] && [ "$IS_OPENCODE" -eq 0 ]; then
  # `|| die` in the PARENT: agy_resolve_model_alias deliberately never dies inside `$( )`,
  # where die_precondition's JSON would be captured into MODEL instead of exiting.
  MODEL="$(agy_resolve_model_alias "$MODEL" "$AGY_BIN" "$EFFORT")" \
    || die_precondition "$MODEL"
elif [ "$MODEL_IS_DEFAULT" -eq 1 ]; then
  # The built-in default is an agy alias and means nothing to any other vendor. Refusing
  # here is the loud half of the fix: silently forwarding it produced a vendor-side error
  # whose text named a model the caller never chose.
  die_precondition "--model is required for runner '$RUNNER' — the built-in default ('$MODEL') is an agy-only alias"
fi

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
  # The resolver's own stderr was discarded above (2>/dev/null keeps stdout the JSON contract);
  # re-surface the one disclosure that must never be silent at dispatch time. NOT gated on
  # DISPATCH_QUIET: that switch silences operational chatter (timeout heads-up), never a
  # security disclosure (review round 1, gpt-5.6-sol).
  case "$_ep_json" in
    *'"transport_security":"plaintext_private"'*)
      echo "dispatch-hetero: --endpoint '$ENDPOINT' is PLAINTEXT to a private-range address ($_ep_url) — bearer and prompts travel unencrypted on this LAN (AUTOPILOT_ENDPOINT_*_TRANSPORT=plaintext-private)" >&2 ;;
  esac
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
elif [ "$IS_CURSOR" -eq 1 ]; then
  command -v "$CURSOR_BIN" >/dev/null 2>&1 || die_precondition "cursor binary not found: $CURSOR_BIN (install Cursor CLI or pass --cursor-bin)"
elif [ "$IS_OPENCODE" -eq 1 ]; then
  command -v "$OPENCODE_BIN" >/dev/null 2>&1 || die_precondition "opencode binary not found: $OPENCODE_BIN (install OpenCode CLI or pass --opencode-bin)"
else
  command -v "$AGY_BIN" >/dev/null 2>&1 || die_precondition "agy binary not found: $AGY_BIN (install Antigravity CLI or pass --agy-bin)"
fi

git rev-parse --git-dir >/dev/null 2>&1 || die_precondition "not inside a git repository"
git rev-parse --verify --quiet "$BASE" >/dev/null || die_precondition "base ref not found: $BASE"
BASE_SHA="$(git rev-parse "$BASE")"

# Mandatory whenever an active Mission/root work order exists under git-common-dir,
# or when durable/checkpoint/reconcile inputs are present. Cannot be disabled by
# omitting continuation env when work orders exist — absence/stale/forged reconcile
# receipts fail closed before branch/worktree/runner effects.
if [ -z "$CONTINUATION_CHECKPOINT" ] && [ -n "${AUTOPILOT_CONTINUATION_CHECKPOINT:-}" ]; then
  CONTINUATION_CHECKPOINT="$AUTOPILOT_CONTINUATION_CHECKPOINT"
fi
if [ -z "$CONTINUATION_DURABLE" ] && [ -n "${AUTOPILOT_CONTINUATION_DURABLE:-}" ]; then
  CONTINUATION_DURABLE="$AUTOPILOT_CONTINUATION_DURABLE"
fi
# Prefer mission root over worktree/lineage/root/run (exact Mission identity wins).
_cont_root="${AUTOPILOT_MISSION_ROOT_RUN_ID:-${WORKTREE_ROOT_RUN_ID:-${LINEAGE_ROOT:-${AUTOPILOT_ROOT_RUN_ID:-${RUN_ID:-}}}}}"
_cont_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
_cont_has_wo=0
_cont_wo_claimed=""
# Mission / reconcile paths require root_run_id (never global scan, never silent miss).
if [ -z "$_cont_root" ] && { [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ] \
    || [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ] \
    || [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ]; }; then
  die_precondition "root_run_id mandatory for continuation/mission reconcile enumeration"
fi
if [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
  # Exact-root enumerate under fail-closed semantics — never `|| echo 0` on errors.
  # The managed engine owns a controller Work Order under the campaign root.
  # That record is controller authority, not an implementer continuation claim;
  # counting it here makes the child runner demand a reconcile receipt for the
  # very dispatch that created the controller (and blocks before model spend).
  # Keep this in lockstep with the engine-side continuation admission filter.
  _cont_has_wo="$(node -e '
const wo=require(process.argv[1]);
try {
  const n=wo.listNonterminalWorkOrders(process.argv[2], process.argv[3])
    .filter((entry) => !(entry && entry.work_order && entry.work_order.role === "controller"));
  process.stdout.write(n.length>0?"1":"0");
} catch (e) {
  process.stderr.write(String(e && e.message || e));
  process.exit(2);
}
' "$SELF_DIR/../src/engine/work-order.js" "$_cont_common" "$_cont_root")" || {
    die_precondition "work order root enumeration failed closed for root=$_cont_root"
  }
  case "$_cont_has_wo" in
    0|1) ;;
    *) die_precondition "work order root enumeration returned invalid result" ;;
  esac
fi
if [ -n "$CONTINUATION_CHECKPOINT" ] || [ -n "$CONTINUATION_DURABLE" ] \
    || [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ] \
    || [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ] \
    || [ "$_cont_has_wo" = "1" ] \
    || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
  _cont_args=(admit)
  if [ -n "$CONTINUATION_CHECKPOINT" ]; then
    [ -r "$CONTINUATION_CHECKPOINT" ] \
      || die_precondition "continuation checkpoint not readable: $CONTINUATION_CHECKPOINT"
    _cont_args+=(--checkpoint "$CONTINUATION_CHECKPOINT")
  fi
  if [ -n "$CONTINUATION_DURABLE" ]; then
    [ -r "$CONTINUATION_DURABLE" ] \
      || die_precondition "continuation durable tracker not readable: $CONTINUATION_DURABLE"
    _cont_args+=(--durable "$CONTINUATION_DURABLE")
  fi
  [ -n "$_cont_root" ] && _cont_args+=(--root-run-id "$_cont_root")
  [ -n "$BRANCH" ] && _cont_args+=(--branch "$BRANCH")
  [ -n "${STAGE:-}" ] && _cont_args+=(--stage "$STAGE" --graph-node "${STAGE}")
  [ -n "$BASE_SHA" ] && _cont_args+=(--base-sha "$BASE_SHA")
  [ -n "${MANIFEST_DIR_PATH:-}" ] && _cont_args+=(--manifest-dir "$MANIFEST_DIR_PATH")
  _cont_args+=(--git-cwd "$(pwd)")
  _cont_args+=(--owner-pid "$$")
  if [ "${AUTOPILOT_CONTINUATION_STRICT:-0}" = "1" ] || [ "$_cont_has_wo" = "1" ]; then
    _cont_args+=(--strict-match)
  fi
  if [ "$_cont_has_wo" = "1" ] || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
    _cont_args+=(--require-reconcile --mission-active)
  fi
  if [ -n "${AUTOPILOT_RECONCILE_RECEIPT:-}" ]; then
    [ -r "${AUTOPILOT_RECONCILE_RECEIPT}" ] \
      || die_precondition "reconcile receipt not readable: ${AUTOPILOT_RECONCILE_RECEIPT}"
    _cont_args+=(--reconcile-receipt "${AUTOPILOT_RECONCILE_RECEIPT}")
  fi
  if [ -n "${AUTOPILOT_TERMINAL_RECEIPT:-}" ]; then
    _cont_args+=(--terminal-receipt "${AUTOPILOT_TERMINAL_RECEIPT}")
  fi
  if [ -n "${AUTOPILOT_CONTINUATION_NARRATIVE:-}" ]; then
    _cont_args+=(--narrative "$AUTOPILOT_CONTINUATION_NARRATIVE")
  fi
  if [ -n "$CONTINUATION_DURABLE" ] || [ "$_cont_has_wo" = "1" ] \
      || [ -n "${AUTOPILOT_MISSION_ROOT_RUN_ID:-}" ]; then
    _cont_args+=(--create-work-order)
  fi
  _cont_json="$(node "$SELF_DIR/compaction-rehydrate.js" "${_cont_args[@]}" 2>/dev/null || true)"
  _cont_status="$(printf '%s' "$_cont_json" | jq -r '.status // empty' 2>/dev/null || true)"
  _cont_action="$(printf '%s' "$_cont_json" | jq -r '.action // empty' 2>/dev/null || true)"
  if [ -z "$_cont_json" ] || [ -z "$_cont_status" ]; then
    die_precondition "continuation admission failed closed (no admission result)"
  fi
  if [ "$_cont_status" = "reject" ] || [ "$_cont_status" = "not_found" ]; then
    _cont_reason="$(printf '%s' "$_cont_json" | jq -r '.reason // .reason_code // "continuation admission rejected"' 2>/dev/null || true)"
    die_precondition "continuation admission: ${_cont_reason:-rejected}"
  fi
  if [ "$_cont_action" = "attach_active" ] || [ "$_cont_action" = "attach_existing" ] \
      || [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
    if [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
      _cont_term="$(printf '%s' "$_cont_json" | jq -r '.terminal_status // empty' 2>/dev/null || true)"
      _cont_hb_args=(heartbeat --git-cwd "$(pwd)" --root-run-id "$_cont_root"
        --graph-node "${STAGE:-implement}" --attempt 1 --owner-pid "$$")
      if [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
        _cont_hb_args+=(--terminal-status "${_cont_term:-aborted}" --disposition consumed)
      fi
      # Shell lifecycle/heartbeat failures fail closed (except not_found when no WO).
      _cont_hb_json="$(node "$SELF_DIR/compaction-rehydrate.js" "${_cont_hb_args[@]}" 2>/dev/null)" || {
        die_precondition "work order lifecycle heartbeat failed closed"
      }
      _cont_hb_st="$(printf '%s' "$_cont_hb_json" | jq -r '.status // empty' 2>/dev/null || true)"
      _cont_hb_rc="$(printf '%s' "$_cont_hb_json" | jq -r '.reason_code // empty' 2>/dev/null || true)"
      if [ -z "$_cont_hb_st" ] || { [ "$_cont_hb_st" = "reject" ] && [ "$_cont_hb_rc" != "not_found" ]; }; then
        die_precondition "work order lifecycle heartbeat failed: ${_cont_hb_rc:-reject}"
      fi
    fi
    _cont_phase="$(printf '%s' "$_cont_json" | jq -r '.phase_cursor // empty' 2>/dev/null || true)"
    _cont_commit="$(printf '%s' "$_cont_json" | jq -r '.accepted_commit // empty' 2>/dev/null || true)"
    _cont_run="$(printf '%s' "$_cont_json" | jq -r '.attached_run_id // empty' 2>/dev/null || true)"
    _cont_next="$(printf '%s' "$_cont_json" | jq -r '.next_action // empty' 2>/dev/null || true)"
    _cont_auth_root="$(printf '%s' "$_cont_json" | jq -r '.root_run_id // empty' 2>/dev/null || true)"
    [ -z "$_cont_auth_root" ] && _cont_auth_root="$_cont_root"
    if [ "$_cont_commit" = "none" ] || [ -z "$_cont_commit" ]; then
      _cont_commit_json="null"
    else
      _cont_commit_json="\"$(_flat_json_escape "$_cont_commit")\""
    fi
    _cont_out_status="attached"
    if [ "$_cont_action" = "consume_terminal" ] || [ "$_cont_action" = "resume_terminal" ]; then
      _cont_out_status="consumed"
    fi
    printf '{ "status": "%s", "runner": "continuation-admission", "model": null, "branch": "%s", "base": "%s", "commit": %s, "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null, "error": null, "skill_mode_effective": "%s", "skills_injected": %s, "run_id": %s, "root_run_id": %s, "phase_cursor": %s, "next_action": %s, "duplicate_dispatch": 0, "continuation_admission": %s, "duplex": null }\n' \
      "$_cont_out_status" \
      "$(_flat_json_escape "$BRANCH")" \
      "$(_flat_json_escape "$BASE")" \
      "$_cont_commit_json" \
      "$(_flat_json_escape "${EFFECTIVE_SKILL_MODE:-off}")" \
      "${SKILLS_INJECTED_JSON:-[]}" \
      "$([ -n "$_cont_run" ] && printf '"%s"' "$(_flat_json_escape "$_cont_run")" || echo null)" \
      "$([ -n "$_cont_auth_root" ] && printf '"%s"' "$(_flat_json_escape "$_cont_auth_root")" || echo null)" \
      "$([ -n "$_cont_phase" ] && printf '"%s"' "$(_flat_json_escape "$_cont_phase")" || echo null)" \
      "$([ -n "$_cont_next" ] && printf '"%s"' "$(_flat_json_escape "$_cont_next")" || echo null)" \
      "$_cont_json"
    exit 0
  fi
  if [ "$_cont_action" = "dispatch_new" ] && [ -n "$_cont_common" ] && [ -n "$_cont_root" ]; then
    _CONT_WO_CLAIMED_ROOT="$_cont_root"
    _CONT_WO_CLAIMED_STAGE="${STAGE:-implement}"
    _cont_hb_json="$(node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$(pwd)" \
      --root-run-id "$_cont_root" --graph-node "${STAGE:-implement}" --attempt 1 \
      --owner-pid "$$" --runner self 2>/dev/null)" || {
      die_precondition "work order lifecycle heartbeat failed closed before dispatch effects"
    }
    _cont_hb_st="$(printf '%s' "$_cont_hb_json" | jq -r '.status // empty' 2>/dev/null || true)"
    _cont_hb_rc="$(printf '%s' "$_cont_hb_json" | jq -r '.reason_code // empty' 2>/dev/null || true)"
    if [ -z "$_cont_hb_st" ] || { [ "$_cont_hb_st" = "reject" ] && [ "$_cont_hb_rc" != "not_found" ]; }; then
      die_precondition "work order lifecycle heartbeat failed: ${_cont_hb_rc:-reject}"
    fi
  fi
  unset _cont_args _cont_json _cont_status _cont_action _cont_reason \
    _cont_phase _cont_commit _cont_run _cont_next _cont_commit_json _cont_auth_root \
    _cont_has_wo _cont_out_status _cont_term _cont_hb_args \
    _cont_hb_json _cont_hb_st _cont_hb_rc _cont_wo_claimed _cont_root _cont_common
fi

if [ -z "$REUSE_WORKTREE" ] \
  && git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  die_precondition "branch already exists: $BRANCH"
fi
# Claim the durable implementation tuple before branch/worktree/manifest
# creation. This parent-owned lease is required whenever detach was requested,
# even when this host cannot provide setsid --wait and execution later falls
# back inline. Detachment capability controls process topology, never tuple
# exclusivity. A detached child transfers this preclaim after startup; an
# inline run retains the parent lease for its lifetime.
_detach_preclaim=1
case "${DISPATCH_DETACH:-1}" in
  0|false|FALSE|no|NO|off|OFF|No|Off) _detach_preclaim=0 ;;
esac
if [ "$_detach_preclaim" -eq 1 ] \
    && [ -n "$LEDGER" ] && [ -n "$RUN_ID" ] && [ -n "$STAGE" ]; then
  _preclaim_err="$(mktemp -t 'dispatch-hetero-preclaim-XX''XX''XX')" \
    || die_precondition "cannot allocate durable dispatch claim diagnostic"
  _preclaim="$(bash "$SELF_DIR/run-ledger.sh" stage-acquire \
    --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
    --pid "$$" --git-ref "refs/heads/$BRANCH" --exclusive-live 2>"$_preclaim_err")" \
    || {
      _preclaim_diag="$(cat "$_preclaim_err" 2>/dev/null || true)"
      rm -f "$_preclaim_err"
      die_precondition "durable dispatch claim rejected: ${_preclaim_diag:-unknown}"
    }
  rm -f "$_preclaim_err"
  DETACH_PRECLAIM_GEN="$(printf '%s' "$_preclaim" | jq -r '.generation // empty')"
  DETACH_PRECLAIM_NONCE="$(printf '%s' "$_preclaim" | jq -r '.nonce // empty')"
  [ -n "$DETACH_PRECLAIM_GEN" ] && [ -n "$DETACH_PRECLAIM_NONCE" ] \
    || die_precondition "durable dispatch claim returned invalid ownership identity"
fi
unset _detach_preclaim _preclaim _preclaim_err _preclaim_diag

# Resolve effective skill mode and build prompt-pack if requested
if [[ "$SKILL_MODE" != "off" ]]; then
  EFFECTIVE_SKILL_MODE="$SKILL_MODE"
  local_runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && local_runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && local_runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && local_runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && local_runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && local_runner="qoderclicn"
  [ "${IS_CURSOR:-0}" -eq 1 ] && local_runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && local_runner="opencode"

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

# A managed campaign passes the already-sealed contract as an explicit leaf input.
# This layer does not reinterpret scope authority; it makes the frozen paths and
# budgets visible to the implementer while ICC retains admission and enforcement.
if [ -n "$CAMPAIGN_CONTRACT_FILE" ]; then
  CAMPAIGN_CONTRACT_SNAPSHOT="$(mktemp -t 'dispatch-hetero-campaign-contract-XX''XX''XX')"
  cp -- "$CAMPAIGN_CONTRACT_FILE" "$CAMPAIGN_CONTRACT_SNAPSHOT" \
    || die_precondition "campaign contract snapshot failed"
  command -v node >/dev/null 2>&1 \
    || die_precondition "node is required to verify the campaign contract digest"
  _campaign_snapshot_digest="$(node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$CAMPAIGN_CONTRACT_SNAPSHOT")" \
    || die_precondition "campaign contract digest verification failed"
  [ "$_campaign_snapshot_digest" = "$CAMPAIGN_CONTRACT_SHA256" ] \
    || die_precondition "campaign contract digest changed after intake"
  CAMPAIGN_PROMPT_FILE="$(mktemp -t 'dispatch-hetero-campaign-prompt-XX''XX''XX')"
  {
    printf '%s\n' '=== MACHINE-OWNED CAMPAIGN BOUNDARY ==='
    printf '%s\n' 'The JSON contract below is immutable. Stay within its allowed paths and budgets.'
    cat "$CAMPAIGN_CONTRACT_SNAPSHOT"
    printf '%s\n\n' '=== END CAMPAIGN BOUNDARY ==='
    cat "$PROMPT_FILE"
  } > "$CAMPAIGN_PROMPT_FILE"
  rm -f "$CAMPAIGN_CONTRACT_SNAPSHOT"
  CAMPAIGN_CONTRACT_SNAPSHOT=""
  unset _campaign_snapshot_digest
  PROMPT_FILE="$CAMPAIGN_PROMPT_FILE"
fi

# --- scaffold-tier envelope (four-layer P1; references/scaffold-tiers.md is canonical) ---
# Prepended to the SHARED prompt file BEFORE the per-runner branches, so every runner
# (codex/grok/cc-shim/agy/pi/qoder) consumes the tier identically. Placed before the
# context-window gate so the gate prices the envelope too. Disable per project with
# `scaffold_tiers: off` in .claude/dispatch-config.md.
if [ "$SCAFFOLD_TIER_ARG" != "off" ] \
  && ! grep -qE '^scaffold_tiers:[[:space:]]*off' .claude/dispatch-config.md 2>/dev/null; then
  # shellcheck source=/dev/null
  . "$SELF_DIR/lib/scaffold-envelope.sh"
  _resolved_tier="$(node "$SELF_DIR/resolve-scaffold-tier.js" \
    --runner "$RUNNER" --model "$MODEL" --role implementer 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tier)}catch{process.stdout.write("T2")}});' \
    2>/dev/null)" || _resolved_tier="T2"
  case "$_resolved_tier" in T0|T1|T2) ;; *) _resolved_tier="T2" ;; esac
  _effective_tier="$_resolved_tier"
  if [ "$SCAFFOLD_TIER_ARG" != "auto" ]; then
    case "$SCAFFOLD_TIER_ARG" in T0|T1|T2) ;; *) die_precondition "--scaffold-tier must be auto|off|T0|T1|T2" ;; esac
    # Explicit override may only ADD scaffolding (fail-closure applies to humans too):
    # a request BELOW the resolved scaffolding amount is rejected.
    if [ "$(scaffold_tier_rank "$SCAFFOLD_TIER_ARG")" -lt "$(scaffold_tier_rank "$_resolved_tier")" ]; then
      die_precondition "explicit --scaffold-tier $SCAFFOLD_TIER_ARG requests LESS scaffolding than resolved $_resolved_tier — overrides may only add scaffolding (references/scaffold-tiers.md)"
    fi
    _effective_tier="$SCAFFOLD_TIER_ARG"
  fi
  SCAFFOLD_PROMPT_FILE="$(mktemp -t 'dispatch-hetero-scaffold-prompt-XX''XX''XX')"
  build_scaffold_envelope "$_effective_tier" "$SELF_DIR/../references/scaffold-tiers.md" \
    "$PROMPT_FILE" "$SCAFFOLD_PROMPT_FILE" \
    || die_precondition "scaffold envelope build failed (tier $_effective_tier)"
  PROMPT_FILE="$SCAFFOLD_PROMPT_FILE"
  SCAFFOLD_TIER_EFFECTIVE="$_effective_tier"
  unset _resolved_tier _effective_tier
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

# Reconcile crash-window records and count retained occupancy while the caller
# holds the repository-common budget lock. Unknown/legacy state is preserved and
# consumes capacity; only exact, dead, clean state is reclaimed.
_wt_budget_reconcile_and_count() {
  local repo="$1" common="$2" root_id="$3"
  local pending_dir="$common/autopilot-worktree-creation"
  local record fields=() record_root record_run record_loop record_branch record_base record_path
  local current_tip live_rc probe_fd wt marker line actual_branch actual_head marker_digest
  local registered_rc worktree_list
  local -A pending_paths=()
  WT_BUDGET_COUNT=0

  if [ -e "$pending_dir" ] || [ -L "$pending_dir" ]; then
    [ -d "$pending_dir" ] && [ ! -L "$pending_dir" ] && [ -O "$pending_dir" ] || return 2
  else
    (umask 077; mkdir "$pending_dir") || return 2
  fi

  for record in "$pending_dir"/*.json; do
    [ -e "$record" ] || continue
    [ -f "$record" ] && [ ! -L "$record" ] && [ -O "$record" ] || {
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    }
    mapfile -t fields < <(node -e '
const fs = require("fs");
try {
  const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = ["root_run_id", "run_id", "loop_id", "branch", "base_sha", "planned_path"];
  if (!v || v.schema !== 1 || keys.some(k => typeof v[k] !== "string" || /[\r\n\t]/.test(v[k]))) process.exit(2);
  for (const k of keys) console.log(v[k]);
} catch (_) { process.exit(2); }
' "$record" 2>/dev/null)
    if [ "${#fields[@]}" -ne 6 ]; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    record_root="${fields[0]}"; record_run="${fields[1]}"; record_loop="${fields[2]}"
    record_branch="${fields[3]}"; record_base="${fields[4]}"; record_path="${fields[5]}"
    if ! [[ "$record_root" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_run" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_loop" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "$record_base" =~ ^[0-9a-f]{40,64}$ ]] \
       || [[ "$record_path" != /* ]] \
       || ! git check-ref-format --branch "$record_branch" >/dev/null 2>&1; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi

    _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || return 2
    if [ "$registered_rc" -eq 0 ]; then
      marker="$record_path/.autopilot-worktree"
      if [ -e "$marker" ] || [ -L "$marker" ]; then
        if _wt_read_schema2_marker "$marker" \
           && [ "$_WT_MARKER_ROOT_RUN_ID" = "$record_root" ] \
           && [ "$_WT_MARKER_RUN_ID" = "$record_run" ] \
           && [ "$_WT_MARKER_LOOP_ID" = "$record_loop" ] \
           && [ "$_WT_MARKER_BRANCH" = "$record_branch" ] \
           && [ "$_WT_MARKER_BASE_SHA" = "$record_base" ]; then
          rm -f -- "$record"
        elif [ "$record_root" = "$root_id" ]; then
          WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
          pending_paths["$record_path"]=1
        fi
        # A marker that exists but does not match is positive evidence of an
        # ownership conflict, never the add-before-marker crash window.
        continue
      fi

      _wt_is_live "$record_path"; live_rc=$?
      probe_fd="${_WT_PROBE_FD:-}"
      current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$record_branch" 2>/dev/null || true)"
      actual_branch="$(git -C "$record_path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
      actual_head="$(git -C "$record_path" rev-parse HEAD 2>/dev/null || true)"
      _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
      [ "$registered_rc" -ne 2 ] || {
        [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
        return 2
      }
      if [ "$live_rc" -eq 0 ] && [ "$registered_rc" -eq 0 ] \
         && _wt_is_clean "$record_path" \
         && [ "$actual_branch" = "$record_branch" ] \
         && [ "$actual_head" = "$record_base" ] \
         && [ "$current_tip" = "$record_base" ] \
         && [ ! -e "$marker" ] && [ ! -L "$marker" ] \
         && _wt_is_clean "$record_path"; then
        # No --force: git is the last compare/remove guard if dirt appears
        # after the immediately preceding cleanliness read.
        git -C "$repo" worktree remove "$record_path" >/dev/null 2>&1 || true
        _wt_is_registered_path "$repo" "$record_path"; registered_rc=$?
        [ "$registered_rc" -ne 2 ] || {
          [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
          return 2
        }
        if [ "$registered_rc" -eq 1 ]; then
          # Keep the branch and pending record as exact evidence for the Phase
          # 2/3 lifecycle controller. Deleting a ref here cannot atomically
          # prove that an ordinary concurrent Git operation did not just check
          # it out in another worktree.
          :
        fi
      fi
      [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
      _WT_PROBE_FD=""
      if [ -e "$record" ] && [ "$record_root" = "$root_id" ]; then
        WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
        pending_paths["$record_path"]=1
      fi
    else
      current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$record_branch" 2>/dev/null || true)"
      if [ -z "$current_tip" ]; then
        rm -f -- "$record"
      fi
      if [ -e "$record" ] && [ "$record_root" = "$root_id" ]; then
        WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      fi
    fi
  done

  worktree_list="$(git -C "$repo" worktree list --porcelain 2>/dev/null)" || return 2
  while IFS= read -r line; do
    wt="${line#worktree }"
    [ -d "$wt" ] || continue
    [ -z "${pending_paths[$wt]+present}" ] || continue
    marker="$wt/.autopilot-worktree"
    [ -f "$marker" ] || continue
    if grep -qx 'schema=1' "$marker" 2>/dev/null; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    if ! _wt_read_schema2_marker "$marker"; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    [ "$_WT_MARKER_ROOT_RUN_ID" = "$root_id" ] || continue
    if [ "$_WT_MARKER_RETENTION" = "inspect" ] \
       || { [ "$_WT_MARKER_RETENTION" = "lease" ] \
         && [ "$_WT_MARKER_RETENTION_EXPIRES_AT" -gt "$(date +%s)" ]; }; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi
    marker_digest="$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')"
    actual_branch="$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    actual_head="$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)"
    current_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$_WT_MARKER_BRANCH" 2>/dev/null || true)"
    if [ -z "$marker_digest" ] \
       || [ "$actual_branch" != "$_WT_MARKER_BRANCH" ] \
       || [ "$actual_head" != "$current_tip" ] \
       || ! git -C "$repo" merge-base --is-ancestor "$_WT_MARKER_BASE_SHA" "$actual_head" 2>/dev/null; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
      continue
    fi

    _wt_is_live "$wt"; live_rc=$?
    probe_fd="${_WT_PROBE_FD:-}"
    _wt_is_registered_path "$repo" "$wt"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || {
      [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
      return 2
    }
    if [ "$live_rc" -eq 0 ] && [ "$registered_rc" -eq 0 ] \
       && [ "$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')" = "$marker_digest" ] \
       && [ "$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || true)" = "$actual_branch" ] \
       && [ "$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)" = "$actual_head" ] \
       && [ "$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$_WT_MARKER_BRANCH" 2>/dev/null || true)" = "$actual_head" ] \
       && _wt_is_clean "$wt"; then
      git -C "$repo" worktree remove "$wt" >/dev/null 2>&1 || true
    fi
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    _wt_is_registered_path "$repo" "$wt"; registered_rc=$?
    [ "$registered_rc" -ne 2 ] || return 2
    if [ "$registered_rc" -eq 0 ]; then
      WT_BUDGET_COUNT=$((WT_BUDGET_COUNT + 1))
    fi
  done < <(printf '%s\n' "$worktree_list" | sed -n '/^worktree /p')
  return 0
}

# --- isolated worktree (the non-skippable safety rail) ---
BASE_SHA="$(git rev-parse "$BASE")"

WT_RUN_ID="$(printf '%s' "$DISPATCH_RUN_ID" | tr -c 'A-Za-z0-9._-' '-')"
WT_LOOP_ID="${AUTOPILOT_LOOP_ID:-${LINEAGE_PARENT:-$DISPATCH_RUN_ID}}"
WT_LOOP_ID="$(printf '%s' "$WT_LOOP_ID" | tr -c 'A-Za-z0-9._-' '-')"
_wt_repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die_precondition "cannot resolve consuming repository root"
_wt_common_dir="$(_wt_resolve_common_dir "$_wt_repo_root")" \
  || die_precondition "cannot resolve canonical git common directory"
if [ -n "$REUSE_WORKTREE" ]; then
  WT="$(realpath "$REUSE_WORKTREE" 2>/dev/null)" \
    || die_precondition "cannot canonicalize retained worktree path"
  _wt_open_lock_fd "$WT/.autopilot-worktree.lock" \
    || die_precondition "cannot open retained worktree lifetime lock"
  WT_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_LOCK_FD" \
    || die_precondition "cannot acquire retained worktree lifetime lock"
  _actual_worktree_instance="$(
    node - "$WT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const worktree = path.resolve(process.argv[2]);
const stat = fs.statSync(worktree, { bigint: true });
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({
  birthtime_ns: stat.birthtimeNs.toString(),
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  schema: 1,
  worktree,
})).digest('hex'));
NODE
  )" || die_precondition "cannot attest retained worktree filesystem instance"
  [ "$_actual_worktree_instance" = "$EXPECTED_WORKTREE_INSTANCE" ] \
    || die_precondition "retained worktree filesystem instance changed"
  _wt_is_registered_path "$_wt_repo_root" "$WT"
  [ "$?" -eq 0 ] || die_precondition "retained worktree is not registered"
  [ "$(git -C "$WT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)" = "$BRANCH" ] \
    || die_precondition "retained worktree branch does not match --branch"
  [ "$(git -C "$WT" rev-parse HEAD 2>/dev/null || true)" = "$BASE_SHA" ] \
    || die_precondition "retained worktree HEAD does not match --base"
  [ -z "$(git -C "$WT" status --porcelain 2>/dev/null)" ] \
    || die_precondition "retained worktree is dirty"
  _wt_read_schema2_marker "$WT/.autopilot-worktree" \
    || die_precondition "retained worktree marker is invalid"
  [ "$_WT_MARKER_BRANCH" = "$BRANCH" ] \
    || die_precondition "retained worktree marker branch mismatch"
  [ "$_WT_MARKER_ROOT_RUN_ID" = "$WORKTREE_ROOT_RUN_ID" ] \
    || die_precondition "retained worktree root identity mismatch"
  [ "$_WT_MARKER_RETENTION_OWNER" = "$RETENTION_OWNER" ] \
    || die_precondition "retained worktree lease owner mismatch"
  [ "$_WT_MARKER_RETENTION_REASON_SHA256" = "$RETENTION_REASON_SHA256" ] \
    || die_precondition "retained worktree lease reason mismatch"
  [ "$_WT_MARKER_RETENTION_EXPIRES_AT" = "$RETENTION_EXPIRES_AT" ] \
    || die_precondition "retained worktree lease expiry mismatch"
  WORKTREE_REUSED=1
else
  WT="$(mktemp -u -d -t "hetero-${BRANCH//\//-}-XXXXXX")"
  WT="$(realpath -m "$WT" 2>/dev/null)" \
    || die_precondition "cannot canonicalize planned worktree path"
fi

_wt_prepare_common_excludes() {
  mkdir -p "$_wt_common_dir/info" || return 1
  local exclude="$_wt_common_dir/info/exclude" name
  for name in .autopilot-worktree .autopilot-worktree.lock; do
    grep -qxF "$name" "$exclude" 2>/dev/null \
      || printf '%s\n' "$name" >> "$exclude" \
      || return 1
  done
}

_wt_creation_test_checkpoint() {
  [ "${AUTOPILOT_TEST_WORKTREE_CRASH_AT:-}" = "$1" ] || return 0
  case "$1" in
    after-pending|after-add|after-marker|after-verification) kill -KILL "$$" ;;
  esac
}

_wt_lock_fail() {
  # This path runs before the worker starts, but external state can still race
  # marker/lock setup. Never force-remove newly dirty data, and delete the ref
  # only if it still has the exact creation tip.
  if [ "${WORKTREE_REUSED:-0}" -eq 1 ]; then
    [ -n "$WT_LOCK_FD" ] && exec {WT_LOCK_FD}>&-
    [ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
    WT_LOCK_FD=""
    WT_BUDGET_LOCK_FD=""
    die_precondition "$1"
  fi
  git worktree remove "$WT" >/dev/null 2>&1 || true
  if [ -z "$WT_PENDING_RECORD" ]; then
    git update-ref -d "refs/heads/$BRANCH" "$BASE_SHA" >/dev/null 2>&1 || true
  fi
  if [ -n "$WT_PENDING_RECORD" ]; then
    _wt_is_registered_path "${_wt_repo_root:-.}" "$WT"
    _wt_cleanup_registered_rc=$?
    _wt_cleanup_branch="$(git rev-parse --verify --quiet "refs/heads/$BRANCH" 2>/dev/null || true)"
    if [ "$_wt_cleanup_registered_rc" -eq 1 ] && [ -z "$_wt_cleanup_branch" ]; then
      rm -f -- "$WT_PENDING_RECORD"
    fi
  fi
  [ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
  WT_PENDING_RECORD=""
  WT_BUDGET_LOCK_FD=""
  die_precondition "$1"
}

# agy argv-payload ceiling — refuse BEFORE anything is created, so the `precondition_failed`
# contract ("nothing was created") holds. agy has no --prompt-file, so the directive plus the task
# prompt travel as ONE argv string and execve rejects it over MAX_ARG_STRLEN, before agy starts and
# with no vendor error to report. Measured against the same directive the dispatch will send (the
# WT path is already resolved here; only the worktree itself does not exist yet). `wc -c` on the
# prompt file slightly OVER-counts, which errs toward refusing a payload that would just barely
# have fit — the safe direction. Only the agy rail has this wall; every other runner reads a file
# or STDIN.
if [ "$IS_CODEX" -eq 0 ] && [ "$IS_GROK" -eq 0 ] && [ "$IS_CCSHIM" -eq 0 ] \
   && [ "$IS_PI" -eq 0 ] && [ "$IS_QODER" -eq 0 ] && [ "$IS_CURSOR" -eq 0 ] && [ "$IS_OPENCODE" -eq 0 ]; then
  # `wc -c` on a PIPE, not ${#var}: ${#} counts CHARACTERS, and the directive contains a
  # multibyte em-dash (and $WT may add more), so a character count UNDER-reports the argv size —
  # the unsafe direction, and exactly the payload band (131072-131073 bytes) the guard exists to
  # catch. The pipe also preserves the directive's trailing blank line, so no manual +2.
  AGY_ARGV_BYTES=$(( $(agy_edit_only_directive "$WT" | wc -c) + $(wc -c < "$PROMPT_FILE") ))
  if ! AGY_CEILING_REASON="$(agy_argv_ceiling_assert "$AGY_ARGV_BYTES" "the agy task prompt" \
      "split the task into smaller units, or dispatch it to a runner that reads a prompt file (codex, grok, qoderclicn, opencode)")"; then
    die_precondition "$AGY_CEILING_REASON"
  fi
fi

if [ "$WORKTREE_REUSED" -eq 0 ] && [ "$WORKTREE_MANAGED" -eq 1 ]; then
  # Admission must precede the first pending record, branch, or worktree. Once
  # active, evidence loss cannot be reinterpreted as an empty lifecycle root.
  bash "$SELF_DIR/reap-dispatch-worktrees.sh" scan \
    --repo "$_wt_repo_root" --root-run-id "$WORKTREE_ROOT_RUN_ID" >/dev/null \
    || die_precondition "cannot admit managed worktree lifecycle root"

  _wt_open_lock_fd "$_wt_common_dir/autopilot-worktree-budget.lock" \
    || die_precondition "cannot open worktree resource budget lock"
  WT_BUDGET_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_BUDGET_LOCK_FD" \
    || die_precondition "cannot acquire worktree resource budget lock"

  # Install bookkeeping exclusions before reconciliation probes can create a
  # lifetime lock in an add-before-marker crash artifact.
  _wt_prepare_common_excludes \
    || die_precondition "cannot register worktree bookkeeping exclusion"

  _wt_budget_reconcile_and_count "$_wt_repo_root" "$_wt_common_dir" "$WORKTREE_ROOT_RUN_ID" \
    || die_precondition "cannot reconcile worktree creation state"
  _wt_budget_limit="$(bash "$SELF_DIR/resolve-worktree-teardown.sh" --field max_leaf_worktrees_per_root 2>/dev/null || true)"
  [[ "$_wt_budget_limit" =~ ^[0-9]+$ ]] || _wt_budget_limit=4
  if [ "$WT_BUDGET_COUNT" -ge "$_wt_budget_limit" ]; then
    exec {WT_BUDGET_LOCK_FD}>&-
    WT_BUDGET_LOCK_FD=""
    die_resource_budget "$WT_BUDGET_COUNT" "$_wt_budget_limit"
  fi

  _wt_pending_tmp="$(mktemp "$_wt_common_dir/autopilot-worktree-creation/${WT_RUN_ID}.XXXXXX.tmp")" \
    || {
      exec {WT_BUDGET_LOCK_FD}>&-
      WT_BUDGET_LOCK_FD=""
      die_precondition "cannot allocate worktree creation record"
    }
  WT_PENDING_RECORD="${_wt_pending_tmp%.tmp}.json"
  (umask 077; printf '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
    "$(json_escape "$WORKTREE_ROOT_RUN_ID")" "$(json_escape "$WT_RUN_ID")" \
    "$(json_escape "$WT_LOOP_ID")" "$(json_escape "$BRANCH")" \
    "$BASE_SHA" "$(json_escape "$WT")" > "$_wt_pending_tmp") \
    && mv -f -- "$_wt_pending_tmp" "$WT_PENDING_RECORD" \
    || {
      rm -f -- "$_wt_pending_tmp"
      exec {WT_BUDGET_LOCK_FD}>&-
      WT_BUDGET_LOCK_FD=""
      die_precondition "cannot publish worktree creation record"
    }
  _wt_creation_test_checkpoint after-pending
elif [ "$WORKTREE_REUSED" -eq 0 ]; then
  _wt_prepare_common_excludes \
    || die_precondition "cannot register worktree bookkeeping exclusion"
fi

if [ "$WORKTREE_REUSED" -eq 0 ] \
  && ! git worktree add --quiet "$WT" -b "$BRANCH" "$BASE_SHA"; then
  # `git worktree add -b` creates the branch ref BEFORE the dir, so the ref leaks
  # even when dir creation fails (verified 2026-06-22). Reap it before bailing.
  _wt_lock_fail "git worktree add failed"
fi
[ "$WORKTREE_REUSED" -eq 1 ] || _wt_creation_test_checkpoint after-add
# Marker = --gc eligibility token (name-independent). Lifetime flock = liveness gate
# (kernel-released on process death incl. SIGKILL; no pid checks — plan §2a/§2c).
# Both names are registered in the COMMON git dir's info/exclude below: the wrapper
# commits with `git add -A`, so without the exclude both bookkeeping files would
# land in every dispatched commit, and `git status --porcelain` cleanliness checks
# would see them as untracked.
_wt_marker_tmp="$WT/.autopilot-worktree.tmp.$$"
{
  if [ "$WORKTREE_REUSED" -eq 1 ]; then
    printf 'created_at=%s\n' "$_WT_MARKER_CREATED_AT"
  else
    printf 'created_at=%s\n' "$(date +%s)"
  fi
  printf 'branch=%s\n' "$BRANCH"
  printf 'base_sha=%s\n' "$BASE_SHA"
  printf 'run_id=%s\n' "$WT_RUN_ID"
  printf 'root_run_id=%s\n' "$WORKTREE_ROOT_RUN_ID"
  if [ "$WORKTREE_REUSED" -eq 1 ]; then
    printf 'loop_id=%s\n' "$_WT_MARKER_LOOP_ID"
  else
    printf 'loop_id=%s\n' "$WT_LOOP_ID"
  fi
  if [ "$KEEP" -eq 1 ]; then
    printf 'retention=lease\n'
    printf 'retention_owner=%s\n' "$RETENTION_OWNER"
    printf 'retention_reason_sha256=%s\n' "$RETENTION_REASON_SHA256"
    printf 'retention_expires_at=%s\n' "$RETENTION_EXPIRES_AT"
  fi
  printf 'schema=2\n'
} > "$_wt_marker_tmp"
mv -f -- "$_wt_marker_tmp" "$WT/.autopilot-worktree" \
  || _wt_lock_fail "cannot publish worktree ownership marker"
_wt_creation_test_checkpoint after-marker
# Hold exclusive lock on a dedicated fd for the whole dispatch life. Never close
# early; never exec-replace this shell (would release the lock silently).
# On lock failure, clean up the just-created worktree+branch before dying.
if [ "$WORKTREE_REUSED" -eq 0 ]; then
  _wt_open_lock_fd "$WT/.autopilot-worktree.lock" \
    || _wt_lock_fail "cannot open worktree lifetime lock"
  WT_LOCK_FD="$_WT_SAFE_LOCK_FD"
  flock -x "$WT_LOCK_FD" || _wt_lock_fail "cannot acquire worktree lifetime lock"
fi
if ! _wt_read_schema2_marker "$WT/.autopilot-worktree" \
   || [ "$_WT_MARKER_RUN_ID" != "$WT_RUN_ID" ] \
   || [ "$_WT_MARKER_ROOT_RUN_ID" != "$WORKTREE_ROOT_RUN_ID" ] \
   || { [ "$WORKTREE_REUSED" -eq 0 ] && [ "$_WT_MARKER_LOOP_ID" != "$WT_LOOP_ID" ]; } \
   || [ "$_WT_MARKER_BRANCH" != "$BRANCH" ] \
   || [ "$_WT_MARKER_BASE_SHA" != "$BASE_SHA" ]; then
  _wt_lock_fail "worktree ownership marker verification failed"
fi
_wt_creation_test_checkpoint after-verification
[ -n "$WT_PENDING_RECORD" ] && rm -f -- "$WT_PENDING_RECORD"
WT_PENDING_RECORD=""
[ -n "$WT_BUDGET_LOCK_FD" ] && exec {WT_BUDGET_LOCK_FD}>&-
WT_BUDGET_LOCK_FD=""
LOG="$(mktemp -t "hetero-${BRANCH//\//-}-log-XXXXXX")"

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

# Managed aborts must preserve exact branch evidence before any removal. The
# legacy minimal remover + branch deletion remains only for unmanaged one-shots.
abort_dispatch() {
  reap_container
  cleanup_managed_codex_home
  [ -n "$SCAFFOLD_PROMPT_FILE" ] && rm -f "$SCAFFOLD_PROMPT_FILE"
  [ -n "$GROK_PROMPT_FILE" ] && rm -f "$GROK_PROMPT_FILE"
  [ -n "$CCSHIM_PROMPT_FILE" ] && rm -f "$CCSHIM_PROMPT_FILE"
  [ -n "$QODER_PROMPT_FILE" ] && rm -f "$QODER_PROMPT_FILE"
  [ -n "$CURSOR_PROMPT_FILE" ] && rm -f "$CURSOR_PROMPT_FILE"
  [ -n "$OPENCODE_PROMPT_FILE" ] && rm -f "$OPENCODE_PROMPT_FILE"
  [ -n "$AGY_ENVELOPE" ] && rm -f "$AGY_ENVELOPE"
  [ -n "$AGY_STDERR" ] && rm -f "$AGY_STDERR"
  [ -n "$AGY_PARSED" ] && rm -f "$AGY_PARSED"
  [ -n "${PACKED_PROMPT_TEMP:-}" ] && rm -f "$PACKED_PROMPT_TEMP"
  if [ -n "${AUTOPILOT_WORKTREE_ROOT_RUN_ID:-}" ]; then
    local abort_tip
    abort_tip="$(git -C "$WT" rev-parse HEAD 2>/dev/null || true)"
    if [ -n "${WT_LOCK_FD:-}" ]; then
      exec {WT_LOCK_FD}>&- || true
      WT_LOCK_FD=""
    fi
    if [[ "$abort_tip" =~ ^[0-9a-f]{40,64}$ ]] \
       && bash "$SELF_DIR/reap-dispatch-worktrees.sh" journal \
      --repo "$_wt_repo_root" \
      --root-run-id "$AUTOPILOT_WORKTREE_ROOT_RUN_ID" \
      --path "$WT" >/dev/null 2>&1; then
      bash "$SELF_DIR/reap-dispatch-worktrees.sh" reap \
        --repo "$_wt_repo_root" \
        --root-run-id "$AUTOPILOT_WORKTREE_ROOT_RUN_ID" \
        --path "$WT" --expected-tip "$abort_tip" --yes >/dev/null 2>&1 || true
    fi
  else
    reap_worktree_minimal "$WT"
    git branch -D "$BRANCH" >/dev/null 2>&1
  fi
  exit 2
}
trap abort_dispatch INT TERM

# Build the worker command line, then run it inside the strongest available
# container. The command cd's into the worktree itself (we cannot rely on a
# subshell cwd surviving the container boundary).
prepare_managed_codex_home() {
  local controller_home="${CODEX_HOME:-$HOME/.codex}"
  MANAGED_CODEX_HOME="$(mktemp -d -t autopilot-managed-codex-home-XXXXXX)" \
    || die_precondition "cannot allocate isolated managed Codex home"
  chmod 700 "$MANAGED_CODEX_HOME" \
    || die_precondition "cannot protect isolated managed Codex home"
  # Codex documents that --ignore-user-config still reads authentication from
  # CODEX_HOME. Copy only that credential file: plugin/config/session state is
  # deliberately excluded so the controller's PreToolUse hook cannot intercept
  # the managed implementer.
  if [ -r "$controller_home/auth.json" ]; then
    cp "$controller_home/auth.json" "$MANAGED_CODEX_HOME/auth.json" \
      || die_precondition "cannot stage managed Codex authentication"
    chmod 600 "$MANAGED_CODEX_HOME/auth.json" \
      || die_precondition "cannot protect managed Codex authentication"
  fi
}

cleanup_managed_codex_home() {
  [ -n "${MANAGED_CODEX_HOME:-}" ] || return 0
  case "$MANAGED_CODEX_HOME" in
    "${TMPDIR:-/tmp}"/autopilot-managed-codex-home-*)
      rm -rf -- "$MANAGED_CODEX_HOME"
      ;;
    *)
      echo "WARNING: refusing to remove unexpected managed Codex home: $MANAGED_CODEX_HOME" >&2
      ;;
  esac
  MANAGED_CODEX_HOME=""
}

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
  prepare_managed_codex_home
  run_worker bash -c 'cd "$1" && exec env -u CODEX_THREAD_ID CODEX_HOME="$6" \
      "$5" exec --ignore-user-config --model "$2" \
      --dangerously-bypass-approvals-and-sandbox \
      --dangerously-bypass-hook-trust \
      -c "model_reasoning_effort=\"$3\"" < "$4"' _ "$WT" "$MODEL" "$EFFORT" "$PROMPT_FILE" "$CODEX_BIN" "$MANAGED_CODEX_HOME"
  cleanup_managed_codex_home
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
  # --reasoning-effort: probe-verified 2026-07-25 (grok 0.2.111, grok-4.5). grok validates
  # the value against a 3-item enum and HARD-FAILS otherwise, so EFFORT must be clamped —
  # passing autopilot's default xhigh verbatim errors out. See lib/grok-effort.sh.
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
  grok_effort_note "$EFFORT" "dispatch-hetero"
  if [ -n "$RESUME_SESSION_ID" ]; then
    PROVIDER_SESSION_ID="$RESUME_SESSION_ID"
    PROVIDER_SESSION_REUSED=1
    run_worker bash -c 'cd "$1" && exec "$2" --resume "$6" --prompt-file "$3" --cwd "$1" --model "$4" \
        --reasoning-effort "$5" --always-approve --no-alt-screen --output-format json' \
        _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL" "$(grok_effort_clamp "$EFFORT")" "$RESUME_SESSION_ID"
  else
    PROVIDER_SESSION_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
    run_worker bash -c 'cd "$1" && exec "$2" --session-id "$6" --prompt-file "$3" --cwd "$1" --model "$4" \
        --reasoning-effort "$5" --always-approve --no-alt-screen --output-format json' \
        _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL" "$(grok_effort_clamp "$EFFORT")" "$PROVIDER_SESSION_ID"
  fi
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
elif [ "$IS_OPENCODE" -eq 1 ]; then
  # opencode (OpenCode CLI, `opencode run` headless). Spike-verified 2026-09-03 (opencode
  # 1.18.25, docs/plans/2026-09-03-opencode-implementer-rail.md § Stage-0):
  #   --dir anchors edits at the real worktree (no agy-style absolute-path anchor needed);
  #   the prompt is read from STDIN when no positional message is given (no ARG_MAX wall);
  #   --pure runs without the operator's external plugins (hermetic exam surface);
  #   --format json streams events (step_finish carries token usage — parsing is a follow-up,
  #   log_format stays plain and usage null); edit-only: it never commits → wrapper-commit
  #   rail, same as grok/qoderclicn. --model is a provider/model id verbatim.
  #   EFFORT → `--variant` (v2.35.14). Probe-verified 2026-09-03 on opencode-go/muse-spark-1.3-
  #   contributor (3 samples per tier, same no-tool prompt, reasoning tokens from step_finish):
  #   minimal ≈53 < low ≈103 < medium ≈171 ≈ high ≈174 < xhigh ≈201; the provider default and an
  #   UNKNOWN variant both land ≈150 (≈medium) — opencode does not validate the value, it falls
  #   through silently. So the value we send must be one the provider knows: autopilot's `max`
  #   is clamped to `xhigh` (models.dev reasoning_options for this model: minimal|low|medium|
  #   high|xhigh); `minimal` is not in autopilot's effort vocabulary and cannot be requested.
  OPENCODE_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

"
  OPENCODE_PROMPT_FILE="$(mktemp -t dispatch-hetero-opencode-prompt-XXXXXX)"
  printf '%s' "${OPENCODE_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$OPENCODE_PROMPT_FILE"
  OPENCODE_VARIANT="$EFFORT"; [ "$OPENCODE_VARIANT" = "max" ] && OPENCODE_VARIANT="xhigh"
  run_worker bash -c 'cd "$1" && exec "$2" run --dir "$1" --pure -m "$4" --variant "$5" --format json < "$3"' \
      _ "$WT" "$OPENCODE_BIN" "$OPENCODE_PROMPT_FILE" "$MODEL" "$OPENCODE_VARIANT"
  rm -f "$OPENCODE_PROMPT_FILE"
elif [ "$IS_CURSOR" -eq 1 ]; then
  # cursor-agent (Cursor CLI). Probe-verified 2026-08-26 (2026.08.11-e8db854), see
  # docs/plans/2026-08-26-cursor-cli-adaptor.md §0.1:
  #   P4/P5 cwd AND --workspace anchor edits → no agy-style absolute-path anchor.
  #   P6 edit-only by default → wrapper commits, same rail as grok/qoderclicn.
  #   P3 --trust is MANDATORY headlessly. P8 -f auto-approves tools. P7 -p reads stdin.
  #   P12 effort is the MODEL ID, not a flag — do NOT add --reasoning-effort.
  CURSOR_EDIT_ONLY="=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===
Make ONLY the file edits the task requires, in the current working directory. Do NOT
git commit, git push, or open a PR — the harness commits your edits and a separate review
verifies them. Ignore any instruction in the task below to commit, push, or open a PR.
===

"
  # Feed the prompt via STDIN (P7), NOT a positional argv arg: a large task prompt as one
  # arg can hit ARG_MAX before cursor-agent runs. --workspace anchors edits at the real
  # worktree (P4/P5), so no agy-style absolute-path anchor is needed. Same edit-only +
  # wrapper-commit rail as grok/qoderclicn.
  CURSOR_PROMPT_FILE="$(mktemp -t dispatch-hetero-cursor-prompt-XXXXXX)"
  printf '%s' "${CURSOR_EDIT_ONLY}$(cat "$PROMPT_FILE")" > "$CURSOR_PROMPT_FILE"
  run_worker bash -c 'cd "$1" && exec "$2" -p --trust --force --workspace "$1" \
      --model "$4" --output-format stream-json < "$3"' \
      _ "$WT" "$CURSOR_BIN" "$CURSOR_PROMPT_FILE" "$MODEL"
  rm -f "$CURSOR_PROMPT_FILE"
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
  # $(...) strips trailing newlines, so the directive's terminating blank line is re-appended
  # here: it is what separates the directive from the task prompt in the bytes agy receives.
  AGY_EDIT_ONLY="$(agy_edit_only_directive "$WT")"$'\n\n'
  AGY_ENVELOPE="$(mktemp -t dispatch-hetero-agy-envelope-XXXXXX)"
  AGY_STDERR="$(mktemp -t dispatch-hetero-agy-stderr-XXXXXX)"
  AGY_PARSED="$(mktemp -t dispatch-hetero-agy-parsed-XXXXXX)"
  AGY_USAGE_JSON="null"
  run_worker bash -c 'cd "$1" && exec "$2" -p "$3" --model "$4" \
      --dangerously-skip-permissions --output-format json --print-timeout "$5" \
      >"$6" 2>"$7"' \
      _ "$WT" "$AGY_BIN" "${AGY_EDIT_ONLY}$(cat "$PROMPT_FILE")" "$MODEL" "$TIMEOUT" \
      "$AGY_ENVELOPE" "$AGY_STDERR"
  if [ "$AGENT_EXIT" -ne 0 ]; then
    cat "$AGY_STDERR" >> "$LOG"
    printf '\n[dispatch-hetero: agy exited non-zero (rc=%s) — native envelope and usage NOT parsed]\n' \
      "$AGENT_EXIT" >> "$LOG"
    return 0
  fi
  if ! node "$SELF_DIR/dispatch-status.js" --log "$AGY_ENVELOPE" --agy-envelope \
      > "$AGY_PARSED" 2>/dev/null; then
    # TELEMETRY LOSS, NOT A VERDICT (2026-09-03, Board). The envelope is the usage channel;
    # when it does not parse, usage stays null and the run is classified from git
    # artifacts exactly like every other rail (commit + clean tree + exit 0 → committed).
    # Until v2.35.12 this set AGENT_EXIT=65 and turned a landed commit into `failure`:
    # the 2026-08-22 gemini implementer seats lost 6/8, 2/8 and 6/8 create-a-new-file
    # cases to a malformed envelope with the edits sitting in the tree (BACKLOG "agy
    # output envelope invalid"). The envelope BODY is now kept in the log (bounded) so
    # the next administration can see what agy actually sent — nothing was retained
    # before, which is why that BACKLOG row still has no reproduction.
    cat "$AGY_STDERR" >> "$LOG"
    printf '\n[dispatch-hetero: agy native JSON envelope invalid — usage NOT parsed (null); status decided from git artifacts. Raw envelope (first 64 KiB) follows]\n' \
      >> "$LOG"
    head -c 65536 "$AGY_ENVELOPE" >> "$LOG" 2>/dev/null || true
    printf '\n[dispatch-hetero: end of raw envelope]\n' >> "$LOG"
    [ -n "${DISPATCH_QUIET:-}" ] || echo "dispatch-hetero: agy native JSON envelope invalid — usage null; status from git artifacts (see $LOG)" >&2
    AGY_USAGE_JSON="null"
    return 0
  fi
  node - "$AGY_PARSED" "$LOG" <<'NODE'
const fs = require('fs');
const parsed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], parsed.response);
NODE
  AGY_USAGE_JSON="$(node -e '
    const fs = require("fs");
    process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).usage));
  ' "$AGY_PARSED")"
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
  _runner_label="agy"; [ "$IS_CODEX" -eq 1 ] && _runner_label="codex"; [ "$IS_GROK" -eq 1 ] && _runner_label="grok"; [ "$IS_CCSHIM" -eq 1 ] && _runner_label="cc-shim"; [ "$IS_PI" -eq 1 ] && _runner_label="pi"; [ "$IS_QODER" -eq 1 ] && _runner_label="qoderclicn"; [ "$IS_CURSOR" -eq 1 ] && _runner_label="cursor"; [ "$IS_OPENCODE" -eq 1 ] && _runner_label="opencode"
  git -C "$WT" add -A
  if ! run_strict_staged_precheck; then
    # Staged manifest violation: leave the worktree staged for in-place repair;
    # classify_outcome surfaces boundary_rejected on the equality branch.
    :
  else
  _identity_args=()
  if ! git -C "$WT" var GIT_AUTHOR_IDENT >/dev/null 2>&1 \
     || ! git -C "$WT" var GIT_COMMITTER_IDENT >/dev/null 2>&1; then
    _identity_args=(-c user.email=autopilot@example.invalid -c user.name=Autopilot)
  fi
  git -C "$WT" -c commit.gpgsign=false "${_identity_args[@]}" commit --no-verify -q -m "dispatch-hetero($_runner_label): edits on $BRANCH" >/dev/null 2>&1
  fi
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

# Pre-commit manifest gate (P6D KR2, plan R2' 2026-08-21; GO checkpoint scoped
# to WRAPPER-OWNED staging). The P6D incident's broad `git add -A` swept two
# dependency symlinks into an otherwise-green candidate; the post-commit
# boundary gate caught it only after the commit existed. This precheck runs the
# SAME comparator (check-disjointness --staged) between the wrapper's `add -A`
# and its capture commit: a violation leaves the worktree staged-but-uncommitted
# (repairable in place) and the run classifies boundary_rejected. Engines that
# self-commit never pass through here — the post-commit gate remains their
# authoritative (and tested) backstop.
STRICT_PRECOMMIT_REJECTED=0
run_strict_staged_precheck() {
  local allow_file deny_file staged_out staged_rc out_dir temp_path
  [ "$STRICT_CONTRACT" -eq 1 ] || return 0
  if [ "${#STRICT_SCOPE_ALLOW_PATHS[@]}" -eq 0 ] && [ "${#STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}" -eq 0 ]; then
    return 0 # no declared manifest → postcheck will fail it authoritatively
  fi
  allow_file="$(mktemp -t "hetero-staged-allow-XXXXXX")" || {
    STRICT_PRECOMMIT_REJECTED=1
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate staged-precheck allow temp file"
    return 1
  }
  for out_dir in "${STRICT_SCOPE_ALLOW_PATHS[@]}" "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
    [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$allow_file"
  done
  deny_file=""
  if [ "${#STRICT_SCOPE_DENY_PATHS[@]}" -gt 0 ]; then
    deny_file="$(mktemp -t "hetero-staged-deny-XXXXXX")" || {
      rm -f "$allow_file"
      STRICT_PRECOMMIT_REJECTED=1
      STRICT_POSTCHECK_STATUS="boundary_rejected"
      STRICT_POSTCHECK_ERROR="boundary_rejected: failed to allocate staged-precheck deny temp file"
      return 1
    }
    for out_dir in "${STRICT_SCOPE_DENY_PATHS[@]}"; do
      [ -n "$out_dir" ] && printf '%s\n' "$out_dir" >> "$deny_file"
    done
  fi
  if [ -n "$deny_file" ]; then
    staged_out="$( "$SELF_DIR/check-disjointness.sh" validate --staged --repo "$WT" --no-default-deny --allow-file "$allow_file" --deny-file "$deny_file" 2>&1 )" && staged_rc=0 || staged_rc=$?
  else
    staged_out="$( "$SELF_DIR/check-disjointness.sh" validate --staged --repo "$WT" --no-default-deny --allow-file "$allow_file" 2>&1 )" && staged_rc=0 || staged_rc=$?
  fi
  rm -f "$allow_file"; [ -n "$deny_file" ] && rm -f "$deny_file"
  if [ "$staged_rc" -ne 0 ]; then
    local undeclared_touches deny_hits_json
    undeclared_touches="$(printf '%s' "$staged_out" | extract_json_value undeclared_touches 2>/dev/null || true)"
    deny_hits_json="$(printf '%s' "$staged_out" | extract_json_value denylist_hits 2>/dev/null || true)"
    if [ -n "$deny_hits_json" ] && [ "$deny_hits_json" != "null" ]; then
      temp_path="$(printf '%s' "$deny_hits_json" | json_array_first)"
    elif [ -n "$undeclared_touches" ] && [ "$undeclared_touches" != "null" ]; then
      temp_path="$(printf '%s' "$undeclared_touches" | json_array_first)"
    else
      temp_path=""
    fi
    STRICT_PRECOMMIT_REJECTED=1
    STRICT_POSTCHECK_STATUS="boundary_rejected"
    if [ -n "$temp_path" ]; then
      STRICT_POSTCHECK_ERROR="boundary_rejected: staged path violates scope '${temp_path}' (pre-commit manifest gate; commit NOT created; unstage/remove the extra paths and rerun)"
    else
      STRICT_POSTCHECK_ERROR="boundary_rejected: staged paths violate scope (pre-commit manifest gate; commit NOT created); ${staged_out}"
    fi
    return 1
  fi
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

  # Collect exact changed paths once for output-path role checks.
  while IFS= read -r temp_path; do
    [ -n "$temp_path" ] && changed_paths+=("$temp_path")
  done < <(git -C "$WT" diff --name-only "$BASE_SHA..$HEAD_SHA")

  for temp_path in "${changed_paths[@]}"; do
    changed_set["$temp_path"]=1
  done

  # Output-path roles:
  # - Unit contracts (legacy): output.paths are required deliverables — every listed
  #   path must appear in the candidate diff.
  # - Mission/campaign sealed authority: output.paths are the authorized create/modify
  #   surface. A narrow repair need not touch every authorized path; changed paths
  #   that are not authorized (and not generated mirrors) fail closed.
  # - required_change_paths: every listed path MUST appear in an effectful candidate
  #   diff. Digest-bound no-op (zero changed paths + sealed no-op proof) is the only
  #   exemption.
  if [ "${#STRICT_OUTPUT_PATHS[@]}" -gt 0 ]; then
    if [ "${CAMPAIGN_STRICT_AUTHORITY:-0}" -eq 1 ]; then
      local -A authorized_set=()
      for out_dir in "${STRICT_OUTPUT_PATHS[@]}"; do
        authorized_set["$out_dir"]=1
      done
      for out_dir in "${STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS[@]}"; do
        authorized_set["$out_dir"]=1
      done
      for temp_path in "${changed_paths[@]}"; do
        if [ -z "${authorized_set["$temp_path"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: changed path '$temp_path' is outside sealed output surface"
          return 1
        fi
      done
    else
      for out_dir in "${STRICT_OUTPUT_PATHS[@]}"; do
        if [ -z "${changed_set["$out_dir"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: output path '$out_dir' missing from changed files"
          return 1
        fi
      done
    fi
  fi

  if [ "${#STRICT_REQUIRED_CHANGE_PATHS[@]}" -gt 0 ]; then
    local effectful=1
    if [ "${#changed_paths[@]}" -eq 0 ]; then
      # Zero-change candidates require the sealed zero_diff_receipt embedded in
      # the dispatch-unit contract. Ambient STRICT_NOOP_RECEIPT_PATH is never
      # authority (caller-injectable env is rejected).
      if [ -n "${STRICT_NOOP_RECEIPT_PATH:-}" ]; then
        STRICT_POSTCHECK_STATUS="boundary_rejected"
        STRICT_POSTCHECK_ERROR="boundary_rejected: ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
        return 1
      fi
      local __noop_verify __noop_validator
      __noop_validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
      __noop_verify="$(
        node "$__noop_validator" validate \
          --contract "$CONTRACT_FILE" \
          --base "$BASE_SHA" \
          --worktree "$WT" \
          --print-ok 2>/dev/null || true
      )"
      if [ "$__noop_verify" != "ok" ]; then
        STRICT_POSTCHECK_STATUS="boundary_rejected"
        STRICT_POSTCHECK_ERROR="boundary_rejected: no-op receipt failed verification (${__noop_verify:-missing})"
        return 1
      fi
      effectful=0
    fi
    if [ "$effectful" -eq 1 ]; then
      for req_path in "${STRICT_REQUIRED_CHANGE_PATHS[@]}"; do
        if [ -z "${changed_set["$req_path"]+x}" ]; then
          STRICT_POSTCHECK_STATUS="boundary_rejected"
          STRICT_POSTCHECK_ERROR="boundary_rejected: required_change_path '$req_path' missing from candidate diff"
          return 1
        fi
      done
    fi
  fi

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

# _hetero_runner_token — the single derivation of "which runner is this dispatch using"
# from the IS_CODEX/IS_GROK/IS_CCSHIM/IS_PI/IS_QODER/IS_CURSOR/IS_OPENCODE flags, shared by
# passive_capture and seat_strike_capture (factored out rather than copy-pasted, per repo
# convention).
_hetero_runner_token() {
  local runner="agy"
  [ "${IS_CODEX:-0}" -eq 1 ] && runner="codex"
  [ "${IS_GROK:-0}" -eq 1 ] && runner="grok"
  [ "${IS_CCSHIM:-0}" -eq 1 ] && runner="cc-shim"
  [ "${IS_PI:-0}" -eq 1 ] && runner="pi"
  [ "${IS_QODER:-0}" -eq 1 ] && runner="qoderclicn"
  [ "${IS_CURSOR:-0}" -eq 1 ] && runner="cursor"
  [ "${IS_OPENCODE:-0}" -eq 1 ] && runner="opencode"
  printf '%s' "$runner"
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
        local runner; runner="$(_hetero_runner_token)"
        local observed_at; observed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        # Exact effort/endpoint tuple — null endpoint means explicit no-endpoint wallet.
        local _ep_key="${ENDPOINT:-}"
        local payload
        payload="$(OBSERVED_AT="$observed_at" RUNNER="$runner" MODEL="$MODEL" STATUS="$quota_status" CONFIDENCE="$confidence" EFFORT="${EFFORT:-}" ENDPOINT_KEY="$_ep_key" node -e '
          const p = process.env;
          const endpoint = (p.ENDPOINT_KEY && p.ENDPOINT_KEY.length > 0) ? p.ENDPOINT_KEY : null;
          const payload = {
            schema_version: 1,
            observed_at: p.OBSERVED_AT,
            runner: p.RUNNER,
            model: p.MODEL,
            role: "implementer",
            effort: p.EFFORT || null,
            endpoint,
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

# Detector identity for seat_strike_capture's strikes (references/strike-decay.md).
# Bump this literal whenever the classification logic below materially changes.
STRIKE_DETECTOR_VERSION="1"

# seat_strike_capture — the FIRST REAL PRODUCTION WRITER of seat-scoped no-confidence
# strikes (references/strike-decay.md, scripts/engine-capability-state.js `strike-seat`).
# Fires ONLY on a post-dispatcher_called fail-closed OUTCOME_STATUS: the pair was routed
# and did not deliver. Always fail-soft — never changes this script's own exit code,
# stdout bytes, or OUTCOME_* state (wrapped exactly like passive_capture: subshell,
# output to /dev/null, `|| true`).
#
# THE CLOSED EXCLUSION LIST — read this comment, don't trace control flow, to know what
# never strikes:
#   1. AUTOPILOT_STRIKE_WRITER=off          — operator escape hatch so debugging the rail
#                                             can never poison the store. Default is ON.
#   2. OUTCOME_DISPATCHER_CALLED = 0        — pre-dispatch host abort; nothing was routed.
#   3. OUTCOME_STATUS = engine_unavailable  — the closed external-cause enum in practice:
#                                             quota_exhausted | rate_limited | auth_failed |
#                                             overloaded, per _is_engine_unavailable().
#   4. OUTCOME_STATUS in {committed, no_op, question_suspected} — success, or not a
#                                             fail-closed delivery outcome.
# Everything else that reaches here with dispatcher_called=1 is strike-eligible.
#
# FINDING 6 fix (2026-08-22 review repair): exclusion #1 (AUTOPILOT_STRIKE_WRITER=off)
# is now evaluated LAST, after strike-eligibility (exclusions #2-#4) is already
# decided — so we know whether this run WOULD have struck before deciding whether the
# hatch suppresses it. A suppressed strike is never silent: STRIKE_WRITER_SUPPRESSED
# is set and write_manifest is called again so the run's manifest sidecar carries
# `strike_writer_suppressed: true` + the seat. This never touches OUTCOME_*, this
# script's stdout, or its exit code — same fail-soft contract as before.
seat_strike_capture() {
  [ "${OUTCOME_DISPATCHER_CALLED:-1}" -eq 0 ] && return 0

  local status="${OUTCOME_STATUS:-}"
  local cause_class=""
  # cause_class mapping — derived ONLY from the host's own classification of OUTCOME_STATUS,
  # never from anything the runner said about itself (ADR-0001). Diagnostic only; never
  # suppresses accrual (references/strike-decay.md § The seat is the pair).
  case "$status" in
    # strict-contract boundary/acceptance rejections: the host mechanically re-derived a
    # false predicate against what the engine produced — engine-attributable.
    acceptance_failed|boundary_rejected)
      cause_class="engine_output" ;;
    # an envelope/transport-shaped failure the host detected (unparseable result, not a
    # content judgment) — delivery is part of the pair's contract (strike-decay.md), so
    # this STILL ACCRUES; cause_class only steers remedy at threshold.
    no_verdict)
      cause_class="runner_delivery" ;;
    # generic fail-closed outcomes (nonzero exit, dirty tree) where the host cannot
    # mechanically attribute fault to engine vs runner from that signal alone.
    failure|dirty)
      cause_class="ambiguous" ;;
    # BLOCKER 3 fix (2026-08-22 review repair): OUTCOME_STATUS=engine_unavailable is set
    # in classify_outcome from CLASSIFIED_ERROR, which is classify-error's LOG-TEXT match
    # FIRST, exit code only as a fallback when text is unknown — i.e. it can be driven
    # entirely by prose the measured engine itself wrote to its own stdout. "A runner is
    # never trusted to label its own failure 'transport'" (strike-decay.md), so the STRIKE
    # EXCLUSION may not ride on that text-tainted classification. Re-derive independently
    # from the EXIT CODE ALONE (no --string/--file — engine-capability-state.js's
    # classify-error then exercises only its host-observed exit-code map, :2132-2143 as of
    # the review) and only honor the exclusion if THAT reclassification also names a
    # transport signal. A text-only "engine_unavailable" (ordinary host exit code) is not
    # host-corroborated, so it falls through and accrues, diagnostically ambiguous — this
    # changes only what the strike writer treats as excluded, never OUTCOME_STATUS/stdout.
    engine_unavailable)
      local __exit_only_class=""
      __exit_only_class="$("$SELF_DIR/engine-capability-state.js" classify-error --exit-code "${AGENT_EXIT:-0}" 2>/dev/null)" || __exit_only_class=""
      if _is_engine_unavailable "$__exit_only_class"; then
        return 0
      fi
      cause_class="ambiguous" ;;
    # everything else — committed / no_op / question_suspected / any status not in the
    # fail-closed set — is not a strike.
    *)
      return 0 ;;
  esac

  # A strike WOULD be written from this point on — every exclusion has already
  # returned. Only now does the debug hatch get to suppress it, and only LOUDLY:
  # set outside the write subshell (subshell vars don't survive back to this
  # function) so write_manifest can stamp the manifest sidecar before we return.
  if [ "${AUTOPILOT_STRIKE_WRITER:-on}" = "off" ]; then
    STRIKE_WRITER_SUPPRESSED="1"
    STRIKE_WRITER_SUPPRESSED_SEAT="$MODEL/$(_hetero_runner_token)/implementer"
    write_manifest 2>/dev/null || true
    return 0
  fi

  (
    local runner; runner="$(_hetero_runner_token)"
    local artifact_sha=""
    if [ -n "${LOG:-}" ] && [ -r "${LOG:-}" ]; then
      artifact_sha="$(sha256sum "$LOG" 2>/dev/null | awk '{print $1}')"
    fi
    if [ -z "$artifact_sha" ]; then
      # $LOG unreadable — fall back to the sha256 of the outcome JSON (a real digest of
      # a real artifact, never a placeholder). Built directly from OUTCOME_* env vars —
      # deliberately NOT calling emit() here, which has real side effects (git-identity
      # restore) this fail-soft path must never trigger twice.
      local outcome_json
      outcome_json="$(OUTCOME_STATUS="${OUTCOME_STATUS:-}" OUTCOME_COMMIT="${OUTCOME_COMMIT:-}" \
        OUTCOME_FILES="${OUTCOME_FILES:-0}" OUTCOME_INS="${OUTCOME_INS:-0}" \
        OUTCOME_DEL="${OUTCOME_DEL:-0}" OUTCOME_WT="${OUTCOME_WT:-}" \
        OUTCOME_ERR="${OUTCOME_ERR:-}" node -e '
          const p = process.env;
          process.stdout.write(JSON.stringify({
            status: p.OUTCOME_STATUS, commit: p.OUTCOME_COMMIT,
            files: Number(p.OUTCOME_FILES), ins: Number(p.OUTCOME_INS), del: Number(p.OUTCOME_DEL),
            worktree: p.OUTCOME_WT, error: p.OUTCOME_ERR
          }));
        ' 2>/dev/null)" || outcome_json=""
      artifact_sha="$(printf '%s' "$outcome_json" | sha256sum 2>/dev/null | awk '{print $1}')"
    fi
    [ -z "$artifact_sha" ] && exit 0

    # dedup_key: frozen contract §2.7.2 — "<non-empty: root-incident id + detector id>".
    # Root-incident id (DISPATCH_RUN_ID is the caller-supplied --run-id when given — a
    # retry that reuses the same run-id collides on purpose — or else a per-process id
    # already unique by construction), bound to base/head sha + the outcome status, PLUS
    # the detector id (same value passed as --detector-id below) so the key composition
    # matches the contract literally, not just in spirit. No timestamp, no bare $$:
    # retrying the SAME root incident dedups; two genuinely different dispatches
    # (different run id and/or different shas) do not.
    local dedup_key="${DISPATCH_RUN_ID:-unknown}:${BASE_SHA:-unknown}:${HEAD_SHA:-unknown}:${status}:dispatch_hetero_classify_outcome"
    local receipt_ref="log=${LOG:-none} commit=${HEAD_SHA:-none}"

    local strike_args=(
      strike-seat
      --engine "$MODEL"
      --runner "$runner"
      --role implementer
      --class ordinary_strike
      --cause-class "$cause_class"
      --writer dispatch_hetero_failclosed
      --dedup-key "$dedup_key"
      --detector-id dispatch_hetero_classify_outcome
      --detector-version "${STRIKE_DETECTOR_VERSION:-1}"
      --artifact-sha256 "$artifact_sha"
      --receipt-ref "$receipt_ref"
    )
    if [ -n "${ENGINE_CAPABILITY_DIR:-}" ]; then
      strike_args+=(--store "$ENGINE_CAPABILITY_DIR")
    fi
    node "$SELF_DIR/engine-capability-state.js" "${strike_args[@]}" >/dev/null 2>&1
  ) || true
}

# classify_outcome — the SINGLE source of truth for status/exit/JSON-fields, shared by the
# inline path (→ emit to stdout + exit) and the detached child (→ write-result + ledger). It
# sets OUTCOME_* and performs the outcome-specific side effects (passive_capture; worktree
# removal on clean success) EXACTLY as the pre-R1 inline tree did — the existing hetero tests
# assert the resulting stdout/exit byte-for-byte, guarding this refactor.
classify_outcome() {
  OUTCOME_STATUS=""; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"; OUTCOME_ERR=""; OUTCOME_EXIT=1
  OUTCOME_DISPATCHER_CALLED=1
  OUTCOME_MODEL_CALLS=1
  OUTCOME_MUTATION_ATTEMPTS=1
  OUTCOME_GATE_ATTEMPTS=0
  OUTCOME_RESOURCES_CREATED=1
  [ "${WORKTREE_REUSED:-0}" -eq 1 ] && OUTCOME_RESOURCES_CREATED=0
  OUTCOME_ZERO_DIFF_RECEIPT_DIGEST=""
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
    # --- no new commit: equality branch ---
    # Exact sealed zero_diff_receipt must be validated HERE (not only inside the
    # HEAD!=BASE strict postcheck path). Valid receipt → explicit successful
    # no-op with dispatcher_called:false semantics. Missing/forged/stale/foreign
    # receipt remains ordinary no_op/failure.
    if [ "${STRICT_PRECOMMIT_REJECTED:-0}" -eq 1 ]; then
      # Pre-commit manifest gate refusal (KR2): staged extras named, commit never
      # created, worktree kept staged for the cheap in-place repair (KR3 ladder
      # points here). Authoritative boundary_rejected, same family as postcheck.
      passive_capture "failure"
      OUTCOME_STATUS="boundary_rejected"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="$STRICT_POSTCHECK_ERROR"; OUTCOME_EXIT=1
    elif [ -n "$DIRTY" ]; then
      # edits exist but were never committed — e.g. the agy wrapper-commit above failed,
      # or the worker hand-edited without committing. Surface it (don't mis-score no_op).
      passive_capture "dirty"
      OUTCOME_STATUS="dirty"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
      OUTCOME_ERR="edits left uncommitted, no commit made (wrapper commit may have failed; agent exit $AGENT_EXIT); worktree kept"; OUTCOME_EXIT=1
    elif [ "$AGENT_EXIT" -eq 0 ]; then
      local __eq_noop_status=""
      if [ "$STRICT_CONTRACT" -eq 1 ] && [ -n "${STRICT_NOOP_RECEIPT_PATH:-}" ]; then
        passive_capture "failure"
        OUTCOME_STATUS="failure"
        OUTCOME_COMMIT=""
        OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="ambient STRICT_NOOP_RECEIPT_PATH is not authority; seal zero_diff_receipt into the dispatch unit"
        OUTCOME_EXIT=1
        __eq_noop_status="rejected"
      elif [ "$STRICT_CONTRACT" -eq 1 ] && [ -n "${CONTRACT_FILE:-}" ] && [ -r "${CONTRACT_FILE:-}" ]; then
        local __eq_noop_verify __eq_noop_validator
        __eq_noop_validator="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/engine/sealed-zero-diff-validator.js"
        __eq_noop_verify="$(
          node "$__eq_noop_validator" validate \
            --contract "$CONTRACT_FILE" \
            --base "$BASE_SHA" \
            --worktree "$WT" \
            --print-ok 2>/dev/null || true
        )" || __eq_noop_verify="verify_failed"
        if [ "$__eq_noop_verify" = "ok" ]; then
          __eq_noop_status="sealed_zero_diff"
        elif [ -n "$__eq_noop_verify" ] && [ "$__eq_noop_verify" != "missing_sealed_receipt" ]; then
          # Forged/stale/foreign sealed receipt is fail-closed, not soft no_op.
          passive_capture "failure"
          OUTCOME_STATUS="failure"
          OUTCOME_COMMIT=""
          OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
          OUTCOME_ERR="zero_diff_receipt rejected on equality branch: $__eq_noop_verify"
          OUTCOME_EXIT=1
          __eq_noop_status="rejected"
        fi
      fi
      if [ "$__eq_noop_status" = "sealed_zero_diff" ]; then
        # Explicit successful sealed no-op: zero model/mutation effects; dispatcher_called=false.
        passive_capture "no_op"
        OUTCOME_STATUS="no_op"
        OUTCOME_COMMIT=""
        OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="sealed zero_diff_receipt validated on equality branch (dispatcher_called=false)"
        OUTCOME_EXIT=0
        OUTCOME_DISPATCHER_CALLED=0
        OUTCOME_MODEL_CALLS=0
        OUTCOME_MUTATION_ATTEMPTS=0
        OUTCOME_GATE_ATTEMPTS=0
        OUTCOME_RESOURCES_CREATED=0
        OUTCOME_ZERO_DIFF_RECEIPT_DIGEST="$(
          extract_file_json_value "$CONTRACT_FILE" "output.zero_diff_receipt.digest" \
            2>/dev/null || true
        )"
      elif [ "$__eq_noop_status" != "rejected" ]; then
        # Ordinary no-op (no sealed receipt or not under strict contract)
        passive_capture "no_op"
        OUTCOME_STATUS="no_op"; OUTCOME_COMMIT=""; OUTCOME_FILES=0; OUTCOME_INS=0; OUTCOME_DEL=0; OUTCOME_WT="$WT"
        OUTCOME_ERR="agent exited cleanly with no commit — judged nothing was needed (agent exit 0); worktree kept"; OUTCOME_EXIT=1
      fi
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
  # Seat strike writer (P4, references/strike-decay.md) — fail-soft, never mutates
  # OUTCOME_* or this function's already-decided status/exit.
  seat_strike_capture
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
  local campaign_prompt_for_child="${CAMPAIGN_PROMPT_FILE:-}"
  # Decouple from the caller's prompt temp lifecycle: copy it into a child-owned file so the
  # parent's EXIT cleanup cannot yank it mid-run.
  local child_prompt="$RESULTS_DIR/${RUN_ID}.${STAGE}.prompt"
  if cp -f "$PROMPT_FILE" "$child_prompt" 2>/dev/null; then PROMPT_FILE="$child_prompt"; fi
  # Acquire the lease AS THIS detached process (records our pid/start_time → the watchdog can
  # tell alive-vs-dead). --allow-reopen so an orchestrator pre-lease is renewed, not rejected.
  DETACH_SELF_PID="$$"
  local acq
  if ! acq="$(bash "$run_ledger" stage-transfer \
    --ledger "$LEDGER" --run-id "$RUN_ID" --stage "$STAGE" \
    --generation "$DETACH_PRECLAIM_GEN" --nonce "$DETACH_PRECLAIM_NONCE" \
    --pid "$DETACH_SELF_PID" --git-ref "refs/heads/$BRANCH" \
    --worktree "$WT" 2>/dev/null)"; then
    exit 2
  fi
  DETACH_GEN="$(printf '%s' "$acq" | jq -r '.generation // empty' 2>/dev/null || true)"
  DETACH_NONCE="$(printf '%s' "$acq" | jq -r '.nonce // empty' 2>/dev/null || true)"
  if [ -z "$DETACH_GEN" ] || [ -z "$DETACH_NONCE" ]; then
    exit 2
  fi
  # WO owner/runner/lease → this detached child (parent claim already cleared).
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ]; then
    node "$SELF_DIR/compaction-rehydrate.js" heartbeat --git-cwd "$(pwd)" \
      --root-run-id "$_CONT_WO_CLAIMED_ROOT" --graph-node "${_CONT_WO_CLAIMED_STAGE:-implement}" \
      --attempt 1 --owner-pid "$$" --runner self --transfer-owner >/dev/null 2>&1 || exit 2
  fi
  write_manifest "$DETACH_SELF_PID"
  local hb_pid=""
  heartbeat_loop &
  hb_pid=$!
  # run the engine worker (in-session), then finalize by artifact
  run_agent
  [ -n "$hb_pid" ] && { kill "$hb_pid" 2>/dev/null || true; wait "$hb_pid" 2>/dev/null || true; }
  compute_artifacts
  classify_outcome
  # Detached child owns continuation WO terminalization; parent must not mark stale failed.
  if [ -n "${_CONT_WO_CLAIMED_ROOT:-}" ]; then
    if ! _cont_finalize_or_die; then
      OUTCOME_STATUS="failure"
      OUTCOME_ERR="work order terminal finalizer failed closed"
      OUTCOME_EXIT=1
    fi
  fi
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
  [ -n "$campaign_prompt_for_child" ] && rm -f "$campaign_prompt_for_child" 2>/dev/null || true
  [ -n "${AGY_ENVELOPE:-}" ] && rm -f "$AGY_ENVELOPE" 2>/dev/null || true
  [ -n "${AGY_STDERR:-}" ] && rm -f "$AGY_STDERR" 2>/dev/null || true
  [ -n "${AGY_PARSED:-}" ] && rm -f "$AGY_PARSED" 2>/dev/null || true
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
  declare -p MODEL BASE TIMEOUT AGY_BIN GROK_BIN CODEX_BIN QODER_BIN CURSOR_BIN OPENCODE_BIN KEEP RETENTION_OWNER RETENTION_REASON RETENTION_REASON_SHA256 RETENTION_EXPIRES_AT REUSE_WORKTREE RESUME_SESSION_ID PROVIDER_SESSION_ID PROVIDER_SESSION_REUSED WORKTREE_REUSED BRANCH PROMPT_FILE RUNNER EFFORT \
      SELF_DIR IS_CODEX IS_GROK IS_CCSHIM IS_PI IS_QODER IS_CURSOR IS_OPENCODE RUNNER_RESOLVED CURSOR_FAST PI_BIN MANAGED_CODEX_HOME CONTAINMENT CONTAINED IDENTITY_DRIFT IDENTITY_PRE_NAME IDENTITY_PRE_EMAIL IDENTITY_REPO_ROOT EFFECTIVE_SKILL_MODE SKILLS_INJECTED_JSON \
      WT LOG BASE_SHA HAVE_CGROUP HAVE_SETSID SCOPE_UNIT WORKER_SID GROK_PROMPT_FILE CCSHIM_PROMPT_FILE QODER_PROMPT_FILE CURSOR_PROMPT_FILE OPENCODE_PROMPT_FILE \
      AGY_ENVELOPE AGY_STDERR AGY_PARSED AGY_USAGE_JSON \
      PACKED_PROMPT_TEMP LEDGER RUN_ID STAGE RESULTS_DIR RESULT_FILE EXIT_FILE HEARTBEAT_SECS \
      STRICT_CONTRACT STRICT_CONTRACT_RESULT_FIELDS STRICT_UNIT_ID STRICT_CONTRACT_SHA STRICT_SPEC_SHA STRICT_GO STRICT_ENGINE_ASSURANCE CONSUMING_REPO_ROOT CONTRACT_FILE_SUPPLIED CONTRACT_FILE \
      CAMPAIGN_CONTRACT_SHA256 CAMPAIGN_ID CAMPAIGN_MISSION_MODE CAMPAIGN_STRICT_AUTHORITY CAMPAIGN_PROJECTION_BOUND \
      OUTCOME_STATUS OUTCOME_COMMIT OUTCOME_FILES OUTCOME_INS OUTCOME_DEL OUTCOME_WT OUTCOME_ERR OUTCOME_EXIT \
      OUTCOME_DISPATCHER_CALLED OUTCOME_MODEL_CALLS OUTCOME_MUTATION_ATTEMPTS OUTCOME_GATE_ATTEMPTS OUTCOME_RESOURCES_CREATED OUTCOME_ZERO_DIFF_RECEIPT_DIGEST \
      CLASSIFIED_ERROR \
      ORPHAN_LOG OUTCOME_ORPHAN WT_LOCK_FD LINEAGE_PARENT LINEAGE_ROOT WORKTREE_ROOT_RUN_ID LINEAGE_DEPTH \
      STRICT_SCOPE_ALLOW_PATHS STRICT_SCOPE_DENY_PATHS STRICT_SCOPE_GENERATED_MIRROR_ALLOW_PATHS STRICT_SCOPE_MAX_FILES STRICT_SCOPE_MAX_DIFF_LINES STRICT_OUTPUT_PATHS STRICT_REQUIRED_CHANGE_PATHS STRICT_POSTCHECK_OK STRICT_POSTCHECK_STATUS STRICT_POSTCHECK_ERROR \
      DISPATCH_RUN_ID DISPATCH_STARTED_EPOCH MANIFEST_DIR_PATH MANIFEST_FILE MANIFEST_CONTAINMENT \
      MANIFEST_SCOPE_UNIT MANIFEST_PID_RECORDED MANIFEST_ENDED_AT MANIFEST_ENDED_EPOCH MANIFEST_FINAL_STATUS 2>/dev/null
    declare -p DETACH_PRECLAIM_GEN DETACH_PRECLAIM_NONCE 2>/dev/null
    declare -p _CONT_WO_CLAIMED_ROOT _CONT_WO_CLAIMED_STAGE _CONT_WO_PARENT_TRANSFERRED 2>/dev/null
    declare -p CAMPAIGN_PROMPT_FILE 2>/dev/null
    declare -p ENGINE_CAPABILITY_DIR 2>/dev/null || true
    # Preserve pi supervisor poll/stall bounds across setsid detach.
    declare -p PI_RPC_DIRECTIVE_POLL_SECS PI_RPC_STALL_PROBE_SECS PI_RPC_MAX_SECS PI_RPC_PROVIDER PI_MODELS_JSON 2>/dev/null || true
    declare -p STRIKE_DETECTOR_VERSION 2>/dev/null || true
    declare -f json_escape _flat_json_escape extract_json_value json_array_first emit grok_effort_clamp grok_effort_note reap_container prepare_managed_codex_home cleanup_managed_codex_home run_worker run_agent compute_artifacts passive_capture \
      _is_engine_unavailable _hetero_runner_token seat_strike_capture classify_outcome heartbeat_loop detached_main write_manifest manifest_finalize run_strict_contract_postchecks run_strict_boundary_postcheck run_strict_staged_precheck run_strict_acceptance_checks \
      _cont_terminal_on_exit _cont_finalize_or_die \
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
  unset CAMPAIGN_PROMPT_FILE
  # Transfer continuation WO ownership to detached child: parent must NOT mark WO failed on EXIT
  # with a stale empty OUTCOME (child serializes/updates its own terminal state).
  _CONT_WO_PARENT_TRANSFERRED=1
  # The child removes the state file right after sourcing (before the long run) so a caller-kill
  # of the parent — which skips the parent's own cleanup below — cannot leak it.
  setsid bash -c 'IN_DETACHED_CHILD=1; source "$1"; rm -f "$1"; detached_main' bash "$state_file" >/dev/null 2>&1 &
  local child=$!
  # Clear parent claim after child is launched so parent EXIT cleanup cannot fail-mark the WO.
  _CONT_WO_CLAIMED_ROOT=""
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
# --- strict pre-flight: every acceptance argv must at least be EXECUTABLE ---
# run_strict_acceptance_checks() spawns these AFTER the runner has been paid for, and
# spawnSync does NOT throw on ENOENT/EACCES (it returns status=null with .error set), so a
# typo'd or missing command surfaces there as a generic "exit-code mismatch" — an expensive
# way to learn about a typo. Executability is decidable at base, for free.
#
# Deliberately NOT gated on exit codes: red-at-base is the expected shape for a TDD unit
# and green-at-base is legitimate for a regression guard, so only "cannot execute at all"
# is fatal here.
if [ "$STRICT_CONTRACT" -eq 1 ]; then
  preflight_err="$(node -e '
const fs = require("fs");
const path = require("path");
let contract;
try {
  contract = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch (err) {
  process.stdout.write("");
  process.exit(0);   // schema problems are the checker s job, not this pre-flight s
}
const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
const cwd = process.argv[2] || process.cwd();
function executableStatus(command) {
  const candidates = command.includes(path.sep)
    ? [path.isAbsolute(command) ? command : path.resolve(cwd, command)]
    : (process.env.PATH || "").split(path.delimiter).filter(Boolean)
      .map((dir) => path.join(dir, command));
  let sawPermissionError = false;
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      if ((stat.mode & 0o111) !== 0) return null;
      sawPermissionError = true;
    } catch (err) {
      if (err && err.code === "EACCES") sawPermissionError = true;
    }
  }
  return sawPermissionError ? "EACCES" : "ENOENT";
}
for (let i = 0; i < acceptance.length; i++) {
  const argv = Array.isArray(acceptance[i] && acceptance[i].argv) ? acceptance[i].argv : [];
  if (!argv.length) continue;
  const errorCode = executableStatus(argv[0]);
  if (errorCode) {
    process.stdout.write("acceptance command #" + (i + 1) + " is not executable (" + errorCode + "): " + argv[0]);
    process.exit(0);
  }
}
process.stdout.write("");
  ' "$CONTRACT_FILE" "$WT" 2>/dev/null || true)"
  if [ -n "$preflight_err" ]; then
    die_precondition "$preflight_err"
  fi
fi

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
[ -n "${CAMPAIGN_PROMPT_FILE:-}" ] && rm -f "$CAMPAIGN_PROMPT_FILE"
trap - INT TERM
compute_artifacts
classify_outcome
# Terminal finalizer before success JSON — never emit success with a nonterminal claimed WO.
if ! _cont_finalize_or_die; then
  OUTCOME_STATUS="failure"
  OUTCOME_ERR="work order terminal finalizer failed closed"
  OUTCOME_EXIT=1
  emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR"
  exit 1
fi
emit "$OUTCOME_STATUS" "$OUTCOME_COMMIT" "$OUTCOME_FILES" "$OUTCOME_INS" "$OUTCOME_DEL" "$OUTCOME_WT" "$OUTCOME_ERR"
exit "$OUTCOME_EXIT"
