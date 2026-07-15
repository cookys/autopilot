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
into_sha="$(git -C "$repo" rev-parse --verify "${into}^{commit}" 2>/dev/null)" || die_env "integration target does not resolve: $into"

for pattern in "${extra_patterns[@]}"; do
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

while IFS= read -r name; do
  [ -n "$name" ] || continue
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
  tip["$name"]="$(git -C "$repo" rev-parse --verify "refs/heads/$name")" || die_env "cannot resolve local branch: $name"
  ahead["$name"]="$(git -C "$repo" rev-list --count "$into_sha..${tip[$name]}" 2>/dev/null)" || die_env "cannot compare $name with $into"
  contained_in["$name"]=""
  superseded_by["$name"]=""

  if { [ "${family[$name]}" = unit ] || [ "${family[$name]}" = intermediate ]; } && [[ "$name" =~ $round_key_re ]]; then
    sibling_key["$name"]="${BASH_REMATCH[1]}|${BASH_REMATCH[3]}"
    round["$name"]=$((10#${BASH_REMATCH[2]}))
  fi
done < <(git -C "$repo" for-each-ref --sort=refname --format='%(refname:short)' refs/heads)

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

  if [ -n "${contained_in[$name]}" ]; then
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
  ack_tmp="$common_dir/autopilot-reap-ack.tmp.$$"
  declare -A acknowledged=()
  : > "$ack_tmp" || die_env "cannot rewrite ack file"
  if [ -f "$ack_file" ]; then
    while IFS=' ' read -r saved_name saved_sha extra || [ -n "${saved_name:-}" ]; do
      if [ -n "${extra:-}" ] || [[ ! "${saved_sha:-}" =~ ^[0-9a-f]{40}$ ]] \
         || ! git -C "$repo" show-ref --verify --quiet "refs/heads/${saved_name:-}" \
         || [ "$(git -C "$repo" rev-parse "refs/heads/${saved_name:-}" 2>/dev/null)" != "$saved_sha" ]; then
        printf 'WARN: dropped stale or malformed ack for %s\n' "${saved_name:-<empty>}" >&2
        continue
      fi
      acknowledged["$saved_name"]="$saved_sha"
      printf '%s %s\n' "$saved_name" "$saved_sha" >> "$ack_tmp"
    done < "$ack_file"
  fi
  if [ -n "$ack_branch" ]; then
    [ "${family[$ack_branch]:-}" = candidate ] || { rm -f "$ack_tmp"; die_env "--ack branch is not a live integration candidate: $ack_branch"; }
    if [ "${acknowledged[$ack_branch]:-}" != "${tip[$ack_branch]}" ]; then
      printf '%s %s\n' "$ack_branch" "${tip[$ack_branch]}" >> "$ack_tmp"
    fi
    acknowledged["$ack_branch"]="${tip[$ack_branch]}"
  fi
  mv -f "$ack_tmp" "$ack_file" || die_env "cannot atomically rewrite ack file"

  gate=0
  for name in "${candidates_ahead[@]}"; do
    [ "${partition[$name]}" = reapable ] && continue
    if [ "${acknowledged[$name]:-}" != "${tip[$name]}" ]; then gate=1; fi
  done
  emit_scan_json
  exit "$gate"
fi

# reap
[ "$yes" -eq 1 ] || dry_run=1
declare -a eligible=()
eligible+=("${reapable[@]}")
[ "$reap_superseded" -eq 1 ] && eligible+=("${superseded[@]}")

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

if [ "$dry_run" -eq 1 ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[],"dry_run":true}\n'
  exit 0
fi

if [ "${#eligible[@]}" -eq 0 ]; then
  printf '{"reaped":[],"kept":[],"failures":[],"dry_run":false}\n'
  exit 0
fi

if [ -z "$bundle_dir" ]; then
  bundle_dir="$common_dir/autopilot-reap-bundles/$(date -u +%Y-%m-%d)"
fi
mkdir -p "$bundle_dir" 2>/dev/null || {
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle-create","error":"%s"}],"dry_run":false}\n' "$(json_escape "cannot create bundle directory: $bundle_dir")"
  exit 1
}
bundle="$bundle_dir/reap-$(date -u +%Y%m%dT%H%M%SZ)-$$.bundle"
declare -a refs=()
for name in "${eligible[@]}"; do
  [[ "${tip[$name]}" =~ ^[0-9a-f]{40}$ ]] || die_env "invalid recorded tip for $name"
  refs+=("refs/heads/$name")
done

bundle_error=""
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

declare -a reaped_names=() kept_names=() failure_names=() failure_stages=() failure_errors=()
for name in "${eligible[@]}"; do
  checked_path=""
  current_path=""
  while IFS= read -r line; do
    case "$line" in
      worktree\ *) current_path="${line#worktree }" ;;
      "branch refs/heads/$name") checked_path="$current_path"; break ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain)
  if [ -n "$checked_path" ]; then
    kept_names+=("$name"); failure_names+=("$name"); failure_stages+=("checked-out"); failure_errors+=("checked out at $checked_path")
    continue
  fi
  if ! git -C "$repo" update-ref -d "refs/heads/$name" "${tip[$name]}" 2>/dev/null; then
    kept_names+=("$name"); failure_names+=("$name"); failure_stages+=("compare-delete"); failure_errors+=("tip moved or ref deletion failed")
    continue
  fi
  reaped_names+=("$name")
  config_present=0
  while IFS= read -r config_key; do
    case "$config_key" in "branch.$name."*) config_present=1; break ;; esac
  done < <(git -C "$repo" config --local --name-only --get-regexp '^branch\.' 2>/dev/null || true)
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
