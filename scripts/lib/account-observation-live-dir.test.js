'use strict';
// G40-N37: parity vectors for <live_dir> (plan 21.3). The autopilot resolver (live-state-dir.js resolveLiveDir /
// liveDirCandidates) and a reference reader written from the text of 21.3 must return the same path on every
// vector; a reader that takes a /tmp candidate without the RAM-backed rule must fail one vector.
//
// Plan 21.3: the autopilot resolver's /tmp candidate (source 'tmp') counts only when /tmp is a RAM filesystem.
// These vectors keep /tmp on ext4, as on the operator's hosts, and the assertion below names that candidate. Fixtures only; the shm vector is checked by candidate order (pure) because resolving
// it would create the real /dev/shm/autopilot-<uid>. Nothing here touches ~/.autopilot or any live directory.
// Run: node --test scripts/lib/account-observation-live-dir.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLiveDir, liveDirCandidates } = require('./live-state-dir');
const { mirrorPath } = require('./account-observation');

const UID = process.getuid();

// ---- the reference readers (21.3), over an abstract world --------------------------------------
// world: { env, runUserRoot, runUserHasUid, ram(dir) -> bool, home, tmpPresent }
function referenceCandidates(w) {
  const list = [];
  if (w.env.XDG_RUNTIME_DIR) list.push(path.join(w.env.XDG_RUNTIME_DIR, 'autopilot'));
  else if (w.runUserHasUid) list.push(path.join(w.runUserRoot, String(UID), 'autopilot'));
  list.push(`/dev/shm/autopilot-${UID}`);
  return list;
}
function referenceReader(w) {
  if (w.env.AUTOPILOT_LIVE_DIR) return w.env.AUTOPILOT_LIVE_DIR;
  for (const c of referenceCandidates(w)) if (w.ram(c)) return c;
  return path.join(w.home, '.autopilot');
}
// codeforge-shaped reader: no xdg-inferred step, and a /tmp candidate taken when the directory is merely present.
function codeforgeShapedReader(w) {
  if (w.env.AUTOPILOT_LIVE_DIR) return w.env.AUTOPILOT_LIVE_DIR;
  const list = [];
  if (w.env.XDG_RUNTIME_DIR) list.push([path.join(w.env.XDG_RUNTIME_DIR, 'autopilot'), w.ram]);
  list.push([`/dev/shm/autopilot-${UID}`, w.ram]);
  list.push([`/tmp/autopilot-${UID}`, () => w.tmpPresent]);
  for (const [c, ok] of list) if (ok(c)) return c;
  return path.join(w.home, '.autopilot');
}

