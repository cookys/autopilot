'use strict';

// Per-family seat statistics from hetero-review ledgers. Fixtures live under os.tmpdir().
// # RED at 278456ab0: node --test scripts/review-seat-report.test.js → fail 13, pass 1 (12c).
// Cases 1-10 and 12a/12b: Cannot find module './review-seat-report.js' (MODULE_NOT_FOUND).
// Case 11: CLI status 1 !== 0, same MODULE_NOT_FOUND for scripts/review-seat-report.js.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'review-seat-report.js');

function load() {
  delete require.cache[require.resolve('./review-seat-report.js')];
  return require('./review-seat-report.js');
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seat-report-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function seat(model, status = 'reviewed', verdict = 'SHIP-AS-IS') {
  return { runner: 'test', model, status, verdict };
}

function finding(id, severity, seatId, text) {
  return { id, severity, seat: seatId, text };
}

function disp(id, disposition) {
  return { id, disposition, rationale: 'r' };
}

function chainEntry(generation, status) {
  return { generation, status };
}

function snapshot(root) {
  const out = [];
  function walk(dir) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        out.push(`dir ${rel}`);
        walk(abs);
      } else {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
        out.push(`file ${rel} ${hash}`);
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out.join('\n');
}

function runCli(args, home) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      AUTOPILOT_SESSION_ID: undefined,
      CLAUDE_CODE_SESSION_ID: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertReportMatches(report, expected) {
  assert.ok(report && Array.isArray(report.groups), 'groups');
  assert.strictEqual(report.groups.length, expected.groups.length, 'group count');
  for (let i = 0; i < expected.groups.length; i++) {
    const got = report.groups[i];
    const exp = expected.groups[i];
    for (const key of Object.keys(exp)) {
      assert.deepStrictEqual(got[key], exp[key], `groups[${i}].${key}`);
    }
  }
  if (expected.totals) {
    for (const key of Object.keys(expected.totals)) {
      assert.deepStrictEqual(report.totals[key], expected.totals[key], `totals.${key}`);
    }
  }
  if (expected.scope) {
    for (const key of Object.keys(expected.scope)) {
      assert.strictEqual(report.scope[key], expected.scope[key], `scope.${key}`);
    }
  }
}

test('1 multi-family counts every column', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-alpha');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  const g = path.join(phase, 'g1');
  writeJson(path.join(g, 'findings.json'), {
    findings: [
      finding('a1', 'Critical', 's0', '[alpha-bug] crash\nmore'),
      finding('a2', 'Major', 's0', '[alpha-bug] related'),
      finding('b1', 'Minor', 's1', '[other-note] note'),
      finding('b2', 'Suggestion', 's1', 'no brackets here'),
    ],
  });
  writeJson(path.join(g, 'dispositions.json'), {
    findings: [disp('a1', 'verified'), disp('a2', 'refuted'), disp('b1', 'deferred'), disp('b2', 'verified')],
    resolutions: [{ id: 'a1', resolution: 'ignored-for-stats' }],
  });
  writeJson(path.join(g, 'seat-s0.json'), seat('claude-opus-4'));
  writeJson(path.join(g, 'seat-s1.json'), seat('gpt-5'));
  writeJson(path.join(g, 'seat-s2.json'), seat('grok-3', 'failed'));

  const report = buildReport([dir], {});
  assertReportMatches(report, {
    groups: [
      {
        family: 'anthropic',
        models: ['claude-opus-4'],
        findings: 2,
        critical: 1,
        major: 1,
        minor: 0,
        suggestion: 0,
        verified: 1,
        refuted: 1,
        deferred: 0,
        undisposed: 0,
        verified_pct: 50,
        refuted_pct: 50,
        deferred_pct: 0,
        verified_critical: 1,
        verified_major: 0,
        exclusive_verified: 1,
        phases: 1,
        generations: 1,
        seat_failures: 0,
      },
      {
        family: 'openai',
        models: ['gpt-5'],
        findings: 2,
        critical: 0,
        major: 0,
        minor: 1,
        suggestion: 1,
        verified: 1,
        refuted: 0,
        deferred: 1,
        undisposed: 0,
        verified_pct: 50,
        refuted_pct: 0,
        deferred_pct: 50,
        verified_critical: 0,
        verified_major: 0,
        exclusive_verified: 1,
        phases: 1,
        generations: 1,
        seat_failures: 0,
      },
      {
        family: 'xai',
        models: ['grok-3'],
        findings: 0,
        critical: 0,
        major: 0,
        minor: 0,
        suggestion: 0,
        verified: 0,
        refuted: 0,
        deferred: 0,
        undisposed: 0,
        verified_pct: 0,
        refuted_pct: 0,
        deferred_pct: 0,
        verified_critical: 0,
        verified_major: 0,
        exclusive_verified: 0,
        phases: 1,
        generations: 1,
        seat_failures: 1,
      },
    ],
    totals: {
      findings: 4,
      critical: 1,
      major: 1,
      minor: 1,
      suggestion: 1,
      verified: 2,
      refuted: 1,
      deferred: 1,
      undisposed: 0,
      verified_pct: 50,
      refuted_pct: 25,
      deferred_pct: 25,
      verified_critical: 1,
      verified_major: 0,
      exclusive_verified: 2,
      phases: 1,
      generations: 1,
      seat_failures: 1,
    },
    scope: {
      ledgers_read: 1,
      phases_read: 1,
      finalized_generations: 1,
      aborted_skipped: 0,
      pending_skipped: 0,
      corrupt_skipped: 0,
      aborted_skipped_findings: 0,
      pending_skipped_findings: 0,
      distinct_phases: 1,
      distinct_generations: 1,
    },
  });
});

