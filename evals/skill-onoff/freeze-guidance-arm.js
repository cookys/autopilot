#!/usr/bin/env node
// freeze-guidance-arm.js — P5 arm builder for the stage-graph guidance eval (plan
// docs/plans/2026-10-06-dev-flow-stage-graph.md §2.8 + §4 P5 item 7; frozen rule prereg/stage-graph.{md,json}).
// An ARM here is a SET of packs (16 skills + the non-skill guidance files + the fixture scripts), described by an
// arm manifest the harness installs (`run-skill-onoff-eval.sh --arm-manifest`, shape documented there).
//
//   freeze-guidance-arm.js base   [--suffix s] [--fixture-pack id,..]
//       Write arms/stage-graph/base.json from the already-frozen `<skill>-sg-base` + `guidance-files-sg-base`
//       packs (+ `guidance-files-sg-extra-base[-s]` when it exists). Freezes nothing.
//   freeze-guidance-arm.js change [--extra p1,p2,..] [--suffix s] [--repo dir] [--allow-unlisted] [--fixture-pack ..]
//       Freeze the CHANGE arm from the CURRENT working tree of --repo (default: this repo) for exactly the
//       prereg's file list (`guidance.files`, plus --extra non-skill paths added pre-run):
//         <skill>-sg-change[-s]            = the frozen <skill>-sg-base tree with every listed file replaced by its
//                                            working-tree bytes (a listed file absent from the tree is a deletion)
//         guidance-files-sg-change[-s]     = the prereg non_skill_files (+ extras) from the working tree
//         guidance-files-sg-extra-base[-s] = the extras from guidance.base_ref (git), so base can ship them too
//       Writes arms/stage-graph/{change,base}.json. A frozen pack is never mutated: an existing id is an error and
//       re-freezing needs a new --suffix (which also leaves check-guidance-eval.js's hard-wired `-sg-change` ids
//       behind — a suffixed arm is a NEW arm and needs its own gate wiring). --extra paths are NOT in
//       prereg guidance.files: amend the prereg (before the first live cell) or the cut gate rejects them; the
//       result's `prereg_amendment` lists exactly what to add. Unlisted working-tree guidance changes inside a
//       frozen skill tree (changed or new files outside the prereg list) are errors unless --allow-unlisted,
//       because the cut gate would fail on them.
//   freeze-guidance-arm.js red [--require-text] [--suffix s] [--change-arm file] [--fixture-pack id] [--repo dir]
//       Build the planted-red arm from the change arm's packs (prereg `mutation`, rotate XS<->L, S<->XL, M kept):
//         * every fixture pack that holds references/stage-graph.json gets a `<id>-red[-s]` copy whose graph has the
//           sizes' `base` + `bug` rules rotated (unit_kind, bump_limits, loop_backs, writers untouched — the size a
//           session RECORDS is not rotated, only the walk it follows). This is what the red AGENT sees whenever it
//           runs `stage-graph.js nodes|next` or `stage-advance.js`, and it is the authoritative rotation: the
//           build then re-queries the rotated copy and asserts every size walks rotate[size]'s base walk.
//         * every .md in the change skill/files packs is rotated best-effort so the prose agrees with the graph:
//           (1) markdown table rows whose first cell is a size id and whose other cells hold stage ids — the stage
//           cells of XS<->L and S<->XL rows of one table swap; (2) list lines `- XS: implement → qc-gate → …` —
//           the sequence after the label swaps within one list run. Counts land in the result and pack_meta; prose
//           the heuristics do not recognise stays as written (the red claim rests on the graph, not the prose).
//       Writes `<skill>-sg-red[-s]`, `guidance-files-sg-red[-s]`, arms/stage-graph/red.json.
//   Env ONOFF_PACKS_DIR overrides the packs dir; --arms-dir overrides arms/stage-graph; --prereg overrides the prereg.
// stdout: one JSON object. Exit: 0 ok · 2 usage/error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const sub = argv[0];
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (n) => argv.includes(n);
const die = (m) => { console.error(`freeze-guidance-arm: ${m}`); process.exit(2); };
if (!['base', 'change', 'red'].includes(sub)) die('usage: freeze-guidance-arm.js base|change|red [options] (see header)');

