#!/usr/bin/env node
'use strict';

// check-config-docs.js — two-way sync gate between the settings the code reads, the machine-readable
// registry (scripts/lib/config-keys.json) and the human reference (docs/settings-reference.md).
//
//   node scripts/check-config-docs.js [--json] [--root DIR] [--registry FILE] [--reference FILE]
//
// Exit codes: 0 = in sync, 1 = drift found, 2 = usage / unreadable or malformed registry.
// Output: human lines on stdout, or with --json one object:
//   { ok, root, counts: { registry, user, internal, env_scanned, config_scanned }, findings: [ { rule, name, detail } ] }
//
// Rules (a finding's `rule`):
//   env_unregistered       the code names an AUTOPILOT_* env var that no registry entry covers (name or `prefix`)
//   config_unregistered    a config.json property read in a config-reading file is not a segment of any registered key
//   di_unregistered        a file under project-config-template/ has no project_di entry (and is not in ignore.templates)
//   reader_missing         a registry entry lists a reader file that does not exist, or does not contain the entry's needle
//   reader_none            a registry entry lists no reader at all
//   user_undocumented      an audience=user entry is not mentioned in the reference doc
//   ignore_stale           an ignore.env / ignore.config / ignore.templates item no longer matches anything
//   registry_invalid       duplicate name, unknown kind or audience, missing required field
//
// What "the code reads" means (the scan rules; the registry header repeats them):
//   env     every `AUTOPILOT_[A-Z0-9_]+` token in a .js .ts .tsx .mjs .sh .py file under bin/ hooks/ scripts/ src/ mods/,
//           excluding test files (tests/ dirs, *.test.*, test-*, run-tests.sh), fixtures/ and node_modules/. Whole-file
//           text, so a header comment that names a knob counts as a mention. A token that ends in `_` is a dynamic-name
//           prefix and must equal an entry's `prefix`; any token starting with an entry's `prefix` is covered by it.
//   config  in the files of those roots that mention config-path / AUTOPILOT_CONFIG_FILE / .autopilot/config.json, every
//           property read `<cfg|config|conf|user|userCfg|parsed|ucfg|j|cb|rc|settings|c>.some_snake_key` or `[..'some_snake_key']`
//           whose key contains an underscore. BEST EFFORT by construction: a nested key without an underscore (review.port,
//           ui.locale, cost_fuse.mode) cannot be told apart from any other property, so it is only caught by the reverse
//           direction (a registered key must still be read), never by the forward scan.
//   di      every file in project-config-template/.
// The reverse direction is exact: each registry entry names reader files, and each reader must exist and contain the
// entry's `needle` (default: the env name or prefix, or the last dotted segment of a config key, or the template basename).

const fs = require('fs');
const path = require('path');
// Paths come from the layout registry (scripts/lib/repo-layout.js), never from literals here.
const LAYOUT = require('./lib/repo-layout.js');
const HOOKS_DIR = LAYOUT.path('hooks_dir');
const CONFIG_KEYS = LAYOUT.path('config_keys');
const SETTINGS_REFERENCE = LAYOUT.path('settings_reference');

const SCAN_ROOTS = ['bin', HOOKS_DIR, 'scripts', 'src', 'mods'];
const SCAN_EXT = /\.(js|ts|tsx|mjs|sh|py)$/;
const SKIP_DIRS = new Set(['node_modules', 'tests', '__tests__', 'fixtures', '.git']);
const CFG_VARS = 'cfg|config|conf|user|userCfg|parsed|ucfg|j|cb|rc|settings|c';
const KINDS = new Set(['config_key', 'env', 'cc_setting', 'project_di']);
const AUDIENCES = new Set(['user', 'internal']);

function usage(code) {
  const msg = 'Usage: node scripts/check-config-docs.js [--json] [--root DIR] [--registry FILE] [--reference FILE]\n'
    + '  Exit 0 = in sync, 1 = drift, 2 = usage / unreadable registry.\n';
  (code === 0 ? process.stdout : process.stderr).write(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { json: false, root: path.resolve(__dirname, '..'), registry: null, reference: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (a === '--root' || a === '--registry' || a === '--reference') {
      if (i + 1 >= argv.length) usage(2);
      o[a.slice(2)] = path.resolve(argv[++i]);
    } else usage(2);
  }
  if (!o.registry) o.registry = path.join(o.root, CONFIG_KEYS);
  if (!o.reference) o.reference = path.join(o.root, SETTINGS_REFERENCE);
  return o;
}

function isTestFile(base) {
  return /\.test\.[a-z]+$/.test(base) || /^test-/.test(base) || base === 'run-tests.sh';
}

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.isFile() && SCAN_EXT.test(e.name) && !isTestFile(e.name)) out.push(p);
  }
}

