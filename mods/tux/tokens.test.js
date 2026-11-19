'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const UI_TS_PATH = path.join(__dirname, 'palette.ts');
const CONTRACT_PATH = path.join(__dirname, '..', 'live', 'band-statusline-contract.json');
const MODEL_TS_PATH = path.join(__dirname, '..', 'live', 'model.ts');

const EXPECTED_SCHEMA = 'autopilot.tux-tokens/1';
const EXPECTED_TOP_LEVEL_KEYS = ['schema', 'roles', 'glyphs', 'terms', 'thresholds'];
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
const EXPECTED_STATE_GLYPH_KEYS = [
  'done',
  'running',
  'idle',
  'waiting_on',
  'needs_human',
  'attention',
  'broken',
  'overdue',
  'stale',
  'offline',
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
  'unmeasured',
  'read_at',
  'source',
  'target',
  'measured',
  'gap',
  'just_now',
  'minutes_ago',
  'expired',
  'hidden_detail',
];
const NEW_TERM_KEYS = [
  'unmeasured',
  'read_at',
  'source',
  'target',
  'measured',
  'gap',
  'just_now',
  'minutes_ago',
  'expired',
  'hidden_detail',
];
const HEX_RE = /#[0-9a-fA-F]{3,8}\b|^0x[0-9a-fA-F]+$/;
const GLYPH_RE = /[\u2190-\u2bff\u25a0-\u25ff\p{Extended_Pictographic}\ufe0f\u20e3]/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;
const ASCII_ALNUM_RE = /^[A-Za-z0-9]$/;

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
  assert.ok(decl !== null, 'export const PALETTE = { ... } not found in mods/tux/palette.ts');
  const body = stripTsComments(decl[1]).trim();
  const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(parts.length > 0, 'PALETTE in mods/tux/palette.ts has no entries');
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
  for (const [role, themeKey] of paletteEntries) {
    assert.strictEqual(tokens.roles[role], themeKey, `roles.${role} must equal PALETTE.${role}`);
  }
  assert.deepEqual(
    paletteEntries.map(([k]) => k),
    roleKeys,
    'PALETTE keys must equal every roles key in order',
  );
  assert.deepEqual(Object.fromEntries(paletteEntries), tokens.roles, 'PALETTE must equal tokens.roles');
}

function parseThresholds(paletteText) {
  const decl = /export const THRESHOLDS = \{([^}]*)\}/.exec(paletteText);
  assert.ok(decl !== null, 'export const THRESHOLDS not found in mods/tux/palette.ts');
  const out = {};
  for (const part of decl[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    assert.ok(m !== null, `unparseable THRESHOLDS entry: ${part}`);
    out[m[1]] = Number(m[2]);
  }
  return out;
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

function assertStateGlyphs(tokens) {
  assert.ok(
    tokens && typeof tokens === 'object' && tokens.glyphs && typeof tokens.glyphs === 'object' && !Array.isArray(tokens.glyphs),
    'tokens.glyphs must be an object',
  );
  assert.deepEqual(Object.keys(tokens.glyphs), ['state'], 'tokens.glyphs must have only the state key');
  const stateGlyphs = tokens.glyphs.state;
  assert.ok(
    stateGlyphs && typeof stateGlyphs === 'object' && !Array.isArray(stateGlyphs),
    'tokens.glyphs.state must be an object',
  );
  assert.deepEqual(
    Object.keys(stateGlyphs),
    EXPECTED_STATE_GLYPH_KEYS,
    'glyphs.state must have the exact 10 keys',
  );
  const seen = new Set();
  for (const [key, val] of Object.entries(stateGlyphs)) {
    assert.strictEqual(typeof val, 'string', `glyphs.state.${key} must be a string`);
    assert.ok(!val.includes('\uFE0F'), `glyphs.state.${key} must not contain U+FE0F`);
    assert.strictEqual(Array.from(val).length, 1, `glyphs.state.${key} must be a single Unicode code point`);
    assert.ok(!EMOJI_PRESENTATION_RE.test(val), `glyphs.state.${key} must not match Emoji_Presentation`);
    assert.ok(!EXTENDED_PICTOGRAPHIC_RE.test(val), `glyphs.state.${key} must not match Extended_Pictographic`);
    assert.ok(!ASCII_ALNUM_RE.test(val), `glyphs.state.${key} must not be an ASCII letter or digit`);
    seen.add(val);
  }
  assert.strictEqual(seen.size, EXPECTED_STATE_GLYPH_KEYS.length, 'glyphs.state values must all be distinct');
}

function assertTermsAndSchema(tokens, rawText) {
  assert.ok(tokens && typeof tokens === 'object' && !Array.isArray(tokens), 'tokens must be an object');
  assert.deepEqual(Object.keys(tokens), EXPECTED_TOP_LEVEL_KEYS, 'top-level keys must match schema');
  assert.strictEqual(tokens.schema, EXPECTED_SCHEMA, 'schema must equal autopilot.tux-tokens/1');
  assert.ok(tokens.terms && typeof tokens.terms === 'object' && !Array.isArray(tokens.terms), 'tokens.terms must be an object');
  assert.deepEqual(Object.keys(tokens.terms), EXPECTED_TERM_KEYS, 'terms must have the exact 19 keys');
  for (const [key, val] of Object.entries(tokens.terms)) {
    assert.ok(val && typeof val === 'object' && !Array.isArray(val), `terms.${key} must be an object`);
    assert.deepEqual(Object.keys(val), ['zh-TW', 'en'], `terms.${key} must have zh-TW and en keys`);
    assert.strictEqual(typeof val['zh-TW'], 'string', `terms.${key}["zh-TW"] must be a string`);
    assert.ok(val['zh-TW'].trim().length > 0, `terms.${key}["zh-TW"] must be non-empty`);
    assert.strictEqual(typeof val.en, 'string', `terms.${key}.en must be a string`);
    assert.ok(val.en.trim().length > 0, `terms.${key}.en must be non-empty`);
  }
  for (const key of NEW_TERM_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(tokens.terms, key), `missing new term: ${key}`);
    assert.ok(tokens.terms[key]['zh-TW'].trim().length > 0, `terms.${key}["zh-TW"] must be non-empty`);
    assert.ok(tokens.terms[key].en.trim().length > 0, `terms.${key}.en must be non-empty`);
  }
  assert.ok(tokens.terms.minutes_ago['zh-TW'].includes('{n}'), 'terms.minutes_ago["zh-TW"] must contain {n}');
  assert.ok(tokens.terms.minutes_ago.en.includes('{n}'), 'terms.minutes_ago.en must contain {n}');
  for (const str of collectStrings(tokens)) {
    assert.ok(!HEX_RE.test(str), `hex value forbidden in tokens.json: ${str}`);
  }
  const { glyphs: _glyphs, ...nonGlyphTokens } = tokens;
  for (const str of collectStrings(nonGlyphTokens)) {
    assert.ok(!GLYPH_RE.test(str), `glyph forbidden outside glyphs in tokens.json: ${str}`);
  }
  if (rawText !== null) {
    assert.strictEqual(rawText, `${JSON.stringify(tokens, null, 2)}\n`, 'tokens.json must use two-space indent and trailing newline');
  }
}

