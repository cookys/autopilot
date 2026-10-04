'use strict';

// src/status/sources-manifest.js — `autopilot.sources/1`: for every source the band reads, whether its WRITER is installed
// and enabled (mods P1W W1i, second half). Derived from the plugin's own files, never hard-coded:
//   hook sources    installed = hooks/hooks.json names the hook file; enabled = its knob is not off
//   script sources  installed = the script exists (and, where the writer lives inside another file, that file names it)
//   enabled         env knob (`off|false|0|no`, case-insensitive) and ~/.autopilot/config.json: either `{"<ENV_NAME>": "off"|false|0}`
//                   or `{"hooks": {"<stem>": false}}` turn a source off. A source with no knob is enabled when installed.
// `installed:false` means no writer exists in this checkout (the renderer then says 來源未接); `installed && enabled`
// with no data means "wired, currently empty" (the original empty-state text).

const fs = require('fs');
const path = require('path');

const OFF = new Set(['off', 'false', '0', 'no']);

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_error) { return null; } }
function exists(file) { try { return fs.statSync(file).isFile(); } catch (_error) { return false; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } }

function knobIsOff(name, stem, env, config) {
  if (name && typeof env[name] === 'string' && OFF.has(env[name].trim().toLowerCase())) return true;
  if (config && typeof config === 'object') {
    if (name && Object.prototype.hasOwnProperty.call(config, name)) {
      const v = config[name];
      if (v === false || v === 0 || (typeof v === 'string' && OFF.has(v.trim().toLowerCase()))) return true;
    }
    if (stem && config.hooks && typeof config.hooks === 'object' && config.hooks[stem] === false) return true;
  }
  return false;
}

function buildSourcesManifest({ pluginRoot, env = process.env, autopilotHome, scope }) {
  const hooksText = readText(path.join(pluginRoot, 'hooks', 'hooks.json')) || '';
  const config = autopilotHome ? readJson(path.join(autopilotHome, 'config.json')) : null;
  const hookInstalled = (file) => hooksText.includes(`/hooks/${file}`) && exists(path.join(pluginRoot, 'hooks', file));
  // A hook module's work can run inside ANOTHER hook process (mods P1W PERF: audit-log.js and advisory-relay.js host
  // awaiting-owner's handlers). The hosts are derived from the code: every hooks/*.js that `require('./<file>')`s it.
  const hostsOf = (file) => {
    let names = [];
    try { names = fs.readdirSync(path.join(pluginRoot, 'hooks')); } catch (_error) { return []; }
    const needle = new RegExp(`require\\(\\s*['"]\\./${file.replace(/\./g, '\\.')}['"]\\s*\\)`);
    return names.filter((n) => n.endsWith('.js') && !n.endsWith('.test.js') && n !== file && needle.test(readText(path.join(pluginRoot, 'hooks', n)) || ''));
  };
  // installed = hooks.json wires the module itself OR a process that hosts it
  const hookRuns = (file) => hookInstalled(file) || hostsOf(file).some((h) => hookInstalled(h));
  const fileHas = (rel, needle) => (readText(path.join(pluginRoot, rel)) || '').includes(needle);
  const out = {};

  const hookSource = (name, file, knob, stem, extra) => {
    const installed = hookRuns(file) && exists(path.join(pluginRoot, 'hooks', file));
    out[name] = { installed, enabled: installed && !knobIsOff(knob, stem, env, config), how: `hook hooks/${file} (knob ${knob})${extra || ''}` };
  };
  hookSource('tasks', 'session-tasks.js', 'AUTOPILOT_SESSION_TASKS', 'session-tasks', '');
  hookSource('attention', 'awaiting-owner.js', 'AUTOPILOT_AWAITING_OWNER', 'awaiting-owner', '');

  const decisionInstalled = exists(path.join(pluginRoot, 'scripts', 'open-decision.js'));
  out.decision = { installed: decisionInstalled, enabled: decisionInstalled, how: 'script scripts/open-decision.js open|close|show (depth-0 writes it at a DOA question)' };

  const engineLedger = exists(path.join(pluginRoot, 'scripts', 'decision-ledger.js')) && fileHas('src/engine/autopilot-engine.js', 'decision-ledger.js');
  out.ledger_engine = { installed: engineLedger, enabled: engineLedger, how: 'engine adjudication appends decision rows through scripts/decision-ledger.js' };

  const pickInstalled = exists(path.join(pluginRoot, 'scripts', 'decision-ledger.js')) && fileHas('scripts/next-pick.js', 'AUTOPILOT_ROOT_RUN_ID');
  out.ledger_depth0 = { installed: pickInstalled, enabled: pickInstalled, how: 'scripts/next-pick.js auto-pick appends to the default ledger when a marker or AUTOPILOT_ROOT_RUN_ID exists' };

  const phaseInstalled = fileHas('scripts/session-mode.js', 'phase_set_at');
  out.phase = { installed: phaseInstalled, enabled: phaseInstalled, how: 'session-mode.js set --phase <name> writes marker phase' };

  out.compare = { installed: false, enabled: false, how: 'writer is a guidance row' };

  const tsInstalled = exists(path.join(pluginRoot, 'src', 'status', 'task-status-input.js')) && exists(path.join(pluginRoot, 'scripts', 'write-task-status-input.js'));
  out.task_status_input = { installed: tsInstalled, enabled: tsInstalled && !knobIsOff('AUTOPILOT_TASK_STATUS_INPUT', null, env, config), how: 'engine writes the task-status input at managed-campaign terminals (knob AUTOPILOT_TASK_STATUS_INPUT=0)' };

  const ctxInstalled = hookRuns('context-budget.js') && exists(path.join(pluginRoot, 'hooks', 'context-budget.js'));
  out.context = { installed: ctxInstalled, enabled: ctxInstalled && !knobIsOff('AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE', null, env, config)
    && !(config && config.context_budget && config.context_budget.live_write === false), how: 'hook hooks/context-budget.js live write (knob AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE)' };

  const progInstalled = exists(path.join(pluginRoot, 'src', 'status', 'work-order-progress.js'));
  out.progress = { installed: progInstalled, enabled: progInstalled, how: 'campaign controller progress receipts under <git-common-dir>/autopilot/work-orders/<root>/ (read by work-order-progress.js)' };

  return {
    schema: 'autopilot.sources/1',
    scope: { project_key: (scope && scope.project_key) || null, root_run_id: (scope && scope.root_run_id) || null },
    sources: out,
  };
}

module.exports = { buildSourcesManifest, knobIsOff };
