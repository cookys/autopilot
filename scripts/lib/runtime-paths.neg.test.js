'use strict';
// runtime-paths.neg.test.js -- negative controls for runtime-paths.test.js (BL-0336 F6 matrix; evidence-discipline §58).
// Each case copies runtime-paths.js into a mktemp directory, breaks ONE rule in the copy, runs the unit tests against
// the copy (RUNTIME_PATHS_MODULE) and requires the named test to go red. A case whose mutation no longer matches the
// source fails loudly, so the controls cannot rot into no-ops.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, 'runtime-paths.js');
const UNIT = path.join(__dirname, 'runtime-paths.test.js');
const original = fs.readFileSync(SRC, 'utf8');

const CASES = [
  { name: 'leaf symlink check removed', red: 'leaf symlink is refused',
    from: /if \(isLeaf\) return refuse\(abs, `\$\{next\} is a symbolic link[^\n]*\n/, to: '' },
  { name: 'middle symlink check removed', red: 'symlink in a middle layer outside the home directory is refused',
    from: 'let follow = false;', to: 'let follow = true;' },
  { name: 'ancestor owner check removed', red: 'a middle layer owned by another user is refused even when it is not writable',
    from: 'if (st.uid !== ctx.uid && st.uid !== 0) return refuse(', to: 'if (false) return refuse(' },
  { name: 'sticky judgement removed', red: 'a world-writable parent without the sticky bit is refused',
    from: 'if (!(st.uid === 0 && sticky)) return refuse(', to: 'if (false) return refuse(' },
  { name: 'writable leaf chmod-ed instead of refused', red: 'a leaf that was once writable by others is refused and not chmod-ed',
    from: /if \(othersCanWrite\(st, ctx\)\) return refuse\(abs, `\$\{next\} is writable by other users \(mode[^\n]*\n/,
    to: "if (othersCanWrite(st, ctx)) return { decision: 'tighten', path: abs, reason: null, would_create: [], would_tighten: true };\n" },
  { name: 'tighten chmod removed', red: 'an own 0755 leaf is tightened to 0700',
    from: 'f.chmodSync(verdict.path, 0o700);', to: '/* chmod removed */' },
  { name: 'only one layer created', red: 'missing layers are created one at a time with mode 0700',
    from: [['for (const layer of verdict.would_create) {', 'for (const layer of verdict.would_create.slice(0, 1)) {'],
      ['round < MAX_LINK_DEPTH && verdict', 'round < 1 && verdict']], to: null },
  { name: 'any g+w counts as private', red: 'g+w with a shared primary group (users) is writable by others; a user-private group is not; unreadable is shared',
    from: 'return !ctx.groupPrivate;', to: 'return false;' },
  { name: 'existing TMPDIR skips the private walk', red: 'existing TMPDIR: a link as the leaf, an unsafe ancestor and a leaf others could write are refused; a root-owned sticky root is taken as found',
    from: 'const v = evaluatePrivateDir(dir, deps);\n  if (v.decision === \'refuse\') return', to: 'const v = { decision: \'ok\', path: dir, reason: null, would_create: [], would_tighten: false };\n  if (v.decision === \'refuse\') return' },
  { name: 'shared root chmod-ed too', red: 'a shared system root is never chmod-ed; only the private subdirectory is made',
    from: '    cur = next;\n  }\n  return { decision: \'ok\'', to: "    try { f.chmodSync(next, 0o700); } catch (_e) { /* mutation */ }\n    cur = next;\n  }\n  return { decision: 'ok'" },
];

function run(modulePath) {
  const env = { ...process.env, RUNTIME_PATHS_MODULE: modulePath };
  delete env.NODE_TEST_CONTEXT; // a nested `node --test` that inherits it reports through the parent and runs nothing
  return spawnSync(process.execPath, ['--test', UNIT], { encoding: 'utf8', env });
}

function mutate(c) {
  let text = original;
  const steps = Array.isArray(c.from) ? c.from : [[c.from, c.to]];
  for (const [from, to] of steps) {
    const before = text;
    text = typeof from === 'string' ? text.replace(from, () => to) : text.replace(from, () => to);
    assert.notStrictEqual(text, before, `mutation "${c.name}" no longer matches runtime-paths.js`);
  }
  return text;
}

test('the unmutated copy passes (the controls start from green)', () => {
  const r = run(SRC);
  assert.strictEqual(r.status, 0, r.stdout.slice(-2000));
});

for (const c of CASES) {
  test(`negative control: ${c.name} turns "${c.red}" red`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtp-neg-'));
    const copy = path.join(dir, 'runtime-paths.js');
    fs.writeFileSync(copy, mutate(c));
    const r = run(copy);
    assert.notStrictEqual(r.status, 0, 'the mutated module must fail the unit tests');
    const out = r.stdout;
    const failed = out.split('\n').some((l) => l.startsWith('✖') && l.includes(c.red));
    assert.ok(failed, `expected "${c.red}" to be among the failures:\n${out.split('\n').filter((l) => l.startsWith('✖')).join('\n')}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
