#!/usr/bin/env bash
# worker-containment.sh — shared worker containment for dispatch-hetero.sh,
# dispatch-foreman.sh, dispatch-author.sh.
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
#    the argv prefix array WORKER_MOUNT_PREFIX (empty unless private_ns or
#    sudo_private_ns). Detection order is fixed:
#      private_ns → sudo_private_ns → no_root → refuse.
#      private_ns       the worker is started inside a NEW mount namespace with every
#                       mount made private (`unshare --user --map-current-user --mount
#                       --propagation private --`; plain `unshare -m ...` when euid is 0).
#                       Its mounts/unmounts never propagate to the host. File ownership
#                       and the filesystem view are otherwise unchanged
#                       (--map-current-user maps the same uid). Probed once with `true`.
#      sudo_private_ns  unprivileged user namespaces are blocked, the dispatcher is not
#                       root, `sudo -n true` succeeds, and
#                       `sudo -n unshare --mount --propagation private -- true` succeeds.
#                       Prefix (absolute `command -v` paths, so it survives `env -i`;
#                       `--preserve-env` and fallback `-E` are kept only when
#                       `sudo -n --preserve-env unshare --mount --propagation private -- true`
#                       exits 0 with empty stderr, so hosts whose sudoers policy warns and
#                       ignores `--preserve-env` emit nothing on worker stderr):
#                         sudo -n [--preserve-env] unshare --mount --propagation private --
#                           setpriv --reuid=<uid> --regid=<gid> --init-groups --
#                           <env> -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND
#                             -u SUDO_HOME PATH=<dispatcher PATH> HOME=<dispatcher HOME>
#                             USER=<dispatcher user> LOGNAME=<dispatcher user>
#                       uid/gid are the dispatching account, numeric, taken at detect time.
#                       Standard sudoers still replaces PATH (secure_path), USER/LOGNAME
#                       (set_logname) and sometimes HOME (always_set_home), and adds SUDO_*.
#                       `--preserve-env` does not stop that, and setpriv / `sudo -u` do not
#                       put it back. The absolute `env` step, resolved at detect time, restores
#                       the dispatcher PATH/HOME/USER/LOGNAME captured then and drops those
#                       SUDO_* names. Callers expand WORKER_MOUNT_PREFIX as a bash array
#                       ("${WORKER_MOUNT_PREFIX[@]}", and declare -p across detach), so each
#                       assignment is one argv and a space in PATH or HOME stays intact. A
#                       newline in PATH, HOME or the user cannot be represented that way and
#                       is refused. The probe requires `id -u`, HOME, PATH and USER inside the
#                       prefix to equal the outside values. No new account and no credential
#                       handling. If `setpriv` is missing, or that identity probe fails, the
#                       drop is `sudo -n [-E] -u <user> --` behind the same unshare, with the
#                       same env step after it. If neither drop works, detection falls through
#                       to refuse with the old passwordless-sudo reason. A failed unshare
#                       probe does the same.
#      no_root          private ns unavailable, but the worker cannot change the host
#                       mount table: euid != 0 AND `sudo -n true` fails (never prompts)
#                       AND CapEff has no CAP_SYS_ADMIN (bit 21 of /proc/self/status).
#                       A same-user worker in this mode cannot mount at all, so there is
#                       nothing to propagate. It does NOT isolate a worker that finds
#                       some other privilege escalation path.
#      refuse           neither, including a root dispatcher with no private ns.
#                       worker_mount_isolation_require prints
#                       `mount_containment_unavailable: <reason> (01M7E4JC) — fix: ...`
#                       to stderr and returns 1; every rail then exits non-zero BEFORE
#                       spawning the worker. Manifests record
#                       mount_containment: private_ns|sudo_private_ns|no_root|refused.
#    Interim brief gate (worker_mount_brief_gate): when the mode is not private_ns or
#    sudo_private_ns, a prompt/brief line that contains a command-shaped mount, umount
#    or unshare is refused. The pattern is
#    `(^|[^A-Za-z0-9_-])(u?mount|unshare)([[:space:]]|$)`, so "amount" and "mountpoint"
#    do not match. stderr names the word and the 1-based line number. The gate is off
#    under private_ns and sudo_private_ns. An empty WORKER_MOUNT_MODE is not
#    "unisolated": the gate detects first. dispatch-foreman.sh also gates the
#    run-dir brief and plan on --resume.
#    PM ruling A (layered): no_root is ACCEPTED. The single switch is the variable
#    WORKER_MOUNT_NO_ROOT_OK just below (default 1; export 0 to turn no_root into
#    refuse). Tests only: WORKER_MOUNT_FORCE_MODE=private_ns|sudo_private_ns|no_root|refuse
#    skips detection (sudo_private_ns sets the mode and an empty prefix);
#    WORKER_MOUNT_PROC_STATUS=<file> replaces /proc/self/status.
#
#    Composition with the scope/session wrapper: the scope (systemd-run) or session
#    leader stays OUTSIDE and unshare runs INSIDE it, i.e.
#    `systemd-run --scope -- env ... unshare ... -- <worker>`, so cgroup reaping
#    still sees the whole subtree. Callers splice "${WORKER_MOUNT_PREFIX[@]}" in
#    front of the worker argv; the prefix uses the absolute unshare path so it
#    survives `env -i`.
#
#    Not covered: a root dispatcher with no usable private ns is refused, never run
#    unisolated. Passwordless sudo with a working unshare probe runs as sudo_private_ns.
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

