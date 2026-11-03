#!/usr/bin/env node
'use strict';
// seal-baseline.js -- fingerprint every sealed object before a repo move and diff it after (3.0.0 relayout, D9 points 1 and 6).
// Node built-ins only. Every checker below is run in a read-only mode (see CHECKERS); nothing here writes into --root.
//
//   record  --out <baseline.json> [--root <dir>] [--governance <file>]
//     Runs each sealed object's own checker and stores, per object (green ones too, so a NEW red can be seen):
//       id          repo-relative path of the object (FROZEN tables and stamped rows: <FROZEN.json path>#<trail>)
//       status      green | red
//       diagnostics normalized failure facts: checker rc, mismatching files, computed digests, message. Paths are
//                   repo-relative; an absolute path in checker output is rewritten to <abs-path> (leak-guard safe)
//       files       sha256 of the object and of every file it hashes (null = missing)
//     Objects (8 kinds): mission-graph (mission-execution-graph-check.js), task-authority (its mission_graph_digest
//     against that checker's graph_digest), stamp-row (stamp-prereg.js --row R --check, every stamped FROZEN row),
//     g67-amendment (stamp-g67-amendment.js --check), frozen-table (every path->sha256 table in FROZEN.json, re-hashed),
//     rail-pin (run-d0gate-campaign.js --print-runner-pin; a stub `claude` supplies the version so no real CLI is
//     called and the version is not recorded), platform-capabilities (platform-capability-claims.js validate-consumers,
//     no --reprobe), phase-review (check-phase-review-receipt.js Mode B on every <x>-artifact.json that has a sibling
//     <x>-disposition.json). Output has no timestamp: recording twice from one tree gives identical bytes.
//
//   compare --baseline <a.json> --current <b.json> [--layout-map <map.json>] [--declared-changes <changes.json>]
//     layout-map.json: { "<old path>": "<new path>" } (a key ending in "/" renames a directory prefix); it is applied to
//     object ids, file paths and any path-looking token inside diagnostics.
//     declared-changes.json (D9.1 second exit): [{ "object": "<id in the current naming>", "reason": "...",
//       "files": { "<path>": "<expected new sha256 | null>" }, "status": "green|red", "diagnostics": {...} }]
//     Red when: a baseline object is gone; a green object turned red or a new red object appears; a red object turned
//     green without a declaration with status "green"; diagnostics changed (unless the declaration states the expected
//     ones); any file sha256 changed, vanished or a new hashed file appeared that the declaration does not state; a
//     declaration is stale (names an object or a file that did not change).
//
//   check-rewrite (--range <base>..<head> | --files <list.txt>) [--layout-map <map.json>] [--no-rewrite <file>] [--root <dir>]
//     no-rewrite.json (default <root>/tools/migrate/no-rewrite.json) lists files whose bytes must never change.
//     --range: every entry, at its layout-map name, must exist in <head> with the listed sha256. A pure rename (bytes
//       equal) is green only when the layout-map names it. --files: a file listing paths a path rewriter is about to
//       write; red when any is a listed file (by old or mapped name). The rewriters call this before writing.
//
//   build-no-rewrite --baseline <baseline.json> --out <no-rewrite.json> [--root <dir>]
//     Derives no-rewrite.json (P1 lane generator; later phases edit the committed file, not this): the baseline's
//     files, sealedDocFiles(), mission-*/review-chain/receipt files, seal specs, hash-pinned files, pack files,
//     frozen-evidence markers and rollover/golden fixtures -- minus the D9.6 exclusions, each with its reason.
//
// Exit: 0 consistent, 1 differences (one line each on stdout), 2 bad or missing input.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

class InputError extends Error {}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const posix = (p) => p.split(path.sep).join('/');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new InputError(`unexpected argument ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new InputError(`${a} needs a value`);
    o[a.slice(2)] = v; i++;
  }
  return o;
}
function readJson(p, what) {
  if (!p) throw new InputError(`missing ${what} argument`);
  let t;
  try { t = fs.readFileSync(p, 'utf8'); } catch (e) { throw new InputError(`cannot read ${what} ${p}: ${e.code || e.message}`); }
  try { return JSON.parse(t); } catch (e) { throw new InputError(`${what} ${p} is not valid JSON: ${e.message}`); }
}
function canon(v) { // stable stringify (sorted keys)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
function sortedObj(o) { const r = {}; for (const k of Object.keys(o).sort()) r[k] = o[k]; return r; }

// ------------------------------------------------------------------ layout map
function makeMapper(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new InputError('--layout-map must be a JSON object');
  const dirKeys = Object.keys(map).filter((k) => k.endsWith('/')).sort((a, b) => b.length - a.length);
  const mapPath = (p) => {
    if (typeof p !== 'string') return p;
    if (Object.prototype.hasOwnProperty.call(map, p)) return map[p];
    for (const k of dirKeys) if (p.startsWith(k)) return map[k] + p.slice(k.length);
    return p;
  };
  const mapId = (id) => { const i = id.indexOf('#'); return i < 0 ? mapPath(id) : mapPath(id.slice(0, i)) + id.slice(i); };
  const mapText = (s) => s.replace(/[A-Za-z0-9_@.+/-]+/g, (t) => mapPath(t));
  const mapDeep = (v) => {
    if (typeof v === 'string') return mapText(v);
    if (Array.isArray(v)) return v.map(mapDeep);
    if (v && typeof v === 'object') { const r = {}; for (const k of Object.keys(v)) r[mapText(k)] = mapDeep(v[k]); return r; }
    return v;
  };
  return { mapPath, mapId, mapText, mapDeep };
}

// ------------------------------------------------------------------ repo access
function gitRoot(dir) {
  try { return cp.execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function resolveRoot(o) {
  const root = path.resolve(o.root || gitRoot(process.cwd()) || '');
  if (!o.root && !gitRoot(process.cwd())) throw new InputError('not inside a git repository; pass --root');
  if (!fs.existsSync(root)) throw new InputError(`--root ${root} does not exist`);
  return root;
}
function trackedFiles(root) {
  let out;
  try { out = cp.execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new InputError(`git ls-files failed under ${root}: ${e.message}`); }
  return out.split('\0').filter(Boolean).sort();
}
const shaOf = (root, rel) => { try { return sha256(fs.readFileSync(path.join(root, rel))); } catch { return null; } };
const skipNoise = (f) => f.startsWith('platforms/') || f.includes('/fixtures/') || f.includes('/packs/');
function locate(tracked, name) { // the one tracked, non-mirror, non-fixture file with this basename
  const hits = tracked.filter((f) => path.posix.basename(f) === name && !skipNoise(f));
  if (hits.length === 0) throw new InputError(`cannot locate ${name} in the tracked files`);
  if (hits.length > 1) throw new InputError(`${name} is ambiguous: ${hits.join(', ')}`);
  return hits[0];
}

function run(root, cmd, args, env, secs) {
  const e = { ...process.env, ...(env || {}) };
  delete e.AUTOPILOT_SESSION_ID; delete e.CLAUDE_CODE_SESSION_ID;
  const r = cp.spawnSync(cmd, args, { cwd: root, env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: (secs || 300) * 1000, maxBuffer: 64 << 20, killSignal: 'SIGKILL' });
  return { rc: r.error && r.error.code === 'ETIMEDOUT' ? 124 : (r.status === null ? 1 : r.status), out: r.stdout || '', err: r.stderr || '' };
}

function makeNormalizer(root) {
  const roots = [...new Set([root, (() => { try { return fs.realpathSync(root); } catch { return root; } })()])];
  return (text) => {
    let s = String(text || '').replace(/\r/g, '').trim();
    for (const r of roots) s = s.split(`${r}/`).join('').split(r).join('.');
    s = s.replace(/(^|[\s"'(=:,])\/(?:home|tmp|Users|var|root|mnt|opt|private)\/[^\s"')]+/g, '$1<abs-path>');
    return s.length > 600 ? `${s.slice(0, 600)}...` : s;
  };
}

// The checkers and why each is read-only in the mode used (confirmed by reading the code):
//   mission-execution-graph-check.js: only fs reads; check-plan-graduation.js is require()d for lookups, its writers are behind require.main.
//   stamp-prereg.js --check: process.exit(0|2) before its writeFileSync calls; the arm-check spawn comes after that exit.
//   stamp-g67-amendment.js --check: process.exit before its writeFileSync calls.
//   run-d0gate-campaign.js --print-runner-pin: prints and exits before the results-file code; `claude --version` hits a stub.
//   platform-capability-claims.js validate-consumers: the only write is in the receipt-building command, not here; no --reprobe.
//   check-phase-review-receipt.js Mode B: reads files and runs git rev-parse / diff / rev-list; no write call exists in the file.

function walkShaTables(obj, trail, out) {
  if (!obj || typeof obj !== 'object') return;
  const ents = Object.entries(obj);
  if (ents.length > 0 && ents.every(([, v]) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))) { out.push({ trail: trail.join('.'), table: obj }); return; }
  for (const [k, v] of ents) walkShaTables(v, [...trail, k], out);
}

// ------------------------------------------------------------------ record
function record(root, o) {
  const tracked = trackedFiles(root);
  const norm = makeNormalizer(root);
  const objs = {};
  const add = (id, category, status, diagnostics, fileList) => {
    if (objs[id]) throw new InputError(`duplicate object id ${id}`);
    const files = {};
    for (const f of [...new Set(fileList)].sort()) files[f] = shaOf(root, f);
    objs[id] = { category, status, diagnostics: sortedObj(diagnostics), files };
  };
  const has = new Set(tracked);
  const gov = o.governance || '.claude/owner-kernel-governance.json';
  if (!fs.existsSync(path.join(root, gov))) throw new InputError(`governance file ${gov} not found under ${root} (pass --governance)`);
  const node = process.execPath;

  // 1. mission graphs + 2. task-authority
  const graphScript = locate(tracked, 'mission-execution-graph-check.js');
  const graphRes = new Map(); // dir/slug -> {rc, digest}
  const missionFiles = (kind) => tracked.filter((f) => !skipNoise(f) && new RegExp(`^mission-.+-${kind}\\.json$`).test(path.posix.basename(f)));
  const slugOf = (f, kind) => path.posix.basename(f).slice('mission-'.length, -`-${kind}.json`.length);
  for (const g of missionFiles('execution-graph')) {
    const dir = path.posix.dirname(g); const slug = slugOf(g, 'execution-graph');
    const src = path.posix.join(dir, `mission-${slug}-sources.json`);
    if (!has.has(src)) continue;
    const r = run(root, node, [graphScript, '--graph', g, '--governance', gov, '--sources', src], {}, 180);
    let digest = null;
    try { digest = JSON.parse(r.out).graph_digest || null; } catch { /* red graphs print nothing on stdout */ }
    graphRes.set(`${dir}/${slug}`, { rc: r.rc, digest });
    const refs = [];
    try {
      // plan_path / rubric_path are relative to the registry's base for THIS manifest (D9.2), exactly as the checker resolves them,
      // not to the manifest's own directory: after P1 the manifests sit in project/missions/ while their base is project/.
      let base = dir;
      try { base = posix(path.relative(root, require(path.join(root, 'scripts/lib/repo-layout.js')).manifestBase(root, src).base)) || '.'; } catch { /* old layout or invalid base: the checker's message says why */ }
      for (const s of JSON.parse(fs.readFileSync(path.join(root, src), 'utf8')).sources || []) {
        for (const k of ['plan_path', 'rubric_path']) if (typeof s[k] === 'string') refs.push(path.posix.normalize(path.posix.join(base, s[k])));
      }
    } catch { /* an unreadable manifest is already in the checker's message */ }
    const msg = r.rc === 0 ? '' : norm(r.err || r.out);
    add(g, 'mission-graph', r.rc === 0 ? 'green' : 'red', { rc: r.rc, graph_digest: digest, message: msg }, [g, src, gov, ...refs]);
  }
  for (const a of missionFiles('task-authority')) {
    const dir = path.posix.dirname(a); const slug = slugOf(a, 'task-authority');
    const g = path.posix.join(dir, `mission-${slug}-execution-graph.json`);
    const src = path.posix.join(dir, `mission-${slug}-sources.json`);
    let want = null;
    try { want = JSON.parse(fs.readFileSync(path.join(root, a), 'utf8')).mission_graph_digest || null; } catch { /* unreadable -> red below */ }
    const res = graphRes.get(`${dir}/${slug}`);
    const got = res && res.digest ? res.digest : 'NA';
    add(a, 'task-authority', want && want === got ? 'green' : 'red',
      { mission_graph_digest: want, checker_graph_digest: got, graph_checker_rc: res ? res.rc : null }, [a, g, src]);
  }

  // 3-5. FROZEN-based objects
  const frozenRel = locate(tracked, 'FROZEN.json');
  const evalsRoot = path.posix.dirname(path.posix.dirname(frozenRel));
  const frozen = JSON.parse(fs.readFileSync(path.join(root, frozenRel), 'utf8'));
  const resolveKey = (k) => path.posix.normalize(path.posix.join(evalsRoot, k));
  const stampPrereg = locate(tracked, 'stamp-prereg.js');
  for (const row of Object.keys(frozen).sort()) {
    const rec = frozen[row];
    const preregRel = `${evalsRoot}/prereg/${row}.json`;
    if (!rec || typeof rec !== 'object' || rec.stamped !== true || !has.has(preregRel)) continue;
    const r = run(root, node, [stampPrereg, '--row', row, '--check'], {}, 300);
    const msg = norm(r.err || r.out);
    const m = /digest mismatch: (.*)$/m.exec(msg);
    const diag = { rc: r.rc, mismatch: m ? m[1].split(', ').sort() : [], message: m ? '' : (r.rc === 0 ? '' : msg) };
    add(preregRel, 'stamp-row', r.rc === 0 ? 'green' : 'red', diag, [preregRel, frozenRel, ...Object.keys(rec.files || {}).map(resolveKey)]);
  }
  {
    const script = locate(tracked, 'stamp-g67-amendment.js');
    const r = run(root, node, [script, '--check'], {}, 300);
    const msg = norm(r.err || r.out);
    const m = /digest mismatch: (.*)$/m.exec(msg);
    const amend = (((frozen['stage-graph-g67'] || {}).amendments || {})['amend-1-plugin-scripts'] || {}).files || {};
    add(`${evalsRoot}/prereg/stage-graph-g67.json#amend-1-plugin-scripts`, 'g67-amendment', r.rc === 0 ? 'green' : 'red',
      { rc: r.rc, mismatch: m ? m[1].split(', ').sort() : [], message: m ? '' : (r.rc === 0 ? '' : msg) },
      [`${evalsRoot}/prereg/stage-graph-g67.json`, frozenRel, ...Object.keys(amend).map(resolveKey)]);
  }
  {
    const tables = []; walkShaTables(frozen, [], tables);
    for (const { trail, table } of tables) {
      const bad = []; const gone = [];
      for (const [k, h] of Object.entries(table)) {
        const f = resolveKey(k); const s = shaOf(root, f);
        if (s === null) gone.push(k); else if (s !== h) bad.push(k);
      }
      add(`${frozenRel}#${trail}`, 'frozen-table', bad.length + gone.length === 0 ? 'green' : 'red',
        { entries: Object.keys(table).length, mismatch: bad.sort(), gone: gone.sort() }, [frozenRel, ...Object.keys(table).map(resolveKey)]);
    }
  }

  // 6. rail pin
  {
    const script = locate(tracked, 'run-d0gate-campaign.js');
    const preregRel = `${evalsRoot}/prereg/d0gate.json`;
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-baseline-stub.'));
    try {
      fs.writeFileSync(path.join(stubDir, 'claude'), '#!/bin/sh\necho "0.0.0 (seal-baseline stub)"\n', { mode: 0o755 });
      const r = run(root, node, [script, '--print-runner-pin'], { PATH: `${stubDir}${path.delimiter}${process.env.PATH}` }, 120);
      let pin = null; try { pin = JSON.parse(r.out); } catch { /* reported below */ }
      let expected = null;
      try { const m = /rail sha256:([0-9a-f]{64})/.exec(JSON.parse(fs.readFileSync(path.join(root, preregRel), 'utf8')).runner_pin.value || ''); expected = m ? m[1] : null; } catch { /* no pin */ }
      const actual = pin ? pin.rail_digest : null;
      const railFiles = pin ? Object.keys(pin.rail_files).sort() : [];
      add(`${preregRel}#runner_pin`, 'rail-pin', r.rc === 0 && expected && expected === actual ? 'green' : 'red',
        { rc: r.rc, expected_rail_digest: expected, computed_rail_digest: actual, message: pin ? '' : norm(r.err || r.out) }, [preregRel, script, ...railFiles]);
    } finally { fs.rmSync(stubDir, { recursive: true, force: true }); }
  }

  // 7. platform-capabilities receipts
  {
    const script = locate(tracked, 'platform-capability-claims.js');
    for (const f of tracked.filter((x) => path.posix.basename(x) === 'platform-capabilities.json')) {
      const r = run(root, node, [script, 'validate-consumers', '--receipt', f, '--consumer', 'D2', '--consumer', 'D3', '--consumer', 'D4'], {}, 120);
      add(f, 'platform-capabilities', r.rc === 0 ? 'green' : 'red', { rc: r.rc, message: norm(r.err || r.out) }, [f]);
    }
  }

  // 8. phase-review artifacts that have a name-paired disposition
  {
    const script = locate(tracked, 'check-phase-review-receipt.js');
    for (const a of tracked.filter((x) => /-artifact\.json$/.test(x))) {
      const d = a.replace(/-artifact\.json$/, '-disposition.json');
      if (!has.has(d)) continue;
      const r = run(root, node, [script, '--plan-artifact', a, '--dispositions', d], {}, 180);
      const stem = a.replace(/\.?g\d+-artifact\.json$/, '').replace(/\/$/, '');
      const sibs = ['.md', '.rubric.md', '.plan-review-manifest.json'].map((s) => `${stem}${s}`).filter((x) => has.has(x));
      add(a, 'phase-review', r.rc === 0 ? 'green' : 'red', { rc: r.rc, message: norm(r.err || r.out) }, [a, d, ...sibs]);
    }
  }
  return { schema: 1, tool: 'seal-baseline', objects: sortedObj(objs) };
}

