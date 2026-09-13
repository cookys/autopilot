#!/usr/bin/env bash
# dispatch-foreman.sh — a NON-Claude engine in the foreman seat (Shape B, design round 2:
# docs/plans/2026-09-13-non-claude-foreman-rail-design.md; build plan
# docs/plans/2026-09-13-foreman-rail-b-build.md). Owner ruling 2026-09-13: quota is the motive,
# so the foreman must actually hold the loop — this rail lets kimi orchestrate hands through
# the existing rails (dispatch-hetero.sh / dispatch-review.sh / wait-dispatch-results.js) and
# enforces, in the rail and not in the prompt, what hooks/foreman-guard.js enforces for a Claude
# foreman. The verdict stays at depth 0: this rail produces branches and files, never a merge.
#
# Usage:
#   dispatch-foreman.sh --brief-file <path> --plan-file <path> [--model kimi-code/k3]
#       [--base <ref>]            # default HEAD of the main checkout; pinned to a SHA at start
#       [--run-id <id>]           # default foreman-<epoch>-<pid>; also names the branch/run dir
#       [--run-dir <dir>]         # default ${TMPDIR:-/tmp}/autopilot-foreman-runs/<run_id>
#       [--ledger <path>]         # with --run-id: R1 detach (setsid kill-survival, durable result
#                                 #   at <ledger>.results/<run_id>.foreman.{result.json,exit})
#       [--tool-cap <n>]          # Bash tool-call cap; default = foreman-guard's knob
#                                 #   (foreman_guard.bash_cap / AUTOPILOT_FOREMAN_GUARD_BASH_CAP, 40)
#       [--timeout <secs>]        # deadline for the foreman turn; default 3600
#       [--handoff-timeout <secs>]# deadline for the forced handoff turn; default 300
#       [--poll <secs>]           # stream poll interval; default 1
#       [--env-passthrough NAME]  # repeatable: an extra env var the foreman may see
#       [--kimi-bin <bin>]        # test seam
#       [--keep]                  # retain the worktree on success too
#       [--json]                  # (default) one JSON object on stdout
#   dispatch-foreman.sh --resume --run-dir <dir> --answer-file <path> [same knobs]
#       # depth 0 answers an ESCALATION: one more turn in the SAME worktree (kimi refuses to
#       # resume a session from a different cwd — measured 2026-09-13, probe p6)
#
# What the RAIL owns (design §4, each one a mechanism with a test):
#   1 audit log OUTSIDE the worktree — <run_dir>/foreman.stream.jsonl is kimi's stream-json
#     as it was emitted; the worktree cannot rewrite it. kimi's own session store
#     (~/.kimi-code/) is resume state, not audit, and the result says so.
#   2 tool cap — the SAME constant foreman-guard reads. Every stream line is parsed as JSON
#     (a hand's leaked stdout appears as a NON-JSON line — probe p1 — so a substring grep
#     would over-count); assistant tool_calls named Bash are counted; call N > cap kills the
#     foreman's whole process group and forces ONE handoff turn (`kimi -c`, same cwd,
#     measured to resume a killed session — probe p8) under its own cap of 5.
#   3 verdict at depth 0 — main checkout fingerprinted before/after with the ONE shared
#     implementation (scripts/lib/main-checkout-boundary.sh); the only refs allowed to move
#     are refs/heads/<foreman branch> and refs/heads/hands/<run_id>/*. A foreman HEAD that
#     is a merge commit or does not descend from base is `foreman_integrated`; foreman
#     commits pass scripts/check-hands-commit.js. Hands' commits are dispatch-hetero's own
#     gate's business; this rail lists the hands branches and their heads, verified by git.
#   4 env — allowlist, not scrub: PATH HOME TERM LANG LC_* XDG_RUNTIME_DIR TMPDIR KIMI_*
#     AUTOPILOT_* plus --env-passthrough, plus HANDS_GIT_ENV (push/fetch block, inherited by
#     every child kimi spawns). Anything else — endpoint tokens, cloud credentials — is not
#     in the foreman's environment; a nested rail that needs them reads its own files.
#     Network egress is NOT bounded (kimi has MCP http/sse) → egress_policy "unbounded".
#   5 containment — kimi is its own setsid session; the cap/deadline kill targets its
#     process group. Hands dispatched with ledger coords are their own sessions by the
#     detach contract and SURVIVE the foreman's death — reported, never killed.
#   6 worktree budget — AUTOPILOT_WORKTREE_ROOT_RUN_ID / AUTOPILOT_ROOT_RUN_ID forwarded
#     unchanged; AUTOPILOT_DISPATCH_DEPTH=1 so hands land at depth 2.
#
# Protocol the foreman is given (written by the rail to <run_dir>/protocol.md, ≤ 1 KB -p):
#   inputs   <run_dir>/brief.md, <run_dir>/plan.md (read-only copies)
#   outputs  <run_dir>/REPORT.md (done + NOT done, named), <run_dir>/HANDOFF.md on cap/deadline,
#            <run_dir>/ESCALATION.md to hand a question to depth 0 (then STOP)
#   hands    dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger ...
#            wait with wait-dispatch-results.js; never git merge / push / checkout main
#
# Output (stdout, one JSON object; also the durable result under --ledger):
#   status      completed | escalated | tool_cap_reached | deadline_expired | foreman_failed |
#               main_checkout_mutated | main_checkout_unverified | foreman_integrated |
#               unsafe_commit_content | content_check_unverified | precondition_failed
#   run_id run_dir worktree foreman_branch foreman_head base_sha foreman_commits
#   hands_branches [{branch,head}]   report_written report_path   handoff_written handoff_path
#   escalation_path   session_id   stream_log   tool_calls tool_cap   containment
#   env_policy env_passthrough[] egress_policy   deadline_secs elapsed_secs
#   main_checkout_boundary   error
# Exit: 0 completed|escalated; 1 every other status; 2 precondition_failed.
#
# Measured before this rail was written (kimi 0.41.0, 2026-09-13, evidence dir
# docs/plans/evidence/2026-09-13-non-claude-foreman/kimi-probes/): -p runs tools; native Read
# and Write reach paths outside cwd (p7); -r from another cwd is refused (p6); setsid + kill
# of the process group leaves no kimi behind and `-c` in the same cwd resumes the killed
# session with its memory (p8); an allowlisted `env -i` is enough for kimi to run (p7).
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib/json-emit.sh
source "$SELF_DIR/lib/json-emit.sh"
# shellcheck source=lib/dispatch-detach.sh
source "$SELF_DIR/lib/dispatch-detach.sh"

