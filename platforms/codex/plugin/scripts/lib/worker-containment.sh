#!/usr/bin/env bash
# worker-containment.sh — shared best-effort worker teardown for dispatch-hetero.sh
# and dispatch-foreman.sh. NOT a malicious-worker boundary: a same-user worker can
# start a sibling systemd scope outside this one. `contained` / a verified cgroup
# is teardown hygiene only.
#
# worker_containment_detect — sets HAVE_CGROUP=1 when `systemd-run --user --scope`
# can start a transient scope. WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 forces
# HAVE_CGROUP=0 so the setsid fallback can be tested without removing systemd.
#
# reap_container — reaps SCOPE_UNIT (systemctl --user kill SIGKILL, stop, verify
# the cgroup is empty → CONTAINED=1) or, when no scope is set, the WORKER_SID
# session. Callers keep the name reap_container (dispatch-hetero.sh exports it
# with declare -f). The session branch calls _self_pgid, defined here when the
# caller has not defined it yet (dispatch-hetero.sh replaces it after sourcing).
# Header comment is the contract.

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
