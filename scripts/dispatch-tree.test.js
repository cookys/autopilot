'use strict';
// dispatch-tree.js — fixture-only tests (own temp dirs; never reads the real ~/.claude, ~/.autopilot or runs dir).
const test = require('node:test');
const { after } = test;
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'dispatch-tree.js');
const SID = 'sess-aaaa';
const ENV = { PATH: process.env.PATH };

const made = [];
after(() => { for (const r of made) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tree-'));
  made.push(root);
  const d = { root, projects: path.join(root, 'projects'), runs: path.join(root, 'runs'), markers: path.join(root, 'markers') };
  const sub = path.join(d.projects, 'proj-x', SID, 'subagents');
  for (const p of [sub, d.runs, d.markers]) fs.mkdirSync(p, { recursive: true });
  d.agent = (id, meta) => fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify(meta));
  d.run = (id, m) => fs.writeFileSync(path.join(d.runs, `${id}.manifest.json`), JSON.stringify({ run_id: id, ...m }));
  d.marker = (m) => fs.writeFileSync(path.join(d.markers, `${SID}.json`), JSON.stringify(m));
  return d;
}
function run(d, extra = []) {
  return spawnSync('node', [SCRIPT, '--session', SID, '--projects-dir', d.projects, '--runs-dir', d.runs, '--marker-dir', d.markers, ...extra],
    { encoding: 'utf8', env: ENV });
}
const json = (d) => JSON.parse(run(d, ['--json']).stdout);
const find = (n, id) => (n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean));

test('two-level subagents nest by parentAgentId', () => {
  const d = fixture();
  d.agent('a1', { agentType: 'Explore', toolUseId: 't1', spawnDepth: 1 });
  d.agent('a2', { agentType: 'Explore', toolUseId: 't2', spawnDepth: 2, parentAgentId: 'a1' });
  d.agent('a3', { agentType: 'Explore', toolUseId: 't3', spawnDepth: 3, parentAgentId: 'a2' });
  const t = json(d);
  assert.strictEqual(find(t.root, 'a2').children[0].id, 'a3');
  assert.strictEqual(t.root.children.length, 1);
  assert.strictEqual(t.counts.agents, 3);
  assert.strictEqual(t.counts.untracked, 0);
});

test('legacy / missing parentAgentId / unknown parent are flagged untracked, not dropped', () => {
  const d = fixture();
  d.agent('old', { agentType: 'x' });
  d.agent('lost', { spawnDepth: 2, toolUseId: 'tl' });
  d.agent('orph', { spawnDepth: 2, parentAgentId: 'ghost' });
  const t = json(d);
  assert.strictEqual(find(t.root, 'old').untracked_reason, 'legacy_record_no_parent_info');
  assert.strictEqual(find(t.root, 'lost').untracked_reason, 'missing_parentAgentId');
  assert.strictEqual(find(t.root, 'orph').untracked_reason, 'parent_agent_not_found');
  assert.strictEqual(t.counts.untracked, 3);
  assert.strictEqual(t.root.children.length, 3);
});

test('parentAgentId cycle does not hang and is flagged', () => {
  const d = fixture();
  d.agent('c1', { spawnDepth: 2, parentAgentId: 'c2' });
  d.agent('c2', { spawnDepth: 2, parentAgentId: 'c1' });
  const t = json(d);
  assert.ok(find(t.root, 'c1') && find(t.root, 'c2'));
  assert.ok(t.counts.untracked >= 1);
});

test('session -> rail by manifest.session_id (preferred, no marker needed); rail -> rail depth 1', () => {
  const d = fixture();
  d.run('r0', { role: 'implementer', runner: 'codex', root_run_id: 'r0', depth: 0, session_id: SID, started_at: '2026-10-13T01:00:00Z' });
  d.run('r1', { role: 'reviewer', runner: 'kimi', root_run_id: 'r0', parent_run_id: 'r0', depth: 1, started_at: '2026-10-13T01:01:00Z' });
  d.run('other', { runner: 'codex', root_run_id: 'other', depth: 0, session_id: 'sess-zzzz' });
  const t = json(d);
  const r0 = find(t.root, 'r0');
  assert.strictEqual(r0.joined_by, 'session_id');
  assert.strictEqual(r0.children[0].id, 'r1');
  assert.strictEqual(r0.children[0].joined_by, 'parent_run_id');
  assert.strictEqual(find(t.root, 'other'), undefined);
  assert.strictEqual(t.sources.marker.found, false);
});

test('manifest without session_id joins through the marker root_run_id (and campaign_roots)', () => {
  const d = fixture();
  const future = new Date(Date.now() + 3600e3).toISOString();
  d.marker({ session_id: SID, level: null, root_run_id: 'job-1', campaign_roots: ['camp-1'], expires_at: future });
  d.run('m1', { runner: 'codex', root_run_id: 'job-1', depth: 0 });
  d.run('m2', { runner: 'kimi', root_run_id: 'camp-1', depth: 0 });
  d.run('m3', { runner: 'kimi', root_run_id: 'job-2', depth: 0 });
  const t = json(d);
  assert.strictEqual(find(t.root, 'm1').joined_by, 'marker');
  assert.ok(find(t.root, 'm2'));
  assert.strictEqual(find(t.root, 'm3'), undefined);
  assert.strictEqual(t.sources.marker.expired, false);
});

