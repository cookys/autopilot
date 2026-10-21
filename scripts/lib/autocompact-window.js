#!/usr/bin/env node
'use strict';

// scripts/lib/autocompact-window.js — re-derives the auto-compact window Claude Code will use,
// from the same inputs Claude Code reads, so context-budget and `dev-setup.sh --check` can tell a
// user who never set one (a 1M-window session then compacts only near 1M) from one who did.
// Evidence and the reason it matters: docs/plans/evidence/2026-10-12-context-reset-cost/README.md.
//
// Contract, mirroring the Claude Code 2.1.296 resolver (read from the binary, 2026-10-12):
//   1. env CLAUDE_CODE_AUTO_COMPACT_WINDOW wins: a positive integer, below 100000 raised to 100000,
//      above 1000000 capped to 1000000. Not a positive number => ignored (Claude Code falls through).
//   2. Settings files, merged in Claude Code's order user -> project -> local -> policy, later wins:
//      a file with a top-level `autoCompactWindow` replaces the default AND drops the per-model
//      entries of earlier files; a file without one merges its `modelSettings.<model>.autoCompactWindow`
//      entries in. Lookup: the model's own entry, else the default. "auto" means not set.
//      `/autocompact` writes the per-model entry, not the top-level key.
//   3. Nothing set => Claude Code falls back to a server-supplied window, an experiment, then the
//      model default (the full window for a native 1M model). None of these is visible here, so
//      the answer is `configured: null`, never a guessed number.
//   Compaction is off when env DISABLE_AUTO_COMPACT or DISABLE_COMPACT is truthy (1/true/yes/on,
//   case-insensitive, trimmed: the binary's own predicate; "0"/"false"/"no"/"off" leave it on), or when
//   `autoCompactEnabled` is false (merged settings, else ~/.claude.json).
// Not visible to this module (known gaps): `--settings <file>` (flag settings) and
// `--autocompact <value>` on the claude command line.
//
// Env AUTOPILOT_MANAGED_SETTINGS_FILE replaces the managed-settings path (test isolation).
// CLI: node scripts/lib/autocompact-window.js [--project-dir <dir>] [--model <id>]
//   prints the resolve() result as JSON; exit 0 always (a read failure is "not set").

const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_WINDOW = 100_000;
const MAX_WINDOW = 1_000_000;

// Same shape as Claude Code's canonical-name match: a dated, -vN or [1m]/[2m] spelling of a model
// id resolves to the plain id.
function canonicalModel(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  return id.trim().toLowerCase()
    .replace(/\[[12]m\]$/, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/[-@]\d{8}$/, '');
}

// A settings value: an integer 100000..1000000, or "auto" (= not set). Anything else is ignored,
// as Claude Code's schema rejects it.
function settingsValue(v) {
  if (v === 'auto') return 'auto';
  if (Number.isInteger(v) && v >= MIN_WINDOW && v <= MAX_WINDOW) return v;
  return undefined;
}

function envWindow(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(n)));
}

// Claude Code 2.1.296 reads DISABLE_COMPACT / DISABLE_AUTO_COMPACT through one predicate
// (`Ne`, read from the binary 2026-10-13): String(v).toLowerCase().trim() is one of
// "1", "true", "yes", "on". Everything else ("0", "false", "no", "off", "banana") is unset.
function truthyEnv(v) {
  return typeof v === 'string' && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase().trim());
}

function readJson(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { return null; }
}

