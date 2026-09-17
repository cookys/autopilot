#!/usr/bin/env bash
# cleanroom-launch.sh — argv-only isolation launcher for a cleanroom review seat.
#
# Release-layout-only: bind a real codex *release* bin/ (codex beside
# codex-code-mode-host). The npm wrapper layout is not supported in this cut.
#
# Env (optional; callers may also pass flags):
#   AUTOPILOT_CLEANROOM_BWRAP   host bwrap binary (must be AppArmor-allowed to
#                               create user namespaces)
#
# Exit codes:
#   0     inner command succeeded (or preflight probe green)
#   2     usage / precondition / bwrap missing or cannot start
#   3     preflight: a --deny-path was readable, or a host path appeared in argv
#   124   inner timed out (coreutils timeout; forwarded untouched)
#   other inner command rc, passed through
#
# Modes:
#   Launch:  --profile codex --packet-dir --prompt-file --out --err --timeout
#            --model --effort --bin-dir --auth-file [--bwrap] [--seat-root]
#            [--keep-seat]
#   Preflight: --preflight --deny-path <p>… [--bwrap] [--seat-root]
#            (no packet, prompt, credential, or binary; empty work/)
#
# Orphan note: a SIGKILL leaves a cleanroom-seat.* directory that holds a
# copied credential; operators must sweep it. A token refresh performed
# inside the seat is discarded with the seat HOME (limitation).
# Proxy/private-CA env (HTTPS_PROXY/HTTP_PROXY/NO_PROXY/SSL_CERT_FILE) is
# NOT passed through in this cut.
#
# --sandbox danger-full-access is legal ONLY here: nested --sandbox read-only
# cannot create a userns inside bwrap (probe 2026-09-16). The bwrap boundary
# is the sandbox.

set -euo pipefail

_SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "$_SELF/json-emit.sh"

PROFILE=""
PREFLIGHT=0
PACKET_DIR=""
PROMPT_FILE=""
OUT_FILE=""
ERR_FILE=""
TIMEOUT=""
MODEL=""
EFFORT=""
BIN_DIR=""
AUTH_FILE=""
BWRAP_BIN="${AUTOPILOT_CLEANROOM_BWRAP:-}"
SEAT_ROOT=""
KEEP_SEAT=0
DENY_PATHS=()
CREATED_SEAT=0
SEAT_REMOVED=0

usage_die() {
  printf '%s\n' "$1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)     PROFILE="${2:-}"; shift 2 ;;
    --preflight)   PREFLIGHT=1; shift ;;
    --packet-dir)  PACKET_DIR="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --out)         OUT_FILE="${2:-}"; shift 2 ;;
    --err)         ERR_FILE="${2:-}"; shift 2 ;;
    --timeout)     TIMEOUT="${2:-}"; shift 2 ;;
    --model)       MODEL="${2:-}"; shift 2 ;;
    --effort)      EFFORT="${2:-}"; shift 2 ;;
    --bin-dir)     BIN_DIR="${2:-}"; shift 2 ;;
    --auth-file)   AUTH_FILE="${2:-}"; shift 2 ;;
    --bwrap)       BWRAP_BIN="${2:-}"; shift 2 ;;
    --seat-root)   SEAT_ROOT="${2:-}"; shift 2 ;;
    --keep-seat)   KEEP_SEAT=1; shift ;;
    --deny-path)
      [ -n "${2:-}" ] || usage_die "--deny-path requires a path"
      DENY_PATHS+=("$2")
      shift 2
      ;;
    -h|--help)
      sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) usage_die "unknown arg: $1" ;;
  esac
done

if [ "$PREFLIGHT" -eq 1 ]; then
  PROFILE="preflight"
elif [ "$PROFILE" = "codex" ]; then
  :
elif [ -n "$PROFILE" ]; then
  usage_die "unsupported cleanroom profile"
else
  usage_die "unsupported cleanroom profile"
fi

if [ "$PREFLIGHT" -eq 0 ]; then
  [ -n "$PACKET_DIR" ] || usage_die "--packet-dir is required"
  [ -n "$PROMPT_FILE" ] || usage_die "--prompt-file is required"
  [ -n "$OUT_FILE" ] || usage_die "--out is required"
  [ -n "$ERR_FILE" ] || usage_die "--err is required"
  [ -n "$TIMEOUT" ] || usage_die "--timeout is required"
  [ -n "$MODEL" ] || usage_die "--model is required"
  [ -n "$EFFORT" ] || usage_die "--effort is required"
  [ -n "$BIN_DIR" ] || usage_die "--bin-dir is required"
  [ -n "$AUTH_FILE" ] || usage_die "--auth-file is required"
  [ -d "$PACKET_DIR/tree" ] || usage_die "packet tree not found: $PACKET_DIR/tree"
  [ -f "$PROMPT_FILE" ] || usage_die "prompt file not found: $PROMPT_FILE"
  [ -d "$BIN_DIR" ] || usage_die "bin dir not found: $BIN_DIR"
  [ -f "$AUTH_FILE" ] || usage_die "auth file not found: $AUTH_FILE"
