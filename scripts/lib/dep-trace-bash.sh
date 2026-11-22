# BASH_ENV preload: send xtrace to a private append-only trace, never stderr.
if [[ -n ${AUTOPILOT_DEP_TRACE_FILE:-} ]]; then
  if { exec {__autopilot_trace_fd}>>"${AUTOPILOT_DEP_TRACE_FILE}.bash"; } 2>/dev/null; then
    BASH_XTRACEFD=$__autopilot_trace_fd
    PS4='+DEPTRACE|${BASH_SOURCE[0]}|'
    set -x
  fi
fi
:
