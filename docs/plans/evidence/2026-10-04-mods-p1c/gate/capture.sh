#!/usr/bin/env bash
# gate/capture.sh <cell-name> <tmux-target> [session-id]
#
# W4 real-machine gate (dev-time, not shipped). Run it right after you trigger a cell. At one moment it copies the band
# (tmux capture-pane) and the source files the band was drawn from into gate/runs/<cell>/<UTC timestamp>/, ready for
#   node gate/check.js <that dir>
# READ-ONLY toward the live dir, the marker dir and the repo: it only writes under its own output directory.
#
# Environment (all optional; the defaults are the real owner machine):
#   HOME                     autopilot home is $HOME/.autopilot (live pointer, session-mode/, review/)
#   AUTOPILOT_SESSION_MODE_DIR  marker dir override (autopilot home = its parent), as the plugin itself does
#   GATE_TMUX_SOCKET         tmux -L <name> (a private server); default = the tmux server you are attached to
#   GATE_OUT                 output base, default <this dir>/runs
#   GATE_MODE                mode name written to meta.json (dev-flow, l3 ... ); default = the cell name up to the first '-'
# Capture layout (what check.js reads):
#   meta.json pane.txt pane.ansi band.txt panel.txt marker.json attention.json tasks.json turn.json context.json envelope.json decisions-sidecar.json
#   foreman.json sources.json model.json decision-file.json work-orders/*.json agents/*.json marker-dir-ls.txt ps-watchers.txt
#   P7 facts (the one-line band's slots, re-derived by check.js): envelope.json carries D1 (host_today_brain_usd / brain_cap_usd),
#   decisions-sidecar.json carries D2 (ladder), residue.json = <live>/runs/<project_key>.residue.json (D3), stage.json = <live>/stage/<sid>.json (D4),
#   qc.json = <live>/runs/<project_key>.qc.json, review.json = <live>/runs/<project_key>.review.json, load-source.json = <live>/load-source.json,
#   marker.json = the session marker. pane.ansi = `capture-pane -e -p` (colour; gate/screenshot.sh renders it). meta.json records window_width / pane_width
#   (check.js: bodyColumns = window_width - 5) and mode (GATE_MODE, else the cell name's first dash-separated part).
#   band.txt = THE one band line (a verdict mark ... ending in ⓘ, or the non-ok `<reason> │ ⓘ` line).
#   Root set (mods P1W SCOPE): for each root in marker.campaign_roots (<= 8, plain names only) also envelope--<root>.json,
#   decisions-sidecar--<root>.json, model--<root>.json and campaign-work-orders/<root>/*.json (the campaign root's progress receipts).
#   (agents/*.json = <live>/agents/<sid>/*.json, the per-subagent activity stamps with ended_at; check.js derives the foreman verdict from them)
# A file that does not exist is simply absent (listed under "missing" in meta.json): absence is itself evidence.
set -u

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: $0 <cell-name> <tmux-target> [session-id]" >&2
  exit 2
fi
CELL=$1; TARGET=$2; SID_ARG=${3:-}
case "$CELL" in *[!A-Za-z0-9._-]*|'') echo "cell name must be [A-Za-z0-9._-]+" >&2; exit 2 ;; esac
command -v node >/dev/null 2>&1 || { echo "node not found" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
TMUX_CMD=(tmux)
[ -n "${GATE_TMUX_SOCKET:-}" ] && TMUX_CMD=(tmux -L "$GATE_TMUX_SOCKET")

# --- the same moment: pane first, then every file
NOW_MS=$(node -e 'process.stdout.write(String(Date.now()))')
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PANE=$("${TMUX_CMD[@]}" capture-pane -p -t "$TARGET" 2>&1) || { echo "tmux capture-pane failed: $PANE" >&2; exit 2; }
PANE_ANSI=$("${TMUX_CMD[@]}" capture-pane -e -p -t "$TARGET" 2>/dev/null || true)
PANE_DIMS=$("${TMUX_CMD[@]}" display -p -t "$TARGET" '#{window_width} #{pane_width}' 2>/dev/null || true)
PANE_CWD=$("${TMUX_CMD[@]}" display -p -t "$TARGET" '#{pane_current_path}' 2>/dev/null || true)

AHOME=${HOME}/.autopilot
[ -n "${AUTOPILOT_SESSION_MODE_DIR:-}" ] && AHOME=$(dirname "$(cd "$AUTOPILOT_SESSION_MODE_DIR" 2>/dev/null && pwd || echo "$AUTOPILOT_SESSION_MODE_DIR")")
MARKERS=$AHOME/session-mode
POINTER=$AHOME/live-pointer.json
if [ ! -f "$POINTER" ]; then echo "no live pointer at $POINTER (is a watcher / session-mode set running?)" >&2; fi

OUT=${GATE_OUT:-$HERE/runs}/$CELL/$STAMP
mkdir -p "$OUT/work-orders" || exit 2
printf '%s\n' "$PANE" > "$OUT/pane.txt"
printf '%s\n' "$PANE_ANSI" > "$OUT/pane.ansi"

# everything else is resolved in node (JSON, sanitising rules written out here, not imported from the plugin)
export GATE_OUT_DIR=$OUT GATE_NOW_MS=$NOW_MS GATE_CELL=$CELL GATE_SID_ARG=$SID_ARG GATE_PANE_CWD=$PANE_CWD
export GATE_PANE_DIMS=$PANE_DIMS GATE_MODE_ARG=${GATE_MODE:-}
export GATE_MARKERS=$MARKERS GATE_POINTER=$POINTER GATE_AHOME=$AHOME
node - <<'NODE'
const fs = require('fs'); const path = require('path');
const E = process.env;
const out = E.GATE_OUT_DIR;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_e) { return null; } };
const missing = [];
const copy = (from, name, label) => {
  try { fs.copyFileSync(from, path.join(out, name)); return true; } catch (_e) { missing.push(`${label || name} (${from})`); return false; }
};
const safeSeg = (v) => String(v).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || '_';
const sanSid = (s) => (s ? (Array.from(s).slice(0, 64).map((c) => (/^[A-Za-z0-9_-]$/.test(c) ? c : '_')).join('') || 'unknown') : 'unknown');
const pointer = readJson(E.GATE_POINTER);
const live = pointer && typeof pointer.live_base === 'string' ? pointer.live_base : null;
if (!live) missing.push('live-pointer live_base');

// --- session id: argument, else the newest marker whose repo_root / cwd matches the pane's cwd
let sid = E.GATE_SID_ARG || null; let how = 'argument';
if (!sid) {
  how = 'newest marker matching the pane cwd';
  const cwd = E.GATE_PANE_CWD || '';
  let best = null;
  let names = [];
  try { names = fs.readdirSync(E.GATE_MARKERS).filter((n) => n.endsWith('.json')); } catch (_e) { /* none */ }
  for (const n of names) {
    const f = path.join(E.GATE_MARKERS, n);
    const m = readJson(f); if (!m) continue;
    const roots = [m.repo_root, m.cwd].filter((x) => typeof x === 'string' && x);
    const hit = cwd && roots.some((r) => cwd === r || cwd.startsWith(r.replace(/\/+$/, '') + '/'));
    if (!hit) continue;
    const mt = fs.statSync(f).mtimeMs;
    if (!best || mt > best.mt) best = { mt, sid: typeof m.session_id === 'string' ? m.session_id : n.replace(/\.json$/, '') };
  }
  sid = best ? best.sid : null;
}
if (!sid) { process.stderr.write('could not resolve a session id (pass it as the third argument)\n'); }
const ssid = sanSid(sid);

// --- marker
let marker = null;
if (sid) {
  const cands = [path.join(E.GATE_MARKERS, `${sid}.json`), path.join(E.GATE_MARKERS, `${ssid}.json`)];
  const f = cands.find((c) => fs.existsSync(c));
  if (f) { copy(f, 'marker.json'); marker = readJson(f); } else missing.push(`marker (${cands[1]})`);
}
const root = marker && typeof marker.root_run_id === 'string' && marker.root_run_id ? marker.root_run_id : null;
const pkey = marker && marker.project_key ? marker.project_key : null;
const scope = pkey ? (root ? `${pkey}--${safeSeg(root)}` : pkey) : null;

