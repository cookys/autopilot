#!/usr/bin/env bash
# d0gate stub of the hetero rail script (BL-0306 P3 instrument; evals/skill-onoff/d0gate). NOT the real rail.
# It exists so the ON/OFF cells of the d0gate row can run with zero spend: it keeps the real rail's argument
# parsing and its --gate-rules refusal rules byte for byte (the two blocks below are copied from
# scripts/dispatch-hetero.sh at 45edf93da; hooks/tests/skill-onoff-d0gate.test.sh asserts they still match the real
# file), records every call in <cell>/.d0gate/ledger.jsonl at call time, and then runs a DETERMINISTIC
# worker (scripts/d0gate-workers/<mode>) in a detached worktree. With --gate-rules it runs the REAL
# scripts/per-turn-gate-arm.js arm/settings/disarm and the REAL hooks/per-turn-gate.js as the worker's Stop hook
# (the way claude would at the end of a turn). The stub worker does not react to a block text: it only shows the
# gate being exercised. The cell root is pinned inside the cell's own copy of this file when the cell is built, never taken from the
# environment or from where the file is called; live/state files go to <cell>/live. Nothing here needs to be set by the caller.
# Spend: none. It never starts claude, codex or any other runner.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ORIG_ARGV=("$@")
# The cell root is written into this file when the cell materialises it (D0G_PINNED_CELL below); that value is the only thing that decides
# where the ledger and the live files go. A copy or a symlink of this file elsewhere still writes into the real cell. Neither an
# environment value nor the position this file is called from can move them; when either differs from the pinned cell, the call
# record carries cell_env_override=true.
D0G_PINNED_CELL=""
CELL="$D0G_PINNED_CELL"
[ -n "$CELL" ] && [ -d "$CELL/.d0gate" ] || { echo "d0gate stub: this copy was not materialised by a d0gate cell" >&2; exit 2; }
# The worker mode, the hook command override and the no-disarm switch (negative-control knobs) are pinned the same way: the harness writes
# them into this cell's copy, the stub reads only these, and an environment value that differs is ignored and flagged (knob_env_override).
D0G_PINNED_WORKER=""
D0G_PINNED_HOOK_CMD=""
D0G_PINNED_NO_DISARM=""
KNOB_OVERRIDE=false
[ -n "${D0GATE_WORKER:-}" ] && [ "$D0GATE_WORKER" != "${D0G_PINNED_WORKER:-clean-g1}" ] && KNOB_OVERRIDE=true
[ -n "${D0GATE_HOOK_CMD:-}" ] && [ "$D0GATE_HOOK_CMD" != "$D0G_PINNED_HOOK_CMD" ] && KNOB_OVERRIDE=true
[ -n "${D0GATE_NO_DISARM:-}" ] && [ "$D0GATE_NO_DISARM" != "$D0G_PINNED_NO_DISARM" ] && KNOB_OVERRIDE=true
ENV_OVERRIDE=false
LOC_CELL="$(cd "$SELF_DIR/../.." 2>/dev/null && pwd -P)"
[ "$LOC_CELL" = "$CELL" ] || ENV_OVERRIDE=true
[ -n "${D0GATE_CELL:-}" ] && [ "$(cd "$D0GATE_CELL" 2>/dev/null && pwd -P)" != "$CELL" ] && ENV_OVERRIDE=true
LIVE="$CELL/live"
mkdir -p "$CELL/.d0gate" "$CELL/wt"; mkdir -p -m 700 "$LIVE"
export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONFIG_FILE="$CELL/config.json"   # pinned: a caller value must not choose which file this script may create
[ -f "$AUTOPILOT_CONFIG_FILE" ] || echo '{}' >"$AUTOPILOT_CONFIG_FILE"
# the stub's own names carry a D0G_ prefix: the copied option loop below assigns LEDGER (--ledger), BRANCH, MODEL, ... itself
D0G_LEDGER="$CELL/.d0gate/ledger.jsonl"
export D0GATE_LEDGER="$D0G_LEDGER"
RUNNER="auto"; BRANCH=""; PROMPT_FILE=""; MODEL=""; BASE=""; TIMEOUT=""; GATE_RULES_FILE=""
IS_CCSHIM=0; IS_CNATIVE=0; KEEP=0; SKILLS=(); MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES=(); MAIN_CHECKOUT_FP_EXCLUDE_PATHS=()
usage() { echo "d0gate stub of the hetero rail script (see the header of this file)"; }
# ledger_append <kind> key=value...   (one JSON line; the values true/false/integers are typed)
ledger_append() {
  node -e '
    const fs = require("fs"); const [kind, ...kv] = process.argv.slice(1);
    const o = { kind, ts: Date.now() };
    for (const p of kv) { const i = p.indexOf("="); const k = p.slice(0, i); const v = p.slice(i + 1); o[k] = v === "true" ? true : v === "false" ? false : /^-?[0-9]+$/.test(v) ? Number(v) : v; }
    fs.appendFileSync(process.env.D0GATE_LEDGER, JSON.stringify(o) + "\n");' "$@"
}
argv_json() { node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"; }
die_precondition() {
  ledger_append call accepted=false cell_env_override="$ENV_OVERRIDE" knob_env_override="$KNOB_OVERRIDE" reason="$1" argv="$(argv_json "${ORIG_ARGV[@]}")" cwd="$PWD"
  printf '{"status":"precondition_failed","reason":"%s"}\n' "$(printf '%s' "$1" | sed 's/"/\\"/g')"
  exit 2
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
    --effort) EFFORT="${2:-}"; EFFORT_EXPLICIT=1; shift 2 ;;
    --context-window) CONTEXT_WINDOW_GATE="${2:-}"; shift 2 ;;
    --endpoint) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--endpoint requires a non-empty value"; ENDPOINT="$2"; [ "$ENDPOINT" = "@none" ] && ENDPOINT=""; shift 2 ;;
    --base) BASE="${2:-}"; BASE_SUPPLIED=1; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; TIMEOUT_SUPPLIED=1; shift 2 ;;
    --gate-rules) [ $# -ge 2 ] && [ -n "$2" ] || die_precondition "--gate-rules requires a non-empty file path"; GATE_RULES_FILE="$2"; shift 2 ;;
    --commit-quiet-secs) COMMIT_QUIET_SECS="${2:-}"; shift 2 ;;
    --agy-bin) AGY_BIN="${2:-}"; BIN_FLAG_AGY=1; shift 2 ;;
    --grok-bin) GROK_BIN="${2:-}"; BIN_FLAG_GROK=1; shift 2 ;;
    --pi-bin) PI_BIN="${2:-}"; BIN_FLAG_PI=1; shift 2 ;;
    --codex-bin) CODEX_BIN="${2:-}"; BIN_FLAG_CODEX=1; shift 2 ;;
    --qoder-bin) QODER_BIN="${2:-}"; BIN_FLAG_QODER=1; shift 2 ;;
    --cursor-bin) CURSOR_BIN="${2:-}"; BIN_FLAG_CURSOR=1; shift 2 ;;
    --opencode-bin) OPENCODE_BIN="${2:-}"; BIN_FLAG_OPENCODE=1; shift 2 ;;
    --kimi-bin) KIMI_BIN="${2:-}"; BIN_FLAG_KIMI=1; shift 2 ;;
    --cursor-fast) CURSOR_FAST=1; shift ;;
    --strict-contract) STRICT_CONTRACT=1; shift ;;
    --contract-file) CONTRACT_FILE="${2:-}"; CONTRACT_FILE_SUPPLIED=1; shift 2 ;;
    --conformance-intent) CONFORMANCE_INTENT_FILE="${2:-}"; shift 2 ;;
    --keep-worktree) KEEP=1; shift ;;
    --sibling-ref-prefix)
      case "${2:-}" in
        refs/heads/) die_precondition "--sibling-ref-prefix refs/heads/ would exempt every branch; name the namespace" ;;
        *//*) die_precondition "--sibling-ref-prefix has an empty path segment (got '${2:-}')" ;;
        refs/heads/*/) ;;
        *) die_precondition "--sibling-ref-prefix must look like refs/heads/<namespace>/ (got '${2:-}')" ;;
      esac
      MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES+=("$2"); shift 2 ;;
    --sibling-path-prefix)
      case "${2:-}" in
        ""|/|./|.) die_precondition "--sibling-path-prefix would exempt the whole checkout; name the directory" ;;
        /*) die_precondition "--sibling-path-prefix must be checkout-relative (got '${2:-}')" ;;
        .git|.git/|.git/*) die_precondition "--sibling-path-prefix may not name .git" ;;
        ..|../*|*/..|*/../*) die_precondition "--sibling-path-prefix may not contain .. (got '${2:-}')" ;;
        ./*|*/./*) die_precondition "--sibling-path-prefix may not contain a ./ segment (got '${2:-}')" ;;
        *//*) die_precondition "--sibling-path-prefix has an empty path segment (got '${2:-}')" ;;
        */) ;;
        *) die_precondition "--sibling-path-prefix must look like <dir>/ (got '${2:-}')" ;;
      esac
      MAIN_CHECKOUT_FP_EXCLUDE_PATHS+=("$2"); shift 2 ;;
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
    --gc|--reap-unmarked|--yes) die_precondition "$1 was removed at 3.0.0 (BL-0115): dispatch-hetero.sh no longer has a stale-worktree reaper; use 'node scripts/repo-residue-sweep.js reap --auto --yes' (the SessionStart hook runs it automatically); for unmarked hetero-* worktrees use 'repo-residue-sweep.js scan', then 'preserve' / 'reap --yes'" ;;
    --help|-h) usage; exit 0 ;;
    *) die_precondition "unknown argument: $1" ;;
  esac
