#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
function fail(message) { console.error(message); process.exit(2); }
const args = process.argv.slice(2), opts = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--checklist', '--head', '--result'].includes(args[i]) || !args[i + 1] || opts[args[i]]) fail('參數錯誤');
  opts[args[i]] = args[i + 1];
}
if (!opts['--checklist'] || !opts['--head'] || !opts['--result']) fail('缺少必要參數');
let c, result;
try { c = JSON.parse(fs.readFileSync(opts['--checklist'], 'utf8')); result = fs.readFileSync(opts['--result'], 'utf8'); } catch { fail('無法讀取清單或結果'); }
const strings = x => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0);
if (!c || c.schema !== 'autopilot.accept-checklist/1' || typeof c.repo !== 'string' || !c.repo || typeof c.base !== 'string' || !c.base || !strings(c.threshold_paths) || !Array.isArray(c.threshold_keys) || !c.threshold_keys.every(x => x && typeof x.path === 'string' && x.path && typeof x.json_pointer === 'string') || !Array.isArray(c.required_checks) || !c.required_checks.length || !c.required_checks.every(x => x && typeof x.name === 'string' && x.name && typeof x.record_path === 'string' && x.record_path) || (c.exception_patterns !== undefined && !strings(c.exception_patterns))) fail('清單格式錯誤');
function git(...a) { return spawnSync('git', ['-C', c.repo, ...a], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
function pointer(obj, p) {
  if (p === '') return obj;
  if (!p.startsWith('/') || /~(?![01])/.test(p)) throw Error();
  for (const raw of p.slice(1).split('/')) { const key = raw.replace(/~1/g, '/').replace(/~0/g, '~'); if (obj === null || typeof obj !== 'object' || !Object.hasOwn(obj, key)) throw Error(); obj = obj[key]; }
  return obj;
}
let a = true;
if (c.threshold_paths.length && git('diff', '--quiet', c.base, opts['--head'], '--', ...c.threshold_paths).status !== 0) a = false;
for (const entry of c.threshold_keys) {
  try {
    const read = ref => { const r = git('show', `${ref}:${entry.path}`); if (r.status !== 0) throw Error(); return pointer(JSON.parse(r.stdout), entry.json_pointer); };
    if (!isDeepStrictEqual(read(c.base), read(opts['--head']))) a = false;
  } catch { a = false; }
}
const failures = [];
if (!a) failures.push('(a) 門檻已變更或無法驗證');
const resolve = ref => { const r = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}'); return r.status === 0 ? r.stdout.trim() : null; };
const base = resolve(c.base), head = resolve(opts['--head']);
const ancestor = (x, y) => git('merge-base', '--is-ancestor', x, y).status === 0;
const tokens = result.match(/(?<![0-9a-fA-F])[0-9a-fA-F]{7,40}(?![0-9a-fA-F])/g) || [];
const versions = tokens.map(resolve);
if (!base || !head || base === head || !ancestor(base, head) || !versions.includes(head) || versions.some(v => !v || !ancestor(v, head))) failures.push('(b) 版本證據不符');
for (const check of c.required_checks) {
  try { const record = JSON.parse(fs.readFileSync(check.record_path, 'utf8')); if (record.schema !== 1 || record.head !== head || record.rc !== 0) throw Error(); }
  catch { failures.push(`(c) 檢查未通過：${check.name}`); }
}
let patterns;
try { patterns = (c.exception_patterns ?? ['known-red', 'skip', '--no-verify', 'bypass', 'waiver', 'allow-failure']).map(p => new RegExp(p, 'i')); } catch { fail('例外規則格式錯誤'); }
const diff = git('diff', '--no-ext-diff', '--no-color', '--unified=0', c.base, opts['--head'], '--');
if (diff.status !== 0 || diff.stdout.split('\n').some(line => line.startsWith('+') && !line.startsWith('+++') && patterns.some(p => p.test(line.slice(1))))) failures.push('(d) 發現例外或無法驗證');
if (failures.length) { console.log('REJECT'); failures.forEach(x => console.log(x)); process.exit(1); }
console.log('ACCEPT');
