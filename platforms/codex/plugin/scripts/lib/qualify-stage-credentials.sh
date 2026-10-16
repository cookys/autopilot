#!/usr/bin/env bash
#
# Staging helpers for docs/plans/evidence/*/administration/*/run.sh recipes.
# Credential helpers now reseed and detect drift via a source hash stamp so
# rotated OAuth/session/API secrets do not silently remain stale during runs.

qualify_stage_credential() {
  local staged_file=${1-}
  local real_file=${2-}
  local mode=${3-}
  local real_sha=""
  local staged_sha=""

  if [ ! -f "$real_file" ]; then
    return 0
  fi

  real_sha="$(sha256sum -- "$real_file" | awk '{print $1}')"

  if [ -f "${staged_file}.source.sha256" ]; then
    staged_sha="$(cat "${staged_file}.source.sha256")"
  fi

  if [ "$mode" = "plan" ]; then
    # A staged credential with no stamp has no proven match to the live source
    # (legacy copies from before stamping — the exact D7 stale-material case):
    # treat it as drift, not as a pass.
    if [ -f "$staged_file" ] && { [ ! -f "${staged_file}.source.sha256" ] || [ "$staged_sha" != "$real_sha" ]; }; then
      echo "run.sh: staged credential drift: $staged_file" >&2
      return 1
    fi
    return 0
  fi

  # BL-0199: any recipe staging a Kimi credential gets the exit write-back automatically (new entry points cannot forget).
  case "$real_file" in
    */.kimi-code/credentials/kimi-code.json|*/.kimi-code/oauth/kimi-code)
      case "$staged_file" in
        */credentials/kimi-code.json|*/oauth/kimi-code) ;;
        *) echo "qualify: WARNING staged kimi path has unexpected layout: $staged_file" >&2 ;;
      esac
      [ "$mode" = "execute" ] && qualify_kimi_arm_writeback "$(dirname -- "$(dirname -- "$staged_file")")" "$(dirname -- "$(dirname -- "$real_file")")" ;;
  esac

  if [ ! -f "$staged_file" ] || [ "$staged_sha" != "$real_sha" ]; then
    cp -- "$real_file" "$staged_file"
    chmod 600 "$staged_file" || true
    echo "$real_sha" >"${staged_file}.source.sha256"
  fi

  return 0
}

qualify_stage_identity() {
  local staged_file=${1-}
  local real_file=${2-}

  if [ ! -f "$staged_file" ] && [ -f "$real_file" ]; then
    cp -- "$real_file" "$staged_file" || true
  fi

  return 0
}

# --- Kimi write-back (BL-0199) -------------------------------------------------
# Kimi rotates its refresh token on every use. The exam must therefore (1) work on a COPY seeded into the staged home
# (qualify_stage_credential above; the real ~/.kimi-code is never handed to a child) and (2) at exit write the newest
# credential BACK to the real file, after backing the original up as <file>.bak-<UTC stamp>. Standard step, not optional.
# Overrides for tests: QUALIFY_KIMI_REAL_DIR (default $HOME/.kimi-code), QUALIFY_KIMI_LOCK (default <real dir>/.qualify-writeback.lock).

# TRAP RULES (read before touching traps in a recipe): arming CHAINS onto the caller's existing EXIT/INT/TERM/HUP actions
# (write-back first, because losing a rotated credential is the costly failure; the caller's own action runs after it with
# the original exit status). A caller that sets an EXIT/INT/TERM/HUP trap AFTER arming must NOT use a bare `trap`
# (that would silently drop the write-back): use `qualify_trap_add '<cmd>' EXIT [SIG...]`. Arm in the main shell only:
# inside $(...), a pipeline or ( ) the trap dies with the subshell, so arm warns loudly on stderr when BASHPID != $$.

# qualify_trap_add <cmd> <SIG>... : append <cmd> to each signal's existing action instead of replacing it.
qualify_trap_add() {
  local cmd=${1-} sig old
  shift
  for sig in "$@"; do
    old=""
    eval "set -- $(trap -p "$sig")" 2>/dev/null
    [ "${1-}" = trap ] && old=${3-}
    if [ -n "$old" ]; then trap -- "$cmd; $old" "$sig"; else trap -- "$cmd" "$sig"; fi
    set --
  done
}

