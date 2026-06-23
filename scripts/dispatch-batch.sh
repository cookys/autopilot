#!/usr/bin/env bash
# dispatch-batch — Tier-2 batch fan-out engine for /l4 (homogeneous Claude
# foreman + N Claude Agent-tool workers) width parallelism (Phase L).
#
# WHAT THIS OWNS vs WHAT IT DOES NOT
# ----------------------------------
# This script owns the DETERMINISTIC git/artifact/merge/telemetry rails — the
# testable safety machinery of an unattended fan-out. It does NOT (and CANNOT)
# invoke the Agent/Task tool: dispatching N Claude workers + holding their
# agentIds + Monitor/TaskStop is harness-only, so the LLM control loop lives as
# PROSE in skills/ceo-agent/references/level-front-door.md § "Phase L". This
# script is the half the harness cannot fake: it verifies by GIT ARTIFACTS
# (commit existence + tree cleanliness + actual-touched files), never by an
# agent's self-report — the same artifact-rail as scripts/dispatch-hetero.sh and
# scripts/check-disjointness.sh.
#
# A "batch" = N units sharing ONE base. Each unit = { id, scope (allowlist
# globs), base }. Single-base-per-batch is ENFORCED (mixed base is not a valid
# decomposition). The authoritative gate is POST-COMMIT (check-disjointness
# validate over real git artifacts); the pre-dispatch propose overlap surface is
# ADVISORY only — never the clamp.
#
# ALL-OR-NOTHING: if ANY unit is not `committed` OR fails its disjointness check,
# the overall verdict is `abort` — the whole fan-out escalates and merges
# nothing. No half-feature ships unattended. Merge-conflict-as-missing-edge: a
# conflict during merge-back ABORTS the merge and emits a `serial_collapse`
# directive (re-run the conflicting ids as ONE Tier-1 serial unit) — never
# auto-resolve, never a coordinated round-2 re-dispatch (that breaches
# blind-dispatch implementer-blinding).
#
# SUBCOMMANDS (JSON out; exit 0 ok / 1 violation / 2 usage):
#   plan       --units <file> --run-id <id> [--repo <dir>] [--base <ref>]
#              ENFORCE single-base-per-batch; generate collision-safe branch
#              names unit-<id>-<run-id>; run check-disjointness propose
#              (ADVISORY); emit the batch plan JSON.
#   verify     --units <file> --run-id <id> [--repo <dir>]
#              Post-dispatch: per unit read git artifacts → status ∈
#              committed/no_op/dirty/failure (by commit existence + tree
#              cleanliness, never self-report) AND check-disjointness validate
#              (actual-touched ⊆ declared scope). Emit per-unit outcome table +
#              overall verdict (ALL-OR-NOTHING → abort on any non-committed or
#              undeclared touch).
#   merge-back --units <file> --run-id <id> --base <ref> [--repo <dir>]
#              ONLY proceeds if verify re-confirms all-committed-and-clean.
#              Merge each unit branch onto base. On conflict: git merge --abort,
#              merge nothing further, emit serial_collapse naming the conflicting
#              ids.
#   telemetry  --run-id <id> --event <t_dispatch|t_all_committed|t_review_done>
#              [--store <path>]
#              Append a timestamped Amdahl event to a per-run store (default
#              under ~/.autopilot/). `telemetry report [--store <path>]` computes
#              speedup / serial-fraction across stored runs (cross-run tuning —
#              NOT a within-run gate).
#   reap       --run-id <id> [--store <path>] [--abort | --unit <id>]
#              The parallel-kill trap for SHELL-DISPATCHED workers (the hetero
#              path). --abort reaps ALL units' worker process groups; --unit <id>
#              reaps just the one stalled unit. Uses a TERM-to-process-GROUP kill
#              (Agent-tool homogeneous workers are instead reaped by the
#              orchestrator's TaskStop — see level-front-door.md § Phase L).
#
# UNITS FILE FORMAT (one unit per line; blank lines + '#' comments ignored):
#   JSON-lines:  {"id":"ui","scope":"src/ui/**,src/ui/x.ts","base":"develop"}
#   OR  TSV:     <id>\t<scope-csv>\t<base>
# `scope` is a comma-separated allowlist glob list (same glob dialect as
# check-disjointness.sh). `base` may be omitted per-line and supplied via --base
# (the batch base); a per-line base that differs from the batch base is the
# mixed-base violation.
#
# HARD-WON NOTES (do not regress):
#   * set -euo pipefail. AVOID the SIGPIPE-under-pipefail trap: a `cmd | head` /
#     `cmd | grep -q` makes the upstream cmd take SIGPIPE → exit 141 → the script
#     aborts. This bug already bit three scripts here. We never pipe git output
#     into head/grep -q — we read full output into vars / use git -n / here-strings
#     / awk limits.
#   * git -c core.quotepath=false on any `git diff --name-only` (non-ASCII paths
#     arrive as real bytes, else an in-allowlist unicode file fails to match
#     itself).
#   * The parallel-kill trap targets SIGTERM, NOT SIGINT: Ctrl-C / SIGINT to a
#     process group does NOT fire a parent script's INT trap while a foreground
#     child runs — only SIGTERM does (repo lesson, memory bash-INT-pgroup-trap).
#     The reap path is VERIFIED EMPIRICALLY with setsid + kill in the test suite,
#     never by reasoning.
#   * Run under bash explicitly (login shell is zsh; associative arrays differ).