if (live) {
  copy(path.join(live, 'attention', `${ssid}.json`), 'attention.json');
  copy(path.join(live, 'tasks', `${ssid}.json`), 'tasks.json');
  copy(path.join(live, 'turn', `${ssid}.json`), 'turn.json');
  copy(path.join(live, 'turn-effective', `${ssid}.json`), 'turn-effective.json');
  copy(path.join(live, 'context', `${ssid}.json`), 'context.json');
  {
    const ad = path.join(live, 'agents', ssid);
    let an = [];
    try { an = fs.readdirSync(ad).filter((n) => n.endsWith('.json')); } catch (_e) { missing.push(`agents (${ad})`); }
    if (an.length) fs.mkdirSync(path.join(out, 'agents'), { recursive: true });
    for (const n of an) copy(path.join(ad, n), path.join('agents', n));
  }
  // P7 facts keyed by project (not scope) or session
  if (pkey) {
    copy(path.join(live, 'runs', `${pkey}.qc.json`), 'qc.json');
    copy(path.join(live, 'runs', `${pkey}.review.json`), 'review.json');
    copy(path.join(live, 'runs', `${pkey}.residue.json`), 'residue.json');
  }
  copy(path.join(live, 'stage', `${ssid}.json`), 'stage.json');
  copy(path.join(live, 'load-source.json'), 'load-source.json');
  if (scope) {
    copy(path.join(live, 'runs', `${scope}.json`), 'envelope.json');
    copy(path.join(live, 'runs', `${scope}.decisions.json`), 'decisions-sidecar.json');
    copy(path.join(live, 'runs', `${scope}.foreman.json`), 'foreman.json');
    copy(path.join(live, 'runs', 'sources', `${scope}.json`), 'sources.json');
  } else missing.push('scope files (no marker project_key)');
}
// --- job model: <autopilot_home>/review/<project_key>/<date>/<job>/current/model.json, newest date
if (pkey) {
  const job = root ? safeSeg(root) : 'unbound';
  const base = path.join(E.GATE_AHOME, 'review', pkey);
  let dates = [];
  try { dates = fs.readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse(); } catch (_e) { /* none */ }
  const hit = dates.map((d) => path.join(base, d, job, 'current', 'model.json')).find((f) => fs.existsSync(f));
  if (hit) copy(hit, 'model.json'); else missing.push(`model.json (${base}/<date>/${job}/current/model.json)`);
}
// --- git-common-dir files: decision file + campaign work orders
const env = readJson(path.join(out, 'envelope.json'));
const identity = (env && env.scope && env.scope.repo_identity) || (marker && marker.repo_identity) || '';
const m = /^git-common-dir:(.+)$/.exec(identity);
const common = m ? m[1] : null;
if (common && scope) {
  copy(path.join(common, 'autopilot', 'decisions', `${scope}.json`), 'decision-file.json');
  if (root && /^[A-Za-z0-9._-]+$/.test(root)) {
    const wd = path.join(common, 'autopilot', 'work-orders', root);
    let names = [];
    try { names = fs.readdirSync(wd).filter((n) => n.endsWith('.json')); } catch (_e) { /* none */ }
    for (const n of names) copy(path.join(wd, n), path.join('work-orders', n));
    if (!names.length) missing.push(`work-orders (${wd})`);
  }
} else if (!common) missing.push('decision-file / work-orders (no git-common-dir identity)');

// --- campaign roots (marker.campaign_roots, mods P1W SCOPE): the same files for every extra root of the set
const croots = (marker && Array.isArray(marker.campaign_roots) ? marker.campaign_roots : [])
  .filter((r) => typeof r === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(r) && r !== '.' && r !== '..' && r !== root).slice(-8);
for (const r of croots) {
  if (live && pkey) {
    const sk = `${pkey}--${safeSeg(r)}`;
    copy(path.join(live, 'runs', `${sk}.json`), `envelope--${r}.json`);
    copy(path.join(live, 'runs', `${sk}.decisions.json`), `decisions-sidecar--${r}.json`);
  }
  if (pkey) {
    const base = path.join(E.GATE_AHOME, 'review', pkey);
    let dates = [];
    try { dates = fs.readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse(); } catch (_e) { /* none */ }
    const hit = dates.map((d) => path.join(base, d, safeSeg(r), 'current', 'model.json')).find((f) => fs.existsSync(f));
    if (hit) copy(hit, `model--${r}.json`); else missing.push(`model--${r}.json (${base}/<date>/${safeSeg(r)}/current/model.json)`);
  }
  if (common) {
    const wd = path.join(common, 'autopilot', 'work-orders', r);
    let names = [];
    try { names = fs.readdirSync(wd).filter((n) => n.endsWith('.json')); } catch (_e) { /* none */ }
    if (names.length) fs.mkdirSync(path.join(out, 'campaign-work-orders', r), { recursive: true });
    for (const n of names) copy(path.join(wd, n), path.join('campaign-work-orders', r, n));
    if (!names.length) missing.push(`campaign-work-orders/${r} (${wd})`);
  }
}

