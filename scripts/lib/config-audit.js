#!/usr/bin/env node
'use strict';

// scripts/lib/config-audit.js — read-only check of the operator config (~/.autopilot/config.json) against the
// settings registry (scripts/lib/config-keys.json). It only reports; it never edits the file and never blocks.
//
//   node scripts/lib/config-audit.js [--json] [--config FILE] [--project-dir DIR]
//
// Exit codes: 0 = nothing found (also: no config file, which means all defaults), 1 = at least one finding,
// 2 = usage error. Callers that must never fail (the SessionStart hook) call audit() and ignore the exit code.
// Output: human lines (formatLines), or with --json one object:
//   { config_path, present, schema: { user, current }, findings: [ { rule, key, detail, suggestion? } ] }
//
// Rules (a finding's `rule`):
//   unreadable          the file exists but is not a JSON object (every reader silently falls back to defaults)
//   unknown_key         a key the registry does not list; `suggestion` is the closest known key (catches typos)
//   bad_type            value type differs from the registry `type`
//   bad_value           value is not one of the registry `allowed` values; `invalid_effect` says what that does
//   t1_not_below_t2     effective context_budget.t1 >= t2 (both on): T2 outranks T1, so T1 never fires
//   t2_gap_over_window  t2 + gap > autoCompactWindow - 33000: Claude Code compacts before the T2 reminder has room
//   no_autocompact_window  compaction is on but no window is set: a 1M-window session compacts only near 1M
//   defaults_changed    registry `changed_in` entries newer than the config_schema_version you last reviewed
//
// Maintaining the change history: when you change a documented default (or flip a hook to default-on), append
// { schema, from, to, note } to that entry's `changed_in` in config-keys.json. `schema` is the config_schema_version
// the change belongs to; if it is a new number, raise CURRENT_SCHEMA below and document it in
// docs/settings-reference.md. A user with config_schema_version < schema sees the entry until they set the field.
// A missing config_schema_version counts as 0. The file is never rewritten.

const fs = require('fs');
const path = require('path');
const { configPath, readContextBudget } = require('./config-path.js');
const { AUTOCOMPACT_BUFFER } = require('./autocompact-window.js');

const CURRENT_SCHEMA = 1;
const REGISTRY = path.join(__dirname, 'config-keys.json');

function loadRegistry(file) {
  const reg = JSON.parse(fs.readFileSync(file || REGISTRY, 'utf8'));
  // `<ENV_NAME>` is a documentation placeholder for the env-var column, not a config key; a bare wildcard would match everything.
  return reg.entries.filter((e) => e.kind === 'config_key' && !/^<[^.]+>$/.test(e.name));
}

function lev(a, b) {
  const m = a.length; const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : 'nan';
  return typeof v;
}

// Entry whose dotted name matches `parts` (a `<x>` segment matches any one segment).
function findEntry(entries, parts) {
  return entries.find((e) => {
    const p = e.name.split('.');
    return p.length === parts.length && p.every((s, i) => /^<.+>$/.test(s) || s === parts[i]);
  });
}

function isContainer(entries, parts) {
  return entries.some((e) => {
    const p = e.name.split('.');
    return p.length > parts.length && parts.every((s, i) => /^<.+>$/.test(p[i]) || p[i] === s);
  });
}

function closest(entries, dotted) {
  const names = new Set();
  for (const e of entries) {
    if (e.name.includes('<')) continue;
    const p = e.name.split('.');
    for (let i = 1; i <= p.length; i++) names.add(p.slice(0, i).join('.'));
  }
  let best = null; let bestD = Infinity;
  for (const n of names) {
    const d = lev(dotted.toLowerCase(), n.toLowerCase());
    if (d < bestD) { best = n; bestD = d; }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(dotted.length / 3)) ? best : null;
}

function walk(entries, obj, prefix, findings) {
  for (const key of Object.keys(obj)) {
    const parts = [...prefix, key];
    const dotted = parts.join('.');
    // Band source switches: config.json may carry {"AUTOPILOT_<KNOB>": "off"} at top level (registry entry <ENV_NAME>).
    if (!prefix.length && /^AUTOPILOT_[A-Z0-9_]+$/.test(key)) continue;
    const entry = findEntry(entries, parts);
    const val = obj[key];
    if (!entry) {
      if (isContainer(entries, parts)) {
        if (typeOf(val) === 'object') walk(entries, val, parts, findings);
        else findings.push({ rule: 'bad_type', key: dotted, detail: `expected an object, found ${typeOf(val)}; its settings are ignored` });
        continue;
      }
      const f = { rule: 'unknown_key', key: dotted, detail: 'not a setting autopilot reads; it is silently ignored' };
      const s = closest(entries, dotted);
      if (s) f.suggestion = s;
      findings.push(f);
      continue;
    }
    if (entry.type) {
      const t = typeOf(val);
      const okTypes = entry.type === 'enum' ? ['string'] : entry.type.split('|');
      if (!okTypes.includes(t)) {
        findings.push({ rule: 'bad_type', key: dotted, detail: `expected ${okTypes.join(' or ')}, found ${t}` });
        continue;
      }
      if (entry.type === 'enum' && !entry.allowed.includes(val)) {
        const eff = entry.invalid_effect ? `; ${entry.invalid_effect}` : '';
        findings.push({ rule: 'bad_value', key: dotted, detail: `"${val}" is not one of ${entry.allowed.map((a) => `"${a}"`).join(', ')}${eff}` });
        continue;
      }
    }
    if (typeOf(val) === 'object' && isContainer(entries, parts)) walk(entries, val, parts, findings);
  }
}

