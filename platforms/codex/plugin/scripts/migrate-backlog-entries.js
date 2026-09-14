#!/usr/bin/env node
'use strict';

/**
 * migrate-backlog-entries.js — move over-cap / extra-content heading rows
 * into docs/backlog/<slug>.md sidecars without losing a byte of moved text.
 *
 * Usage:
 *   node scripts/migrate-backlog-entries.js --backlog <file>
 *     [--config <file>] [--out-dir docs/backlog] [--apply] [--json]
 *
 * Default is dry-run: print the manifest JSON and a unified diff, write nothing.
 * --apply writes only after every sidecar re-read contains moved_sha256 text.
 *
 * Exit: 0 dry-run or preserved:true · 1 apply not preserved / write failure · 2 usage
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const gate = require('./check-backlog-entries.js');
const {
  collectEntries,
  byteLen,
  checkEntry,
  mergeConfig,
  builtinConfig,
  parseConfigFile,
  gitToplevel,
} = gate;

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/migrate-backlog-entries.js --backlog <file> ' +
    '[--config <file>] [--out-dir docs/backlog] [--apply] [--json]\n'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    backlog: null,
    config: null,
    outDir: null,
    apply: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) usage(2);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage(2);
    else if (a === '--backlog') out.backlog = need();
    else if (a === '--config') out.config = need();
    else if (a === '--out-dir') out.outDir = need();
    else if (a === '--apply') out.apply = true;
    else if (a === '--json') out.json = true;
    else usage(2);
  }
  if (!out.backlog) usage(2);
  return out;
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function findDate(text, fallback) {
  const m = String(text || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

function truncBytes(s, max) {
  const str = String(s == null ? '' : s);
  if (byteLen(str) <= max) return str;
  const ell = '…';
  const budget = max - byteLen(ell);
  if (budget < 1) return ell.slice(0, max);
  let cut = Buffer.from(str, 'utf8').subarray(0, budget).toString('utf8');
  while (byteLen(cut) > budget) cut = cut.slice(0, -1);
  const sp = cut.lastIndexOf(' ');
  if (sp > 0) cut = cut.slice(0, sp);
  return cut + ell;
}

function firstSentence(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]*?[.。](?=\s|$)/);
  return m ? m[0].trim() : t;
}

function slugify(title) {
  let s = String(title || '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, '');
  if (!s) s = 'entry';
  return s;
}

function uniqueSlug(base, used) {
  let s = base;
  let n = 2;
  while (used.has(s)) {
    const suffix = '-' + n;
    const room = 80 - suffix.length;
    s = (base.slice(0, Math.max(1, room)) + suffix).replace(/-+$/g, '');
    n += 1;
  }
  used.add(s);
  return s;
}

function splitFile(text) {
  const m = text.match(/^###\s+/m);
  if (!m) return { header: text, slices: [] };
  const first = m.index;
  const header = text.slice(0, first);
  const rest = text.slice(first);
  const slices = [];
  const re = /^###\s+/gm;
  const idxs = [];
  let mm;
  while ((mm = re.exec(rest))) idxs.push(mm.index);
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i];
    const end = i + 1 < idxs.length ? idxs[i + 1] : rest.length;
    slices.push(rest.slice(start, end));
  }
  return { header, slices };
}

function bodyAfterTitle(slice) {
  const nl = slice.indexOf('\n');
  if (nl < 0) return '';
  return slice.slice(nl + 1);
}

function synthesiseStatus(fields, entryText, when) {
  const existing = fields.Status && String(fields.Status).trim();
  if (existing && /^(open|fired \d{4}-\d{2}-\d{2}|dropped \d{4}-\d{2}-\d{2}|shipped \S+ \d{4}-\d{2}-\d{2})$/.test(existing)) {
    return existing;
  }
  const trigger = String(fields.Trigger || '').trim();
  const blob = entryText;
  if (/^(\*\*)?FIRED\b/.test(trigger)) {
    return 'fired ' + findDate(blob, when);
  }
  const shippedStrike = /~~[\s\S]*?~~\s*—\s*\*\*SHIPPED/.test(blob);
  const shippedTok = blob.match(/SHIPPED\s+v?(\S+)/);
  if (shippedStrike || shippedTok) {
    let ver = 'unknown';
    const vm = blob.match(/SHIPPED\s+(v[0-9][\w.-]*|[0-9][\w.-]*)/);
    if (vm) ver = vm[1].replace(/[),.;]+$/, '');
    return 'shipped ' + ver + ' ' + findDate(blob, when);
  }
  return 'open';
}

function normaliseEffort(fields, entryText) {
  const src = [fields.Effort, entryText].filter(Boolean).join(' ');
  const m = src.match(/\b(Fix|S|M|L|H)\b/);
  return m ? m[1] : 'M';
}

// Migrate on ANY gate violation except a lone over-cap Title: a title is the entry's identity
// and moving text cannot shorten it (it goes to the ratchet allowlist instead). This is also the
// idempotence rule — a migrated row has every other field within schema, so a second run finds
// nothing but the Title cap and leaves it alone (depth-0 probe 2026-09-14: the first version
// re-migrated long-titled rows into new sidecars on every run, and skipped small rows that
// only lacked Status/Pointer).
function needsMigration(entry, cfg, repoRoot, now) {
  if (!entry || entry.unparseable) return false;
  const vios = checkEntry(entry, cfg, repoRoot, now);
  return vios.some((v) => !(v.code === 'cap_exceeded' && v.field === 'Title'));
}

function renderEntry(title, fields) {
  const order = ['Status', 'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
  const lines = [`### ${title}`];
  for (const k of order) {
    if (fields[k] == null || String(fields[k]).trim() === '') continue;
    lines.push(`- **${k}**: ${fields[k]}`);
  }
  return lines.join('\n') + '\n\n';
}

function posixRel(repoRoot, abs) {
  let rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith('..')) rel = path.basename(abs);
  return rel.split(path.sep).join('/');
}

function sidecarHeader(title, headSha, date) {
  return `# ${title}\n\nSource: docs/BACKLOG.md@${headSha}, migrated ${date}\n\n`;
}

function unifiedDiff(oldText, newText, filename) {
  if (oldText === newText) return '';
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'backlog-mig-diff-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const base = path.basename(filename);
    fs.writeFileSync(path.join(a, base), oldText);
    fs.writeFileSync(path.join(b, base), newText);
    const r = spawnSync('diff', ['-u', path.join(a, base), path.join(b, base)], {
      encoding: 'utf8',
    });
    let out = String(r.stdout || '');
    out = out.replace(new RegExp(a.replace(/[\\.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'a');
    out = out.replace(new RegExp(b.replace(/[\\.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'b');
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function loadCfg(opts, repoRoot) {
  let cfg = builtinConfig();
  let configPath = opts.config;
  if (configPath) {
    cfg = mergeConfig(cfg, parseConfigFile(configPath));
  }
  return cfg;
}

function planMigration(text, cfg, repoRoot, opts) {
  const style = cfg.style || 'heading';
  if (style === 'table' || style === 'checklist') {
    process.stderr.write('not supported yet\n');
    process.exit(2);
  }
  const { header, slices } = splitFile(text);
  const entries = collectEntries(text, style);
  const headingEntries = entries.filter((e) => !e.unparseable);
  if (headingEntries.length !== slices.length) {
    // Parser dropped or merged a block — still pair by title walk on slices.
  }
  const now = Date.now();
  const when = today();
  const headSha = gitHead(repoRoot);
  const usedSlugs = new Set();
  const outDirArg = opts.outDir || 'docs/backlog';
  const outDirAbs = path.isAbsolute(outDirArg) ? outDirArg : path.join(repoRoot, outDirArg);
  // A sidecar that already exists on disk (hand-curated, or from an earlier run) is never
  // overwritten: seed the slug set from the directory so a colliding title takes -N instead
  // (GLM review MIG-SLUG-DISK-COLLISION, 2026-09-14).
  try {
    for (const name of fs.readdirSync(outDirAbs)) {
      if (name.endsWith('.md')) usedSlugs.add(name.slice(0, -3));
    }
  } catch { /* out-dir absent: nothing to seed */ }

  const planned = [];
  const outSlices = [];
  const sidecars = [];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const parsed = collectEntries(slice, 'heading').find((e) => !e.unparseable) || {
      fields: {},
      extra: true,
      text: slice,
      title: slice.replace(/^###\s+/, '').split('\n')[0].trim(),
      unparseable: false,
    };
    const fields = Object.assign({}, parsed.fields || {});
    const titleRaw = (fields.Title || parsed.title || '').replace(/[.。]\s*$/, '');
    const migrate = needsMigration(parsed, cfg, repoRoot, now);
    const bytesBefore = byteLen(slice);
    if (!migrate) {
      outSlices.push(slice);
      planned.push({
        title: fields.Title || parsed.title || '',
        slug: null,
        bytes_before: bytesBefore,
        bytes_after: bytesBefore,
        moved_bytes: 0,
        moved_sha256: sha256(''),
        sidecar: null,
      });
      continue;
    }
    const moved = bodyAfterTitle(slice);
    const slug = uniqueSlug(slugify(titleRaw), usedSlugs);
    const sidecarAbs = path.join(outDirAbs, slug + '.md');
    const pointer = posixRel(repoRoot, sidecarAbs);
    const status = synthesiseStatus(fields, slice, when);
    const effort = normaliseEffort(fields, slice);
    const source = truncBytes(fields.Source || '', 160);
    let trigger = truncBytes(fields.Trigger || 'see pointer', 240);
    const ctxFull = fields.Context || '';
    let context = firstSentence(ctxFull);
    if (context) context = truncBytes(context, 240);
    const rowFields = {
      Status: status,
      Trigger: trigger,
      Effort: effort,
      Source: source || 'unknown',
      Pointer: pointer,
    };
    if (context) rowFields.Context = context;
    let rewritten = renderEntry(titleRaw, rowFields);
    if (byteLen(rewritten) > 900 && rowFields.Context) {
      delete rowFields.Context;
      rewritten = renderEntry(titleRaw, rowFields);
    }
    while (byteLen(rewritten) > 900 && byteLen(rowFields.Trigger) > 20) {
      rowFields.Trigger = truncBytes(rowFields.Trigger.replace(/…$/, ''), Math.max(20, byteLen(rowFields.Trigger) - 32));
      rewritten = renderEntry(titleRaw, rowFields);
    }
    outSlices.push(rewritten);
    const body = sidecarHeader(titleRaw, headSha, when) + moved;
    const sidecarBody = body.endsWith('\n') ? body : body + '\n';
    sidecars.push({ abs: sidecarAbs, contents: sidecarBody, moved });
    planned.push({
      title: titleRaw,
      slug,
      bytes_before: bytesBefore,
      bytes_after: byteLen(rewritten),
      moved_bytes: byteLen(moved),
      moved_sha256: sha256(moved),
      sidecar: pointer,
    });
  }

  const newText = header + outSlices.join('');
  const migrateCount = planned.filter((e) => e.moved_bytes > 0 || e.sidecar).length;
  const manifest = {
    preserved: opts.apply ? null : null,
    entries: planned,
    totals: {
      entries: planned.length,
      migrate: migrateCount,
      moved_bytes: planned.reduce((n, e) => n + e.moved_bytes, 0),
      bytes_before: byteLen(text),
      bytes_after: byteLen(newText),
    },
  };
  return { newText, sidecars, planned, manifest, outDirAbs, when, migrateCount };
}

