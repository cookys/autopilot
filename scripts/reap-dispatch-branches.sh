#!/usr/bin/env bash
# Preserve-first lifecycle tool for local dispatch-owned branches.

set -uo pipefail

usage() {
  printf '%s\n' \
    'usage: reap-dispatch-branches.sh scan|check|reap [options]' \
    '  shared: --repo <dir> --into <ref> --pattern <bash-ere>' \
    '  check:  --ack <integration-candidate-branch>' \
    '  reap:   --dry-run --yes --reap-superseded --bundle-dir <dir>' >&2
  exit 2
}

die_env() { printf 'error: %s\n' "$*" >&2; exit 2; }

json_escape() {
  local input="${1:-}" out="" ch esc code i
  local LC_ALL=C
  for ((i=0; i<${#input}; i++)); do
    ch="${input:i:1}"
    case "$ch" in
      '"') out+='\"' ;;
      '\') out+='\\' ;;
      $'\b') out+='\b' ;;
      $'\f') out+='\f' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      *)
        printf -v code '%d' "'$ch"
        if [ "$code" -lt 32 ]; then
          printf -v esc '\\u%04x' "$code"
          out+="$esc"
        else
          out+="$ch"
        fi
        ;;
    esac
  done
  printf '%s' "$out"
}

command_name="${1:-}"
case "$command_name" in scan|check|reap) shift ;; *) usage ;; esac

repo="."
into="develop"
ack_branch=""
yes=0
dry_run=0
reap_superseded=0
bundle_dir=""
declare -a extra_patterns=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --into) [ "$#" -ge 2 ] || usage; into="$2"; shift 2 ;;
    --pattern) [ "$#" -ge 2 ] || usage; extra_patterns+=("$2"); shift 2 ;;
    --ack) [ "$command_name" = check ] && [ "$#" -ge 2 ] || usage; ack_branch="$2"; shift 2 ;;
    --dry-run) [ "$command_name" = reap ] || usage; dry_run=1; shift ;;
    --yes) [ "$command_name" = reap ] || usage; yes=1; shift ;;
    --reap-superseded) [ "$command_name" = reap ] || usage; reap_superseded=1; shift ;;
    --bundle-dir) [ "$command_name" = reap ] && [ "$#" -ge 2 ] || usage; bundle_dir="$2"; shift 2 ;;
    --help|-h) usage ;;
    *) usage ;;
  esac
done