set -euo pipefail

REPO_ROOT_GUESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISJOINT="$REPO_ROOT_GUESS/scripts/check-disjointness.sh"

MODE=""
UNITS_FILE=""
RUN_ID=""
REPO="."
BASE=""
STORE=""
REAP_ALL=0
REAP_UNIT=""

usage() { sed -n '2,84p' "$0" | sed 's/^# \{0,1\}//'; }

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '; }

# json_array_from_lines <newline-separated> → ["a","b",...] (empty → [])
json_array_from_lines() {
  local items="$1" out="" first=1 line
  [ -z "$items" ] && { printf '[]'; return; }
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$first" = 1 ]; then first=0; else out="$out, "; fi
    out="$out\"$(json_escape "$line")\""
  done <<< "$items"
  printf '[%s]' "$out"
}

err_usage() { # message
  printf '{ "mode": "%s", "error": "%s", "exit": 2 }\n' "${MODE:-none}" "$(json_escape "$1")" >&2
  printf '{ "mode": "%s", "error": "%s", "exit": 2 }\n' "${MODE:-none}" "$(json_escape "$1")"
  exit 2
}

# ── unit-file parser ──────────────────────────────────────────────────────────
# Populates parallel arrays U_ID / U_SCOPE (csv globs, space-normalised to comma)
# / U_BASE. Accepts JSON-lines OR TSV per line. A per-line base is optional;
# missing → the batch --base. Returns the resolved batch base via $RESOLVED_BASE
# and sets MIXED_BASE=1 if any per-line base disagrees with the batch base.
declare -a U_ID=() U_SCOPE=() U_BASE=()
RESOLVED_BASE=""
MIXED_BASE=0

