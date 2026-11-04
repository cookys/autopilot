#!/usr/bin/env bash
# mods/lib/real-claude-env.sh - sourced by mods/{live,viewer,roundtable}/run-tests.sh; defines mods_run_plugin_test <tmp> [args].
#
# The suite env puts a sentinel `claude` first on PATH (it exits 97) so no suite can reach a model. These three runners only need the
# engine's plugin test runner, which makes no model call (the one model-shaped test, viewer/assist.test.ts, mocks model.complete).
# AUTOPILOT_MODS_REAL_CLAUDE=<path to the real claude binary> lets them use it, and ONLY it: no PATH search, no default.
#   unset or empty   behaves exactly as before: `timeout 600 claude plugin test <tmp> args` from the PATH (the sentinel -> rc 97)
#   set              runs that binary with HOME, XDG_*, CLAUDE_CONFIG_DIR inside one fresh empty mktemp -d, auth env vars removed, then goes
#                    RED (rc 98, message on stderr) if that dir holds a .credentials.json or any *.jsonl (a transcript = a session/model call);
#                    the dir is removed afterwards either way.
# Returns the test run's rc (98 when the guard fires and the run itself was green).
mods_run_plugin_test() {
  local tmp="$1"; shift
  if [ -z "${AUTOPILOT_MODS_REAL_CLAUDE:-}" ]; then
    (cd "$tmp" && timeout 600 claude plugin test "$tmp" "$@")
    return $?
  fi
  local bin="$AUTOPILOT_MODS_REAL_CLAUDE" root rc=0 found=""
  if [ ! -f "$bin" ] || [ ! -x "$bin" ]; then
    echo "AUTOPILOT_MODS_REAL_CLAUDE=$bin is not an executable file" >&2
    return 99
  fi
  case "$bin" in /*) ;; *) bin="$PWD/$bin" ;; esac
  root="$(mktemp -d)"
  local id0; id0="$(stat -c %d:%i "$root")"
  mkdir -p "$root/home" "$root/config" "$root/xdg-config" "$root/xdg-data" "$root/xdg-state" "$root/xdg-cache"
  (cd "$tmp" && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_OAUTH_REFRESH_TOKEN \
      -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY -u ANTHROPIC_BASE_URL -u ANTHROPIC_BEDROCK_BASE_URL \
      -u ANTHROPIC_VERTEX_PROJECT_ID -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
      -u GOOGLE_APPLICATION_CREDENTIALS \
      HOME="$root/home" CLAUDE_CONFIG_DIR="$root/config" XDG_CONFIG_HOME="$root/xdg-config" XDG_DATA_HOME="$root/xdg-data" \
      XDG_STATE_HOME="$root/xdg-state" XDG_CACHE_HOME="$root/xdg-cache" \
      timeout 600 "$bin" plugin test "$tmp" "$@") || rc=$?
  local frc=0 scan_bad=""
  if [ -L "$root" ]; then
    # the child replaced the root with a symlink: nothing behind it is ours to scan, chmod or remove
    scan_bad="the sandbox dir $root was replaced by a symlink, so nothing could be checked"
    rm -f "$root" || true
  elif [ ! -d "$root" ]; then
    scan_bad="the sandbox dir $root is gone, so nothing could be checked"
  elif [ "$(stat -c %d:%i "$root" 2>/dev/null)" != "$id0" ]; then
    scan_bad="the sandbox dir $root is no longer the directory that was created, so nothing could be checked"
    rm -rf "$root" || true
  else
    found="$(find "$root" \( -name '.credentials.json' -o -name '*.jsonl' \) -print 2>/dev/null)" || frc=$?
    [ "$frc" -eq 0 ] || scan_bad="the scan of $root was incomplete (find exit $frc, e.g. an unreadable subdir)"
    # make unreadable dirs removable; find -P (the default) never follows a symlink, and only real directories are touched
    find "$root" -type d ! -perm -u+rwx -exec chmod u+rwx {} + 2>/dev/null || true
    rm -rf "$root" || true
  fi
  if [ -n "$scan_bad" ]; then
    echo "mods real-claude guard RED: $scan_bad" >&2
    [ "$rc" -ne 0 ] || rc=98
  fi
  if [ -n "$found" ]; then
    echo "mods real-claude guard RED: the empty config dir gained a credentials file or a transcript (a session or model call happened):" >&2
    printf '%s\n' "$found" | sed "s#^$root/##; s#^#  #" >&2
    [ "$rc" -ne 0 ] || rc=98
  fi
  return "$rc"
}
