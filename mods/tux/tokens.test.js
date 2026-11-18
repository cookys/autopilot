'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const UI_TS_PATH = path.join(__dirname, '..', 'live', 'ui.ts');
const CONTRACT_PATH = path.join(__dirname, '..', 'live', 'band-statusline-contract.json');
const MODEL_TS_PATH = path.join(__dirname, '..', 'live', 'model.ts');

const EXPECTED_SCHEMA = 'autopilot.tux-tokens/1';
const EXPECTED_ROLE_KEYS = [
  'attention',
  'here',
  'broken',
  'done',
  'running',
  'idle',
  'structure',
  'action',
  'stale',
  'overdue',
  'waiting_on',
  'needs_human',
  'link',
];
const EXPECTED_TERM_KEYS = [
  'pending_decision',
  'dispatch',
  'review',
  'usage',
  'pet',
  'stale',
  'overdue',
  'no_source',
  'offline',
];
const HEX_RE = /#[0-9a-fA-F]{3,8}\b|^0x[0-9a-fA-F]+$/;
const GLYPH_RE = /[\u2190-\u2bff\u25a0-\u25ff\p{Extended_Pictographic}\ufe0f\u20e3]/u;

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readTokens() {
  const raw = readText(TOKENS_PATH);
  return { raw, tokens: JSON.parse(raw) };
}

function stripTsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function parsePalette(uiText) {
  const decl = /^export const PALETTE\b[^=]*=\s*\{([^}]*)\}/m.exec(uiText);
  assert.ok(decl !== null, 'export const PALETTE = { ... } not found in mods/live/ui.ts');
  const body = stripTsComments(decl[1]).trim();
  const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(parts.length > 0, 'PALETTE in mods/live/ui.ts has no entries');
  const entries = [];
  for (const part of parts) {
    const m = /^(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\1|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*(['"])([^'"]+)\4$/.exec(part);
    assert.ok(m !== null, `unparseable PALETTE entry: ${part}`);
    entries.push([m[2] || m[3], m[5]]);
  }
  return entries;
}

function parseThemeKeys(modelText) {
  const decl = /^export type ThemeKey[ \t]*=([ \t]*[^\n]*(?:\n[ \t]*(?:\||['"])[^\n]*)*)/m.exec(modelText);
  assert.ok(decl !== null, 'export type ThemeKey = ... not found in mods/live/model.ts');
  const rhs = stripTsComments(decl[1]).replace(/;\s*$/, '').trim();
  const arms = rhs.split('|').map((s) => s.trim()).filter(Boolean);
  assert.ok(arms.length > 0, 'ThemeKey union in mods/live/model.ts has no literals');
  const keys = new Set();
  for (const arm of arms) {
    const m = /^(['"])([^'"]+)\1$/.exec(arm);
    assert.ok(m !== null, `unparseable ThemeKey literal: ${arm}`);
    keys.add(m[2]);
  }
  return keys;
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
  return out;
}

function assertPaletteParity(tokens, paletteEntries) {
  assert.ok(
    tokens && typeof tokens === 'object' && tokens.roles && typeof tokens.roles === 'object' && !Array.isArray(tokens.roles),
    'tokens.roles must be an object',
  );
  const roleKeys = Object.keys(tokens.roles);
  assert.deepEqual(roleKeys, EXPECTED_ROLE_KEYS, 'roles must have the exact 13 keys in order');
  assert.deepEqual(
    roleKeys.slice(0, paletteEntries.length),
    paletteEntries.map(([k]) => k),
    'leading roles keys must equal PALETTE keys in order',
  );
  for (const [role, themeKey] of paletteEntries) {
    assert.ok(Object.prototype.hasOwnProperty.call(tokens.roles, role), `missing PALETTE role: ${role}`);
    assert.strictEqual(tokens.roles[role], themeKey, `roles.${role} must equal PALETTE.${role}`);
  }
}

function assertThresholdsParity(tokens, contract) {
  assert.ok(
    tokens && typeof tokens === 'object' && tokens.thresholds && typeof tokens.thresholds === 'object' && !Array.isArray(tokens.thresholds),
    'tokens.thresholds must be an object',
  );
  assert.strictEqual(typeof contract.quota_warn_pct, 'number', 'quota_warn_pct must be a number');
  assert.strictEqual(typeof contract.quota_error_pct, 'number', 'quota_error_pct must be a number');
  assert.deepEqual(Object.keys(tokens.thresholds), ['warn', 'critical'], 'thresholds must have warn and critical keys');
  assert.strictEqual(tokens.thresholds.warn, contract.quota_warn_pct, 'thresholds.warn must equal quota_warn_pct');
  assert.strictEqual(tokens.thresholds.critical, contract.quota_error_pct, 'thresholds.critical must equal quota_error_pct');
}

function assertRoleThemeKeys(tokens, themeKeys) {
  assert.ok(
    tokens && typeof tokens === 'object' && tokens.roles && typeof tokens.roles === 'object' && !Array.isArray(tokens.roles),
    'tokens.roles must be an object',
  );
  const entries = Object.entries(tokens.roles);
  assert.ok(entries.length > 0, 'tokens.roles must not be empty');
  for (const [role, value] of entries) {
    assert.strictEqual(typeof value, 'string', `roles.${role} must be a string`);
    assert.ok(themeKeys.has(value), `roles.${role} value ${JSON.stringify(value)} is not in ThemeKey`);
  }
}

function assertTermsAndSchema(tokens, rawText) {
  assert.ok(tokens && typeof tokens === 'object' && !Array.isArray(tokens), 'tokens must be an object');
  assert.deepEqual(Object.keys(tokens), ['schema', 'roles', 'terms', 'thresholds'], 'top-level keys must match schema');
  assert.strictEqual(tokens.schema, EXPECTED_SCHEMA, 'schema must equal autopilot.tux-tokens/1');
  assert.ok(tokens.terms && typeof tokens.terms === 'object' && !Array.isArray(tokens.terms), 'tokens.terms must be an object');
  assert.deepEqual(Object.keys(tokens.terms), EXPECTED_TERM_KEYS, 'terms must have the exact 9 keys');
  for (const [key, val] of Object.entries(tokens.terms)) {
    assert.ok(val && typeof val === 'object' && !Array.isArray(val), `terms.${key} must be an object`);
    assert.deepEqual(Object.keys(val), ['zh-TW', 'en'], `terms.${key} must have zh-TW and en keys`);
    assert.strictEqual(typeof val['zh-TW'], 'string', `terms.${key}["zh-TW"] must be a string`);
    assert.ok(val['zh-TW'].trim().length > 0, `terms.${key}["zh-TW"] must be non-empty`);
    assert.strictEqual(typeof val.en, 'string', `terms.${key}.en must be a string`);
    assert.ok(val.en.trim().length > 0, `terms.${key}.en must be non-empty`);
  }
  for (const str of collectStrings(tokens)) {
    assert.ok(!HEX_RE.test(str), `hex value forbidden in tokens.json: ${str}`);
    assert.ok(!GLYPH_RE.test(str), `glyph forbidden in tokens.json: ${str}`);
  }
  if (rawText !== null) {
    assert.strictEqual(rawText, `${JSON.stringify(tokens, null, 2)}\n`, 'tokens.json must use two-space indent and trailing newline');
  }
}

test('1: every PALETTE entry from mods/live/ui.ts appears in roles with the same value', () => {
  const { tokens } = readTokens();
  const palette = parsePalette(readText(UI_TS_PATH));
  assertPaletteParity(tokens, palette);
});

test('2: thresholds match quota_warn_pct and quota_error_pct of mods/live/band-statusline-contract.json', () => {
  const { tokens } = readTokens();
  const contract = JSON.parse(readText(CONTRACT_PATH));
  assertThresholdsParity(tokens, contract);
});

test('3: every roles value is a ThemeKey string literal from mods/live/model.ts', () => {
  const { tokens } = readTokens();
  const themeKeys = parseThemeKeys(readText(MODEL_TS_PATH));
  assertRoleThemeKeys(tokens, themeKeys);
});

test('4: every terms entry has non-empty zh-TW and en strings; schema equals autopilot.tux-tokens/1', () => {
  const { raw, tokens } = readTokens();
  assertTermsAndSchema(tokens, raw);
});

test('negative controls: mutated roles.attention, thresholds.warn, and unknown role value each fail their check', () => {
  const { tokens } = readTokens();
  const palette = parsePalette(readText(UI_TS_PATH));
  const contract = JSON.parse(readText(CONTRACT_PATH));
  const themeKeys = parseThemeKeys(readText(MODEL_TS_PATH));

  assert.throws(() => {
    assertPaletteParity({ ...tokens, roles: { ...tokens.roles, attention: 'error' } }, palette);
  }, /roles\.attention/);

  assert.throws(() => {
    assertThresholdsParity({ ...tokens, thresholds: { ...tokens.thresholds, warn: 81 } }, contract);
  }, /thresholds\.warn/);

  assert.throws(() => {
    assertRoleThemeKeys({ ...tokens, roles: { ...tokens.roles, link: 'blue' } }, themeKeys);
  }, /not in ThemeKey/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, stale: { 'zh-TW': '', en: 'Stale' } } }, null);
  }, /non-empty/);
});