function cmdRecord(o) {
  const root = resolveRoot(o);
  if (!o.out) throw new InputError('record needs --out');
  const rec = record(root, o);
  fs.writeFileSync(o.out, `${JSON.stringify(rec, null, 2)}\n`);
  const red = Object.values(rec.objects).filter((x) => x.status === 'red').length;
  process.stdout.write(`seal-baseline: recorded ${Object.keys(rec.objects).length} objects (${red} red) -> ${o.out}\n`);
  return 0;
}

// ------------------------------------------------------------------ compare
function loadRecord(p, what) {
  const j = readJson(p, what);
  if (!j || j.schema !== 1 || !j.objects || typeof j.objects !== 'object') throw new InputError(`${what} ${p} is not a seal-baseline record (schema 1)`);
  return j;
}
function loadDeclared(p) {
  if (!p) return [];
  const j = readJson(p, '--declared-changes');
  if (!Array.isArray(j)) throw new InputError('--declared-changes must be a JSON array');
  for (const [i, d] of j.entries()) {
    if (!d || typeof d.object !== 'string' || typeof d.reason !== 'string' || d.reason.trim() === '') throw new InputError(`--declared-changes[${i}] needs "object" and a non-empty "reason"`);
    if (d.files !== undefined && (typeof d.files !== 'object' || Array.isArray(d.files) || d.files === null)) throw new InputError(`--declared-changes[${i}].files must be an object`);
    if (d.status !== undefined && d.status !== 'green' && d.status !== 'red') throw new InputError(`--declared-changes[${i}].status must be green or red`);
  }
  return j;
}