BRIEF_FILE=""; PLAN_FILE=""; MODEL="kimi-code/k3"; BASE_REF=""; RUN_ID=""; RUN_DIR=""
LEDGER=""; TOOL_CAP=""; TIMEOUT_SECS=3600; HANDOFF_TIMEOUT=300; POLL=1
KIMI_BIN="kimi"; KEEP=0; RESUME=0; ANSWER_FILE=""
ENV_PASSTHROUGH=()
ORIG_ARGS=("$@")

while [ $# -gt 0 ]; do
  case "$1" in
    --brief-file) BRIEF_FILE="${2:-}"; shift 2 ;;
    --plan-file) PLAN_FILE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --run-dir) RUN_DIR="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    --tool-cap) TOOL_CAP="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECS="${2:-}"; shift 2 ;;
    --handoff-timeout) HANDOFF_TIMEOUT="${2:-}"; shift 2 ;;
    --poll) POLL="${2:-}"; shift 2 ;;
    --env-passthrough) ENV_PASSTHROUGH+=("${2:-}"); shift 2 ;;
    --kimi-bin) KIMI_BIN="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --resume) RESUME=1; shift ;;
    --answer-file) ANSWER_FILE="${2:-}"; shift 2 ;;
    --json) shift ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'dispatch-foreman: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- result plumbing
