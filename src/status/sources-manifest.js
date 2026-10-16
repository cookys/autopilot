'use strict';

// src/status/sources-manifest.js — `autopilot.sources/1`: for every source the band reads, whether its WRITER is installed
// and enabled (mods P1W W1i, second half). Derived from the plugin's own files, never hard-coded:
//   hook sources    installed = hooks/hooks.json names the hook file; enabled = its knob is not off
//   script sources  installed = the script exists (and, where the writer lives inside another file, that file names it)
//   enabled         judged from the writer's REAL off switch, never a spelling the writer ignores:
//                     session-tasks / awaiting-owner   env knob only (`off|false|0|no`, case-insensitive; hooks/live-session-lib.js knobOff)
//                     task-status input                env AUTOPILOT_TASK_STATUS_INPUT exactly `0` (the engine's own test)
//                     context live write               hooks/context-budget.js: context_budget.mode off, or live_write off, from
//                                                      config.json or env (scripts/lib/config-path.js readContextBudget)
//                   A `{"<ENV_NAME>": "off"}` or `{"hooks": {"<stem>": false}}` entry in config.json turns none of these writers off,
//                   so it must not make the band say 關. A source with no knob is enabled when installed.
// `installed:false` means no writer exists in this checkout (the renderer then says 來源未接); `installed && enabled`
// with no data means "wired, currently empty" (the original empty-state text).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { configPath, readContextBudget } = require('../../scripts/lib/config-path');

const OFF = new Set(['off', 'false', '0', 'no']);

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_error) { return null; } }
function exists(file) { try { return fs.statSync(file).isFile(); } catch (_error) { return false; } }

// env-only off switch of the live-session hooks (same set as hooks/live-session-lib.js knobOff).
function knobIsOff(name, env) {
  return !!(name && env && typeof env[name] === 'string' && OFF.has(env[name].trim().toLowerCase()));
}