function contradictions(opts, userCfg, findings) {
  const env = opts.env || process.env;
  const b = readContextBudget({ env, home: opts.home });
  if (b.mode === 'off') return;
  if (b.t1 > 0 && b.t2 > 0 && b.t1 >= b.t2) {
    findings.push({ rule: 't1_not_below_t2', key: 'context_budget.t1', detail: `t1 ${b.t1} is not below t2 ${b.t2}, so the T1 reminder never fires (T2 outranks it)`, suggestion: `lower t1 under ${b.t2} or raise t2` });
  }
  let win = null;
  try {
    const resolve = opts.resolve || require('./autocompact-window.js').resolve;
    win = resolve({ projectDir: opts.projectDir, env, home: opts.home });
  } catch { return; }
  if (!win || win.enabled === false) return;
  if (Number.isFinite(win.configured) && win.configured > 0) {
    const compactAt = win.configured - AUTOCOMPACT_BUFFER;
    if (b.t2 > 0 && b.t2 + b.gap > compactAt) {
      findings.push({ rule: 't2_gap_over_window', key: 'context_budget.t2', detail: `t2 ${b.t2} + gap ${b.gap} = ${b.t2 + b.gap} is above the compaction point ${compactAt} (autoCompactWindow ${win.configured} - ${AUTOCOMPACT_BUFFER})`, suggestion: `autoCompactWindow ${b.t2 + b.gap + AUTOCOMPACT_BUFFER} or lower t2/gap` });
    }
  } else if (win.configured === null && !(win.per_model && Object.keys(win.per_model).length) && !(Number.isFinite(opts.contextWindow) && opts.contextWindow < 1_000_000)) {
    findings.push({ rule: 'no_autocompact_window', key: 'autoCompactWindow', detail: 'no auto-compact window is set: a 1M-window session compacts only near 1M, and T2 then asks you to stop and /clear', suggestion: `set "autoCompactWindow": 250000 in ~/.claude/settings.json or run /autocompact; keep context_budget.t2 plus context_budget.gap at most autoCompactWindow minus ${AUTOCOMPACT_BUFFER} in ~/.autopilot/config.json` });
  }
}

function changedDefaults(entries, userSchema, findings) {
  for (const e of entries) {
    for (const c of e.changed_in || []) {
      if (c.schema > userSchema && c.schema <= CURRENT_SCHEMA) {
        findings.push({ rule: 'defaults_changed', key: e.name, detail: `default changed (schema ${c.schema}): ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}${c.note ? `. ${c.note}` : ''}` });
      }
    }
  }
}

/** audit({ env?, home?, configFile?, projectDir?, registryFile?, resolve?, contextWindow? }) -> result object (see header). */
function audit(opts = {}) {
  const env = opts.env || process.env;
  const file = opts.configFile || configPath({ env, home: opts.home });
  const entries = loadRegistry(opts.registryFile);
  const findings = [];
  const result = { config_path: file, present: false, schema: { user: 0, current: CURRENT_SCHEMA }, findings };
  let cfg = null;
  if (fs.existsSync(file)) {
    result.present = true;
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeOf(cfg) !== 'object') throw new Error('not an object');
    } catch (e) {
      cfg = null;
      findings.push({ rule: 'unreadable', key: file, detail: `not a JSON object (${e.message}); every reader falls back to defaults` });
    }
  }
  if (cfg) {
    walk(entries, cfg, [], findings);
    if (Number.isFinite(cfg.config_schema_version)) result.schema.user = cfg.config_schema_version;
  }
  // The effective-value checks run for an absent file too (defaults + env), but not for an unreadable one.
  if (!result.present || cfg) contradictions({ ...opts, env: { ...env, AUTOPILOT_CONFIG_FILE: file } }, cfg, findings);
  changedDefaults(entries, result.schema.user, findings);
  return result;
}

function formatLines(r) {
  const out = [];
  for (const f of r.findings) out.push(`${f.rule}: ${f.key}: ${f.detail}${f.suggestion ? ` (try: ${f.suggestion})` : ''}`);
  return out;
}

module.exports = { audit, formatLines, loadRegistry, CURRENT_SCHEMA, AUTOCOMPACT_BUFFER };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const known = new Set(['--json', '--config', '--project-dir']);
  const bad = args.filter((a, i) => a.startsWith('-') && !known.has(a)).length;
  if (bad || args.includes('-h') || args.includes('--help')) {
    process.stderr.write('Usage: node scripts/lib/config-audit.js [--json] [--config FILE] [--project-dir DIR]\n  Exit 0 = nothing found, 1 = findings, 2 = usage.\n');
    process.exit(bad ? 2 : 0);
  }
  let r;
  try { r = audit({ configFile: opt('--config'), projectDir: opt('--project-dir') || process.env.CLAUDE_PROJECT_DIR || process.cwd() }); } catch (e) {
    process.stderr.write(`config-audit: ${e.message}\n`); process.exit(2);
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(r)}\n`);
  else {
    const lines = formatLines(r);
    process.stdout.write(lines.length ? `${lines.join('\n')}\n` : `config ok (${r.present ? r.config_path : 'no config file, all defaults'})\n`);
  }
  process.exit(r.findings.length ? 1 : 0);
}
