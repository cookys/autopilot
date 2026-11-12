'use strict';

// scripts/lib/quota-mirror-dirs.js — the one reader of fleet.quota mirror directories (PM 01M788HW).
// Lists the local live quota dir first, then extra dirs from AUTOPILOT_QUOTA_MIRROR_DIRS (colon-separated;
// when the variable is set, even empty, it replaces the config list) or config.json quota_mirror_dirs.
// Extra entries are quota directories (the same shape as <live_dir>/quota), not the shared out-dir itself.
// Merge is per (provider, alias, window kind): the strictly newer observed_at wins; a tie keeps the earlier
// dir, and the local dir is first, so a tie keeps local. When any kept window is not the local row, or there
// is no local row, record metadata (visibility, token_state, refusal) comes from the winning slot with the
// newest observed_at, and a tie on that stamp keeps local. A missing, symlinked or unreadable extra dir is
// skipped. Parsed rows go through parseView / validateRecord; invalid rows are dropped. Only the local
// courier's row is a candidate (peer rows stay out, the same rule as a null configured namespace).
// sharedOutDirProblem is the one check for a shared producer --out-dir: it must already exist, must not be
// world-writable, and must be owned by this user or a group this user is in. It is not a tmpfs live dir.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { configPath } = require('./config-path');
const { readSmallFile } = require('./account-quota');
const observation = require('./account-observation');

const VIEW_MAX_BYTES = 65536; // same cap as readView
const NAME_RE = /^[a-z0-9-]{1,24}$/;

function splitList(raw) {
  if (typeof raw !== 'string' || raw === '') return [];
  const out = [];
  for (const part of raw.split(':')) {
    const s = part.trim();
    if (s !== '') out.push(path.resolve(s));
  }
  return out;
}

function readUserConfig(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  try {
    const text = fs.readFileSync(configPath({ env, home: o.home }), 'utf8');
    const user = JSON.parse(text);
    if (!user || typeof user !== 'object' || Array.isArray(user)) return {};
    return user;
  } catch (_) { return {}; }
}

// Extra quota dirs only. Env wins over config, including when the env value is empty.
function extraMirrorDirs(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_QUOTA_MIRROR_DIRS')) return splitList(env.AUTOPILOT_QUOTA_MIRROR_DIRS);
  const user = readUserConfig(o);
  const raw = user.quota_mirror_dirs;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() !== '') out.push(path.resolve(item.trim()));
  }
  return out;
}

// [local quota dir, ...extras]. The local dir is included even when it does not exist yet.
function listMirrorDirs(opts) {
  const o = opts || {};
  const dirs = [];
  if (typeof o.liveDir === 'string' && o.liveDir !== '') dirs.push(path.join(path.resolve(o.liveDir), 'quota'));
  for (const extra of extraMirrorDirs(o)) dirs.push(extra);
  return dirs;
}

function dirUsable(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch (_) { return false; }
  return !st.isSymbolicLink() && st.isDirectory();
}

function readFileRecord(file, provider, alias, secrets) {
  const got = readSmallFile(file, VIEW_MAX_BYTES);
  if (!got || got.text === undefined) return null;
  let j;
  try { j = JSON.parse(got.text); } catch (_) { return null; }
  const parsed = observation.parseView(j, { provider, alias }, secrets);
  if (!parsed || !parsed.view) return null;
  return parsed;
}

function readQuotaDir(dir, secrets) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  const files = [];
  for (const ent of ents) {
    if (!ent.isDirectory() || !NAME_RE.test(ent.name)) continue;
    const provider = ent.name;
    let names;
    try { names = fs.readdirSync(path.join(dir, provider), { withFileTypes: true }); } catch (_) { continue; }
    for (const f of names) {
      if (!f.isFile()) continue;
      const m = /^([a-z0-9-]{1,24})\.json$/.exec(f.name);
      if (!m) continue;
      files.push({ provider, alias: m[1], file: path.join(dir, provider, f.name) });
    }
  }
  return files;
}

// A strictly newer observed_at replaces. Equal stamps keep the earlier dir (local is first).
function keepCandidate(prev, cand) {
  if (!prev) return true;
  return cand.window.observed_at > prev.window.observed_at;
}

function slotObservedAt(slot) {
  const at = slot && slot.window && slot.window.observed_at;
  return typeof at === 'number' ? at : null;
}

// Among the windows that won their kind, the newest observed_at supplies record metadata. A tie keeps local.
function newestMetaSlot(kinds) {
  let best = null;
  let bestAt = null;
  for (const slot of kinds.values()) {
    const at = slotObservedAt(slot);
    if (!best) { best = slot; bestAt = at; continue; }
    const newer = at !== null && (bestAt === null || at > bestAt);
    const tieLocal = at !== null && at === bestAt && slot.local && !best.local;
    const bothUntimed = at === null && bestAt === null && slot.local && !best.local;
    if (newer || tieLocal || bothUntimed) { best = slot; bestAt = at; }
  }
  return best;
}

function accountId(provider, alias) { return `${provider}\0${alias}`; }