STATUS=""; ERROR=""; WT=""; BRANCH=""; BASE_SHA=""; FOREMAN_HEAD=""; FOREMAN_COMMITS=0
SESSION_ID=""; STREAM_LOG=""; TOOL_CALLS=0; CONTAINMENT="setsid"; ELAPSED=0
MAIN_CHECKOUT_BOUNDARY="not-measured"; HANDS_JSON="[]"
START_TS="$(date +%s)"

emit() {
  local s="$STATUS" rc
  case "$s" in completed|escalated) rc=0 ;; precondition_failed) rc=2 ;; *) rc=1 ;; esac
  local report_w=false handoff_w=false esc="null"
  [ -n "$RUN_DIR" ] && [ -s "$RUN_DIR/REPORT.md" ] && report_w=true
  [ -n "$RUN_DIR" ] && [ -s "$RUN_DIR/HANDOFF.md" ] && handoff_w=true
  [ -n "$RUN_DIR" ] && [ -s "$RUN_DIR/ESCALATION.md" ] && esc="\"$(json_escape "$RUN_DIR/ESCALATION.md")\""
  local pt="[]"
  if [ "${ENV_PASSTHROUGH[*]+set}" = set ]; then pt="$(json_array_from_lines "$(printf '%s\n' "${ENV_PASSTHROUGH[@]}")")"; fi
  ELAPSED=$(( $(date +%s) - START_TS ))
  printf '{"status":"%s","run_id":"%s","run_dir":"%s","worktree":"%s","foreman_branch":"%s","foreman_head":"%s","base_sha":"%s","foreman_commits":%s,"hands_branches":%s,"report_written":%s,"report_path":"%s","handoff_written":%s,"handoff_path":"%s","escalation_path":%s,"session_id":"%s","stream_log":"%s","tool_calls":%s,"tool_cap":%s,"containment":"%s","env_policy":"allowlist","env_passthrough":%s,"egress_policy":"unbounded","audit_note":"stream_log is the audit record; the kimi session store under HOME is resume state, not audit","deadline_secs":%s,"elapsed_secs":%s,"main_checkout_boundary":"%s","runner":"kimi","model":"%s","error":"%s"}\n' \
    "$s" "$(json_escape "$RUN_ID")" "$(json_escape "$RUN_DIR")" "$(json_escape "$WT")" "$(json_escape "$BRANCH")" \
    "$FOREMAN_HEAD" "$BASE_SHA" "${FOREMAN_COMMITS:-0}" "$HANDS_JSON" "$report_w" "$(json_escape "${RUN_DIR:+$RUN_DIR/REPORT.md}")" \
    "$handoff_w" "$(json_escape "${RUN_DIR:+$RUN_DIR/HANDOFF.md}")" "$esc" "$(json_escape "$SESSION_ID")" "$(json_escape "$STREAM_LOG")" \
    "${TOOL_CALLS:-0}" "${TOOL_CAP:-0}" "$CONTAINMENT" "$pt" "${TIMEOUT_SECS:-0}" "$ELAPSED" "$MAIN_CHECKOUT_BOUNDARY" \
    "$(json_escape "$MODEL")" "$(json_escape "$ERROR")"
  exit "$rc"
}
die_precondition() { STATUS="precondition_failed"; ERROR="$1"; emit; }

# ---------------------------------------------------------------- preconditions
case "$TIMEOUT_SECS" in ''|*[!0-9]*) die_precondition "--timeout must be a non-negative integer" ;; esac
case "$HANDOFF_TIMEOUT" in ''|*[!0-9]*) die_precondition "--handoff-timeout must be a non-negative integer" ;; esac
case "$POLL" in ''|*[!0-9.]*) die_precondition "--poll must be a number" ;; esac
command -v "$KIMI_BIN" >/dev/null 2>&1 || die_precondition "kimi binary not found: $KIMI_BIN (install Kimi Code CLI or pass --kimi-bin)"
command -v setsid >/dev/null 2>&1 || die_precondition "setsid is required for process-group containment"
command -v node >/dev/null 2>&1 || die_precondition "node is required (stream parsing, content gate)"
[ -f "$SELF_DIR/check-hands-commit.js" ] || die_precondition "scripts/check-hands-commit.js missing beside this rail"
[ -f "$SELF_DIR/lib/main-checkout-boundary.sh" ] || die_precondition "scripts/lib/main-checkout-boundary.sh missing beside this rail"
if [ "${ENV_PASSTHROUGH[*]+set}" = set ]; then
  for _n in "${ENV_PASSTHROUGH[@]}"; do
    case "$_n" in ''|*[!A-Za-z0-9_]*|[0-9]*) die_precondition "--env-passthrough must be an env var NAME (got: $_n)" ;; esac
  done
