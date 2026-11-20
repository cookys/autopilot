#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/gen-tux.js, which compiles mods/tux/tokens.json into mods/tux/palette.ts.
 * Run: node scripts/gen-tux.test.js < /dev/null
 *
 * gen-tux.js fixes its paths relative to its own directory (root = path.join(__dirname, '..')),
 * so every case copies the script into <tmp>/scripts/gen-tux.js and tokens.json into
 * <tmp>/mods/tux/tokens.json, then runs the copy with node. Nothing touches the real mods/.
 *
 *   1. write mode exits 0 and palette.ts content equals the repo's committed mods/tux/palette.ts
 *   2. --check right after writing exits 0
 *   3. negative control: one appended character -> --check exits 1 (see RED note below)
 *   4. invalid tokens.json -> exit 2 and stderr contains "gen-tux:"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const GEN_TUX = path.join(__dirname, 'gen-tux.js');
const REPO_TOKENS = path.join(REPO_ROOT, 'mods', 'tux', 'tokens.json');
const REPO_PALETTE = path.join(REPO_ROOT, 'mods', 'tux', 'palette.ts');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-tux-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

// A temp tree with a runnable copy of gen-tux.js and (by default) the repo's tokens.json.
function fixture(name, { tokens = fs.readFileSync(REPO_TOKENS, 'utf8') } = {}) {
  const root = path.join(TMP_ROOT, name);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mods', 'tux'), { recursive: true });
  fs.copyFileSync(GEN_TUX, path.join(root, 'scripts', 'gen-tux.js'));
  fs.writeFileSync(path.join(root, 'mods', 'tux', 'tokens.json'), tokens);
  return root;
}

function runGenTux(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'gen-tux.js'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('write mode exits 0 and palette.ts equals the repo copy', () => {
  const root = fixture('write');
  const res = runGenTux(root);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const generated = path.join(root, 'mods', 'tux', 'palette.ts');
  assert.ok(fs.existsSync(generated));
  assert.equal(fs.readFileSync(generated, 'utf8'), fs.readFileSync(REPO_PALETTE, 'utf8'));
});

test('--check right after writing exits 0', () => {
  const root = fixture('check-fresh');
  assert.equal(runGenTux(root).status, 0);
  const res = runGenTux(root, ['--check']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
});

test('negative control: one appended character -> --check exits 1', () => {
  const root = fixture('check-drift');
  assert.equal(runGenTux(root).status, 0);
  const generated = path.join(root, 'mods', 'tux', 'palette.ts');
  fs.appendFileSync(generated, 'x');
  const res = runGenTux(root, ['--check']);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}; stdout: ${res.stdout}`);
});

test('invalid tokens.json -> exit 2 and stderr contains "gen-tux:"', () => {
  const root = fixture('bad-tokens', { tokens: '{ not json' });
  const res = runGenTux(root);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('gen-tux:'), `stderr: ${res.stderr}`);
});
