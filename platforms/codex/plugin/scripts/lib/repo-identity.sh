#!/usr/bin/env bash
# scripts/lib/repo-identity.sh — shell twin of src/status/task-runtime.js repoIdentity().
# Sourced (never executed) by the dispatch rails that write a run manifest
# (dispatch-hetero.sh, dispatch-review.sh, dispatch-author.sh). Mods plan P1a R1.
#
#   repo_identity_of <dir>
#       prints `git-common-dir:<realpath(git common dir)>` (+ newline), bit-identical to
#       Node `repoIdentity(dir)`: `git rev-parse --path-format=absolute --git-common-dir`
#       (same flag, so the main worktree also yields an absolute path) then `pwd -P`.
#       Any failure: empty stdout, return 1, and ONE stderr line — a named failure, never a
#       silent null. Two cases:
#         - git < 2.31 (from `git --version`): `repo-identity: git rev-parse --path-format
#           failed (git <ver>; need >= 2.31)` — the version hint.
#         - any other case: `repo-identity: git rev-parse failed in <dir>: <git's own
#           stderr, joined to one line>`.
#       git exits 0 but prints no common dir: `repo-identity: git rev-parse returned no
#       common dir in <dir>`.
#       git exits 0 with a common dir that cannot be entered: `repo-identity: cannot resolve
#       common dir <path>` (not blamed on git).
#       A missing git (PATH), `git --version` failing, or a git reporting 127 is a failure
#       like any other: the version hint is printed only for a KNOWN version below 2.31.
#       Safe under a caller's `set -euo pipefail`, called directly or conditionally.
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
  local dir="${1:-.}" common="" canon="" rc=0 errf="" err="" ver="" maj="" min=""
  # One rev-parse call; its stderr is kept in a temp file so the failure reason is git's own
  # message from THIS call (never a second run's). Every command that can fail is guarded
  # (`|| x=`) so a caller's set -euo pipefail sees the diagnostic, not a silent abort.
  errf="$(mktemp -t repo-identity-err-XXXXXX 2>/dev/null)" || errf=""
  if [ -n "$errf" ]; then
    common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>"$errf")" || rc=$?
    err="$(tr '\n' ' ' <"$errf" 2>/dev/null)" || err=""
    rm -f "$errf"
  else
    common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || rc=$?
    err=""
  fi
  if [ "$rc" -eq 0 ] && [ -n "$common" ]; then
    if canon="$(cd "$common" 2>/dev/null && pwd -P)" && [ -n "$canon" ]; then
      printf 'git-common-dir:%s\n' "$canon"
      return 0
    fi
    echo "repo-identity: cannot resolve common dir $common" >&2
    return 1
  fi
  if [ "$rc" -eq 0 ]; then
    echo "repo-identity: git rev-parse returned no common dir in $dir" >&2
    return 1
  fi
  # Failure: the version hint only when git is actually older than 2.31 (a missing or unreadable
  # git version counts as unknown, never as old); otherwise git's own stderr, one line.
  ver="$(git --version 2>/dev/null | awk '{print $3}')" || ver=""
  case "$ver" in *.*) maj="${ver%%.*}"; min="${ver#*.}"; min="${min%%[!0-9]*}" ;; *) maj="$ver"; min="" ;; esac
  case "$maj" in ''|*[!0-9]*) maj="" ;; esac
  case "$min" in ''|*[!0-9]*) min="" ;; esac
  [ "${#maj}" -le 9 ] || maj=""
  [ "${#min}" -le 9 ] || min=""
  if [ -n "$maj" ] && [ -n "$min" ] \
      && { [ "$maj" -lt 2 ] || { [ "$maj" -eq 2 ] && [ "$min" -lt 31 ]; }; }; then
    echo "repo-identity: git rev-parse --path-format failed (git $ver; need >= 2.31)" >&2
  else
    err="${err% }"
    [ -n "$err" ] || err="git rev-parse exited $rc with no stderr"
    echo "repo-identity: git rev-parse failed in $dir: $err" >&2
  fi
  return 1
}