test('1: PALETTE in mods/tux/palette.ts equals tokens.roles (strict, every key)', () => {
  const { tokens } = readTokens();
  const palette = parsePalette(readText(UI_TS_PATH));
  assertPaletteParity(tokens, palette);
});

test('2: thresholds match quota_warn_pct and quota_error_pct of mods/live/band-statusline-contract.json', () => {
  const { tokens } = readTokens();
  const contract = JSON.parse(readText(CONTRACT_PATH));
  assertThresholdsParity(tokens, contract);
  assert.deepEqual(parseThresholds(readText(UI_TS_PATH)), tokens.thresholds, 'THRESHOLDS must equal tokens.thresholds');
});

test('3: every roles value is a ThemeKey string literal from mods/live/model.ts', () => {
  const { tokens } = readTokens();
  const themeKeys = parseThemeKeys(readText(MODEL_TS_PATH));
  assertRoleThemeKeys(tokens, themeKeys);
});

test('4: every terms entry has non-empty zh-TW and en strings; minutes_ago keeps {n}; schema equals autopilot.tux-tokens/1', () => {
  const { raw, tokens } = readTokens();
  assertTermsAndSchema(tokens, raw);
});

test('5: glyphs.state has the exact 10 distinct single-code-point non-emoji marks', () => {
  const { tokens } = readTokens();
  assertStateGlyphs(tokens);
});

test('negative controls: mutated roles.attention, thresholds.warn, glyphs.state, minutes_ago, and unknown role value each fail their check', () => {
  const { tokens } = readTokens();
  const palette = parsePalette(readText(UI_TS_PATH));
  const contract = JSON.parse(readText(CONTRACT_PATH));
  const themeKeys = parseThemeKeys(readText(MODEL_TS_PATH));

  assert.throws(() => {
    assertPaletteParity({ ...tokens, roles: { ...tokens.roles, attention: 'error' } }, palette);
  }, /roles\.attention/);

  assert.throws(() => {
    assertPaletteParity(tokens, palette.filter(([role]) => role !== 'link'));
  }, /PALETTE keys must equal every roles key/);

  assert.throws(() => {
    assertThresholdsParity({ ...tokens, thresholds: { ...tokens.thresholds, warn: 81 } }, contract);
  }, /thresholds\.warn/);

  assert.throws(() => {
    assertRoleThemeKeys({ ...tokens, roles: { ...tokens.roles, link: 'blue' } }, themeKeys);
  }, /not in ThemeKey/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, stale: { 'zh-TW': '', en: 'Stale' } } }, null);
  }, /non-empty/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, unmeasured: { 'zh-TW': '未量測', en: '   ' } } }, null);
  }, /non-empty/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, minutes_ago: { 'zh-TW': '5 分鐘前', en: '{n} min ago' } } }, null);
  }, /minutes_ago\["zh-TW"\] must contain \{n\}/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, minutes_ago: { 'zh-TW': '{n} 分鐘前', en: '5 min ago' } } }, null);
  }, /minutes_ago\.en must contain \{n\}/);

  assert.throws(() => {
    assertTermsAndSchema({ ...tokens, terms: { ...tokens.terms, gap: { 'zh-TW': '✓ 差距', en: 'Gap' } } }, null);
  }, /glyph forbidden/);

  const { glyphs: _removedGlyphs, ...withoutGlyphs } = tokens;
  assert.throws(() => {
    assertStateGlyphs(withoutGlyphs);
  }, /tokens\.glyphs must be an object/);

  const { offline: _removedOffline, ...nineGlyphs } = tokens.glyphs.state;
  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: nineGlyphs } });
  }, /exact 10 keys/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, running: tokens.glyphs.state.done } } });
  }, /distinct/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: '✓\uFE0F' } } });
  }, /U\+FE0F/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: '✓✓' } } });
  }, /single Unicode code point/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: '' } } });
  }, /single Unicode code point/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: '✅' } } });
  }, /Emoji_Presentation/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, broken: '⚙' } } });
  }, /Extended_Pictographic/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: 'x' } } });
  }, /ASCII letter or digit/);

  assert.throws(() => {
    assertStateGlyphs({ ...tokens, glyphs: { state: { ...tokens.glyphs.state, done: '7' } } });
  }, /ASCII letter or digit/);
});