function scanFiles(root) {
  const files = [];
  for (const r of SCAN_ROOTS) walk(path.join(root, r), files);
  return files.sort();
}

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function mentions(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_.])${esc}(?![A-Za-z0-9_])`).test(text);
}

function lastSegment(name) {
  const segs = name.split('.').filter(Boolean);
  return segs[segs.length - 1].replace(/[<>]/g, '');
}

function needleOf(e) {
  if (e.needle) return e.needle;
  if (e.kind === 'env') return e.prefix || e.name;
  if (e.kind === 'project_di') return path.basename(e.template || e.name);
  return lastSegment(e.name);
}

function check(opts) {
  const findings = [];
  const add = (rule, name, detail) => findings.push({ rule, name, detail });
  let reg;
  try { reg = JSON.parse(fs.readFileSync(opts.registry, 'utf8')); }
  catch (e) { return { fatal: `cannot read registry ${opts.registry}: ${e.message}` }; }
  if (!reg || !Array.isArray(reg.entries)) return { fatal: 'registry has no entries[] array' };
  const ignore = reg.ignore || {};
  const ignEnv = ignore.env || {};
  const ignCfg = ignore.config || {};
  const ignTpl = ignore.templates || {};

  // --- registry shape
  const seen = new Set();
  for (const e of reg.entries) {
    const n = e && e.name;
    if (!n || typeof n !== 'string') { add('registry_invalid', String(n), 'entry without a name'); continue; }
    if (seen.has(n)) add('registry_invalid', n, 'duplicate name');
    seen.add(n);
    if (!KINDS.has(e.kind)) add('registry_invalid', n, `unknown kind ${JSON.stringify(e.kind)}`);
    if (!AUDIENCES.has(e.audience)) add('registry_invalid', n, `unknown audience ${JSON.stringify(e.audience)}`);
    if (e.audience === 'internal' && !e.class) add('registry_invalid', n, 'internal entry without a class');
    if (e.audience === 'user' && !(typeof e.summary === 'string' && e.summary)) add('registry_invalid', n, 'user entry without a summary');
    if (!('default' in e)) add('registry_invalid', n, 'missing default (use null when there is none)');
    if (e.kind === 'project_di' && !e.template) add('registry_invalid', n, 'project_di entry without a template path');
    if (!Array.isArray(e.readers)) add('registry_invalid', n, 'readers must be an array');
  }

  // --- reverse direction: every entry is still read
  for (const e of reg.entries) {
    if (!Array.isArray(e.readers)) continue;
    if (e.readers.length === 0) { add('reader_none', e.name, 'no reader listed'); continue; }
    const needle = needleOf(e);
    for (const r of e.readers) {
      const text = readText(path.join(opts.root, r));
      if (text === null) add('reader_missing', e.name, `reader ${r} does not exist`);
      else if (!text.includes(needle)) add('reader_missing', e.name, `reader ${r} no longer contains ${JSON.stringify(needle)}`);
    }
    if (e.kind === 'project_di' && !fs.existsSync(path.join(opts.root, e.template))) {
      add('reader_missing', e.name, `template ${e.template} does not exist`);
    }
  }

  // --- forward direction: env
  const files = scanFiles(opts.root);
  const prefixes = reg.entries.filter((e) => e.kind === 'env' && e.prefix).map((e) => e.prefix);
  const names = new Set(reg.entries.filter((e) => e.kind === 'env' && !e.prefix).map((e) => e.name));
  const envHits = new Map();
  const cfgFiles = [];
  const cfgHits = new Map();
  const cfgRe = new RegExp(`\\b(?:${CFG_VARS})\\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\\b|\\b(?:${CFG_VARS})\\[\\s*['"]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"]`, 'g');
  for (const f of files) {
    const text = readText(f);
    if (text === null) continue;
    const rel = path.relative(opts.root, f);
    for (const m of text.matchAll(/AUTOPILOT_[A-Z0-9_]+/g)) {
      if (!envHits.has(m[0])) envHits.set(m[0], rel);
    }
    if (/\.(js|ts|tsx|mjs)$/.test(f) && /config-path|AUTOPILOT_CONFIG_FILE|\.autopilot\/config\.json/.test(text)) {
      cfgFiles.push(rel);
      for (const m of text.matchAll(cfgRe)) {
        const k = m[1] || m[2];
        if (!cfgHits.has(k)) cfgHits.set(k, rel);
      }
    }
  }
  const covered = (tok) => names.has(tok) || prefixes.some((p) => tok.startsWith(p));
  for (const [tok, rel] of [...envHits].sort()) {
    if (Object.prototype.hasOwnProperty.call(ignEnv, tok)) continue;
    if (!covered(tok)) add('env_unregistered', tok, `read in ${rel} but not in the registry`);
  }
  for (const tok of Object.keys(ignEnv)) {
    if (!envHits.has(tok)) add('ignore_stale', tok, 'ignore.env item no longer appears in the code');
  }

  // --- forward direction: config keys (best effort, see header)
  const segments = new Set();
  for (const e of reg.entries) {
    if (e.kind !== 'config_key') continue;
    for (const s of e.name.split('.')) segments.add(s.replace(/[<>]/g, ''));
  }
  for (const [k, rel] of [...cfgHits].sort()) {
    if (Object.prototype.hasOwnProperty.call(ignCfg, k)) continue;
    if (!segments.has(k)) add('config_unregistered', k, `read as a config property in ${rel} but not in the registry`);
  }
  for (const k of Object.keys(ignCfg)) {
    if (!cfgHits.has(k)) add('ignore_stale', k, 'ignore.config item no longer appears as a config property read');
  }

  // --- forward direction: project-level DI templates
  const tplDir = path.join(opts.root, 'project-config-template');
  let tpls = [];
  try { tpls = fs.readdirSync(tplDir).filter((f) => fs.statSync(path.join(tplDir, f)).isFile()); } catch { /* no templates dir */ }
  const registeredTpl = new Set(reg.entries.filter((e) => e.kind === 'project_di').map((e) => e.template));
  for (const t of tpls.sort()) {
    if (Object.prototype.hasOwnProperty.call(ignTpl, t)) continue;
    if (!registeredTpl.has(`project-config-template/${t}`)) add('di_unregistered', t, 'template has no project_di entry');
  }
  for (const t of Object.keys(ignTpl)) {
    if (!tpls.includes(t)) add('ignore_stale', t, 'ignore.templates item no longer exists');
  }

  // --- reference doc: every user entry is mentioned
  const ref = readText(opts.reference);
  if (ref === null) add('user_undocumented', '*', `reference ${opts.reference} is missing`);
  else {
    for (const e of reg.entries) {
      if (e.audience === 'user' && !mentions(ref, e.name)) {
        add('user_undocumented', e.name, `audience=user but not mentioned in ${path.relative(opts.root, opts.reference)}`);
      }
    }
  }

  const user = reg.entries.filter((e) => e.audience === 'user').length;
  return {
    findings,
    counts: { registry: reg.entries.length, user, internal: reg.entries.length - user, env_scanned: envHits.size, config_scanned: cfgHits.size },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const r = check(opts);
  if (r.fatal) { process.stderr.write(`check-config-docs: ${r.fatal}\n`); process.exit(2); }
  const ok = r.findings.length === 0;
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok, root: opts.root, counts: r.counts, findings: r.findings }, null, 2)}\n`);
  } else {
    for (const f of r.findings) process.stdout.write(`FAIL ${f.rule}: ${f.name} - ${f.detail}\n`);
    const cnt = r.counts;
    process.stdout.write(`${ok ? 'OK' : 'DRIFT'}: ${cnt.registry} registered (${cnt.user} user, ${cnt.internal} internal); `
      + `${cnt.env_scanned} env tokens and ${cnt.config_scanned} config properties scanned; ${r.findings.length} finding(s)\n`);
  }
  process.exit(ok ? 0 : 1);
}

main();