parse_units() {
  [ -n "$UNITS_FILE" ] || err_usage "--units <file> is required"
  [ -r "$UNITS_FILE" ] || err_usage "units file not readable: $UNITS_FILE"
  U_ID=(); U_SCOPE=(); U_BASE=()
  local line id scope base
  # batch base = explicit --base if given, else first unit's base (resolved below)
  local batch_base="$BASE"
  while IFS= read -r line || [ -n "$line" ]; do
    # strip comments + trim
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in
      '{'*)
        # JSON-line: pull id / scope / base via a tolerant field extractor.
        id="$(json_field "$line" id)"
        scope="$(json_field "$line" scope)"
        base="$(json_field "$line" base)"
        ;;
      *)
        # TSV: id <tab> scope-csv <tab> base
        IFS=$'\t' read -r id scope base <<< "$line"
        ;;
    esac
    [ -n "$id" ] || err_usage "unit with empty id in $UNITS_FILE"
    [ -n "$scope" ] || err_usage "unit '$id' has empty scope in $UNITS_FILE"
    # normalise scope: trim each comma-field, drop blanks
    local norm="" g
    while IFS= read -r g; do
      g="${g#"${g%%[![:space:]]*}"}"; g="${g%"${g##*[![:space:]]}"}"
      [ -n "$g" ] && norm="$norm${norm:+,}$g"
    done <<< "$(printf '%s' "$scope" | tr ',' '\n')"
    U_ID+=("$id"); U_SCOPE+=("$norm"); U_BASE+=("$base")
    if [ -z "$batch_base" ] && [ -n "$base" ]; then batch_base="$base"; fi
  done < "$UNITS_FILE"

  [ "${#U_ID[@]}" -ge 1 ] || err_usage "no units found in $UNITS_FILE"

  # If still no batch base, default to develop (matches dispatch-hetero default).
  [ -n "$batch_base" ] || batch_base="develop"
  RESOLVED_BASE="$batch_base"

  # single-base-per-batch enforcement: any per-line base that disagrees is mixed.
  local i
  for i in "${!U_ID[@]}"; do
    if [ -n "${U_BASE[$i]}" ] && [ "${U_BASE[$i]}" != "$batch_base" ]; then
      MIXED_BASE=1
    fi
  done
  # duplicate-id detection (would collide branch names).
  for i in "${!U_ID[@]}"; do
    local j
    for ((j=i+1; j<${#U_ID[@]}; j++)); do
      [ "${U_ID[$i]}" = "${U_ID[$j]}" ] && err_usage "duplicate unit id: ${U_ID[$i]}"
    done
  done
}

# json_field <json-line> <key> → value (string). Tolerant single-line extractor:
# the units file is machine-generated, so a regex field grab is sufficient and
# keeps us dependency-free (no jq). Handles "key":"value" and "key": value.
json_field() {
  local json="$1" key="$2"
  # quoted string value
  local v
  v="$(printf '%s' "$json" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  printf '%s' "$v"
}

branch_name() { printf 'unit-%s-%s' "$1" "$2"; }  # <id> <run-id>

# ── per-unit artifact read (the heart of verify) ──────────────────────────────
# Echoes "<status>US<commit>US<files>US<undeclared_csv>" for one unit branch
# (US = ASCII Unit Separator \x1f — a NON-whitespace delimiter so an empty
# leading field, e.g. a null commit on `failure`, survives the IFS read; a tab
# delimiter would collapse the empty field into the next). status ∈ committed /
# no_op / dirty / failure. Reads ONLY git artifacts.
US=$'\x1f'
unit_artifacts() {
  local id="$1" scope="$2" base="$3"
  local br; br="$(branch_name "$id" "$RUN_ID")"
  local base_sha head_sha
  if ! base_sha="$(git -C "$REPO" rev-parse --verify --quiet "$base^{commit}")"; then
    printf 'failure%s%s0%s' "$US" "$US" "$US"; return
  fi
  if ! head_sha="$(git -C "$REPO" rev-parse --verify --quiet "refs/heads/$br^{commit}")"; then
    # branch never created → the worker did not produce a reviewable artifact.
    printf 'failure%s%s0%s' "$US" "$US" "$US"; return
  fi
  if [ "$head_sha" = "$base_sha" ]; then
    printf 'no_op%s%s%s0%s' "$US" "$head_sha" "$US" "$US"; return
  fi
  # worktree cleanliness: a worktree may be checked out on this branch. If a
  # worktree exists for it and is dirty → dirty. (No worktree → can't be dirty.)
  local dirty="" wt
  wt="$(git -C "$REPO" worktree list --porcelain 2>/dev/null \
        | awk -v b="refs/heads/$br" '
            /^worktree /{w=$2}
            /^branch /{if($2==b) print w}')"
  if [ -n "$wt" ] && [ -d "$wt" ]; then
    dirty="$(git -C "$wt" status --porcelain 2>/dev/null)"
  fi
  # actual-touched files for the unit's own diff (base..branch).
  local touched undeclared
  touched="$(git -C "$REPO" -c core.quotepath=false diff --name-only "$base_sha" "$head_sha")"
  undeclared="$(disjoint_undeclared "$scope" "$base_sha..$head_sha")"
  local nfiles=0
  # awk count (no `| grep -c` — avoids the SIGPIPE-under-pipefail trap on a closed
  # reader, and counts non-blank lines without an exit-1-on-zero-match footgun).
  if [ -n "$touched" ]; then nfiles="$(printf '%s\n' "$touched" | awk 'NF{c++} END{print c+0}')"; fi
  local status="committed"
  [ -n "$dirty" ] && status="dirty"
  printf '%s%s%s%s%s%s%s' "$status" "$US" "$head_sha" "$US" "$nfiles" "$US" "$(printf '%s' "$undeclared" | tr '\n' ',')"
}

# disjoint_undeclared <scope-csv> <range> → newline list of undeclared touches
# (empty = clean). Delegates to check-disjointness validate (authoritative).
disjoint_undeclared() {
  local scope="$1" range="$2"
  local -a allow=()
  local g
  while IFS= read -r g; do [ -n "$g" ] && allow+=(--allow "$g"); done \
    <<< "$(printf '%s' "$scope" | tr ',' '\n')"
  local out
  # check-disjointness exits 1 on undeclared touch — capture without aborting.
  out="$("$DISJOINT" validate --repo "$REPO" "${allow[@]}" --range "$range" 2>/dev/null)" || true
  # pull the undeclared_touches array contents out of the JSON.
  printf '%s' "$out" \
    | sed -n 's/.*"undeclared_touches": \[\(.*\)\], "denylist_hits".*/\1/p' \
    | tr ',' '\n' | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' \
    | grep -v '^$' || true
}

# ── arg parse ─────────────────────────────────────────────────────────────────
[ $# -ge 1 ] || { usage; exit 2; }
case "$1" in
  --help|-h) usage; exit 0 ;;
  plan|verify|merge-back|telemetry|reap) MODE="$1"; shift ;;
  *) err_usage "first argument must be plan|verify|merge-back|telemetry|reap or --help (got: $1)" ;;
esac

EVENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --units) UNITS_FILE="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --store) STORE="${2:-}"; shift 2 ;;
    --event) EVENT="${2:-}"; shift 2 ;;
    --abort) REAP_ALL=1; shift ;;
    --unit) REAP_UNIT="${2:-}"; shift 2 ;;
    report) EVENT="report"; shift ;;   # `telemetry report` sub-form
    --help|-h) usage; exit 0 ;;
    *) err_usage "unknown argument: $1" ;;
  esac
