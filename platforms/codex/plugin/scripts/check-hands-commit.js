#!/usr/bin/env node
'use strict';
// check-hands-commit.js — reject a hands commit range whose CONTENT is unsafe to integrate,
// independent of whether every path is inside the declared output surface.
//
// Why a content gate when a scope gate exists: the P6D incident (2026-08-21) and 308-db's
// 2026-09-07 incident are the same shape and the scope gate catches neither reliably. A
// hands worktree carried a symlink named for a directory the target ignores with a trailing
// slash (`node_modules/`, `.venv/`). Git's ignore match for `dir/` is directory-only, so the
// SYMLINK is not ignored, `git add -A` sweeps it in, and a later cherry-pick replaces the
// real ignored directory in the integration target with a self-pointing link. Every path
// was inside scope. Nothing looked at the MODE.
//
// Three checks, all over the RANGE base..head — what hands brought in, never the whole
// tree (a tracked-but-ignored file inherited from base is not hands' doing; 308-db measured
// three of those on one repo and they would be false positives):
//   1. symlinks added or newly-made (mode 120000 where the old mode was not 120000)
//   2. gitlinks added (mode 160000 — a submodule pointer where a directory was)
//   3. added paths that the worktree's OWN ignore rules match (--no-renames: a rename is A+D) (`--no-index`, or a
//      force-added path reads as not ignored — measured 2026-09-12)
//
// Exit codes (a gate, so they are the contract):
//   0  clean — every check ran and found nothing
//   1  violation — at least one check found something; JSON names every hit
//   2  usage
//   3  check could not run — git failed, or check-ignore returned 128 on input. Callers
//      MUST treat 3 as "not verified", never as clean. 308-db's first version read an
//      empty-stdin 128 as zero hits and produced a row of false zeros.
//
// Usage: check-hands-commit.js --repo <worktree> --base <sha> --head <sha>
// (No allowlist: a symlink hands adds is rejected, full stop. A sanctioned-symlink policy
// needs a sealed contract to carry it; a CLI flag nothing wires is a policy nobody set.)
// Output: JSON {ok, base, head, symlinks:[{path,old_mode,new_mode}], gitlinks:[...],
//               ignored:[path], checks_ran:{modes,ignore}, error}

const { spawnSync } = require('child_process');