test('2 shared verified slug is not exclusive; unique slug is', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-beta');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  const g = path.join(phase, 'g1');
  writeJson(path.join(g, 'findings.json'), {
    findings: [
      finding('c1', 'Major', 's0', '[same-slug] one'),
      finding('c2', 'Major', 's1', '[same-slug] two'),
      finding('c3', 'Critical', 's2', '[only-s2] three'),
    ],
  });
  writeJson(path.join(g, 'dispositions.json'), {
    findings: [disp('c1', 'verified'), disp('c2', 'verified'), disp('c3', 'verified')],
  });
  writeJson(path.join(g, 'seat-s0.json'), seat('claude-opus-4'));
  writeJson(path.join(g, 'seat-s1.json'), seat('gpt-5'));
  writeJson(path.join(g, 'seat-s2.json'), seat('grok-3'));
  const report = buildReport([dir], {});
  const by = Object.fromEntries(report.groups.map((row) => [row.family, row]));
  assert.strictEqual(by.anthropic.exclusive_verified, 0);
  assert.strictEqual(by.openai.exclusive_verified, 0);
  assert.strictEqual(by.xai.exclusive_verified, 1);
});

test('3 cross-gen merges only with --cross-gen', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-gamma');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized'), chainEntry(2, 'finalized')]);
  for (const [gen, seatId, model] of [[1, 's0', 'claude-opus-4'], [2, 's1', 'gpt-5']]) {
    const g = path.join(phase, `g${gen}`);
    writeJson(path.join(g, 'findings.json'), {
      findings: [finding(`d${gen}`, 'Major', seatId, '[dup-slug] again')],
    });
    writeJson(path.join(g, 'dispositions.json'), { findings: [disp(`d${gen}`, 'verified')] });
    writeJson(path.join(g, `seat-${seatId}.json`), seat(model));
  }
  const plain = buildReport([dir], {});
  const crossed = buildReport([dir], { crossGen: true });
  const sumEx = (report) => report.groups.reduce((n, row) => n + row.exclusive_verified, 0);
  assert.strictEqual(sumEx(plain), 2);
  assert.strictEqual(plain.key_mode, 'phase+generation+slug');
  assert.strictEqual(sumEx(crossed), 0);
  assert.strictEqual(crossed.key_mode, 'phase+slug');

  // Same seat id, different model per generation: cross-gen identity is seat+model.
  const sameSeat = tmp();
  const phase2 = path.join(sameSeat, 'review-gamma');
  writeJson(path.join(phase2, 'chain.json'), [chainEntry(1, 'finalized'), chainEntry(2, 'finalized')]);
  for (const [gen, model] of [[1, 'claude-fable-5-1'], [2, 'GLM-5.3']]) {
    const g = path.join(phase2, `g${gen}`);
    writeJson(path.join(g, 'findings.json'), {
      findings: [finding(`m${gen}`, 'Major', 's0', '[dup-slug] again')],
    });
    writeJson(path.join(g, 'dispositions.json'), { findings: [disp(`m${gen}`, 'verified')] });
    writeJson(path.join(g, `seat-s0.json`), seat(model));
  }
  const sameCrossed = buildReport([sameSeat], { crossGen: true });
  assertCrossGenSeatModel(sameCrossed);
  const idOnly = exclusiveBy(sameSeatItems(), (item) => item.seat);
  assert.throws(() => assertCrossGenSeatModel({
    totals: { exclusive_verified: idOnly },
    groups: [{ exclusive_verified: idOnly }],
  }));
});

function sameSeatItems() {
  return [
    { seat: 's0', model: 'claude-fable-5-1', verified: true },
    { seat: 's0', model: 'GLM-5.3', verified: true },
  ];
}

function exclusiveBy(items, seatOf) {
  const seats = new Map();
  for (const item of items) {
    if (!seats.has('k')) seats.set('k', new Set());
    seats.get('k').add(seatOf(item));
  }
  let n = 0;
  for (const item of items) {
    if (seats.get('k').size === 1) n += 1;
  }
  return n;
}

function assertCrossGenSeatModel(report) {
  const sum = report.groups.reduce((n, row) => n + row.exclusive_verified, 0);
  assert.strictEqual(sum, 0);
  assert.strictEqual(report.totals.exclusive_verified, 0);
}

test('4 same slug in different phases is never merged', () => {
  const { buildReport } = load();
  const dir = tmp();
  for (const [phaseName, model] of [['review-p1', 'claude-opus-4'], ['review-p2', 'gpt-5']]) {
    const phase = path.join(dir, phaseName);
    writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
    const g = path.join(phase, 'g1');
    writeJson(path.join(g, 'findings.json'), {
      findings: [finding(`${phaseName}-f`, 'Minor', 's0', '[shared] text')],
    });
    writeJson(path.join(g, 'dispositions.json'), { findings: [disp(`${phaseName}-f`, 'verified')] });
    writeJson(path.join(g, 'seat-s0.json'), seat(model));
  }
  const report = buildReport([dir], { crossGen: true });
  assert.strictEqual(report.totals.exclusive_verified, 2);
});

test('5 undisposed findings stay out of the percentage denominator', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-und');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  const g = path.join(phase, 'g1');
  writeJson(path.join(g, 'findings.json'), {
    findings: [
      finding('u1', 'Major', 's0', '[kept] yes'),
      finding('u2', 'Minor', 's0', '[loose] no entry'),
    ],
  });
  writeJson(path.join(g, 'dispositions.json'), { findings: [disp('u1', 'verified')] });
  writeJson(path.join(g, 'seat-s0.json'), seat('claude-opus-4'));
  const report = buildReport([dir], {});
  const row = report.groups[0];
  assert.strictEqual(row.verified, 1);
  assert.strictEqual(row.undisposed, 1);
  assert.strictEqual(row.verified_pct, 100);
  assert.strictEqual(row.refuted_pct, 0);
  assert.strictEqual(row.deferred_pct, 0);
});

