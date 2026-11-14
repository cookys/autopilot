#!/usr/bin/env bash
# worker-containment.sh — shared worker containment for dispatch-hetero.sh,
# dispatch-foreman.sh and dispatch-author.sh (codex transport).
#
# Two independent layers:
#
# 1. TEARDOWN HYGIENE (best-effort, NOT a malicious-worker boundary): a same-user
#    worker can start a sibling systemd scope outside this one. `contained` / a
#    verified cgroup is teardown hygiene only.
#
#    worker_containment_detect — sets HAVE_CGROUP=1 when `systemd-run --user --scope`
#    can start a transient scope. WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 forces
#    HAVE_CGROUP=0 so the setsid fallback can be tested without removing systemd.
#
#    reap_container — reaps SCOPE_UNIT (systemctl --user kill SIGKILL, stop, verify
#    the cgroup is empty → CONTAINED=1) or, when no scope is set, the WORKER_SID
#    session. Callers keep the name reap_container (dispatch-hetero.sh exports it
#    with declare -f). The session branch calls _self_pgid, defined here when the
#    caller has not defined it yet (dispatch-hetero.sh replaces it after sourcing).
#
# 2. MOUNT ISOLATION (01M7E4JC; cuda lost /sys/fs/cgroup when a lane ran
#    `mount --rbind /sys` then `umount -l` in the HOST mount namespace; /sys is a
#    shared mount, so the unmount propagated to the host):
#
#    worker_mount_isolation_detect — sets WORKER_MOUNT_MODE, WORKER_MOUNT_REASON and
#    the argv prefix array WORKER_MOUNT_PREFIX (empty unless private_ns):
#      private_ns  the worker is started inside a NEW mount namespace with every
#                  mount made private (`unshare --user --map-current-user --mount
#                  --propagation private --`; plain `unshare -m ...` when euid is 0).
#                  Its mounts/unmounts never propagate to the host. File ownership
#                  and the filesystem view are otherwise unchanged
#                  (--map-current-user maps the same uid). Probed once with `true`.
#      no_root     private ns unavailable, but the worker cannot change the host
#                  mount table: euid != 0 AND `sudo -n true` fails (never prompts)
#                  AND CapEff has no CAP_SYS_ADMIN (bit 21 of /proc/self/status).
#                  A same-user worker in this mode cannot mount at all, so there is
#                  nothing to propagate. It does NOT isolate a worker that finds
#                  some other privilege escalation path.
#      refuse      neither. worker_mount_isolation_require prints
#                  `mount_containment_unavailable: <reason> (01M7E4JC) — fix: ...`
#                  to stderr and returns 1; every rail then exits non-zero BEFORE
#                  spawning the worker. Manifests record
#                  mount_containment: private_ns|no_root|refused.
#    PM ruling A (layered): no_root is ACCEPTED. The single switch is the variable
#    WORKER_MOUNT_NO_ROOT_OK just below (default 1; export 0 to turn no_root into
#    refuse). Tests only: WORKER_MOUNT_FORCE_MODE=private_ns|no_root|refuse skips
#    detection; WORKER_MOUNT_PROC_STATUS=<file> replaces /proc/self/status.
#
#    Composition with the scope/session wrapper: the scope (systemd-run) or session
#    leader stays OUTSIDE and unshare runs INSIDE it, i.e.
#    `systemd-run --scope -- env ... unshare ... -- <worker>`, so cgroup reaping
#    still sees the whole subtree. Callers splice "${WORKER_MOUNT_PREFIX[@]}" in
#    front of the worker argv; the prefix uses the absolute unshare path so it
#    survives `env -i`.
#
#    Not covered: root or passwordless sudo on a host with no usable private ns is
#    refused, never run unisolated.
# Header comment is the contract.

: "${WORKER_MOUNT_NO_ROOT_OK:=1}"   # PM ruling A: accept no_root. Flip here (or export 0) to refuse it.

if ! declare -F _self_pgid >/dev/null 2>&1; then
  _self_pgid() {
    ps -o pgid= -p $$ 2>/dev/null | tr -d ' '
  }
fi

worker_containment_detect() {
  HAVE_CGROUP=0
  if [ "${WORKER_CONTAINMENT_FORCE_NO_CGROUP:-}" = "1" ]; then
    return 0
  fi
  if command -v systemd-run >/dev/null 2>&1 \
     && systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
    HAVE_CGROUP=1
  fi
}

# _worker_mount_has_sys_admin — 0 when CapEff carries CAP_SYS_ADMIN (bit 21).
_worker_mount_has_sys_admin() {
  local status="${WORKER_MOUNT_PROC_STATUS:-/proc/self/status}" cap
  cap="$(sed -n 's/^CapEff:[[:space:]]*//p' "$status" 2>/dev/null | head -n1)"
  [ -n "$cap" ] || return 1
  [ $(( (0x$cap >> 21) & 1 )) -eq 1 ]
}

WORKER_MOUNT_MODE=""; WORKER_MOUNT_REASON=""; WORKER_MOUNT_PREFIX=(); WORKER_MOUNT_REFUSE_LINE=""