function usage(msg) {
  if (msg) process.stderr.write(`check-hands-commit: ${msg}\n`);
  process.stderr.write('usage: check-hands-commit.js --repo <worktree> --base <sha> --head <sha>\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => { if (i + 1 >= args.length) usage(`${a} requires a value`); return args[++i]; };
  if (a === '--repo') opts.repo = next();
  else if (a === '--base') opts.base = next();
  else if (a === '--head') opts.head = next();
  else if (a === '-h' || a === '--help') usage();
  else usage(`unknown argument: ${a}`);
}
if (!opts.repo || !opts.base || !opts.head) usage('--repo, --base and --head are required');

// Raw bytes in, raw bytes out. A filename is not text: decoding stdout as UTF-8 replaces
// invalid bytes before they reach check-ignore, and a raw-byte name matching a raw-byte
// ignore rule would then evade the gate (review, 2026-09-13). Decode only for display.
function git(argv, input) {
  // GIT_NO_REPLACE_OBJECTS: a refs/replace/* entry makes diff-tree inspect the substitute
  // instead of the real commit (measured 2026-09-13: a replaced head hid a 120000 entry).
  const r = spawnSync('git', ['-C', opts.repo, ...argv], {
    input, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
  });
  return {
    status: r.status,
    stdout: r.stdout || Buffer.alloc(0),
    stderr: (r.stderr || Buffer.alloc(0)).toString('utf8'),
  };
}
function display(buf) { return buf.toString('utf8'); }
function splitNul(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) { out.push(buf.subarray(start, i)); start = i + 1; }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

// base/head are recorded as FULL object ids, not as typed. A receipt that echoes an
// abbreviated sha can collide across repos (308-db, 2026-09-13); resolving here also
// turns an unresolvable ref into rc 3 before any check pretends to have run.
function resolveOid(ref) {
  const r = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  return r.status === 0 ? display(r.stdout).trim() : null;
}
const baseOid = resolveOid(opts.base);
const headOid = resolveOid(opts.head);
const out = {
  ok: false, base: baseOid || opts.base, head: headOid || opts.head,
  symlinks: [], gitlinks: [], ignored: [],
  checks_ran: { modes: false, ignore: false }, error: null,
};
function emit(code) {
  out.ok = code === 0;
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(code);
}

if (!baseOid || !headOid) {
  out.error = `cannot resolve ${!baseOid ? `base '${opts.base}'` : `head '${opts.head}'`} to a commit`;
  emit(3);
}

// --- 1 & 2: modes over the range. diff-tree -r is the mechanism: it reports old and new
// mode per entry, which is the one thing `diff --name-only` and scope checks discard.
// -z: paths are NUL-terminated raw bytes. Newline-delimited output quotes or mangles a
// legal path containing a tab, newline or non-UTF-8 byte, and an added ignored path with
// such a name would evade the check (review, 2026-09-13).
const dt = git(['diff-tree', '-r', '-z', '--no-commit-id', '--no-renames', baseOid, headOid]);
if (dt.status !== 0) {
  out.error = `git diff-tree failed (${dt.status}): ${dt.stderr.trim()}`;
  emit(3);
}
const added = [];   // Buffers — the raw bytes go to check-ignore
// -z framing: ":<old_mode> <new_mode> <old_sha> <new_sha> <status>\0<path>\0" per entry.
const fields = splitNul(dt.stdout);
for (let i = 0; i + 1 < fields.length; i += 2) {
  const meta = display(fields[i]);
  const pathBuf = fields[i + 1];
  const path = display(pathBuf);
  if (!meta.startsWith(':')) { i -= 1; continue; }
  const [oldMode, newMode, , , status] = meta.slice(1).split(' ');
  // Only ADDED entries reach the ignore check. A modification to a tracked file that base
  // already carried under an ignore rule (a force-added knowledge file, say) is not hands
  // bringing something in — feeding M/T here rejected exactly that (review, 2026-09-13).
  // Mode transitions are judged separately, above, from the diff-tree modes.
  if (status === 'A') added.push(pathBuf);
  if (newMode === '120000' && oldMode !== '120000') {
    out.symlinks.push({ path, old_mode: oldMode, new_mode: newMode });
  }
  if (newMode === '160000' && oldMode !== '160000') {
    out.gitlinks.push({ path, old_mode: oldMode, new_mode: newMode });
  }
}
out.checks_ran.modes = true;

// --- 3: ignore rules, over ADDED paths only, and only when there are any. Empty stdin
// makes check-ignore exit 128 (fatal), which is not "no hits" — skip the call instead and
// record that the check ran vacuously over zero inputs.
if (added.length === 0) {
  out.checks_ran.ignore = true;
} else {
  const ci = git(['check-ignore', '--no-index', '-z', '--stdin'], Buffer.concat(added.flatMap((b) => [b, Buffer.from([0])])));
  // check-ignore: 0 = some ignored (listed on stdout), 1 = none ignored, 128 = error.
  if (ci.status === 0) {
    out.ignored = splitNul(ci.stdout).filter((b) => b.length).map(display);
    out.checks_ran.ignore = true;
  } else if (ci.status === 1) {
    out.checks_ran.ignore = true;
  } else {
    out.error = `git check-ignore failed (${ci.status}): ${ci.stderr.trim()} — ignore check did NOT run`;
    emit(3);
  }
}

if (out.symlinks.length || out.gitlinks.length || out.ignored.length) emit(1);
emit(0);