// opts: { liveDir, env, home, secrets, provider, alias }. Never throws.
// records: [{ provider, alias, record, view }]. view is what selectView consumes.
function readMerged(opts) {
  const o = opts || {};
  const dirs = listMirrorDirs(o);
  const localDir = (typeof o.liveDir === 'string' && o.liveDir !== '') ? path.resolve(path.join(path.resolve(o.liveDir), 'quota')) : null;
  const slots = new Map();
  const accounts = new Map();
  const seen = new Set();
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!dirUsable(abs)) continue;
    const isLocal = localDir !== null && abs === localDir;
    const files = readQuotaDir(abs, o.secrets);
    if (!files) continue;
    for (const item of files) {
      if (o.provider !== undefined && item.provider !== o.provider) continue;
      if (o.alias !== undefined && item.alias !== o.alias) continue;
      const parsed = readFileRecord(item.file, item.provider, item.alias, o.secrets);
      if (!parsed) continue;
      const row = parsed.view.rows.find((r) => r && r.writer_courier === observation.LOCAL_COURIER);
      if (!row || !row.record || !Array.isArray(row.record.windows)) continue;
      const id = accountId(item.provider, item.alias);
      if (!accounts.has(id)) accounts.set(id, { provider: item.provider, alias: item.alias, localView: null, localRow: null, extraRow: null });
      const acct = accounts.get(id);
      if (isLocal) { acct.localView = parsed.view; acct.localRow = row; }
      else if (!acct.extraRow) acct.extraRow = row;
      for (const w of row.record.windows) {
        if (!w || typeof w.kind !== 'string') continue;
        const key = `${id}\0${w.kind}`;
        const cand = { window: w, local: isLocal, row };
        if (keepCandidate(slots.get(key), cand)) slots.set(key, cand);
      }
    }
  }
  const byAccount = new Map();
  for (const [key, slot] of slots) {
    const [provider, alias, kind] = key.split('\0');
    const id = accountId(provider, alias);
    if (!byAccount.has(id)) byAccount.set(id, new Map());
    byAccount.get(id).set(kind, slot);
  }
  const records = [];
  for (const [id, kinds] of byAccount) {
    const acct = accounts.get(id);
    const changed = Array.from(kinds.values()).some((slot) => slot.local === false);
    let view;
    let record;
    if (acct.localView && !changed) {
      view = acct.localView;
      record = acct.localRow.record;
    } else if (acct.localRow) {
      const windows = [];
      const used = new Set();
      for (const w of acct.localRow.record.windows) {
        const slot = kinds.get(w.kind);
        if (!slot) continue;
        windows.push(slot.window);
        used.add(w.kind);
      }
      for (const [kind, slot] of kinds) {
        if (used.has(kind)) continue;
        windows.push(slot.window);
      }
      record = Object.assign({}, newestMetaSlot(kinds).row.record, { windows });
      const rows = acct.localView.rows.map((r) => (r === acct.localRow ? Object.assign({}, r, { record }) : r));
      view = Object.assign({}, acct.localView, { rows });
    } else {
      const windows = [];
      for (const slot of kinds.values()) windows.push(slot.window);
      const base = newestMetaSlot(kinds).row.record;
      record = Object.assign({}, base, { windows });
      const row = {
        writer_courier: observation.LOCAL_COURIER,
        host_role: base.host_role === undefined ? null : base.host_role,
        observed_at_hub: null,
        skewed: false,
        record,
      };
      view = { schema: observation.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [row] };
    }
    records.push({ provider: acct.provider, alias: acct.alias, record, view });
  }
  // A placeholder or a refusal has no windows. It is still a row: dropping it would hide the refusal.
  const emitted = new Set(records.map((r) => accountId(r.provider, r.alias)));
  for (const [id, acct] of accounts) {
    if (emitted.has(id)) continue;
    if (acct.localView && acct.localRow) {
      records.push({ provider: acct.provider, alias: acct.alias, record: acct.localRow.record, view: acct.localView });
      continue;
    }
    if (!acct.extraRow) continue;
    const record = acct.extraRow.record;
    const row = {
      writer_courier: observation.LOCAL_COURIER,
      host_role: record.host_role === undefined ? null : record.host_role,
      observed_at_hub: null,
      skewed: false,
      record,
    };
    records.push({
      provider: acct.provider, alias: acct.alias, record,
      view: { schema: observation.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [row] },
    });
  }
  return { records };
}

// null when the directory may be a shared producer out-dir; otherwise a short reason code.
function sharedOutDirProblem(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return 'missing';
  const abs = path.resolve(dir);
  let st;
  try { st = fs.lstatSync(abs); } catch (e) {
    if (e && e.code === 'ENOENT') return 'missing';
    return 'unreadable';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not_directory';
  if ((st.mode & 0o002) !== 0) return 'world_writable';
  let uid = st.uid;
  try { if (typeof process.getuid === 'function') uid = process.getuid(); } catch (_) { /* keep st.uid */ }
  const groups = new Set();
  try { if (typeof process.getgid === 'function') groups.add(process.getgid()); } catch (_) { /* none */ }
  try { if (typeof process.getgroups === 'function') for (const g of process.getgroups()) groups.add(g); } catch (_) { /* none */ }
  if (st.uid !== uid && !groups.has(st.gid)) return 'not_owner';
  return null;
}

module.exports = { listMirrorDirs, extraMirrorDirs, readMerged, sharedOutDirProblem };