// --- band.txt: the ONE band line. A verdict mark + word on the line; the band runs up to ` │ ⓘ` (a docked pane to its right is not part of it).
// No verdict line: the non-ok line `<reason> │ ⓘ`.
const pane = fs.readFileSync(path.join(out, 'pane.txt'), 'utf8').split('\n');
const marks = ['▲ 要你決定', '⏸ 疑似卡住', '✓ 完成待驗收', '● 進行中', '◌ 待命'];
const ICON_END = ' │ ⓘ';
let band = '';
for (let i = pane.length - 1; i >= 0 && !band; i -= 1) {
  for (const k of marks) {
    const at = pane[i].indexOf(k);
    if (at < 0) continue;
    const end = pane[i].indexOf(ICON_END, at);
    if (end >= 0) { band = `${pane[i].slice(at, end + ICON_END.length)}\n`; break; }
  }
}
if (!band) {
  for (let i = pane.length - 1; i >= 0; i -= 1) {
    const end = pane[i].indexOf(ICON_END);
    if (end > 0 && !marks.some((k) => pane[i].includes(k))) { band = `${pane[i].slice(0, end + ICON_END.length).replace(/^\s+/, '')}\n`; break; }
  }
}
fs.writeFileSync(path.join(out, 'band.txt'), band);
// panel.txt: a permission / AskUserQuestion dialog hides the band row, but the mod's top-right panel still shows the verdict
// word alone in its cell with the reason in the cell below (no mark glyph). The text after the last │ of the line.
const words = ['要你決定', '疑似卡住', '完成待驗收', '進行中', '待命'];
const cell = (l) => { const parts = l.split('│').map((p) => p.trim()).filter(Boolean); return l.includes('│') ? (parts[parts.length - 1] || '') : ''; };
let panel = '';
for (let i = 0; i < pane.length; i += 1) { if (words.includes(cell(pane[i]))) { panel = `${cell(pane[i])}\n${cell(pane[i + 1] || '')}\n`; break; } }
fs.writeFileSync(path.join(out, 'panel.txt'), panel);
if (!band && !panel) missing.push('band line and panel verdict in the pane (no verdict mark ending in ⓘ / panel word found)');
else if (!band) missing.push('band row hidden (a dialog is open?): the panel verdict is recorded in panel.txt');

const dims = String(E.GATE_PANE_DIMS || '').split(/\s+/).map(Number);
const windowWidth = Number.isFinite(dims[0]) && dims[0] > 0 ? dims[0] : null;
const paneWidth = Number.isFinite(dims[1]) && dims[1] > 0 ? dims[1] : null;
const mode = E.GATE_MODE_ARG || String(E.GATE_CELL).split('-')[0];
fs.writeFileSync(path.join(out, 'meta.json'), `${JSON.stringify({
  schema: 'autopilot.gate-capture/2', cell: E.GATE_CELL, mode, window_width: windowWidth, pane_width: paneWidth, captured_at: new Date(Number(E.GATE_NOW_MS)).toISOString(), captured_at_ms: Number(E.GATE_NOW_MS),
  session_id: sid, session_id_how: how, sanitised_session_id: ssid, project_key: pkey, root_run_id: root, scope_key: scope,
  live_base: live, autopilot_home: E.GATE_AHOME, pane_cwd: E.GATE_PANE_CWD || null, git_common_dir: common, missing,
}, null, 2)}\n`);
process.stdout.write(`${out}\n`);
if (missing.length) process.stderr.write(`absent (recorded in meta.json): ${missing.join('; ')}\n`);
NODE
RC=$?
[ $RC -eq 0 ] || exit $RC

# --- listings (read-only)
rmdir "$OUT/work-orders" 2>/dev/null || true
ls -la "$MARKERS" > "$OUT/marker-dir-ls.txt" 2>&1 || true
# the bracket-free filter excludes awk itself; no pgrep -f
ps -eo pid,etimes,args 2>/dev/null | awk '/status runs --watch/ && !/awk/' > "$OUT/ps-watchers.txt" || true
echo "capture done: $OUT"
echo "next: node $HERE/check.js $OUT"
