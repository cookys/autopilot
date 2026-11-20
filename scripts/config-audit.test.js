#!/usr/bin/env node
'use strict';
// Unit tests for scripts/lib/config-audit.js — temp config + registry only.
// Run: node --test scripts/config-audit.test.js < /dev/null

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  audit,
  formatLines,
  loadRegistry,
  CURRENT_SCHEMA,
  AUTOCOMPACT_BUFFER,
} = require('./lib/config-audit');

const LIBDIR = path.join(__dirname, 'lib');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'config-audit-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const home = path.join(TMP, 'home');
const cc = path.join(TMP, 'cc');
const proj = path.join(TMP, 'proj');
fs.mkdirSync(home);
fs.mkdirSync(cc);
fs.mkdirSync(proj);

function setWindow(n) {
  if (n == null) fs.rmSync(path.join(cc, 'settings.json'), { force: true });
  else fs.writeFileSync(path.join(cc, 'settings.json'), JSON.stringify({ autoCompactWindow: n }));
}

function cfg(json, name = 'cfg.json') {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, typeof json === 'string' ? json : JSON.stringify(json));
  return p;
}

function baseEnv(configFile) {
  return {
    HOME: home,
    CLAUDE_CONFIG_DIR: cc,
    CLAUDE_PROJECT_DIR: proj,
    AUTOPILOT_CONFIG_FILE: configFile,
    AUTOPILOT_MANAGED_SETTINGS_FILE: path.join(TMP, 'no-managed.json'),
  };
}

const CLEAN = {
  config_schema_version: CURRENT_SCHEMA,
  context_budget: { t1: 100000, t2: 150000, gap: 50000, mode: 'warn' },
  update_check: true,
};

test('loadRegistry and CURRENT_SCHEMA', () => {
  const entries = loadRegistry(path.join(LIBDIR, 'config-keys.json'));
  assert.ok(entries.length > 10);
  assert.ok(entries.every((e) => e.kind === 'config_key'));
  assert.equal(CURRENT_SCHEMA, 2);
  assert.equal(AUTOCOMPACT_BUFFER, 33000);
});

test('audit: absent config — no file findings except defaults_changed', () => {
  setWindow(250000);
  const missing = path.join(TMP, 'does-not-exist.json');
  const r = audit({ env: baseEnv(missing), home, projectDir: proj });
  assert.equal(r.present, false);
  assert.ok(r.findings.every((f) => f.rule === 'defaults_changed'));
});

test('audit: clean config has no findings', () => {
  setWindow(250000);
  const file = cfg(CLEAN);
  const r = audit({ env: baseEnv(file), home, configFile: file, projectDir: proj });
  assert.equal(r.findings.length, 0);
  assert.equal(r.schema.user, CURRENT_SCHEMA);
});

test('audit: unknown_key on typo', () => {
  setWindow(250000);
  const file = cfg({ ...CLEAN, context_budgt: { t2: 1 } });
  const r = audit({ env: baseEnv(file), home, configFile: file, projectDir: proj });
  const unk = r.findings.filter((f) => f.rule === 'unknown_key');
  assert.equal(unk.length, 1);
  assert.equal(unk[0].key, 'context_budgt');
  assert.ok(unk[0].suggestion);
});

test('audit: unreadable file', () => {
  setWindow(250000);
  const file = cfg('{ not json');
  const r = audit({ env: baseEnv(file), home, configFile: file, projectDir: proj });
  assert.ok(r.findings.some((f) => f.rule === 'unreadable'));
});

test('audit: bad_value on context_budget.mode', () => {
  setWindow(250000);
  const file = cfg({ ...CLEAN, context_budget: { ...CLEAN.context_budget, mode: 'of' } });
  const r = audit({ env: baseEnv(file), home, configFile: file, projectDir: proj });
  assert.ok(r.findings.some((f) => f.rule === 'bad_value' && f.key === 'context_budget.mode'));
});

test('audit: t1_not_below_t2 contradiction', () => {
  setWindow(250000);
  const file = cfg({
    ...CLEAN,
    context_budget: { t1: 200000, t2: 150000, gap: 50000, mode: 'warn' },
  });
  const r = audit({ env: baseEnv(file), home, configFile: file, projectDir: proj });
  assert.ok(r.findings.some((f) => f.rule === 't1_not_below_t2'));
});

test('formatLines renders suggestion when present', () => {
  const lines = formatLines({
    findings: [{ rule: 'unknown_key', key: 'x', detail: 'ignored', suggestion: 'context_budget' }],
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /try: context_budget/);
});

test('CLI: clean config exits 0', () => {
  setWindow(250000);
  const file = cfg(CLEAN);
  const r = spawnSync(process.execPath, [path.join(LIBDIR, 'config-audit.js'), '--config', file, '--project-dir', proj], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', TMPDIR: TMP, ...baseEnv(file) },
  });
  assert.equal(r.status, 0);
});

test('CLI: findings exit 1; bogus flag exit 2', () => {
  setWindow(250000);
  const file = cfg({ context_budgt: { t2: 1 }, config_schema_version: CURRENT_SCHEMA });
  const bad = spawnSync(process.execPath, [path.join(LIBDIR, 'config-audit.js'), '--config', file, '--project-dir', proj], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', TMPDIR: TMP, ...baseEnv(file) },
  });
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes('context_budgt'));
  const usage = spawnSync(process.execPath, [path.join(LIBDIR, 'config-audit.js'), '--bogus'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', HOME: home, TMPDIR: TMP },
  });
  assert.equal(usage.status, 2);
});