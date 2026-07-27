#!/usr/bin/env bash
# Deterministic lifecycle controller for schema-2 dispatch worktrees.

set -uo pipefail

usage() {
  local exit_code="${1:-2}"
  printf '%s\n' \
    'usage: reap-dispatch-worktrees.sh scan|check|reap --repo <dir> --root-run-id <id> [--yes]' >&2
  exit "$exit_code"
}

die_env() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

command_name="${1:-}"
case "$command_name" in
  scan|check|reap) shift ;;
  --help|-h) usage 0 ;;
  *) usage ;;
esac

repo="."
root_run_id=""
yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --root-run-id) [ "$#" -ge 2 ] || usage; root_run_id="$2"; shift 2 ;;
    --yes) [ "$command_name" = "reap" ] || usage; yes=1; shift ;;
    --help|-h) usage 0 ;;
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
repo_identity="git-common-dir:$common_dir"

git_common() {
  git --git-dir="$common_dir" "$@"
}

_wt_open_lock_fd "$common_dir/autopilot-worktree-budget.lock" \
  || die_env "cannot open repository lifecycle lock"
lifecycle_fd="$_WT_SAFE_LOCK_FD"
flock -x "$lifecycle_fd" || die_env "cannot acquire repository lifecycle lock"

declare -a owned_items=() clean_items=() dirty_items=() live_items=()
declare -a unsupported_items=() malformed_items=() legacy_items=()
declare -a status_unsupported_items=() pending_items=() raced_items=() reaped_items=()
declare -a inventory_record_items=()
declare -A snapshot_head=() snapshot_branch=()
declare -a snapshot_paths=()
inventory_dir="$common_dir/autopilot-worktree-branch-inventory"

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

persist_branch_inventory() {
  local path="$1" branch="$2" tip="$3" marker_sha="$4"
  local key record tmp
  _INVENTORY_RECORD_PATH=""
  if [ -e "$inventory_dir" ] || [ -L "$inventory_dir" ]; then
    [ -d "$inventory_dir" ] && [ ! -L "$inventory_dir" ] && [ -O "$inventory_dir" ] \
      || return 1
  else
    (umask 077; mkdir "$inventory_dir") || return 1
  fi
  key="$(
    printf '%s\0%s\0%s\0%s\0' "$root_run_id" "$path" "$branch" "$tip" \
      | sha256sum | awk '{print $1}'
  )"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || return 1
  record="$inventory_dir/$key.json"
  tmp="$(mktemp "$inventory_dir/.inventory.XXXXXX")" || return 1
  if ! printf \
    '{"schema":1,"root_run_id":"%s","path":"%s","branch":"%s","tip":"%s","marker_sha256":"%s","captured_at":%s}\n' \
    "$(json_escape "$root_run_id")" "$(json_escape "$path")" "$(json_escape "$branch")" \
    "$(json_escape "$tip")" "$(json_escape "$marker_sha")" "$(date +%s)" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$record" || { rm -f "$tmp"; return 1; }
  _INVENTORY_RECORD_PATH="$record"
}

load_journal_branch_inventory() {
  _JOURNAL_BRANCH_INVENTORY='[]'
  [ -e "$inventory_dir" ] || [ -L "$inventory_dir" ] || return 0
  [ -d "$inventory_dir" ] && [ ! -L "$inventory_dir" ] && [ -O "$inventory_dir" ] \
    || return 1
  _JOURNAL_BRANCH_INVENTORY="$(
    node - "$inventory_dir" "$root_run_id" "$common_dir/autopilot-branch-dispositions" \
      "$repo_identity" <<'NODE'
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const directory = process.argv[2];
const rootRunId = process.argv[3];
const dispositionDirectory = process.argv[4];
const repoIdentity = process.argv[5];
const branches = new Map();
for (const name of fs.readdirSync(directory).sort()) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.root_run_id !== rootRunId) continue;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "branch,captured_at,marker_sha256,path,root_run_id,schema,tip"
      || value.schema !== 1 || typeof value.branch !== "string"
      || /[\u0000-\u001f\u007f]/.test(value.branch)
      || typeof value.path !== "string" || !path.isAbsolute(value.path)
      || /\u0000/.test(value.path)
      || !/^[0-9a-f]{40,64}$/.test(value.tip)
      || !/^[0-9a-f]{64}$/.test(value.marker_sha256)
      || !Number.isSafeInteger(value.captured_at) || value.captured_at < 1) process.exit(2);
  const expectedName = `${crypto.createHash("sha256")
    .update(`${rootRunId}\0${value.path}\0${value.branch}\0${value.tip}\0`)
    .digest("hex")}.json`;
  if (name !== expectedName) process.exit(2);
  if (branches.has(value.branch)) process.exit(2);
  branches.set(value.branch, value.tip);
}
const resolved = new Map();
if (fs.existsSync(dispositionDirectory)) {
  const directoryStat = fs.lstatSync(dispositionDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) process.exit(2);
  for (const name of fs.readdirSync(dispositionDirectory).sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const file = path.join(dispositionDirectory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.root_run_id !== rootRunId) continue;
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "acknowledged,branch,bundle,disposition,inventory_digest,recorded_at,repo_identity,root_run_id,schema,tip"
        || value.schema !== 1 || value.repo_identity !== repoIdentity
        || !branches.has(value.branch) || branches.get(value.branch) !== value.tip
        || !["reaped", "preserved", "failed"].includes(value.disposition)
        || typeof value.acknowledged !== "boolean"
        || (value.disposition !== "preserved" && value.acknowledged)
        || !(value.bundle === null || typeof value.bundle === "string")
        || !/^[0-9a-f]{64}$/.test(value.inventory_digest)
        || !Number.isSafeInteger(value.recorded_at) || value.recorded_at < 1) process.exit(2);
    const expectedName = `${crypto.createHash("sha256")
      .update(`${rootRunId}\0${value.branch}\0${value.tip}\0`)
      .digest("hex")}.json`;
    if (name !== expectedName || resolved.has(value.branch)) process.exit(2);
    resolved.set(value.branch, value);
  }
}
process.stdout.write(JSON.stringify(
  [...branches.entries()]
    .filter(([branch]) => {
      const value = resolved.get(branch);
      let refExists = false;
      if (value?.disposition === "reaped") {
        const ref = `refs/heads/${branch}`;
        refExists = spawnSync("git", [
          "--git-dir", path.dirname(directory),
          "show-ref", "--verify", "--quiet", ref,
        ]).status === 0 || spawnSync("git", [
          "--git-dir", path.dirname(directory),
          "symbolic-ref", "-q", ref,
        ]).status === 0;
      }
      return !value || refExists || !(value.disposition === "reaped"
        || (value.disposition === "preserved" && value.acknowledged));
    })
    .map(([branch, tip]) => ({ branch, tip }))
    .sort((left, right) => left.branch.localeCompare(right.branch)),
));
NODE
  )" || return 1
}

