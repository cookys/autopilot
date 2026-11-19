// mods/tux/golden-render.js — build the tux golden bodies from the live renderers. The test compares these bytes to golden/.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { register } = require('node:module');

const here = __dirname;
let loaded;

async function load() {
  if (loaded) return loaded;
  register('data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(typeof s==="string"&&s.startsWith(".")){try{return await n(s+".ts",c)}catch{}}throw e}}',
  ), require('node:url').pathToFileURL(__filename));
  const live = path.join(here, '..', 'live');
  loaded = {
    tabs: await import(path.join(live, 'tabs.ts')),
    i18n: await import(path.join(live, 'i18n.ts')),
    consoleMod: await import(path.join(live, 'console.ts')),
    pettab: await import(path.join(live, 'pettab.ts')),
    panel: await import(path.join(live, 'panel.ts')),
    glyphs: await import(path.join(here, 'glyphs.ts')),
    width: await import(path.join(here, 'width.ts')),
    format: await import(path.join(here, 'format.ts')),
    contract: await import(path.join(here, 'contracts', 'panel.ts')),
  };
  return loaded;
}

const stripText = (bar) => bar.tabs.map((b) => b.label.text + ' ').join('');

const WIDTH_CASES = [
  ['ambiguous-down', '\u2193'],
  ['ambiguous-star', '\u2605'],
  ['ambiguous-bar', '\u2502'],
  ['ambiguous-section', '\u00a7'],
  ['cjk', '中語龍'],
  ['emoji-cat', '🐱'],
  ['emoji-chick', '🐣'],
  ['emoji-crab', '🦀'],
  ['zwj-family', '👨\u200d👩\u200d👧'],
  ['zwj-man-computer', '👨\u200d💻'],
  ['vs16-warning', '⚠\ufe0f'],
  ['vs16-heart', '❤\ufe0f'],
  ['ansi-cjk', '\u001b[31m中\u001b[0m'],
];

const DUR_CASES = [29000, 300000, 29100000, 360000000, 2332800000, 0, -1, null];

function layout(strip) {
  return 'autopilot-live\n現況\n\n' + strip + '\n';
}

async function bodies() {
  const { tabs, i18n, consoleMod, pettab, panel, glyphs, width, format, contract } = await load();
  const t = i18n.makeT('zh-TW');
  const band = stripText(tabs.barStrip(null, t, 'now', null, true));
  const cat = glyphs.GLYPHS.pet.icons.cat;
  const icon = { id: 'cat', emoji: cat.emoji, fallback: cat.fallback, text: cat.emoji };
  const petW = width.displayWidth(' ' + cat.emoji + ' ') + 1;
  const tab80 = [
    band,
    'petIconLabel 79 ' + pettab.petIconLabel(icon, 79),
    'petIconLabel 80 ' + pettab.petIconLabel(icon, 80),
    'petTabFits 79 ' + String(tabs.petTabFits(79, t, '', petW)),
    'petTabFits 80 ' + String(tabs.petTabFits(80, t, '', petW)),
  ].join('\n') + '\n';
  const snap = consoleMod.parseConsole(fs.readFileSync(path.join(here, '..', 'live', 'fixtures', 'console', 'c0', 'console-full.json'), 'utf8'));
  if (snap === null) throw new Error('console-full.json did not parse');
  const consoleAt = (cols) => stripText(tabs.barStrip(null, t, 'command', null, true, { snap, tab: 'command', cols })) + '\n';
  const pctCases = [0.29, 0.896, 0.58].map((ratio) => ({ ratio, pctInt: format.pctInt(ratio), pct: format.pct(ratio) }));
  const durCases = DUR_CASES.map((ms) => ({ ms, dur: format.dur(ms) }));
  const widthCases = WIDTH_CASES.map(([name, text]) => ({ name, text, width: width.displayWidth(text) }));
  const now = 5000;
  const line = (text, tone) => (tone === undefined ? [{ text }] : [{ text, tone }]);
  const ok = {
    schema: contract.PANEL_SCHEMA,
    updated_at_ms: 1000,
    usage: { tiers: { 40: [line('ok')] } },
    side: { usage: { tiers: { 30: [line('side')] } } },
  };
  const withPet = {
    schema: contract.PANEL_SCHEMA,
    pet: { title: 'cat', sprite: null, tiers: { 40: [line('hp')] }, icon },
  };
  const unknownTone = {
    schema: contract.PANEL_SCHEMA,
    updated_at_ms: 1000,
    usage: { tiers: { 40: [line('keep', 'warning')] } },
  };
  const missing = { schema: contract.PANEL_SCHEMA };
  const poison = {
    schema: contract.PANEL_SCHEMA,
    updated_at_ms: 1000,
    usage: { tiers: { 40: [line('keep'), line('$1')] } },
    side: { usage: { tiers: { 30: [line('$2')] } } },
  };
  const cases = [
    { name: 'ok', fn: 'readLegacyUsage', nowMs: now, input: ok, expect: panel.readLegacyUsage(ok, now) },
    { name: 'pet-icon', fn: 'readPet', input: withPet, expect: panel.readPet(withPet) },
    { name: 'unknown-tone', fn: 'readLegacyUsage', nowMs: now, input: unknownTone, expect: panel.readLegacyUsage(unknownTone, now) },
    { name: 'missing-fields', fn: 'readPet', input: missing, expect: panel.readPet(missing) },
    { name: 'usage-side-poison', fn: 'readLegacyUsage', nowMs: now, input: poison, expect: panel.readLegacyUsage(poison, now) },
  ];
  const panelDoc = {
    schema: contract.PANEL_SCHEMA,
    tones: contract.PANEL_TONES,
    tierKeys: { panel: [...contract.PANEL_TIER_KEYS.panel], side: [...contract.PANEL_TIER_KEYS.side] },
    cases,
  };
  const out = {
    'glyphs.json': JSON.stringify(glyphs.GLYPHS, null, 2) + '\n',
    'width-cases.json': JSON.stringify({ cases: widthCases }, null, 2) + '\n',
    'pct-cases.json': JSON.stringify({ cases: pctCases }, null, 2) + '\n',
    'dur-cases.json': JSON.stringify({ cases: durCases }, null, 2) + '\n',
    'panel-cases.json': JSON.stringify(panelDoc, null, 2) + '\n',
    'tabrow-80.txt': tab80,
    'tabrow-120.txt': band + '\n',
    'tabrow-160.txt': band + '\n',
    'tabrow-console-80.txt': consoleAt(80),
    'tabrow-console-120.txt': consoleAt(120),
    'layout-bottom-80.txt': layout(band),
    'layout-bottom-120.txt': layout(band),
  };
  return out;
}

async function main() {
  const dir = path.join(here, 'golden');
  fs.mkdirSync(dir, { recursive: true });
  const out = await bodies();
  for (const [name, body] of Object.entries(out)) fs.writeFileSync(path.join(dir, name), body);
  process.stdout.write('golden-render: wrote ' + Object.keys(out).length + ' files\n');
}

if (require.main === module) main();
module.exports = { bodies, load };