done

[ -n "$RUN_ID" ] || { [ "$MODE" = telemetry ] && [ "$EVENT" = report ]; } || err_usage "--run-id is required"

default_store() {
  printf '%s/.autopilot/batch-telemetry/%s.jsonl' "${HOME:-/tmp}" "$RUN_ID"
}
default_reap_dir() {
  printf '%s/.autopilot/batch-reap/%s' "${HOME:-/tmp}" "$RUN_ID"
}

# ── plan ──────────────────────────────────────────────────────────────────────
if [ "$MODE" = plan ]; then
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || err_usage "not a git repository: $REPO"
  parse_units

  if [ "$MIXED_BASE" = 1 ]; then
    printf '{ "mode": "plan", "run_id": "%s", "valid": false, "verdict": "abort", "reason": "not a valid decomposition: mixed base per batch (all units must share one base)", "base": "%s" }\n' \
      "$(json_escape "$RUN_ID")" "$(json_escape "$RESOLVED_BASE")"
    exit 1
  fi

  # advisory overlap surface (propose). Logged, never a hard-fail here.
  local_units=()
  for i in "${!U_ID[@]}"; do local_units+=(--unit "${U_ID[$i]}=${U_SCOPE[$i]}"); done
  PROPOSE_OUT="$("$DISJOINT" propose "${local_units[@]}" 2>/dev/null)" || true
  ADV_DISJOINT="$(printf '%s' "$PROPOSE_OUT" | sed -n 's/.*"disjoint": \(true\|false\).*/\1/p')"
  [ -n "$ADV_DISJOINT" ] || ADV_DISJOINT="unknown"

  # emit the plan: one entry per unit (id, branch, scope[], base).
  units_json=""
  for i in "${!U_ID[@]}"; do
    br="$(branch_name "${U_ID[$i]}" "$RUN_ID")"
    scope_lines="$(printf '%s' "${U_SCOPE[$i]}" | tr ',' '\n')"
    units_json="$units_json${units_json:+, }{ \"id\": \"$(json_escape "${U_ID[$i]}")\", \"branch\": \"$(json_escape "$br")\", \"scope\": $(json_array_from_lines "$scope_lines"), \"base\": \"$(json_escape "$RESOLVED_BASE")\" }"
  done

  printf '{ "mode": "plan", "run_id": "%s", "valid": true, "verdict": "ready", "base": "%s", "width": %s, "advisory_disjoint": "%s", "units": [%s] }\n' \
    "$(json_escape "$RUN_ID")" "$(json_escape "$RESOLVED_BASE")" "${#U_ID[@]}" "$ADV_DISJOINT" "$units_json"
  exit 0
fi

