#!/usr/bin/env bash
# BL-0146 D1: src/engine/review-increment.js (eligibility + changed/carried/re-check sets).
# Every guard has a negative control: the module is copied to a temp dir, ONE check is mutated out,
# and the named check must go red (neg_<name>=true means it did). The real module is never edited.
# Set NEG_CONTROL=<name> to run the full assertion list against that single mutated copy (expect red).
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const SRC = path.join(root, 'src', 'engine', 'review-increment.js');
const real = require(SRC);

const gitIn = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', ...a], { encoding: 'utf8' }).trim();
function commit(repo, writes, msg) {
  for (const [p, c] of Object.entries(writes)) {
    const f = path.join(repo, p);
    if (c === null) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (c && c.symlink) { fs.rmSync(f, { force: true }); fs.symlinkSync(c.symlink, f); } else fs.writeFileSync(f, c);
  }
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '--allow-empty', '-m', msg);
  return gitIn(repo, 'rev-parse', 'HEAD');
}
const fn = (n, extra = '') => `function feat${n}Fn() { return ${Number(n)}; }\nmodule.exports = { feat${n}Fn };\n${extra}`;
const BASE_FILES = {
  'package.json': '{"name":"x"}\n',
  'README.md': 'readme text\n',
  'scripts/check.js': 'process.exit(0);\n',
  'src/alphamod.js': 'function alphaFn(x) { return x; }\nmodule.exports = { alphaFn };\n',
  'src/usesalpha.js': "const { alphaFn } = require('./alphamod');\nfunction useAlpha() { return alphaFn(1); }\nmodule.exports = { useAlpha };\n",
  'src/calleemod.js': 'function calleeFn(x) { return x; }\nmodule.exports = { calleeFn };\n',
  'src/feat01.js': fn('01'), 'src/feat02.js': fn('02'), 'src/feat03.js': fn('03'),
  'src/feat04.js': fn('04'), 'src/feat05.js': fn('05'),
  'assets/b.bin': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(5000, 7)]),
  'src/link.js': { symlink: 'alphamod.js' },
  'src/u01.js': '// filler one\n', 'src/u02.js': '// filler two\n',
};
const GNEW = Array.from({ length: 12 }, (_, i) => `// line ${i} of the renamed file body\n`).join('');

function fixture(name, { h0Extra = {}, h1 }) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const B = commit(repo, BASE_FILES, 'base');
  const H0 = commit(repo, { 'src/feat01.js': fn('01', '// r0\n'), 'src/feat02.js': fn('02', '// r0\n'), ...h0Extra }, 'reviewed');
  const H1 = commit(repo, h1, 'fix');
  return { repo, B, H0, H1 };
}
const F = {
  base: fixture('base', { h1: { 'src/feat03.js': fn('03', '// r1\n') } }),
  fwd: fixture('fwd', { h1: { 'src/feat05.js': fn('05', "const { calleeFn } = require('./calleemod');\ncalleeFn(1, 2);\n") } }),
  resign: fixture('resign', { h1: { 'src/alphamod.js': 'function alphaFn(x, y) { return x + y; }\nmodule.exports = { alphaFn };\n' } }),
  pathref: fixture('pathref', { h1: { 'src/alphamod.js': 'function alphaFn(x) { return x; }\nmodule.exports = { alphaFn };\n// touched\n' } }),
  renamed: fixture('renamed', { h0Extra: { 'src/gnew.js': GNEW }, h1: { 'src/gnew.js': null, 'src/gmoved.js': GNEW } }),
  deleted: fixture('deleted', { h0Extra: { 'src/gnew.js': GNEW }, h1: { 'src/gnew.js': null } }),
  pkg: fixture('pkg', { h1: { 'package.json': '{"name":"y"}\n' } }),
  bin: fixture('bin', { h0Extra: { 'assets/b.bin': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(5000, 8)]) }, h1: { 'assets/b.bin': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(5000, 9)]) } }),
  del: fixture('del', { h1: { 'src/feat04.js': null } }),
  verify: fixture('verify', { h1: { 'scripts/check.js': 'process.exit(1);\n' } }),
};
const H2 = commit(F.base.repo, { 'src/feat02.js': fn('02', '// r0\n// touched after review\n') }, 'touch carried');

