'use strict';

/**
 * Tests for scripts/lib/residue-config.js — the one resolver for the `residue`
 * knobs (worktree/branch auto-reap).
 * Run: node --test scripts/residue-config.test.js
 *
 * All config reads land in an mkdtemp HOME (or an explicit AUTOPILOT_CONFIG_FILE
 * inside one); env is always passed explicitly, never taken from process.env.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadResidueConfig, DEFAULTS } = require('./lib/residue-config.js');

const CLI = path.join(__dirname, 'lib', 'residue-config.js');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-config-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

// A fresh fake home per case: <root>/.autopilot/config.json is the only file read.
function fakeHome(name) {
  const home = path.join(TMP_ROOT, name);
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  return home;
}

function writeConfig(home, doc) {
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify(doc));
}

test('defaults: no config file and empty env give the built-in defaults', () => {
  const home = fakeHome('defaults');
  const cfg = loadResidueConfig({ env: {}, home });
  assert.deepEqual(cfg, { ...DEFAULTS, branch_prefixes: [] });
  assert.equal(DEFAULTS.auto_reap, true);
  assert.equal(DEFAULTS.tmp_prune, true);
  assert.equal(DEFAULTS.delete_branches, false);
  assert.equal(DEFAULTS.lease_hours, 72);
  assert.equal(DEFAULTS.archive_branch_days, 14);
  assert.equal(DEFAULTS.archive_remind_days, 90);
});

test('config file tier: residue block overrides defaults', () => {
  const home = fakeHome('file-tier');
  writeConfig(home, {
    residue: {
      auto_reap: false,
      delete_branches: true,
      lease_hours: 24,
      archive_branch_days: 7,
      archive_remind_days: 30,
      branch_prefixes: ['feat/', 'fix-x'],
    },
  });
  const cfg = loadResidueConfig({ env: {}, home });
  assert.equal(cfg.auto_reap, false);
  assert.equal(cfg.tmp_prune, true); // untouched default
  assert.equal(cfg.delete_branches, true);
  assert.equal(cfg.lease_hours, 24);
  assert.equal(cfg.archive_branch_days, 7);
  assert.equal(cfg.archive_remind_days, 30);
  assert.deepEqual(cfg.branch_prefixes, ['feat/', 'fix-x']);
});

test('env tier beats config file; only exact 0/1 toggles and positive numbers count', () => {
  const home = fakeHome('env-tier');
  writeConfig(home, { residue: { auto_reap: false, lease_hours: 24 } });
  const cfg = loadResidueConfig({
    env: {
      AUTOPILOT_RESIDUE_AUTO_REAP: '1',
      AUTOPILOT_RESIDUE_TMP_PRUNE: '0',
      AUTOPILOT_RESIDUE_DELETE_BRANCHES: '1',
      AUTOPILOT_RESIDUE_LEASE_HOURS: '48',
      AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS: '3.5',
      AUTOPILOT_RESIDUE_ARCHIVE_REMIND_DAYS: '45',
    },
    home,
  });
  assert.equal(cfg.auto_reap, true); // env re-enables over config false
  assert.equal(cfg.tmp_prune, false);
  assert.equal(cfg.delete_branches, true);
  assert.equal(cfg.lease_hours, 48);
  assert.equal(cfg.archive_branch_days, 3.5);
  assert.equal(cfg.archive_remind_days, 45);

  // Not '0'/'1' -> ignored, config value stands.
  const loose = loadResidueConfig({ env: { AUTOPILOT_RESIDUE_AUTO_REAP: 'yes' }, home });
  assert.equal(loose.auto_reap, false);
});

test('malformed values fall back to the lower tier, never throw', () => {
  const home = fakeHome('malformed');
  writeConfig(home, {
    residue: {
      lease_hours: -5, // not positive
      archive_branch_days: '7', // string, not a number
      archive_remind_days: 0,
      auto_reap: 'false', // string, not a boolean
      branch_prefixes: ['ok/', 'bad prefix', 42, '', 'a'.repeat(100), 'x'],
    },
  });
  const cfg = loadResidueConfig({
    env: {
      AUTOPILOT_RESIDUE_LEASE_HOURS: 'abc',
      AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS: '-1',
      AUTOPILOT_RESIDUE_ARCHIVE_REMIND_DAYS: '0',
    },
    home,
  });
  assert.equal(cfg.lease_hours, DEFAULTS.lease_hours); // bad env -> bad config -> default
  assert.equal(cfg.archive_branch_days, DEFAULTS.archive_branch_days);
  assert.equal(cfg.archive_remind_days, DEFAULTS.archive_remind_days);
  assert.equal(cfg.auto_reap, DEFAULTS.auto_reap);
  // Prefix filter: strings only, charset [A-Za-z0-9._-] plus optional '/'; no length cap here.
  assert.deepEqual(cfg.branch_prefixes, ['ok/', 'a'.repeat(100), 'x']);
});

test('corrupt config file is swallowed -> defaults', () => {
  const home = fakeHome('corrupt');
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), '{ not json');
  const cfg = loadResidueConfig({ env: {}, home });
  assert.deepEqual(cfg, { ...DEFAULTS, branch_prefixes: [] });
});

test('AUTOPILOT_CONFIG_FILE overrides the home-derived path', () => {
  const home = fakeHome('ignored-home');
  const file = path.join(TMP_ROOT, 'explicit-config.json');
  fs.writeFileSync(file, JSON.stringify({ residue: { lease_hours: 12 } }));
  const cfg = loadResidueConfig({ env: { AUTOPILOT_CONFIG_FILE: file }, home });
  assert.equal(cfg.lease_hours, 12);
  assert.equal(cfg.auto_reap, DEFAULTS.auto_reap);
});

test('CLI: prints the full config as JSON; --field prints one raw value', () => {
  const home = fakeHome('cli');
  writeConfig(home, { residue: { lease_hours: 24, delete_branches: true } });

  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { HOME: home, PATH: process.env.PATH || '/usr/bin:/bin' },
    input: '',
  });

  const full = run([]);
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(JSON.parse(full.stdout), {
    auto_reap: true,
    tmp_prune: true,
    delete_branches: true,
    lease_hours: 24,
    archive_branch_days: 14,
    archive_remind_days: 90,
    branch_prefixes: [],
  });

  const field = run(['--field', 'lease_hours']);
  assert.equal(field.status, 0, field.stderr);
  assert.equal(field.stdout, '24');

  const boolField = run(['--field', 'delete_branches']);
  assert.equal(boolField.stdout, 'true');

  const unknown = run(['--field', 'no_such_key']);
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.equal(unknown.stdout, '');

  const prefixesHome = fakeHome('cli-prefixes');
  writeConfig(prefixesHome, { residue: { branch_prefixes: ['feat/'] } });
  const prefixes = spawnSync(process.execPath, [CLI, '--field', 'branch_prefixes'], {
    encoding: 'utf8',
    env: { HOME: prefixesHome, PATH: process.env.PATH || '/usr/bin:/bin' },
    input: '',
  });
  assert.equal(prefixes.status, 0, prefixes.stderr);
  assert.equal(prefixes.stdout, '["feat/"]');
});