fi

# The cap: the same knob hooks/foreman-guard.js reads, resolved the same way, so a non-Claude
# foreman and a Claude foreman share ONE ironlaw constant (design §4, "two implementations of
# one ironlaw is the shape that produced 7840hs (4)").
resolve_tool_cap() {
  local cap=40 cfg="$HOME/.autopilot/config.json" v
  if [ -f "$cfg" ]; then
    v="$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=j&&j.foreman_guard&&j.foreman_guard.bash_cap;if(Number.isInteger(c)&&c>0)process.stdout.write(String(c));}catch{}' "$cfg" 2>/dev/null || true)"
    [ -n "$v" ] && cap="$v"
  fi
  v="${AUTOPILOT_FOREMAN_GUARD_BASH_CAP:-}"
  case "$v" in ''|*[!0-9]*|0) ;; *) cap="$v" ;; esac
  printf '%s' "$cap"
}
if [ -z "$TOOL_CAP" ]; then TOOL_CAP="$(resolve_tool_cap)"; fi
case "$TOOL_CAP" in ''|*[!0-9]*|0) die_precondition "--tool-cap must be a positive integer" ;; esac

MAIN_CHECKOUT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$MAIN_CHECKOUT" ] || die_precondition "not inside a git checkout (run from the main checkout)"

if [ "$RESUME" -eq 1 ]; then
  [ -n "$RUN_DIR" ] || die_precondition "--resume requires --run-dir"
  [ -n "$ANSWER_FILE" ] && [ -f "$ANSWER_FILE" ] || die_precondition "--resume requires --answer-file <existing file>"
  [ -f "$RUN_DIR/run.env" ] || die_precondition "no run.env under $RUN_DIR — not a foreman run dir"
  # shellcheck source=/dev/null
  source "$RUN_DIR/run.env"   # RUN_ID BRANCH BASE_SHA WT MODEL (written by this rail)
  [ -d "$WT" ] || die_precondition "foreman worktree $WT is gone; kimi cannot resume a session from another cwd (probe p6) — start a new run"
  [ -f "$RUN_DIR/ESCALATION.md" ] || die_precondition "no ESCALATION.md under $RUN_DIR — nothing to answer"
else
  [ -n "$BRIEF_FILE" ] && [ -f "$BRIEF_FILE" ] || die_precondition "--brief-file <existing file> is required"
  [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ] || die_precondition "--plan-file <existing file> is required"
  [ -z "$RUN_ID" ] && RUN_ID="foreman-$(date +%s)-$$"
  case "$RUN_ID" in *[!A-Za-z0-9._-]*) die_precondition "--run-id must match [A-Za-z0-9._-]+" ;; esac
  [ -z "$RUN_DIR" ] && RUN_DIR="${TMPDIR:-/tmp}/autopilot-foreman-runs/$RUN_ID"
  [ -e "$RUN_DIR" ] && die_precondition "run dir already exists: $RUN_DIR (a run id is used once)"
  BRANCH="foreman/$RUN_ID"
  git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null 2>&1 && die_precondition "branch $BRANCH already exists"
  BASE_SHA="$(git rev-parse --verify --quiet "${BASE_REF:-HEAD}^{commit}" 2>/dev/null || true)"
  [ -n "$BASE_SHA" ] || die_precondition "cannot resolve --base ${BASE_REF:-HEAD} to a commit"
fi

