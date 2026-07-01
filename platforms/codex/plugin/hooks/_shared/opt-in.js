'use strict';
/**
 * opt-in.js — single runtime gate for autopilot's opt-in hooks.
 *
 * Why this exists: ${CLAUDE_PLUGIN_ROOT} expands ONLY inside the plugin's own
 * hooks.json, never in a user's settings.json. So an opt-in hook that references a
 * bundled script CANNOT be enabled by the old "copy the entry into settings.json"
 * route (the path stays literal). The fix is to wire every opt-in hook in hooks.json
 * (token resolves + auto-tracks the install path on update) and have it SELF-GATE
 * here: default-off, so wiring it for everyone does not change anyone's behaviour
 * until they opt in.
 *
 * Enable a hook by either:
 *   - ~/.autopilot/config.json  →  {"hooks": {"<stem>": true}}
 *   - env  AUTOPILOT_HOOK_<STEM_UPPER>  (e.g. AUTOPILOT_HOOK_BRANCH_PROTECTION=1)
 *
 * FAIL-SAFE: any error (missing/corrupt config, fs failure) → returns false. A
 * disabled hook MUST be inert — for a PreToolUse hook a false here means it exits
 * without ever emitting a block decision, so the gate can never wedge a tool call.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Affirmative iff a clearly-on value. Accepts boolean true, number 1, and the
// string forms "true"/"1"/"yes"/"on" (case/space-insensitive) so a user who writes
// {"branch-protection": "true"} in JSON (a reasonable mistake) isn't silently left
// disabled. Anything else — false, "false", 0, "", garbage, absent — stays OFF, so
// the fail-safe (a gated-off PreToolUse hook never blocks) is preserved.
function isAffirmative(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  }
  return false;
}

function envFlag(name) {
  const key = 'AUTOPILOT_HOOK_' + String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return isAffirmative(process.env[key]);
}

function configFlag(name) {
  try {
    const configFile = path.join(os.homedir(), '.autopilot', 'config.json');
    if (!fs.existsSync(configFile)) return false;
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return !!(cfg && cfg.hooks && isAffirmative(cfg.hooks[name]));
  } catch {
    return false;
  }
}

function isEnabled(name) {
  try {
    return envFlag(name) || configFlag(name);
  } catch {
    return false;
  }
}

module.exports = { isEnabled };