# qualify_writeback_credential <staged_file> <real_file>
# Writes staged over real only when staged is non-empty, differs from real, is newer than real, and (for the credentials
# json) carries a non-empty refresh_token. Backup first, then temp+rename, all created 0600 (umask 077), under flock so
# parallel exams cannot overwrite each other. Unchanged / older staged => real untouched, no backup.
qualify_writeback_credential() {
  local staged=${1-} real=${2-} lock
  [ -s "$staged" ] || return 0
  [ -f "$real" ] || return 0
  cmp -s -- "$staged" "$real" && return 0
  [ "$staged" -nt "$real" ] || return 0
  case "$staged" in
    */credentials/kimi-code.json)
      if ! grep -Eq '"refresh_token"[[:space:]]*:[[:space:]]*"[^"]+"' -- "$staged"; then
        echo "qualify: staged credential has no non-empty refresh_token, NOT written back: $staged" >&2
        return 0
      fi ;;
  esac
  lock="${QUALIFY_KIMI_LOCK:-$(dirname -- "$real")/.qualify-writeback.lock}"
  (
    umask 077
    flock -w 60 9 || { echo "qualify: writeback lock timeout, real credential left untouched: $real" >&2; exit 1; }
    # Re-check under the lock: another exam may have written back already.
    cmp -s -- "$staged" "$real" && exit 0
    [ "$staged" -nt "$real" ] || exit 0
    bak="${real}.bak-$(date -u +%Y%m%dT%H%M%S).$$.$(date +%N)"
    { cat -- "$real" >"$bak" && touch -r "$real" -- "$bak"; } || exit 1
    tmp="${real}.tmp.$$"
    { cat -- "$staged" >"$tmp" && touch -r "$staged" -- "$tmp" && chmod 600 "$tmp" && mv -f -- "$tmp" "$real"; } || { rm -f -- "$tmp"; exit 1; }
    echo "qualify: wrote rotated credential back to $real (backup $bak)" >&2
  ) 9>>"$lock"
}

# qualify_kimi_arm_writeback <staged_kimi_dir> [<real_kimi_dir>]
# Arms the exit write-back (chained, see TRAP RULES). Idempotent per (staged, real) pair. Call in the main shell.
qualify_kimi_arm_writeback() {
  local staged=${1-} real=${2:-${QUALIFY_KIMI_REAL_DIR:-$HOME/.kimi-code}} key
  if [ "${BASHPID:-$$}" != "$$" ]; then
    echo "qualify: WARNING qualify_kimi_arm_writeback called in a subshell; its trap dies with the subshell and the credential will NOT be written back" >&2
  fi
  key="$staged|$real"
  case "${QUALIFY_KIMI_ARMED:-}" in *"<$key>"*) return 0 ;; esac
  QUALIFY_KIMI_ARMED="${QUALIFY_KIMI_ARMED:-}<$key>"
  local q; q="$(printf '_qualify_kimi_finish %q %q' "$staged" "$real")"
  qualify_trap_add "$q" EXIT
  # Signals: write-back first, then the caller's own action if it had one (their semantics kept); with none, exit 128+N.
  local sig n old
  for sig in INT:130 TERM:143 HUP:129; do
    n=${sig#*:}; sig=${sig%:*}; old=""
    eval "set -- $(trap -p "$sig")" 2>/dev/null; [ "${1-}" = trap ] && old=${3-}
    if [ -n "$old" ]; then qualify_trap_add "$q" "$sig"; else trap -- "$q; exit $n" "$sig"; fi
  done
}

# _qualify_kimi_finish <staged_dir> <real_dir> : idempotent, preserves the exit status it was entered with.
_qualify_kimi_finish() {
  local rc=$? staged=${1-} real=${2-} f n=0
  for f in credentials/kimi-code.json oauth/kimi-code; do
    [ -e "$staged/$f" ] && n=$((n+1))
    qualify_writeback_credential "$staged/$f" "$real/$f" || true
  done
  [ "$n" -gt 0 ] || echo "qualify: WARNING no staged kimi credential under $staged (unexpected layout), nothing written back" >&2
  return "$rc"
}