test('6 aborted and pending generations are skipped and counted', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-skip');
  writeJson(path.join(phase, 'chain.json'), [
    chainEntry(1, 'finalized'),
    chainEntry(2, 'aborted'),
    chainEntry(3, 'pending'),
  ]);
  const g1 = path.join(phase, 'g1');
  writeJson(path.join(g1, 'findings.json'), {
    findings: [finding('k1', 'Suggestion', 's0', '[keep] only')],
  });
  writeJson(path.join(g1, 'dispositions.json'), { findings: [disp('k1', 'deferred')] });
  writeJson(path.join(g1, 'seat-s0.json'), seat('claude-opus-4'));
  const g2 = path.join(phase, 'g2');
  writeJson(path.join(g2, 'findings.json'), {
    findings: [finding('k2', 'Critical', 's0', '[drop] aborted')],
  });
  writeJson(path.join(g2, 'dispositions.json'), { findings: [disp('k2', 'verified')] });
  writeJson(path.join(g2, 'seat-s0.json'), seat('claude-opus-4'));
  const report = buildReport([dir], {});
  assert.strictEqual(report.totals.findings, 1);
  assert.strictEqual(report.totals.verified, 0);
  assert.strictEqual(report.scope.finalized_generations, 1);
  assert.strictEqual(report.scope.aborted_skipped, 1);
  assert.strictEqual(report.scope.pending_skipped, 1);
});

test('7 corrupt findings.json is skipped without throwing', () => {
  const { buildReport } = load();
  const dir = tmp();
  const bad = path.join(dir, 'review-bad');
  writeJson(path.join(bad, 'chain.json'), [chainEntry(1, 'finalized')]);
  fs.mkdirSync(path.join(bad, 'g1'), { recursive: true });
  fs.writeFileSync(path.join(bad, 'g1', 'findings.json'), '{ not json');
  const good = path.join(dir, 'review-good');
  writeJson(path.join(good, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(good, 'g1', 'findings.json'), {
    findings: [finding('ok', 'Minor', 's0', '[ok] fine')],
  });
  writeJson(path.join(good, 'g1', 'dispositions.json'), { findings: [disp('ok', 'verified')] });
  writeJson(path.join(good, 'g1', 'seat-s0.json'), seat('gpt-5'));
  const report = buildReport([dir], {});
  assert.strictEqual(report.totals.findings, 1);
  assert.strictEqual(report.scope.corrupt_skipped, 1);
  assert.strictEqual(report.scope.phases_read, 1);
  assert.strictEqual(report.scope.finalized_generations, 1);
});

test('8 model list, by-model rows, and unplaceable muse-spark', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-models');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized'), chainEntry(2, 'finalized')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('m1', 'Minor', 's1', '[m] a')],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('m1', 'verified')] });
  writeJson(path.join(phase, 'g1', 'seat-s1.json'), seat('GLM-5.2'));
  writeJson(path.join(phase, 'g2', 'findings.json'), {
    findings: [
      finding('m2', 'Minor', 's1', '[m2] b'),
      finding('m3', 'Suggestion', 's0', '[spark] c'),
    ],
  });
  writeJson(path.join(phase, 'g2', 'dispositions.json'), {
    findings: [disp('m2', 'refuted'), disp('m3', 'deferred')],
  });
  writeJson(path.join(phase, 'g2', 'seat-s1.json'), seat('GLM-5.3'));
  writeJson(path.join(phase, 'g2', 'seat-s0.json'), seat('opencode-go/muse-spark-1.3-contributor'));

  const grouped = buildReport([dir], {});
  const zhipu = grouped.groups.find((row) => row.family === 'zhipu');
  assert.ok(zhipu);
  assert.deepStrictEqual(zhipu.models, ['GLM-5.2', 'GLM-5.3']);
  assert.strictEqual(zhipu.findings, 2);
  const unknown = grouped.groups.find((row) => row.family === 'unknown');
  assert.ok(unknown);
  assert.deepStrictEqual(unknown.models, ['opencode-go/muse-spark-1.3-contributor']);

  const byModel = buildReport([dir], { byModel: true });
  assert.strictEqual(byModel.by_model, true);
  const names = byModel.groups.map((row) => row.models[0]).sort();
  assert.deepStrictEqual(names, ['GLM-5.2', 'GLM-5.3', 'opencode-go/muse-spark-1.3-contributor']);
  assert.strictEqual(byModel.groups.filter((row) => row.family === 'zhipu').length, 2);
});

test('9 multiple ledgers merge', () => {
  const { buildReport, formatText } = load();
  const a = tmp();
  const b = tmp();
  for (const dir of [a, b]) {
    const phase = path.join(dir, 'review-one');
    writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
    writeJson(path.join(phase, 'g1', 'findings.json'), {
      findings: [finding('f', 'Critical', 's0', '[x] t')],
    });
    writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('f', 'verified')] });
    writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('claude-opus-4'));
  }
  const report = buildReport([a, b], {});
  assert.strictEqual(report.totals.findings, 2);
  assert.strictEqual(report.totals.verified_critical, 2);
  assert.strictEqual(report.scope.ledgers_read, 2);
  assert.strictEqual(report.scope.phases_read, 2);
  assert.strictEqual(report.totals.phases, 2);
  assert.strictEqual(report.totals.generations, 2);
  assert.strictEqual(report.groups[0].phases, 2);
  assert.strictEqual(report.groups[0].generations, 2);
  assert.strictEqual(report.scope.distinct_phases, 2);
  assert.strictEqual(report.scope.distinct_generations, 2);
  const text = formatText(report);
  const cells = totalCells(text);
  assert.strictEqual(cells[cells.length - 3], '2');
  assert.strictEqual(cells[cells.length - 2], '2');
  const home = tmp();
  const cli = runCli(['--ledger', a, '--ledger', b, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  assert.strictEqual(parsed.totals.phases, 2);
  assert.strictEqual(parsed.totals.generations, 2);
  assert.strictEqual(parsed.groups[0].phases, 2);
  assert.strictEqual(parsed.groups[0].generations, 2);
});

