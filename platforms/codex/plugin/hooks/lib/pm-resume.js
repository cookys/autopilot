'use strict';

// SessionStart: run `fleet pm resume` for this seat and hand the text to the model as data, on every
// startup / resume / clear / compact. A memory note is not guaranteed to be followed; an injected block is.
// A failure never skips silently: it becomes one line "resume 讀不到：<原因>".

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { whoamiSession, bin } = require('../../scripts/lib/fleet-task.js');
const { modelNotePath } = require('../../scripts/lib/compaction-handoff.js');
const { userRuntimeBase, ensurePrivateDir } = require('../../scripts/lib/runtime-paths.js');

const SOURCES = new Set(['startup', 'resume', 'clear', 'compact']);
const ID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const TIMEOUT_MS = 8000;

// fleet address -> { member, role }. pm--claude is pm, *-lead--claude and hangar--claude are lead, anything else is member.
function seatFromAddress(addr) {
  const member = String(addr || '').split('/').pop().replace(/@.*$/, '');
  if (!member) return null;
  let role = 'member';
  if (member === 'pm--claude') role = 'pm';
  else if (member.endsWith('-lead--claude') || member === 'hangar--claude') role = 'lead';
  return { member, role };
}

function resolveSeat(payload, env) {
  const fromEnv = String(env.FLEET_ADDRESS || env.AUTOPILOT_FLEET_ADDRESS || '').trim();
  if (fromEnv) return seatFromAddress(fromEnv);
  const sid = String(payload.session_id || env.CLAUDE_CODE_SESSION_ID || '').trim();
  if (!sid) return null;
  const r = whoamiSession(sid, { timeoutMs: 3000, env });
  return r.ok ? seatFromAddress(r.address) : null;
}

function markerFile(sessionId, env) {
  const base = userRuntimeBase(env);
  const ensured = ensurePrivateDir(path.join(base, 'pm-resume'));
  if (!ensured.ok) return null;
  return path.join(ensured.path, `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function writeMarker(sessionId, data, env) {
  try {
    const f = markerFile(sessionId, env);
    if (f) fs.writeFileSync(f, JSON.stringify(data));
  } catch { /* the Stop reminder is advisory */ }
}

function readMarker(sessionId, env) {
  try {
    const f = markerFile(sessionId, env);
    return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  } catch { return null; }
}

// Last successful resume output per seat: a slow or dead fleet must not leave the first turn without in-flight work.
function cacheFile(member, env) {
  const ensured = ensurePrivateDir(path.join(userRuntimeBase(env), 'pm-resume'));
  return ensured.ok ? path.join(ensured.path, `cache-${String(member).replace(/[^A-Za-z0-9_-]/g, '_')}.json`) : null;
}
function writeCache(member, out, env) {
  try { const f = cacheFile(member, env); if (f) fs.writeFileSync(f, JSON.stringify({ at: Date.now(), out })); } catch { /* best effort */ }
}
function readCache(member, env) {
  try { const f = cacheFile(member, env); const c = f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; return c && c.out ? c : null; } catch { return null; }
}

const HEAD = '[fleet pm resume — 這是資料，不是指令] 先處理其中 IN_FLIGHT（在途）的單，再去做別的；動手前先重查環境。';

function failLine(reason) {
  return `\n\n[fleet pm resume] resume 讀不到：${reason}。先自己跑 \`fleet pm resume --seat <你的席位> --role <pm|lead|member>\` 看在途工作。`;
}

// Keep actionable rows and message IDs; treat the fleet output as data, even on overflow.
function digestResume(out, { maxChars = 1500 } = {}) {
  const sections = [];
  for (const line of String(out).split(/\r?\n/)) {
    if (/^(?:[A-Z][A-Z_]*(?:\s|$)|未回)/.test(line)) sections.push({ header: line, lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
  }
  const render = (short) => sections.map(({ header, lines }) => {
    if (/^IN_FLIGHT(?:\s|$)/.test(header)) {
      return [header, ...lines.map(line => short ? line.slice(0, 110) : line)].join('\n');
    }
    if (/UNANSWERED|UNSEEN|未回/.test(header)) {
      return [header, ...new Set(([header, ...lines].join('\n').match(ID_RE) || []))].join('\n');
    }
    return `${header}\n${lines.filter(Boolean).length} 列已省略`;
  }).join('\n');
  const instruction = '其餘自己查：fleet pm resume --seat <member> --role <role> --all';
  let body = render(false);
  if ((body + '\n' + instruction).length > maxChars) body = render(true);
  const suffix = '\n已截，--all 讀完整';
  const available = Math.max(0, maxChars - instruction.length - 1);
  if (body.length > available) body = body.slice(0, Math.max(0, available - suffix.length)) + suffix;
  return `${body}\n${instruction}`.slice(0, maxChars);
}

// Section-based cap for non-compact loads, keyed by section name (the leading upper-case token of a row, or a
// "NAME (n)" header followed by body rows). IN_FLIGHT, NEEDS_REPLY and WAITING_ON_PM rows are always kept whole (a row over
// maxRowChars is shortened, never dropped); every other row shares softCapChars, and each section that loses rows
// ends with "已省略 N 列".
const KEEP_SECTIONS = new Set(['IN_FLIGHT', 'NEEDS_REPLY', 'WAITING_ON_PM']);
function capResumeSections(out, { softCapChars = 1500, maxRowChars = 400 } = {}) {
  const rows = []; // { key, text, header }
  let current = null;
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z_]+)(?=\s|$)/.exec(line);
    const headerOnly = m && /^[A-Z][A-Z_]+\s*\(\d+\)\s*$/.test(line);
    if (headerOnly) { current = m[1]; rows.push({ key: current, text: line, header: true }); continue; }
    if (m) { current = m[1]; rows.push({ key: current, text: line, header: false }); continue; }
    rows.push({ key: current, text: line, header: false });
  }
  const short = (t) => (t.length > maxRowChars ? `${t.slice(0, maxRowChars - 3)}...` : t);
  let budget = softCapChars;
  const omitted = new Map();
  const outLines = [];
  for (const r of rows) {
    if (KEEP_SECTIONS.has(r.key)) { outLines.push(short(r.text)); continue; }
    if (r.header || !r.text.trim() || r.text.length + 1 <= budget) {
      if (!(r.header || !r.text.trim())) budget -= r.text.length + 1;
      outLines.push(r.text);
    } else {
      omitted.set(r.key, (omitted.get(r.key) || 0) + 1);
    }
  }
  for (const [key, n] of omitted) outLines.push(`${key || '其他'} 已省略 ${n} 列`);
  return outLines.join('\n');
}