function managedSettingsPath(platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

// Settings sources in Claude Code's merge order. The same path listed twice is read once.
function settingsSources(opts) {
  const env = opts.env || process.env;
  const configDir = opts.configDir || env.CLAUDE_CONFIG_DIR || path.join(opts.home || os.homedir(), '.claude');
  const projectDir = opts.projectDir || env.CLAUDE_PROJECT_DIR || null;
  const list = [{ source: 'user', file: path.join(configDir, 'settings.json') }];
  if (projectDir) {
    list.push({ source: 'project', file: path.join(projectDir, '.claude', 'settings.json') });
    list.push({ source: 'local', file: path.join(projectDir, '.claude', 'settings.local.json') });
  }
  // AUTOPILOT_MANAGED_SETTINGS_FILE overrides the policy path so a suite on a host that has a real
  // /etc/claude-code/managed-settings.json can point it at its own scratch file.
  list.push({ source: 'policy', file: opts.managedPath || env.AUTOPILOT_MANAGED_SETTINGS_FILE || managedSettingsPath(opts.platform || process.platform) });
  const seen = new Set();
  return list.filter((s) => {
    const key = path.resolve(s.file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * resolve(opts) -> {
 *   configured: number|null,   window a user set (env or settings); null = nothing set
 *   source: 'env'|'settings'|null,
 *   origin: string|null,       env var name, or the settings file the value came from
 *   scope: 'model'|'default'|null,  per-model entry or top-level key (settings only)
 *   per_model: {model: number}, every per-model entry in effect (merged), for reporting
 *   enabled: boolean, disabled_by: string|null
 * }
 * opts: {env, home, configDir, projectDir, managedPath, platform, model, claudeJsonPath}
 */
function resolve(opts = {}) {
  const env = opts.env || process.env;
  const model = canonicalModel(opts.model);
  const home = opts.home || os.homedir();

  let def = { value: undefined, origin: null };
  let byModel = {};
  let enabled = null;
  let enabledOrigin = null;
  for (const s of settingsSources({ ...opts, env, home })) {
    const j = readJson(s.file);
    if (!j) continue;
    const fileModels = {};
    if (j.modelSettings && typeof j.modelSettings === 'object') {
      for (const [k, entry] of Object.entries(j.modelSettings)) {
        const v = settingsValue(entry && entry.autoCompactWindow);
        if (v === undefined) continue;
        const key = canonicalModel(k);
        // An exact canonical key beats a dated / [1m] spelling of the same model in one file.
        if (key === k || !Object.hasOwn(fileModels, key)) fileModels[key] = { value: v, origin: s.file };
      }
    }
    const top = settingsValue(j.autoCompactWindow);
    if (top !== undefined) {
      def = { value: top, origin: s.file };
      byModel = fileModels;
    } else {
      byModel = { ...byModel, ...fileModels };
    }
    if (typeof j.autoCompactEnabled === 'boolean') { enabled = j.autoCompactEnabled; enabledOrigin = s.file; }
  }
  if (enabled === null) {
    const claudeJson = opts.claudeJsonPath || path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');
    const g = readJson(claudeJson);
    if (g && typeof g.autoCompactEnabled === 'boolean') { enabled = g.autoCompactEnabled; enabledOrigin = claudeJson; }
  }

  let disabledBy = null;
  if (truthyEnv(env.DISABLE_COMPACT)) disabledBy = 'env DISABLE_COMPACT';
  else if (truthyEnv(env.DISABLE_AUTO_COMPACT)) disabledBy = 'env DISABLE_AUTO_COMPACT';
  else if (enabled === false) disabledBy = `autoCompactEnabled false (${enabledOrigin})`;

  const perModel = {};
  for (const [k, e] of Object.entries(byModel)) if (e.value !== 'auto') perModel[k] = e.value;

  const out = {
    configured: null, source: null, origin: null, scope: null,
    per_model: perModel, enabled: disabledBy === null, disabled_by: disabledBy,
  };
  const fromEnv = envWindow(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (fromEnv !== null) {
    return { ...out, configured: fromEnv, source: 'env', origin: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW' };
  }
  const entry = model && Object.hasOwn(byModel, model) ? byModel[model] : null;
  const pick = entry || def;
  if (pick.value !== undefined && pick.value !== 'auto') {
    return { ...out, configured: pick.value, source: 'settings', origin: pick.origin, scope: entry ? 'model' : 'default' };
  }
  return out;
}

// One owner-facing line for a 1M-window session with no window set and compaction on; null
// otherwise. `window` is the session's context window when known.
function recommendation(r, window) {
  if (!r || !r.enabled || r.configured !== null) return null;
  if (!(Number.isFinite(window) && window >= MAX_WINDOW)) return null;
  return 'Tip: no autoCompactWindow is set, so this 1M-window session compacts only near 1M ' +
    '(unless the server supplies a window). Set "autoCompactWindow": 250000 in ~/.claude/settings.json ' +
    'or run /autocompact: resetting between 150k and 300k cut cost about 20% in measured sessions. ' +
    'Keep context_budget.t2 plus context_budget.gap at most autoCompactWindow minus 33000; ' +
    'autoCompactWindow is in ~/.claude/settings.json and context_budget.t2 and context_budget.gap are in ~/.autopilot/config.json.';
}

module.exports = { resolve, recommendation, canonicalModel, settingsSources, MIN_WINDOW, MAX_WINDOW };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  let result;
  try {
    result = resolve({ projectDir: opt('--project-dir'), model: opt('--model') });
  } catch (e) {
    result = { configured: null, source: null, error: e.message };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