// ---- the world builder ---------------------------------------------------------------------
function withWorld(spec, fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'g40-n37-')));
  const savedHome = process.env.HOME;
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  process.env.HOME = home; // os.homedir() reads it; the resolver only joins .autopilot, it never creates it
  try {
    const env = {};
    const runUserRoot = path.join(root, 'runuser');
    fs.mkdirSync(runUserRoot, { mode: 0o700 });
    if (spec.override) { env.AUTOPILOT_LIVE_DIR = path.join(root, 'override'); fs.mkdirSync(env.AUTOPILOT_LIVE_DIR, { mode: 0o700 }); }
    if (spec.xdg) { env.XDG_RUNTIME_DIR = path.join(root, 'xdg'); fs.mkdirSync(env.XDG_RUNTIME_DIR, { mode: 0o700 }); }
    if (spec.inferred) {
      const parent = path.join(runUserRoot, String(UID));
      fs.mkdirSync(parent, { mode: 0o700 });
      fs.chmodSync(parent, 0o700);
    }
    // RAM only under this world's root when spec.ramUnderRoot; everything else (/dev/shm, /tmp, home) is ext4.
    const isRam = (dir) => spec.ramUnderRoot && path.resolve(dir).startsWith(`${root}${path.sep}`);
    const execFile = (file, args) => (isRam(args[1]) ? 'tmpfs\n' : 'ext4\n');
    const world = {
      env, runUserRoot, runUserHasUid: !!spec.inferred, home, ram: isRam, tmpPresent: !!spec.tmpPresent,
    };
    return fn({ world, env, execFile, runUserRoot, root, home });
  } finally {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function resolve(ctx) {
  return resolveLiveDir({ env: ctx.env, execFile: ctx.execFile, runUserRoot: ctx.runUserRoot, warn: () => {} });
}

// Vectors the resolver can run for real without touching anything outside the temp root.
const RESOLVABLE = [
  { name: 'override', spec: { override: true }, source: 'override' },
  { name: 'xdg', spec: { xdg: true, ramUnderRoot: true }, source: 'xdg' },
  { name: 'xdg-inferred', spec: { inferred: true, ramUnderRoot: true }, source: 'xdg-inferred' },
  { name: 'fallback (no RAM-backed candidate)', spec: {}, source: 'ssd-fallback' },
  { name: 'xdg-inferred absent, /tmp present but not RAM', spec: { tmpPresent: true }, source: 'ssd-fallback' },
];

test('G40-N37 parity: the autopilot resolver and the 21.3 reference reader return the same path on every resolvable vector', () => {
  for (const v of RESOLVABLE) {
    withWorld(v.spec, (ctx) => {
      const got = resolve(ctx);
      assert.strictEqual(got.source, v.source, v.name);
      assert.strictEqual(referenceReader(ctx.world), got.base, `${v.name}: reference reader`);
    });
  }
});

test('G40-N37 parity (shm): with no xdg and no inferred parent the first RAM candidate is /dev/shm/autopilot-<uid>, in the reference order', () => {
  withWorld({}, (ctx) => {
    const cands = liveDirCandidates({ env: ctx.env, runUserRoot: ctx.runUserRoot });
    assert.strictEqual(cands[0], `/dev/shm/autopilot-${UID}`);
    ctx.world.ram = (d) => d === `/dev/shm/autopilot-${UID}`;
    assert.strictEqual(referenceReader(ctx.world), cands[0]);
  });
});

test('G40-N37 parity: candidate order equals the reference list, plus exactly one named extra, the RAM-only /tmp candidate', () => {
  for (const spec of [{ xdg: true }, { inferred: true }, {}]) {
    withWorld(spec, (ctx) => {
      const cands = liveDirCandidates({ env: ctx.env, runUserRoot: ctx.runUserRoot });
      const tmp = `/tmp/autopilot-${UID}`;
      assert.ok(cands.includes(tmp), 'the code has a /tmp candidate (21.3 says none; it applies only when /tmp is RAM-backed)');
      assert.deepStrictEqual(cands.filter((c) => c !== tmp && c !== path.join(ctx.home, '.autopilot')), referenceCandidates(ctx.world));
      assert.strictEqual(cands[cands.length - 1], path.join(ctx.home, '.autopilot'));
    });
  }
});

test('G40-N37 a reader that takes a /tmp candidate without the RAM rule fails the vector xdg-inferred absent + /tmp present', () => {
  withWorld({ tmpPresent: true }, (ctx) => {
    const got = resolve(ctx).base;
    assert.strictEqual(referenceReader(ctx.world), got);
    assert.notStrictEqual(codeforgeShapedReader(ctx.world), got, 'the planted reader returns the /tmp path');
    assert.strictEqual(codeforgeShapedReader(ctx.world), `/tmp/autopilot-${UID}`);
  });
  // and the same planted reader misses the xdg-inferred step (codeforge has none)
  withWorld({ inferred: true, ramUnderRoot: true }, (ctx) => {
    assert.notStrictEqual(codeforgeShapedReader(ctx.world), resolve(ctx).base);
  });
});

test('G40-N37 the mirror path is <live_dir>/quota/<provider>/<alias>.json for the resolver\'s base', () => {
  withWorld({ xdg: true, ramUnderRoot: true }, (ctx) => {
    const base = resolve(ctx).base;
    assert.strictEqual(mirrorPath(base, 'claude', 'main'), path.join(base, 'quota', 'claude', 'main.json'));
  });
});
