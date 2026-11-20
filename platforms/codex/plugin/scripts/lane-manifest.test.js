'use strict';

/**
 * Tests for scripts/lib/lane-manifest.js — the lane record store for lane-switch.
 * Run: node --test scripts/lane-manifest.test.js
 *
 * Every read/write lands under an mkdtemp base; defaultBase() is only asserted
 * as a path string (it never touches the real ~/.config/autopilot).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  NAME_RE,
  FIELDS,
  defaultBase,
  lanePath,
  validate,
  writeManifest,
  readManifest,
} = require('./lib/lane-manifest.js');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-manifest-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

const BASE = path.join(TMP_ROOT, 'base'); // writeManifest creates <base>/lanes itself.

const GOOD = {
  lane: 'main',
  pane: 'main',
  cwd: '/srv/work/repo',
  seat: 'agy',
  session_id: 'sess-1',
  model: 'gemini-4-hydrogen-low',
  launch_flags: ['--model=gemini-4-hydrogen-low'],
  profile: 'home',
};

test('NAME_RE / FIELDS: lane and profile names share one conservative shape', () => {
  assert.equal(NAME_RE.test('main'), true);
  assert.equal(NAME_RE.test('feat-x.y_z-1'), true);
  assert.equal(NAME_RE.test('a'.repeat(64)), true);
  assert.equal(NAME_RE.test('a'.repeat(65)), false); // max 64 chars
  assert.equal(NAME_RE.test('-lead'), false); // must start alnum
  assert.equal(NAME_RE.test('has space'), false);
  assert.deepEqual(FIELDS, ['lane', 'pane', 'cwd', 'seat', 'session_id', 'model', 'launch_flags', 'profile']);
});

test('defaultBase: a path string under ~/.config/autopilot; nothing is read', () => {
  assert.equal(defaultBase(), path.join(os.homedir(), '.config', 'autopilot'));
});

test('lanePath: joins <base>/lanes/<lane>.json and rejects invalid lane names', () => {
  assert.equal(lanePath(BASE, 'main'), path.join(BASE, 'lanes', 'main.json'));
  assert.throws(() => lanePath(BASE, 'bad lane'), /lane_invalid/);
  assert.throws(() => lanePath(BASE, '-x'), /lane_invalid/);
});

test('validate: a well-formed record passes and is returned', () => {
  assert.equal(validate(GOOD), GOOD);
  // Optional fields may be absent entirely.
  assert.equal(validate({ lane: 'solo' }).lane, 'solo');
});

test('validate: shape guards — object, known fields, lane, profile', () => {
  for (const bad of [null, undefined, 'x', [1, 2]]) {
    assert.throws(() => validate(bad), /manifest_not_object/);
  }
  assert.throws(() => validate({ ...GOOD, prompt: 'do things' }), /manifest_field_rejected:prompt/);
  assert.throws(() => validate({ ...GOOD, lane: 'bad lane' }), /lane_invalid/);
  assert.throws(() => validate({ ...GOOD, lane: undefined }), /lane_invalid/);
  assert.throws(() => validate({ ...GOOD, profile: '-nope' }), /profile_invalid/);
  assert.throws(() => validate({ ...GOOD, profile: 42 }), /profile_invalid/);
  assert.equal(validate({ ...GOOD, profile: undefined }).lane, 'main');
});

test('validate: pane/seat/session_id/model are single non-empty tokens', () => {
  assert.throws(() => validate({ ...GOOD, pane: 7 }), /manifest_type:pane/);
  assert.throws(() => validate({ ...GOOD, seat: 'has space' }), /manifest_value:seat/);
  assert.throws(() => validate({ ...GOOD, session_id: '' }), /manifest_value:session_id/);
  assert.throws(() => validate({ ...GOOD, model: 'a\tb' }), /manifest_value:model/);
});

test('validate: cwd must be an absolute path string', () => {
  assert.throws(() => validate({ ...GOOD, cwd: 'relative/dir' }), /manifest_cwd_not_absolute/);
  assert.throws(() => validate({ ...GOOD, cwd: 42 }), /manifest_cwd_not_absolute/);
  assert.equal(validate({ ...GOOD, cwd: '/x' }).cwd, '/x');
});

test('validate: launch_flags are flags, never prompt text', () => {
  assert.throws(() => validate({ ...GOOD, launch_flags: '--model=x' }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['not-a-flag'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['-p'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['--print'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['--prompt=do x'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['--system-prompt=do x'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['--append-system-prompt=do x'] }), /manifest_launch_flags_not_flags/);
  assert.throws(() => validate({ ...GOOD, launch_flags: ['-m\nsleep 30'] }), /manifest_launch_flags_not_flags/);
  // A whitespace-containing flag is only tolerated when it carries `--flag=value` form.
  assert.equal(validate({ ...GOOD, launch_flags: ['--model=x y'] }).lane, 'main');
  assert.equal(validate({ ...GOOD, launch_flags: ['-v', '--effort=low'] }).lane, 'main');
  assert.equal(validate({ ...GOOD, launch_flags: [] }).lane, 'main');
});

test('writeManifest + readManifest: round trip into an injected base, file mode 0600', () => {
  const file = writeManifest(BASE, GOOD);
  assert.equal(file, lanePath(BASE, 'main'));
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  assert.deepEqual(readManifest(BASE, 'main'), GOOD);

  const st = fs.statSync(path.dirname(file));
  assert.equal((st.mode & 0o700), 0o700); // lanes dir is private
});

test('readManifest: a missing lane is null, never an error', () => {
  assert.equal(readManifest(BASE, 'never-written'), null);
});

test('readManifest: a file whose mode is not 0600 is rejected on read', () => {
  writeManifest(BASE, { ...GOOD, lane: 'tampered' });
  const file = lanePath(BASE, 'tampered');
  fs.chmodSync(file, 0o644);
  assert.throws(() => readManifest(BASE, 'tampered'), /manifest_mode_not_0600/);
});

test('writeManifest: invalid records are refused before anything lands on disk', () => {
  assert.throws(() => writeManifest(BASE, { ...GOOD, lane: 'bad lane' }), /lane_invalid/);
  assert.equal(fs.existsSync(path.join(BASE, 'lanes', 'bad lane.json')), false);
});