# ── verify ────────────────────────────────────────────────────────────────────
if [ "$MODE" = verify ]; then
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || err_usage "not a git repository: $REPO"
  parse_units

  any_abort=0
  units_json=""
  for i in "${!U_ID[@]}"; do
    IFS="$US" read -r st commit nfiles undeclared <<< "$(unit_artifacts "${U_ID[$i]}" "${U_SCOPE[$i]}" "$RESOLVED_BASE")"
    # trim a trailing comma left by the tr '\n' ','
    undeclared="${undeclared%,}"
    undeclared_lines="$(printf '%s' "$undeclared" | tr ',' '\n')"
    disjoint_ok="true"
    [ -n "$undeclared" ] && disjoint_ok="false"
    # ALL-OR-NOTHING: a unit is mergeable only if committed AND disjoint-clean.
    if [ "$st" != "committed" ] || [ "$disjoint_ok" != "true" ]; then any_abort=1; fi
    commit_json="null"; [ -n "$commit" ] && commit_json="\"$commit\""
    br="$(branch_name "${U_ID[$i]}" "$RUN_ID")"
    units_json="$units_json${units_json:+, }{ \"id\": \"$(json_escape "${U_ID[$i]}")\", \"branch\": \"$(json_escape "$br")\", \"status\": \"$st\", \"commit\": $commit_json, \"files_changed\": ${nfiles:-0}, \"disjoint\": $disjoint_ok, \"undeclared_touches\": $(json_array_from_lines "$undeclared_lines") }"
  done

  if [ "$any_abort" = 1 ]; then
    verdict="abort"; ec=1
  else
    verdict="all_committed"; ec=0
  fi
  printf '{ "mode": "verify", "run_id": "%s", "base": "%s", "verdict": "%s", "units": [%s] }\n' \
    "$(json_escape "$RUN_ID")" "$(json_escape "$RESOLVED_BASE")" "$verdict" "$units_json"
  exit "$ec"
fi

