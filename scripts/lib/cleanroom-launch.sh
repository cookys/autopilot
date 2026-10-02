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
# Profiles kimi and agy (final-panel isolation, phase 2). No repo, no real HOME,
# no --ro-bind / /; the prompt carries the packet; the seat agent is a tool
# allowlist (tools: []). The caller audits the kept seat (--keep-seat) BEFORE
# deleting it; exit 0 is never proof of containment.
#   Launch:  --profile kimi|agy --prompt-file --out --err --timeout --model
#            [--effort] [--bin P] [--node-dir D] [--cred-dir D] [--agent-file F]
#            [--bwrap] [--seat-root] [--keep-seat]
#   Preflight: --preflight --profile kimi|agy --deny-path <p>… [--bin P]
#            [--node-dir D] [--agent-file F]
#            Model-free, empty HOME, NO credential/repo/packet bind: deny paths
#            unreadable, CLI runs (--version), kimi agent file intact, agy
#            `agy agents` lists the tool-less agent. Credentials are copied on
#            the launch path only. --hostname review is proven by the preflight
#            itself running with it for both CLIs (probe 2026-10-03).
#   --bin: kimi entry (main.mjs, must sit under --node-dir) or the agy ELF.
#   --node-dir: node install root (bin/node + lib/...); default from PATH.
#   --cred-dir: kimi ~/.kimi-code or agy ~/.gemini/antigravity-cli (launch only).
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
RUNNER=""
RUNNER_BIN=""
NODE_DIR=""
CRED_DIR=""
AGENT_FILE=""

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
    --bin)         RUNNER_BIN="${2:-}"; shift 2 ;;
    --node-dir)    NODE_DIR="${2:-}"; shift 2 ;;
    --cred-dir)    CRED_DIR="${2:-}"; shift 2 ;;
    --agent-file)  AGENT_FILE="${2:-}"; shift 2 ;;
    --deny-path)
      [ -n "${2:-}" ] || usage_die "--deny-path requires a path"
      DENY_PATHS+=("$2")
      shift 2
      ;;
    -h|--help)
      sed -n '2,56p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) usage_die "unknown arg: $1" ;;
  esac
done

case "$PROFILE" in
  kimi|agy) RUNNER="$PROFILE" ;;
esac
if [ "$PREFLIGHT" -eq 1 ]; then
  PROFILE="preflight"
elif [ "$PROFILE" = "codex" ] || [ -n "$RUNNER" ]; then
  :
else
  usage_die "unsupported cleanroom profile"
fi

if [ "$PREFLIGHT" -eq 0 ] && [ -n "$RUNNER" ]; then
  [ -n "$PROMPT_FILE" ] || usage_die "--prompt-file is required"
  [ -n "$OUT_FILE" ] || usage_die "--out is required"
  [ -n "$ERR_FILE" ] || usage_die "--err is required"
  [ -n "$TIMEOUT" ] || usage_die "--timeout is required"
  [ -n "$MODEL" ] || usage_die "--model is required"
  [ -f "$PROMPT_FILE" ] || usage_die "prompt file not found: $PROMPT_FILE"
  if [ "$RUNNER" = "agy" ]; then
    [ -n "$EFFORT" ] || usage_die "--effort is required"
  fi
elif [ "$PREFLIGHT" -eq 0 ]; then
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

if [ -z "$RUNNER" ]; then
  mkdir -p "$SEAT_ROOT/home/.codex" "$SEAT_ROOT/work"
  chmod 0700 "$SEAT_ROOT/home" "$SEAT_ROOT/home/.codex" "$SEAT_ROOT/work"
else
  mkdir -p "$SEAT_ROOT/home" "$SEAT_ROOT/work"
  chmod 0700 "$SEAT_ROOT/home" "$SEAT_ROOT/work"
fi

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
  local runner_field=""
  if [ -n "$RUNNER" ]; then
    runner_field=", \"runner\": \"$(json_escape "$RUNNER")\""
  fi
  # kimi/agy preflight only: the CLI version the in-seat probe observed (recorded by intake;
  # a different version at dispatch time is advisory, never a block).
  if [ -n "$RUNNER" ] && [ "$PREFLIGHT" -eq 1 ] && [ -s "$SEAT_ROOT/work/preflight.version" ]; then
    runner_field="$runner_field, \"runner_version\": \"$(json_escape "$(head -n 1 "$SEAT_ROOT/work/preflight.version")")\""
  fi
  printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "%s"%s, "exit_status": %s, "timed_out": %s, "seat_root_removed": %s, "seat_root": "%s" }\n' \
    "$(json_escape "$PROFILE")" "$runner_field" "$rc" "$timed_out" "$removed" "$(json_escape "$SEAT_ROOT")"
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

