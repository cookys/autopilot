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

# qualify_writeback_credential <staged_file> <real_file>
# Writes staged over real only when staged is non-empty, differs from real, and is newer than real. Backup first, then
# temp+rename at 0600, under flock so parallel exams cannot overwrite each other. Unchanged staged => real untouched, no backup.
qualify_writeback_credential() {
  local staged=${1-} real=${2-} lock
  [ -s "$staged" ] || return 0
  [ -f "$real" ] || return 0
  cmp -s -- "$staged" "$real" && return 0
  [ "$staged" -nt "$real" ] || return 0
  lock="${QUALIFY_KIMI_LOCK:-$(dirname -- "$real")/.qualify-writeback.lock}"
  (
    flock -w 60 9 || { echo "qualify: writeback lock timeout, real credential left untouched: $real" >&2; exit 1; }
    # Re-check under the lock: another exam may have written back already.
    cmp -s -- "$staged" "$real" && exit 0
    [ "$staged" -nt "$real" ] || exit 0
    bak="${real}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p -- "$real" "$bak" && chmod 600 "$bak" || exit 1
    tmp="${real}.tmp.$$"
    cp -- "$staged" "$tmp" && chmod 600 "$tmp" && mv -f -- "$tmp" "$real" || { rm -f -- "$tmp"; exit 1; }
    echo "qualify: wrote rotated credential back to $real (backup $bak)" >&2
  ) 9>>"$lock"
}

# qualify_kimi_arm_writeback <staged_kimi_dir>
# Arms an EXIT/INT/TERM/HUP trap that writes the staged credential files back. Call after seeding.
qualify_kimi_arm_writeback() {
  QUALIFY_KIMI_STAGED_DIR=${1-}
  trap '_qualify_kimi_finish' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

_qualify_kimi_finish() {
  local rc=$? real_dir=${QUALIFY_KIMI_REAL_DIR:-$HOME/.kimi-code} f
  trap - EXIT
  for f in credentials/kimi-code.json oauth/kimi-code; do
    qualify_writeback_credential "$QUALIFY_KIMI_STAGED_DIR/$f" "$real_dir/$f" || true
  done
  return "$rc"
}
