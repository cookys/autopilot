#!/usr/bin/env bash
# Deterministic lifecycle controller for schema-2 dispatch worktrees.

set -uo pipefail

usage() {
  printf '%s\n' \
    'usage: reap-dispatch-worktrees.sh scan|check|reap --repo <dir> --root-run-id <id> [--yes]' >&2
  exit 2
}

die_env() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

command_name="${1:-}"
case "$command_name" in scan|check|reap) shift ;; *) usage ;; esac

repo="."
root_run_id=""
yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --root-run-id) [ "$#" -ge 2 ] || usage; root_run_id="$2"; shift 2 ;;
    --yes) [ "$command_name" = "reap" ] || usage; yes=1; shift ;;
    --help|-h) usage ;;
    *) usage ;;
  esac
done

[[ "$root_run_id" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die_env "--root-run-id must match [A-Za-z0-9._-]+"
[ "$command_name" != "reap" ] || [ "$yes" -eq 1 ] \
  || die_env "reap requires --yes"

repo="$(cd "$repo" 2>/dev/null && pwd -P)" \
  || die_env "repository directory is not readable"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 \
  || die_env "not a git repository: $repo"

self_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/json-emit.sh
. "$self_dir/lib/json-emit.sh"
# shellcheck source=lib/worktree-reap.sh
. "$self_dir/lib/worktree-reap.sh"

common_dir="$(_wt_resolve_common_dir "$repo")" \
  || die_env "cannot resolve canonical git common directory"
_wt_open_lock_fd "$common_dir/autopilot-worktree-budget.lock" \
  || die_env "cannot open repository lifecycle lock"
lifecycle_fd="$_WT_SAFE_LOCK_FD"
flock -x "$lifecycle_fd" || die_env "cannot acquire repository lifecycle lock"

declare -a owned_items=() clean_items=() dirty_items=() live_items=()
declare -a unsupported_items=() malformed_items=() legacy_items=()
declare -a pending_items=() raced_items=() reaped_items=()
declare -A snapshot_head=() snapshot_branch=()
declare -a snapshot_paths=()

append_item() {
  local array_name="$1" value="$2"
  local -n target="$array_name"
  target+=("$value")
}

emit_array() {
  local array_name="$1" first=1 value
  local -n source="$array_name"
  printf '['
  for value in "${source[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '%s' "$value"
  done
  printf ']'
}

worktree_object() {
  local path="$1" branch="$2" tip="$3" state="$4" reason="$5"
  printf '{"path":"%s","branch":"%s","tip":"%s","state":"%s","reason":"%s"}' \
    "$(json_escape "$path")" "$(json_escape "$branch")" "$(json_escape "$tip")" \
    "$(json_escape "$state")" "$(json_escape "$reason")"
}

load_worktree_snapshot() {
  local list line path="" head="" branch=""
  snapshot_paths=()
  snapshot_head=()
  snapshot_branch=()
  list="$(git -C "$repo" worktree list --porcelain 2>/dev/null)" || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -z "$line" ]; then
      if [ -n "$path" ]; then
        snapshot_paths+=("$path")
        snapshot_head["$path"]="$head"
        snapshot_branch["$path"]="$branch"
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$line" in
      worktree\ *) path="${line#worktree }" ;;
      HEAD\ *) head="${line#HEAD }" ;;
      branch\ refs/heads/*) branch="${line#branch refs/heads/}" ;;
    esac
  done <<< "$list"
  if [ -n "$path" ]; then
    snapshot_paths+=("$path")
    snapshot_head["$path"]="$head"
    snapshot_branch["$path"]="$branch"
  fi
}

current_metadata() {
  local expected="$1" list line path="" head="" branch=""
  _CURRENT_FOUND=0
  _CURRENT_HEAD=""
  _CURRENT_BRANCH=""
  list="$(git -C "$repo" worktree list --porcelain 2>/dev/null)" || return 2
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -z "$line" ]; then
      if [ "$path" = "$expected" ]; then
        _CURRENT_FOUND=1
        _CURRENT_HEAD="$head"
        _CURRENT_BRANCH="$branch"
        return 0
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$line" in
      worktree\ *) path="${line#worktree }" ;;
      HEAD\ *) head="${line#HEAD }" ;;
      branch\ refs/heads/*) branch="${line#branch refs/heads/}" ;;
    esac
  done <<< "$list"
  if [ "$path" = "$expected" ]; then
    _CURRENT_FOUND=1
    _CURRENT_HEAD="$head"
    _CURRENT_BRANCH="$branch"
  fi
  return 0
}

load_pending_records() {
  local pending_dir="$common_dir/autopilot-worktree-creation"
  local record fields=()
  [ -d "$pending_dir" ] || return 0
  for record in "$pending_dir"/*.json; do
    [ -e "$record" ] || continue
    [ -f "$record" ] && [ ! -L "$record" ] && [ -O "$record" ] || continue
    mapfile -t fields < <(node -e '
const fs = require("fs");
try {
  const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = ["root_run_id", "run_id", "loop_id", "branch", "base_sha", "planned_path"];
  if (!v || v.schema !== 1 || keys.some(k => typeof v[k] !== "string")) process.exit(2);
  for (const k of keys) console.log(v[k]);
} catch (_) { process.exit(2); }
' "$record" 2>/dev/null)
    [ "${#fields[@]}" -eq 6 ] || continue
    [ "${fields[0]}" = "$root_run_id" ] || continue
    append_item pending_items "$(printf \
      '{"record":"%s","path":"%s","branch":"%s","base_sha":"%s","run_id":"%s","loop_id":"%s"}' \
      "$(json_escape "$record")" "$(json_escape "${fields[5]}")" \
      "$(json_escape "${fields[3]}")" "$(json_escape "${fields[4]}")" \
      "$(json_escape "${fields[1]}")" "$(json_escape "${fields[2]}")")"
  done
}

load_worktree_snapshot || die_env "cannot enumerate registered worktrees"
load_pending_records

observed_owned_count=0
remaining_owned_count=0

for path in "${snapshot_paths[@]}"; do
  [ "$path" != "$repo" ] || continue
  marker="$path/.autopilot-worktree"
  [ -e "$marker" ] || [ -L "$marker" ] || continue
  branch="${snapshot_branch[$path]:-}"
  tip="${snapshot_head[$path]:-}"

  if grep -qx 'schema=1' "$marker" 2>/dev/null; then
    item="$(worktree_object "$path" "$branch" "$tip" "legacy" "schema_1_unknown_lineage")"
    append_item legacy_items "$item"
    continue
  fi
  if ! _wt_read_schema2_marker "$marker"; then
    item="$(worktree_object "$path" "$branch" "$tip" "malformed" "invalid_schema_2_marker")"
    append_item malformed_items "$item"
    continue
  fi
  [ "$_WT_MARKER_ROOT_RUN_ID" = "$root_run_id" ] || continue

  observed_owned_count=$((observed_owned_count + 1))
  marker_branch="$_WT_MARKER_BRANCH"
  marker_base="$_WT_MARKER_BASE_SHA"
  marker_digest="$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')"
  path_common="$(_wt_resolve_common_dir "$path" 2>/dev/null || true)"
  ref_tip="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$marker_branch" 2>/dev/null || true)"

  if [ -z "$marker_digest" ] || [ "$path_common" != "$common_dir" ] \
     || [ "$branch" != "$marker_branch" ] || [ "$tip" != "$ref_tip" ] \
     || ! git -C "$repo" merge-base --is-ancestor "$marker_base" "$tip" 2>/dev/null; then
    item="$(worktree_object "$path" "$branch" "$tip" "malformed" "ownership_identity_mismatch")"
    append_item owned_items "$item"
    append_item malformed_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi

  marker_run="$_WT_MARKER_RUN_ID"
  marker_loop="$_WT_MARKER_LOOP_ID"
  _wt_is_live "$path"
  live_rc=$?
  probe_fd="${_WT_PROBE_FD:-}"
  if [ "$live_rc" -eq 1 ]; then
    item="$(worktree_object "$path" "$branch" "$tip" "live" "lifetime_lock_held")"
    append_item owned_items "$item"
    append_item live_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi
  if [ "$live_rc" -eq 2 ]; then
    item="$(worktree_object "$path" "$branch" "$tip" "lock_unsupported" "lifetime_lock_unavailable")"
    append_item owned_items "$item"
    append_item unsupported_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi

  if ! _wt_is_clean "$path"; then
    item="$(worktree_object "$path" "$branch" "$tip" "dirty" "worktree_not_clean")"
    append_item owned_items "$item"
    append_item dirty_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi

  clean_item="$(worktree_object "$path" "$branch" "$tip" "clean_dead" "eligible")"
  if [ "$command_name" != "reap" ]; then
    append_item owned_items "$clean_item"
    append_item clean_items "$clean_item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi

  if [ "${AUTOPILOT_TEST_WORKTREE_REAP_RACE_PATH:-}" = "$path" ]; then
    printf '%s\n' "race" > "$path/.autopilot-test-race"
  fi

  current_metadata "$path"
  metadata_rc=$?
  raced_reason=""
  [ "$metadata_rc" -eq 0 ] || raced_reason="worktree_enumeration_failed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_FOUND" -eq 1 ] \
    || raced_reason="registration_changed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_HEAD" = "$tip" ] \
    || raced_reason="head_changed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_BRANCH" = "$branch" ] \
    || raced_reason="branch_changed"
  [ -n "$raced_reason" ] \
    || [ "$(sha256sum "$marker" 2>/dev/null | awk '{print $1}')" = "$marker_digest" ] \
    || raced_reason="marker_changed"
  if [ -z "$raced_reason" ]; then
    if ! _wt_read_schema2_marker "$marker" \
       || [ "$_WT_MARKER_ROOT_RUN_ID" != "$root_run_id" ] \
       || [ "$_WT_MARKER_RUN_ID" != "$marker_run" ] \
       || [ "$_WT_MARKER_LOOP_ID" != "$marker_loop" ] \
       || [ "$_WT_MARKER_BRANCH" != "$branch" ] \
       || [ "$_WT_MARKER_BASE_SHA" != "$marker_base" ]; then
      raced_reason="marker_identity_changed"
    fi
  fi
  [ -n "$raced_reason" ] \
    || [ "$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$branch" 2>/dev/null || true)" = "$tip" ] \
    || raced_reason="branch_tip_changed"
  [ -n "$raced_reason" ] || _wt_is_clean "$path" || raced_reason="cleanliness_changed"

  if [ -z "$raced_reason" ] && git -C "$repo" worktree remove "$path" >/dev/null 2>&1; then
    reaped_item="$(worktree_object "$path" "$branch" "$tip" "reaped" "dead_clean_exact")"
    append_item reaped_items "$reaped_item"
  else
    [ -n "$raced_reason" ] || raced_reason="remove_failed"
    item="$(worktree_object "$path" "$branch" "$tip" "raced" "$raced_reason")"
    append_item owned_items "$item"
    append_item raced_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
  fi
  [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
  _WT_PROBE_FD=""
done

printf '{"schema":1,"command":"%s","repo":"%s","git_common_dir":"%s","root_run_id":"%s","observed_owned_count":%s,"owned_worktree_count":%s,"owned":' \
  "$command_name" "$(json_escape "$repo")" "$(json_escape "$common_dir")" \
  "$(json_escape "$root_run_id")" "$observed_owned_count" "$remaining_owned_count"
emit_array owned_items
printf ',"clean_dead":'; emit_array clean_items
printf ',"dirty":'; emit_array dirty_items
printf ',"live":'; emit_array live_items
printf ',"lock_unsupported":'; emit_array unsupported_items
printf ',"malformed":'; emit_array malformed_items
printf ',"legacy":'; emit_array legacy_items
printf ',"pending_creation":'; emit_array pending_items
printf ',"raced":'; emit_array raced_items
printf ',"reaped":'; emit_array reaped_items
printf '}\n'

exec {lifecycle_fd}>&-
if [ "$command_name" = "check" ] && [ "$remaining_owned_count" -ne 0 ]; then
  exit 1
fi
exit 0