# _worker_mount_prefix_holds_identity <uid> <home> <path> <user> <prefix...>
# 0 when id -u, HOME, PATH and USER inside the prefix equal the dispatcher's.
# Values must not contain a newline; the caller refuses those before probing.
_worker_mount_prefix_holds_identity() {
  local want_uid="$1" want_home="$2" want_path="$3" want_user="$4"
  local out got_uid got_home got_path got_user rest
  shift 4
  # Trailing x keeps an empty value and a final newline that command substitution would eat.
  out="$("$@" bash -c 'printf "%s\n%s\n%s\n%s\n" "$(id -u)" "${HOME-}x" "${PATH-}x" "${USER-}x"' 2>/dev/null)" || return 1
  got_uid="${out%%$'\n'*}"
  rest="${out#*$'\n'}"
  got_home="${rest%%$'\n'*}"
  rest="${rest#*$'\n'}"
  got_path="${rest%%$'\n'*}"
  rest="${rest#*$'\n'}"
  got_user="${rest%%$'\n'*}"
  got_home="${got_home%x}"
  got_path="${got_path%x}"
  got_user="${got_user%x}"
  [ -n "$got_uid" ] && [ "$got_uid" = "$want_uid" ] && [ "$got_home" = "$want_home" ] \
    && [ "$got_path" = "$want_path" ] && [ "$got_user" = "$want_user" ]
}

# _worker_mount_append_dispatcher_env <array-name> <path> <home> <user>
# Append the absolute env step that undoes sudo's secure_path / set_logname /
# always_set_home and the SUDO_* names. 1 when `env` is missing, the user is
# empty, or a value contains a newline (one argv cannot carry it through the
# probe's line split, so the caller refuses).
_worker_mount_append_dispatcher_env() {
  local -n _p="$1"
  local disp_path="$2" disp_home="$3" disp_user="$4" env_bin
  case "$disp_path" in *$'\n'*) return 1 ;; esac
  case "$disp_home" in *$'\n'*) return 1 ;; esac
  case "$disp_user" in *$'\n'*) return 1 ;; esac
  [ -n "$disp_user" ] || return 1
  env_bin="$(command -v env 2>/dev/null || true)"
  [ -n "$env_bin" ] || return 1
  _p+=("$env_bin"
    -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND -u SUDO_HOME
    "PATH=$disp_path" "HOME=$disp_home" "USER=$disp_user" "LOGNAME=$disp_user")
}

