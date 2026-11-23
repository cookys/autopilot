#!/usr/bin/env node
// Checks watch registration and cancellation only: asynchronous wakeup cannot be
// observed in isolation here. Run after each harness update from hangar.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-tools-regress-'));
const home = path.join(dir, 'home');
fs.mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), TMPDIR: dir };
const bin = process.env.FLEET_BIN || 'fleet';
const input = path.join(dir, 'input');
const output = path.join(dir, 'output');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
let failed = false;
function report(tool, error) {
  if (error) failed = true;
  console.log(`${error ? 'FAIL' : 'PASS'} ${tool} ${error || 'ok'}`);
}
function run(args) {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(result.error ? result.error.message : `exit ${result.status}`);
  return result.stdout;
}
try {
  fs.writeFileSync(input, 'fleet tools regression fixture\n');
  const expected = digest(fs.readFileSync(input));
  let ref;
  try {
    const text = run(['upload', input, '--summary', 'fleet tools regression fixture']);
    ref = (text.match(/\b[a-fA-F0-9]{64}\b/) || [])[0];
    if (!ref || ref.toLowerCase() !== expected) throw new Error('missing or incorrect sha256');
    report('upload');
  } catch (error) { report('upload', error.message); }
  try {
    if (!ref) throw new Error('upload returned no sha256');
    run(['fetch', ref, output]);
    if (digest(fs.readFileSync(output)) !== expected) throw new Error('sha256 mismatch');
    report('fetch');
  } catch (error) { report('fetch', error.message); }
  try {
    const text = run(['watch', '--until-file', path.join(dir, 'never-created'), '--timeout', '60']);
    const id = (text.match(/\b[0-9A-Z]{26}\b/) || [])[0];
    if (!id) throw new Error('missing watch_id');
    run(['watch', '--cancel', id]);
    report('watch');
  } catch (error) { report('watch', error.message); }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`AUDIT fleet-tools-regress ${failed ? 'FAIL' : 'PASS'}`);
process.exitCode = failed ? 1 : 0;