function buildSourcesManifest({ pluginRoot, env = process.env, autopilotHome, scope }) {
  const hooksText = readText(path.join(pluginRoot, 'hooks', 'hooks.json')) || '';
  // BL-0186: $AUTOPILOT_CONFIG_FILE (in the passed env) names the operator config; else autopilotHome/config.json.
  const configFile = env && env.AUTOPILOT_CONFIG_FILE ? configPath({ env }) : (autopilotHome ? path.join(autopilotHome, 'config.json') : null);
  const hookInstalled = (file) => hooksText.includes(`/hooks/${file}`) && exists(path.join(pluginRoot, 'hooks', file));
  // A hook module's work can run inside ANOTHER hook process (mods P1W PERF: audit-log.js and advisory-relay.js host
  // awaiting-owner's handlers). The hosts are derived from the code: every hooks/*.js that `require('./<file>')`s it.
  const hostsOf = (file) => {
    let names = [];
    try { names = fs.readdirSync(path.join(pluginRoot, 'hooks')); } catch (_error) { return []; }
    // `require('./awaiting-owner')` and `require('./awaiting-owner.js')`, either quote style; comments never count.
    const stem = file.replace(/\.js$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const needle = new RegExp(`require\\(\\s*(['"])\\./${stem}(?:\\.js)?\\1\\s*\\)`);
    const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return names.filter((n) => n.endsWith('.js') && !n.endsWith('.test.js') && n !== file && needle.test(code(readText(path.join(pluginRoot, 'hooks', n)) || '')));
  };
  // installed = hooks.json wires the module itself OR a process that hosts it
  const hookRuns = (file) => hookInstalled(file) || hostsOf(file).some((h) => hookInstalled(h));
  const fileHas = (rel, needle) => (readText(path.join(pluginRoot, rel)) || '').includes(needle);
  const out = {};

  const hookSource = (name, file, knob, stem, extra) => {
    const installed = hookRuns(file) && exists(path.join(pluginRoot, 'hooks', file));
    out[name] = { installed, enabled: installed && !knobIsOff(knob, env), how: `hook hooks/${file} (knob ${knob})${extra || ''}` };
  };
  hookSource('tasks', 'session-tasks.js', 'AUTOPILOT_SESSION_TASKS', 'session-tasks', '');
  hookSource('attention', 'awaiting-owner.js', 'AUTOPILOT_AWAITING_OWNER', 'awaiting-owner', '');
  // the session-turn file is written by the same hook module, behind the same knob (mods P1W TURN)
  hookSource('turn', 'awaiting-owner.js', 'AUTOPILOT_AWAITING_OWNER', 'awaiting-owner', '');

  const decisionInstalled = exists(path.join(pluginRoot, 'scripts', 'open-decision.js'));
  out.decision = { installed: decisionInstalled, enabled: decisionInstalled, how: 'script scripts/open-decision.js open|close --id|show (depth-0 adds one entry per open owner question)' };

  const engineLedger = exists(path.join(pluginRoot, 'scripts', 'decision-ledger.js')) && fileHas('src/engine/autopilot-engine.js', 'decision-ledger.js');
  out.ledger_engine = { installed: engineLedger, enabled: engineLedger, how: 'engine adjudication appends decision rows through scripts/decision-ledger.js' };

  const pickInstalled = exists(path.join(pluginRoot, 'scripts', 'decision-ledger.js')) && fileHas('scripts/next-pick.js', 'AUTOPILOT_ROOT_RUN_ID');
  out.ledger_depth0 = { installed: pickInstalled, enabled: pickInstalled, how: 'scripts/next-pick.js auto-pick appends to the default ledger when a marker or AUTOPILOT_ROOT_RUN_ID exists' };

  const stageInstalled = exists(path.join(pluginRoot, 'scripts', 'stage-advance.js'));
  out.stage = { installed: stageInstalled, enabled: stageInstalled, how: 'scripts/stage-advance.js --to <node> writes marker stage / unit / review_families' };

  out.compare = { installed: false, enabled: false, how: 'writer is a guidance row' };

  const tsInstalled = exists(path.join(pluginRoot, 'src', 'status', 'task-status-input.js')) && exists(path.join(pluginRoot, 'scripts', 'write-task-status-input.js'));
  out.task_status_input = { installed: tsInstalled, enabled: tsInstalled && !(env && env.AUTOPILOT_TASK_STATUS_INPUT === '0'), how: 'engine writes the task-status input at managed-campaign terminals (knob AUTOPILOT_TASK_STATUS_INPUT=0)' };

  const ctxInstalled = hookRuns('context-budget.js') && exists(path.join(pluginRoot, 'hooks', 'context-budget.js'));
  // The hook's own parse (mode off or live_write off, config + env), pointed at the config file this manifest reads.
  let ctxLiveOff = false;
  try {
    const cb = readContextBudget({ env: { ...env, AUTOPILOT_CONFIG_FILE: configFile || os.devNull } });
    ctxLiveOff = cb.mode === 'off' || cb.liveWrite === false;
  } catch (_error) { /* unreadable: the hook would use defaults, i.e. on */ }
  out.context = { installed: ctxInstalled, enabled: ctxInstalled && !ctxLiveOff, how: 'hook hooks/context-budget.js live write (knob AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE, or context_budget.mode off)' };

  const progInstalled = exists(path.join(pluginRoot, 'src', 'status', 'work-order-progress.js'));
  out.progress = { installed: progInstalled, enabled: progInstalled, how: 'campaign controller progress receipts under <git-common-dir>/autopilot/work-orders/<root>/ (read by work-order-progress.js)' };

  return {
    schema: 'autopilot.sources/1',
    scope: { project_key: (scope && scope.project_key) || null, root_run_id: (scope && scope.root_run_id) || null },
    sources: out,
  };
}

module.exports = { buildSourcesManifest, knobIsOff };
