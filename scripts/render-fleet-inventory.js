#!/usr/bin/env node
'use strict';

// render-fleet-inventory.js — host list and quota-pool list for a PM report.
// Machine output only. Never invent a host or a pool, never coerce a missing
// percentage to 0, never sum percentages across pools.
//
//   node scripts/render-fleet-inventory.js [--pace <file>] [--seats <file>] [--format md|tsv]
//   node scripts/render-fleet-inventory.js --check <report.md> [--pace <file>] [--seats <file>]
//
// Precedence: flags, then AUTOPILOT_INVENTORY_PACE / AUTOPILOT_INVENTORY_SEATS, then
//   ~/projects/capacity/out/pace.v1.json
//   ~/.local/state/hangar-seats/seats-overlay.tsv
// Pace schema must be "capacity.pace/1" (else `!! pace schema 不符`). Row fields read:
// id, pool, display_name, class, used_pct, expected_pct, gap_pts, reset_at, seen_at,
// stale, status. used_pct null or absent prints 未知. Seats is a TSV with header
// member, host, claude_config_dir, pool, reset, sampled_at; claude_config_dir is not
// printed. Times are Asia/Taipei, +08:00, never Z.
// An unreadable input prints `!! <name> 不可讀（<reason>）` in place of that table and
// exits 0. Neither input readable exits 3 with one reason line on stderr.
// Inputs older than 2 h (generated_at, or the max sampled_at) append
// （資料已 N 小時未更新） to the stamp line.
//
// --check is the gate a report writer runs before sending. The report must contain
// a stamp line this script produced. Each half matches the current input: a sha16
// (first 16 hex of sha256 of the file) or 「不可讀」 while that input is still
// unreadable. Otherwise exit 1: the host/pool list was hand-typed or stale; paste
// this script's output instead of typing a list.
//
// Exit: 0 rendered (or check passed), 1 check failed, 2 usage, 3 neither input readable.
// Node built-ins only.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACE_SCHEMA = 'capacity.pace/1';
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TAIPEI_MS = 8 * HOUR_MS;
const CHECK_FAIL = '主機與配額池清單是手打或已過期；請改貼 scripts/render-fleet-inventory.js 的輸出，不要手打。\n';
const STAMP_RE = /^來源：pace (?:generated_at \S+ sha16 ([0-9a-f]{16})|不可讀)；seats (?:sampled_at max \S+ sha16 ([0-9a-f]{16})|不可讀)(?:（資料已 \d+ 小時未更新）)?$/;
const SEAT_COLUMNS = ['member', 'host', 'claude_config_dir', 'pool', 'reset', 'sampled_at'];
const HOST_HEADERS = ['host', 'members', 'pools', 'sampled_at'];
const POOL_HEADERS = ['display_name', 'class', '用量', '預期', '差距', '重置（台北）', '狀態', 'stale'];

function help() {
  process.stdout.write(
    'scripts/render-fleet-inventory.js — 從機器輸出印主機清單與配額池清單\n'
    + '\n'
    + '  node scripts/render-fleet-inventory.js [--pace <file>] [--seats <file>] [--format md|tsv]\n'
    + '  node scripts/render-fleet-inventory.js --check <report.md> [--pace <file>] [--seats <file>]\n'
    + '\n'
    + '旗標優先於環境變數，環境變數優先於預設路徑。\n'
    + '  --pace   AUTOPILOT_INVENTORY_PACE   預設 ~/projects/capacity/out/pace.v1.json\n'
    + '  --seats  AUTOPILOT_INVENTORY_SEATS  預設 ~/.local/state/hangar-seats/seats-overlay.tsv\n'
    + '  --format md（預設）或 tsv\n'
    + '\n'
    + 'pace 的 schema 必須是 capacity.pace/1。used_pct 為 null 或缺欄印「未知」，絕不印 0，\n'
    + '也不把各池的百分比加總。時間一律亞洲／台北 +08:00。超過 2 小時未更新的輸入，\n'
    + '戳記行附（資料已 N 小時未更新）。一份輸入不可讀時，該表改為一行 !!，exit 0；兩份都不可讀則 exit 3。\n'
    + '\n'
    + '--check 是送出報告前的閘：報告裡必須有本腳本產生的戳記行。每一半是 sha16，\n'
    + '或是「不可讀」且該輸入目前仍不可讀。否則 exit 1，表示主機／配額池清單是手打或已過期，請改貼本腳本的輸出。\n',
  );
}