// # RED at 6d258e575: test 9 phases/generations are 1 (ledger omitted from keys);
// 9b exclusive is 0; test 3 same-seat cross-gen exclusive is 2; dangling symlink throws
// ENOENT from statSync; status "weird" is silent and unknown_status_skipped is absent.
test('9b two ledgers with the same phase, generation, and slug stay exclusive', () => {
  const { buildReport } = load();
  const a = tmp();
  const b = tmp();
  const specs = [[a, 's0', 'claude-opus-4'], [b, 's1', 'gpt-5']];
  for (const [dir, seatId, model] of specs) {
    const phase = path.join(dir, 'review-one');
    writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
    writeJson(path.join(phase, 'g1', 'findings.json'), {
      findings: [finding('f', 'Major', seatId, '[same-slug] t')],
    });
    writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('f', 'verified')] });
    writeJson(path.join(phase, 'g1', `seat-${seatId}.json`), seat(model));
  }
  const report = buildReport([a, b], {});
  assertLedgerQualifiedExclusive(report);
  const oldKeyCount = exclusiveBy(
    [{ seat: 's0', verified: true }, { seat: 's1', verified: true }],
    (item) => item.seat,
  );
  assert.throws(() => assertLedgerQualifiedExclusive({
    totals: { exclusive_verified: oldKeyCount, phases: 1, generations: 1 },
    groups: [{ exclusive_verified: oldKeyCount }],
  }));
});

function assertLedgerQualifiedExclusive(report) {
  assert.strictEqual(report.totals.exclusive_verified, 2);
  assert.strictEqual(report.totals.phases, 2);
  assert.strictEqual(report.totals.generations, 2);
}

test('10 json output matches buildReport and usage exits 2', () => {
  const { buildReport } = load();
  const dir = tmp();
  const home = tmp();
  const phase = path.join(dir, 'review-json');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('j', 'Major', 's0', '[j] t')],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('j', 'verified')] });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('gpt-5'));
  const cli = runCli(['--ledger', dir, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  const direct = buildReport([dir], {});
  assert.deepStrictEqual(parsed.totals, direct.totals);
  assert.strictEqual(parsed.schema_version, 1);
  assert.strictEqual(parsed.by_model, false);
  const missing = runCli([], home);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /Usage/);
  const unknown = runCli(['--ledger', dir, '--nope'], home);
  assert.strictEqual(unknown.status, 2);
  const absent = runCli(['--ledger', path.join(dir, 'no-such-ledger')], home);
  assert.strictEqual(absent.status, 2);
});

test('11 cli run does not change the fixture tree', () => {
  const dir = tmp();
  const home = tmp();
  const phase = path.join(dir, 'review-ro');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('r', 'Minor', 's0', '[r] t')],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('r', 'refuted')] });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('claude-opus-4'));
  const before = snapshot(dir);
  const cli = runCli(['--ledger', dir], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(snapshot(dir), before);
  assert.match(cli.stdout, /Heuristic: exclusive verified matches findings by slug, and slugs are named by the reviewers themselves\./);
  assert.match(cli.stdout, /phase\+generation\+slug/);
});

test('12a mutating verified to refuted changes the counts', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-mut');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  const g = path.join(phase, 'g1');
  writeJson(path.join(g, 'findings.json'), {
    findings: [finding('z', 'Major', 's0', '[z] t')],
  });
  writeJson(path.join(g, 'dispositions.json'), { findings: [disp('z', 'verified')] });
  writeJson(path.join(g, 'seat-s0.json'), seat('claude-opus-4'));
  const before = buildReport([dir], {});
  writeJson(path.join(g, 'dispositions.json'), { findings: [disp('z', 'refuted')] });
  const after = buildReport([dir], {});
  assert.notStrictEqual(before.totals.verified, after.totals.verified);
  assert.strictEqual(before.totals.verified, 1);
  assert.strictEqual(after.totals.verified, 0);
  assert.strictEqual(after.totals.refuted, 1);
});

test('12b two seats with the same slug have exclusive 0', () => {
  const { buildReport } = load();
  const dir = tmp();
  const phase = path.join(dir, 'review-ex');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  const g = path.join(phase, 'g1');
  writeJson(path.join(g, 'findings.json'), {
    findings: [
      finding('e1', 'Critical', 's0', '[twin] a'),
      finding('e2', 'Critical', 's1', '[twin] b'),
    ],
  });
  writeJson(path.join(g, 'dispositions.json'), {
    findings: [disp('e1', 'verified'), disp('e2', 'verified')],
  });
  writeJson(path.join(g, 'seat-s0.json'), seat('claude-opus-4'));
  writeJson(path.join(g, 'seat-s1.json'), seat('claude-sonnet-4'));
  const report = buildReport([dir], {});
  assert.strictEqual(report.groups.length, 1);
  assert.strictEqual(report.groups[0].family, 'anthropic');
  assert.strictEqual(report.groups[0].exclusive_verified, 0);
});