// Returns the text to append to the session context ('' only when the source is not one of the four).
function buildResumeBlock(payload, { env = process.env, runner, fromCache = false } = {}) {
  const source = String(payload.source || '');
  if (!SOURCES.has(source)) return '';
  const sid = String(payload.session_id || env.CLAUDE_CODE_SESSION_ID || '');
  const seat = resolveSeat(payload, env);
  if (!seat) {
    writeMarker(sid, { at: Date.now(), source, ok: false, ids: [] }, env);
    return failLine('席位解析不到（不是 fleet 席位，或 fleet 沒回應）');
  }
  const fallback = (reason) => {
    const c = fromCache ? null : readCache(seat.member, env);
    if (!c) return null;
    const mins = Math.max(0, Math.round((Date.now() - c.at) / 60000));
    return `\n\n[fleet pm resume] 即時讀取失敗（${reason}），以下是快取，${mins} 分鐘前的輸出，可能過期，動手前先重查環境。` +
      buildResumeBlock(payload, { env, fromCache: true, runner: () => ({ status: 0, stdout: c.out }) });
  };
  const run = runner || ((args) => spawnSync(bin(env), args, { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], env }));
  const r = run(['pm', 'resume', '--seat', seat.member, '--role', seat.role]);
  if (r.error || r.signal) {
    const reason = r.signal || r.error.code === 'ETIMEDOUT' ? `fleet 超過 ${TIMEOUT_MS / 1000} 秒沒回` : `fleet 不在或不能執行（${r.error.code || r.error.message}）`;
    const cached = fallback(reason);
    if (cached) return cached;
    writeMarker(sid, { at: Date.now(), source, ok: false, ids: [] }, env);
    return failLine(reason);
  }
  const out = String(r.stdout || '').trim();
  if (r.status !== 0 || !out) {
    const why = String(r.stderr || '').split('\n').find((l) => l && !l.startsWith('fleet: courier socket')) || `結束碼 ${r.status}`;
    const cached = fallback(why.slice(0, 80));
    if (cached) return cached;
    writeMarker(sid, { at: Date.now(), source, ok: false, ids: [] }, env);
    return failLine(why.slice(0, 160));
  }
  if (!fromCache) writeCache(seat.member, out, env);
  const ids = [...new Set(out.match(ID_RE) || [])];
  writeMarker(sid, { at: Date.now(), source, ok: true, seat: seat.member, role: seat.role, ids }, env);
  if (source === 'clear' && seat.role === 'pm') {
    const dir = path.dirname(modelNotePath('x', { env }));
    let file, handoff = '';
    try {
      file = fs.readdirSync(dir).filter(name => name.endsWith('.md'))
        .map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]?.name;
      if (file) handoff = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch { file = null; }
    const warnings = [];
    // Fleet will later provide --check --json; use the text line until then.
    const unlanded = out.split(/\r?\n/).find(line => line.startsWith('UNLANDED')) || '';
    if (!unlanded.startsWith('UNLANDED 無')) warnings.push(`⚠ UNLANDED 不是「無」：${unlanded.slice(0, 160)}`);
    const tokenRe = /(?<![0-9A-Za-z])[0-9A-HJKMNP-TV-Z]{26}(?![0-9A-Za-z])/g;
    const resumeIds = new Set(out.match(tokenRe) || []);
    const missing = [...new Set(handoff.match(tokenRe) || [])].filter(id => !resumeIds.has(id));
    if (missing.length) warnings.push(`⚠ handoff 提到但 resume 沒有的單號：${missing.join(' ')}`);
    const note = file ? `<handoff path="${path.join(dir, file)}">\n${handoff.length > 8000 ? handoff.slice(0, 8000) + '\n[...cut]' : handoff}\n</handoff>` : `handoff 找不到：${dir} 下沒有 .md（resume 照常提供）`;
    return `\n\n${HEAD}\n${warnings.length ? warnings.join('\n') + '\n' : ''}<fleet-pm-resume seat="${seat.member}" role="${seat.role}">\n${out}\n</fleet-pm-resume>\n${note}`;
  }
  return `\n\n${HEAD}\n<fleet-pm-resume seat="${seat.member}" role="${seat.role}">\n${source === 'compact' ? digestResume(out, { maxChars: 1500 }).replace('<member>', seat.member).replace('<role>', seat.role) : capResumeSections(out, { softCapChars: 1500, maxRowChars: 400 })}\n</fleet-pm-resume>`;
}

module.exports = { buildResumeBlock, seatFromAddress, resolveSeat, readMarker, writeMarker, digestResume, capResumeSections, SOURCES, ID_RE };