function usageDie(msg) {
  process.stderr.write(`render-fleet-inventory: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { help: false, format: 'md', check: undefined, pace: undefined, seats: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--pace' || a === '--seats' || a === '--format' || a === '--check') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) usageDie(`${a} 需要值`);
      i += 1;
      if (a === '--pace') out.pace = v;
      else if (a === '--seats') out.seats = v;
      else if (a === '--format') out.format = v;
      else out.check = v;
      continue;
    }
    usageDie(`未知參數 ${a}`);
  }
  if (out.format !== 'md' && out.format !== 'tsv') usageDie('--format 只能是 md 或 tsv');
  return out;
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function pick(flagValue, envName, fallback) {
  if (flagValue !== undefined) return expandHome(flagValue);
  const env = process.env[envName];
  if (typeof env === 'string' && env.trim() !== '') return expandHome(env);
  return fallback;
}

function reasonOf(err) {
  if (err && err.code === 'ENOENT') return '找不到';
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return '拒絕讀取';
  if (err && err.code === 'EISDIR') return '是目錄';
  return '讀取失敗';
}

function readBytes(file) {
  try {
    const buf = fs.readFileSync(file);
    const sha16 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    return { buf, sha16, missing: false };
  } catch (err) {
    return { buf: null, sha16: null, missing: err.code === 'ENOENT', reason: reasonOf(err) };
  }
}

function parseTime(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function taipeiFromMs(ms) {
  if (ms === null) return '未知';
  const t = new Date(ms + TAIPEI_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}+08:00`;
}

function taipei(v) {
  return taipeiFromMs(parseTime(v));
}

// A missing or non-finite number is unknown. Never coerce null to 0.
function numCell(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '未知';
  return String(v);
}

function textCell(v) {
  if (typeof v !== 'string' || v.length === 0) return '未知';
  return v;
}

function staleCell(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  return '未知';
}

function loadPace(file) {
  const read = readBytes(file);
  const base = { missing: read.missing, sha16: read.sha16, ok: false, schemaMismatch: false, generatedAt: null, rows: null };
  if (!read.buf) return { ...base, reason: read.reason };
  let data;
  try {
    data = JSON.parse(read.buf.toString('utf8'));
  } catch {
    return { ...base, missing: false, reason: 'JSON 無效' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ...base, missing: false, reason: '不是物件' };
  }
  const generatedAt = typeof data.generated_at === 'string' ? data.generated_at : null;
  if (data.schema !== PACE_SCHEMA) {
    return { ...base, missing: false, schemaMismatch: true, generatedAt, reason: null };
  }
  if (!Array.isArray(data.rows)) {
    return { ...base, missing: false, generatedAt, reason: 'rows 不是陣列' };
  }
  return { ...base, missing: false, ok: true, generatedAt, rows: data.rows, reason: null };
}

function parseSeats(buf) {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { ok: false, reason: '空檔' };
  const header = lines[0].split('\t').map((s) => s.trim());
  const missingCols = SEAT_COLUMNS.filter((name) => !header.includes(name));
  if (missingCols.length > 0) return { ok: false, reason: `缺欄 ${missingCols.join('、')}` };
  const idx = {};
  for (const name of SEAT_COLUMNS) idx[name] = header.indexOf(name);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const cell = (name) => {
      const raw = cells[idx[name]];
      return raw === undefined ? '' : raw.trim();
    };
    // claude_config_dir and reset are required columns and are not rendered.
    rows.push({ member: cell('member'), host: cell('host'), pool: cell('pool'), sampled_at: cell('sampled_at') });
  }
  return { ok: true, rows };
}

function seatsMax(rows) {
  let max = null;
  for (const row of rows) {
    const ms = parseTime(row.sampled_at);
    if (ms === null) continue;
    if (max === null || ms > max) max = ms;
  }
  return max;
}

function loadSeats(file) {
  const read = readBytes(file);
  if (!read.buf) {
    return { missing: read.missing, sha16: null, ok: false, reason: read.reason, rows: null, maxMs: null };
  }
  const parsed = parseSeats(read.buf);
  if (!parsed.ok) {
    return { missing: false, sha16: read.sha16, ok: false, reason: parsed.reason, rows: null, maxMs: null };
  }
  return { missing: false, sha16: read.sha16, ok: true, reason: null, rows: parsed.rows, maxMs: seatsMax(parsed.rows) };
}

function groupHosts(rows) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.host)) {
      map.set(row.host, { host: row.host, members: [], pools: [], times: [] });
      order.push(row.host);
    }
    const group = map.get(row.host);
    if (row.member && !group.members.includes(row.member)) group.members.push(row.member);
    if (row.pool && !group.pools.includes(row.pool)) group.pools.push(row.pool);
    const ms = parseTime(row.sampled_at);
    if (ms !== null) group.times.push(ms);
  }
  return order.map((host) => {
    const group = map.get(host);
    const maxMs = group.times.length === 0 ? null : Math.max(...group.times);
    return { host: group.host, members: group.members, pools: group.pools, maxMs };
  });
}

