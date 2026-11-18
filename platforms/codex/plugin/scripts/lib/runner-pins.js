'use strict';

// runner-pins.js — shared loader, schema validator, binary resolver, version
// prober, and read-only autoupdate-state inspector for config/runner-pins.json.
//
// Reuses scripts/lib/runner-binary.js (the canonical owner of PATH + fallback
// binary resolution, mirroring scripts/lib/runner-fallback-bin.sh and
// scripts/probe-engine-capability.sh) so pin checks and daily smoke runs never
// invent a second binary-discovery path.
//
// Node built-ins only (Node >= 20.10). Never mutates any file or CLI state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  RUNNER_VERSION_BINARY,
  resolveBinaryPath,
  stripVersionControlChars,
} = require('./runner-binary.js');

const PIN_SCHEMA = 'autopilot.runner-pins/1';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PINS_PATH = path.join(REPO_ROOT, 'config', 'runner-pins.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pin-table runner keys that map onto a distinct canonical key in runner-binary.js.
const BINARY_RUNNER_MAP = Object.freeze({
  claude: 'claude-native',
  cursor: 'cursor',
});

// Sensitive paths relative to $HOME that autoupdate inspection must NEVER open.
const FORBIDDEN_HOME_REL = Object.freeze([
  '.codex/auth.json',
  '.claude',
  '.kimi-code',
  '.claude-profiles',
  '.config/local-llm-gateway',
  '.autopilot/endpoints.env',
  '.gemini',
]);

function validateAutoupdateSpec(runner, spec) {
  if (spec === 'none-known') return;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`runner-pins: ${runner}.autoupdate must be "none-known" or an object`);
  }
  if (typeof spec.source !== 'string' || spec.source.trim() === '') {
    throw new Error(`runner-pins: ${runner}.autoupdate requires a non-empty cited source`);
  }
  if (spec.kind === 'env') {
    if (typeof spec.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(spec.env)) {
      throw new Error(`runner-pins: ${runner}.autoupdate.env must be a valid env var name`);
    }
    if (spec.value === undefined) {
      throw new Error(`runner-pins: ${runner}.autoupdate.value is required for kind=env`);
    }
    return;
  }
  if (spec.kind === 'config') {
    if (typeof spec.file !== 'string' || spec.file.trim() === '' || path.isAbsolute(spec.file)) {
      throw new Error(`runner-pins: ${runner}.autoupdate.file must be a home-relative path`);
    }
    if (typeof spec.key !== 'string' || spec.key.trim() === '') {
      throw new Error(`runner-pins: ${runner}.autoupdate.key must be a non-empty string`);
    }
    if (spec.value === undefined) {
      throw new Error(`runner-pins: ${runner}.autoupdate.value is required for kind=config`);
    }
    if (spec.env !== undefined && (typeof spec.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(spec.env))) {
      throw new Error(`runner-pins: ${runner}.autoupdate.env must be a valid env var name`);
    }
    return;
  }
  throw new Error(`runner-pins: ${runner}.autoupdate.kind must be "config" or "env"`);
}

function validatePinTable(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('runner-pins: root must be a JSON object');
  }
  if (doc.schema !== PIN_SCHEMA) {
    throw new Error(`runner-pins: expected schema "${PIN_SCHEMA}", got ${JSON.stringify(doc.schema)}`);
  }
  if (!doc.runners || typeof doc.runners !== 'object' || Array.isArray(doc.runners)) {
    throw new Error('runner-pins: runners must be a non-empty object');
  }
  const names = Object.keys(doc.runners);
  if (names.length === 0) {
    throw new Error('runner-pins: runners must contain at least one entry');
  }
  for (const runner of names) {
    const entry = doc.runners[runner];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`runner-pins: runners.${runner} must be an object`);
    }
    if (typeof entry.bin !== 'string' || entry.bin.trim() === '') {
      throw new Error(`runner-pins: runners.${runner}.bin must be a non-empty string`);
    }
    if (!Array.isArray(entry.version_cmd) || entry.version_cmd.length === 0
        || entry.version_cmd.some((a) => typeof a !== 'string' || a === '')) {
      throw new Error(`runner-pins: runners.${runner}.version_cmd must be a non-empty string array`);
    }
    if (entry.version_cmd[0] !== entry.bin) {
      throw new Error(`runner-pins: runners.${runner}.version_cmd[0] must equal bin ("${entry.bin}")`);
    }
    const installed = entry.installed !== false;
    if (installed) {
      if (typeof entry.version !== 'string' || entry.version.trim() === '') {
        throw new Error(`runner-pins: installed runner "${runner}" requires a non-empty version string`);
      }
    } else if (entry.version !== null && typeof entry.version !== 'string') {
      throw new Error(`runner-pins: absent runner "${runner}" version must be null or string`);
    }
    validateAutoupdateSpec(runner, entry.autoupdate);
    if (typeof entry.vetted_at !== 'string' || !DATE_RE.test(entry.vetted_at)) {
      throw new Error(`runner-pins: runners.${runner}.vetted_at must be YYYY-MM-DD`);
    }
    if (typeof entry.vetted_by !== 'string' || entry.vetted_by.trim() === '') {
      throw new Error(`runner-pins: runners.${runner}.vetted_by must be a non-empty string`);
    }
  }
  return doc;
}