# ── merge-back ────────────────────────────────────────────────────────────────
if [ "$MODE" = merge-back ]; then
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || err_usage "not a git repository: $REPO"
  [ -n "$BASE" ] || err_usage "merge-back requires --base <ref>"
  parse_units
  RESOLVED_BASE="$BASE"

  # Re-run verify's artifact logic; NEVER trust a stale verdict.
  any_abort=0
  declare -a OK_IDS=()
  for i in "${!U_ID[@]}"; do
    IFS="$US" read -r st commit nfiles undeclared <<< "$(unit_artifacts "${U_ID[$i]}" "${U_SCOPE[$i]}" "$RESOLVED_BASE")"
    undeclared="${undeclared%,}"
    if [ "$st" != "committed" ] || [ -n "$undeclared" ]; then
      any_abort=1
    else
      OK_IDS+=("${U_ID[$i]}")
    fi
  done
  if [ "$any_abort" = 1 ]; then
    printf '{ "mode": "merge-back", "run_id": "%s", "base": "%s", "verdict": "abort", "reason": "verify re-check failed: not all units committed-and-clean; merged nothing", "merged": [] }\n' \
      "$(json_escape "$RUN_ID")" "$(json_escape "$RESOLVED_BASE")"
    exit 1
  fi

  # All units committed-and-clean. Strategy: TRIAL-merge every unit branch in a
  # DETACHED-HEAD throwaway worktree first (a conflict can then be abandoned with
  # ZERO mutation of the real base ref — all-or-nothing). Only on a fully clean
  # set do we advance the real base branch to the integration tip. Advancing the
  # base must survive the case where `base` is checked out somewhere (git refuses
  # `branch -f` / `update-ref` on a checked-out branch): we find its worktree and
  # fast-forward there; if it is checked out nowhere we `update-ref` directly.
  base_sha="$(git -C "$REPO" rev-parse "$BASE")"
  INTEG_WT="$(mktemp -u -d -t "batch-integ-${RUN_ID}-XXXXXX")"
  # detached worktree at base_sha — no integration branch ref to leak/collide.
  if ! git -C "$REPO" worktree add --quiet --detach "$INTEG_WT" "$base_sha" >/dev/null 2>&1; then
    err_usage "could not create integration worktree"
  fi

  merged_ok=""
  conflict_id=""
  prev_id=""
  for id in "${OK_IDS[@]}"; do
    br="$(branch_name "$id" "$RUN_ID")"
    if git -C "$INTEG_WT" merge --no-edit --no-ff "$br" >/dev/null 2>&1; then
      merged_ok="$merged_ok${merged_ok:+,}$id"
      prev_id="$id"
    else
      git -C "$INTEG_WT" merge --abort >/dev/null 2>&1 || true
      conflict_id="$id"
      break
    fi
  done

  if [ -n "$conflict_id" ]; then
    # Merge-conflict-as-missing-edge: merge NOTHING (the detached worktree is
    # discarded → the real base ref is UNTOUCHED), emit serial_collapse naming
    # the conflicting ids. The previously-merged id + the conflicting id are the
    # coupled pair the caller must re-run as ONE Tier-1 serial unit.
    git -C "$REPO" worktree remove --force "$INTEG_WT" >/dev/null 2>&1 || true
    collapse_ids="$conflict_id"
    [ -n "$prev_id" ] && collapse_ids="$prev_id,$conflict_id"
    collapse_lines="$(printf '%s' "$collapse_ids" | tr ',' '\n')"
    printf '{ "mode": "merge-back", "run_id": "%s", "base": "%s", "verdict": "serial_collapse", "reason": "merge conflict on unit %s — re-run the named ids as ONE Tier-1 serial unit; never auto-resolve, never coordinated round-2 re-dispatch", "conflict_unit": "%s", "serial_collapse_ids": %s, "merged": [] }\n' \
      "$(json_escape "$RUN_ID")" "$(json_escape "$BASE")" "$(json_escape "$conflict_id")" "$(json_escape "$conflict_id")" "$(json_array_from_lines "$collapse_lines")"
    exit 1
  fi

  # all merged cleanly → advance the real base branch to the integration tip.
  integ_sha="$(git -C "$INTEG_WT" rev-parse HEAD)"
  git -C "$REPO" worktree remove --force "$INTEG_WT" >/dev/null 2>&1 || true
  # is `base` (a branch) checked out in some worktree? If so, ff-merge there;
  # else update the ref directly. Either lands integ_sha on the base BRANCH.
  base_wt="$(git -C "$REPO" worktree list --porcelain 2>/dev/null \
        | awk -v b="refs/heads/$BASE" '
            /^worktree /{w=$2}
            /^branch /{if($2==b) print w}')"
  if [ -n "$base_wt" ] && [ -d "$base_wt" ]; then
    git -C "$base_wt" merge --ff-only "$integ_sha" >/dev/null 2>&1 || true
  else
    git -C "$REPO" update-ref "refs/heads/$BASE" "$integ_sha" "$base_sha" >/dev/null 2>&1 || true
  fi
  merged_lines="$(printf '%s' "$merged_ok" | tr ',' '\n')"
  printf '{ "mode": "merge-back", "run_id": "%s", "base": "%s", "verdict": "merged", "merge_commit": "%s", "merged": %s }\n' \
    "$(json_escape "$RUN_ID")" "$(json_escape "$BASE")" "$integ_sha" "$(json_array_from_lines "$merged_lines")"
  exit 0
fi