# ---- kimi / agy profiles (final-panel isolation phase 2) -------------------
AGY_AGENT_NAME_FIXED="autopilot-toolless-reviewer"
RUNNER_NODE_REL=""

runner_fail() {
  printf '%s\n' "$1" >&2
  emit_json 2
  cleanup_seat
  trap - EXIT INT TERM HUP
  exit 2
}

# One source of truth: the phase-1 kimi-containment lib owns the tool-less agent (name,
# text). Used only when --agent-file is absent; the audit's agent marker is that name.
write_default_kimi_agent() {
  local written
  written="$(node "$_SELF/kimi-containment.js" write "$SEAT_ROOT/agent-src")" || return 1
  cp "$written" "$1"
}

kimi_agent_intact() {
  [ -s "$1" ] && grep -q '^description: ..*' "$1" && grep -q '^tools: \[\]$' "$1"
}

resolve_runner_inputs() {
  local resolved nd
  if [ "$RUNNER" = "kimi" ]; then
    if [ -z "$RUNNER_BIN" ]; then
      RUNNER_BIN="$(command -v kimi 2>/dev/null || true)"
    fi
    [ -n "$RUNNER_BIN" ] || runner_fail "kimi binary not found"
    resolved="$(readlink -f "$RUNNER_BIN")"
    [ -f "$resolved" ] || runner_fail "kimi entry not found: $RUNNER_BIN"
    RUNNER_BIN="$resolved"
    if [ -z "$NODE_DIR" ]; then
      nd="$(command -v node 2>/dev/null || true)"
      [ -n "$nd" ] || runner_fail "node not found for the kimi seat"
      NODE_DIR="$(dirname "$(dirname "$(readlink -f "$nd")")")"
    fi
    [ -x "$NODE_DIR/bin/node" ] || runner_fail "node dir has no bin/node: $NODE_DIR"
    case "$RUNNER_BIN" in
      "$NODE_DIR"/*) RUNNER_NODE_REL="${RUNNER_BIN#"$NODE_DIR"/}" ;;
      *) runner_fail "kimi entry is not under the node dir ($NODE_DIR)" ;;
    esac
  else
    if [ -z "$RUNNER_BIN" ]; then
      RUNNER_BIN="$(command -v agy 2>/dev/null || true)"
    fi
    [ -n "$RUNNER_BIN" ] || runner_fail "agy binary not found"
    RUNNER_BIN="$(readlink -f "$RUNNER_BIN")"
    [ -x "$RUNNER_BIN" ] || runner_fail "agy binary not executable: $RUNNER_BIN"
  fi
}

prepare_runner_seat() {
  if [ "$RUNNER" = "kimi" ]; then
    if [ -n "$AGENT_FILE" ]; then
      [ -f "$AGENT_FILE" ] || runner_fail "agent file not found: $AGENT_FILE"
      cp "$AGENT_FILE" "$SEAT_ROOT/agent.md"
    else
      write_default_kimi_agent "$SEAT_ROOT/agent.md" \
        || runner_fail "could not write the tool-less kimi agent"
    fi
    chmod 0400 "$SEAT_ROOT/agent.md"
    kimi_agent_intact "$SEAT_ROOT/agent.md" \
      || runner_fail "kimi agent file is not an intact tool-less agent (needs description and tools: [])"
  else
    mkdir -p "$SEAT_ROOT/home/.gemini/antigravity-cli"
    chmod 0700 "$SEAT_ROOT/home/.gemini" "$SEAT_ROOT/home/.gemini/antigravity-cli"
    node "$_SELF/agy-containment.js" write "$SEAT_ROOT/home/.gemini/antigravity-cli/agents" >/dev/null \
      || runner_fail "could not write the tool-less agy agent"
    # agy 1.2.15 reads agents from <HOME>/.gemini/config/agents (it migrates the legacy dir there and leaves
    # an absolute symlink, dangling on the host). Seed both: 1.2.15 keeps the config copy and its legacy
    # rename fails harmlessly; older agy still finds the legacy dir.
    mkdir -p "$SEAT_ROOT/home/.gemini/config"
    chmod 0700 "$SEAT_ROOT/home/.gemini/config"
    node "$_SELF/agy-containment.js" write "$SEAT_ROOT/home/.gemini/config/agents" >/dev/null \
      || runner_fail "could not write the tool-less agy agent (config/agents)"
    mkdir -p "$SEAT_ROOT/home/.gemini/antigravity-cli/brain" \
      "$SEAT_ROOT/home/.gemini/antigravity-cli/log" \
      "$SEAT_ROOT/home/.gemini/antigravity-cli/crashes"
  fi
}

write_runner_args() {
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
  if [ "$RUNNER" = "kimi" ]; then
    append --ro-bind
    append "$NODE_DIR"
    append /opt/node
    append --ro-bind
    append "$SEAT_ROOT/agent.md"
    append /home/review/agent.md
  else
    append --ro-bind
    append "$RUNNER_BIN"
    append /opt/agybin
  fi
  if [ "$PREFLIGHT" -eq 1 ]; then
    append --bind
    append "$SEAT_ROOT/work"
    append /home/review/work
    append --ro-bind
    append "$SEAT_ROOT/probe.sh"
    append /home/review/probe.sh
  else
    append --ro-bind
    append "$SEAT_ROOT/work"
    append /home/review/work
    append --ro-bind
    append "$SEAT_ROOT/prompt"
    append /home/review/prompt
  fi
  append --clearenv
  append --setenv
  append HOME
  append /home/review
  append --setenv
  append PATH
  if [ "$RUNNER" = "kimi" ]; then
    append /opt/node/bin:/usr/bin
  else
    append /usr/bin
  fi
  append --setenv
  append TERM
  append dumb
  append --chdir
  append /home/review/work
}

write_runner_probe() {
  {
    printf '#!/bin/sh\n'
    printf 'cmdline=$(tr "\\0" " " < /proc/1/cmdline)\n'
    printf 'reason() { printf "%%s\\n" "$1" > /home/review/work/preflight.reason; exit 4; }\n'
    printf 'check() {\n'
    printf '  p=$1\n'
    printf '  if [ -e "$p" ] || [ -L "$p" ]; then printf "%%s\\n" "$p" | tee /home/review/work/preflight.err >&2; exit 3; fi\n'
    printf '  case "$cmdline" in *"$p"*) printf "%%s\\n" "$p" | tee /home/review/work/preflight.err >&2; exit 3 ;; esac\n'
    printf '}\n'
    printf 'check %q\n' "$SEAT_ROOT"
    for p in "${DENY_PATHS[@]}"; do
      printf 'check %q\n' "$p"
    done
    # empty-HOME proof: no credential/config store may exist before the CLI runs
    if [ "$RUNNER" = "kimi" ]; then
      printf '[ -e /home/review/.kimi-code ] && reason "kimi credential store present in preflight seat"\n'
      printf 'v=$(/opt/node/bin/node /opt/node/%q --version 2>/dev/null) || reason "kimi --version failed in the seat"\n' "$RUNNER_NODE_REL"
      printf '[ -n "$v" ] || reason "kimi --version printed nothing"\n'
      printf 'printf "%%s\\n" "$v" > /home/review/work/preflight.version\n'
      printf 'grep -q "^description: ..*" /home/review/agent.md && grep -q "^tools: \\[\\]$" /home/review/agent.md || reason "kimi agent file not intact in the seat"\n'
    else
      printf '[ -e /home/review/.gemini/antigravity-cli/antigravity-oauth-token ] && reason "agy credential present in preflight seat"\n'
      printf 'v=$(/opt/agybin --version 2>/dev/null) || reason "agy --version failed in the seat"\n'
      printf '[ -n "$v" ] || reason "agy --version printed nothing"\n'
      printf 'printf "%%s\\n" "$v" > /home/review/work/preflight.version\n'
      printf 'a=$(/opt/agybin agents 2>/dev/null) || reason "agy agents failed in the seat"\n'
      printf 'case "$a" in *%q*) ;; *) reason "agy agents does not list the tool-less agent" ;; esac\n' "$AGY_AGENT_NAME_FIXED"
    fi
    printf 'exit 0\n'
  } > "$SEAT_ROOT/probe.sh"
  chmod 0400 "$SEAT_ROOT/probe.sh"
}

copy_runner_credentials() {
  local cd="$CRED_DIR" f
  if [ "$RUNNER" = "kimi" ]; then
    cd="${cd:-${HOME:-}/.kimi-code}"
    mkdir -p "$SEAT_ROOT/home/.kimi-code"
    chmod 0700 "$SEAT_ROOT/home/.kimi-code"
    for f in config.toml credentials oauth device_id; do
      if [ -e "$cd/$f" ]; then
        cp -R "$cd/$f" "$SEAT_ROOT/home/.kimi-code/$f"
      fi
    done
    [ -e "$SEAT_ROOT/home/.kimi-code/credentials" ] || [ -e "$SEAT_ROOT/home/.kimi-code/oauth" ] \
      || runner_fail "no kimi credential under $cd"
    chmod -R go-rwx "$SEAT_ROOT/home/.kimi-code"
  else
    cd="${cd:-${HOME:-}/.gemini/antigravity-cli}"
    for f in antigravity-oauth-token installation_id settings.json; do
      if [ -f "$cd/$f" ]; then
        cp "$cd/$f" "$SEAT_ROOT/home/.gemini/antigravity-cli/$f"
        chmod 0600 "$SEAT_ROOT/home/.gemini/antigravity-cli/$f"
      fi
    done
    [ -f "$SEAT_ROOT/home/.gemini/antigravity-cli/antigravity-oauth-token" ] \
      || runner_fail "no agy credential under $cd"
  fi
}

run_runner_bwrap() {
  local rc
  (
    close_inherited_fds
    if [ "$PREFLIGHT" -eq 1 ]; then
      timeout "$TIMEOUT" "$BWRAP_BIN" --args 9 -- /bin/sh /home/review/probe.sh \
        9< "$SEAT_ROOT/bwrap.args"
    elif [ "$RUNNER" = "kimi" ]; then
      timeout "$TIMEOUT" "$BWRAP_BIN" --args 9 -- /bin/sh -c 'p=$(cat /home/review/prompt); exec "$@" -p "$p"' \
        _ /opt/node/bin/node "/opt/node/$RUNNER_NODE_REL" -m "$MODEL" --output-format text \
        --agent-file /home/review/agent.md \
        9< "$SEAT_ROOT/bwrap.args" > "$OUT_FILE" 2> "$ERR_FILE"
    else
      timeout "$TIMEOUT" "$BWRAP_BIN" --args 9 -- /bin/sh -c 'p=$(cat /home/review/prompt); exec "$@" -p "$p"' \
        _ /opt/agybin --model "$MODEL" --effort "$EFFORT" \
        --dangerously-skip-permissions --agent "$AGY_AGENT_NAME_FIXED" \
        --output-format json --print-timeout "$TIMEOUT" \
        9< "$SEAT_ROOT/bwrap.args" > "$OUT_FILE" 2> "$ERR_FILE"
    fi
  )
  rc=$?
  return "$rc"
}

runner_main() {
  local inner_rc=0
  resolve_runner_inputs
  prepare_runner_seat
  if [ "$PREFLIGHT" -eq 1 ]; then
    write_runner_probe
    write_runner_args "$SEAT_ROOT/bwrap.args"
    run_runner_bwrap || inner_rc=$?
    if [ "$inner_rc" -eq 3 ]; then
      [ -s "$SEAT_ROOT/work/preflight.err" ] && cat "$SEAT_ROOT/work/preflight.err" >&2
      emit_json 3
      cleanup_seat
      trap - EXIT INT TERM HUP
      exit 3
    fi
    if [ "$inner_rc" -ne 0 ]; then
      if [ -s "$SEAT_ROOT/work/preflight.reason" ]; then
        cat "$SEAT_ROOT/work/preflight.reason" >&2
      fi
      printf 'bwrap cannot start or runner probe failed (rc=%s)\n' "$inner_rc" >&2
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
  copy_runner_credentials
  cp "$PROMPT_FILE" "$SEAT_ROOT/prompt"
  chmod 0400 "$SEAT_ROOT/prompt"
  : > "$OUT_FILE"
  : > "$ERR_FILE"
  write_runner_args "$SEAT_ROOT/bwrap.args"
  run_runner_bwrap || inner_rc=$?
  emit_json "$inner_rc"
  cleanup_seat
  trap - EXIT INT TERM HUP
  exit "$inner_rc"
}

if [ -n "$RUNNER" ]; then
  runner_main
fi

if [ "$PREFLIGHT" -eq 1 ]; then
  {
    printf '#!/bin/sh\n'
    printf 'cmdline=$(tr "\\0" " " < /proc/1/cmdline)\n'
    printf 'check() {\n'
    printf '  p=$1\n'
    printf '  if [ -e "$p" ] || [ -L "$p" ]; then printf "%%s\\n" "$p" | tee /home/review/work/preflight.err >&2; exit 3; fi\n'
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
