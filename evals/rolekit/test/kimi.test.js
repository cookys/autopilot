'use strict';
// Second seat: kimi-code 2.3.0 variant kits, compile-kit kimi mapping, weak2 reporting and the formal preconditions gate.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { compile, validateKit, frontmatterError, MAX_ROLE_BYTES_KIMI } = require('../compile-kit.js');
const { scoreFormal } = require('../score-rolekit.js');
const { ROOT, ROLES, tmp, rm, draftCopy } = require('./helpers.js');

const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const kimi = (r) => path.join(ROOT, 'kimi/kits', r);
const kimiP = (r) => path.join(ROOT, 'kimi/placebo', r);

test('kimi kits: six cards within the separate 4096-byte cap, no plugin, the same JSON contract as the Claude card, a Method section for the five roles with a skill', () => {
  assert.strictEqual(MAX_ROLE_BYTES_KIMI, 4096);
  for (const r of ROLES) {
    for (const dir of [kimi(r), kimiP(r)]) {
      assert.deepStrictEqual(validateKit(dir, { maxRole: MAX_ROLE_BYTES_KIMI }).errors, [], dir);
      assert.ok(!fs.existsSync(path.join(dir, 'plugin')), `${dir} must have no plugin/`);
    }
    const card = rd(`kimi/kits/${r}/role.md`); const claude = rd(`kits/${r}/role.md`);
    assert.ok(Buffer.byteLength(card) <= 4096);
    assert.ok(card.includes(claude.slice(claude.indexOf('Output:'), claude.indexOf('Done when:')).trim()), `${r}: output contract carried over`);
    if (r === 'reviewer') assert.strictEqual(card, claude, 'reviewer has no skill: identical card');
    else { assert.match(card, /\n## Method \(condensed from/); assert.ok(Buffer.byteLength(card) > Buffer.byteLength(claude)); }
    assert.strictEqual(rd(`kimi/kits/${r}/tools`), rd(`kits/${r}/tools`));
  }
});

test('kimi placebo: card length within 5% of the kimi card, same tools, unrelated content', () => {
  for (const r of ROLES) {
    const a = Buffer.byteLength(rd(`kimi/kits/${r}/role.md`)); const b = Buffer.byteLength(rd(`kimi/placebo/${r}/role.md`));
    assert.ok(Math.abs(a - b) <= 0.05 * a, `${r} ${a} vs ${b}`);
    assert.strictEqual(rd(`kimi/placebo/${r}/tools`), rd(`kimi/kits/${r}/tools`));
    assert.doesNotMatch(rd(`kimi/placebo/${r}/role.md`), /\b(json|diff|repository|test|review|plan)\b/i);
  }
});

test('compile-kit kimi: --agent-file with tools in the agent file, KIMI_CODE_HOME, valid YAML frontmatter; empty tools and the unverified items are warnings', () => {
  const c = compile(kimi('debugger'), 'kimi', { configDir: '/x/kh' });
  assert.ok(c.ok); assert.deepStrictEqual(c.argv.slice(0, 2), ['-p', '--agent-file']); assert.ok(!c.argv.includes('--tools'));
  assert.strictEqual(c.env.KIMI_CODE_HOME, '/x/kh');
  assert.match(c.agent_file, /^---\nname: rk-debugger\ndescription: "[^"]+"\ntools: \[Read, Grep, Glob, Bash\]\n---\n# Role: debugger/);
  assert.strictEqual(frontmatterError(c.agent_file.replace('tools: [Read, Grep, Glob, Bash]\n', '')), null);
  const py = cp.spawnSync('python3', ['-I', '-c', 'import sys,yaml\nd=yaml.safe_load(sys.stdin.read().split("---\\n")[1])\nassert d["tools"]==["Read","Grep","Glob","Bash"] and d["name"]=="rk-debugger"'], { input: c.agent_file, encoding: 'utf8' });
  assert.strictEqual(py.status, 0, py.stderr);
  assert.ok(c.warnings.some((w) => /AGENTS\.md/.test(w)) && c.warnings.some((w) => /--session/.test(w)));
  assert.strictEqual(c.verified.model_follows_card, 'UNVERIFIED (needs a real-model check before the formal run)');
  const e = compile(kimi('reviewer'), 'kimi'); assert.match(e.agent_file, /tools: \[\]\n/); assert.ok(e.warnings.some((w) => /tools: \[\] \(no tools\)/.test(w)));
  const cli = cp.spawnSync('node', [path.join(ROOT, 'compile-kit.js'), '--kit', kimi('explorer'), '--runner', 'kimi'], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 0); assert.match(cli.stdout, /--agent-file/);
});

test('compile-kit kimi: negative controls - a Claude kit with a plugin is refused, a card over 4096 bytes is refused, a kimi card is not a valid Claude card', () => {
  const r1 = compile(path.join(ROOT, 'kits/debugger'), 'kimi'); assert.strictEqual(r1.ok, false); assert.match(r1.errors[0], /cannot read plugin skills/);
  const d = tmp();
  try {
    fs.cpSync(kimi('planner'), d, { recursive: true });
    fs.appendFileSync(path.join(d, 'role.md'), 'x'.repeat(2000));
    const r2 = compile(d, 'kimi'); assert.strictEqual(r2.ok, false); assert.match(r2.errors.join(), /max 4096/);
  } finally { rm(d); }
  const r3 = compile(kimi('planner'), 'claude'); assert.strictEqual(r3.ok, false); assert.match(r3.errors.join(), /max 2048/);
});

test('formal prereg: weak2 is kimi, reported apart, with a real-model precondition for both seats, a Haiku-rate placeholder cost, and flash recorded as unproven', () => {
  const f = JSON.parse(rd('prereg/formal.json'));
  assert.match(f.design.seats.weak2, /^kimi \(kimi-code 2\.3\.0\)/); assert.match(f.design.seats.weak2, /4096/);
  assert.match(f.verdict.rule, /weak2, kimi\) is computed with the same arithmetic but reported in a separate table \(weak2_report\) and is read by nothing in rules 1 to 8/);
  assert.match(f.verdict.rule, /Infra on weak2 is reported and never blocks the verdict/);
  assert.deepStrictEqual(f.preconditions.map((p) => p.id), ['real-check-weak1', 'real-check-weak2']);
  assert.match(f.preconditions[1].text, /kimi variant kit/); assert.match(f.preconditions_gate, /refuses to stamp/);
  assert.ok(f.freeze_files.includes('kimi') && f.freeze_files.includes('prereg/preconditions-formal.json'));
  assert.match(f.seats_not_used[0].seat, /flash/); assert.strictEqual(f.seats_not_used[0].status, 'unproven');
  assert.match(f.seats_not_used[0].reason, /cannot create a request/); assert.match(f.seats_not_used[0].reason, /allowlist cannot be discovered/);
  assert.strictEqual(JSON.parse(rd('prereg/pilot.json')).preconditions, undefined);
  const cm = JSON.parse(rd('cost-model.json')); assert.match(cm.rates_usd_per_cell.kimi.basis, /PLACEHOLDER, not measured/); assert.strictEqual(cm.quota.weak2, 'kimi-code subscription (own quota)');
  assert.match(rd('COST-TABLE-formal.md'), /weak2 \(kimi-code 2\.3\.0, its own quota; unit price NOT measured/);
});

// ---- weak2 can neither confirm nor veto
const T = Array.from({ length: 20 }, (_, i) => `t${i}`);
const prereg = { row: 'rolekit-formal', cost: { estimate_usd_high: 1 }, design: { roles: ['planner'], tasks_by_role: { planner: 20 }, arms: [{ id: 'A', seats: ['weak1', 'weak2'] }, { id: 'B', seats: ['weak1', 'weak2'] }, { id: 'C', seats: ['weak1', 'weak2'] }, { id: 'D', seats: ['strong'] }], reps: { A: { weak1: 1, weak2: 1 }, B: { weak1: 1, weak2: 1 }, C: { weak1: 1, weak2: 1 }, D: { strong: 1 } } },
  verdict: { params: { infra_arm_seat_max: 0.05, headroom_min: 0.15, gap_closed_min: 0.5, discordant_alpha: 0.10, harm_delta: -0.10, roles_pass_min: 1 } } };
const ones = (n) => Array.from({ length: 20 }, (_, i) => (i < n ? 1 : 0));
function rows(w1, w2, drop2 = false) {
  const out = [];
  const add = (arm, seat, arr) => T.forEach((task, i) => out.push({ role: 'planner', task, rep: 0, arm, seat, pass: arr[i], infra: false, parse_ok: true, kit_applied: true, cost_usd: 0.01 }));
  add('A', 'weak1', w1.A); add('B', 'weak1', w1.B); add('C', 'weak1', w1.C); add('D', 'strong', w1.D);
  if (!drop2) { add('A', 'weak2', w2.A); add('B', 'weak2', w2.B); add('C', 'weak2', w2.C); }
  return out;
}
test('score-rolekit: weak2 (kimi) results never change the verdict - winning, losing, harmful or missing weak2 cells give the same verdict; they appear in weak2_report', () => {
  const win = { A: ones(4), B: ones(8), C: ones(4), D: ones(12) };
  const lose = { A: ones(14), B: ones(2), C: ones(14), D: ones(20) };
  const base = scoreFormal(rows(win, win), prereg, { planner: T });
  assert.strictEqual(base.verdict, 'SHIP_CANDIDATE');
  for (const w2 of [lose, { A: ones(0), B: ones(0), C: ones(0), D: ones(0) }, win]) assert.strictEqual(scoreFormal(rows(win, w2), prereg, { planner: T }).verdict, 'SHIP_CANDIDATE');
  assert.strictEqual(scoreFormal(rows(win, win, true), prereg, { planner: T }).verdict, 'SHIP_CANDIDATE', 'all weak2 cells missing does not block');
  const bad = scoreFormal(rows(lose, win), prereg, { planner: T }); assert.strictEqual(bad.verdict, 'NOT_SHIP', 'a weak2 win cannot rescue a weak1 loss');
  const rep = scoreFormal(rows(win, { A: ones(8), B: ones(2), C: ones(8) }), prereg, { planner: T }).weak2_report;
  assert.match(rep.note, /not part of the verdict/); assert.strictEqual(rep.infra_or_missing, 0); assert.ok(rep.roles.planner.gap_closed < 0);
  assert.strictEqual(scoreFormal(rows(win, win, true), prereg, { planner: T }).weak2_report.infra_or_missing, 60);
});

// ---- the preconditions gate of the formal stamp
test('stamp-rolekit formal: refused without the real-model check evidence for both seats; stamped when met; the kimi kits and the evidence file are frozen', () => {
  const d = draftCopy();
  try {
    const run = (...a) => cp.spawnSync('node', [path.join(d, 'stamp-rolekit.js'), ...a], { encoding: 'utf8', cwd: d });
    const pf = path.join(d, 'prereg/preconditions-formal.json');
    let r = run('--row', 'formal', '--authorized-by', 'd-test'); assert.strictEqual(r.status, 2); assert.match(r.stderr, /preconditions file missing/);
    fs.writeFileSync(pf, JSON.stringify({ items: [{ id: 'real-check-weak1', met: true, evidence: 'docs/x.md' }] }));
    r = run('--row', 'formal', '--authorized-by', 'd-test'); assert.strictEqual(r.status, 2); assert.match(r.stderr, /precondition not met: real-check-weak2/);
    fs.writeFileSync(pf, JSON.stringify({ items: [{ id: 'real-check-weak1', met: true, evidence: 'docs/x.md' }, { id: 'real-check-weak2', met: false, evidence: 'docs/y.md' }] }));
    assert.strictEqual(run('--row', 'formal', '--authorized-by', 'd-test').status, 2);
    fs.writeFileSync(pf, JSON.stringify({ items: [{ id: 'real-check-weak1', met: true, evidence: 'docs/x.md' }, { id: 'real-check-weak2', met: true, evidence: '' }] }));
    assert.strictEqual(run('--row', 'formal', '--authorized-by', 'd-test').status, 2);
    assert.ok(!fs.existsSync(path.join(d, 'prereg/FROZEN.json')), 'refusals write nothing');
    fs.writeFileSync(pf, JSON.stringify({ items: [{ id: 'real-check-weak1', met: true, evidence: 'docs/x.md' }, { id: 'real-check-weak2', met: true, evidence: 'docs/y.md' }] }));
    r = run('--row', 'formal', '--authorized-by', 'd-test'); assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(run('--row', 'formal', '--check').status, 0);
    for (const rel of ['kimi/kits/planner/role.md', 'kimi/placebo/debugger/role.md', 'prereg/preconditions-formal.json']) {
      const f = path.join(d, rel); const keep = fs.readFileSync(f); fs.appendFileSync(f, ' ');
      const red = run('--row', 'formal', '--check'); assert.strictEqual(red.status, 2, rel); assert.ok(red.stderr.includes(rel), red.stderr);
      fs.writeFileSync(f, keep);
    }
  } finally { rm(d); }
  const d2 = draftCopy();
  try { // a kimi placebo of the wrong length blocks the pilot stamp too
    fs.writeFileSync(path.join(d2, 'kimi/placebo/planner/role.md'), 'short');
    const r = cp.spawnSync('node', [path.join(d2, 'stamp-rolekit.js'), '--row', 'pilot', '--authorized-by', 'd-test'], { encoding: 'utf8', cwd: d2 });
    assert.strictEqual(r.status, 2); assert.match(r.stderr, /kimi\/placebo\/planner\/role\.md is not within 5%/);
  } finally { rm(d2); }
});
