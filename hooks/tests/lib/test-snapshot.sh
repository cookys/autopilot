# hooks/tests/lib/test-snapshot.sh — G6/G7 real-repo config guard + KR3 baseline.
# Source only: no top-level side effects besides loading the canonical identity rule.
# Every function takes an explicit real-repo root; nothing reads a global real-root.

_ts_self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../scripts/lib/test-identity.sh
. "$_ts_self/../../../scripts/lib/test-identity.sh"

_ts_write_filtered_config_z() {
  local root="$1" dest="$2"
  local rec key
  : >"$dest"
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -z "${rec:-}" ] && continue
    key="${rec%%$'\n'*}"
    [[ "$key" =~ ^(branch|remote)\. ]] && continue
    printf '%s\0' "$rec" >>"$dest"
  done < <(git -C "$root" config --local --list -z 2>/dev/null || true)
}

_ts_encode_key() {
  local s="$1" out="" c hex
  local i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:$i:1}"
    if [ "$c" = '%' ]; then
      out+='%25'
    elif [ "$c" = '/' ]; then
      out+='%2F'
    elif [[ "$c" =~ ^[A-Za-z0-9._-]$ ]]; then
      out+="$c"
    else
      printf -v hex '%02X' "'$c"
      out+="%$hex"
    fi
  done
  printf '%s' "$out"
}

_ts_decode_key() {
  local s="$1" out="" c hex
  local i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:$i:1}"
    if [ "$c" = '%' ] && ((i + 2 < ${#s})); then
      hex="${s:i+1:2}"
      printf -v c '\\x%s' "$hex"
      printf -v c '%b' "$c"
      out+="$c"
      i=$((i + 2))
    else
      out+="$c"
    fi
  done
  printf '%s' "$out"
}

_ts_explode_config_z() {
  local file="$1" dir="$2"
  local rec key val enc
  rm -rf "$dir"
  mkdir -p "$dir"
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -z "${rec:-}" ] && continue
    key="${rec%%$'\n'*}"
    val="${rec#*$'\n'}"
    if [ "$key" = "$rec" ]; then
      key="${rec%%=*}"
      val="${rec#*=}"
    fi
    enc="$(_ts_encode_key "$key")"
    printf '%s\0' "$val" >>"$dir/$enc"
  done < "$file"
}

ts_baseline_check() {
  local root="$1"
  local email
  if ! email="$(git -C "$root" config --local --get user.email 2>/dev/null)"; then
    return 0
  fi
  if is_test_identity_email "$email" || [ -z "$email" ]; then
    echo "test-baseline: polluted local user.email" >&2
    echo "git -C $root config --local --unset user.name" >&2
    echo "git -C $root config --local --unset user.email" >&2
    return 1
  fi
  return 0
}

ts_guard_before() {
  local root="$1" statedir="$2"
  mkdir -p "$statedir"
  _ts_write_filtered_config_z "$root" "$statedir/config.z"
  git -C "$root" for-each-ref >"$statedir/for-each-ref" 2>/dev/null || true
  git -C "$root" worktree list --porcelain >"$statedir/worktree" 2>/dev/null || true
  git -C "$root" status --porcelain >"$statedir/status" 2>/dev/null || true
}

_ts_restore_key_from_file() {
  local root="$1" key="$2" packed="$3"
  git -C "$root" config --local --unset-all "$key" >/dev/null 2>&1 || true
  [ -f "$packed" ] || return 0
  local v
  while IFS= read -r -d '' v; do
    git -C "$root" config --local --add "$key" "$v" >/dev/null 2>&1 || true
  done < "$packed"
}

_ts_worktree_named_lines() {
  awk '
    /^worktree / { path = substr($0, 10); print; next }
    { if (path != "") print path "\t" $0; else print }
  ' "$1"
}

_ts_extract_diff_names() {
  local kind="$1"
  case "$kind" in
    refs)
      awk '{ print $NF }'
      ;;
    status)
      awk '{ if (length($0) >= 4) print substr($0, 4) }'
      ;;
    worktrees)
      awk '
        /^worktree / { print substr($0, 10); next }
        /^\t/ { next }
        { print $1 }
      '
      ;;
  esac
}

_ts_warn_full_lines() {
  local label="$1" before="$2" after="$3" kind="$4"
  local sb sa names
  sb="$(mktemp "${TMPDIR:-/tmp}/ts-warn-b.XXXXXX")"
  sa="$(mktemp "${TMPDIR:-/tmp}/ts-warn-a.XXXXXX")"
  if [ "$kind" = worktrees ]; then
    _ts_worktree_named_lines "$before" | LC_ALL=C sort >"$sb"
    _ts_worktree_named_lines "$after" | LC_ALL=C sort >"$sa"
  else
    LC_ALL=C sort "$before" >"$sb"
    LC_ALL=C sort "$after" >"$sa"
  fi
  names="$(LC_ALL=C comm -3 "$sb" "$sa" | sed 's/^\t//' | _ts_extract_diff_names "$kind" | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  rm -f "$sb" "$sa"
  [ -z "$names" ] && return 0
  echo "test-guard: WARNING $label differ: $names" >&2
}

