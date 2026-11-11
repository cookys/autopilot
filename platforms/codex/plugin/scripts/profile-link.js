#!/usr/bin/env node
'use strict';
/**
 * profile-link.js - link the shared parts of ~/.claude into a Claude login profile dir.
 *
 *   node scripts/profile-link.js apply    --profile <sub> [--entries a,b]
 *   node scripts/profile-link.js status   --profile <sub>
 *   node scripts/profile-link.js rollback --profile <sub> [--all]
 *
 * Profile dir = ~/.claude-profiles/<sub>/ (a real directory). apply creates only missing symlinks to
 * ~/.claude/{settings.json,CLAUDE.md,skills,hooks,plugins,agents,commands} (entries that exist), creates the
 * profile dir if absent, and appends one run to <dir>/.profile-links.json (run_id, dir_created, links_added,
 * link metadata; no secrets). Never linked: .credentials.json, .claude.json, metrics/, projects/.
 * apply refuses an existing non-symlink (touches nothing); no relink, no --adopt. rollback undoes the newest run
 * (--all: every run, newest first): unlinks a link only when lstat says symlink and its target equals the record,
 * else skips and reports; never removes a profile dir; targets are never opened. status lists each link.
 * Exit: 0 ok, 1 refused / skipped something, 2 usage. Knobs: HOME (tests use a fixture home). Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ALLOWED = ['settings.json', 'CLAUDE.md', 'skills', 'hooks', 'plugins', 'agents', 'commands'];
const NEVER = ['.credentials.json', '.claude.json', 'metrics', 'projects'];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MANIFEST = '.profile-links.json';

class Usage extends Error {}

function parse(argv) {
  const o = { cmd: argv[0], profile: null, entries: null, all: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') o.profile = argv[++i];
    else if (a === '--entries') o.entries = String(argv[++i] || '').split(',');
    else if (a === '--all') o.all = true;
    else throw new Usage(`未知參數：${a}（沒有 --adopt，也不會取代既有檔案）`);
  }
  if (!['apply', 'status', 'rollback'].includes(o.cmd)) throw new Usage('用法：profile-link.js apply|status|rollback --profile <sub>');
  if (!o.profile || !NAME.test(o.profile) || o.profile === 'home') throw new Usage('--profile 必填，名稱限英數與 ._-，且不可為 home');
  if (o.all && o.cmd !== 'rollback') throw new Usage('--all 只用於 rollback');
  if (o.entries && o.cmd !== 'apply') throw new Usage('--entries 只用於 apply');
  return o;
}

function lstatOrNull(p) { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

function statOrNull(p) { try { return fs.statSync(p); } catch (e) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) return null; throw e; } }

function readManifest(file) {
  if (!lstatOrNull(file)) return { runs: [] };
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!m || !Array.isArray(m.runs)) throw new Error(`${MANIFEST} 格式不符`);
  return m;
}

function writeManifest(file, m) {
  if (m.runs.length === 0) { fs.unlinkSync(file); return; }
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function refusal(p) {
  return [
    `拒絕：${p} 已存在且不是符號連結，工具不會取代、搬移或刪除它。`,
    '手動處理程序（由操作員本人執行）：',
    '  1. 快照：只備份非登入檔案，例如 cp -a <該項目> <該項目>.bak（不得複製 .credentials.json / .claude.json）。',
    '  2. 影響範圍：只有該項目；該 profile 之後會改用 ~/.claude 的共用版本，原內容只剩備份。',
    '  3. 還原指令：移除符號連結後 mv <該項目>.bak <該項目>。',
    '  4. 以上由操作員自行確認後才動手；移除 profile 目錄同樣是手動步驟，本工具永不移除。',
  ].join('\n');
}

function run(argv, ctx = {}) {
  const out = ctx.out || ((s) => process.stdout.write(s + '\n'));
  const err = ctx.err || ((s) => process.stderr.write(s + '\n'));
  let o;
  try { o = parse(argv); } catch (e) { if (e instanceof Usage) { err(e.message); return 2; } throw e; }
  const home = ctx.home || os.homedir();
  const src = path.join(home, '.claude');
  const dir = path.join(home, '.claude-profiles', o.profile);
  const mfile = path.join(dir, MANIFEST);

  if (o.cmd === 'apply') {
    const names = [...new Set(o.entries || ALLOWED)];
    for (const n of names) {
      if (NEVER.includes(n)) { err(`拒絕：${n} 絕不連結（登入檔與 session 私有資料各 profile 自有）`); return 1; }
      if (!ALLOWED.includes(n)) { err(`拒絕：${n} 不在共用清單 ${ALLOWED.join(', ')}`); return 2; }
    }
    const dst = lstatOrNull(dir);
    if (dst && (!dst.isDirectory() || dst.isSymbolicLink())) { err(`拒絕：${dir} 不是真實目錄`); return 1; }
    const plan = [];
    const meta = {};
    const notes = [];
    for (const n of names) {
      const target = path.join(src, n);
      if (!lstatOrNull(target)) { notes.push(`略過 ${n}：${target} 不存在`); continue; }
      const link = path.join(dir, n);
      const cur = dst ? lstatOrNull(link) : null;
      if (!cur) { plan.push({ n, link, target }); meta[n] = { before: 'absent' }; continue; }
      if (!cur.isSymbolicLink()) { err(refusal(link)); return 1; }
      const t = fs.readlinkSync(link);
      meta[n] = { before: 'symlink', target: t };
      notes.push(t === target ? `已存在 ${n}` : `略過 ${n}：已連到別處 ${t}（不重連）`);
    }
    let manifest;
    try { manifest = readManifest(mfile); } catch (e) { err(`拒絕：${e.message}`); return 1; }
    const dirCreated = !dst;
    if (dirCreated) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const added = {};
    for (const p of plan) { fs.symlinkSync(p.target, p.link); added[p.n] = p.target; }
    if (dirCreated || plan.length) {
      manifest.runs.push({ run_id: crypto.randomUUID(), dir_created: dirCreated, links_added: added, metadata: meta });
      writeManifest(mfile, manifest);
    }
    notes.forEach(out);
    out(`apply 完成：新增 ${plan.length} 個連結${dirCreated ? '（並建立 profile 目錄）' : ''}`);
    return 0;
  }

  if (o.cmd === 'status') {
    let manifest;
    try { manifest = readManifest(mfile); } catch (e) { err(`拒絕：${e.message}`); return 1; }
    out(`profile ${o.profile}：${lstatOrNull(dir) ? dir : '目錄不存在'}；紀錄 ${manifest.runs.length} 次 run`);
    for (const n of ALLOWED) {
      const l = path.join(dir, n);
      const st = lstatOrNull(l);
      if (!st) { out(`  ${n}: 無`); continue; }
      if (!st.isSymbolicLink()) { out(`  ${n}: 非連結（真實項目）`); continue; }
      const t = fs.readlinkSync(l);
      out(`  ${n} -> ${t} ${statOrNull(l) ? '可解析' : '失效'}`);
    }
    return 0;
  }

  // rollback
  let manifest;
  try { manifest = readManifest(mfile); } catch (e) { err(`拒絕：${e.message}`); return 1; }
  if (!manifest.runs.length) { out('沒有可回復的 run'); return 0; }
  let skipped = 0;
  const todo = o.all ? manifest.runs.length : 1;
  for (let k = 0; k < todo; k++) {
    const r = manifest.runs.pop();
    for (const [n, target] of Object.entries(r.links_added).reverse()) {
      const l = path.join(dir, n);
      const st = lstatOrNull(l);
      if (!st) { out(`略過 ${n}：已不存在`); continue; }
      if (!st.isSymbolicLink() || fs.readlinkSync(l) !== target) { out(`略過 ${n}：與紀錄不符（不是原連結或已改指），未動`); skipped++; continue; }
      fs.unlinkSync(l);
      out(`已移除 ${n}`);
    }
    if (r.dir_created) out(`profile 目錄保留（空目錄不自動移除；移除屬手動步驟）：${dir}`);
  }
  writeManifest(mfile, manifest);
  return skipped ? 1 : 0;
}

if (require.main === module) process.exit(run(process.argv.slice(2)));
module.exports = { run, ALLOWED, NEVER };