function compareRecords(base, cur, M, declared) {
  const diffs = [];
  const decl = new Map(); const used = new Set();
  for (const d of declared) { if (decl.has(d.object)) throw new InputError(`two declarations for ${d.object}`); decl.set(d.object, d); }
  const seenNew = new Set();
  // an old id / old file path that is itself the target of another map entry is exempt only when what is there now is
  // exactly the mapped baseline content of that other entry (a verified move into it)
  const movedInto = (oldId) => Object.keys(base.objects).some((cid) => cid !== oldId && M.mapId(cid) === oldId && sameObject(base.objects[cid], cur.objects[oldId]));
  const sameObject = (bo, co) => bo.status === co.status && canon(M.mapDeep(bo.diagnostics)) === canon(co.diagnostics)
    && canon(Object.fromEntries(Object.entries(bo.files || {}).map(([f, h]) => [M.mapPath(f), h]))) === canon(co.files || {});
  const fileMovedInto = (f, b, c) => Object.keys(b.files || {}).some((cf) => cf !== f && M.mapPath(cf) === f && b.files[cf] === (c.files || {})[f]);
  for (const baseId of Object.keys(base.objects)) {
    const b = base.objects[baseId]; const id = M.mapId(baseId);
    if (seenNew.has(id)) throw new InputError(`layout-map sends two baseline objects to ${id}`);
    seenNew.add(id);
    const c = cur.objects[id];
    if (c && id !== baseId && cur.objects[baseId] && !movedInto(baseId)) diffs.push(`object still present at its old path ${baseId} although the layout-map moves it to ${id}`);
    if (!c) { diffs.push(`object gone: ${baseId}${id !== baseId ? ` (expected as ${id})` : ''}`); continue; }
    const d = decl.get(id); if (d) used.add(id);
    const turnedGreen = b.status === 'red' && c.status === 'green';
    if (b.status === 'green' && c.status === 'red') diffs.push(`green object turned red: ${id}`);
    if (turnedGreen && !(d && d.status === 'green')) diffs.push(`red object turned green without a declared reason: ${id}`);
    if (d && d.status !== undefined && c.status !== d.status) diffs.push(`declared status ${d.status} but current is ${c.status}: ${id}`);
    const bd = canon(M.mapDeep(b.diagnostics)); const cd = canon(c.diagnostics);
    if (bd !== cd) {
      if (d && d.diagnostics !== undefined) { if (canon(d.diagnostics) !== cd) diffs.push(`diagnostics differ from the declared ones: ${id}`); }
      else if (!(turnedGreen && d && d.status === 'green')) diffs.push(`diagnostics changed: ${id}\n    baseline: ${bd}\n    current:  ${cd}`);
    } else if (d && d.diagnostics !== undefined && canon(d.diagnostics) !== cd) diffs.push(`diagnostics differ from the declared ones: ${id}`);
    let changed = b.status !== c.status || bd !== cd;
    const declFiles = (d && d.files) || {}; const declUsed = new Set();
    const baseMapped = new Map(Object.entries(b.files || {}).map(([f, s]) => [M.mapPath(f), s]));
    for (const f of new Set([...baseMapped.keys(), ...Object.keys(c.files || {})])) {
      const bs = baseMapped.has(f) ? baseMapped.get(f) : undefined; const cs = (c.files || {})[f];
      if (bs === cs) continue;
      changed = true;
      if (Object.prototype.hasOwnProperty.call(declFiles, f) && (declFiles[f] === (cs === undefined ? null : cs))) { declUsed.add(f); continue; }
      const short = (x) => (x === undefined ? 'absent' : x === null ? 'missing' : x.slice(0, 12));
      diffs.push(`fingerprint changed: ${id} :: ${f} (${short(bs)} -> ${short(cs)})`);
    }
    for (const f of Object.keys(b.files || {})) if (M.mapPath(f) !== f && (c.files || {})[f] && !fileMovedInto(f, b, c)) diffs.push(`moved file still referenced and present at its old path: ${id} :: ${f}`);
    if (d && !changed) diffs.push(`stale declaration (the object did not change): ${id}`);
    for (const f of Object.keys(declFiles)) if (!declUsed.has(f)) diffs.push(`declared file change did not happen as stated: ${id} :: ${f}`);
  }
  for (const id of Object.keys(cur.objects)) {
    if (seenNew.has(id)) continue;
    if (cur.objects[id].status === 'red') diffs.push(`new red object: ${id}`);
  }
  for (const id of decl.keys()) if (!used.has(id)) diffs.push(`declaration for an object not in the baseline: ${id}`);
  return diffs;
}

