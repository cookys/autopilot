# shellcheck shell=bash
# gitconfig-containment.sh — shared denylist snapshot/restore for dispatch rails.
#
# A dispatched worker shares the consuming repo's .git/config (worktrees share it) and can
# persist non-identity redirection: core.hooksPath, core.sshCommand, core.fsmonitor,
# include.path, includeIf.*, credential.* (including credential.helper), url.*.insteadOf,
# http.*.extraheader, remote.*.url, remote.*.pushurl. user.name and user.email stay on
# the identity rail (identity_drift); they are not in this denylist.
#
# Contract:
#   GITCONFIG_DENYLIST_PATTERNS — the only copy of the denylist.
#   gitconfig_key_on_denylist <key> — section and variable are matched case-insensitively
#     (git lowercases them in `config --list`); the subsection is case-sensitive.
#   gitconfig_containment_snapshot <repo> — records every matching local key/value from
#     `git config --local --list --null` into $GITCONFIG_SNAPSHOT_FILE (NUL records,
#     multi-valued keys and newline values preserved, file order). If that git
#     command fails, prints a snapshot-failed WARNING, removes the temp file, and
#     leaves GITCONFIG_SNAPSHOT_FILE empty so restore skips (a failed read must
#     not look like an empty config).
#   gitconfig_containment_restore <repo> <snapshot> — if the current denylist projection
#     differs, --unset-all each changed key and re-add the snapshotted values in order.
#     Prints the sorted changed key names, one per line (nothing when clean). After
#     the replay, the projection is read again and compared byte-for-byte with the
#     snapshot. A mismatch prints "WARNING: git config restore FAILED" plus the key
#     names that still differ, and returns 1. A failed re-read is a failed restore,
#     never an empty projection. No snapshot file means skip and return 0.
#
# Double-source is a no-op.

[ -n "${_AUTOPILOT_GITCONFIG_CONTAINMENT_SH:-}" ] && return 0
_AUTOPILOT_GITCONFIG_CONTAINMENT_SH=1

GITCONFIG_DENYLIST_PATTERNS=(
  'core.hooksPath'
  'core.sshCommand'
  'core.fsmonitor'
  'include.path'
  'includeIf.*'
  'credential.*'
  'url.*.insteadOf'
  'http.extraheader'
  'http.*.extraheader'
  'remote.*.url'
  'remote.*.pushurl'
)

_gc_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

gitconfig_key_on_denylist() {
  local key="$1" pat sec var sub sec_l var_l psec pvar prest
  case "$key" in
    *.*) ;;
    *) return 1 ;;
  esac
  sec="${key%%.*}"
  var="${key##*.}"
  if [ "$sec" = "${key%.*}" ]; then
    sub=""
  else
    sub="${key#*.}"
    sub="${sub%.*}"
  fi
  sec_l="$(_gc_lower "$sec")"
  var_l="$(_gc_lower "$var")"
  for pat in "${GITCONFIG_DENYLIST_PATTERNS[@]}"; do
    case "$pat" in
      *.*.*)
        psec="${pat%%.*}"
        pvar="${pat##*.}"
        prest="${pat#*.}"
        prest="${prest%.*}"
        if [ "$prest" = "*" ]; then
          [ -n "$sub" ] || continue
          [ "$sec_l" = "$(_gc_lower "$psec")" ] || continue
          [ "$var_l" = "$(_gc_lower "$pvar")" ] || continue
          return 0
        fi
        [ "$sub" = "$prest" ] || continue
        [ "$sec_l" = "$(_gc_lower "$psec")" ] || continue
        [ "$var_l" = "$(_gc_lower "$pvar")" ] || continue
        return 0
        ;;
      *.*)
        if [ "${pat#*.}" = "*" ]; then
          [ "$sec_l" = "$(_gc_lower "${pat%.*}")" ] || continue
          return 0
        fi
        [ -z "$sub" ] || continue
        [ "$sec_l" = "$(_gc_lower "${pat%%.*}")" ] || continue
        [ "$var_l" = "$(_gc_lower "${pat##*.}")" ] || continue
        return 0
        ;;
    esac
  done
  return 1
}

_gc_write_projection() {
  local root="$1" dest="$2" rec key raw
  raw="$(mktemp -t gitconfig-containment.XXXXXX)"
  if ! git -C "$root" config --local --list --null >"$raw" 2>/dev/null; then
    rm -f -- "$raw"
    return 1
  fi
  : > "$dest"
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -n "${rec:-}" ] || continue
    key="${rec%%$'\n'*}"
    if gitconfig_key_on_denylist "$key"; then
      printf '%s\0' "$rec" >> "$dest"
    fi
  done < "$raw"
  rm -f -- "$raw"
  return 0
}

