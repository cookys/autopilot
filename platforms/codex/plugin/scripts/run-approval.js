#!/usr/bin/env node
/**
 * run-approval.js — read and persist the one-confirmation-per-run knob.
 *
 * The knob itself lives in ~/.autopilot/config.json under `run_approval.mode`
 * (`off` | `ask-once`) and is enforced by hooks/run-approval-gate.js. This script exists
 * so the round-end "make this the default?" answer is a MERGE into that file rather than
 * a rewrite: the file also carries hook toggles, cost-fuse tiers and context budgets, and
 * an overwrite would silently drop them.
 *
 * MACHINE-LOCAL BY DESIGN: this writes ~/.autopilot/config.json, never `.claude/*.md` or
 * `.claude/owner-kernel-governance.json`. Those are version-controlled: writing a
 * preference back into them would put an unrequested change in the user's next diff and
 * would collide with concurrent sessions on the same repo.
 *
 * SCOPE CEILING: `persist` writes the MODE and nothing else. Red lines, the DOA boundary,
 * and the irreversible-operation carve-outs are never touched — a good run is evidence
 * about that run, not a licence to widen an authority boundary, and the round-end prompt
 * fires exactly when the user is most inclined to say yes. Same asymmetry as `-x`:
 * a run may add red lines, never remove project ones.
 *
 * USAGE:
 *   node scripts/run-approval.js status            # {mode, source, config_path}
 *   node scripts/run-approval.js persist --mode ask-once|off
 *
 *   node scripts/run-approval.js claude-native-status    # exit 0 + JSON when confirmed, exit 1 when not
 *   node scripts/run-approval.js confirm-claude-native   # depth 0 runs this AFTER the owner says yes
 *
 * CLAUDE-NATIVE IMPLEMENTER GATE: `dispatch-hetero.sh --runner claude-native` refuses (exit 2,
 * precondition_failed) unless config.json holds implementer_claude_native.confirmed_at. This is a
 * machine-local, one-time owner confirmation; there is deliberately NO flag or env on the dispatch
 * command line that grants it, so a model cannot confirm on the owner's behalf in the same command.
 *
 * Exit codes: 0 ok; 1 not confirmed (claude-native-status only); 2 usage error. Every subcommand
 * prints one JSON object to stdout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { configPath } = require('./lib/config-path.js');

const VALID_MODES = new Set(['off', 'ask-once']);
const DEFAULT_MODE = 'off';

function readConfig(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch { /* absent/corrupt ⇒ treat as empty, never throw away on read */ }
  return null;
}

function resolveMode() {
  const file = configPath();
  const cfg = readConfig(file);
  let mode = DEFAULT_MODE;
  let source = 'default';
  if (cfg && cfg.run_approval && typeof cfg.run_approval.mode === 'string'
      && VALID_MODES.has(cfg.run_approval.mode)) {
    mode = cfg.run_approval.mode;
    source = 'config';
  }
  // Same precedence as hooks/run-approval-gate.js: env overrides config, THEN the result is
  // validated. Reporting the config value while the hook is inert on a garbage env would
  // make `status` lie on the user's only visibility surface.
  const env = process.env.AUTOPILOT_RUN_APPROVAL_MODE;
  if (typeof env === 'string' && env) {
    mode = env;
    source = 'env';
  }
  if (!VALID_MODES.has(mode)) {
    mode = DEFAULT_MODE;
    source = source === 'default' ? 'default' : `${source}-invalid`;
  }
  return { mode, source, config_path: file };
}

function fail(msg) {
  process.stderr.write(`run-approval: ${msg}\n`);
  process.exit(2);
}

function cmdStatus() {
  process.stdout.write(`${JSON.stringify(resolveMode())}\n`);
  process.exit(0);
}