# ---------------------------------------------------------------- R1 detach (optional)
# With --ledger + --run-id the whole run re-executes inside a setsid session that survives the
# caller; the durable result lands at <ledger>.results/<run_id>.foreman.{result.json,exit}
# (the exit-file contract wait-dispatch-results.js waits on). Returns 0 when not engaged.
if [ -n "$LEDGER" ] && [ "$RESUME" -eq 0 ]; then
  dispatch_detach_supervise "$0" "$LEDGER" "$RUN_ID" foreman "$SELF_DIR" -- "${ORIG_ARGS[@]}" --run-id "$RUN_ID" --run-dir "$RUN_DIR" --ledger ""
fi

# ---------------------------------------------------------------- boundary (shared lib)
# shellcheck source=lib/main-checkout-boundary.sh
source "$SELF_DIR/lib/main-checkout-boundary.sh"
MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES=("refs/heads/hands/$RUN_ID/")
MAIN_CHECKOUT_BEFORE="$(main_checkout_fingerprint)"
build_hands_git_env

# ---------------------------------------------------------------- run dir + worktree
if [ "$RESUME" -eq 0 ]; then
  mkdir -p "$RUN_DIR" || die_precondition "cannot create run dir $RUN_DIR"
  cp -- "$BRIEF_FILE" "$RUN_DIR/brief.md" && cp -- "$PLAN_FILE" "$RUN_DIR/plan.md" || die_precondition "cannot copy brief/plan into $RUN_DIR"
  chmod 0444 "$RUN_DIR/brief.md" "$RUN_DIR/plan.md"
  WT="$(mktemp -u -d -t "foreman-${RUN_ID}-XXXXXX")"; WT="$(realpath -m "$WT")"
  if ! git worktree add --quiet "$WT" -b "$BRANCH" "$BASE_SHA" >/dev/null 2>&1; then
    git update-ref -d "refs/heads/$BRANCH" >/dev/null 2>&1 || true
    die_precondition "git worktree add failed for $WT"
  fi
  # Schema-2 marker + lifetime flock so reap-dispatch-worktrees.sh treats this like any rail's.
  _excl="$(git rev-parse --git-common-dir)/info/exclude"; mkdir -p "$(dirname "$_excl")"
  for _name in .autopilot-worktree .autopilot-worktree.lock; do
    grep -qxF "$_name" "$_excl" 2>/dev/null || printf '%s\n' "$_name" >> "$_excl"
  done
  {
    printf 'created_at=%s\nbranch=%s\nbase_sha=%s\nrun_id=%s\nroot_run_id=%s\nloop_id=%s\nretention=inspect\nschema=2\n' \
      "$(date +%s)" "$BRANCH" "$BASE_SHA" "$RUN_ID" "${AUTOPILOT_WORKTREE_ROOT_RUN_ID:-$RUN_ID}" "$RUN_ID"
  } > "$WT/.autopilot-worktree"
  printf 'RUN_ID=%q\nBRANCH=%q\nBASE_SHA=%q\nWT=%q\nMODEL=%q\n' "$RUN_ID" "$BRANCH" "$BASE_SHA" "$WT" "$MODEL" > "$RUN_DIR/run.env"
  # The protocol: what the foreman may do, where its inputs/outputs live. Rail-owned text.
  cat > "$RUN_DIR/protocol.md" <<EOF
# Foreman protocol — run $RUN_ID

You are the FOREMAN for this run. You orchestrate; you do not integrate. The verdict is at
depth 0 (the dispatcher that started you), and it is reached from git, not from your report.