worker_mount_isolation_detect() {
  WORKER_MOUNT_MODE=""; WORKER_MOUNT_REASON=""; WORKER_MOUNT_PREFIX=()
  local uid unshare_bin="" forced="${WORKER_MOUNT_FORCE_MODE:-}"
  uid="$(id -u)"
  unshare_bin="$(command -v unshare 2>/dev/null || true)"
  local -a ns_prefix=()
  if [ "$uid" -eq 0 ]; then
    ns_prefix=("${unshare_bin:-unshare}" -m --propagation private --)
  else
    ns_prefix=("${unshare_bin:-unshare}" --user --map-current-user --mount --propagation private --)
  fi
  case "$forced" in
    private_ns) WORKER_MOUNT_MODE="private_ns"; WORKER_MOUNT_PREFIX=("${ns_prefix[@]}"); return 0 ;;
    no_root)    WORKER_MOUNT_MODE="no_root"; WORKER_MOUNT_REASON="forced"; return 0 ;;
    refuse)     WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="forced by WORKER_MOUNT_FORCE_MODE"; return 0 ;;
  esac
  if [ -n "$unshare_bin" ] && "${ns_prefix[@]}" true >/dev/null 2>&1; then
    WORKER_MOUNT_MODE="private_ns"; WORKER_MOUNT_PREFIX=("${ns_prefix[@]}"); return 0
  fi
  local why="no private mount namespace (unshare unavailable or user namespaces blocked)"
  if [ "$uid" -eq 0 ]; then
    WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="$why and the dispatcher runs as root"; return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="$why and passwordless sudo is available"; return 0
  fi
  if _worker_mount_has_sys_admin; then
    WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="$why and the worker holds CAP_SYS_ADMIN"; return 0
  fi
  if [ "${WORKER_MOUNT_NO_ROOT_OK:-1}" = "1" ]; then
    WORKER_MOUNT_MODE="no_root"; WORKER_MOUNT_REASON="$why; worker has no root, sudo or CAP_SYS_ADMIN"
  else
    WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="$why and no_root is not accepted (WORKER_MOUNT_NO_ROOT_OK=0)"
  fi
}

# worker_mount_isolation_require — detect, then fail closed. Returns 1 after printing
# the exact stderr line when the mode is refuse; the caller must exit before spawning.
worker_mount_isolation_require() {
  worker_mount_isolation_detect
  if [ "$WORKER_MOUNT_MODE" = "refuse" ]; then
    WORKER_MOUNT_REFUSE_LINE="mount_containment_unavailable: ${WORKER_MOUNT_REASON} (01M7E4JC) — fix: run the dispatch inside a private mount namespace created as root then drop privileges, or dispatch from an account without sudo"
    printf '%s\n' "$WORKER_MOUNT_REFUSE_LINE" >&2
    return 1
  fi
  return 0
}

# worker_mount_manifest_value — the manifest token for the detected mode.
worker_mount_manifest_value() {
  case "${WORKER_MOUNT_MODE:-}" in
    private_ns|no_root) printf '%s' "$WORKER_MOUNT_MODE" ;;
    *) printf 'refused' ;;
  esac
}

reap_container() { # reaps the worker container on ANY exit path; sets CONTAINED
  if [ -n "$SCOPE_UNIT" ]; then
    systemctl --user kill "$SCOPE_UNIT" --signal=SIGKILL >/dev/null 2>&1 || true
    systemctl --user stop "$SCOPE_UNIT" >/dev/null 2>&1 || true
    # verify the cgroup is gone/empty — the genuine setsid-proof containment proof
    local i cg
    for i in 1 2 3 4 5 6 7 8 9 10; do
      systemctl --user is-active "$SCOPE_UNIT" >/dev/null 2>&1 || { CONTAINED=1; break; }
      sleep 0.3
    done
    cg="$(systemctl --user show "$SCOPE_UNIT" -p ControlGroup --value 2>/dev/null)"
    if [ -n "$cg" ] && [ -s "/sys/fs/cgroup${cg}/cgroup.procs" ]; then CONTAINED=0; fi
  elif [ -n "$WORKER_SID" ]; then
    # Group/session kill only (negative sid). Never the dispatcher pid or our
    # own pgid — including the detached child's session on IN_DETACHED_CHILD=1.
    local selfpg=""
    if declare -F _self_pgid >/dev/null 2>&1; then
      selfpg="$(_self_pgid)" || selfpg=""
    fi
    if [ "$WORKER_SID" = "$$" ] || { [ -n "$selfpg" ] && [ "$WORKER_SID" = "$selfpg" ]; }; then
      return 0
    fi
    kill -TERM "-$WORKER_SID" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do kill -0 "-$WORKER_SID" 2>/dev/null || break; sleep 0.3; done
    kill -KILL "-$WORKER_SID" 2>/dev/null || true
    sleep 0.2
    kill -0 "-$WORKER_SID" 2>/dev/null || CONTAINED=1   # session empty
  fi
}