function cmdPersist(args) {
  const mode = args.mode;
  if (!mode) fail('persist requires --mode off|ask-once');
  if (!VALID_MODES.has(mode)) fail(`--mode must be off|ask-once (got: ${mode})`);

  const file = configPath();
  // A corrupt config is NOT silently replaced: overwriting it would destroy hook toggles
  // and spend fuses the user cannot recover. Refuse and name the file instead.
  let existing = readConfig(file);
  if (existing === null && fs.existsSync(file)) {
    fail(`${file} exists but is not a JSON object — fix it by hand, refusing to overwrite`);
  }
  if (existing === null) existing = {};

  const before = existing.run_approval && typeof existing.run_approval === 'object'
    && !Array.isArray(existing.run_approval) ? existing.run_approval : {};
  const next = { ...existing, run_approval: { ...before, mode } };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);

  process.stdout.write(`${JSON.stringify({
    persisted: true,
    mode,
    config_path: file,
    preserved_keys: Object.keys(existing).filter((k) => k !== 'run_approval'),
  })}\n`);
  process.exit(0);
}

// The claude-native owner confirmation lives ONLY in the canonical machine-local config
// (<HOME>/.autopilot/config.json). AUTOPILOT_CONFIG_FILE and any other override are ignored on
// purpose: otherwise a hand-written confirmation file plus an env var would pass the gate.
function cnativeConfigPath() {
  return path.join(require('os').homedir(), '.autopilot', 'config.json');
}

// Strict ISO 8601 date-time (UTC or offset), a real calendar date, not in the future.
function validConfirmedAt(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59) return false;
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return false;
  const tz = m[7];
  if (tz !== 'Z' && (Number(tz.slice(1, 3)) > 23 || Number(tz.slice(4, 6)) > 59)) return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && t <= Date.now();
}

function cnativeConfirmedAt() {
  const cfg = readConfig(cnativeConfigPath());
  const v = cfg && cfg.implementer_claude_native && cfg.implementer_claude_native.confirmed_at;
  return validConfirmedAt(v) ? v : null;
}

function cmdCnativeStatus() {
  const confirmedAt = cnativeConfirmedAt();
  process.stdout.write(`${JSON.stringify({ confirmed: confirmedAt !== null, confirmed_at: confirmedAt, config_path: cnativeConfigPath() })}\n`);
  process.exit(confirmedAt !== null ? 0 : 1);
}

function cmdCnativeConfirm() {
  const file = cnativeConfigPath();
  let existing = readConfig(file);
  if (existing === null && fs.existsSync(file)) {
    fail(`${file} exists but is not a JSON object — fix it by hand, refusing to overwrite`);
  }
  if (existing === null) existing = {};
  const before = existing.implementer_claude_native && typeof existing.implementer_claude_native === 'object'
    && !Array.isArray(existing.implementer_claude_native) ? existing.implementer_claude_native : {};
  const confirmedAt = new Date().toISOString();
  const next = { ...existing, implementer_claude_native: { ...before, confirmed_at: confirmedAt } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  process.stdout.write(`${JSON.stringify({ confirmed: true, confirmed_at: confirmedAt, config_path: file })}\n`);
  process.exit(0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) fail(`${a} requires a value`);
      if (key !== 'mode') fail(`unknown flag --${key} (only --mode is accepted)`);
      out[key] = next;
      i += 1;
    } else {
      fail(`unexpected argument "${a}"`);
    }
  }
  return out;
}

function usage() {
  process.stdout.write(
    'Usage: node scripts/run-approval.js status | persist --mode off|ask-once\n'
    + '  status   Print {mode, source, config_path} for the one-confirm-per-run knob.\n'
    + '  persist  Merge the mode into ~/.autopilot/config.json (other keys preserved).\n'
    + '           Writes the mode ONLY — never red lines, DOA, or irreversible carve-outs.\n'
    + '  claude-native-status   Exit 0 if the owner confirmed the claude-native implementer runner, else 1.\n'
    + '  confirm-claude-native  Record implementer_claude_native.confirmed_at (run only after the owner says yes).\n',
  );
}

(function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }
  const args = parseArgs(rest);
  switch (cmd) {
    case 'status': cmdStatus(); break;
    case 'persist': cmdPersist(args); break;
    case 'claude-native-status': cmdCnativeStatus(); break;
    case 'confirm-claude-native': cmdCnativeConfirm(); break;
    default: fail(`unknown subcommand "${cmd}" (expected status|persist|claude-native-status|confirm-claude-native)`);
  }
})();
