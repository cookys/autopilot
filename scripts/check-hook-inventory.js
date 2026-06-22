#!/usr/bin/env node
/**
 * check-hook-inventory.js — single source of truth for autopilot's hook tally.
 *
 * Derives the canonical hook inventory from the ONLY two active-wiring sources:
 *   - hooks/hooks.json                     → default-on set
 *   - settings.example.json (hooks-opt-in-examples) → opt-in set
 *   - hooks/*.{js,sh} not in either        → disabled/orphaned set (shipped code,
 *                                            wired nowhere; e.g. v2.7.4 disable batch
 *                                            pending upstream stdin fix #6305)
 *
 * Two modes:
 *   (default)  print the derived tally + per-tier membership. This is the
 *              REGENERATION ORACLE — rebuild doc tables from this, never from memory.
 *   --check    assert that every doc's hook NUMBERS *and* per-tier MEMBERSHIP match
 *              the derived truth. Catches both count drift AND membership drift
 *              (the 2026-06-22 class: README listed the 5 disabled hooks as Tier A
 *              default-on while omitting the 5 actually-wired ones — a count-only
 *              guard would have passed it green).
 *
 * Exit: 0 = in sync (or default print) / 1 = drift found / 2 = usage / env error.
 *
 * Wired into scripts/preflight-portability.sh. When you add/remove/move a hook,
 * re-run `node scripts/check-hook-inventory.js` and rebuild the doc tables from it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(REPO, 'hooks');

// hooks/ scripts that are NOT hooks themselves (libs, tests, diagnostics, backups).
const NON_HOOK = [
  /-lib\.js$/, /\.test\.js$/, /^capture-payload\.js$/, /^_transcript-timing-probe\.js$/,
  /^transcript-reader\.test\.js$/, /\.bak$/,
];

function die(msg, code) { console.error(msg); process.exit(code === undefined ? 2 : code); }

function readJson(rel) {
  const p = path.join(REPO, rel);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(`cannot read/parse ${rel}: ${e.message}`, 2); }
}

// basename of a hook command → script stem (no extension), e.g.
// "node ${CLAUDE_PLUGIN_ROOT}/hooks/mcp-health.js pre" → "mcp-health"
function stemFromCommand(cmd) {
  const m = cmd.match(/hooks\/([A-Za-z0-9_-]+)\.(js|sh)/);
  return m ? m[1] : null;
}

function stemsFromHookBlock(eventMap) {
  const out = new Set();
  for (const event of Object.keys(eventMap || {})) {
    for (const matcher of eventMap[event]) {
      for (const h of matcher.hooks || []) {
        const s = stemFromCommand(h.command || '');
        if (s) out.add(s);
      }
    }
  }
  return out;
}

function deriveInventory() {
  const hooksJson = readJson('hooks/hooks.json');
  const settings = readJson('settings.example.json');

  const defaultOn = stemsFromHookBlock(hooksJson.hooks);
  const optIn = stemsFromHookBlock(settings['hooks-opt-in-examples']);

  // All real hook scripts on disk.
  const all = new Set();
  for (const f of fs.readdirSync(HOOKS_DIR)) {
    if (!/\.(js|sh)$/.test(f)) continue;
    if (NON_HOOK.some((re) => re.test(f))) continue;
    all.add(f.replace(/\.(js|sh)$/, ''));
  }
  const disabled = new Set([...all].filter((s) => !defaultOn.has(s) && !optIn.has(s)));

  return {
    defaultOn: [...defaultOn].sort(),
    optIn: [...optIn].sort(),
    disabled: [...disabled].sort(),
    get total() { return this.defaultOn.length + this.optIn.length + this.disabled.length; },
  };
}

function printInventory(inv) {
  console.log('Hook inventory (derived from hooks.json + settings.example.json):\n');
  console.log(`  total          : ${inv.total}`);
  console.log(`  default-on (${inv.defaultOn.length}) : ${inv.defaultOn.join(', ')}`);
  console.log(`  opt-in     (${inv.optIn.length}) : ${inv.optIn.join(', ')}`);
  console.log(`  disabled   (${inv.disabled.length}) : ${inv.disabled.join(', ')}`);
}

// ---- --check ----

function fileText(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
  catch (e) { return null; }
}

// Pull "(N default-on, M opt-in[, K disabled])" style numbers from a description string.
function tallyNums(text) {
  if (!text) return null;
  const total = text.match(/(\d+)\s*hooks?/i) || text.match(/hooks-(\d+)/);
  const don = text.match(/(\d+)\s*default-on/i) || text.match(/預設啟用[（(](\d+)/);
  const opt = text.match(/(\d+)\s*opt-in/i) || text.match(/可選啟用[（(](\d+)/);
  const dis = text.match(/(\d+)\s*disabled/i);
  return {
    total: total ? +total[1] : null,
    defaultOn: don ? +don[1] : null,
    optIn: opt ? +opt[1] : null,
    disabled: dis ? +dis[1] : null,
  };
}

function checkTally(errors, rel, lineMatch, inv, want) {
  const text = fileText(rel);
  if (text === null) { errors.push(`${rel}: not found`); return; }
  const line = text.split('\n').find((l) => lineMatch.test(l));
  if (!line) { errors.push(`${rel}: no line matching ${lineMatch}`); return; }
  const n = tallyNums(line);
  for (const key of want) {
    const expect = key === 'total' ? inv.total : inv[key].length;
    if (n[key] !== null && n[key] !== expect) {
      errors.push(`${rel}: ${key}=${n[key]} but derived ${key}=${expect}  («${line.trim().slice(0, 90)}»)`);
    }
  }
}

// English Tier headers write the tier size as "(N hooks)" — extract that and
// compare to the expected tier count (the "(N hooks)" form otherwise parses as a
// generic total and the tier assertion silently no-ops).
function checkHeaderCount(errors, rel, headerRe, expected) {
  const text = fileText(rel);
  if (text === null) { errors.push(`${rel}: not found`); return; }
  const line = text.split('\n').find((l) => headerRe.test(l));
  if (!line) { errors.push(`${rel}: no header matching ${headerRe}`); return; }
  const m = line.match(/\((\d+)\s*hooks?\)/i);
  if (!m) { errors.push(`${rel}: header has no "(N hooks)" count («${line.trim()}»)`); return; }
  if (+m[1] !== expected) errors.push(`${rel}: header count=${m[1]} but derived=${expected}  («${line.trim()}»)`);
}

// Slice the Tier-A (default-on) block out of a hooks doc and assert membership.
function checkTierAMembership(errors, rel, inv) {
  const text = fileText(rel);
  if (text === null) { errors.push(`${rel}: not found`); return; }
  // Tier A block = from a "Default-On"/"預設啟用" header to the next "Opt-In"/"可選啟用"/"Tier B" header.
  const startRe = /^#+.*(Default-On|預設啟用)/m;
  const endRe = /^#+.*(Opt-In|可選啟用|Tier B)/m;
  const s = text.search(startRe);
  if (s < 0) { errors.push(`${rel}: no Tier-A header found`); return; }
  const rest = text.slice(s + 1);
  const e = rest.search(endRe);
  const block = e < 0 ? rest : rest.slice(0, e);

  for (const name of inv.disabled) {
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`);
    if (re.test(block)) errors.push(`${rel}: DISABLED hook "${name}" is listed under Tier-A default-on (membership drift)`);
  }
  for (const name of inv.defaultOn) {
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`);
    if (!re.test(block)) errors.push(`${rel}: default-on hook "${name}" is MISSING from the Tier-A table`);
  }
}

function runCheck(inv) {
  const errors = [];
  // Canonical description lines (numbers).
  checkTally(errors, '.claude-plugin/plugin.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, 'plugin.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, '.claude-plugin/marketplace.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, 'CLAUDE.md', /default-on/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  // README badges (total) + Tier headers (per-tier count).
  checkTally(errors, 'README.md', /hooks-\d+-/, inv, ['total']);
  checkHeaderCount(errors, 'README.md', /Default-On \(\d+ hooks\)/, inv.defaultOn.length);
  checkHeaderCount(errors, 'README.md', /Opt-In \(\d+ hooks\)/, inv.optIn.length);
  checkTally(errors, 'README.zh-TW.md', /hooks-\d+-/, inv, ['total']);
  checkTally(errors, 'README.zh-TW.md', /預設啟用[（(]\d+/, inv, ['defaultOn']);
  checkTally(errors, 'README.zh-TW.md', /可選啟用[（(]\d+/, inv, ['optIn']);
  checkHeaderCount(errors, 'hooks/README.md', /Default-On \(\d+ hooks\)/, inv.defaultOn.length);
  checkHeaderCount(errors, 'hooks/README.md', /Opt-In \(\d+ hooks\)/, inv.optIn.length);
  // Membership (the count-blind class).
  checkTierAMembership(errors, 'README.md', inv);
  checkTierAMembership(errors, 'hooks/README.md', inv);

  if (errors.length) {
    console.error('Hook inventory drift:\n');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nDerived truth:');
    printInventory(inv);
    process.exit(1);
  }
  console.log(`✓ hook inventory in sync: ${inv.total} hooks (${inv.defaultOn.length} default-on, ${inv.optIn.length} opt-in, ${inv.disabled.length} disabled)`);
}

function main() {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/check-hook-inventory.js [--check]\n');
    console.log('  (no args)  print the derived canonical hook inventory (regeneration oracle)');
    console.log('  --check    assert all docs match derived counts AND per-tier membership; exit 1 on drift');
    process.exit(0);
  }
  const inv = deriveInventory();
  if (arg === '--check') return runCheck(inv);
  if (arg) die(`unknown arg: ${arg}`, 2);
  printInventory(inv);
}

main();