repo="$(cd "$repo" 2>/dev/null && pwd -P)" || die_env "repository directory is not readable"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die_env "not a git repository: $repo"
case "$into" in
  refs/heads/*) into_name="${into#refs/heads/}" ;;
  refs/*) die_env "integration target must be an exact local branch: $into" ;;
  *) into_name="$into" ;;
esac
[ -n "$into_name" ] || die_env "integration target branch name is empty"
git check-ref-format "refs/heads/$into_name" >/dev/null 2>&1 || die_env "invalid integration target branch: $into"
into_ref="refs/heads/$into_name"
into="$into_name"

for pattern in "${extra_patterns[@]}"; do
  [ -n "$pattern" ] || die_env "--pattern ERE must not be empty"
  [[ "" =~ $pattern ]]
  [ "$?" -ne 2 ] || die_env "invalid --pattern ERE: $pattern"
done

candidate_re='^ceo-integration-candidate-r([0-9]+)$'
unit_re='^agent/[a-z0-9-]+-r([0-9]+)-([0-9]{8})$'
intermediate_re='^ceo-[a-z0-9][a-z0-9-]*-r([0-9]+)-([0-9]{8})$'
round_key_re='^(.*)-r([0-9]+)-([0-9]{8})$'

declare -a branches=() candidates=() canonical_candidates=() maximal_candidates=()
declare -a reapable=() superseded=() kept=() candidates_ahead=()
declare -A family=() tip=() ahead=() contained_in=() superseded_by=()
declare -A round=() sibling_key=() canonical_for_tip=() is_maximal_candidate=()
declare -A highest_round=() highest_name=() partition=()
declare -A snapshot_tip=()
declare -a local_branch_names=()

initial_heads_snapshot=""
check_heads_final=""
check_heads_post_evaluation=""
trap 'rm -f "${initial_heads_snapshot:-}" "${check_heads_final:-}" "${check_heads_post_evaluation:-}"' EXIT

snapshot_local_heads() {
  local output="$1" err rc enumeration_error
  err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-refs-err.XXXXXX")" || return 1
  git -C "$repo" for-each-ref --sort=refname --format='%(refname)%09%(objectname)' refs/heads >"$output" 2>"$err"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    enumeration_error="$(<"$err")"
    rm -f "$err"
    printf '%s' "${enumeration_error:-git for-each-ref failed}"
    return 1
  fi
  rm -f "$err"
  return 0
}

initial_heads_snapshot="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-refs.XXXXXX")" || die_env "cannot create branch enumeration temp file"
enumeration_error="$(snapshot_local_heads "$initial_heads_snapshot")" || die_env "cannot enumerate local branches${enumeration_error:+: $enumeration_error}"
while IFS= read -r ref_line || [ -n "$ref_line" ]; do
  [[ "$ref_line" == *$'\t'* ]] || die_env "malformed local branch snapshot"
  full_ref="${ref_line%%$'\t'*}"
  ref_sha="${ref_line#*$'\t'}"
  [[ "$ref_sha" != *$'\t'* ]] || die_env "malformed local branch snapshot"
  case "$full_ref" in refs/heads/*) name="${full_ref#refs/heads/}" ;; *) die_env "non-local ref in branch snapshot: $full_ref" ;; esac
  [ -n "$name" ] && [ -n "$ref_sha" ] || die_env "malformed local branch snapshot"
  [ -z "${snapshot_tip[$name]:-}" ] || die_env "duplicate local branch in snapshot: $name"
  snapshot_tip["$name"]="$ref_sha"
  local_branch_names+=("$name")
done < "$initial_heads_snapshot"

into_sha="${snapshot_tip[$into_name]:-}"
[ -n "$into_sha" ] || die_env "integration target local branch does not resolve: $into_ref"
git -C "$repo" cat-file -e "${into_sha}^{commit}" 2>/dev/null || die_env "integration target local branch is not a commit: $into_ref"

for name in "${local_branch_names[@]}"; do
  [ -n "$name" ] || continue
  # Defense in depth: even a custom catch-all pattern cannot classify the
  # authoritative integration branch as dispatch-owned.
  [ "$name" = "$into_name" ] && continue
  matched=0
  if [[ "$name" =~ $candidate_re ]]; then
    family["$name"]="candidate"
    round["$name"]=$((10#${BASH_REMATCH[1]}))
    candidates+=("$name")
    matched=1
  elif [[ "$name" =~ $unit_re ]]; then
    family["$name"]="unit"
    matched=1
  elif [[ "$name" =~ $intermediate_re ]]; then
    family["$name"]="intermediate"
    matched=1
  else
    for pattern in "${extra_patterns[@]}"; do
      if [[ "$name" =~ $pattern ]]; then matched=1; family["$name"]="custom"; break; fi
    done
  fi
  [ "$matched" -eq 1 ] || continue

  branches+=("$name")
  tip["$name"]="${snapshot_tip[$name]}"
  ahead["$name"]="$(git -C "$repo" rev-list --count "$into_sha..${tip[$name]}" 2>/dev/null)" || die_env "cannot compare $name with $into_ref"
  contained_in["$name"]=""
  superseded_by["$name"]=""

  if { [ "${family[$name]}" = unit ] || [ "${family[$name]}" = intermediate ]; } && [[ "$name" =~ $round_key_re ]]; then
    sibling_key["$name"]="${BASH_REMATCH[1]}|${BASH_REMATCH[3]}"
    round["$name"]=$((10#${BASH_REMATCH[2]}))
  fi
done

# One canonical survivor per same-tip integration-candidate group.
for name in "${candidates[@]}"; do
  sha="${tip[$name]}"
  current="${canonical_for_tip[$sha]:-}"
  if [ -z "$current" ] || [ "${round[$name]}" -gt "${round[$current]}" ] \
     || { [ "${round[$name]}" -eq "${round[$current]}" ] && [[ "$name" > "$current" ]]; }; then
    canonical_for_tip["$sha"]="$name"
  fi
done
for name in "${candidates[@]}"; do
  [ "${canonical_for_tip[${tip[$name]}]}" = "$name" ] && canonical_candidates+=("$name")
done

# Only maximal candidates may prove containment; a reapable candidate never
# becomes the sole proof for deleting another branch.
for name in "${canonical_candidates[@]}"; do
  maximal=1
  for other in "${canonical_candidates[@]}"; do
    [ "$name" = "$other" ] && continue
    [ "${tip[$name]}" = "${tip[$other]}" ] && continue
    if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "${tip[$other]}" 2>/dev/null; then
      maximal=0
      break
    fi
  done
  if [ "$maximal" -eq 1 ]; then
    maximal_candidates+=("$name")
    is_maximal_candidate["$name"]=1
  fi
done

# Highest numeric round per opaque prefix+date sibling group.
for name in "${branches[@]}"; do
  key="${sibling_key[$name]:-}"
  [ -n "$key" ] || continue
  current="${highest_name[$key]:-}"
  if [ -z "$current" ] || [ "${round[$name]}" -gt "${highest_round[$key]}" ] \
     || { [ "${round[$name]}" -eq "${highest_round[$key]}" ] && [[ "$name" > "$current" ]]; }; then
    highest_round["$key"]="${round[$name]}"
    highest_name["$key"]="$name"
  fi
done

for name in "${branches[@]}"; do
  # The integration target is always the first containment proof.
  if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "$into_sha" 2>/dev/null; then
    contained_in["$name"]="$into"
  else
    for target in "${maximal_candidates[@]}"; do
      [ "$name" = "$target" ] && continue
      if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "${tip[$target]}" 2>/dev/null; then
        contained_in["$name"]="$target"
        break
      fi
    done
  fi

  if [ "${contained_in[$name]}" = "$into_name" ]; then
    partition["$name"]="reapable"
    reapable+=("$name")
  else
    key="${sibling_key[$name]:-}"
    if [ -n "$key" ] && [ "${round[$name]}" -lt "${highest_round[$key]}" ]; then
      superseded_by["$name"]="${highest_name[$key]}"
      partition["$name"]="superseded"
      superseded+=("$name")
    else
      partition["$name"]="kept"
      kept+=("$name")
    fi
  fi
  if [ "${family[$name]}" = candidate ] && [ "${ahead[$name]}" -gt 0 ]; then
    candidates_ahead+=("$name")
  fi
done

# Post-classification defense assertion (plan §4A): classification must be a
# total, disjoint partition and the integration target must be absent from every
# dispatch-owned set. Abort before emitting/deleting on any internal drift.
declare -A partition_seen=()
for bucket_name in "${reapable[@]}" "${superseded[@]}" "${kept[@]}"; do
  [ "$bucket_name" != "$into_name" ] || die_env "defense assertion: integration target entered dispatch partition"
  [ -z "${partition_seen[$bucket_name]:-}" ] || die_env "defense assertion: duplicate branch partition: $bucket_name"
  partition_seen["$bucket_name"]=1
done
[ "${#partition_seen[@]}" -eq "${#branches[@]}" ] || die_env "defense assertion: incomplete branch partition"
for name in "${branches[@]}"; do
  [ "$name" != "$into_name" ] || die_env "defense assertion: integration target classified as dispatch-owned"
  [ -n "${partition_seen[$name]:-}" ] || die_env "defense assertion: unpartitioned branch: $name"
done

emit_branch_object() {
  local name="$1" ci="null" sb="null"
  [ -n "${contained_in[$name]}" ] && ci="\"$(json_escape "${contained_in[$name]}")\""
  [ -n "${superseded_by[$name]}" ] && sb="\"$(json_escape "${superseded_by[$name]}")\""
  printf '{"name":"%s","family":"%s","tip":"%s","ahead":%s,"contained_in":%s,"superseded_by":%s}' \
    "$(json_escape "$name")" "${family[$name]}" "${tip[$name]}" "${ahead[$name]}" "$ci" "$sb"
}

emit_branch_array() {
  local first=1 name
  printf '['
  for name in "$@"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    emit_branch_object "$name"
  done
  printf ']'
}

emit_scan_json() {
  printf '{"branches":'; emit_branch_array "${branches[@]}"
  printf ',"candidates_ahead":'; emit_branch_array "${candidates_ahead[@]}"
  printf ',"reapable":'; emit_branch_array "${reapable[@]}"
  printf ',"superseded":'; emit_branch_array "${superseded[@]}"
  printf ',"kept":'; emit_branch_array "${kept[@]}"
  printf '}\n'
}

if [ "$command_name" = scan ]; then
  emit_scan_json
  exit 0
fi

common_raw="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" || die_env "cannot resolve git common dir"
common_dir="$(cd "$repo" && cd "$common_raw" 2>/dev/null && pwd -P)" || die_env "cannot canonicalize git common dir"

if [ "$command_name" = check ]; then
  ack_file="$common_dir/autopilot-reap-ack"
  ack_tmp="$(mktemp "$common_dir/autopilot-reap-ack.tmp.XXXXXX")" || die_env "cannot create ack rewrite"
  declare -A acknowledged=()
  if [ -e "$ack_file" ] && [ ! -f "$ack_file" ]; then
    rm -f "$ack_tmp"
    die_env "ack state is not a regular file"
  fi
  if [ -f "$ack_file" ]; then
    mapfile -t ack_lines < "$ack_file" || { rm -f "$ack_tmp"; die_env "cannot read complete ack state"; }
    for ack_line in "${ack_lines[@]}"; do
      saved_name=""; saved_sha=""; extra=""
      IFS=' ' read -r saved_name saved_sha extra <<< "$ack_line"
      if [ -n "${extra:-}" ] || [[ ! "${saved_sha:-}" =~ ^[0-9a-f]{40}$ ]] \
         || ! git -C "$repo" show-ref --verify --quiet "refs/heads/${saved_name:-}" \
         || [ "$(git -C "$repo" rev-parse "refs/heads/${saved_name:-}" 2>/dev/null)" != "$saved_sha" ]; then
        printf 'WARN: dropped stale or malformed ack for %s\n' "${saved_name:-<empty>}" >&2
        continue
      fi
      acknowledged["$saved_name"]="$saved_sha"
      printf '%s %s\n' "$saved_name" "$saved_sha" >> "$ack_tmp" || { rm -f "$ack_tmp"; die_env "cannot rewrite ack state"; }
    done
  fi
  ack_race=0
  if [ -n "$ack_branch" ]; then
    [ "${family[$ack_branch]:-}" = candidate ] || { rm -f "$ack_tmp"; die_env "--ack branch is not a live integration candidate: $ack_branch"; }
    ack_tip="$(git -C "$repo" rev-parse --verify "refs/heads/$ack_branch" 2>/dev/null)" || { rm -f "$ack_tmp"; die_env "--ack branch disappeared before write: $ack_branch"; }
    [ "$ack_tip" = "${tip[$ack_branch]}" ] || ack_race=1
    if [ "${acknowledged[$ack_branch]:-}" != "$ack_tip" ]; then
      printf '%s %s\n' "$ack_branch" "$ack_tip" >> "$ack_tmp" || { rm -f "$ack_tmp"; die_env "cannot append ack state"; }
    fi
    acknowledged["$ack_branch"]="$ack_tip"
  fi
  if [ -s "$ack_tmp" ]; then
    mv -f "$ack_tmp" "$ack_file" || die_env "cannot atomically rewrite ack file"
  else
    rm -f "$ack_tmp" || die_env "cannot remove empty ack rewrite"
    rm -f "$ack_file" || die_env "cannot prune empty ack file"
  fi

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE:-}" ]; then
    "${AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE}" "$repo" "$ack_branch" || die_env "ack race test hook failed"
  fi
  if [ -n "$ack_branch" ]; then
    post_ack_tip="$(git -C "$repo" rev-parse --verify "refs/heads/$ack_branch" 2>/dev/null)" || die_env "--ack branch disappeared after write: $ack_branch"
    [ "$post_ack_tip" = "$ack_tip" ] || ack_race=1
  fi

  # A successful check linearizes at check_heads_final: it is byte-identical to
  # the complete refs/heads snapshot used for classification, and remains
  # byte-identical after evaluation. Thus the snapshot contains the exact target
  # SHA and the complete dispatch-candidate name/tip set acknowledged below.
  check_heads_final="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-check-refs.XXXXXX")" || die_env "cannot create final branch snapshot"
  enumeration_error="$(snapshot_local_heads "$check_heads_final")" || die_env "cannot enumerate local branches during final check${enumeration_error:+: $enumeration_error}"
  cmp -s "$initial_heads_snapshot" "$check_heads_final" || die_env "local branch refs changed during check; retry from a fresh snapshot"

  gate="$ack_race"
  for name in "${candidates[@]}"; do
    [ "${ahead[$name]}" -gt 0 ] || continue
    if [ "${acknowledged[$name]:-}" != "${tip[$name]}" ]; then gate=1; fi
  done

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION:-}" ]; then
    "${AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION}" "$repo" || die_env "post-evaluation race test hook failed"
  fi
  check_heads_post_evaluation="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-check-refs.XXXXXX")" || die_env "cannot create post-evaluation branch snapshot"
  enumeration_error="$(snapshot_local_heads "$check_heads_post_evaluation")" || die_env "cannot enumerate local branches after check evaluation${enumeration_error:+: $enumeration_error}"
  cmp -s "$check_heads_final" "$check_heads_post_evaluation" || die_env "local branch refs changed during check evaluation; retry from a fresh snapshot"
  emit_scan_json
  exit "$gate"
fi

# reap
[ "$yes" -eq 1 ] || dry_run=1
declare -a eligible=()
eligible+=("${reapable[@]}")
# Preserve-first is global: --reap-superseded exposes/report supersession but
# never turns a branch uncontained by the authoritative integration target into
# an automatic deletion. Deliberate discard is a separate human/depth-0 act
# after preservation, outside this reaper.

emit_name_array() {
  local first=1 value
  printf '['
  for value in "$@"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '"%s"' "$(json_escape "$value")"
  done
  printf ']'
}

declare -a preserved_superseded=()
[ "$reap_superseded" -eq 1 ] && preserved_superseded+=("${superseded[@]}")

if [ "$dry_run" -eq 1 ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[],"dry_run":true}\n'
  exit 0
fi

if [ "${#eligible[@]}" -eq 0 ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${preserved_superseded[@]}"
  printf ',"failures":[],"dry_run":false}\n'
  exit 0
fi

# Enumerate branch-local config once, before any deletion. Exit 1 means no
# matching keys; every other nonzero status is an environment failure and must
# not be collapsed into "no config".
config_list="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-config.XXXXXX")" || die_env "cannot create config enumeration temp file"
config_err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-config-err.XXXXXX")" || { rm -f "$config_list"; die_env "cannot create config enumeration error file"; }
git -C "$repo" config --local --name-only --get-regexp '^branch\.' >"$config_list" 2>"$config_err"
config_rc=$?
if [ "$config_rc" -ne 0 ] && [ "$config_rc" -ne 1 ]; then
  config_error="$(<"$config_err")"
  rm -f "$config_list" "$config_err"
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[{"branch":null,"stage":"config-query","error":"%s"}],"dry_run":false}\n' \
    "$(json_escape "${config_error:-cannot enumerate local branch config}")"
  exit 1
fi
rm -f "$config_err"
mapfile -t branch_config_keys < "$config_list" || { rm -f "$config_list"; die_env "cannot read complete branch config enumeration"; }
rm -f "$config_list"

declare -a refs=()
bundle_error=""
for name in "${eligible[@]}"; do
  if [[ ! "${tip[$name]}" =~ ^[0-9a-f]{40}$ ]]; then
    bundle_error="invalid recorded tip for $name"
    break
  fi
  refs+=("refs/heads/$name")
done
if [ -n "$bundle_error" ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle","error":"%s"}],"dry_run":false}\n' "$(json_escape "$bundle_error")"
  exit 1
fi

if [ -z "$bundle_dir" ]; then
  bundle_dir="$common_dir/autopilot-reap-bundles/$(date -u +%Y-%m-%d)"
elif [[ "$bundle_dir" != /* ]]; then
  bundle_dir="$repo/$bundle_dir"
fi
mkdir -p "$bundle_dir" 2>/dev/null || {
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle-create","error":"%s"}],"dry_run":false}\n' "$(json_escape "cannot create bundle directory: $bundle_dir")"
  exit 1
}
bundle="$bundle_dir/reap-$(date -u +%Y%m%dT%H%M%SZ)-$$.bundle"

git -C "$repo" bundle create "$bundle" "${refs[@]}" >/dev/null 2>"$bundle.tmp.err" || bundle_error="$(<"$bundle.tmp.err")"
rm -f "$bundle.tmp.err"
if [ -z "$bundle_error" ]; then
  git -C "$repo" bundle verify "$bundle" >/dev/null 2>"$bundle.tmp.err" || bundle_error="$(<"$bundle.tmp.err")"
  rm -f "$bundle.tmp.err"
fi
if [ -z "$bundle_error" ]; then
  heads="$(git -C "$repo" bundle list-heads "$bundle" 2>"$bundle.tmp.err")" || bundle_error="$(<"$bundle.tmp.err")"
  rm -f "$bundle.tmp.err"
  if [ -z "$bundle_error" ]; then
    for name in "${eligible[@]}"; do
      found=0
      while IFS=' ' read -r listed_sha listed_ref; do
        if [ "$listed_sha" = "${tip[$name]}" ] && [ "$listed_ref" = "refs/heads/$name" ]; then found=1; break; fi
      done <<< "$heads"
      [ "$found" -eq 1 ] || { bundle_error="bundle list-heads missing refs/heads/$name at ${tip[$name]}"; break; }
    done
  fi
fi
if [ -n "$bundle_error" ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle","error":"%s"}],"dry_run":false}\n' "$(json_escape "$bundle_error")"
  exit 1
fi

declare -a reaped_names=() kept_names=("${preserved_superseded[@]}") failure_names=() failure_stages=() failure_errors=()

record_failure() {
  kept_names+=("$1")
  failure_names+=("$1")
  failure_stages+=("$2")
  failure_errors+=("$3")
}

# probe_checked_out <branch>: 0=clear, 1=checked out, 2=enumeration failure.
# Process substitution is deliberately forbidden here: its producer status is
# otherwise lost and a partial worktree list would become a fail-open delete.
probe_checked_out() {
  local branch="$1" list_file err_file rc line current_path=""
  checked_path=""
  worktree_probe_error=""
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-worktrees.XXXXXX")" || { worktree_probe_error="cannot create worktree enumeration temp file"; return 2; }
  err_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-worktrees-err.XXXXXX")" || { rm -f "$list_file"; worktree_probe_error="cannot create worktree enumeration error file"; return 2; }
  git -C "$repo" worktree list --porcelain >"$list_file" 2>"$err_file"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    worktree_probe_error="$(<"$err_file")"
    [ -n "$worktree_probe_error" ] || worktree_probe_error="git worktree list failed"
    rm -f "$list_file" "$err_file"
    return 2
  fi
  rm -f "$err_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      worktree\ *) current_path="${line#worktree }" ;;
      "branch refs/heads/$branch") checked_path="$current_path"; rm -f "$list_file"; return 1 ;;
    esac
  done < "$list_file"
  rc=$?
  rm -f "$list_file"
  [ "$rc" -eq 0 ] || { worktree_probe_error="cannot read complete worktree enumeration"; return 2; }
  return 0
}

# validate_delete_proof <branch>: exact ref, current target containment, and
# checked-out occupancy are all re-read immediately before CAS.
validate_delete_proof() {
  local branch="$1" expected="$2" current current_target merge_rc probe_rc
  validation_stage="compare-delete"
  validation_error="tip moved or local branch disappeared before deletion"
  current="$(git -C "$repo" rev-parse --verify "refs/heads/$branch" 2>/dev/null)" || return 1
  [ "$current" = "$expected" ] || return 1
  current_target="$(git -C "$repo" rev-parse --verify "${into_ref}^{commit}" 2>/dev/null)" || {
    validation_stage="containment-recheck"; validation_error="integration target disappeared before deletion"; return 1;
  }
  git -C "$repo" merge-base --is-ancestor "$expected" "$current_target" 2>/dev/null
  merge_rc=$?
  if [ "$merge_rc" -ne 0 ]; then
    validation_stage="containment-recheck"
    if [ "$merge_rc" -eq 1 ]; then validation_error="branch is no longer contained by $into_ref"; else validation_error="cannot revalidate containment against $into_ref"; fi
    return 1
  fi
  probe_checked_out "$branch"
  probe_rc=$?
  if [ "$probe_rc" -eq 1 ]; then
    validation_stage="checked-out"; validation_error="checked out at $checked_path"; return 1
  fi
  if [ "$probe_rc" -eq 2 ]; then
    validation_stage="worktree-list"; validation_error="$worktree_probe_error"; return 1
  fi
  return 0
}

restore_deleted_ref() {
  local branch="$1" expected="$2" current=""
  if current="$(git -C "$repo" rev-parse --verify "refs/heads/$branch" 2>/dev/null)"; then
    [ "$current" = "$expected" ]
    return $?
  fi
  git -C "$repo" update-ref "refs/heads/$branch" "$expected" 0000000000000000000000000000000000000000 >/dev/null 2>&1
}

for name in "${eligible[@]}"; do
  expected_tip="${tip[$name]}"
  if ! validate_delete_proof "$name" "$expected_tip"; then
    record_failure "$name" "$validation_stage" "$validation_error"
    continue
  fi

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE:-}" ]; then
    if ! "${AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE}" "$repo" "$name"; then
      record_failure "$name" "pre-delete-hook" "pre-delete test hook failed"
      continue
    fi
  fi

  # Revalidate again after the race seam and immediately before the exact-tip
  # update-ref CAS. Git has no transaction spanning refs + worktree metadata;
  # the paired post-CAS check below closes the observable window and restores.
  if ! validate_delete_proof "$name" "$expected_tip"; then
    record_failure "$name" "$validation_stage" "$validation_error"
    continue
  fi

  delete_err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-delete-err.XXXXXX")" || { record_failure "$name" "compare-delete" "cannot create ref deletion error file"; continue; }
  if ! git -C "$repo" update-ref -d "refs/heads/$name" "$expected_tip" 2>"$delete_err"; then
    delete_error="$(<"$delete_err")"; rm -f "$delete_err"
    record_failure "$name" "compare-delete" "${delete_error:-tip moved or ref deletion failed}"
    continue
  fi
  rm -f "$delete_err"

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE:-}" ]; then
    if ! "${AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE}" "$repo" "$name"; then
      if restore_deleted_ref "$name" "$expected_tip"; then
        record_failure "$name" "post-delete-race" "post-delete test hook failed; exact ref restored"
      else
        record_failure "$name" "restore-failed" "post-delete test hook failed; exact ref restoration failed (verified bundle retains tip)"
      fi
      continue
    fi
  fi

  post_invalid=0
  post_error=""
  probe_checked_out "$name"
  probe_rc=$?
  if [ "$probe_rc" -eq 1 ]; then post_invalid=1; post_error="branch became checked out at $checked_path"; fi
  if [ "$probe_rc" -eq 2 ]; then post_invalid=1; post_error="post-delete worktree enumeration failed: $worktree_probe_error"; fi
  post_target="$(git -C "$repo" rev-parse --verify "${into_ref}^{commit}" 2>/dev/null)" || { post_invalid=1; post_error="integration target disappeared after deletion"; }
  if [ -n "${post_target:-}" ]; then
    git -C "$repo" merge-base --is-ancestor "$expected_tip" "$post_target" 2>/dev/null || { post_invalid=1; post_error="containment proof invalidated after deletion"; }
  fi
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$name"; then
    post_invalid=1
    post_error="branch ref was concurrently recreated after deletion"
  fi
  if [ "$post_invalid" -eq 1 ]; then
    if restore_deleted_ref "$name" "$expected_tip"; then
      record_failure "$name" "post-delete-race" "$post_error; exact ref restored"
    else
      record_failure "$name" "restore-failed" "$post_error; exact ref restoration failed (verified bundle retains the tip)"
    fi
    continue
  fi

  reaped_names+=("$name")
  config_present=0
  for config_key in "${branch_config_keys[@]}"; do
    case "$config_key" in "branch.$name."*) config_present=1; break ;; esac
  done
  if [ "$config_present" -eq 1 ] && ! git -C "$repo" config --local --remove-section "branch.$name" >/dev/null 2>&1; then
    failure_names+=("$name"); failure_stages+=("config-cleanup"); failure_errors+=("branch ref deleted and bundled, but local config cleanup failed")
  fi
done

printf '{"reaped":['
first=1
for name in "${reaped_names[@]}"; do
  [ "$first" -eq 1 ] || printf ','; first=0
  printf '{"branch":"%s","bundle":"%s"}' "$(json_escape "$name")" "$(json_escape "$bundle")"
done
printf '],"kept":'; emit_name_array "${kept_names[@]}"
printf ',"failures":['
for ((i=0; i<${#failure_names[@]}; i++)); do
  [ "$i" -eq 0 ] || printf ','
  printf '{"branch":"%s","stage":"%s","error":"%s"}' \
    "$(json_escape "${failure_names[$i]}")" "${failure_stages[$i]}" "$(json_escape "${failure_errors[$i]}")"
done
printf '],"dry_run":false}\n'
[ "${#failure_names[@]}" -eq 0 ]