function mdCell(v) {
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function tsvCell(v) {
  return String(v).replace(/[\t\r\n]/g, ' ');
}

function renderTable(format, headers, rows) {
  if (format === 'tsv') {
    return [headers, ...rows].map((row) => row.map(tsvCell).join('\t')).join('\n');
  }
  const head = `| ${headers.map(mdCell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function seatsBlock(seats, format) {
  if (!seats.ok) return `!! seats 不可讀（${seats.reason}）`;
  const rows = groupHosts(seats.rows).map((group) => [
    group.host,
    group.members.join(', '),
    group.pools.join(', '),
    taipeiFromMs(group.maxMs),
  ]);
  return renderTable(format, HOST_HEADERS, rows);
}

// One row per pace row, in file order. No total row: percentages are not summed.
function poolRow(row) {
  const src = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  return [
    textCell(src.display_name),
    textCell(src.class),
    numCell(src.used_pct),
    numCell(src.expected_pct),
    numCell(src.gap_pts),
    taipei(src.reset_at),
    textCell(src.status),
    staleCell(src.stale),
  ];
}

function paceBlock(pace, format) {
  if (pace.schemaMismatch) return '!! pace schema 不符';
  if (!pace.ok) return `!! pace 不可讀（${pace.reason}）`;
  return renderTable(format, POOL_HEADERS, pace.rows.map(poolRow));
}

function staleHours(ms, now) {
  if (ms === null) return null;
  const age = now - ms;
  if (!(age > STALE_AFTER_MS)) return null;
  return Math.floor(age / HOUR_MS);
}

function buildStamp(pace, seats, now) {
  const pacePart = pace.sha16
    ? `pace generated_at ${taipei(pace.generatedAt)} sha16 ${pace.sha16}`
    : 'pace 不可讀';
  const seatsPart = seats.sha16
    ? `seats sampled_at max ${taipeiFromMs(seats.maxMs)} sha16 ${seats.sha16}`
    : 'seats 不可讀';
  const hours = [];
  if (pace.sha16) {
    const paceHours = staleHours(parseTime(pace.generatedAt), now);
    if (paceHours !== null) hours.push(paceHours);
  }
  if (seats.sha16 && seats.maxMs !== null) {
    const seatHours = staleHours(seats.maxMs, now);
    if (seatHours !== null) hours.push(seatHours);
  }
  let line = `來源：${pacePart}；${seatsPart}`;
  if (hours.length > 0) line += `（資料已 ${Math.max(...hours)} 小時未更新）`;
  return line;
}

function checkReport(reportPath, pacePath, seatsPath) {
  let text;
  try {
    text = fs.readFileSync(reportPath, 'utf8');
  } catch (err) {
    process.stderr.write(`!! 報告不可讀（${reasonOf(err)}）\n`);
    process.exit(1);
  }
  const paceSha = readBytes(pacePath).sha16;
  const seatsSha = readBytes(seatsPath).sha16;
  let matched = false;
  for (const line of text.split(/\r?\n/)) {
    const hit = STAMP_RE.exec(line.trim());
    if (!hit) continue;
    const stampPace = hit[1];
    const stampSeats = hit[2];
    if (paceSha === (stampPace || null) && seatsSha === (stampSeats || null)) matched = true;
  }
  if (!matched) {
    process.stderr.write(CHECK_FAIL);
    process.exit(1);
  }
  process.exit(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }
  const pacePath = pick(
    args.pace,
    'AUTOPILOT_INVENTORY_PACE',
    path.join(os.homedir(), 'projects', 'capacity', 'out', 'pace.v1.json'),
  );
  const seatsPath = pick(
    args.seats,
    'AUTOPILOT_INVENTORY_SEATS',
    path.join(os.homedir(), '.local', 'state', 'hangar-seats', 'seats-overlay.tsv'),
  );
  if (args.check !== undefined) checkReport(args.check, pacePath, seatsPath);
  const now = Date.now();
  const pace = loadPace(pacePath);
  const seats = loadSeats(seatsPath);
  const blocks = [seatsBlock(seats, args.format), paceBlock(pace, args.format)];
  if (pace.sha16 || seats.sha16) blocks.push(buildStamp(pace, seats, now));
  process.stdout.write(`${blocks.join('\n\n')}\n`);
  if (!pace.sha16 && !seats.sha16) {
    process.stderr.write(`pace 與 seats 都不可讀（${pace.reason}、${seats.reason}）\n`);
    process.exit(3);
  }
}

main();