const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
const armsDir = opt('--arms-dir') || path.join(HERE, 'arms', 'stage-graph');
const preregPath = opt('--prereg') || path.join(HERE, 'prereg', 'stage-graph.json');
const sfxTag = opt('--suffix');
if (sfxTag !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(sfxTag)) die('--suffix must match [a-z0-9._-]');
const sfx = sfxTag ? `-${sfxTag}` : '';
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const G = P.guidance;
const manifestPath = path.join(packsDir, 'manifest.json');
const readManifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fixturePacks = (opt('--fixture-pack') || 'fixture-scripts-sg').split(',').filter(Boolean);
const repoOf = (d) => cp.execFileSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const repo = opt('--repo') ? path.resolve(opt('--repo')) : repoOf(HERE);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-guidance-arm-'));
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const ID = {
  skillBase: (s) => `${s}-sg-base`,
  skillChange: (s) => `${s}-sg-change${sfx}`,
  skillRed: (s) => `${s}-sg-red${sfx}`,
  filesBase: 'guidance-files-sg-base',
  filesChange: `guidance-files-sg-change${sfx}`,
  filesRed: `guidance-files-sg-red${sfx}`,
  extraBase: `guidance-files-sg-extra-base${sfx}`,
};

function walk(dir, pre = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]));
}
// digest-verified read of a frozen pack -> Map(rel -> {data, mode})
function readPack(id) {
  const man = readManifest();
  const entry = man.packs && man.packs[id];
  if (!entry) die(`pack not frozen: ${id}`);
  const out = new Map();
  for (const [key, digest] of Object.entries(entry)) {
    const p = path.join(packsDir, key);
    const data = fs.readFileSync(p);
    if (sha(data) !== digest) die(`digest mismatch in pack ${id}: ${key}`);
    out.set(key.slice(id.length + 1), { data, mode: fs.statSync(p).mode & 0o111 ? 0o755 : 0o644 });
  }
  return out;
}
function assertFresh(id) {
  const man = readManifest();
  if ((man.packs && man.packs[id]) || fs.existsSync(path.join(packsDir, id))) die(`pack id already exists: ${id} (frozen packs are never mutated; use a new --suffix)`);
}
function stage(files) { // Map(rel -> {data,mode}) -> staging dir
  const d = fs.mkdtempSync(path.join(tmpRoot, 'stage-'));
  for (const [rel, f] of files) {
    const out = path.join(d, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.data, { mode: f.mode });
  }
  return d;
}
function freeze(id, files, meta) {
  const dir = stage(files);
  const r = cp.spawnSync('node', [path.join(HERE, 'freeze-pack.js'), '--id', id, '--from-dir', dir, '--ref', 'label'], { encoding: 'utf8', env: { ...process.env, ONOFF_PACKS_DIR: packsDir } });
  if (r.status !== 0) die(`freeze-pack ${id} failed: ${(r.stderr || r.stdout).trim()}`);
  const man = readManifest();
  man.pack_meta = man.pack_meta || {};
  man.pack_meta[id] = { ...meta, files: files.size };
  fs.writeFileSync(manifestPath, `${JSON.stringify(man, null, 2)}\n`);
}
const writeArm = (arm, body) => {
  fs.mkdirSync(armsDir, { recursive: true });
  const file = path.join(armsDir, `${arm}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ schema_version: 1, arm, ...body }, null, 2)}\n`);
  return file;
};
const gitHead = () => { try { return cp.execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

// ───────────────────────────── base ─────────────────────────────
function armBase() {
  const man = readManifest();
  const skills = {};
  for (const s of G.skills) { if (!man.packs[ID.skillBase(s)]) die(`base pack missing: ${ID.skillBase(s)}`); skills[s] = ID.skillBase(s); }
  if (!man.packs[ID.filesBase]) die(`base pack missing: ${ID.filesBase}`);
  const files = [ID.filesBase];
  if (man.packs[ID.extraBase]) files.push(ID.extraBase);
  return writeArm('base', { skills, files, fixture_scripts: fixturePacks });
}

// ───────────────────────────── change ─────────────────────────────
function armChange() {
  const man = readManifest();
  const extras = (opt('--extra') || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => path.posix.normalize(s));
  for (const e of extras) {
    if (e.startsWith('/') || e.startsWith('..')) die(`--extra must be a repo-relative path: ${e}`);
    if (e.startsWith('skills/')) die(`--extra under skills/ cannot join a frozen skill base: ${e} (needs a new skill arm)`);
  }
  const extrasNew = extras.filter((e) => !G.files.includes(e));
  const nonSkill = [...new Set([...G.non_skill_files, ...extras])].sort();
  // refuse anything that would mutate: check EVERY target id before writing one
  for (const s of G.skills) assertFresh(ID.skillChange(s));
  assertFresh(ID.filesChange);
  if (extras.length) assertFresh(ID.extraBase);
  const wt = (rel) => { const p = path.join(repo, rel); return fs.existsSync(p) ? { data: fs.readFileSync(p), mode: fs.statSync(p).mode & 0o111 ? 0o755 : 0o644 } : null; };
  const head = gitHead();
  const dirty = cp.spawnSync('git', ['-C', repo, 'status', '--porcelain', '--', ...G.files, ...extras], { encoding: 'utf8' }).stdout.trim() ? '+worktree' : '';
  const meta = (kind, source) => ({ kind, source, ref: `${head}${dirty}`, base_ref: G.base_ref });

  const planned = [];
  const unlisted = [];
  const deleted = [];
  for (const s of G.skills) {
    const files = readPack(ID.skillBase(s));
    const listed = G.files.filter((f) => f.startsWith(`skills/${s}/`));
    for (const f of listed) {
      const rel = f.slice(`skills/${s}/`.length);
      const cur = wt(f);
      if (cur) files.set(rel, cur); else { files.delete(rel); deleted.push(f); }
    }
    // working-tree files in this skill dir the prereg list does not cover but that differ from / are absent in the base pack
    const sdir = path.join(repo, 'skills', s);
    if (fs.existsSync(sdir)) {
      for (const rel of walk(sdir)) {
        const f = `skills/${s}/${rel}`;
        if (G.files.includes(f)) continue;
        const b = files.get(rel);
        const cur = fs.readFileSync(path.join(sdir, rel));
        if (!b || !b.data.equals(cur)) unlisted.push(f);
      }
    }
    planned.push([ID.skillChange(s), files, meta('skill', s)]);
  }
  const filesPack = new Map();
  for (const f of nonSkill) { const cur = wt(f); if (cur) filesPack.set(f, cur); else deleted.push(f); }
  planned.push([ID.filesChange, filesPack, meta('guidance-files', nonSkill.join(','))]);
  const absentAtBase = [];
  if (extras.length) {
    const eb = new Map();
    for (const e of extras) {
      const r = cp.spawnSync('git', ['-C', repo, 'show', `${G.base_ref}:${e}`], { encoding: null, maxBuffer: 1 << 28 });
      if (r.status === 0) eb.set(e, { data: r.stdout, mode: 0o644 }); else absentAtBase.push(e);
    }
    planned.push([ID.extraBase, eb, { kind: 'guidance-files', source: extras.join(','), ref: G.base_ref }]);
  }
  if (unlisted.length && !flag('--allow-unlisted')) die(`working-tree guidance changes outside the prereg file list (the cut gate would reject them; amend the prereg or use --allow-unlisted): ${unlisted.join(', ')}`);
  for (const [id, files, m] of planned) freeze(id, files, m);

  const skills = Object.fromEntries(G.skills.map((s) => [s, ID.skillChange(s)]));
  const changeArm = writeArm('change', { skills, files: ID.filesChange, fixture_scripts: fixturePacks });
  const baseArm = armBase();
  return {
    frozen: planned.map(([id, f]) => ({ id, files: f.size })),
    arms: [changeArm, baseArm],
    deleted,
    unlisted_allowed: unlisted,
    extras_absent_at_base: absentAtBase,
    prereg_amendment: extrasNew.length ? { add_to_guidance_files_and_non_skill_files: extrasNew, note: 'edit prereg/stage-graph.json (+ .md) before the first live cell; check-guidance-eval.js rejects a differing manifest file that is not in guidance.files' } : null,
    head,
    dirty: !!dirty,
  };
}

// ───────────────────────────── red ─────────────────────────────
const ROT = P.mutation.rotate; // XS<->L, S<->XL, M->M
const STAGE_RE = /\b(intent|diagnose|proposal|implement|verify|code-review|qc-gate|plan-review|finish)\b/;
const seqLike = (t) => STAGE_RE.test(t) || /\bas\s+(XS|S|M|L|XL)\b/i.test(t); // "as L, but …" is a sequence reference too

function rotateGraph(text) {
  const g = JSON.parse(text);
  const out = JSON.parse(text);
  for (const size of Object.keys(g.sizes)) {
    const from = ROT[size];
    if (!from || !g.sizes[from]) die(`graph lacks size ${from} for rotation of ${size}`);
    out.sizes[size].base = g.sizes[from].base;
    out.sizes[size].bug = g.sizes[from].bug;
  }
  out.source = `${g.source} [PLANTED-RED: size table rotated XS<->L S<->XL]`;
  return `${JSON.stringify(out, null, 2)}\n`;
}

function rotateMarkdown(md) {
  const lines = md.split('\n');
  let tables = 0;
  let lists = 0;
  const label = (c) => c.replace(/[`*_\s]/g, '');
  // (1) tables
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trimStart().startsWith('|')) { i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].trimStart().startsWith('|')) j++;
    const rows = {};
    for (let k = i; k < j; k++) {
      const cells = lines[k].split('|');
      const l = cells.length > 2 ? label(cells[1]) : '';
      if (ROT[l] && l !== 'M' && !(l in rows)) rows[l] = { k, cells };
    }
    for (const [a, b] of [['XS', 'L'], ['S', 'XL']]) {
      if (!rows[a] || !rows[b]) continue;
      const ca = rows[a].cells;
      const cb = rows[b].cells;
      for (let c = 2; c < Math.min(ca.length, cb.length) - 1; c++) {
        if (seqLike(ca[c]) || seqLike(cb[c])) { const t = ca[c]; ca[c] = cb[c]; cb[c] = t; tables++; }
      }
      lines[rows[a].k] = ca.join('|');
      lines[rows[b].k] = cb.join('|');
    }
    i = j;
  }
  // (2) list lines "- XS: a → b → c"
  const LIST = /^(\s*(?:[-*]|\d+\.)\s+)(\**`?)(XS|S|M|L|XL)(`?\**)(\s*[:：]\s*|\s+[—–-]\s+)(.+)$/;
  for (let i = 0; i < lines.length;) {
    if (!/^\s*(?:[-*]|\d+\.)\s/.test(lines[i])) { i++; continue; }
    let j = i;
    while (j < lines.length && /^\s*(?:[-*]|\d+\.)\s/.test(lines[j])) j++;
    const hit = {};
    for (let k = i; k < j; k++) {
      const m = lines[k].match(LIST);
      if (m && m[3] !== 'M' && seqLike(m[6]) && !(m[3] in hit)) hit[m[3]] = { k, m };
    }
    for (const [a, b] of [['XS', 'L'], ['S', 'XL']]) {
      if (!hit[a] || !hit[b]) continue;
      const mk = (x, rhs) => `${x.m[1]}${x.m[2]}${x.m[3]}${x.m[4]}${x.m[5]}${rhs}`;
      const ra = hit[a].m[6];
      const rb = hit[b].m[6];
      lines[hit[a].k] = mk(hit[a], rb);
      lines[hit[b].k] = mk(hit[b], ra);
      lists += 2;
    }
    i = j;
  }
  return { text: lines.join('\n'), tables, lists };
}

function armRed() {
  const changeArmFile = opt('--change-arm') || path.join(armsDir, 'change.json');
  let change;
  try { change = JSON.parse(fs.readFileSync(changeArmFile, 'utf8')); } catch (e) { die(`cannot read the change arm manifest ${changeArmFile} (run \`change\` first): ${e.message}`); }
  const redOf = (id) => (id.includes('-sg-change') ? id.replace('-sg-change', '-sg-red') : `${id}-red${sfx}`);
  const filesChange = [].concat(change.files || []);
  const planned = [];
  const totals = { tables: 0, lists: 0, md_files_changed: 0 };
  const rotatePack = (id, kind, source) => {
    const files = readPack(id);
    let changed = 0;
    for (const [rel, f] of files) {
      if (!rel.endsWith('.md')) continue;
      const r = rotateMarkdown(f.data.toString('utf8'));
      if (r.tables + r.lists > 0) { files.set(rel, { data: Buffer.from(r.text), mode: f.mode }); changed++; totals.tables += r.tables; totals.lists += r.lists; }
    }
    totals.md_files_changed += changed;
    const rid = redOf(id);
    assertFresh(rid);
    planned.push([rid, files, { kind, source, ref: `red-of:${id}`, derived_from: id, rotate: ROT, md_files_rotated: changed }]);
    return rid;
  };
  const skills = {};
  for (const [s, id] of Object.entries(change.skills || {})) skills[s] = rotatePack(id, 'skill', s);
  if (flag('--require-text') && !totals.md_files_changed) die('--require-text: no size-sequence prose was rotated in any change skill pack (the heuristics found no size table / list line)');
  const files = filesChange.map((id) => rotatePack(id, 'guidance-files', id));
  const fixtures = [];
  const graphChecks = [];
  for (const id of change.fixture_scripts || []) {
    const pack = readPack(id);
    const g = pack.get('references/stage-graph.json');
    if (!g) { fixtures.push(id); continue; }
    const rid = `${id}-red${sfx}`;
    assertFresh(rid);
    pack.set('references/stage-graph.json', { data: Buffer.from(rotateGraph(g.data.toString('utf8'))), mode: g.mode });
    planned.push([rid, pack, { kind: 'scripts', source: id, ref: `red-of:${id}`, derived_from: id, rotate: ROT }]);
    fixtures.push(rid);
    graphChecks.push([id, rid, pack, readPack(id)]);
  }
  if (!graphChecks.length) die('the change arm has no fixture pack holding references/stage-graph.json — the red arm would rotate nothing the agent queries');
  // Re-derive the rotation by QUERYING the staged red graph with the pack's own stage-graph.js (never trust the writer).
  for (const [, rid, redPack, basePack] of graphChecks) {
    const q = (pack, args) => {
      const d = stage(pack);
      const r = cp.spawnSync('node', [path.join(d, 'scripts', 'stage-graph.js'), ...args], { encoding: 'utf8' });
      if (r.status !== 0) die(`stage-graph.js ${args.join(' ')} failed in ${rid}: ${(r.stderr || '').trim()}`);
      return JSON.parse(r.stdout);
    };
    void basePack;
    for (const size of Object.keys(ROT)) for (const extra of [[], ['--bug'], ['--urgent']]) {
      const got = q(redPack, ['nodes', '--size', size, ...extra]).walk;
      const want = q(basePack, ['nodes', '--size', ROT[size], ...extra]).walk;
      if (JSON.stringify(got) !== JSON.stringify(want)) die(`red graph self-check failed: ${size} ${extra.join(' ')} walks ${got} != ${ROT[size]}'s base walk ${want}`);
    }
    const v = q(redPack, ['validate']);
    if (!v.ok) die(`rotated graph fails stage-graph.js validate: ${JSON.stringify(v.errors)}`);
  }
  for (const [id, f, m] of planned) freeze(id, f, { ...m, rotated_text: { tables: totals.tables, lists: totals.lists } });
  const arm = writeArm('red', { skills, files: files.length === 1 ? files[0] : files, fixture_scripts: fixtures });
  const warnings = [];
  if (totals.tables + totals.lists === 0) warnings.push('no size-sequence prose recognised in the change packs: the red arm rotates only the graph the scripts serve (rotated text count 0)');
  return { frozen: planned.map(([id, f]) => ({ id, files: f.size })), arm, rotated_text: totals, graph_self_check: 'ok', warnings };
}

const result = sub === 'base' ? { arm: armBase() } : sub === 'change' ? armChange() : armRed();
process.stdout.write(`${JSON.stringify({ ok: true, cmd: sub, ...result })}\n`);
