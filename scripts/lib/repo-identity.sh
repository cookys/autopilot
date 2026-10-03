#!/usr/bin/env bash
# scripts/lib/repo-identity.sh — shell twin of src/status/task-runtime.js repoIdentity().
# Sourced (never executed) by the dispatch rails that write a run manifest
# (dispatch-hetero.sh, dispatch-review.sh, dispatch-author.sh). Mods plan P1a R1.
#
#   repo_identity_of <dir>
#       prints `git-common-dir:<realpath(git common dir)>` (+ newline), bit-identical to
#       Node `repoIdentity(dir)`: `git rev-parse --path-format=absolute --git-common-dir`
#       (same flag, so the main worktree also yields an absolute path) then `pwd -P`.
#       Any failure: ONE stderr line `repo-identity: git rev-parse --path-format failed
#       (git <ver>; need >= 2.31)`, empty stdout, return 1 — a named failure, never a
#       silent null. Requires git >= 2.31.
#
#   repo_identity_resolve_fields <repo_root> <consuming_repo_root>
#       sets REPO_IDENTITY_FIELDS to the two manifest JSON members
#         "repo_identity": <str|null>, "repo_identity_source": <str|null>
#       Precedence: explicit repo_root -> "repo_root"; consuming_repo_root (else the
#       cwd's `git rev-parse --show-toplevel`) -> "consuming_repo_root"; neither -> both
#       null. A directory whose identity cannot be derived -> repo_identity null,
#       source "git_rev_parse_failed". The value is cached in REPO_IDENTITY_FIELDS for
#       the life of the run (a rail rewrites its manifest several times). Callers pass
#       their OWN variables explicitly so an ambient exported REPO_ROOT can never leak in.

repo_identity_of() {
  local dir="${1:-.}" common canon
  if common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
      && [ -n "$common" ] \
      && canon="$(cd "$common" 2>/dev/null && pwd -P)" \
      && [ -n "$canon" ]; then
    printf 'git-common-dir:%s\n' "$canon"
    return 0
  fi
  echo "repo-identity: git rev-parse --path-format failed (git $(git --version 2>/dev/null | awk '{print $3}'); need >= 2.31)" >&2
  return 1
}

_repo_identity_json_str() {
  printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

repo_identity_resolve_fields() {
  [ -n "${REPO_IDENTITY_FIELDS:-}" ] && return 0
  local root="${1:-}" consuming="${2:-}" dir="" src="" id=""
  if [ -n "$root" ]; then
    dir="$root"; src="repo_root"
  else
    [ -n "$consuming" ] || consuming="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -n "$consuming" ]; then dir="$consuming"; src="consuming_repo_root"; fi
  fi
  if [ -z "$dir" ]; then
    REPO_IDENTITY_FIELDS='"repo_identity": null, "repo_identity_source": null'
  elif id="$(repo_identity_of "$dir")" && [ -n "$id" ]; then
    REPO_IDENTITY_FIELDS="\"repo_identity\": \"$(_repo_identity_json_str "$id")\", \"repo_identity_source\": \"$src\""
  else
    REPO_IDENTITY_FIELDS='"repo_identity": null, "repo_identity_source": "git_rev_parse_failed"'
  fi
  return 0
}