test('expired marker still joins but is warned about', () => {
  const d = fixture();
  d.marker({ session_id: SID, root_run_id: 'job-1', expires_at: '2020-01-01T00:00:00Z' });
  d.run('m1', { runner: 'codex', root_run_id: 'job-1', depth: 0 });
  const t = json(d);
  assert.ok(find(t.root, 'm1'));
  assert.strictEqual(t.sources.marker.expired, true);
  assert.ok(t.warnings.some((w) => /expired/.test(w)));
});

test('rail with missing parent run is untracked; loop-back runner gets trace_end; descendant with another session joins', () => {
  const d = fixture();
  d.run('p', { runner: 'cc-shim', root_run_id: 'p', depth: 0, session_id: SID });
  d.run('kid', { runner: 'codex', root_run_id: 'p', parent_run_id: 'p', depth: 1, session_id: 'sess-child' });
  d.run('lost', { runner: 'codex', root_run_id: 'x', parent_run_id: 'gone', depth: 1, session_id: SID });
  const t = json(d);
  assert.strictEqual(find(t.root, 'p').trace_end, 'loop_back_not_recorded');
  assert.strictEqual(find(t.root, 'p').children[0].id, 'kid');
  assert.strictEqual(find(t.root, 'lost').untracked_reason, 'parent_run_not_found');
  assert.strictEqual(t.root.children.find((c) => c.id === 'lost').untracked, true);
});

test('rail parent_run_id cycle: both rails still appear, flagged cycle', () => {
  const d = fixture();
  d.run('r1', { runner: 'codex', root_run_id: 'r1', parent_run_id: 'r2', depth: 1, session_id: SID });
  d.run('r2', { runner: 'codex', root_run_id: 'r1', parent_run_id: 'r1', depth: 1, session_id: SID });
  const t = json(d);
  assert.strictEqual(t.counts.rails, 2);
  assert.strictEqual(find(t.root, 'r1').untracked_reason, 'cycle');
  assert.strictEqual(find(t.root, 'r2').untracked_reason, 'cycle');
});

test('manifest carrying another session_id cannot borrow the marker root', () => {
  const d = fixture();
  d.marker({ session_id: SID, root_run_id: 'job-1', expires_at: new Date(Date.now() + 3600e3).toISOString() });
  d.run('foreign', { runner: 'codex', root_run_id: 'job-1', session_id: 'sess-zzzz', depth: 0 });
  d.run('mine', { runner: 'codex', root_run_id: 'job-1', depth: 0 });
  const t = json(d);
  assert.strictEqual(find(t.root, 'foreign'), undefined);
  assert.ok(find(t.root, 'mine'));
});

test('joined_by is shown in text and the expired warning names the marker started_at', () => {
  const d = fixture();
  d.marker({ session_id: SID, root_run_id: 'job-1', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-02T00:00:00Z' });
  d.run('viaMarker', { runner: 'codex', root_run_id: 'job-1', depth: 0 });
  d.run('viaSid', { runner: 'codex', root_run_id: 'zz', depth: 0, session_id: SID });
  const t = json(d);
  assert.strictEqual(find(t.root, 'viaMarker').joined_by, 'marker');
  assert.strictEqual(find(t.root, 'viaSid').joined_by, 'session_id');
  assert.ok(t.warnings.some((w) => w.includes('2020-01-01T00:00:00.000Z')));
  const out = run(d).stdout;
  assert.match(out, /rail viaMarker.*joined_by=marker/);
  assert.match(out, /rail viaSid.*joined_by=session_id/);
});

test('missing source dirs: warnings, exit 0, empty tree', () => {
  const d = fixture();
  const r = spawnSync('node', [SCRIPT, '--session', 'nope', '--json', '--projects-dir', path.join(d.root, 'no1'),
    '--runs-dir', path.join(d.root, 'no2'), '--marker-dir', path.join(d.root, 'no3')], { encoding: 'utf8', env: ENV });
  assert.strictEqual(r.status, 0);
  const t = JSON.parse(r.stdout);
  assert.strictEqual(t.root.children.length, 0);
  assert.ok(t.warnings.length >= 2);
});

test('usage errors exit 2; no session id exits 2', () => {
  assert.strictEqual(spawnSync('node', [SCRIPT, '--bogus'], { env: ENV }).status, 2);
  assert.strictEqual(spawnSync('node', [SCRIPT], { env: ENV }).status, 2);
  assert.strictEqual(spawnSync('node', [SCRIPT, '--session'], { env: ENV }).status, 2);
});

test('text output indents children and prints the untracked reason and the no-record note', () => {
  const d = fixture();
  d.agent('a1', { spawnDepth: 1 });
  d.agent('a2', { spawnDepth: 2, parentAgentId: 'a1' });
  d.agent('old', {});
  d.run('p', { runner: 'cc-shim', root_run_id: 'p', depth: 0, session_id: SID });
  const out = run(d).stdout;
  assert.match(out, /^session sess-aaaa/);
  assert.match(out, /\n {4}- agent a2/);
  assert.match(out, /untracked: legacy_record_no_parent_info/);
  assert.match(out, /◦ 之後的工作沒有紀錄/);
});
