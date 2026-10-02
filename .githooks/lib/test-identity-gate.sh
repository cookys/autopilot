# .githooks/lib/test-identity-gate.sh — source scripts/lib/test-identity.sh (G1)
# and expose bypass + identity judges. Fail-open if the lib is missing (G8).

__tig_lib_ok=0
__tig_top="$(git rev-parse --show-toplevel 2>/dev/null)" || __tig_top=""
if [ -n "$__tig_top" ] && [ -r "$__tig_top/scripts/lib/test-identity.sh" ]; then
  # shellcheck disable=SC1091
  . "$__tig_top/scripts/lib/test-identity.sh"
  __tig_lib_ok=1
fi

# 0 = bypass honoured (allow). Internal errors fail-open (return 0).
test_identity_gate_bypassed() {
  local cfg val common real_common tmp real_tmp
  cfg="$(git rev-parse --git-path config 2>/dev/null)" || return 0
  [ -n "$cfg" ] || return 0
  val="$(git config --file "$cfg" --get autopilot.testIdentityGate 2>/dev/null)" || val=""
  [ "${val,,}" = "off" ] || return 1
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 0
  real_common="$(realpath -e "$common" 2>/dev/null)" || return 0
  tmp="${TMPDIR:-/tmp}"
  real_tmp="$(realpath -e "$tmp" 2>/dev/null || realpath -m "$tmp" 2>/dev/null)" || return 0
  case "$real_common" in
    "$real_tmp"|"$real_tmp"/*) return 0 ;;
  esac
  return 1
}

__tig_email_from_ident() {
  local ident="$1"
  local email="${ident#*<}"
  email="${email%%>*}"
  printf '%s' "$email"
}

# 0 if this email is a computed test-identity verdict; 1 if allowed / unknown.
__tig_email_forbidden() {
  local email="$1"
  [ "$__tig_lib_ok" = 1 ] || return 1
  type is_test_identity_email >/dev/null 2>&1 || return 1
  is_test_identity_email "$email"
}

# Judge git var GIT_AUTHOR_IDENT / GIT_COMMITTER_IDENT. Exit 1 if forbidden.
test_identity_refuse_commit_idents() {
  local ident email role label
  if [ "$__tig_lib_ok" != 1 ]; then
    return 0
  fi
  for role in AUTHOR COMMITTER; do
    if [ "$role" = AUTHOR ]; then label=author; else label=committer; fi
    ident="$(git var "GIT_${role}_IDENT" 2>/dev/null)" || continue
    email="$(__tig_email_from_ident "$ident")"
    if __tig_email_forbidden "$email"; then
      echo "test-identity-gate: ${label} is a test identity (${email})" >&2
      echo "Fix: git config user.email to a non-test address, or set autopilot.testIdentityGate=off only in a scratch repo whose common dir is under TMPDIR." >&2
      return 1
    fi
  done
  return 0
}

# Read push ref lines from stdin. $1 = remote name (git argv).
test_identity_refuse_push_range() {
  local remote="${1-}"
  local local_ref local_sha remote_ref remote_sha
  local sha short ae ce set_out zero has_remote_refs have_tip
  zero='^0+$'
  if [ "$__tig_lib_ok" != 1 ]; then
    return 0
  fi
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ -z "${local_sha:-}" ] && continue
    echo "$local_sha" | grep -qE "$zero" && continue
    # Judge only what the remote does not already have: everything reachable
    # from the pushed sha minus every ref of THIS remote (and its old tip when
    # that object exists locally). Never a silent pass on missing knowledge.
    has_remote_refs="$(git for-each-ref --count=1 --format='x' "refs/remotes/${remote}/" 2>/dev/null || true)"
    have_tip=0
    if [ -n "${remote_sha:-}" ] && ! echo "$remote_sha" | grep -qE "$zero" \
       && git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
      have_tip=1
    fi
    if [ -n "$has_remote_refs" ] && [ "$have_tip" = 1 ]; then
      set_out="$(git rev-list "$local_sha" --not --remotes="$remote" "$remote_sha" 2>/dev/null)" || set_out="__ERR__"
    elif [ -n "$has_remote_refs" ]; then
      set_out="$(git rev-list "$local_sha" --not --remotes="$remote" 2>/dev/null)" || set_out="__ERR__"
    elif [ "$have_tip" = 1 ]; then
      set_out="$(git rev-list "$local_sha" --not "$remote_sha" 2>/dev/null)" || set_out="__ERR__"
    else
      echo "test-identity-gate: cannot tell what remote '${remote}' already has (no local remote-tracking refs, old tip unknown)." >&2
      echo "Fix: git fetch ${remote}, then push again." >&2
      return 1
    fi
    if [ "$set_out" = "__ERR__" ]; then
      echo "test-identity-gate: could not enumerate commits for ${local_ref}; refusing (fail closed). Try: git fetch ${remote}" >&2
      return 1
    fi
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      short="$(git log -1 --format='%h' "$sha" 2>/dev/null || echo "$sha")"
      ae="$(git log -1 --format='%ae' "$sha" 2>/dev/null || true)"
      ce="$(git log -1 --format='%ce' "$sha" 2>/dev/null || true)"
      if __tig_email_forbidden "$ae"; then
        echo "test-identity-gate: ${short} author is a test identity (${ae})" >&2
        return 1
      fi
      if __tig_email_forbidden "$ce"; then
        echo "test-identity-gate: ${short} committer is a test identity (${ce})" >&2
        return 1
      fi
    done <<< "$set_out"
  done
  return 0
}
