#!/usr/bin/env bash
# main-checkout-boundary.sh — sourceable, the ONE implementation of the hands boundary shared by
# every write-capable rail (dispatch-hetero.sh, dispatch-foreman.sh).
#
# Two layers, neither trusting the prompt's "do not push" (measured 2026-09-13, see the
# narrative in dispatch-hetero.sh above its `git worktree add`):
#   prevention — build_hands_git_env fills HANDS_GIT_ENV with `GIT_ALLOW_PROTOCOL=` (empty:
#     allows nothing, and consulted BEFORE protocol.* config) plus `protocol.<name>.allow=never`
#     for every protocol git knows by name, every protocol the effective config has given its
#     OWN allow key, and the `protocol.allow` fallback — as GIT_CONFIG_COUNT env config, which is
#     command-line scope and beats repo config. Prefix the worker argv with
#     `env "${HANDS_GIT_ENV[@]}"`. Accident guard, not a sandbox.
#   detection — main_checkout_fingerprint digests HEAD, the symbolic-ref target, EVERY ref
#     (refs/replace included) except the ones the caller declares as its own, the staged and
#     unstaged diff text, a typed stat walk of everything outside .git, the effective git config
#     with origins, the (symlink-followed) hooks dir, index state, and refuses to answer
#     (UNVERIFIABLE-<nonce>, never equal to anything) when any measurement fails or a mount
#     sits below the checkout. Compare before/after; any delta is `main_checkout_mutated`.
#
# Inputs (globals, set by the caller before calling):
#   MAIN_CHECKOUT   absolute path of the checkout being guarded
#   BRANCH          this dispatch's own branch (its refs/heads entry is expected to move)
#   MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES  optional bash array of additional `refs/...` PREFIXES the
#                   caller owns (a foreman's hands branches); every other ref delta is a mutation
# Outputs:
#   main_checkout_fingerprint → 64-hex digest or UNVERIFIABLE-… on stdout
#   build_hands_git_env       → HANDS_GIT_ENV array (prepends to any inherited GIT_CONFIG_COUNT)
#
# Every function here must stay in dispatch-hetero.sh's `declare -f` list for its detached child.

_fp_unverifiable() { printf 'UNVERIFIABLE-%s-%s-%s' "$1" "$$" "$(date +%s%N)"; }
main_checkout_fingerprint() {
  local head sym refs dirty
  [ -n "$MAIN_CHECKOUT" ] || { _fp_unverifiable no-main-checkout; return 0; }
  head="$(git -C "$MAIN_CHECKOUT" rev-parse HEAD 2>/dev/null)" || { _fp_unverifiable head; return 0; }
  # rev-parse --symbolic-full-name prints "HEAD" when detached and the refname otherwise,
  # rc 0 in both; a non-zero rc is a measurement failure, not "detached".
  sym="$(git -C "$MAIN_CHECKOUT" rev-parse --symbolic-full-name HEAD 2>/dev/null)" || { _fp_unverifiable symref; return 0; }
  # EVERY ref — refs/replace/* included, since a replacement object can make a later content
  # check inspect a benign substitute (round 6, 2026-09-13) — except this dispatch's branch.
  refs="$(git -C "$MAIN_CHECKOUT" for-each-ref --format='%(refname)=%(objectname)=%(symref)' 2>/dev/null)" \
    || { _fp_unverifiable refs; return 0; }
  # This dispatch's own branch is expected to move (the wrapper commits on it); nothing else is.
  refs="$(printf '%s\n' "$refs" | awk -v own="refs/heads/${BRANCH}=" 'index($0, own) != 1')"
  # A caller that owns a whole ref NAMESPACE (a foreman's hands branches) declares its prefixes;
  # an exact own-branch match above never becomes a prefix match here.
  if [ "${MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES[*]+set}" = set ]; then
    local _pfx
    for _pfx in "${MAIN_CHECKOUT_FP_EXCLUDE_PREFIXES[@]}"; do
      [ -n "$_pfx" ] || continue
      refs="$(printf '%s\n' "$refs" | awk -v pfx="$_pfx" 'index($0, pfx) != 1')"
    done
  fi
  # Content, not labels: `status --porcelain` shows a path's state, so a second edit to an
  # already-dirty file, or an overwrite of an IGNORED file (.venv/bin/python), is invisible
  # to it (review, 2026-09-13). Tracked content: the unstaged and staged diffs. Everything
  # else on disk, including ignored and untracked: a stat walk — size + mtime of every
  # regular file under the checkout except .git — so an overwrite, create or delete of any
  # file changes the digest without hashing node_modules.
  dirty="$( { git -C "$MAIN_CHECKOUT" diff --no-color 2>/dev/null && git -C "$MAIN_CHECKOUT" diff --no-color --cached 2>/dev/null; } )" \
    || { _fp_unverifiable dirty; return 0; }
  # Every entry type, with type, mode and link target: a symlink planted over an empty
  # ignored directory has no regular file to change (round 5, 2026-09-13).
  walk="$(find "$MAIN_CHECKOUT" -xdev -path "$MAIN_CHECKOUT/.git" -prune -o -printf '%P\t%y\t%m\t%s\t%T@\t%l\n' 2>/dev/null | LC_ALL=C sort)" \
    || { _fp_unverifiable walk; return 0; }
  # Administrative surfaces the walk prunes (round 7, 2026-09-13): the shared config at every
  # scope (a brief saying "configure the remote" lands here) and the hooks directory.
  cfg="$(git -C "$MAIN_CHECKOUT" config --list --show-origin --show-scope 2>/dev/null)" || { _fp_unverifiable config; return 0; }
  gitdir="$(git -C "$MAIN_CHECKOUT" rev-parse --git-common-dir 2>/dev/null)" || { _fp_unverifiable gitdir; return 0; }
  case "$gitdir" in /*) ;; *) gitdir="$MAIN_CHECKOUT/$gitdir" ;; esac
  # -H/-L: follow a symlinked hooks dir to the live targets and record link targets (round 8).
  if [ -e "$gitdir/hooks" ]; then
    hooks="$(find -L "$gitdir/hooks" -printf '%P\t%y\t%m\t%s\t%T@\t%l\n' 2>/dev/null | LC_ALL=C sort)" || { _fp_unverifiable hooks; return 0; }
    hooks="$(readlink -f "$gitdir/hooks" 2>/dev/null || printf '?')
$hooks"
  else
    hooks="(no hooks dir)"
  fi
  # Index STATE, not just patch text: assume-unchanged / skip-worktree flags and stages change
  # behaviour without changing any diff (round 8). `ls-files -v` prefixes flagged entries.
  idx="$(git -C "$MAIN_CHECKOUT" ls-files -s -v 2>/dev/null)" || { _fp_unverifiable index; return 0; }
  # A mount below the checkout is outside -xdev's reach. Enumerate mounts from
  # /proc/self/mountinfo (findmnt if present); no enumeration at all is UNVERIFIABLE, not
  # "no mounts" (round 8).
  local mounts=""
  if [ -r /proc/self/mountinfo ]; then
    mounts="$(awk '{print $5}' /proc/self/mountinfo 2>/dev/null)" || { _fp_unverifiable mounts; return 0; }
  elif command -v findmnt >/dev/null 2>&1; then
    mounts="$(findmnt -rn -o TARGET 2>/dev/null)" || { _fp_unverifiable mounts; return 0; }
  else
    _fp_unverifiable mounts-unenumerable; return 0
  fi
  if printf '%s\n' "$mounts" | grep -q -F -- "$MAIN_CHECKOUT/"; then
    _fp_unverifiable mount-below-checkout; return 0
  fi
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$head" "$sym" "$refs" "$dirty" "$walk" "$cfg" "$hooks" "$idx" | sha256sum 2>/dev/null | cut -c1-64 | grep -E '^[0-9a-f]{64}$' \
    || _fp_unverifiable digest
}

build_hands_git_env() {
  _hands_env_i="${GIT_CONFIG_COUNT:-0}"
  case "$_hands_env_i" in ''|*[!0-9]*) _hands_env_i=0 ;; esac
  # `protocol.allow` is only the FALLBACK for protocols without their own `protocol.<name>.allow`;
  # a repo-level `protocol.file.allow=always` (common in repos that test submodules) beats it
  # (measured 2026-09-13: the tag push landed). Env config is command-line scope and wins over
  # repo config, so deny every protocol git knows by name, plus the fallback for any other.
  HANDS_GIT_ENV=()
  # …and every protocol the repo (or the user/system config) has given its OWN allow key —
  # a custom remote helper with `protocol.<helper>.allow=always` would otherwise beat the
  # fallback exactly as protocol.file.allow did (round 5, 2026-09-13).
  _configured_protos="$(git -C "${MAIN_CHECKOUT:-.}" config --get-regexp '^protocol\..*\.allow$' 2>/dev/null | awk '{print $1}' | sed 's/^protocol\.//' | LC_ALL=C sort -u)"
  for _proto in allow file.allow ssh.allow git.allow http.allow https.allow ftp.allow ftps.allow ext.allow $_configured_protos; do
    HANDS_GIT_ENV+=("GIT_CONFIG_KEY_${_hands_env_i}=protocol.${_proto}" "GIT_CONFIG_VALUE_${_hands_env_i}=never")
    _hands_env_i=$((_hands_env_i+1))
  done
  # GIT_ALLOW_PROTOCOL is consulted BEFORE protocol.* config: an inherited value would beat every
  # deny above, and an EMPTY value allows nothing — measured 2026-09-13 to block a push even after
  # the repo config gained a fresh `protocol.file.allow=always`. It is set here explicitly so an
  # inherited allowlist cannot leak through and so a worker-added allow key changes nothing.
  HANDS_GIT_ENV=("GIT_ALLOW_PROTOCOL=" "GIT_CONFIG_COUNT=${_hands_env_i}" "${HANDS_GIT_ENV[@]}")
}