test('12c assertReportMatches rejects an all-zero stub', () => {
  const stub = {
    groups: [{
      family: 'anthropic',
      models: ['claude-opus-4'],
      findings: 0,
      critical: 0,
      major: 0,
      minor: 0,
      suggestion: 0,
      verified: 0,
      refuted: 0,
      deferred: 0,
      undisposed: 0,
      verified_pct: 0,
      refuted_pct: 0,
      deferred_pct: 0,
      verified_critical: 0,
      verified_major: 0,
      exclusive_verified: 0,
      phases: 0,
      generations: 0,
      seat_failures: 0,
    }],
    totals: { findings: 0 },
  };
  assert.throws(() => assertReportMatches(stub, {
    groups: [{ family: 'anthropic', findings: 2, verified: 1 }],
    totals: { findings: 4 },
  }));
});

// Distinct TOTAL phases/gens are the union across families, so they are smaller
// than the sum of the per-group Phases and Gens columns.
function assertDistinctPhaseGens(report) {
  assert.ok(report && report.totals && Array.isArray(report.groups), 'report');
  const sumPhases = report.groups.reduce((sum, row) => sum + row.phases, 0);
  const sumGens = report.groups.reduce((sum, row) => sum + row.generations, 0);
  assert.ok(sumPhases > report.totals.phases, `phases ${report.totals.phases} not below group sum ${sumPhases}`);
  assert.ok(sumGens > report.totals.generations, `gens ${report.totals.generations} not below group sum ${sumGens}`);
  assert.strictEqual(report.totals.phases, report.scope.distinct_phases);
  assert.strictEqual(report.totals.generations, report.scope.distinct_generations);
}

function totalCells(text) {
  const line = text.split('\n').find((row) => row.startsWith('TOTAL'));
  assert.ok(line, 'TOTAL row');
  return line.trim().split(/\s{2,}/);
}

// # RED at 10e110bb8: 13a totals.phases 2 === group sum (distinct_phases undefined);
// 13b scope lacks pending_skipped_findings and corrupt_phases; footer has no finding counts.
test('13a one phase reviewed by two families has distinct TOTAL phases and gens', () => {
  const { buildReport, formatText } = load();
  const dir = tmp();
  const home = tmp();
  const phase = path.join(dir, 'review-shared');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [
      finding('s1', 'Major', 's0', '[shared] one'),
      finding('s2', 'Minor', 's1', '[shared] two'),
    ],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), {
    findings: [disp('s1', 'verified'), disp('s2', 'refuted')],
  });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('claude-opus-4'));
  writeJson(path.join(phase, 'g1', 'seat-s1.json'), seat('gpt-5'));

  const report = buildReport([dir], {});
  assert.strictEqual(report.groups.length, 2);
  assert.strictEqual(report.groups[0].phases + report.groups[1].phases, 2);
  assert.strictEqual(report.groups[0].generations + report.groups[1].generations, 2);
  assert.strictEqual(report.totals.phases, 1);
  assert.strictEqual(report.totals.generations, 1);
  assertDistinctPhaseGens(report);

  const text = formatText(report);
  const cells = totalCells(text);
  assert.strictEqual(cells[cells.length - 3], '1');
  assert.strictEqual(cells[cells.length - 2], '1');

  const cli = runCli(['--ledger', dir, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  assert.strictEqual(parsed.totals.phases, 1);
  assert.strictEqual(parsed.totals.generations, 1);
  assert.strictEqual(parsed.scope.distinct_phases, 1);
  assert.strictEqual(parsed.scope.distinct_generations, 1);
  assertDistinctPhaseGens(parsed);

  const summed = {
    ...report,
    totals: {
      ...report.totals,
      phases: report.groups.reduce((sum, row) => sum + row.phases, 0),
      generations: report.groups.reduce((sum, row) => sum + row.generations, 0),
    },
  };
  assert.throws(() => assertDistinctPhaseGens(summed));
});