- Your working directory is a dedicated worktree on branch \`$BRANCH\` at base \`$BASE_SHA\`.
  Do not \`cd\` out of it. Do not check out, merge, rebase, reset or push ANY branch. Fetch and
  push are blocked at git level; an attempt is recorded, not forgiven.
- Inputs (read-only): \`$RUN_DIR/brief.md\`, \`$RUN_DIR/plan.md\`.
- Hands: dispatch implementation through
  \`$SELF_DIR/dispatch-hetero.sh --branch hands/$RUN_ID/<unit> --base $BASE_SHA --ledger $RUN_DIR/hands.ledger --run-id <unit> --stage implement ...\`
  (every hand branch MUST start with \`hands/$RUN_ID/\`; any other ref you create rejects the
  whole run; the three ledger flags together make the hand detach, so it survives you). Review
  through \`$SELF_DIR/dispatch-review.sh\`. Wait for detached hands with
  \`node $SELF_DIR/wait-dispatch-results.js --ledger $RUN_DIR/hands.ledger --expect <unit>.implement\`
  — never poll with a shell loop.
- Budget: at most $TOOL_CAP Bash tool calls in this turn. At the cap you are stopped; a
  handoff turn follows. Write \`$RUN_DIR/HANDOFF.md\` yourself BEFORE the cap when you can see it
  coming.
- Outputs: \`$RUN_DIR/REPORT.md\` when done — list what was completed AND what was not, by name.
  A question only depth 0 can answer: write it to \`$RUN_DIR/ESCALATION.md\` and stop; you will be
  resumed with the answer in \`$RUN_DIR/ANSWER.md\`.
EOF
fi

WT_LOCK_FD=""
exec {WT_LOCK_FD}>"$WT/.autopilot-worktree.lock" && flock -n "$WT_LOCK_FD" \
  || die_precondition "cannot take the worktree lock on $WT (another rail holds it)"

# ---------------------------------------------------------------- env (allowlist)
FOREMAN_ENV=()
for _v in PATH HOME TERM LANG TMPDIR XDG_RUNTIME_DIR XDG_CONFIG_HOME; do
  [ -n "${!_v:-}" ] && FOREMAN_ENV+=("$_v=${!_v}")
done
while IFS='=' read -r _k _val; do
  [ -n "$_k" ] || continue
  case "$_k" in LC_*|KIMI_*|AUTOPILOT_*) FOREMAN_ENV+=("$_k=${!_k}") ;; esac
done < <(env | grep -E '^(LC_[A-Z_]*|KIMI_[A-Za-z0-9_]*|AUTOPILOT_[A-Za-z0-9_]*)=' 2>/dev/null)
if [ "${ENV_PASSTHROUGH[*]+set}" = set ]; then
  for _n in "${ENV_PASSTHROUGH[@]}"; do [ -n "${!_n:-}" ] && FOREMAN_ENV+=("$_n=${!_n}"); done
fi
FOREMAN_ENV+=("AUTOPILOT_DISPATCH_DEPTH=1" "AUTOPILOT_PARENT_RUN_ID=$RUN_ID")
FOREMAN_ENV+=("${HANDS_GIT_ENV[@]}")

# ---------------------------------------------------------------- stream counting
# Counts assistant tool_calls named Bash; non-JSON lines are skipped, never grepped. Also
# captures the session id from the resume hint when the turn ends normally.
count_bash_calls() { # <stream file> → prints "<count> <session_id>"
  node -e '
    const fs=require("fs"); let n=0, sid="";
    let raw=""; try{ raw=fs.readFileSync(process.argv[1],"utf8"); }catch{}
    for (const line of raw.split("\n")) {
      let j; try{ j=JSON.parse(line); }catch{ continue; }
      if (j && j.role==="assistant" && Array.isArray(j.tool_calls))
        for (const t of j.tool_calls) if (t && t.function && t.function.name==="Bash") n++;
      if (j && j.role==="meta" && j.type==="session.resume_hint" && typeof j.session_id==="string") sid=j.session_id;
    }
    process.stdout.write(n+" "+sid);
  ' "$1" 2>/dev/null || printf '0 '
}

# run_turn <stream> <cap> <deadline_secs> <kimi args...> → sets TURN_EXIT, TURN_STOP (""|cap|deadline)
run_turn() {
  local stream="$1" cap="$2" deadline="$3"; shift 3
  TURN_EXIT=""; TURN_STOP=""
  local pid t0 now cnt
  ( cd "$WT" && exec setsid env -i "${FOREMAN_ENV[@]}" "$KIMI_BIN" "$@" ) >"$stream" 2>"$stream.stderr" &
  pid=$!
  t0="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    cnt="$(count_bash_calls "$stream")"; cnt="${cnt%% *}"
    TOOL_CALLS="$cnt"
    now="$(date +%s)"
    if [ "$cnt" -gt "$cap" ]; then TURN_STOP="cap"
    elif [ $(( now - t0 )) -ge "$deadline" ]; then TURN_STOP="deadline"
    fi
    if [ -n "$TURN_STOP" ]; then
      # The setsid'd kimi is its own session leader: its pid is the pgid. Kill the group.
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL -- "-$pid" 2>/dev/null || true
      break
    fi
    sleep "$POLL"
  done
  wait "$pid" 2>/dev/null; TURN_EXIT=$?
  cnt="$(count_bash_calls "$stream")"; TOOL_CALLS="${cnt%% *}"
  [ -n "${cnt#* }" ] && SESSION_ID="${cnt#* }"
  return 0
}

# ---------------------------------------------------------------- the foreman turn
if [ "$RESUME" -eq 1 ]; then
  cp -- "$ANSWER_FILE" "$RUN_DIR/ANSWER.md"
  rm -f "$RUN_DIR/ESCALATION.md"
  _n=1; while [ -e "$RUN_DIR/foreman.stream.resume$_n.jsonl" ]; do _n=$((_n+1)); done
  STREAM_LOG="$RUN_DIR/foreman.stream.resume$_n.jsonl"
  run_turn "$STREAM_LOG" "$TOOL_CAP" "$TIMEOUT_SECS" -c -p "Depth 0 answered your escalation: read $RUN_DIR/ANSWER.md and continue under $RUN_DIR/protocol.md." --output-format stream-json
else
  STREAM_LOG="$RUN_DIR/foreman.stream.jsonl"
  run_turn "$STREAM_LOG" "$TOOL_CAP" "$TIMEOUT_SECS" -m "$MODEL" -p "You are the foreman for run $RUN_ID. Read $RUN_DIR/protocol.md first, then $RUN_DIR/brief.md and $RUN_DIR/plan.md, and carry the plan out under the protocol." --output-format stream-json
fi
FIRST_STOP="$TURN_STOP"; FIRST_EXIT="$TURN_EXIT"; FIRST_CALLS="$TOOL_CALLS"

# Forced handoff turn: ONE resume in the same cwd, its own small cap and deadline. The rail
# never writes HANDOFF.md itself — a fabricated handoff is worse than handoff_written=false.
if [ -n "$FIRST_STOP" ] && [ ! -s "$RUN_DIR/HANDOFF.md" ]; then
  _why="the Bash tool-call cap ($TOOL_CAP) was reached"; [ "$FIRST_STOP" = deadline ] && _why="the deadline (${TIMEOUT_SECS}s) expired"
  run_turn "$RUN_DIR/foreman.stream.handoff.jsonl" 5 "$HANDOFF_TIMEOUT" -c -p "You were stopped because $_why. Write $RUN_DIR/HANDOFF.md now: what is done, what is NOT done (by name), which hands branches exist, and the next concrete step. Do nothing else." --output-format stream-json
fi

TOOL_CALLS="$FIRST_CALLS"   # the reported count is the foreman turn's; the handoff turn has its own cap

# ---------------------------------------------------------------- git-level verification
MAIN_CHECKOUT_AFTER="$(main_checkout_fingerprint)"
case "$MAIN_CHECKOUT_BEFORE$MAIN_CHECKOUT_AFTER" in
  *UNVERIFIABLE-*) MAIN_CHECKOUT_BOUNDARY="main_checkout_unverified" ;;
  *) if [ "$MAIN_CHECKOUT_BEFORE" = "$MAIN_CHECKOUT_AFTER" ]; then MAIN_CHECKOUT_BOUNDARY="verified"; else MAIN_CHECKOUT_BOUNDARY="main_checkout_mutated"; fi ;;
esac
FOREMAN_HEAD="$(git rev-parse --verify --quiet "refs/heads/$BRANCH^{commit}" 2>/dev/null || true)"
HANDS_JSON="$(git for-each-ref --format='%(refname:short) %(objectname)' "refs/heads/hands/$RUN_ID/" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=[];for(const l of s.split("\n")){const m=l.match(/^(\S+) ([0-9a-f]{40,64})$/);if(m)a.push({branch:m[1],head:m[2]});}process.stdout.write(JSON.stringify(a));})' 2>/dev/null || printf '[]')"
GATE_STATUS=""; GATE_ERR=""
if [ -n "$FOREMAN_HEAD" ] && [ "$FOREMAN_HEAD" != "$BASE_SHA" ]; then
  if ! git merge-base --is-ancestor "$BASE_SHA" "$FOREMAN_HEAD" 2>/dev/null; then
    GATE_STATUS="foreman_integrated"; GATE_ERR="foreman branch head $FOREMAN_HEAD does not descend from base $BASE_SHA"
  elif [ "$(git rev-list --merges --count "$BASE_SHA..$FOREMAN_HEAD" 2>/dev/null || echo 1)" != "0" ]; then
    GATE_STATUS="foreman_integrated"; GATE_ERR="foreman branch contains a merge commit — integration is depth 0's, not the foreman's"
  else
    FOREMAN_COMMITS="$(git rev-list --count "$BASE_SHA..$FOREMAN_HEAD" 2>/dev/null)" || FOREMAN_COMMITS=""
    _gate_out="$(node "$SELF_DIR/check-hands-commit.js" --repo "$WT" --base "$BASE_SHA" --head "$FOREMAN_HEAD" 2>&1)"; _gate_rc=$?
    # A count that could not be measured is not 0 and not 1: it is unverified, like a gate that could not run.
    [ -n "$FOREMAN_COMMITS" ] || { _gate_rc=3; _gate_out="git rev-list --count failed for $BASE_SHA..$FOREMAN_HEAD"; FOREMAN_COMMITS=0; }
    case "$_gate_rc" in
      0) ;;
      1|2) GATE_STATUS="unsafe_commit_content"; GATE_ERR="$(printf '%s' "$_gate_out" | tr '\n' ' ' | cut -c1-400)" ;;
      *) GATE_STATUS="content_check_unverified"; GATE_ERR="check-hands-commit.js could not run (rc=$_gate_rc): $(printf '%s' "$_gate_out" | tr '\n' ' ' | cut -c1-300)" ;;
    esac
  fi
fi

# ---------------------------------------------------------------- classify (precedence: main > content > stop > exit)
if [ "$MAIN_CHECKOUT_BOUNDARY" != "verified" ]; then
  STATUS="$MAIN_CHECKOUT_BOUNDARY"; ERROR="main checkout fingerprint changed or could not be measured across the foreman turn; the round is discarded, worktree retained"
elif [ -n "$GATE_STATUS" ]; then
  STATUS="$GATE_STATUS"; ERROR="$GATE_ERR"
elif [ "$FIRST_STOP" = cap ]; then
  STATUS="tool_cap_reached"; ERROR="Bash tool call $TOOL_CALLS exceeded the foreman cap of $TOOL_CAP (ironlaw #6, 一刀一命); handoff turn ran"
elif [ "$FIRST_STOP" = deadline ]; then
  STATUS="deadline_expired"; ERROR="foreman turn exceeded ${TIMEOUT_SECS}s; handoff turn ran"
elif [ -s "$RUN_DIR/ESCALATION.md" ]; then
  STATUS="escalated"
elif [ "$FIRST_EXIT" != "0" ]; then
  STATUS="foreman_failed"; ERROR="kimi exited $FIRST_EXIT (see $STREAM_LOG.stderr)"
elif [ ! -s "$RUN_DIR/REPORT.md" ]; then
  STATUS="foreman_failed"; ERROR="kimi exited 0 but wrote no $RUN_DIR/REPORT.md — an empty run is not a completed one"
else
  STATUS="completed"
fi

# ---------------------------------------------------------------- worktree disposition
# Retain on anything but a clean completion (inspect), and on --keep. An escalated run MUST
# keep its worktree: resume is only possible from the same cwd.
if [ "$STATUS" = completed ] && [ "$KEEP" -eq 0 ]; then
  exec {WT_LOCK_FD}>&-
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
fi
emit