const seats = (extra = {}) => [
  { seatId: 's1', carriable: true, findings: [], ...extra },
  { seatId: 's2', carriable: true, findings: [] },
];
function input(fx, over = {}) {
  const { prior: priorOver, current: curOver, ...rest } = over;
  return {
    repo: fx.repo, baseSha: fx.B, priorHead: fx.H0, newHead: fx.H1, returnReview: 'incremental',
    prior: { mode: 'full', baseSha: fx.B, rosterDigest: 'r', specDigest: 's', verifyCmd: 'node scripts/check.js', seats: seats(), ...priorOver },
    current: { rosterDigest: 'r', specDigest: 's', verifyCmd: 'node scripts/check.js', verificationGreen: true, ...curOver },
    ...rest,
  };
}
const inc = (m, i) => { const r = m.evaluateReturnIncrement(i); return r; };
const fullWith = (m, i, reason) => { const r = m.evaluateReturnIncrement(i); return r.mode === 'full' && r.reason === reason; };
const paths = (r) => r.recheck.map((e) => e.path);

function checks(m) {
  const c = {};
  const t = (name, f) => { try { c[name] = Boolean(f()); } catch (e) { c[name] = false; } };
  const b = F.base;
  const baseR = () => inc(m, input(b));
  t('baseline_incremental', () => { const r = baseR(); return r.mode === 'incremental' && r.changed.join() === 'src/feat03.js'; });
  // A1 carry
  t('a1_carry', () => {
    const r = baseR();
    const seen = r.recheck_diff.toString() + r.delta.diff.toString();
    return r.mode === 'incremental' && paths(r).join() === 'src/feat03.js'
      && r.carried.map((e) => e.path).join() === 'src/feat01.js,src/feat02.js'
      && !seen.includes('feat01') && !seen.includes('feat02');
  });
  // A2 open finding on unchanged-by-delta file keeps it in the re-check set
  t('a2_open_finding', () => {
    const r = inc(m, input(b, { prior: { seats: seats({ findings: [{ id: 'F1', path: 'src/feat02.js:3' }] }) } }));
    return r.mode === 'incremental' && paths(r).includes('src/feat02.js')
      && r.recheck.find((e) => e.path === 'src/feat02.js').why.some((w) => w.startsWith('open_finding:F1'))
      && !r.carried.some((e) => e.path === 'src/feat02.js');
  });
  // A4 / A16 / A17 references in both directions
  t('a4_reverse_ref', () => {
    const r = inc(m, input(F.resign));
    return r.mode === 'incremental' && paths(r).includes('src/usesalpha.js')
      && r.recheck.find((e) => e.path === 'src/usesalpha.js').why.some((w) => w.startsWith('references_removed_symbol:alphaFn'));
  });
  t('a4_path_ref', () => {
    const r = inc(m, input(F.pathref));
    return r.mode === 'incremental' && paths(r).includes('src/usesalpha.js');
  });
  t('a16_forward_ref', () => {
    const r = inc(m, input(F.fwd));
    const e = r.mode === 'incremental' && r.recheck.find((x) => x.path === 'src/calleemod.js');
    return e && e.why.some((w) => w.startsWith('referenced_by_changed:src/feat05.js'));
  });
  t('a16_reference_cap', () => fullWith(m, input(F.fwd, { limits: { increment_reference_cap: 0 } }), 'reference_cap')
    && inc(m, input(F.fwd, { limits: { increment_reference_cap: 1 } })).mode === 'incremental');
  // review fixes: oversize text files are never silently skipped; binaries are exempt from the text scan
  t('f_scan_oversize_text', () => fullWith(m, input(F.resign, { limits: { increment_scan_file_bytes: 40 } }), 'reference_cap')
    && inc(m, input(F.resign, { limits: { increment_scan_file_bytes: 4000 } })).mode === 'incremental');
  t('f_scan_oversize_binary_exempt', () => inc(m, input(b, { limits: { increment_scan_file_bytes: 2000 } })).mode === 'incremental'
    && fullWith(m, input(b, { limits: { increment_scan_file_bytes: 50 } }), 'reference_cap'));
  t('f_missing_fields_fail_closed', () => {
    const gone = (k, side) => (side === 'prior' ? input(b, { prior: { [k]: undefined } }) : input(b, { current: { [k]: undefined } }));
    const bothGone = (k) => { const i = input(b); delete i.prior[k]; delete i.current[k]; return i; };
    return fullWith(m, bothGone('rosterDigest'), 'roster_changed') && fullWith(m, bothGone('specDigest'), 'spec_changed')
      && fullWith(m, bothGone('verifyCmd'), 'verify_cmd_changed') && fullWith(m, bothGone('baseSha'), 'base_changed')
      && fullWith(m, gone('specDigest', 'prior'), 'spec_changed');
  });
  t('f_findings_not_array', () => fullWith(m, input(b, { prior: { seats: seats({ findings: undefined }) } }), 'finding_unmapped')
    && fullWith(m, input(b, { prior: { seats: seats({ findings: 'none' }) } }), 'finding_unmapped'));
  t('a_binary_change_detected', () => {
    const r = inc(m, input(F.bin));
    // Plain `git diff` already prints abbreviated blob ids for a binary, so the old digest did move;
    // --binary/--full-index pin it to the full content id plus the literal patch (no abbreviation
    // collision, no dependence on core.abbrev). The check asserts those bytes are what gets hashed.
    const diff = r.recheck_diff.toString();
    return r.mode === 'incremental' && r.changed.includes('assets/b.bin') && paths(r).includes('assets/b.bin')
      && /index [0-9a-f]{40}\.\.[0-9a-f]{40}/.test(diff) && diff.includes('GIT binary patch');
  });
  t('a_symlink_scanned', () => {
    const r = inc(m, input(F.resign));
    const e = r.mode === 'incremental' && r.recheck.find((x) => x.path === 'src/link.js');
    return e && e.why.some((w) => w.startsWith('references_changed:src/alphamod.js'));
  });
  t('a_deleted_not_in_recheck', () => {
    const r = inc(m, input(F.del, { prior: { seats: seats({ findings: [{ id: 'F1', path: 'src/feat04.js' }] }) } }));
    return r.mode === 'incremental' && r.changed.includes('src/feat04.js') && !paths(r).includes('src/feat04.js')
      && !r.recheck_files.some((f) => f.path === 'src/feat04.js');
  });
  t('a17_file_content', () => {
    const r = inc(m, input(F.fwd));
    const f = r.mode === 'incremental' && r.recheck_files.find((x) => x.path === 'src/calleemod.js');
    return f && f.content.toString() === BASE_FILES['src/calleemod.js']
      && r.recheck.find((x) => x.path === 'src/calleemod.js').source === 'file'
      && !r.recheck_diff.toString().includes('calleemod.js');
  });
  t('a17_content_cap', () => fullWith(m, input(F.fwd, { limits: { increment_recheck_content_bytes: 10 } }), 'recheck_content_size'));
  // A12 seat-level split
  t('a12_seat_split', () => {
    const r = inc(m, input(b, { prior: { seats: [...seats(), { seatId: 's3', carriable: false, findings: [] }] } }));
    return r.mode === 'incremental' && JSON.stringify(r.seat_packets) === JSON.stringify({ s1: 'incremental', s2: 'incremental', s3: 'full' });
  });
  // A5 / A5a / A5b fallbacks, each with a green control (baseline stays incremental)
  t('f_opt_in_off', () => fullWith(m, input(b, { returnReview: 'full' }), 'opt_in_off') && fullWith(m, input(b, { returnReview: undefined }), 'opt_in_off'));
  t('f_no_carriable_seat', () => fullWith(m, input(b, { prior: { seats: [{ seatId: 's1', carriable: false, findings: [] }] } }), 'no_carriable_seat'));
  t('f_prior_round_incremental', () => fullWith(m, input(b, { prior: { mode: 'incremental' } }), 'prior_round_incremental'));
  t('f_finding_unmapped', () => {
    const f = (p) => input(b, { prior: { seats: seats({ findings: [{ id: 'F1', path: p }] }) } });
    return fullWith(m, f(undefined), 'finding_unmapped')            // no path
      && fullWith(m, f('src/u01.js:1'), 'finding_unmapped')         // path never changed since base
      && fullWith(m, f('../etc/passwd'), 'finding_unmapped')
      && fullWith(m, input(F.deleted, { prior: { seats: seats({ findings: [{ id: 'F1', path: 'src/gnew.js' }] }) } }), 'finding_unmapped');
  });
  t('a14_rename_followed', () => {
    const r = inc(m, input(F.renamed, { prior: { seats: seats({ findings: [{ id: 'F1', path: 'src/gnew.js:4' }] }) } }));
    return r.mode === 'incremental' && r.findings[0].path === 'src/gmoved.js' && paths(r).includes('src/gmoved.js');
  });
  t('f_base_changed', () => fullWith(m, input(b, { prior: { baseSha: 'f'.repeat(40) } }), 'base_changed'));
  t('f_roster_changed', () => fullWith(m, input(b, { current: { rosterDigest: 'r2' } }), 'roster_changed'));
  t('f_spec_changed', () => fullWith(m, input(b, { current: { specDigest: 's2' } }), 'spec_changed'));
  t('a5a_verify_cmd_changed', () => fullWith(m, input(b, { current: { verifyCmd: 'node scripts/other.js' } }), 'verify_cmd_changed')
    && inc(m, input(b, { current: { verifyCmd: 'node scripts/check.js' } })).mode === 'incremental');
  t('f_verification_red', () => fullWith(m, input(b, { current: { verificationGreen: false } }), 'verification_red')
    && fullWith(m, input(b, { current: { verificationGreen: undefined } }), 'verification_red'));
  t('f_changed_ratio', () => fullWith(m, input(b, { limits: { increment_max_changed_ratio: 0.33 } }), 'changed_ratio')
    && inc(m, input(b, { limits: { increment_max_changed_ratio: 1 / 3 } })).mode === 'incremental');
  t('a5b_delta_packet_size', () => {
    const bytes = baseR().delta.bytes;
    return fullWith(m, input(b, { limits: { increment_delta_packet_bytes: bytes - 1 } }), 'delta_packet_size')
      && inc(m, input(b, { limits: { increment_delta_packet_bytes: bytes } })).mode === 'incremental';
  });
  t('f_shared_surface', () => fullWith(m, input(F.pkg), 'shared_surface')
    && fullWith(m, input(F.verify), 'shared_surface')
    && fullWith(m, input(b, { acceptancePaths: ['src/feat03.js'] }), 'shared_surface')
    && fullWith(m, input(b, { sharedSurfacePaths: ['src/'] }), 'shared_surface'));
  // priority: the first failing test names the reason
  t('f_priority_order', () => fullWith(m, input(b, { returnReview: 'full', prior: { mode: 'incremental' }, current: { specDigest: 'x', verificationGreen: false } }), 'opt_in_off')
    && fullWith(m, input(b, { prior: { mode: 'incremental' }, current: { specDigest: 'x' } }), 'prior_round_incremental')
    && fullWith(m, input(F.pkg, { current: { specDigest: 'x' } }), 'spec_changed'));
  // A7 carried digest recheck from Git at use time
  t('a7_carried_digest_recheck', () => {
    const r = baseR();
    return m.verifyCarriedDigests(b.repo, b.B, b.H1, r.carried).length === 0
      && m.verifyCarriedDigests(b.repo, b.B, H2, r.carried).map((e) => e.path).join() === 'src/feat02.js';
  });
  // A10 a reader recomputes the sets from the two heads and they match; a corrupt digest disagrees
  t('a10_recompute_matches', () => {
    const r = baseR();
    const again = baseR();
    const d1 = m.computeFileDigests(b.repo, b.B, b.H1);
    const corrupt = r.carried.map((e, i) => (i === 0 ? { ...e, file_digest: '0'.repeat(64) } : e));
    return JSON.stringify(r.carried) === JSON.stringify(again.carried)
      && r.carried.every((e) => d1.get(e.path) === e.file_digest)
      && r.recheck.every((e) => d1.get(e.path) === e.file_digest)
      && m.verifyCarriedDigests(b.repo, b.B, b.H1, corrupt).length === 1;
  });
  t('input_validation', () => {
    let threw = 0;
    for (const bad of [{ newHead: 'abc' }, { repo: '' }, { priorHead: b.H1, newHead: b.H0 }]) {
      try { m.evaluateReturnIncrement(input(b, bad)); } catch (e) { if (e.code === 'review_increment_input_invalid') threw += 1; }
    }
    return threw === 3;
  });
  return c;
}