test('13b skipped finding counts and corrupt phase names', () => {
  const { buildReport, formatText } = load();
  const dir = tmp();
  const home = tmp();
  const phase = path.join(dir, 'review-mixed');
  writeJson(path.join(phase, 'chain.json'), [
    chainEntry(1, 'finalized'),
    chainEntry(2, 'pending'),
    chainEntry(3, 'aborted'),
  ]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('ok', 'Minor', 's0', '[ok] kept')],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('ok', 'verified')] });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('claude-opus-4'));
  writeJson(path.join(phase, 'g2', 'findings.json'), {
    findings: [
      finding('p1', 'Major', 's0', '[pend] a'),
      finding('p2', 'Major', 's0', '[pend] b'),
    ],
  });
  writeJson(path.join(phase, 'g3', 'findings.json'), {
    findings: [
      finding('a1', 'Critical', 's0', '[ab] a'),
      finding('a2', 'Critical', 's0', '[ab] b'),
      finding('a3', 'Minor', 's0', '[ab] c'),
    ],
  });
  const corruptName = 'review-bl0044-g1-aborted-allowlist';
  fs.mkdirSync(path.join(dir, corruptName), { recursive: true });
  fs.writeFileSync(path.join(dir, corruptName, 'chain.json'), '{ not json');

  const report = buildReport([dir], {});
  assert.strictEqual(report.scope.pending_skipped, 1);
  assert.strictEqual(report.scope.pending_skipped_findings, 2);
  assert.strictEqual(report.scope.aborted_skipped, 1);
  assert.strictEqual(report.scope.aborted_skipped_findings, 3);
  assert.strictEqual(report.scope.corrupt_skipped, 1);
  assert.deepStrictEqual(report.scope.corrupt_phases, [corruptName]);
  assert.strictEqual(report.scope.ledgers_read, 1);
  assert.strictEqual(report.scope.phases_read, 1);

  const text = formatText(report);
  assert.match(text, /pending skipped 1 \(2 findings\)/);
  assert.match(text, /aborted skipped 1 \(3 findings\)/);
  assert.match(text, /corrupt skipped 1 \(review-bl0044-g1-aborted-allowlist\)/);

  const cli = runCli(['--ledger', dir, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  assert.strictEqual(parsed.scope.pending_skipped_findings, 2);
  assert.strictEqual(parsed.scope.aborted_skipped_findings, 3);
  assert.deepStrictEqual(parsed.scope.corrupt_phases, [corruptName]);

  const onlyGood = tmp();
  const good = path.join(onlyGood, 'review-clean');
  writeJson(path.join(good, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(good, 'g1', 'findings.json'), {
    findings: [finding('c', 'Minor', 's0', '[c] t')],
  });
  writeJson(path.join(good, 'g1', 'seat-s0.json'), seat('gpt-5'));
  const zero = formatText(buildReport([onlyGood], {}));
  assert.match(zero, /pending skipped 0 \(0 findings\)/);
  assert.match(zero, /aborted skipped 0 \(0 findings\)/);
  assert.match(zero, /corrupt skipped 0/);
  assert.doesNotMatch(zero, /corrupt skipped 0 \(/);
  assert.match(zero, /unknown-status skipped 0/);
  assert.strictEqual(buildReport([onlyGood], {}).scope.unknown_status_skipped, 0);
});

test('14 dangling review-broken symlink is a corrupt phase', () => {
  const { buildReport, formatText } = load();
  const dir = tmp();
  const home = tmp();
  const good = path.join(dir, 'review-good');
  writeJson(path.join(good, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(good, 'g1', 'findings.json'), {
    findings: [finding('ok', 'Minor', 's0', '[ok] fine')],
  });
  writeJson(path.join(good, 'g1', 'dispositions.json'), { findings: [disp('ok', 'verified')] });
  writeJson(path.join(good, 'g1', 'seat-s0.json'), seat('gpt-5'));
  fs.symlinkSync(path.join(dir, 'no-such-phase-target'), path.join(dir, 'review-broken'));

  const report = buildReport([dir], {});
  assertBrokenSymlinkCounted(report, formatText(report));
  const cli = runCli(['--ledger', dir, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  assertBrokenSymlinkCounted(parsed, formatText(parsed));
  assert.strictEqual(parsed.totals.findings, 1);
  assert.strictEqual(parsed.scope.phases_read, 1);

  const without = {
    ...report,
    scope: { ...report.scope, corrupt_phases: [], corrupt_skipped: 0 },
  };
  assert.throws(() => assertBrokenSymlinkCounted(without, formatText(without)));
});

function assertBrokenSymlinkCounted(report, text) {
  assert.ok(report.scope.corrupt_phases.includes('review-broken'), 'corrupt_phases');
  assert.ok(report.scope.corrupt_skipped >= 1);
  assert.match(text, /corrupt skipped \d+ \(.*review-broken.*\)/);
}

test('15 unknown chain status is skipped and counted', () => {
  const { buildReport, formatText } = load();
  const dir = tmp();
  const home = tmp();
  const phase = path.join(dir, 'review-weird');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'weird')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('w', 'Critical', 's0', '[w] hidden')],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('w', 'verified')] });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('claude-opus-4'));

  const report = buildReport([dir], {});
  assertUnknownStatus(report, formatText(report));
  const cli = runCli(['--ledger', dir, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const parsed = JSON.parse(cli.stdout);
  assertUnknownStatus(parsed, formatText(parsed));
  assert.strictEqual(parsed.totals.findings, 0);
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.scope, 'ledgers_read'));
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.scope, 'unknown_status_skipped'));

  const zeroed = { ...report, scope: { ...report.scope, unknown_status_skipped: 0 } };
  assert.throws(() => assertUnknownStatus(zeroed, formatText(zeroed)));
});

function assertUnknownStatus(report, text) {
  assert.strictEqual(report.scope.unknown_status_skipped, 1);
  assert.match(text, /unknown-status skipped 1/);
  assert.strictEqual(report.totals.findings, 0);
}

// # RED at 1295ec2fa: node --test --test-name-pattern '1[6-9]|2[01]' scripts/review-seat-report.test.js → fail 5, pass 1.
// 16, 17, 19, 20, 21: status 2 !== 0, stderr is the old Usage line (--archive is an unknown flag).
// 18 passed on the unmodified base because an unknown flag already exits 2.

const ARCHIVE_CLI = path.join(__dirname, 'review-ledger-archive.js');

function cleanEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, ...extra };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

function writeSeatLedger(dir, text) {
  const phase = path.join(dir, 'review-alpha');
  writeJson(path.join(phase, 'chain.json'), [chainEntry(1, 'finalized')]);
  writeJson(path.join(phase, 'g1', 'findings.json'), {
    findings: [finding('a1', 'Major', 's0', text)],
  });
  writeJson(path.join(phase, 'g1', 'dispositions.json'), { findings: [disp('a1', 'verified')] });
  writeJson(path.join(phase, 'g1', 'seat-s0.json'), seat('gpt-5'));
}