ts_guard_after() {
  local root="$1" statedir="$2"
  local drift=0
  local tmp
  if [ ! -f "$statedir/config.z" ]; then
    echo "test-guard: REAL-REPO CONFIG DRIFT (state missing)" >&2
    return 1
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/ts-guard-after.XXXXXX")"
  _ts_write_filtered_config_z "$root" "$tmp"

  local before_dir after_dir
  before_dir="$statedir/config.keys.before"
  after_dir="$statedir/config.keys.after"
  _ts_explode_config_z "$statedir/config.z" "$before_dir"
  _ts_explode_config_z "$tmp" "$after_dir"
  rm -f "$tmp"

  local k
  local -A seen=()
  for k in "$before_dir"/* "$after_dir"/*; do
    [ -e "$k" ] || continue
    k="$(basename "$k")"
    [ -n "${seen[$k]+x}" ] && continue
    seen["$k"]=1
    if ! cmp -s "$before_dir/$k" "$after_dir/$k" 2>/dev/null; then
      local key
      key="$(_ts_decode_key "$k")"
      echo "test-guard: REAL-REPO CONFIG DRIFT $key" >&2
      _ts_restore_key_from_file "$root" "$key" "$before_dir/$k"
      drift=1
    fi
  done

  git -C "$root" for-each-ref >"$statedir/for-each-ref.after" 2>/dev/null || true
  git -C "$root" worktree list --porcelain >"$statedir/worktree.after" 2>/dev/null || true
  git -C "$root" status --porcelain >"$statedir/status.after" 2>/dev/null || true

  if ! cmp -s "$statedir/for-each-ref" "$statedir/for-each-ref.after"; then
    _ts_warn_full_lines "refs" "$statedir/for-each-ref" "$statedir/for-each-ref.after" refs
  fi
  if ! cmp -s "$statedir/worktree" "$statedir/worktree.after"; then
    _ts_warn_full_lines "worktrees" "$statedir/worktree" "$statedir/worktree.after" worktrees
  fi
  if ! cmp -s "$statedir/status" "$statedir/status.after"; then
    _ts_warn_full_lines "status" "$statedir/status" "$statedir/status.after" status
  fi

  [ "$drift" -eq 0 ]
}

ts_snapshot_build() {
  local real_root="$1" container="$2"
  if ! command -v rsync >/dev/null 2>&1; then
    echo "test-snapshot: rsync missing" >&2
    return 1
  fi
  local real_abs sha branch
  real_abs="$(realpath "$real_root")"
  mkdir -p "$container"
  GIT_CONFIG_COUNT=0 GIT_ALLOW_PROTOCOL=file \
    git clone --quiet --no-hardlinks --no-checkout "$real_root" "$container/repo" || return 1
  sha="$(git -C "$real_root" rev-parse HEAD)"
  if branch="$(git -C "$real_root" symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
    git -C "$container/repo" checkout --quiet -B "$branch" "$sha" || return 1
  else
    git -C "$container/repo" checkout --quiet --detach "$sha" || return 1
  fi
  rsync -a --delete --exclude='.git' "${real_root}/" "$container/repo/" || return 1
  git -C "$container/repo" remote set-url origin /nonexistent/autopilot-test-snapshot-origin || return 1
  if [ -e "$container/repo/.git/objects/info/alternates" ]; then
    echo "test-snapshot: construction failed: alternates" >&2
    return 1
  fi
  local link dest
  while IFS= read -r -d '' link; do
    dest="$(readlink -f "$link" 2>/dev/null || true)"
    [ -z "${dest:-}" ] && continue
    case "$dest" in
      "$real_abs"|"$real_abs"/*)
        echo "test-snapshot: construction failed: symlink" >&2
        return 1
        ;;
    esac
  done < <(find "$container/repo" -type l -print0)
  return 0
}

ts_snapshot_remove() {
  local container="$1"
  [ -e "$container" ] || return 0
  local repo="$container/repo"
  if [ -d "$repo/.git/worktrees" ]; then
    git -C "$repo" worktree prune >/dev/null 2>&1 || true
    local main="" path line
    while IFS= read -r line; do
      case "$line" in
        worktree\ *)
          path="${line#worktree }"
          if [ -z "$main" ]; then
            main="$path"
          else
            git -C "$repo" worktree remove --force "$path" >/dev/null 2>&1 || true
          fi
          ;;
      esac
    done < <(git -C "$repo" worktree list --porcelain 2>/dev/null || true)
  fi
  rm -rf "$container"
  return 0
}
