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
#         - a directory outside any repository: `repo-identity: <dir> is not inside a git
#           repository`.
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
#       the life of the run (a rail rewrites its manifest several times), keyed on the (root,
#       consuming) pair: a call with different inputs recomputes. Callers pass
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
    case "$err" in
      *"not a git repository"*) echo "repo-identity: $dir is not inside a git repository" >&2 ;;   # a plain non-repo dir is not a git failure
      *) echo "repo-identity: git rev-parse failed in $dir: $err" >&2 ;;
    esac
  fi
  return 1
}

_repo_identity_json_str() {
  printf '%s' "$1" | tr '\000-\037' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# manifest_session_id_json -- prints the JSON value for a manifest's "session_id" member: the
# launching Claude Code session id (CLAUDE_CODE_SESSION_ID) as a quoted string, else the bare
# literal null (never an error -- a manifest write must not fail on a missing or odd id).
# Live-pane plan section 7.1 identity hand-off 2: session -> rail no longer depends on an
# unexpired marker. AUTOPILOT_SESSION_ID is deliberately not consulted: rails scrub it for children.
manifest_session_id_json() {
  local sid="${_RAIL_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}"   # _RAIL_SESSION_ID: kept by child_session_pin/apply_env (never exported)
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

# child_session_env_setup -- plan dispatch-tree step 3b (section 6 rule 3). A rail hands EVERY child runner its own
# marker write target as AUTOPILOT_PARENT_SESSION_ID (the id `session-mode.js write-target --rail` resolves: env
# chain or cwd included, or the inherited parent when this rail is itself below one) and scrubs the ids the child
# could otherwise write under. Sets CHILD_SESSION_UNSET (array of `-u NAME`; must precede any NAME=VALUE in an `env`
# argv) and CHILD_SESSION_PARENT (the id, empty when nothing resolved; pass as AUTOPILOT_PARENT_SESSION_ID=<id>).
# Optional $1: the scripts/ dir (a function re-declared in a detached child has no useful BASH_SOURCE).
# CLAUDE_CODE_SESSION_ID goes only when it differs from the parent id: a runner below it must see it as inherited.
child_session_env_setup() {
  if [ "${_CHILD_SESSION_PINNED:-0}" = "1" ]; then   # resolved by child_session_pin before the rail scrubbed its own env
    CHILD_SESSION_UNSET=("${_CHILD_SESSION_PIN_UNSET[@]}"); CHILD_SESSION_PARENT="$_CHILD_SESSION_PIN_PARENT"; return 0
  fi
  CHILD_SESSION_UNSET=(-u AUTOPILOT_SESSION_ID -u CLAUDE_SESSION_ID -u AUTOPILOT_CHILD_SESSION_ID)   # 3d: an inherited C never reaches a child; a claude launch re-adds its own AFTER this list
  CHILD_SESSION_PARENT=""
  local sm
  if [ -n "${1:-}" ]; then sm="$1/session-mode.js"; else sm="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/session-mode.js"; fi
  if [ -r "$sm" ]; then
    CHILD_SESSION_PARENT="$(node "$sm" write-target --rail 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$CHILD_SESSION_PARENT" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && [ "${CLAUDE_CODE_SESSION_ID}" != "$CHILD_SESSION_PARENT" ]; then
    CHILD_SESSION_UNSET+=(-u CLAUDE_CODE_SESSION_ID)
  fi
  return 0
}

# child_session_pin [scripts-dir] -- a rail that scrubs its own AUTOPILOT_SESSION_ID at startup (author, review,
# explore) calls this FIRST, so the parent id handed to every child is resolved from the launcher's env, not from
# what is left after the scrub; every later child_session_env_setup then returns the pinned values.
child_session_pin() {
  _CHILD_SESSION_PINNED=0
  _RAIL_SESSION_ID="${_RAIL_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}"   # this rail's own manifest identity; the child's copy may be scrubbed
  child_session_env_setup "$@"
  _CHILD_SESSION_PIN_UNSET=("${CHILD_SESSION_UNSET[@]}"); _CHILD_SESSION_PIN_PARENT="$CHILD_SESSION_PARENT"; _CHILD_SESSION_PINNED=1
  return 0
}

# child_session_apply_env [scripts-dir] -- for a runner the rail starts in-process (no `env` wrapper possible around a
# function or a bare `timeout ... cmd`): export P and scrub the same ids in THIS shell. Call it only after the rail's
# own session lookups are done and before the runner chain; the claude branches' explicit `env` agrees with it.
child_session_apply_env() {
  _RAIL_SESSION_ID="${_RAIL_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}"   # keep the launcher's id for this rail's manifest before it is scrubbed
  child_session_env_setup "$@"
  local _a
  for _a in "${CHILD_SESSION_UNSET[@]}"; do [ "$_a" = "-u" ] || unset "$_a"; done
  unset AUTOPILOT_CHILD_SESSION_ID   # 3d: stated here too, so an in-process runner never depends on the list's contents
  [ -n "$CHILD_SESSION_PARENT" ] && export AUTOPILOT_PARENT_SESSION_ID="$CHILD_SESSION_PARENT"
  return 0
}

# child_marker_hook_setup -- plan dispatch-tree step 3a (D2). The claude child's SessionStart marker is
# written by a hook the rail hands it with `--settings` (the user-scope plugin does not load in a
# project-only child). Sets CHILD_MARKER_SETTINGS (inline settings JSON; empty when no child id was minted
# or the script path is unsafe to quote) and CHILD_MARKER_DIR (the LAUNCHER's marker dir, resolved before a
# cc-shim scratch HOME hides ~/.autopilot; the rail exports it to the child as AUTOPILOT_SESSION_MODE_DIR).
child_marker_hook_setup() {
  child_session_env_setup   # 3b: the claude child's parent id + scrubbed ids (callers expand CHILD_SESSION_UNSET / CHILD_SESSION_PARENT)
  CHILD_MARKER_SETTINGS=""
  CHILD_MARKER_DIR="${AUTOPILOT_SESSION_MODE_DIR:-${HOME:-}/.autopilot/session-mode}"
  [ -n "${CHILD_SESSION_ID:-}" ] || return 0
  local sm nodebin
  sm="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/session-mode.js"
  [ -r "$sm" ] || return 0
  case "$sm" in *\'*|*\"*|*\\*)
    echo "child_marker_hook_setup: session-mode.js path contains a quote or backslash; child marker hook not installed" >&2
    return 0 ;;
  esac
  # Absolute node: a cc-shim child runs under a scratch HOME, where a $HOME-based shim (asdf, nvm) would not resolve.
  nodebin="$(command -v node 2>/dev/null || true)"
  case "$nodebin" in /*) ;; *) nodebin="node" ;; esac
  case "$nodebin" in *\'*|*\"*|*\\*) nodebin="node" ;; esac
  CHILD_MARKER_SETTINGS="{\"hooks\":{\"SessionStart\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"'$nodebin' '$sm' ensure-child\"}]}]}}"
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
# always returns 0, so a failed copy can never change the run's status. A symlink source is skipped; the copy is 0600.
ccshim_keep_transcript() {
  CHILD_TRANSCRIPT_PATH=""
  local scratch="${1:-}" rid="${2:-}" dir src dest safe
  { [ "${AUTOPILOT_DISPATCH_MANIFEST:-1}" = "0" ] || [ -z "$scratch" ] || [ -z "$rid" ] || [ -z "${CHILD_SESSION_ID:-}" ]; } && return 0
  dir="${AUTOPILOT_DISPATCH_RUNS_DIR:-${TMPDIR:-/tmp}/autopilot-dispatch-runs}"
  safe="$(printf '%s' "$rid" | tr -c 'A-Za-z0-9._-' '-')"
  src="$(ls -1 "$scratch"/.claude/projects/*/"$CHILD_SESSION_ID".jsonl 2>/dev/null | head -1)" || src=""
  # A symlink source is never followed (a prompt-injected child could point it at any readable file).
  [ -n "$src" ] && [ -f "$src" ] && [ ! -L "$src" ] || return 0
  dest="$dir/${safe}.child-transcript.jsonl"
  # umask 077 + chmod 600 on the temp file BEFORE the rename: the transcript is never visible world-readable.
  { mkdir -p "$dir" && rm -f "$dest.tmp.$$" && (umask 077; cp "$src" "$dest.tmp.$$") && chmod 600 "$dest.tmp.$$" \
      && mv -f "$dest.tmp.$$" "$dest"; } 2>/dev/null \
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
  # Cache keyed on the inputs (BL-0109): the same (root, consuming) pair reuses the stored fields; a
  # different pair recomputes. A value present with no recorded key (preset by a caller, or carried
  # into a detached child that does not carry the key) is honoured as before.
  local key="${1:-}"$'\037'"${2:-}"   # US separator: cannot appear in a path in practice
  if [ -n "${REPO_IDENTITY_FIELDS:-}" ] && { [ -z "${_REPO_IDENTITY_FIELDS_KEY:-}" ] || [ "$_REPO_IDENTITY_FIELDS_KEY" = "$key" ]; }; then
    return 0
  fi
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
  _REPO_IDENTITY_FIELDS_KEY="$key"
  return 0
}
