#!/usr/bin/env node
/**
 * check-hook-inventory.js — single source of truth for autopilot's hook tally.
 *
 * Derives the canonical hook inventory from the active-wiring sources:
 *   - hooks/hooks.json                     → ALL wired hooks
 *   - hooks/opt-in-manifest.json (opt_in)  → which wired hooks are OPT-IN
 *                                            (default-off, self-gated via
 *                                            _shared/opt-in.js). default-on = wired
 *                                            MINUS opt-in. As of v2.26.2 every opt-in
 *                                            hook is wired in hooks.json too (the
 *                                            settings.example.json copy-paste route
 *                                            was unusable — ${CLAUDE_PLUGIN_ROOT}
 *                                            never expands in a user's settings.json).
 *   - hooks/*.{js,sh} not wired in hooks.json → disabled/orphaned set (shipped code,
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
  /^opt-in-multiplexer\.js$/, // D6 infrastructure, not a user-facing hook stem
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

// D6: the per-event opt-in multiplexer owns these stems. When the multiplexer is
// wired for an event, each listed stem counts as wired (direct registrations are
// removed to avoid spawning disabled opt-in handlers on every tool call).
const MULTIPLEXER_EVENT_TABLE = {
  PreToolUse: [
    'branch-protection', 'exec-boundary', 'commit-secret-scan', 'large-file-warner',
    'config-protection', 'mcp-health', 'dispatch-model-guard', 'orchestrator-edit-gate',
  ],
  PostToolUse: [
    'context-budget', 'accumulator', 'test-runner', 'design-quality',
  ],
  PostToolUseFailure: ['mcp-health'],
  Stop: [
    'cost-tracker', 'session-summary', 'check-console', 'batch-format',
  ],
};

function stemsFromHookBlock(eventMap) {
  const out = new Set();
  for (const event of Object.keys(eventMap || {})) {
    for (const matcher of eventMap[event]) {
      for (const h of matcher.hooks || []) {
        const s = stemFromCommand(h.command || '');
        if (!s) continue;
        if (s === 'opt-in-multiplexer') {
          // Expand multiplexed opt-in membership for this event.
          for (const stem of (MULTIPLEXER_EVENT_TABLE[event] || [])) out.add(stem);
          continue;
        }
        out.add(s);
      }
    }
  }
  return out;
}

function deriveInventory() {
  const hooksJson = readJson('hooks/hooks.json');
  const manifest = readJson('hooks/opt-in-manifest.json');

  // Everything actually wired in hooks.json.
  const wired = stemsFromHookBlock(hooksJson.hooks);

  // The opt-in subset is declared in the manifest (default-off, self-gated).
  const optInList = Array.isArray(manifest.opt_in) ? manifest.opt_in : [];
  const optIn = new Set(optInList);

  // Contract: every manifest opt-in stem MUST be wired in hooks.json. A stem listed
  // opt-in but unwired would silently vanish from BOTH tiers (not in default-on
  // because it's opt-in; not actually wired) — fail closed rather than miscount.
  const unwired = optInList.filter((s) => !wired.has(s));
  if (unwired.length) die(`opt-in-manifest.json lists hooks not wired in hooks.json: ${unwired.join(', ')}`, 2);

  // Default-on = wired minus the opt-in subset.
  const defaultOn = new Set([...wired].filter((s) => !optIn.has(s)));

  // All real hook scripts on disk; disabled = on disk but wired nowhere.
  const all = new Set();
  for (const f of fs.readdirSync(HOOKS_DIR)) {
    if (!/\.(js|sh)$/.test(f)) continue;
    if (NON_HOOK.some((re) => re.test(f))) continue;
    all.add(f.replace(/\.(js|sh)$/, ''));
  }
  const disabled = new Set([...all].filter((s) => !wired.has(s)));

  return {
    defaultOn: [...defaultOn].sort(),
    optIn: [...optIn].sort(),
    disabled: [...disabled].sort(),
    get total() { return this.defaultOn.length + this.optIn.length + this.disabled.length; },
  };
}

function printInventory(inv) {
  console.log('Hook inventory (derived from hooks.json + opt-in-manifest.json):\n');
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
  const dis = text.match(/(\d+)\s*(?:shipped-but-)?disabled/i);
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

function checkTierBMembership(errors, rel, inv) {
  const text = fileText(rel);
  if (text === null) { errors.push(`${rel}: not found`); return; }
  // Tier B block = from an "Opt-In"/"可選啟用"/"Tier B" header to the next top-level
  // "## " section header (e.g. "## Secret Patterns") or EOF. Symmetric to the Tier-A
  // check so a renamed/dropped opt-in name can't pass green (the count-blind class, Tier B).
  const startRe = /^#+.*(Opt-In|可選啟用|Tier B)/m;
  const s = text.search(startRe);
  if (s < 0) { errors.push(`${rel}: no Tier-B header found`); return; }
  const rest = text.slice(s + 1);
  const e = rest.search(/^## /m);
  const block = e < 0 ? rest : rest.slice(0, e);

  for (const name of inv.disabled) {
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`);
    if (re.test(block)) errors.push(`${rel}: DISABLED hook "${name}" is listed under Tier-B opt-in (membership drift)`);
  }
  for (const name of inv.optIn) {
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`);
    if (!re.test(block)) errors.push(`${rel}: opt-in hook "${name}" is MISSING from the Tier-B table`);
  }
}

function runCheck(inv) {
  const errors = [];
  // Canonical description lines (numbers).
  checkTally(errors, '.claude-plugin/plugin.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, 'plugin.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, '.claude-plugin/marketplace.json', /"description"/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  checkTally(errors, 'CLAUDE.md', /default-on/, inv, ['total', 'defaultOn', 'optIn', 'disabled']);
  // README badges (total) only. As of v2.25.12 the README pair is a slim onboarding
  // surface — the hooks Tier tables + intro tally + Tier-A membership were relocated to
  // hooks/README.md, which is now the SOLE doc whose hook BODY is asserted here. Both
  // READMEs still carry the hooks-<N> hero badge, so the total stays pinned on them.
  checkTally(errors, 'README.md', /hooks-\d+-/, inv, ['total']);
  checkTally(errors, 'README.zh-TW.md', /hooks-\d+-/, inv, ['total']);
  // hooks/README.md — canonical hooks doc: intro PROSE tally + Tier headers + Tier-A
  // membership (the count-blind class — 2026-06-22). A stale prose number escaped both
  // gates once (v2.23.0); the intro-tally regex survives the disabled tier going to zero.
  checkTally(errors, 'hooks/README.md', /opt-in\*\* \(Tier B/, inv, ['defaultOn', 'optIn']);
  checkHeaderCount(errors, 'hooks/README.md', /Default-On \(\d+ hooks\)/, inv.defaultOn.length);
  checkHeaderCount(errors, 'hooks/README.md', /Opt-In \(\d+ hooks\)/, inv.optIn.length);
  checkTierAMembership(errors, 'hooks/README.md', inv);
  checkTierBMembership(errors, 'hooks/README.md', inv);

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