load_worktree_snapshot() {
  local list_file token path="" head="" branch=""
  snapshot_paths=()
  snapshot_head=()
  snapshot_branch=()
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-worktree-list.XXXXXX")" || return 1
  if ! git_common worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f "$list_file"
    return 1
  fi
  while IFS= read -r -d '' token; do
    if [ -z "$token" ]; then
      if [ -n "$path" ]; then
        snapshot_paths+=("$path")
        snapshot_head["$path"]="$head"
        snapshot_branch["$path"]="$branch"
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$token" in
      worktree\ *) path="${token#worktree }" ;;
      HEAD\ *) head="${token#HEAD }" ;;
      branch\ refs/heads/*) branch="${token#branch refs/heads/}" ;;
    esac
  done < "$list_file"
  rm -f "$list_file"
}

current_metadata() {
  local expected="$1" list_file token path="" head="" branch=""
  _CURRENT_FOUND=0
  _CURRENT_HEAD=""
  _CURRENT_BRANCH=""
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-worktree-current.XXXXXX")" || return 2
  if ! git_common worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f "$list_file"
    return 2
  fi
  while IFS= read -r -d '' token; do
    if [ -z "$token" ]; then
      if [ "$path" = "$expected" ]; then
        _CURRENT_FOUND=1
        _CURRENT_HEAD="$head"
        _CURRENT_BRANCH="$branch"
        rm -f "$list_file"
        return 0
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$token" in
      worktree\ *) path="${token#worktree }" ;;
      HEAD\ *) head="${token#HEAD }" ;;
      branch\ refs/heads/*) branch="${token#branch refs/heads/}" ;;
    esac
  done < "$list_file"
  rm -f "$list_file"
  return 0
}

probe_is_current() {
  local path="$1" fd="$2" lock="$path/.autopilot-worktree.lock" fd_path
  fd_path="/proc/$$/fd/$fd"
  [ -e "$fd_path" ] || fd_path="/dev/fd/$fd"
  [ -f "$lock" ] && [ ! -L "$lock" ] && [ -O "$lock" ] \
    && [ -f "$fd_path" ] && [ -O "$fd_path" ] && [ "$fd_path" -ef "$lock" ]
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
    if [ "${#fields[@]}" -ne 6 ]; then
      append_item malformed_items "$(worktree_object \
        "$record" "" "" "malformed" "invalid_pending_record")"
      continue
    fi
    [ "${fields[0]}" = "$root_run_id" ] || continue
    if ! [[ "${fields[0]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[1]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[2]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[4]}" =~ ^[0-9a-f]{40,64}$ ]] \
       || [[ "${fields[5]}" != /* ]] \
       || _wt_has_control_chars "${fields[5]}" \
       || ! git check-ref-format --branch "${fields[3]}" >/dev/null 2>&1; then
      append_item malformed_items "$(worktree_object \
        "$record" "${fields[3]}" "${fields[4]}" "malformed" "invalid_pending_identity")"
      continue
    fi
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
  marker="$path/.autopilot-worktree"
  [ -e "$marker" ] || [ -L "$marker" ] || continue
  branch="${snapshot_branch[$path]:-}"
  tip="${snapshot_head[$path]:-}"

  if [ -f "$marker" ] && [ ! -L "$marker" ] && [ -O "$marker" ] \
     && grep -qx 'schema=1' "$marker" 2>/dev/null; then
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
  marker_digest="$(sha256sum < "$marker" 2>/dev/null | awk '{print $1}')"
  path_common="$(_wt_resolve_common_dir "$path" 2>/dev/null || true)"
  ref_tip="$(git_common rev-parse --verify --quiet "refs/heads/$marker_branch" 2>/dev/null || true)"

  if [ -z "$marker_digest" ] || [ "$path_common" != "$common_dir" ] \
     || [ "$branch" != "$marker_branch" ] || [ "$tip" != "$ref_tip" ] \
     || ! git_common merge-base --is-ancestor "$marker_base" "$tip" 2>/dev/null; then
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

  _wt_is_clean "$path"
  clean_rc=$?
  if [ "$clean_rc" -ne 0 ]; then
    if [ "$clean_rc" -eq 2 ]; then
      item="$(worktree_object "$path" "$branch" "$tip" "status_unsupported" "status_command_failed")"
      append_item status_unsupported_items "$item"
    else
      item="$(worktree_object "$path" "$branch" "$tip" "dirty" "worktree_not_clean")"
      append_item dirty_items "$item"
    fi
    append_item owned_items "$item"
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

  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_RACE_PATH:-}" = "$path" ]; then
    printf '%s\n' "race" > "$path/.autopilot-test-race"
  fi
  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_LOCK_RACE_PATH:-}" = "$path" ]; then
    rm -f "$path/.autopilot-worktree.lock"
    : > "$path/.autopilot-worktree.lock"
  fi
  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_MARKER_RACE_PATH:-}" = "$path" ]; then
    printf '%s\n' "marker-race=1" >> "$marker"
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
  if [ -z "$raced_reason" ]; then
    _wt_is_clean "$path"
    clean_rc=$?
    if [ "$clean_rc" -eq 2 ]; then
      raced_reason="status_command_failed"
    elif [ "$clean_rc" -ne 0 ]; then
      raced_reason="cleanliness_changed"
    fi
  fi
  [ -n "$raced_reason" ] || probe_is_current "$path" "$probe_fd" \
    || raced_reason="lifetime_lock_changed"
  [ -n "$raced_reason" ] \
    || [ "$(git_common rev-parse --verify --quiet "refs/heads/$branch" 2>/dev/null || true)" = "$tip" ] \
    || raced_reason="branch_tip_changed"
  [ -n "$raced_reason" ] \
    || [ "$(sha256sum < "$marker" 2>/dev/null | awk '{print $1}')" = "$marker_digest" ] \
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
  if [ -z "$raced_reason" ]; then
    persist_branch_inventory "$path" "$branch" "$tip" "$marker_digest" \
      || raced_reason="inventory_persist_failed"
  fi

  if [ -z "$raced_reason" ] && git_common worktree remove "$path" >/dev/null 2>&1; then
    reaped_item="$(worktree_object "$path" "$branch" "$tip" "reaped" "dead_clean_exact")"
    append_item reaped_items "$reaped_item"
    append_item inventory_record_items "$(printf \
      '{"path":"%s","branch":"%s","tip":"%s","record":"%s"}' \
      "$(json_escape "$path")" "$(json_escape "$branch")" "$(json_escape "$tip")" \
      "$(json_escape "$_INVENTORY_RECORD_PATH")")"
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

load_journal_branch_inventory \
  || die_env "cannot reconstruct exact branch inventory journal"

printf '{"schema":1,"command":"%s","repo":"%s","git_common_dir":"%s","root_run_id":"%s","observed_owned_count":%s,"owned_worktree_count":%s,"unresolved_pending_count":%s,"owned":' \
  "$command_name" "$(json_escape "$repo")" "$(json_escape "$common_dir")" \
  "$(json_escape "$root_run_id")" "$observed_owned_count" "$remaining_owned_count" \
  "${#pending_items[@]}"
emit_array owned_items
printf ',"clean_dead":'; emit_array clean_items
printf ',"dirty":'; emit_array dirty_items
printf ',"live":'; emit_array live_items
printf ',"lock_unsupported":'; emit_array unsupported_items
printf ',"status_unsupported":'; emit_array status_unsupported_items
printf ',"malformed":'; emit_array malformed_items
printf ',"legacy":'; emit_array legacy_items
printf ',"pending_creation":'; emit_array pending_items
printf ',"raced":'; emit_array raced_items
printf ',"reaped":'; emit_array reaped_items
printf ',"branch_inventory":'; emit_array reaped_items
printf ',"branch_inventory_records":'; emit_array inventory_record_items
printf ',"journal_branch_inventory":%s' "$_JOURNAL_BRANCH_INVENTORY"
printf '}\n'

exec {lifecycle_fd}>&-
if [ "$command_name" = "check" ] \
   && { [ "$remaining_owned_count" -ne 0 ] || [ "${#pending_items[@]}" -ne 0 ]; }; then
  exit 1
fi
exit 0
