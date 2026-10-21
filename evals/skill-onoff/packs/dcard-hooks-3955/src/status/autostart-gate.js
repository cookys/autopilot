'use strict';

// Is the runs-watcher autostart switched off? One definition for session-mode `set` and hooks/runs-watch-autostart.js.
//   AUTOPILOT_RUNS_WATCH_AUTOSTART = 0 | false | off | no (any case)  -> disabled
//   unset, inside a `node --test` process tree (NODE_TEST_CONTEXT is set by the runner and inherited by children) -> disabled,
//     so a JS test that calls `session-mode.js set` without the variable can no longer start a real watcher (BL-0109)
//   anything else (1, the empty string, ...) -> enabled; the empty string is how a test says "drive it for real"
function autostartDisabled(env = process.env) {
  const v = env.AUTOPILOT_RUNS_WATCH_AUTOSTART;
  if (v === undefined) return Boolean(env.NODE_TEST_CONTEXT);
  return ['0', 'false', 'off', 'no'].includes(String(v).trim().toLowerCase());
}

module.exports = { autostartDisabled };