done

case "$RUNNER" in
  auto|codex|agy|grok|pi|qoderclicn|cursor|opencode|kimi) ;;
  cc-shim) IS_CCSHIM=1 ;;
  claude-native) IS_CNATIVE=1 ;;
  *) die_precondition "--runner must be one of auto|codex|agy|grok|cc-shim|pi|qoderclicn|cursor|opencode|kimi|claude-native (got: $RUNNER)" ;;
esac
CHILD_SESSION_ID="d0g-$$-$RANDOM"
  if [ -n "${GATE_RULES_FILE:-}" ]; then
    # Silently ignoring the flag on another runner would make the arm marker lie, so refuse it.
    [ "$IS_CCSHIM" -eq 1 ] || [ "$IS_CNATIVE" -eq 1 ] || die_precondition "--gate-rules applies only to --runner claude-native or cc-shim (got runner: $RUNNER)"
    [ -f "$GATE_RULES_FILE" ] && [ -r "$GATE_RULES_FILE" ] || die_precondition "--gate-rules file not readable: $GATE_RULES_FILE"
    GATE_RULES_FILE="$(cd "$(dirname "$GATE_RULES_FILE")" && pwd -P)/$(basename "$GATE_RULES_FILE")"
    [[ "${CHILD_SESSION_ID:-}" =~ ^[A-Za-z0-9-]{1,128}$ ]] || die_precondition "--gate-rules: could not mint a fresh session id; refusing to dispatch"
  fi

[ -n "$PROMPT_FILE" ] && [ -r "$PROMPT_FILE" ] || die_precondition "--prompt-file is required and must be readable"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die_precondition "not inside a git repository"
BASE_SHA="$(git -C "$REPO" rev-parse --verify "${BASE:-HEAD}^{commit}" 2>/dev/null)" || die_precondition "cannot resolve --base"
N="$(( $(grep -c '"kind":"call"' "$D0G_LEDGER" 2>/dev/null || true) + 1 ))"
RULES_COPY=""; RULES_SHA=""
if [ -n "$GATE_RULES_FILE" ]; then
  RULES_COPY="$CELL/.d0gate/rules.$N.json"; cp "$GATE_RULES_FILE" "$RULES_COPY"
  RULES_SHA="$(sha256sum "$RULES_COPY" | cut -d' ' -f1)"
fi
GATE_FLAG=false; [ -n "$GATE_RULES_FILE" ] && GATE_FLAG=true
ledger_append call n="$N" accepted=true cell_env_override="$ENV_OVERRIDE" knob_env_override="$KNOB_OVERRIDE" argv="$(argv_json "${ORIG_ARGV[@]}")" cwd="$PWD" repo="$REPO" runner="$RUNNER" \
  gate_rules_flag="$GATE_FLAG" gate_rules_file="$GATE_RULES_FILE" rules_copy="$RULES_COPY" rules_sha="$RULES_SHA" base_sha="$BASE_SHA" session="$CHILD_SESSION_ID"