else
  [ "${#DENY_PATHS[@]}" -gt 0 ] || usage_die "--preflight requires --deny-path"
  for p in "${DENY_PATHS[@]}"; do
    if [ ! -e "$p" ]; then
      usage_die "deny-path does not exist: $p"
    fi
  done
  TIMEOUT="${TIMEOUT:-30s}"
fi

if [ -n "$BWRAP_BIN" ]; then
  [ -x "$BWRAP_BIN" ] || usage_die "bwrap not found: $BWRAP_BIN"
else
  command -v bwrap >/dev/null 2>&1 || usage_die "bwrap not found"
  BWRAP_BIN="$(command -v bwrap)"
fi

if [ -n "$SEAT_ROOT" ]; then
  if [ -e "$SEAT_ROOT" ]; then
    usage_die "seat root already exists"
  fi
  mkdir -m 0700 -p "$SEAT_ROOT"
  CREATED_SEAT=1
else
  SEAT_ROOT="$(mktemp -d -t cleanroom-seat.XXXXXX)"
  chmod 0700 "$SEAT_ROOT"
  CREATED_SEAT=1
fi

cleanup_seat() {
  if [ "$KEEP_SEAT" -eq 1 ]; then
    return 0
  fi
  if [ "$CREATED_SEAT" -eq 1 ] && [ -n "${SEAT_ROOT:-}" ] && [ -d "$SEAT_ROOT" ]; then
    rm -rf "$SEAT_ROOT"
    SEAT_REMOVED=1
  fi
}

on_exit() {
  cleanup_seat
}

on_signal() {
  local sig="$1"
  cleanup_seat
  trap - EXIT INT TERM HUP
  kill -s "$sig" "$$"
}

trap on_exit EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP

mkdir -p "$SEAT_ROOT/home/.codex" "$SEAT_ROOT/work"
chmod 0700 "$SEAT_ROOT/home" "$SEAT_ROOT/home/.codex" "$SEAT_ROOT/work"

printf 'review:x:65534:65534:review:/home/review:/bin/false\nnobody:x:65534:65534:nobody:/nonexistent:/bin/false\n' \
  > "$SEAT_ROOT/passwd"

emit_json() {
  local rc="$1"
  local timed_out=false
  local removed=false
  [ "$rc" -eq 124 ] && timed_out=true
  if [ "$KEEP_SEAT" -eq 0 ]; then
    if [ "$CREATED_SEAT" -eq 1 ]; then
      removed=true
    fi
  fi
  printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "%s", "exit_status": %s, "timed_out": %s, "seat_root_removed": %s, "seat_root": "%s" }\n' \
    "$(json_escape "$PROFILE")" "$rc" "$timed_out" "$removed" "$(json_escape "$SEAT_ROOT")"
}

write_args() {
  local args="$1"
  : > "$args"
  append() { printf '%s\0' "$1" >> "$args"; }
  append --unshare-all
  append --share-net
  append --die-with-parent
  append --new-session
  append --hostname
  append review
  append --ro-bind
  append /usr
  append /usr
  append --symlink
  append usr/lib
  append /lib
  append --symlink
  append usr/lib64
  append /lib64
  append --symlink
  append usr/bin
  append /bin
  append --ro-bind
  append /etc/resolv.conf
  append /etc/resolv.conf
  append --ro-bind
  append /etc/ssl
  append /etc/ssl
  append --ro-bind-try
  append /etc/ca-certificates
  append /etc/ca-certificates
  append --ro-bind
  append "$SEAT_ROOT/passwd"
  append /etc/passwd
  append --proc
  append /proc
  append --dev
  append /dev
  append --tmpfs
  append /tmp
  append --bind
  append "$SEAT_ROOT/home"
  append /home/review
  if [ "$PREFLIGHT" -eq 1 ]; then
    append --bind
    append "$SEAT_ROOT/work"
    append /home/review/work
    append --ro-bind
    append "$SEAT_ROOT/probe.sh"
    append /home/review/probe.sh
  else
    append --ro-bind
    append "$PACKET_DIR/tree"
    append /home/review/work
    append --ro-bind
    append "$SEAT_ROOT/prompt"
    append /home/review/prompt
    append --ro-bind
    append "$BIN_DIR"
    append /home/review/bin
  fi
  append --clearenv
  append --setenv
  append HOME
  append /home/review
  append --setenv
  append CODEX_HOME
  append /home/review/.codex
  append --setenv
  append PATH
  append /home/review/bin:/usr/bin
  append --setenv
  append TERM
  append dumb
  append --chdir
  append /home/review/work
}