gitconfig_containment_snapshot() {
  local root="$1" f
  f="$(mktemp -t gitconfig-containment.XXXXXX)"
  if ! _gc_write_projection "$root" "$f"; then
    rm -f -- "$f"
    GITCONFIG_SNAPSHOT_FILE=""
    echo "WARNING: git config snapshot failed" >&2
    return 1
  fi
  GITCONFIG_SNAPSHOT_FILE="$f"
  return 0
}

_gc_values_blob() {
  local file="$1" want="$2" rec key val
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -n "${rec:-}" ] || continue
    key="${rec%%$'\n'*}"
    [ "$key" = "$want" ] || continue
    if [ "$rec" = "$key" ]; then val=""; else val="${rec#*$'\n'}"; fi
    printf '%s\0' "$val"
  done < "$file"
}

_gc_diff_keys() {
  local snap="$1" cur="$2" key blob_s blob_c
  local -a changed=()
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    blob_s="$(mktemp -t gitconfig-containment.XXXXXX)"
    blob_c="$(mktemp -t gitconfig-containment.XXXXXX)"
    _gc_values_blob "$snap" "$key" > "$blob_s"
    _gc_values_blob "$cur" "$key" > "$blob_c"
    if ! cmp -s "$blob_s" "$blob_c"; then
      changed+=("$key")
    fi
    rm -f -- "$blob_s" "$blob_c"
  done < <( { _gc_values_keys "$snap"; _gc_values_keys "$cur"; } | LC_ALL=C sort -u )
  if [ "${#changed[@]}" -gt 0 ]; then
    printf '%s\n' "${changed[@]}" | LC_ALL=C sort -u
  fi
}

gitconfig_containment_restore() {
  local root="$1" snap="$2" cur after key rec val keys_now
  [ -n "${root:-}" ] && [ -n "${snap:-}" ] && [ -f "$snap" ] || return 0
  cur="$(mktemp -t gitconfig-containment.XXXXXX)"
  if ! _gc_write_projection "$root" "$cur"; then
    rm -f -- "$cur"
    echo "WARNING: git config restore FAILED" >&2
    return 1
  fi
  if cmp -s "$snap" "$cur"; then
    rm -f -- "$cur"
    return 0
  fi
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    # Drop every current denylist key so the replay below restores file order.
    # A key absent from the snapshot stays deleted. Write errors are not the
    # verdict: the post-replay byte compare is.
    git -C "$root" config --local --unset-all -- "$key" >/dev/null 2>&1 || true
  done < <( { _gc_values_keys "$snap"; _gc_values_keys "$cur"; } | LC_ALL=C sort -u )
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -n "${rec:-}" ] || continue
    key="${rec%%$'\n'*}"
    if [ "$rec" = "$key" ]; then val=""; else val="${rec#*$'\n'}"; fi
    git -C "$root" config --local --add -- "$key" "$val" >/dev/null 2>&1 || true
  done < "$snap"
  after="$(mktemp -t gitconfig-containment.XXXXXX)"
  if ! _gc_write_projection "$root" "$after"; then
    rm -f -- "$cur" "$after"
    echo "WARNING: git config restore FAILED" >&2
    return 1
  fi
  if ! cmp -s "$snap" "$after"; then
    keys_now="$(_gc_diff_keys "$snap" "$after")"
    echo "WARNING: git config restore FAILED ${keys_now//$'\n'/ }" >&2
    [ -n "$keys_now" ] && printf '%s\n' "$keys_now"
    rm -f -- "$cur" "$after"
    return 1
  fi
  keys_now="$(_gc_diff_keys "$snap" "$cur")"
  rm -f -- "$cur" "$after"
  [ -n "$keys_now" ] && printf '%s\n' "$keys_now"
  return 0
}

_gc_values_keys() {
  local file="$1" rec key
  while IFS= read -r -d '' rec || [ -n "${rec:-}" ]; do
    [ -n "${rec:-}" ] || continue
    key="${rec%%$'\n'*}"
    printf '%s\n' "$key"
  done < "$file"
}