function loadPinTable(pinsPath = DEFAULT_PINS_PATH) {
  const resolved = path.resolve(pinsPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  return validatePinTable(parsed);
}

function scanPathForBinary(binary, pathValue) {
  if (binary.includes(path.sep)) {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
      if (fs.statSync(binary).isFile()) return path.resolve(binary);
    } catch { /* not executable */ }
    return null;
  }
  const dirs = String(pathValue || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Resolve a pin entry's executable path using scripts/lib/runner-binary.js when the
 * runner belongs to RUNNER_VERSION_BINARY, else scanning PATH only (same rule as
 * probe-engine-capability.sh for runners with no home fallback).
 */
function resolvePinBinary(runner, bin, env = process.env) {
  const mappedRunner = BINARY_RUNNER_MAP[runner] || runner;
  if (env === process.env && Object.prototype.hasOwnProperty.call(RUNNER_VERSION_BINARY, mappedRunner)) {
    return resolveBinaryPath(bin, mappedRunner);
  }
  if (mappedRunner === 'kimi' && require('./kimi-local-stop').isStopped()) {
    return null;
  }
  return scanPathForBinary(bin, env && env.PATH);
}

function isForbiddenHomeTarget(homeAbs, targetAbs) {
  const rel = path.relative(homeAbs, targetAbs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  for (const blocked of FORBIDDEN_HOME_REL) {
    if (rel === blocked || rel.startsWith(`${blocked}/`)) return true;
  }
  return false;
}

function stripJsonComments(raw) {
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < raw.length) {
        out += raw[i + 1];
        i += 1;
      } else if (ch === quote) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inStr = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1;
      if (i < raw.length) out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function readTopLevelTomlScalar(raw, key) {
  let inTable = false;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignRe = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`);
  for (const rawLine of String(raw).split(/\r?\n/)) {
    let line = '';
    let inStr = false;
    let q = '';
    for (let i = 0; i < rawLine.length; i += 1) {
      const ch = rawLine[i];
      if (inStr) {
        line += ch;
        if (ch === '\\' && i + 1 < rawLine.length) { line += rawLine[i + 1]; i += 1; }
        else if (ch === q) inStr = false;
        continue;
      }
      if (ch === '"' || ch === '\'') { inStr = true; q = ch; line += ch; continue; }
      if (ch === '#') break;
      line += ch;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\[\[?.+\]\]?$/.test(trimmed)) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const m = assignRe.exec(trimmed);
    if (!m) continue;
    const val = m[1].trim();
    if (val === 'true') return true;
    if (val === 'false') return false;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
      return val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

function envMatchesDisableValue(rawVal, expected) {
  if (rawVal === undefined || rawVal === null) return null;
  const trimmed = String(rawVal).trim();
  if (trimmed === '') return null;
  const low = trimmed.toLowerCase();
  const expLow = String(expected).trim().toLowerCase();
  if (low === expLow) return true;
  if ((expLow === '1' || expLow === 'true') && (low === '1' || low === 'true')) return true;
  if (low === '0' || low === 'false') return false;
  return false;
}

function inspectAutoupdateState(entry, options = {}) {
  const spec = entry.autoupdate;
  if (spec === 'none-known') return 'none-known';
  const env = options.env || process.env;
  const homeDir = path.resolve(options.homeDir || env.HOME || os.homedir());

  if (spec.env) {
    const expectedEnv = spec.env_value !== undefined ? spec.env_value : spec.value;
    const envMatch = envMatchesDisableValue(env[spec.env], expectedEnv);
    if (envMatch === true) return 'disabled';
    if (spec.kind === 'env') {
      return envMatch === false ? 'enabled' : 'enabled-default';
    }
  }

  if (spec.kind === 'config') {
    const targetAbs = path.resolve(homeDir, spec.file);
    if (isForbiddenHomeTarget(homeDir, targetAbs)) {
      return 'refused-sensitive-path';
    }
    let st;
    try {
      st = fs.lstatSync(targetAbs);
    } catch (err) {
      if (err && err.code === 'ENOENT') return 'unconfigured';
      return 'unreadable';
    }
    if (st.isSymbolicLink()) {
      let realTarget;
      try {
        realTarget = fs.realpathSync(targetAbs);
      } catch {
        return 'unreadable';
      }
      if (isForbiddenHomeTarget(homeDir, realTarget)) {
        return 'refused-sensitive-path';
      }
    } else if (!st.isFile()) {
      return 'unreadable';
    }
    let text;
    try {
      text = fs.readFileSync(targetAbs, 'utf8');
    } catch {
      return 'unreadable';
    }
    if (spec.file.endsWith('.toml')) {
      const found = readTopLevelTomlScalar(text, spec.key);
      if (found === undefined) return 'unconfigured';
      return found === spec.value ? 'disabled' : 'enabled';
    }
    if (spec.file.endsWith('.json') || spec.file.endsWith('.jsonc')) {
      let parsed;
      try {
        parsed = JSON.parse(stripJsonComments(text));
      } catch {
        return 'invalid-config';
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid-config';
      if (!Object.prototype.hasOwnProperty.call(parsed, spec.key)) return 'unconfigured';
      return parsed[spec.key] === spec.value ? 'disabled' : 'enabled';
    }
    return 'unconfigured';
  }

  return 'unknown';
}

function buildSanitizedProbeEnv(baseEnv, isolatedDataHome) {
  const env = { ...(baseEnv || process.env) };
  delete env.AUTOPILOT_TOKEN_SEAT;
  delete env.AUTOPILOT_SESSION_ID;
  delete env.AUTOPILOT_CHILD_SESSION_ID;
  if (isolatedDataHome) {
    env.XDG_DATA_HOME = isolatedDataHome;
  }
  return env;
}

function probeRunnerVersion(runner, entry, options = {}) {
  const env = options.env || process.env;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const binaryPath = resolvePinBinary(runner, entry.bin, env);
  if (!binaryPath) {
    return {
      found: false,
      ok: false,
      binary_path: null,
      actual: null,
      exit_code: null,
    };
  }
  const args = entry.version_cmd.slice(1);
  let run;
  let probeDataDir = '';
  try {
    probeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-pin-'));
    const childEnv = buildSanitizedProbeEnv(env, probeDataDir);
    run = spawnSync(binaryPath, args, {
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    if (probeDataDir) fs.rmSync(probeDataDir, { recursive: true, force: true });
  }
  if (run.error || run.status !== 0) {
    return {
      found: true,
      ok: false,
      binary_path: binaryPath,
      actual: null,
      exit_code: Number.isInteger(run.status) ? run.status : null,
    };
  }
  const lines = String(run.stdout || '')
    .split(/\r?\n/)
    .map((l) => stripVersionControlChars(l).trim())
    .filter(Boolean);
  const firstLine = lines.length > 0 ? lines[0] : null;
  return {
    found: true,
    ok: firstLine !== null,
    binary_path: binaryPath,
    actual: firstLine,
    exit_code: 0,
  };
}

function checkAllPins(table, options = {}) {
  const rows = [];
  let anyDrift = false;
  for (const [runner, entry] of Object.entries(table.runners)) {
    const installedExpected = entry.installed !== false;
    const pinned = entry.version === undefined ? null : entry.version;
    const probe = probeRunnerVersion(runner, entry, options);
    const autoupdateState = inspectAutoupdateState(entry, options);
    let drift = false;
    if (installedExpected) {
      drift = !probe.ok || probe.actual !== pinned;
    } else if (probe.found) {
      drift = probe.actual !== pinned;
    }
    if (drift) anyDrift = true;
    rows.push({
      runner,
      pinned,
      actual: probe.actual,
      drift,
      autoupdate_state: autoupdateState,
    });
  }
  return { ok: !anyDrift, drift: anyDrift, rows };
}

module.exports = {
  PIN_SCHEMA,
  DEFAULT_PINS_PATH,
  validatePinTable,
  loadPinTable,
  resolvePinBinary,
  inspectAutoupdateState,
  probeRunnerVersion,
  checkAllPins,
};