// ---- negative controls: [name, expected-red check(s), mutate(src)] ----
const guardOff = (reason) => (src) => {
  const re = new RegExp(`if \\(\\((.*)\\)\\) (.*)// guard:${reason}$`, 'm');
  assertOnce(src, re, reason);
  return src.replace(re, (all) => all.replace('if ((', 'if (false && ('));
};
function assertOnce(src, pat, label) {
  const n = typeof pat === 'string' ? src.split(pat).length - 1 : (src.match(new RegExp(pat.source, 'gm')) || []).length;
  if (n !== 1) throw new Error(`mutation anchor for ${label} matched ${n} times`);
}
const swap = (from, to) => (src) => { assertOnce(src, from, from); return src.replace(from, to); };
const CONTROLS = [
  ['oversize_text_skipped_silently', ['f_scan_oversize_text'], swap('if (e.size > limits.increment_scan_file_bytes) { cannotScan = true; break; }', '')],
  ['oversize_binary_not_exempt', ['f_scan_oversize_binary_exempt'], swap('if (buf.subarray(0, 8000).includes(0)) continue; // binary: no textual references', 'if (e.size > limits.increment_scan_file_bytes) { cannotScan = true; break; }')],
  ['loose_compare', ['f_missing_fields_fail_closed'], swap("const sameStr = (a, b) => typeof a === 'string' && a !== '' && a === b;", 'const sameStr = (a, b) => a === b;')],
  ['findings_not_array_ignored', ['f_findings_not_array'], swap('if (!Array.isArray(seat.findings)) unmapped = true;', '')],
  ['binary_diff_text_only', ['a_binary_change_detected'], swap("'--binary', '--full-index',", '')],
  ['symlink_not_scanned', ['a_symlink_scanned'], swap("const scannable = tree.filter((e) => e.type === 'blob');", "const scannable = tree.filter((e) => e.type === 'blob' && e.mode !== '120000');")],
  ['deleted_kept_in_recheck', ['a_deleted_not_in_recheck'], swap('.filter((p) => treeByPath.has(p)).sort();', '.sort();')],
  ['carry_off', ['a1_carry'], swap('const changed = [...union].filter((p) => digests0.get(p) !== digests1.get(p)).sort();', 'const changed = [...union].sort();')],
  ['open_finding_rule_off', ['a2_open_finding'], swap("for (const f of findings) if (f.path) addWhy(f.path, `open_finding:${f.id}`);", '')],
  ['reference_expansion_off', ['a4_reverse_ref', 'a4_path_ref', 'a16_forward_ref', 'a17_file_content'], swap('if (!cannotScan) {', 'if (false) {')],
  ['forward_refs_off', ['a16_forward_ref'], swap('for (const [src, a] of addedBy) {', 'for (const [src, a] of []) {')],
  ['only_recheck_diff', ['a17_file_content'], swap('const asFile = recheckPaths.filter(', 'const asFile = [].filter(')],
  ['seat_split_round_level', ['a12_seat_split'], swap('(carriableSeats.length === 0)', '(carriableSeats.length < seats.length)')],
  ['carry_digest_corrupt', ['a10_recompute_matches'], swap('.map((p) => ({ path: p, file_digest: digests1.get(p) }));', ".map((p) => ({ path: p, file_digest: 'corrupt' }));")],
  ['carried_digest_recheck_skipped', ['a7_carried_digest_recheck'], swap('.filter((e) => !e || current.get(e.path) !== e.file_digest)', '.filter(() => false)')],
  ['unmappable_dropped_silently', ['f_finding_unmapped'], guardOff('finding_unmapped')],
  ['opt_in_ignored', ['f_opt_in_off'], guardOff('opt_in_off')],
  ['no_carriable_ignored', ['f_no_carriable_seat'], guardOff('no_carriable_seat')],
  ['carry_through_incremental_artifact', ['f_prior_round_incremental'], guardOff('prior_round_incremental')],
  ['base_compare_skipped', ['f_base_changed'], guardOff('base_changed')],
  ['roster_compare_skipped', ['f_roster_changed'], guardOff('roster_changed')],
  ['spec_compare_skipped', ['f_spec_changed'], guardOff('spec_changed')],
  ['verify_cmd_compare_skipped', ['a5a_verify_cmd_changed'], guardOff('verify_cmd_changed')],
  ['verification_ignored', ['f_verification_red'], guardOff('verification_red')],
  ['ratio_guard_skipped', ['f_changed_ratio'], guardOff('changed_ratio')],
  ['delta_size_guard_skipped', ['a5b_delta_packet_size'], guardOff('delta_packet_size')],
  ['reference_cap_skipped', ['a16_reference_cap'], guardOff('reference_cap')],
  ['recheck_size_guard_skipped', ['a17_content_cap'], guardOff('recheck_content_size')],
  ['shared_surface_guard_skipped', ['f_shared_surface'], guardOff('shared_surface')],
];

