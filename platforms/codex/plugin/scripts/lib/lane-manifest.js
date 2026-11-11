'use strict';
/**
 * lane-manifest.js - lane record store for lane-switch (plan 2026-11-10-profile-switch.md section 3).
 * One file per lane: <base>/lanes/<lane>.json, mode 0600, no secrets. Shape (docs/guide/accounts.md "Lane manifest"):
 *   { lane, pane, cwd, seat, session_id, model, launch_flags: [string], profile }
 * profile is 'home' (native ~/.claude) or a name under ~/.claude-profiles/. Prompt text and any unknown field are
 * rejected; a file whose mode is not 0600 is rejected on read. The default base is ~/.config/autopilot; tests inject one.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FIELDS = ['lane', 'pane', 'cwd', 'seat', 'session_id', 'model', 'launch_flags', 'profile'];

function defaultBase() { return path.join(os.homedir(), '.config', 'autopilot'); }
function lanePath(base, lane) {
  if (!LANE_RE.test(String(lane))) throw new Error('lane_invalid');
  return path.join(base || defaultBase(), 'lanes', `${lane}.json`);
}

function validate(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('manifest_not_object');
  for (const k of Object.keys(rec)) if (!FIELDS.includes(k)) throw new Error(`manifest_field_rejected:${k}`);
  if (!LANE_RE.test(String(rec.lane))) throw new Error('lane_invalid');
  if (rec.profile !== undefined && !PROFILE_RE.test(String(rec.profile))) throw new Error('profile_invalid');
  for (const k of ['pane', 'seat', 'session_id', 'model']) if (rec[k] !== undefined && typeof rec[k] !== 'string') throw new Error(`manifest_type:${k}`);
  if (rec.cwd !== undefined && (typeof rec.cwd !== 'string' || !path.isAbsolute(rec.cwd))) throw new Error('manifest_cwd_not_absolute');
  if (rec.launch_flags !== undefined) {
    if (!Array.isArray(rec.launch_flags) || rec.launch_flags.some((f) => typeof f !== 'string' || !f.startsWith('-') || /\s/.test(f) && !f.includes('='))) throw new Error('manifest_launch_flags_not_flags');
  }
  return rec;
}

function writeManifest(base, rec) {
  validate(rec);
  const file = lanePath(base, rec.lane);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return file;
}

function readManifest(base, lane) {
  const file = lanePath(base, lane);
  let st;
  try { st = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if ((st.mode & 0o777) !== 0o600) throw new Error('manifest_mode_not_0600');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { FIELDS, defaultBase, lanePath, validate, writeManifest, readManifest };