function cmdCompare(o) {
  const base = loadRecord(o.baseline, '--baseline');
  const cur = loadRecord(o.current, '--current');
  const M = makeMapper(o['layout-map'] ? readJson(o['layout-map'], '--layout-map') : {});
  const diffs = compareRecords(base, cur, M, loadDeclared(o['declared-changes']));
  for (const d of diffs) process.stdout.write(`RED ${d}\n`);
  process.stdout.write(diffs.length ? `seal-baseline: ${diffs.length} difference(s)\n` : `seal-baseline: consistent (${Object.keys(base.objects).length} baseline objects)\n`);
  return diffs.length ? 1 : 0;
}

// ------------------------------------------------------------------ no-rewrite
function loadNoRewrite(p) {
  const j = readJson(p, '--no-rewrite');
  if (!j || j.schema !== 1 || !Array.isArray(j.entries)) throw new InputError(`${p} is not a no-rewrite list (schema 1)`);
  for (const e of j.entries) if (!e || typeof e.path !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256 || '')) throw new InputError(`${p}: bad entry ${JSON.stringify(e)}`);
  return j;
}
function blobShas(root, rev, paths) { // path -> sha256 | null, through one `git cat-file --batch`
  const r = cp.spawnSync('git', ['-C', root, 'cat-file', '--batch'], { input: paths.map((p) => `${rev}:${p}\n`).join(''), maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new InputError(`git cat-file failed for ${rev}: ${String(r.stderr)}`);
  const buf = r.stdout; const out = new Map(); let pos = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, pos); const head = buf.slice(pos, nl).toString('utf8'); pos = nl + 1;
    if (/ missing$/.test(head) || / ambiguous$/.test(head)) { out.set(p, null); continue; }
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(head);
    if (!m) throw new InputError(`unexpected git cat-file reply: ${head}`);
    const size = Number(m[2]);
    out.set(p, m[1] === 'blob' ? sha256(buf.slice(pos, pos + size)) : null);
    pos += size + 1;
  }
  return out;
}
function cmdCheckRewrite(o) {
  const root = resolveRoot(o);
  const M = makeMapper(o['layout-map'] ? readJson(o['layout-map'], '--layout-map') : {});
  const listPath = o['no-rewrite'] || path.join(root, 'tools/migrate/no-rewrite.json');
  const list = loadNoRewrite(listPath);
  if (!o.range && !o.files) throw new InputError('check-rewrite needs --range <base>..<head> or --files <list>');
  const diffs = [];
  if (o.range) {
    const m = /^(.+)\.\.(.+)$/.exec(o.range);
    if (!m) throw new InputError('--range must look like <base>..<head>');
    for (const rev of [m[1], m[2]]) {
      const r = cp.spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { encoding: 'utf8' });
      if (r.status !== 0) throw new InputError(`--range: ${rev} is not a commit in ${root}`);
    }
    const paths = list.entries.map((e) => e.path);
    const baseSha = blobShas(root, m[1], paths);
    const headSha = blobShas(root, m[2], paths.map((p) => M.mapPath(p)));
    const movedPaths = paths.filter((p) => M.mapPath(p) !== p);
    const origHead = movedPaths.length ? blobShas(root, m[2], movedPaths) : new Map();
    for (const e of list.entries) {
      const hp = M.mapPath(e.path); const hs = headSha.get(hp);
      // a listed path that a map entry fills may keep a file at head only if that file is exactly a verified move into it:
      // the source is listed, exists at the base, and the bytes now at this path equal the source's listed sha256
      const filledByMove = list.entries.some((c) => c.path !== e.path && M.mapPath(c.path) === e.path && baseSha.get(c.path) !== null && origHead.get(e.path) === c.sha256);
      if (hp !== e.path && !filledByMove && origHead.get(e.path) !== null) { diffs.push(`${e.path}: still present at ${m[2]} although the layout-map moves it to ${hp} (a copy, not a move)`); continue; }
      if (hs === null) { diffs.push(`${e.path}: absent at ${m[2]}${hp !== e.path ? ` as ${hp}` : ''} (renamed without a layout-map entry, or deleted)`); continue; }
      if (hs !== e.sha256) diffs.push(`${hp}: bytes changed (listed ${e.sha256.slice(0, 12)}, now ${hs.slice(0, 12)}${baseSha.get(e.path) === hs ? '; the listing itself is stale at the base' : '; modified inside the range'})`);
    }
  }
  if (o.files) {
    let text;
    try { text = fs.readFileSync(o.files, 'utf8'); } catch (e) { throw new InputError(`cannot read --files ${o.files}: ${e.code || e.message}`); }
    const protectedSet = new Map();
    for (const e of list.entries) { protectedSet.set(e.path, e.path); protectedSet.set(M.mapPath(e.path), e.path); }
    for (const line of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const norm = path.posix.normalize(line.replace(/^\.\//, ''));
      const parts = norm.split('/'); let hit = null;
      for (let i = 1; i <= parts.length && !hit; i++) { const pre = parts.slice(0, i).join('/'); if (protectedSet.has(pre)) hit = pre; }
      if (hit) diffs.push(`${norm}: a rewriter would write ${hit === norm ? 'a no-rewrite file' : `through the listed path ${hit}`}`);
    }
  }
  for (const d of diffs) process.stdout.write(`RED ${d}\n`);
  process.stdout.write(diffs.length ? `seal-baseline check-rewrite: ${diffs.length} no-rewrite file(s) touched\n` : `seal-baseline check-rewrite: ok (${list.entries.length} listed files untouched)\n`);
  return diffs.length ? 1 : 0;
}

function cmdBuildNoRewrite(o) {
  const root = resolveRoot(o);
  if (!o.out) throw new InputError('build-no-rewrite needs --out');
  const base = loadRecord(o.baseline, '--baseline');
  const tracked = trackedFiles(root); const has = new Set(tracked);
  const via = new Map(); // path -> Set(tags)
  const links = new Set(cp.execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0').filter((l) => l.startsWith('120000 ')).map((l) => l.split('\t')[1]));
  // a referenced path that runs through tracked symlinks (an ancestor directory or the file itself) is protected as the
  // symlink blobs plus the file they finally resolve to, following links to links
  const chainPaths = (f) => {
    const out = []; let parts = f.split('/'); let cur = ''; let follows = 0;
    for (let i = 0; i < parts.length; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      if (!links.has(cur)) continue;
      out.push(cur);
      const rest = parts.slice(i + 1);
      // the kernel gives up (ELOOP) after 40 symlink follows while resolving one path; so does this walk, loudly
      if (++follows > 40) throw new InputError(`symlink cycle or chain longer than 40 while resolving ${f} (at ${cur})`);
      let link;
      try { link = fs.readlinkSync(path.join(root, cur)); } catch (e) { throw new InputError(`cannot read symlink ${cur}: ${e.code || e.message}`); }
      // a link to "." (or any ./x) joins to "./rest": normalize so it matches the tracked name
      const next = path.posix.normalize([path.posix.join(path.posix.dirname(cur), link), ...rest].join('/'));
      if (next === '.' || next.startsWith('../') || next.startsWith('/')) break;
      parts = next.split('/'); cur = ''; i = -1;
    }
    out.push(parts.join('/'));
    return out;
  };
  const take = (f, tag) => {
    const paths = chainPaths(f);
    for (const q of paths) {
      if (!has.has(q)) continue;
      const t = q === f ? tag : (links.has(q) ? 'symlink-chain' : `symlink-target:${tag}`);
      if (!via.has(q)) via.set(q, new Set()); via.get(q).add(t);
    }
  };
  const under = (dir) => tracked.filter((f) => f.startsWith(dir.endsWith('/') ? dir : `${dir}/`));
  const bn = (f) => path.posix.basename(f);

  for (const obj of Object.values(base.objects)) for (const f of Object.keys(obj.files)) take(f, `baseline:${obj.category}`);
  try {
    const sd = require(path.join(root, locate(tracked, 'sealed-docs.js')));
    for (const f of sd.sealedDocFiles(root)) take(posix(f), 'sealed-docs');
  } catch (e) { throw new InputError(`sealedDocFiles() failed: ${e.message}`); }
  for (const f of tracked) {
    if (skipNoise(f)) continue;
    if (/^mission-.+-(execution-graph|sources|task-authority)\.json$/.test(bn(f))) take(f, 'mission-file');
    else if (/g\d+-(artifact|disposition)\.json$/.test(bn(f)) || /\.plan-review-manifest\.json$/.test(bn(f))) take(f, 'review-chain');
    else if ((/^receipt-.*\.json$/.test(bn(f)) || bn(f) === 'lifecycle-receipt.json' || bn(f) === 'g1-receipt.txt') && f.startsWith('docs/')) take(f, 'receipt');
    else if (f.startsWith('evals/') && /\.seal\.json$/.test(f)) {
      take(f, 'seal');
      try { const sp = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).spec_path; if (typeof sp === 'string') take(path.posix.normalize(sp), 'seal-spec'); } catch { /* not a seal */ }
    }
  }
  // files whose sha256 a script pins as a constant
  const pinScripts = ['engine-qualify.js', 'qualification-asset-seals.js', 'next-touch-validation.js'].map((n) => ({ n, f: tracked.find((x) => bn(x) === n && !skipNoise(x)) })).filter((x) => x.f);
  const pinned = new Map();
  for (const { n, f } of pinScripts) for (const h of fs.readFileSync(path.join(root, f), 'utf8').match(/\b[0-9a-f]{64}\b/g) || []) pinned.set(h, n);
  for (const f of tracked) {
    if (f.startsWith('evals/skill-onoff/packs/') || skipNoise(f)) continue;
    let st; try { st = fs.statSync(path.join(root, f)); } catch { continue; }
    if (!st.isFile() || st.size > 16 << 20) continue;
    const hit = pinned.get(shaOf(root, f)); if (hit) take(f, `hash-pin:${hit}`);
  }
  // pack copies
  const packManifest = tracked.find((x) => x.endsWith('/packs/manifest.json') && x.startsWith('evals/'));
  if (packManifest) {
    const pm = JSON.parse(fs.readFileSync(path.join(root, packManifest), 'utf8'));
    for (const files of Object.values(pm.packs || {})) for (const k of Object.keys(files)) take(path.posix.join(path.posix.dirname(packManifest), k), 'pack');
  }
  // frozen-evidence markers and golden / rollover fixtures
  for (const m of tracked.filter((x) => bn(x) === '.frozen-evidence')) {
    take(m, 'frozen-evidence');
    const dir = path.posix.dirname(m);
    for (const line of fs.readFileSync(path.join(root, m), 'utf8').split('\n').map((x) => x.replace(/#.*/, '').trim()).filter(Boolean)) {
      const target = path.posix.normalize(path.posix.join(dir, line));
      if (has.has(target)) take(target, 'frozen-evidence');
      else for (const f of under(target === '.' ? '' : target)) take(f, 'frozen-evidence');
    }
  }
  for (const f of tracked) {
    if (/(^|\/)fixtures\/.*(golden|\.frozen-)/.test(f) || (f.startsWith('evals/') && /golden/.test(bn(f)))) take(f, 'golden-fixture');
  }

  // D9.6 exclusions: files the plan lets change
  const railFiles = Object.values(base.objects).filter((x) => x.category === 'rail-pin').flatMap((x) => Object.keys(x.files)).filter((f) => !/prereg\/|run-d0gate-campaign/.test(f));
  const excl = [];
  const exclude = (f, cls, reason) => excl.push({ path: f, class: cls, reason, was_candidate: via.has(f) });
  for (const f of railFiles) exclude(f, 'O9', 'rail file of the d0gate runner pin; P4 moves it and edits its require / SELF_DIR paths, and that row is archive-only after the move (D9.3)');
  for (const f of ['hooks/tests/skill-onoff-g67.test.sh', 'hooks/tests/skill-onoff-g8.test.sh']) exclude(f, 'O8', 'pinned by the g67 / g8 FROZEN rows through a ../../ key; P3 moves and rewrites it, and those rows are archive-only after the move (D9.3)');
  for (const f of tracked.filter((x) => /^validate-.*\.js$/.test(bn(x)) && !skipNoise(x))) {
    if (via.has(f) && [...via.get(f)].some((t) => t === 'hash-pin:next-touch-validation.js')) exclude(f, 'O12', 'pinned by the next-touch validator table, a closed mission and a retirement candidate; P4 moves it');
  }
  for (const f of ['skills/dev-flow/SKILL.md', 'skills/ceo-agent/SKILL.md']) exclude(f, 'O10', 'the profiles-hash-repin flow rewrites these two by design (content_hash rows are repinned)');
  exclude('scripts/check-guidance-eval.js', 'O8-ext', 'amend-7 pins it through a ../../ key; D9.3 turned the rows pointing at it into archive-only records (no longer a formally re-runnable evaluation), same reasoning as O8; P4 moves it and edits its require paths');
  exclude('hooks/fixtures/supersession-anchors.json', 'O14', 'P4 rewrites only its "file" field; the protected-region sha256 / bytes stay (checked by check-supersession-anchors.js)');
  const exSet = new Set(excl.map((e) => e.path));
  // check-rewrite compares git blobs: for a tracked symlink the blob is the link text, so hash that, not the target's bytes
  const entryHash = (f) => { if (!links.has(f)) return shaOf(root, f); try { return sha256(Buffer.from(fs.readlinkSync(path.join(root, f)))); } catch { return null; } };
  const entries = [...via.keys()].filter((f) => !exSet.has(f)).sort().map((f) => ({ path: f, sha256: entryHash(f), via: [...via.get(f)].sort() }));
  const missing = entries.filter((e) => e.sha256 === null);
  if (missing.length) throw new InputError(`tracked but unreadable: ${missing.map((e) => e.path).join(', ')}`);
  const out = { schema: 1, tool: 'seal-baseline', note: 'files whose bytes must never change in a relayout phase (D9.6); excluded = files the plan allows to change, each with its reason', entries, excluded: excl.sort((a, b) => a.path.localeCompare(b.path)) };
  // one entry per line keeps the committed file diffable
  fs.writeFileSync(o.out, `{\n"schema": 1,\n"tool": "seal-baseline",\n"note": ${JSON.stringify(out.note)},\n"excluded": ${JSON.stringify(out.excluded, null, 1)},\n"entries": [\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n}\n`);
  process.stdout.write(`seal-baseline: ${entries.length} no-rewrite entries, ${excl.length} exclusions -> ${o.out}\n`);
  return 0;
}

function main(argv) {
  const cmd = argv[0];
  const o = parseArgs(argv.slice(1));
  if (cmd === 'record') return cmdRecord(o);
  if (cmd === 'compare') return cmdCompare(o);
  if (cmd === 'check-rewrite') return cmdCheckRewrite(o);
  if (cmd === 'build-no-rewrite') return cmdBuildNoRewrite(o);
  throw new InputError('usage: seal-baseline.js record|compare|check-rewrite|build-no-rewrite ... (see the file header)');
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    if (e instanceof InputError) { process.stderr.write(`seal-baseline: ${e.message}\n`); process.exitCode = 2; } else throw e;
  }
}
module.exports = { compareRecords, makeMapper };