# ── telemetry ─────────────────────────────────────────────────────────────────
if [ "$MODE" = telemetry ]; then
  if [ "$EVENT" = report ]; then
    # Cross-run report over ALL stored runs (or a single --store file).
    local_store_dir="${HOME:-/tmp}/.autopilot/batch-telemetry"
    [ -n "$STORE" ] && local_store_dir="$(dirname "$STORE")"
    rows=""
    shopt -s nullglob
    declare -a files
    if [ -n "$STORE" ]; then files=("$STORE"); else files=("$local_store_dir"/*.jsonl); fi
    shopt -u nullglob
    n_runs=0
    for f in "${files[@]}"; do
      [ -r "$f" ] || continue
      # extract the three event epochs from this run's store.
      t_disp="$(awk -F'"epoch": ' '/t_dispatch/{print $2+0; exit}' "$f" 2>/dev/null || true)"
      t_all="$(awk -F'"epoch": ' '/t_all_committed/{print $2+0; exit}' "$f" 2>/dev/null || true)"
      t_rev="$(awk -F'"epoch": ' '/t_review_done/{print $2+0; exit}' "$f" 2>/dev/null || true)"
      [ -n "$t_disp" ] && [ -n "$t_all" ] && [ -n "$t_rev" ] || continue
      rid="$(basename "$f" .jsonl)"
      # parallel section = dispatch→all_committed; serial tail = all_committed→review_done.
      par=$(( t_all - t_disp )); ser=$(( t_rev - t_all )); wall=$(( t_rev - t_disp ))
      [ "$wall" -le 0 ] && continue
      # serial fraction f = serial / wall ; Amdahl speedup bound = 1/f as width→∞.
      sf="$(awk -v s="$ser" -v w="$wall" 'BEGIN{ if(w>0) printf "%.3f", s/w; else print "0" }')"
      sp="$(awk -v s="$ser" -v w="$wall" 'BEGIN{ if(s>0) printf "%.2f", w/s; else print "inf" }')"
      rows="$rows${rows:+, }{ \"run_id\": \"$(json_escape "$rid")\", \"parallel_s\": $par, \"serial_s\": $ser, \"wall_s\": $wall, \"serial_fraction\": $sf, \"amdahl_speedup_bound\": \"$sp\" }"
      n_runs=$((n_runs+1))
    done
    printf '{ "mode": "telemetry", "report": true, "runs": %s, "rows": [%s] }\n' "$n_runs" "$rows"
    exit 0
  fi

  case "$EVENT" in
    t_dispatch|t_all_committed|t_review_done) : ;;
    *) err_usage "telemetry --event must be one of t_dispatch|t_all_committed|t_review_done (got: ${EVENT:-<none>})" ;;
  esac
  STORE_PATH="${STORE:-$(default_store)}"
  mkdir -p "$(dirname "$STORE_PATH")"
  EPOCH="$(date +%s)"
  ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{ "run_id": "%s", "event": "%s", "epoch": %s, "iso": "%s" }\n' \
    "$(json_escape "$RUN_ID")" "$EVENT" "$EPOCH" "$ISO" >> "$STORE_PATH"
  printf '{ "mode": "telemetry", "run_id": "%s", "event": "%s", "epoch": %s, "store": "%s" }\n' \
    "$(json_escape "$RUN_ID")" "$EVENT" "$EPOCH" "$(json_escape "$STORE_PATH")"
  exit 0
fi

# ── reap ──────────────────────────────────────────────────────────────────────
# The parallel-kill trap for SHELL-DISPATCHED workers. Each worker, when
# launched by the orchestrator's shell loop, records its process-GROUP id in a
# per-unit pgid file under the reap dir. reap sends SIGTERM to those groups.
#
# The reap dir layout (written by the dispatch loop, read here):
#   <reap-dir>/<unit-id>.pgid   — one line: the worker's process-group id
#
# --abort      → TERM every unit's pgid (batch aborted).
# --unit <id>  → TERM just that one unit's pgid (one unit stalled, keep rest).
if [ "$MODE" = reap ]; then
  REAP_DIR="${STORE:-$(default_reap_dir)}"
  [ -d "$REAP_DIR" ] || err_usage "reap dir not found: $REAP_DIR (no workers registered for run $RUN_ID)"
  [ "$REAP_ALL" = 1 ] || [ -n "$REAP_UNIT" ] || err_usage "reap requires --abort (all units) or --unit <id> (one unit)"

  reaped=""
  reap_one_pgid() { # <pgid> <id>
    local pgid="$1" id="$2"
    # Only the negative-pgid form signals the whole GROUP. Guard a bogus/dead pgid.
    if kill -0 "-$pgid" 2>/dev/null; then
      kill -TERM "-$pgid" 2>/dev/null || true
      reaped="$reaped${reaped:+,}$id"
    fi
  }

  if [ "$REAP_ALL" = 1 ]; then
    shopt -s nullglob
    for pf in "$REAP_DIR"/*.pgid; do
      id="$(basename "$pf" .pgid)"
      pgid="$(cat "$pf" 2>/dev/null || true)"
      [ -n "$pgid" ] && reap_one_pgid "$pgid" "$id"
    done
    shopt -u nullglob
    scope_label="all"
  else
    pf="$REAP_DIR/$REAP_UNIT.pgid"
    [ -r "$pf" ] || err_usage "no pgid registered for unit: $REAP_UNIT"
    pgid="$(cat "$pf" 2>/dev/null || true)"
    [ -n "$pgid" ] && reap_one_pgid "$pgid" "$REAP_UNIT"
    scope_label="unit:$REAP_UNIT"
  fi

  reaped_lines="$(printf '%s' "$reaped" | tr ',' '\n')"
  printf '{ "mode": "reap", "run_id": "%s", "scope": "%s", "reaped": %s }\n' \
    "$(json_escape "$RUN_ID")" "$scope_label" "$(json_array_from_lines "$reaped_lines")"
  exit 0
fi

err_usage "unhandled mode: $MODE"