function mutated(name, mutate) {
  const dir = path.join(tmp, 'mut', name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'review-increment.js');
  fs.writeFileSync(f, mutate(fs.readFileSync(SRC, 'utf8')));
  return require(f);
}
const failing = (c) => Object.keys(c).filter((k) => !c[k]);

if (process.env.NEG_CONTROL) {
  const ctl = CONTROLS.find((x) => x[0] === process.env.NEG_CONTROL);
  if (!ctl) throw new Error(`unknown NEG_CONTROL ${process.env.NEG_CONTROL}`);
  const bad = failing(checks(mutated(ctl[0], ctl[2])));
  console.log(`NEG_CONTROL=${ctl[0]} failing=${JSON.stringify(bad)}`);
  process.exit(bad.length ? 1 : 0);
}

const green = checks(real);
for (const k of Object.keys(green)) console.log(`${k}=${green[k]}`);
// Every guard reason in the plan has a guard line, and the list in the module is the plan's list.
const src = fs.readFileSync(SRC, 'utf8');
console.log(`reasons_listed=${real.REASONS.every((r) => src.includes(`// guard:${r}`)) && real.REASONS.length === 14}`);
for (const [name, expect, mutate] of CONTROLS) {
  const bad = failing(checks(mutated(name, mutate)));
  console.log(`neg_${name}=${expect.every((e) => bad.includes(e))}`);
}
NODE
)"
assert_exit_code "$?" "0" "review-increment: $OUT"
for key in baseline_incremental a1_carry a2_open_finding a4_reverse_ref a4_path_ref a16_forward_ref a16_reference_cap \
  a17_file_content a17_content_cap a12_seat_split f_opt_in_off f_no_carriable_seat f_prior_round_incremental \
  f_finding_unmapped a14_rename_followed f_base_changed f_roster_changed f_spec_changed a5a_verify_cmd_changed \
  f_verification_red f_changed_ratio a5b_delta_packet_size f_shared_surface f_priority_order a7_carried_digest_recheck \
  a10_recompute_matches input_validation reasons_listed \
  f_scan_oversize_text f_scan_oversize_binary_exempt f_missing_fields_fail_closed f_findings_not_array \
  a_binary_change_detected a_symlink_scanned a_deleted_not_in_recheck \
  neg_oversize_text_skipped_silently neg_oversize_binary_not_exempt neg_loose_compare neg_findings_not_array_ignored \
  neg_binary_diff_text_only neg_symlink_not_scanned neg_deleted_kept_in_recheck \
  neg_carry_off neg_open_finding_rule_off neg_reference_expansion_off neg_forward_refs_off neg_only_recheck_diff \
  neg_seat_split_round_level neg_carry_digest_corrupt neg_carried_digest_recheck_skipped neg_unmappable_dropped_silently \
  neg_opt_in_ignored neg_no_carriable_ignored neg_carry_through_incremental_artifact neg_base_compare_skipped \
  neg_roster_compare_skipped neg_spec_compare_skipped neg_verify_cmd_compare_skipped neg_verification_ignored \
  neg_ratio_guard_skipped neg_delta_size_guard_skipped neg_reference_cap_skipped neg_recheck_size_guard_skipped \
  neg_shared_surface_guard_skipped; do
  assert_contains "$OUT" "$key=true" "review-increment proves $key"
done
finalize_test