# _worker_mount_try_sudo_private_ns — 0 and sets MODE/PREFIX when the sudo unshare
# probe and one identity-preserving drop both work. Caller already knows euid != 0
# and `sudo -n true` succeeded. A failure leaves mode unset so the caller refuses.
_worker_mount_try_sudo_private_ns() {
  local sudo_bin unshare_bin setpriv_bin uid gid user home disp_path disp_user
  local probe_err="" preserve_rc=0
  local -a prefix=() sudo_preserve=() sudo_drop_preserve=()
  uid="$(id -u 2>/dev/null || true)"
  gid="$(id -g 2>/dev/null || true)"
  user="$(id -un 2>/dev/null || true)"
  home="${HOME-}"
  disp_path="${PATH-}"
  disp_user="${USER-}"
  [ -n "$disp_user" ] || disp_user="$user"
  case "$uid" in ''|*[!0-9]*) return 1 ;; esac
  case "$gid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$uid" -eq 0 ] && return 1
  sudo_bin="$(command -v sudo 2>/dev/null || true)"
  unshare_bin="$(command -v unshare 2>/dev/null || true)"
  [ -n "$sudo_bin" ] && [ -n "$unshare_bin" ] || return 1
  if ! "$sudo_bin" -n "$unshare_bin" --mount --propagation private -- true >/dev/null 2>&1; then
    return 1
  fi
  probe_err="$("$sudo_bin" -n --preserve-env "$unshare_bin" --mount --propagation private -- true 2>&1 >/dev/null)" || preserve_rc=$?
  if [ "$preserve_rc" -eq 0 ] && [ -z "$probe_err" ]; then
    sudo_preserve=(--preserve-env)
    sudo_drop_preserve=(-E)
  fi
  setpriv_bin="$(command -v setpriv 2>/dev/null || true)"
  if [ -n "$setpriv_bin" ]; then
    prefix=("$sudo_bin" -n ${sudo_preserve[@]+"${sudo_preserve[@]}"} "$unshare_bin" --mount --propagation private -- "$setpriv_bin" --reuid="$uid" --regid="$gid" --init-groups --)
    _worker_mount_append_dispatcher_env prefix "$disp_path" "$home" "$disp_user" || return 1
    if _worker_mount_prefix_holds_identity "$uid" "$home" "$disp_path" "$disp_user" "${prefix[@]}"; then
      WORKER_MOUNT_MODE="sudo_private_ns"
      WORKER_MOUNT_REASON=""
      WORKER_MOUNT_PREFIX=("${prefix[@]}")
      return 0
    fi
  fi
  [ -n "$user" ] || return 1
  if [ "${#sudo_drop_preserve[@]}" -gt 0 ]; then
    local drop_err="" drop_rc=0
    drop_err="$("$sudo_bin" -n "${sudo_preserve[@]}" "$unshare_bin" --mount --propagation private -- "$sudo_bin" -n -E -u "$user" -- true 2>&1 >/dev/null)" || drop_rc=$?
    if [ "$drop_rc" -ne 0 ] || [ -n "$drop_err" ]; then
      sudo_drop_preserve=()
    fi
  fi
  prefix=("$sudo_bin" -n ${sudo_preserve[@]+"${sudo_preserve[@]}"} "$unshare_bin" --mount --propagation private -- "$sudo_bin" -n ${sudo_drop_preserve[@]+"${sudo_drop_preserve[@]}"} -u "$user" --)
  _worker_mount_append_dispatcher_env prefix "$disp_path" "$home" "$disp_user" || return 1
  if _worker_mount_prefix_holds_identity "$uid" "$home" "$disp_path" "$disp_user" "${prefix[@]}"; then
    WORKER_MOUNT_MODE="sudo_private_ns"
    WORKER_MOUNT_REASON=""
    WORKER_MOUNT_PREFIX=("${prefix[@]}")
    return 0
  fi
  return 1
}

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
    private_ns)      WORKER_MOUNT_MODE="private_ns"; WORKER_MOUNT_PREFIX=("${ns_prefix[@]}"); return 0 ;;
    sudo_private_ns) WORKER_MOUNT_MODE="sudo_private_ns"; WORKER_MOUNT_REASON="forced"; WORKER_MOUNT_PREFIX=(); return 0 ;;
    no_root)         WORKER_MOUNT_MODE="no_root"; WORKER_MOUNT_REASON="forced"; return 0 ;;
    refuse)          WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="forced by WORKER_MOUNT_FORCE_MODE"; return 0 ;;
  esac
  if [ -n "$unshare_bin" ] && "${ns_prefix[@]}" true >/dev/null 2>&1; then
    WORKER_MOUNT_MODE="private_ns"; WORKER_MOUNT_PREFIX=("${ns_prefix[@]}"); return 0
  fi
  local why="no private mount namespace (unshare unavailable or user namespaces blocked)"
  # Root never takes sudo_private_ns: a root dispatcher with no private ns stays refuse.
  if [ "$uid" -eq 0 ]; then
    WORKER_MOUNT_MODE="refuse"; WORKER_MOUNT_REASON="$why and the dispatcher runs as root"; return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    if _worker_mount_try_sudo_private_ns; then
      return 0
    fi
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
    private_ns|sudo_private_ns|no_root) printf '%s' "$WORKER_MOUNT_MODE" ;;
    *) printf 'refused' ;;
  esac
}

# worker_mount_brief_gate <file> — interim (01M7F2KZ). Returns 0 immediately when the
# mode is private_ns or sudo_private_ns. Otherwise scans <file> for a command-shaped
# mount, umount or unshare and, on a hit, prints one stderr line naming the word and
# the 1-based line number, sets WORKER_MOUNT_REFUSE_LINE, and returns 1. A missing
# file is not a hit (the caller's own existence check reports that). An empty mode
# has not been detected: detect before treating it as unisolated.
worker_mount_brief_gate() {
  local file="${1:-}" line n=0 word
  [ -n "${WORKER_MOUNT_MODE:-}" ] || worker_mount_isolation_detect
  case "${WORKER_MOUNT_MODE:-}" in
    private_ns|sudo_private_ns) return 0 ;;
  esac
  [ -n "$file" ] && [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    if [[ "$line" =~ (^|[^A-Za-z0-9_-])(u?mount|unshare)([[:space:]]|$) ]]; then
      word="${BASH_REMATCH[2]}"
      WORKER_MOUNT_REFUSE_LINE="mount_brief_refused: ${word} at line ${n} (01M7E4JC)"
      printf '%s\n' "$WORKER_MOUNT_REFUSE_LINE" >&2
      return 1
    fi
  done < "$file"
  return 0
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
