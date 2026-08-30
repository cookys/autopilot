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
    if [ -f "$staged_file" ] && [ -f "${staged_file}.source.sha256" ] && [ "$staged_sha" != "$real_sha" ]; then
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