_repo_identity_json_str() {
  printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# manifest_session_id_json -- prints the JSON value for a manifest's "session_id" member: the
# launching Claude Code session id (CLAUDE_CODE_SESSION_ID) as a quoted string, else the bare
# literal null (never an error -- a manifest write must not fail on a missing or odd id).
# Live-pane plan section 7.1 identity hand-off 2: session -> rail no longer depends on an
# unexpired marker. AUTOPILOT_SESSION_ID is deliberately not consulted: rails scrub it for children.
manifest_session_id_json() {
  local sid="${CLAUDE_CODE_SESSION_ID:-}"
  if [ -n "$sid" ]; then
    printf '"%s"' "$(_repo_identity_json_str "$sid")"
  else
    printf 'null'
  fi
}

# child_session_mint -- identity hand-off step 3 (live-pane plan section 7.1). A rail that starts a
# `claude` child mints the child's session id ITSELF, passes it as `--session-id`, and records it in the
# run manifest as "child_session_id", so child -> run no longer depends on an unexpired marker. Sets
# CHILD_SESSION_ID (idempotent: a second call keeps the first id). The rail also hands the child
# AUTOPILOT_PARENT_SESSION_ID=$CLAUDE_CODE_SESSION_ID (only when set) on the claude command line itself;
# hooks/runs-watch-autostart.js turns that into the child marker's parent_session_id.
child_session_mint() {
  [ -n "${CHILD_SESSION_ID:-}" ] && return 0
  local u=""
  u="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || true)"
  [ -n "$u" ] || u="$(uuidgen 2>/dev/null || true)"
  [ -n "$u" ] || u="$(node -e 'process.stdout.write(require("crypto").randomUUID())' 2>/dev/null || true)"
  CHILD_SESSION_ID="$(printf '%s' "$u" | tr 'A-Z' 'a-z')"
  return 0
}

# manifest_child_session_json -- the JSON value for a manifest's "child_session_id": the minted id as a
# quoted string, else the bare literal null (runners that start no claude child, or no mint yet).
manifest_child_session_json() {
  if [ -n "${CHILD_SESSION_ID:-}" ]; then
    printf '"%s"' "$(_repo_identity_json_str "$CHILD_SESSION_ID")"
  else
    printf 'null'
  fi
}

# ccshim_keep_transcript <scratch-home> <run-id> -- dispatch-tree 3c (D3). Called just before a cc-shim rail
# removes its scratch HOME: copies <scratch>/.claude/projects/*/<child_session_id>.jsonl to
# <runs>/<run_id>.child-transcript.jsonl and sets CHILD_TRANSCRIPT_PATH (empty on any failure). Best-effort:
# always returns 0, so a failed copy can never change the run's status.
ccshim_keep_transcript() {
  CHILD_TRANSCRIPT_PATH=""
  local scratch="${1:-}" rid="${2:-}" dir src dest safe
  { [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" = "0" ] || [ -z "$scratch" ] || [ -z "$rid" ] || [ -z "${CHILD_SESSION_ID:-}" ]; } && return 0
  dir="${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}"
  safe="$(printf '%s' "$rid" | tr -c 'A-Za-z0-9._-' '-')"
  src="$(ls -1 "$scratch"/.claude/projects/*/"$CHILD_SESSION_ID".jsonl 2>/dev/null | head -1)" || src=""
  [ -n "$src" ] && [ -f "$src" ] || return 0
  dest="$dir/${safe}.child-transcript.jsonl"
  { mkdir -p "$dir" && cp -f "$src" "$dest.tmp.$$" && mv -f "$dest.tmp.$$" "$dest"; } 2>/dev/null \
    && CHILD_TRANSCRIPT_PATH="$dest" || rm -f "$dest.tmp.$$" 2>/dev/null
  return 0
}

# manifest_child_transcript_json -- the JSON value for a manifest's "child_transcript": the kept copy's path
# as a quoted string, else the bare literal null.
manifest_child_transcript_json() {
  if [ -n "${CHILD_TRANSCRIPT_PATH:-}" ]; then
    printf '"%s"' "$(_repo_identity_json_str "$CHILD_TRANSCRIPT_PATH")"
  else
    printf 'null'
  fi
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