close_inherited_fds() {
  local fd
  for ((fd = 3; fd <= 1023; fd++)); do
    eval "exec ${fd}>&-" 2>/dev/null || true
  done
}

run_bwrap() {
  local rc
  (
    close_inherited_fds
    if [ "$PREFLIGHT" -eq 1 ]; then
      timeout "$TIMEOUT" "$BWRAP_BIN" --args 9 -- /bin/sh /home/review/probe.sh \
        9< "$SEAT_ROOT/bwrap.args"
    else
      timeout "$TIMEOUT" "$BWRAP_BIN" --args 9 -- /bin/sh -c 'exec "$0" "$@"' \
        /home/review/bin/codex exec --model "$MODEL" \
        --sandbox danger-full-access --skip-git-repo-check --ignore-user-config \
        -c "model_reasoning_effort=\"$EFFORT\"" \
        --output-last-message /home/review/last-message \
        9< "$SEAT_ROOT/bwrap.args" < "$SEAT_ROOT/prompt" > "$OUT_FILE" 2> "$ERR_FILE"
    fi
  )
  rc=$?
  return "$rc"
}

if [ "$PREFLIGHT" -eq 1 ]; then
  {
    printf '#!/bin/sh\n'
    printf 'cmdline=$(tr "\\0" " " < /proc/1/cmdline)\n'
    printf 'check() {\n'
    printf '  p=$1\n'
    printf '  if cat "$p" >/dev/null 2>&1; then printf "%%s\\n" "$p" | tee /home/review/work/preflight.err >&2; exit 3; fi\n'
    printf '  case "$cmdline" in *"$p"*) printf "%%s\\n" "$p" | tee /home/review/work/preflight.err >&2; exit 3 ;; esac\n'
    printf '}\n'
    printf 'check %q\n' "$SEAT_ROOT"
    for p in "${DENY_PATHS[@]}"; do
      printf 'check %q\n' "$p"
    done
    printf 'exit 0\n'
  } > "$SEAT_ROOT/probe.sh"
  chmod 0400 "$SEAT_ROOT/probe.sh"
  write_args "$SEAT_ROOT/bwrap.args"
  inner_rc=0
  run_bwrap || inner_rc=$?
  if [ -s "$SEAT_ROOT/work/preflight.err" ]; then
    cat "$SEAT_ROOT/work/preflight.err" >&2
  elif [ -s "$SEAT_ROOT/probe.stderr" ]; then
    cat "$SEAT_ROOT/probe.stderr" >&2
  fi
  if [ "$inner_rc" -eq 3 ]; then
    emit_json "$inner_rc"
    cleanup_seat
    trap - EXIT INT TERM HUP
    exit 3
  fi
  if [ "$inner_rc" -ne 0 ]; then
    printf 'bwrap cannot start (rc=%s)\n' "$inner_rc" >&2
    emit_json 2
    cleanup_seat
    trap - EXIT INT TERM HUP
    exit 2
  fi
  emit_json 0
  cleanup_seat
  trap - EXIT INT TERM HUP
  exit 0
fi

cp "$AUTH_FILE" "$SEAT_ROOT/home/.codex/auth.json"
chmod 0600 "$SEAT_ROOT/home/.codex/auth.json"
printf 'model = "%s"\nmodel_reasoning_effort = "%s"\n' "$MODEL" "$EFFORT" \
  > "$SEAT_ROOT/home/.codex/config.toml"
cp "$PROMPT_FILE" "$SEAT_ROOT/prompt"
chmod 0400 "$SEAT_ROOT/prompt"
: > "$OUT_FILE"
: > "$ERR_FILE"
write_args "$SEAT_ROOT/bwrap.args"
inner_rc=0
run_bwrap || inner_rc=$?
emit_json "$inner_rc"
cleanup_seat
trap - EXIT INT TERM HUP
exit "$inner_rc"