function importLayoutA(ledgerDir, archiveRoot, home) {
  const result = spawnSync(process.execPath, [ARCHIVE_CLI, 'import', '--ledger', ledgerDir], {
    encoding: 'utf8',
    env: cleanEnv(home, { AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR: archiveRoot }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const dest = result.stdout.trim().split('\n').pop();
  assert.ok(fs.existsSync(path.join(dest, 'archive.json')), 'import wrote archive.json');
  return dest;
}

function totalsOf(args, home) {
  const cli = runCli(args, home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  return { report, text: load().formatText(report) };
}

test('16 two archive paths, layout A plus legacy flat, count once', () => {
  const home = tmp();
  const source = tmp();
  writeSeatLedger(source, '[once] same bytes');
  const legacyRoot = tmp();
  fs.cpSync(source, path.join(legacyRoot, 'legacy-flat'), { recursive: true });
  const layoutRoot = tmp();
  importLayoutA(source, layoutRoot, home);
  const single = totalsOf(['--ledger', source, '--json'], home);
  const both = totalsOf(['--archive', legacyRoot, '--archive', layoutRoot, '--json'], home);
  assert.strictEqual(both.report.totals.findings, single.report.totals.findings);
  assert.strictEqual(both.report.totals.verified, single.report.totals.verified);
  assert.strictEqual(both.report.totals.exclusive_verified, single.report.totals.exclusive_verified);
  assert.strictEqual(both.report.scope.ledgers_read, 1);
  assert.strictEqual(both.report.scope.archive_ledgers_read, 1);
  assert.strictEqual(both.report.scope.duplicates_skipped, 1);
  assert.match(both.text, /archive ledgers read 1/);
  assert.match(both.text, /duplicates skipped 1/);
});

test('17 legacy flat and layout A in one root with different data are both found', () => {
  const home = tmp();
  const root = tmp();
  const sourceA = tmp();
  writeSeatLedger(sourceA, '[layout] one');
  importLayoutA(sourceA, root, home);
  const flat = path.join(root, 'legacy-other');
  writeSeatLedger(flat, '[flat] two');
  const { report } = totalsOf(['--archive', root, '--json'], home);
  assert.strictEqual(report.totals.findings, 2);
  assert.strictEqual(report.scope.ledgers_read, 2);
  assert.strictEqual(report.scope.archive_ledgers_read, 2);
  assert.strictEqual(report.scope.duplicates_skipped, 0);
});

test('18 nonexistent archive root exits 2', () => {
  const home = tmp();
  const missing = path.join(os.tmpdir(), `seat-report-missing-${process.pid}-no-such`);
  const cli = runCli(['--archive', missing], home);
  assert.strictEqual(cli.status, 2);
  assert.match(cli.stderr, /Usage:/);
});

test('19 --ledger plus --archive of the same data counts once', () => {
  const home = tmp();
  const source = tmp();
  writeSeatLedger(source, '[both] same');
  const archiveRoot = tmp();
  importLayoutA(source, archiveRoot, home);
  const single = totalsOf(['--ledger', source, '--json'], home);
  const both = totalsOf(['--ledger', source, '--archive', archiveRoot, '--json'], home);
  assert.strictEqual(both.report.totals.findings, single.report.totals.findings);
  assert.strictEqual(both.report.scope.ledgers_read, 1);
  assert.strictEqual(both.report.scope.duplicates_skipped, 1);
});

test('20 a tar month is listed as skipped', () => {
  const home = tmp();
  const root = tmp();
  const source = tmp();
  writeSeatLedger(source, '[tar] live');
  fs.cpSync(source, path.join(root, 'legacy-flat'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026-10.tar.gz'), '');
  const { report, text } = totalsOf(['--archive', root, '--json'], home);
  assert.strictEqual(report.totals.findings, 1);
  assert.ok(Array.isArray(report.scope.tar_months_skipped));
  assert.ok(report.scope.tar_months_skipped.some((row) => row.name === '2026-10.tar.gz' && /P3/.test(row.reason)));
  assert.match(text, /2026-10\.tar\.gz/);
  assert.match(text, /tar months need P3/);
});

test('21 negative control: removing dedupe doubles the two-path totals', () => {
  const home = tmp();
  const source = tmp();
  writeSeatLedger(source, '[dedupe] matters');
  const rootA = tmp();
  const rootB = tmp();
  fs.cpSync(source, path.join(rootA, 'copy-a'), { recursive: true });
  fs.cpSync(source, path.join(rootB, 'copy-b'), { recursive: true });
  const honest = totalsOf(['--archive', rootA, '--archive', rootB, '--json'], home);
  assert.strictEqual(honest.report.totals.findings, 1, 'dedupe keeps one copy');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const call = 'dedupeLedgers(candidates); // dedupe-call';
  assert.ok(src.includes(call), 'dedupe call is present');
  const mutated = src
    .replace(call, '{ kept: candidates, duplicates: 0 };')
    .replace("require('./lib/stage-write')", `require(${JSON.stringify(path.join(__dirname, 'lib/stage-write'))})`);
  const copy = path.join(tmp(), 'review-seat-report-no-dedupe.js');
  fs.writeFileSync(copy, mutated);
  const doubled = spawnSync(process.execPath, [copy, '--archive', rootA, '--archive', rootB, '--json'], {
    encoding: 'utf8',
    env: cleanEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(doubled.status, 0, doubled.stderr);
  const report = JSON.parse(doubled.stdout);
  assert.strictEqual(report.totals.findings, 2);
  assert.notStrictEqual(report.totals.findings, honest.report.totals.findings);
});

function writePhase(ledgerDir, phaseName, spec) {
  const generation = spec.generation == null ? 1 : spec.generation;
  const status = spec.status || 'finalized';
  const findingId = spec.findingId || 'f1';
  const phase = path.join(ledgerDir, phaseName);
  writeJson(path.join(phase, 'chain.json'), [chainEntry(generation, status)]);
  writeJson(path.join(phase, `g${generation}`, 'findings.json'), {
    findings: [finding(findingId, spec.severity || 'Major', 's0', spec.text)],
  });
  writeJson(path.join(phase, `g${generation}`, 'dispositions.json'), {
    findings: [disp(findingId, 'verified')],
  });
  writeJson(path.join(phase, `g${generation}`, 'seat-s0.json'), seat('gpt-5', spec.seatStatus || 'failed'));
}

function writeNamedPhases(ledgerDir, names) {
  for (const name of names) {
    writePhase(ledgerDir, `review-${name}`, {
      text: `[${name}] shared bytes`,
      findingId: `id-${name}`,
    });
  }
}

// # RED at d7fdf66ac: node --test --test-name-pattern '2[2-5]' scripts/review-seat-report.test.js → fail 4, pass 0.
// 22: archive totals findings 5 !== Y-only 3 (flat subset counted in full). 23: duplicate_generations_skipped undefined !== 0.
// 24: symlink to a ledger outside the root was read, findings 2 !== 1. 25: duplicate_generations_skipped undefined !== 0.

test('22 subset flat ledger does not double-count generations already in layout A', () => {
  const home = tmp();
  const root = tmp();
  const sourceX = tmp();
  const sourceY = tmp();
  writeNamedPhases(sourceX, ['a', 'b']);
  writeNamedPhases(sourceY, ['a', 'b', 'c']);
  const flat = path.join(root, 'old-flat');
  fs.cpSync(sourceX, flat, { recursive: true });
  const imported = importLayoutA(sourceY, root, home);
  const yOnly = totalsOf(['--ledger', imported, '--json'], home);
  const archived = totalsOf(['--archive', root, '--json'], home);
  assert.deepStrictEqual(archived.report.totals, yOnly.report.totals);
  assert.strictEqual(archived.report.scope.duplicate_generations_skipped, 2);
  assert.match(archived.text, /duplicates skipped \d+, duplicate generations skipped 2/);
  const crossY = totalsOf(['--ledger', imported, '--cross-gen', '--json'], home);
  const crossBoth = totalsOf(['--archive', root, '--cross-gen', '--json'], home);
  assert.deepStrictEqual(crossBoth.report.totals, crossY.report.totals);
  // Negative control: buildReport with dedupeGenerations false counts every generation in X and Y.
  // That total is larger than Y alone. If generation de-duplication is removed, the --archive
  // totals rise to this no-dedupe total and the equality with Y-only goes red.
  const inflated = load().buildReport([flat, imported], { dedupeGenerations: false });
  assert.ok(inflated.totals.findings > yOnly.report.totals.findings);
  assert.ok(inflated.totals.seat_failures > yOnly.report.totals.seat_failures);
  assert.notDeepStrictEqual(archived.report.totals, inflated.totals);
});

test('23 a pending generation does not block the same finalized bytes', () => {
  const home = tmp();
  const x = tmp();
  const y = tmp();
  writePhase(x, 'review-a', { text: '[a] only x', findingId: 'a', status: 'finalized' });
  writePhase(x, 'review-b', { text: '[b] same bytes', findingId: 'b', status: 'pending' });
  writePhase(y, 'review-b', { text: '[b] same bytes', findingId: 'b', status: 'finalized' });
  const { buildReport, formatText } = load();
  const counted = buildReport([x, y], { dedupeGenerations: true });
  const yOnly = buildReport([y], { dedupeGenerations: true });
  assert.strictEqual(counted.totals.findings, 1 + yOnly.totals.findings);
  assert.strictEqual(counted.totals.seat_failures, 1 + yOnly.totals.seat_failures);
  assert.strictEqual(counted.scope.duplicate_generations_skipped, 0);
  assert.strictEqual(counted.scope.pending_skipped, 1);
  assert.match(formatText(counted), /duplicate generations skipped 0/);
  const cli = runCli(['--ledger', y, '--json'], home);
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(JSON.parse(cli.stdout).totals.findings, yOnly.totals.findings);
  // Negative control: recordUncountedGenerationKeys puts the pending findings hash into the seen
  // set before Y is counted. Y's finalized generation is then skipped, so findings fall below the
  // counted total. If pending keys are inserted for real, this gap disappears and the assertion
  // that Y was counted goes red.
  const poisoned = buildReport([x, y], { dedupeGenerations: true, recordUncountedGenerationKeys: true });
  assert.ok(poisoned.totals.findings < counted.totals.findings);
  assert.strictEqual(poisoned.scope.duplicate_generations_skipped, 1);
});

test('24 archive symlink outside the root is not read and a parent loop terminates', () => {
  const home = tmp();
  const root = tmp();
  const inside = tmp();
  writeSeatLedger(inside, '[inside] counted');
  importLayoutA(inside, root, home);
  const outside = tmp();
  writeSeatLedger(outside, '[outside] hidden');
  fs.symlinkSync(outside, path.join(root, 'escape'));
  fs.symlinkSync(root, path.join(root, 'loop-up'));
  const { report, text } = totalsOf(['--archive', root, '--json'], home);
  assert.strictEqual(report.totals.findings, 1);
  assert.strictEqual(report.scope.archive_ledgers_read, 1);
  assert.strictEqual(report.scope.ledgers_read, 1);
  assert.doesNotMatch(text, /outside/);
  const alone = totalsOf(['--ledger', outside, '--json'], home);
  assert.strictEqual(alone.report.totals.findings, 1);
});

test('25 --ledger only keeps duplicate_generations_skipped at 0', () => {
  const home = tmp();
  const a = tmp();
  const b = tmp();
  writeSeatLedger(a, '[ledger] twice');
  fs.cpSync(a, b, { recursive: true });
  const { report, text } = totalsOf(['--ledger', a, '--ledger', b, '--json'], home);
  assert.strictEqual(report.totals.findings, 2);
  assert.strictEqual(report.scope.duplicate_generations_skipped, 0);
  assert.strictEqual(report.scope.duplicates_skipped, 0);
  assert.match(text, /duplicate generations skipped 0/);
});