function applyWrites(backlogPath, newText, sidecars, manifest, outDirAbs, when) {
  const writtenTmp = [];
  // Every rename target is tracked as well: a failure after the first rename must remove the
  // sidecars and manifest already in place, or "nothing written on failure" is false
  // (GLM review MIG-RENAME-ROLLBACK). The backlog is renamed LAST, so it is either the old
  // bytes or the complete new state.
  const renamed = [];
  const rollbackTmp = () => {
    for (const t of writtenTmp) {
      try { fs.unlinkSync(t); } catch { /* ignore */ }
    }
    for (const t of renamed) {
      try { fs.unlinkSync(t); } catch { /* ignore */ }
    }
  };
  if (!sidecars.length) {
    // Nothing to move: no out-dir, no manifest, no byte-identical rewrite (MIG-EMPTY-APPLY-ARTIFACTS).
    return { ok: true, preserved: true, noop: true };
  }
  try {
    fs.mkdirSync(outDirAbs, { recursive: true });
    for (const s of sidecars) {
      fs.mkdirSync(path.dirname(s.abs), { recursive: true });
      const tmp = s.abs + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
      fs.writeFileSync(tmp, s.contents);
      writtenTmp.push(tmp);
      s.tmp = tmp;
    }
    const manAbs = path.join(outDirAbs, 'MIGRATION-' + when + '.json');
    const manTmp = manAbs + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    const blTmp = backlogPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');

    let preserved = true;
    for (const s of sidecars) {
      const disk = fs.readFileSync(s.tmp, 'utf8');
      if (!disk.includes(s.moved)) {
        preserved = false;
        break;
      }
    }
    if (!preserved) {
      rollbackTmp();
      return { ok: false, preserved: false };
    }

    fs.writeFileSync(manTmp, JSON.stringify(Object.assign({}, manifest, { preserved: true }), null, 2) + '\n');
    writtenTmp.push(manTmp);
    fs.writeFileSync(blTmp, newText);
    writtenTmp.push(blTmp);

    for (const s of sidecars) {
      if (fs.existsSync(s.abs)) throw new Error(`refusing to overwrite existing sidecar ${s.abs}`);
      fs.renameSync(s.tmp, s.abs);
      renamed.push(s.abs);
      writtenTmp.splice(writtenTmp.indexOf(s.tmp), 1);
    }
    fs.renameSync(manTmp, manAbs);
    renamed.push(manAbs);
    writtenTmp.splice(writtenTmp.indexOf(manTmp), 1);
    fs.renameSync(blTmp, backlogPath);
    return { ok: true, preserved: true };
  } catch (e) {
    rollbackTmp();
    process.stderr.write(String(e.message || e) + '\n');
    return { ok: false, preserved: false };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const backlogPath = path.resolve(args.backlog);
  let text;
  try {
    text = fs.readFileSync(backlogPath, 'utf8');
  } catch (e) {
    process.stderr.write(`unreadable backlog: ${e.message}\n`);
    process.exit(2);
  }
  const repoRoot = gitToplevel(path.dirname(backlogPath)) || path.dirname(backlogPath);
  let cfg;
  try {
    cfg = loadCfg(args, repoRoot);
  } catch (e) {
    process.stderr.write(`unreadable config: ${e.message}\n`);
    process.exit(2);
  }

  let planned;
  try {
    planned = planMigration(text, cfg, repoRoot, args);
  } catch (e) {
    if (e && e.exitCode === 2) process.exit(2);
    throw e;
  }

  if (!args.apply) {
    planned.manifest.preserved = null;
    // Synchronous writes: a 60 KB+ manifest through a pipe followed by process.exit() was
    // truncated at the 64 KiB pipe buffer (suite case (j), 2026-09-14). fs.writeSync blocks
    // until the kernel has every byte.
    fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
    if (!args.json) {
      const diff = unifiedDiff(text, planned.newText, backlogPath);
      if (diff) fs.writeSync(1, diff);
    }
    process.exit(0);
  }

  const result = applyWrites(
    backlogPath,
    planned.newText,
    planned.sidecars,
    planned.manifest,
    planned.outDirAbs,
    planned.when
  );
  planned.manifest.preserved = result.preserved;
  fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
  process.exit(result.ok && result.preserved ? 0 : 1);
}

if (require.main === module) main();
