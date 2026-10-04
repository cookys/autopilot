#!/usr/bin/env bash
# hooks/tests/work-order-progress.test.sh — mods P1W W1a: src/status/work-order-progress.js latestProgress().
# RED note: the module was written before this test, so no separate RED run exists; the guards are proven by mutation controls instead (oldest-attempt-wins -> 3 FAIL; R11 controls added).
. "$(dirname "$0")/lib.sh"
SB="$TEST_TMP/wop"; mkdir -p "$SB"
trap cleanup_test_tmp EXIT
cat > "$SB/t.js" <<'JS'
const fs = require('fs'); const path = require('path');
const { latestProgress } = require(process.argv[2] + '/src/status/work-order-progress.js');
const base = process.argv[3]; const out = {};
const ROOT = 'campaign-v1-' + 'a'.repeat(64);
const cd = path.join(base, 'common'); const dir = path.join(cd, 'autopilot', 'work-orders', ROOT);
fs.mkdirSync(dir, { recursive: true });
// real-shaped (anonymised copy of a campaign attempt file): top-level work-order + controller.progress_receipts[]
const rcpt = (phase, issued, extra = {}) => ({ schema_version: 1, artifact_type: 'controller_progress_receipt', project_id: 'mission-0', deliverable_id: 'node-x', generation: 0,
  active_process: { pid: 1 }, completed_deliverables: ['d1'], remaining_deliverables: ['d2'], deliverable_count: 2, frozen_denominator_digest: 'f'.repeat(64),
  blocked_reason: null, eta_basis: 'frozen_graph_remaining', gate_state: { entries: [] }, resource_debt_state: { open: [], released: [] }, phase,
  work_order_id: 'wo-' + ROOT + '-node-x-a1', root_run_id: ROOT, issued_at: issued, digest: 'e'.repeat(64), ...extra });
const wo = (rs) => ({ schema_version: 1, artifact_type: 'work_order', work_order_id: 'wo', root_run_id: ROOT, graph_node: 'node-x', attempt: 1, controller: { schema_version: 1, phase: 'x', progress_receipts: rs }, digest: '0'.repeat(64) });
const W = (n, v) => fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v));
out.noDir = latestProgress({ commonDir: cd, root: 'campaign-v1-' + 'b'.repeat(64) }) === null;
out.badArgs = latestProgress({}) === null && latestProgress() === null && latestProgress({ commonDir: cd, root: '../x' }) === null && latestProgress({ commonDir: cd, root: 'a/b' }) === null;
out.emptyDir = latestProgress({ commonDir: cd, root: ROOT }) === null;
W('node-x-a1.json', '{ not json');
W('reconcile-receipt.json', { artifact_type: 'reconcile_receipt' });
W('node-y-a1.json', { controller: 'nope' });
out.malformedOnly = latestProgress({ commonDir: cd, root: ROOT }) === null;
W('node-x-a2.json', wo([rcpt('PREPARED', '2026-08-30T06:00:00.000Z'), rcpt('IMPLEMENTING', '2026-08-30T06:10:00.000Z')]));
let r = latestProgress({ commonDir: cd, root: ROOT });
out.newestInFile = r && r.value.phase === 'IMPLEMENTING';
// two attempts: the NEWER attempt (by issued_at) wins even though its file name sorts first
W('node-x-a1.json', wo([rcpt('REPAIRING', '2026-08-30T07:00:00.000Z')]));
r = latestProgress({ commonDir: cd, root: ROOT });
out.newestAttemptWins = r && r.value.phase === 'REPAIRING' && r.file.endsWith('node-x-a1.json');
// casing is preserved as written
W('node-x-a3.json', wo([rcpt('awaiting_disposition', '2026-08-30T08:00:00.000Z')]));
r = latestProgress({ commonDir: cd, root: ROOT });
out.casingPreserved = r && r.value.phase === 'awaiting_disposition';
// a receipt of another root / non-progress type is ignored
W('node-x-a4.json', wo([rcpt('IMPLEMENTING', '2026-08-30T09:00:00.000Z', { root_run_id: 'other' }), { artifact_type: 'other', root_run_id: ROOT, issued_at: '2026-08-30T09:30:00.000Z' }]));
r = latestProgress({ commonDir: cd, root: ROOT });
out.foreignIgnored = r && r.value.phase === 'awaiting_disposition';
// no issued_at: the file mtime orders it
fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir, { recursive: true });
W('a-old.json', wo([rcpt('PREPARED', undefined)])); W('b-new.json', wo([rcpt('REVIEWING', undefined)]));
fs.utimesSync(path.join(dir, 'a-old.json'), new Date(1e12), new Date(1e12)); fs.utimesSync(path.join(dir, 'b-new.json'), new Date(2e12), new Date(2e12));
r = latestProgress({ commonDir: cd, root: ROOT });
out.mtimeFallback = r && r.value.phase === 'REVIEWING';
fs.utimesSync(path.join(dir, 'a-old.json'), new Date(3e12), new Date(3e12));
r = latestProgress({ commonDir: cd, root: ROOT });
out.mtimeFallbackFlips = r && r.value.phase === 'PREPARED';
// R11 negative controls: file-level root mismatch is unbound (+debug), newer mtime but older issued_at does not win
fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir, { recursive: true });
W('x-a1.json', { ...wo([rcpt('IMPLEMENTING', '2026-08-30T06:00:00.000Z')]), root_run_id: 'campaign-v1-' + 'c'.repeat(64) });
const dbg = []; r = latestProgress({ commonDir: cd, root: ROOT, debug: dbg });
out.fileRootMismatch = r === null && dbg.some((d) => d.reason === 'root_mismatch');
const dbg2 = []; W('x-a1.json', wo([rcpt('IMPLEMENTING', '2026-08-30T06:00:00.000Z', { root_run_id: 'campaign-v1-' + 'c'.repeat(64) })]));
r = latestProgress({ commonDir: cd, root: ROOT, debug: dbg2 });
out.receiptRootMismatch = r === null && dbg2.some((d) => d.reason === 'root_mismatch');
W('x-a1.json', { ...wo([rcpt('REPAIRING', '2026-08-30T07:00:00.000Z')]), attempt: 1 }); W('x-a2.json', { ...wo([rcpt('PREPARED', '2026-08-30T06:00:00.000Z')]), attempt: 2 });
fs.utimesSync(path.join(dir, 'x-a1.json'), new Date(1e12), new Date(1e12)); fs.utimesSync(path.join(dir, 'x-a2.json'), new Date(3e12), new Date(3e12));
r = latestProgress({ commonDir: cd, root: ROOT });
out.newerMtimeOlderSeqLoses = r && r.value.phase === 'REPAIRING';
process.stdout.write(JSON.stringify(out));
JS
RES="$(node "$SB/t.js" "$REPO_ROOT" "$SB" 2> "$SB/err" < /dev/null)"
for k in noDir badArgs emptyDir malformedOnly newestInFile newestAttemptWins casingPreserved foreignIgnored mtimeFallback mtimeFallbackFlips fileRootMismatch receiptRootMismatch newerMtimeOlderSeqLoses; do
  assert_contains "$RES" "\"$k\":true" "latestProgress: $k (stderr: $(head -c 200 "$SB/err"))"
done
finalize_test
