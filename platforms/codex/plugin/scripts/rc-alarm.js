#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { configPath } = require('./lib/config-path');
const { mkdirp } = require('./lib/safe-mkdirp');

function usage() {
  console.error('usage: rc-alarm.js --label <name> [--lead <addr> ...] [--owner <addr>] [--state-dir DIR] [--reset | -- COMMAND...]');
  console.error('       rc-alarm.js record --label <name> --rc N [--lead <addr> ...] [--owner <addr>] [--last-line TEXT] [--state-dir DIR]');
  console.error('       rc-alarm.js check --label <name> [--state-dir DIR]');
  process.exit(2);
}
const warn = message => console.error(`[rc-alarm] warning: ${message}`);
const validLabel = label => /^[A-Za-z0-9_.-]+$/.test(label) && label !== '.' && label !== '..';
function defaultStateDir() {
  return process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, 'autopilot', 'rc-alarm')
    : path.join(os.tmpdir(), `autopilot-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`, 'rc-alarm');
}
function configuredLeads() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return Array.isArray(data.rc_alarm_lead) ? data.rc_alarm_lead.filter(x => typeof x === 'string' && x) : [];
  } catch { return []; }
}
function parse(argv) {
  let mode = 'wrap';
  if (argv[0] === 'record' || argv[0] === 'check') mode = argv.shift();
  const o = { mode, label: '', owner: '', leads: [], stateDir: defaultStateDir(), reset: false, rc: null, lastLine: '', command: [] };
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--') { o.command = argv; break; }
    if (arg === '--label' || arg === '--owner' || arg === '--state-dir' || arg === '--rc' || arg === '--last-line' || arg === '--lead') {
      if (!argv.length || argv[0].startsWith('--')) usage();
      const value = argv.shift();
      if (arg === '--label') o.label = value;
      else if (arg === '--owner') o.owner = value;
      else if (arg === '--state-dir') o.stateDir = value;
      else if (arg === '--rc') { if (!/^-?\d+$/.test(value) || Number(value) < 0 || Number(value) > 255) usage(); o.rc = Number(value); }
      else if (arg === '--last-line') o.lastLine = value;
      else o.leads.push(value);
    } else if (arg === '--reset') o.reset = true;
    else usage();
  }
  if (!validLabel(o.label) || !o.stateDir) usage();
  if (o.mode === 'wrap' && (o.reset ? o.command.length > 0 : o.command.length === 0)) usage();
  if (o.mode === 'record' && (o.rc === null || o.reset || o.command.length)) usage();
  if (o.mode === 'check' && (o.reset || o.command.length || o.rc !== null || o.lastLine)) usage();
  return o;
}
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
const sleep = ms => Atomics.wait(sleepBuf, 0, 0, ms);
async function lock(label, dir) {
  const lockMs = Number(process.env.AUTOPILOT_RC_ALARM_LOCK_MS) > 0 ? Number(process.env.AUTOPILOT_RC_ALARM_LOCK_MS) : 30000;
  const file = path.join(dir, `${label}.lock`), end = Date.now() + lockMs;
  while (true) {
    if (Date.now() >= end) throw new Error(`timed out waiting for lock for ${label}`);
    try { const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`); return () => { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(file); } catch {} }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(file).mtimeMs > 600000) { fs.unlinkSync(file); continue; } } catch (statError) { if (statError.code === 'ENOENT') continue; }
      sleep(50);
    }
  }
}
function readCount(file, label) {
  if (!fs.existsSync(file)) return 0;
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!/^\d+$/.test(raw)) { warn(`invalid counter for ${label}; resetting`); return 0; }
  return Number(raw);
}
function recipients(o) {
  return [...new Set([...(o.leads.length ? o.leads : configuredLeads()), ...(o.owner ? [o.owner] : [])])];
}
function notify(o, message) {
  for (const addr of recipients(o)) {
    const result = spawnSync(process.env.FLEET_BIN || 'fleet', ['send', addr, message], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
    if (result.error) { warn(`fleet send failed rc=${result.error.code ?? 'unknown'}; continuing`); return; }
    if (result.status !== 0) warn(`fleet send to ${addr} failed rc=${result.status ?? 'unknown'}`);
  }
}
function stamp() { return `host=${os.hostname()} time=${new Date().toISOString()}`; }
function blocked(o, count, blockedFile) {
  const message = `[rc-alarm] ${o.label} 已連續失敗 ${count} 次，停止重試，等 lead 判斷(rc-alarm.js --reset --label ${o.label})`;
  console.error(message);
  if (!fs.existsSync(blockedFile)) {
    try { fs.writeFileSync(blockedFile, '', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') warn(`cannot persist blocked marker for ${o.label}`); }
    notify(o, `${message} ${stamp()}`);
  }
}
function update(o, count, rc, lastLine, oldCount, blockedFile) {
  const next = rc === 0 ? 0 : oldCount + 1;
  try { fs.writeFileSync(count, `${next}\n`); } catch { warn(`cannot persist counter for ${o.label}`); }
  if (next === 2 || next === 3) {
    const phrase = next === 3 ? '第 3 次失敗，之後的呼叫會被擋下，等 lead 判斷' : `連續 ${next} 次`;
    notify(o, `[rc-alarm] ${o.label} ${phrase} rc=${rc}:${lastLine} ${stamp()}`);
  } else if (rc === 0 && oldCount >= 2) {
    try { fs.unlinkSync(blockedFile); } catch {}
    notify(o, `[rc-alarm] ${o.label} recovered rc=0 ${stamp()}`);
  }
  return next;
}
function lastNonEmpty(lines) { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim(); return ''; }
async function main() {
  const o = parse(process.argv.slice(2));
  try {
    mkdirp(o.stateDir);
    fs.accessSync(o.stateDir, fs.constants.W_OK);
  } catch (error) {
    if (o.mode === 'wrap' && !o.reset) {
      warn(`cannot prepare state directory: ${o.stateDir}`);
      const child = spawn(o.command[0], o.command.slice(1), { stdio: 'inherit' });
      child.on('exit', code => process.exit(code ?? 1));
      return;
    }
    console.error(`rc-alarm: state dir unusable: ${o.stateDir} (${error.code || 'UNKNOWN'})`);
    process.exit(1);
  }
  let release;
  try { release = await lock(o.label, o.stateDir); }
  catch (error) { warn(error.message); if (o.mode === 'wrap' && !o.reset) { const child = spawn(o.command[0], o.command.slice(1), { stdio: 'inherit' }); child.on('exit', code => process.exit(code ?? 1)); return; } process.exit(1); }
  try {
    const countFile = path.join(o.stateDir, `${o.label}.count`), blockedFile = path.join(o.stateDir, `${o.label}.blocked`);
    const count = readCount(countFile, o.label);
    if (o.mode === 'check') { if (count >= 3) blocked(o, count, blockedFile); process.exitCode = count >= 3 ? 75 : 0; return; }
    if (o.reset) { fs.writeFileSync(countFile, '0\n'); try { fs.unlinkSync(blockedFile); } catch {} console.log(count); return; }
    if (o.mode === 'wrap' && count >= 3) { blocked(o, count, blockedFile); process.exitCode = 75; return; }
    if (o.mode === 'record') { update(o, countFile, o.rc, o.lastLine, count, blockedFile); return; }
    const lines = [];
    const child = spawn(o.command[0], o.command.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });
    const append = chunk => {
      const text = chunk.toString(); process.stdout.write(text);
      lines.push(...text.split(/\r?\n/)); if (lines.length > 20) lines.splice(0, lines.length - 20);
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { append(Buffer.from(`${error.message}\n`)); });
    child.on('close', code => { update(o, countFile, code ?? 1, lastNonEmpty(lines), count, blockedFile); process.exitCode = code ?? 1; });
  } finally {
    // The wrapped child keeps this process alive; release happens at process exit below.
    if (o.mode !== 'wrap' || o.reset || o.mode === 'check' || o.mode === 'record' || (process.exitCode !== undefined && process.exitCode !== 0 && process.exitCode !== 75)) release();
    else process.on('exit', release);
  }
}
main().catch(error => { warn(error.message); process.exitCode = 1; });