WT="$CELL/wt/$N"
git -C "$REPO" worktree add -q --detach "$WT" "$BASE_SHA" >/dev/null 2>&1 || die_precondition "cannot create the worker worktree"
GIT_ID=(-c user.email=d0gate@example.invalid -c user.name=d0gate -c core.hooksPath=/dev/null)
ARMED=false
if [ -n "$GATE_RULES_FILE" ]; then
  if node "$SELF_DIR/per-turn-gate-arm.js" arm --session "$CHILD_SESSION_ID" --repo "$WT" --rules "$GATE_RULES_FILE" --ttl-seconds 900 >"$CELL/.d0gate/arm.$N.log" 2>&1; then
    ARMED=true
    # disarm on ANY exit (early exit, error, TERM/INT/HUP), like the real rail's exit trap; the explicit disarm below stays (idempotent)
    trap 'exit 143' TERM INT HUP
    trap '[ "$D0G_PINNED_NO_DISARM" = 1 ] || node "$SELF_DIR/per-turn-gate-arm.js" disarm --session "$CHILD_SESSION_ID" >/dev/null 2>&1' EXIT
  fi
fi
ledger_append arm n="$N" armed="$ARMED"
if [ -n "$GATE_RULES_FILE" ] && [ "$ARMED" != true ]; then
  echo "gate-rules: could not arm the per-turn gate; worker not started" >&2
  ledger_append result n="$N" status=arm_failed
  printf '{"status":"failed","reason":"gate-rules could not arm"}\n'
  exit 1
fi
MODE="${D0G_PINNED_WORKER:-clean-g1}"
MD="$SELF_DIR/d0gate-workers/$MODE"
[ -d "$MD" ] || { ledger_append result n="$N" status=bad_worker_mode; echo "d0gate stub: unknown worker mode $MODE" >&2; exit 2; }
[ ! -d "$MD/files" ] || cp -R "$MD/files/." "$WT/"
if [ "$ARMED" = true ]; then
  node "$SELF_DIR/per-turn-gate-arm.js" settings --out "$CELL/.d0gate/settings.$N.json" || true
  HOOK_CMD="${D0G_PINNED_HOOK_CMD:-$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).hooks.Stop[0].hooks[0].command)' "$CELL/.d0gate/settings.$N.json")}"
  : >"$CELL/.d0gate/hook-out.$N"
  for active in false true true true; do
    printf '{"session_id":"%s","cwd":"%s","stop_hook_active":%s,"prompt_id":"p"}' "$CHILD_SESSION_ID" "$WT" "$active" \
      | (cd "$WT" && D0GATE_SESSION="$CHILD_SESSION_ID" sh -c "$HOOK_CMD") >>"$CELL/.d0gate/hook-out.$N" 2>/dev/null || true
  done
  [ "$D0G_PINNED_NO_DISARM" = 1 ] || node "$SELF_DIR/per-turn-gate-arm.js" disarm --session "$CHILD_SESSION_ID" || true
fi
BR="${BRANCH:-d0g/$N}"
git -C "$WT" "${GIT_ID[@]}" checkout -q -b "$BR"
git -C "$WT" add -A
git -C "$WT" "${GIT_ID[@]}" commit -q --allow-empty -m "d0gate stub worker $MODE" >/dev/null
RESULT_SHA="$(git -C "$WT" rev-parse HEAD)"
ledger_append result n="$N" status=done worker="$MODE" branch="$BR" result_sha="$RESULT_SHA" session="$CHILD_SESSION_ID"
printf '{"status":"done","runner":"%s","branch":"%s","commit":"%s","worktree":"%s"}\n' "$RUNNER" "$BR" "$RESULT_SHA" "$WT"
exit 0
