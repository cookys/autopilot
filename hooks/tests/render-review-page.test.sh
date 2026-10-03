#!/usr/bin/env bash
# hooks/tests/render-review-page.test.sh — mods plan P1b row B1a: JSON -> review page HTML (no publishing).
# RED at 0a642f8f (scripts/render-review-page.js absent; schema cases were written against the new schema file): 54 assertions fail, first lines:
#   FAIL [render-review-page] renderer rc 0 on the full fixture (... Error: Cannot find module '.../scripts/render-review-page.js')
#   FAIL [render-review-page] nine sections present exactly once, in the fixed order: expected '123456789', got ''
#   FAIL [render-review-page] section 1: updated <published_at> @ <commit>: 'updated 2026-10-04T02:00:00.000Z @ <sha>' not found in output
# B1b additions (sections 13-14) RED at 6c25cd3d (publishing absent): 49 assertions fail, first lines:
#   FAIL [render-review-page] first publish rc 0 (stderr: render-review-page: publishing is not available yet; pass --print): expected '0', got '2'
#   FAIL [render-review-page] first publish creates current -> v-<compact published_at>: expected 'v-20261004T020000.000Z', got ''
#   FAIL [render-review-page] project index lists the job with a relative link: 'href="2026-10-04/J1/current/index.html"' not found in output
#   FAIL [render-review-page] unparseable --now: rc 2: expected '2', got '0'
# Pure fixtures: fake HOME / CLAUDE_CONFIG_DIR / AUTOPILOT_LIVE_DIR (/dev/shm) / costs file; the renderer
# is never allowed to call the real `autopilot status task` (a fixture receipt or a fake bin is always given).
. "$(dirname "$0")/lib.sh"

SB="$TEST_TMP/rrp"
export HOME="$SB/home"
export CLAUDE_CONFIG_DIR="$SB/claude"
export AUTOPILOT_COSTS_FILE="$SB/costs.jsonl"
export AUTOPILOT_SESSION_MODE_DIR="$SB/home/.autopilot/session-mode"
mkdir -p "$HOME/.autopilot" "$CLAUDE_CONFIG_DIR"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rrp-XXXXXX)"; chmod 700 "$LIVE"
export AUTOPILOT_LIVE_DIR="$LIVE"
BG_PIDS=""
trap 'for p in $BG_PIDS; do kill "$p" 2>/dev/null; done; rm -rf "$LIVE"; cleanup_test_tmp' EXIT
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_ROOT_RUN_ID

R="$REPO_ROOT/scripts/render-review-page.js"
SCHEMA_CHECK="$REPO_ROOT/scripts/validate-json-schema.js"
F="$SB/fx"; mkdir -p "$F"

# ---- fixture generator (written to a file; run once) ------------------------------------------------------
cat > "$SB/gen.js" <<'JS'
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const crypto = require('crypto');
const F = process.argv[2];
const W = (p, v) => { fs.mkdirSync(path.dirname(path.join(F, p)), { recursive: true }); fs.writeFileSync(path.join(F, p), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const git = (...a) => cp.execFileSync('git', ['-C', path.join(F, 'repo'), ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
fs.mkdirSync(path.join(F, 'repo'), { recursive: true });
git('init', '-q', '-b', 'main');
const commit = (n) => { fs.writeFileSync(path.join(F, 'repo', 'f.txt'), n); git('add', '-A'); git('commit', '-q', '-m', n); return git('rev-parse', 'HEAD'); };
const c1 = commit('c1'); const c2 = commit('c2'); const c3 = commit('c3');
git('checkout', '-q', '-b', 'other', c1); const x = commit('x'); git('checkout', '-q', 'main');
W('shas.json', { c1, c2, c3, x });
const mk = (name, root, ledgerDir, extra = {}) => { fs.mkdirSync(path.join(F, ledgerDir), { recursive: true }); fs.writeFileSync(path.join(F, ledgerDir, 'ledger.jsonl'), '');
  W(`manifests/${name}.manifest.json`, { run_id: name, root_run_id: root, ledger: path.join(F, ledgerDir, 'ledger.jsonl'), branch: 'p1b/other', prompt: 'FREETEXT-SENTINEL-9f3', task_description: 'FREETEXT-SENTINEL-DESC', ...extra }); return path.join(F, 'manifests', `${name}.manifest.json`); };
const m1 = mk('run-1', 'R1', 'led1'); const m2 = mk('run-2', 'R1', 'led3'); const m3 = mk('run-3', 'R1', 'led1'); const mo = mk('run-other', 'R2', 'led2');
const row = (id, root, manifest, o = {}) => ({ run_id: id, role: 'hand', runner: 'claude', model: 'sonnet', started_at: '2026-10-04T01:00:00.000Z', ended_at: null, parent_run_id: null, root_run_id: root, depth: 1, manifest,
  phase: 'running', alive: null, stall: null, last_event_age_s: null, elapsed_s: 600, rc: null, final_status: null, project: null, source: { manifest, status_probe: null, exit_file: null }, fact_at: '2026-10-04T01:00:00.000Z', observed_at: '2026-10-04T01:10:00.000Z', probe_age_s: null, ...o });
const rows = [
  row('run-1', 'R1', m1, { phase: 'exited', ended_at: '2026-10-04T01:09:00.000Z', final_status: 'ok', rc: 0, elapsed_s: 540 }),
  row('run-2', 'R1', m2, { phase: 'running', alive: true, probe_age_s: 5 }),
  row('run-3', 'R1', m3, { phase: 'unknown' }),
  row('run-other', 'R2', mo, { phase: 'exited', ended_at: '2026-10-04T01:09:00.000Z', final_status: 'ok', rc: 0 }),
];
const env = { schema: 'autopilot.runs-live/1', scope: { project_key: 'abcdef0123456789', repo_identity: 'git-common-dir:/x', root_run_id: null }, published_at: '2026-10-04T01:10:00.000Z', observed_at: '2026-10-04T01:10:00.000Z', valid_for_s: 180, writer: null, runs: rows, counts: { confirmed_live: 1, exited: 2, unknown: 1, fresh_bound_s: 20 }, sessions: {}, host_today_usd: null, host_today_as_of: null };
W('runs.json', env);
W('runs-array.json', rows);
W('runs-only-exited.json', [rows[0]]);
W('runs-hostile.json', [row('run-<b>"&', 'R1', m1, { role: '<script>alert(1)</script>', model: '"><img src=x onerror=alert(2)>', phase: 'exited', ended_at: '2026-10-04T01:09:00.000Z', rc: 0 })]);
const task = (v, o = {}) => ({ schema_version: 1, artifact_type: 'task_status_receipt', issued_at: '2026-10-04T01:20:00.000Z', repo_identity: 'git-common-dir:/x', root_run_id: 'R1', goal: 'GOAL-FREETEXT-SENTINEL', phase: 'p', candidate_commit: c3, candidate_tree_sha: c3, acceptance_verdict: v, accepted_blockers: [], deferred_count: 0, can_merge: true, can_close: true, failed_predicates: [], receipt_digest: 'a'.repeat(64), ...o });
W('task-accepted.json', task('accepted'));
W('task-rejected.json', task('rejected', { can_close: false, failed_predicates: ['review_not_pass'] }));
W('task-noclose.json', task('accepted', { can_close: false, failed_predicates: ['zero_residue'] }));
W('task-wrongroot.json', task('accepted', { root_run_id: 'R2' }));
const rcpt = (phase, head, verdict, branch = 'p1b/other', status = 'finalized') => ({ kind: 'review', phase, branch, phase_base_sha: c1, chain: [{ generation: 1, base: c1, head, status }], verdict, open_findings: [], written_at: '2026-10-04T01:15:00.000Z' });
W('led1/receipt-plan.json', rcpt('plan', c2, 'PASS', 'p1b/b1a'));
W('led1/receipt-stale.json', rcpt('stale', x, 'PASS'));
W('led1/receipt-conflict.json', rcpt('conflict', c2, 'PASS'));
W('led3/receipt-conflict.json', rcpt('conflict', c3, 'FAIL'));
W('led2/receipt-wrongroot.json', rcpt('wrongroot', c3, 'PASS'));
W('progress-frozen.json', { artifact_type: 'controller_progress_receipt', root_run_id: 'R1', completed_deliverables: ['a', 'b'], remaining_deliverables: ['c', 'd'], deliverable_count: 4, frozen_denominator_digest: 'd'.repeat(64), issued_at: '2026-10-04T01:20:00.000Z' });
W('progress-unfrozen.json', { artifact_type: 'controller_progress_receipt', root_run_id: 'R1', completed_deliverables: ['a'], remaining_deliverables: null, deliverable_count: null, frozen_denominator_digest: null, issued_at: '2026-10-04T01:20:00.000Z' });
// compare records + real image files
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(F, 'compare'), { recursive: true });
fs.writeFileSync(path.join(F, 'compare', 'before.png'), png); fs.writeFileSync(path.join(F, 'compare', 'after.png'), Buffer.concat([png, Buffer.from('x')]));
const rec = (id, dirty) => ({ schema: 'compare-record/1', id, scene: 'SCENE-1', viewport: '390x844', browser: 'chromium', fixture: 'fx-a', capture_method: 'page.screenshot',
  before: { commit: c1, dirty: false, path: 'compare/before.png', sha256: sha(png), taken_at: '2026-10-04T01:00:00.000Z' },
  after: { commit: c3, dirty, path: 'compare/after.png', sha256: sha(Buffer.concat([png, Buffer.from('x')])), taken_at: '2026-10-04T01:05:00.000Z' },
  metrics: [{ name: 'luma_roi', kind: 'luma_roi', before: 0.5, after: 0.75, delta: 0.25, unit: 'ratio' }, { name: 'unmeasured', kind: 'x', before: null, after: null, delta: null, unit: null }],
  images: { before: 'before.png', after: 'after.png' }, image_review: { by: 'sonnet-seat', at: '2026-10-04T01:06:00.000Z', notes: ['looks right'] }, observer_note: { text: 'OBSERVER-NOTE-1', by: 'hand' } });
W('compare/clean.json', rec('cmp-clean', false));
W('compare-dirty/dirty.json', rec('cmp-dirty', true));
fs.mkdirSync(path.join(F, 'compare-dirty'), { recursive: true });
fs.copyFileSync(path.join(F, 'compare', 'before.png'), path.join(F, 'compare-dirty', 'before.png')); fs.copyFileSync(path.join(F, 'compare', 'after.png'), path.join(F, 'compare-dirty', 'after.png'));
W('valid-record.json', rec('cmp-valid', false));
W('invalid-record.json', { ...rec('cmp-bad', false), verdict: 'PASS' });
W('decision.json', { question: 'DECISION-QUESTION-1', options: [{ label: 'opt A', consequence: 'consequence A' }, { label: 'opt B', consequence: 'consequence B' }, { label: 'opt C', consequence: 'consequence C' }], not_authorized: 'NOT-AUTH-1' });
JS
node "$SB/gen.js" "$F" || fail "fixture generator failed"
C3="$(node -e 'process.stdout.write(require(process.argv[1]).c3)' "$F/shas.json")"

cat > "$SB/sec.js" <<'JS'
const fs = require('fs'); const html = fs.readFileSync(process.argv[2], 'utf8'); const n = process.argv[3];
const m = html.match(new RegExp(`<section data-section="${n}"[\\s\\S]*?</section>`)); process.stdout.write(m ? m[0] : '');
JS
sec() { node "$SB/sec.js" "$1" "$2"; }

COMMON=(--job J1 --date 2026-10-04 --project abcdef0123456789 --now 2026-10-04T02:00:00.000Z --commit "$C3" --repo "$F/repo")
render() { # render <outfile> <args...>  -> rc in $RC
  local out="$1"; shift
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$R" "$@" --print > "$out" 2> "$out.err" < /dev/null; RC=$?
}

# ---- 1. full page: nine sections in order -------------------------------------------------------------------
P1="$SB/p1.html"
render "$P1" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-accepted.json" --progress-receipt "$F/progress-frozen.json" \
  --compare "$F/compare" --decision "$F/decision.json" "${COMMON[@]}"
assert_eq "$RC" "0" "renderer rc 0 on the full fixture (stderr: $(head -c 200 "$P1.err"))"
ORDER="$(grep -o 'data-section="[0-9]"' "$P1" | tr -d 'a-z="-' | tr -d '\n')"
assert_eq "$ORDER" "123456789" "nine sections present exactly once, in the fixed order"
assert_contains "$(cat "$P1")" "updated 2026-10-04T02:00:00.000Z @ $C3" "section 1: updated <published_at> @ <commit>"
S2="$(sec "$P1" 2)"
assert_contains "$S2" "accepted" "section 2 copies acceptance_verdict"
assert_contains "$S2" "需要你決定" "section 2 flags a needed decision when a decision file is given"
S3="$(sec "$P1" 3)"
assert_contains "$S3" "DECISION-QUESTION-1" "section 3 carries the question"
assert_contains "$S3" "consequence B" "section 3 carries each option consequence"
assert_contains "$S3" "NOT-AUTH-1" "section 3 carries what the decision does not authorize"
S4="$(sec "$P1" 4)"
assert_contains "$S4" "50%" "section 4: total percent from the frozen denominator (2 of 4)"
assert_contains "$S4" "規劃" "section 4 has a planned part"
assert_contains "$S4" "實際" "section 4 has an actual part"
S5="$(sec "$P1" 5)"
assert_contains "$S5" "SCENE-1" "section 5 lists the compare scene"
assert_contains "$S5" "0.25" "section 5 shows the delta from the record"
assert_contains "$S5" "sonnet-seat" "section 5 links the image review record"
S6="$(sec "$P1" 6)"
assert_contains "$S6" "執行狀態，不是進度" "section 6 labelled execution status, not progress"
assert_contains "$S6" "run-2" "section 6 lists a run of this root"
assert_not_contains "$S6" "run-other" "section 6 omits a run of another root"
S7="$(sec "$P1" 7)"
assert_contains "$S7" "MATCH" "section 7 shows a MATCH gate row"
S8="$(sec "$P1" 8)"
assert_contains "$S8" "<details" "section 8 is a details block"
S9="$(sec "$P1" 9)"
assert_contains "$S9" "這頁不主張的事" "section 9 states what the page does not claim"
assert_contains "$S9" "$F/runs.json" "section 9 lists the source path"
assert_contains "$S9" "$(sha256sum "$F/runs.json" | cut -d' ' -f1)" "section 9 lists the source sha256"

# ---- 2. relative URLs only ---------------------------------------------------------------------------------
BAD_URLS="$(grep -oE '(href|src)="[^"]*"' "$P1" | grep -vE '="(\.\./|\./|#|[A-Za-z0-9_-])' | grep -E '="(/|[A-Za-z][A-Za-z0-9+.-]*:)' | wc -l | tr -d ' ')"
assert_eq "$BAD_URLS" "0" "no absolute or scheme URL in any href/src"
assert_eq "$(grep -cE 'https?://|//cdn' "$P1")" "0" "no network reference in the page"
assert_contains "$(cat "$P1")" 'src="../assets/' "images use ../assets/<sha>.<ext>"

# ---- 3. determinism ----------------------------------------------------------------------------------------
P1B="$SB/p1b.html"
render "$P1B" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-accepted.json" --progress-receipt "$F/progress-frozen.json" \
  --compare "$F/compare" --decision "$F/decision.json" "${COMMON[@]}"
assert_eq "$(sha256sum < "$P1" | cut -d' ' -f1)" "$(sha256sum < "$P1B" | cut -d' ' -f1)" "fixed clock + same input -> byte-identical output"

# ---- 4. no manifest free text / receipt goal text ----------------------------------------------------------
assert_not_contains "$(cat "$P1")" "FREETEXT-SENTINEL" "manifest free-text fields never reach the page"
assert_not_contains "$(cat "$P1")" "GOAL-FREETEXT" "receipt goal text never reaches the page"

# ---- 5. execution axis + acceptance axis chips (A12 mapping) -----------------------------------------------
assert_contains "$S6" "RUNNING" "execution chip RUNNING (alive, fresh probe)"
assert_contains "$S6" "EXITED" "execution chip EXITED"
assert_contains "$S6" "UNKNOWN" "execution chip UNKNOWN"
assert_contains "$(sec "$P1" 2)" "ACCEPTED" "acceptance chip ACCEPTED (accepted + can_close)"
assert_not_contains "$(sec "$P1" 2)" "未收尾" "can_close=true carries no 未收尾 mark"

# ---- 6. index two-axis count line --------------------------------------------------------------------------
IDX="$(node -e '
const r = require(process.argv[1]);
const mk = (job, ex, acc) => ({ job, date: "2026-10-04", project: "abcdef0123456789", published_at: "2026-10-04T02:00:00.000Z", axes: { execution: ex, acceptance: acc }, needs_decision: false });
const html = r.renderProjectIndex([
  mk("j1", { running: 1, exited: 0, unknown: 0 }, "unknown"),
  mk("j2", { running: 0, exited: 2, unknown: 0 }, "accepted"),
  mk("j3", { running: 0, exited: 1, unknown: 1 }, "rejected"),
  mk("j4", { running: 0, exited: 0, unknown: 0 }, "unknown")]);
process.stdout.write(html);' "$R")"
assert_contains "$IDX" "執行 RUNNING 1 · EXITED 3 · UNKNOWN 1 ｜ 驗收 ACCEPTED 1 · REJECTED 1 · PENDING 2" "index first line: execution counts sum the runs, acceptance counts the jobs"
FIRSTLINE="$(printf '%s' "$IDX" | grep -n '執行 RUNNING' | head -1 | cut -d: -f1)"
assert_eq "$FIRSTLINE" "$(printf '%s' "$IDX" | grep -n 'RUNNING' | head -1 | cut -d: -f1)" "count line is the first RUNNING mention"
assert_not_contains "$IDX" 'href="/' "index links are relative"
assert_contains "$IDX" 'href="2026-10-04/j2/current/index.html"' "index row links relatively to the job page"

# ---- 7. negative controls ----------------------------------------------------------------------------------
P_A="$SB/pa.html"
render "$P_A" --runs "$F/runs-only-exited.json" --root R1 --task-receipt none "${COMMON[@]}"
assert_eq "$RC" "0" "rc=0 run, no receipt: renders"
assert_contains "$(sec "$P_A" 6)" "EXITED" "rc=0 + no receipt: execution axis EXITED"
assert_contains "$(sec "$P_A" 2)" "PENDING" "rc=0 + no receipt: acceptance axis PENDING"
assert_not_contains "$(cat "$P_A")" "ACCEPTED" "rc=0 + no receipt: never ACCEPTED anywhere"
assert_contains "$(sec "$P_A" 2)" "本回合尚無驗收 verdict；下表是執行狀態，不是進度" "no receipt: fixed sentence"
assert_contains "$(sec "$P_A" 4)" "分母未凍結" "no progress receipt: denominator not frozen"
assert_not_contains "$(sec "$P_A" 4)" "0%" "no progress receipt: percent never filled with 0"

P_B="$SB/pb.html"
render "$P_B" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-accepted.json" "${COMMON[@]}"
assert_not_contains "$(sec "$P_B" 7)" "wrongroot" "a PASS receipt from another root's ledger is absent"
assert_contains "$(sec "$P_B" 7)" "stale" "the old-candidate receipt is still listed"
assert_contains "$(sec "$P_B" 7)" "舊候選" "old-SHA PASS is marked 舊候選"
assert_contains "$(sec "$P_B" 7)" "branch differs" "receipt branch != manifest branch shows the display-only chip"
assert_contains "$(sec "$P_B" 7)" "CONFLICT" "two MATCH rows with different verdicts are both marked CONFLICT"
assert_eq "$(sec "$P_B" 7 | grep -o 'CONFLICT' | wc -l | tr -d ' ')" "2" "CONFLICT appears on both rows"

P_C="$SB/pc.html"
render "$P_C" --runs "$F/runs.json" --root R1 --task-receipt none "${COMMON[@]}"
assert_contains "$(sec "$P_C" 7)" "LIVE GATE · 未綁定候選" "no task receipt: gate rows are LIVE GATE · 未綁定候選"
assert_not_contains "$(sec "$P_C" 7)" "舊候選" "no candidate: nothing is marked old"
assert_contains "$(sec "$P_C" 7)" "stale" "no candidate: nothing hidden"
assert_not_contains "$(sec "$P_C" 7)" "wrongroot" "no candidate: still scoped to the job's ledgers"

P_D="$SB/pd.html"
render "$P_D" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-rejected.json" "${COMMON[@]}"
assert_contains "$(sec "$P_D" 2)" "rejected" "task rejected: the conclusion sentence says rejected"
assert_contains "$(sec "$P_D" 2)" "REJECTED" "task rejected: acceptance chip REJECTED"
assert_not_contains "$(cat "$P_D")" "ACCEPTED" "task rejected + review PASS rows: ACCEPTED never shown"
assert_contains "$(sec "$P_D" 7)" "PASS" "the review PASS row is still shown as that gate's result"

P_E="$SB/pe.html"
render "$P_E" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-noclose.json" "${COMMON[@]}"
assert_contains "$(sec "$P_E" 2)" "ACCEPTED · 未收尾" "accepted + can_close=false -> ACCEPTED · 未收尾"

P_W="$SB/pw.html"
render "$P_W" --runs "$F/runs.json" --root R1 --task-receipt "$F/task-wrongroot.json" "${COMMON[@]}"
assert_not_contains "$(cat "$P_W")" "ACCEPTED" "a task receipt of another root is ignored"
assert_contains "$(sec "$P_W" 2)" "本回合尚無驗收 verdict" "wrong-root task receipt -> no verdict sentence"

P_F="$SB/pf.html"
render "$P_F" --runs "$F/runs.json" --root R1 --task-receipt none --compare "$F/compare-dirty" "${COMMON[@]}"
assert_contains "$(sec "$P_F" 5)" "UNVERIFIED" "compare dirty:true -> UNVERIFIED chip"
assert_not_contains "$(sec "$P1" 5)" "UNVERIFIED" "clean compare record carries no UNVERIFIED chip"

P_G="$SB/pg.html"
render "$P_G" --runs "$F/runs.json" --root R1 --task-receipt none --progress-receipt "$F/progress-unfrozen.json" "${COMMON[@]}"
assert_contains "$(sec "$P_G" 4)" "分母未凍結 · 1 done" "unfrozen denominator: 分母未凍結 · n done"
assert_not_contains "$(sec "$P_G" 4)" "%" "unfrozen denominator: no percent at all"

# ---- 8. HTML escaping ---------------------------------------------------------------------------------------
P_H="$SB/ph.html"
render "$P_H" --runs "$F/runs-hostile.json" --root R1 --task-receipt none "${COMMON[@]}"
assert_eq "$RC" "0" "hostile fixture renders"
assert_not_contains "$(cat "$P_H")" "<script>alert(1)" "script tag is escaped"
assert_not_contains "$(cat "$P_H")" '"><img' "attribute-breaking value is escaped"
assert_contains "$(cat "$P_H")" "&lt;script&gt;alert(1)&lt;/script&gt;" "hostile role rendered as text"

# ---- 9. task receipt call is injectable and fail-honest ------------------------------------------------------
cat > "$SB/fake-task-ok.sh" <<SH
#!/usr/bin/env bash
[ "\$1 \$2 \$3 \$5" = "status task --root-run-id --json" ] || exit 9
cat "$F/task-accepted.json"
SH
cat > "$SB/fake-task-fail.sh" <<'SH'
#!/usr/bin/env bash
echo "task status: unavailable" >&2; exit 1
SH
chmod +x "$SB/fake-task-ok.sh" "$SB/fake-task-fail.sh"
P_I="$SB/pi.html"
AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/fake-task-ok.sh" render "$P_I" --runs "$F/runs.json" --root R1 "${COMMON[@]}"
assert_contains "$(sec "$P_I" 2)" "ACCEPTED" "status task is invoked as 'status task --root-run-id <id> --json' via the injected bin"
P_J="$SB/pj.html"
AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/fake-task-fail.sh" render "$P_J" --runs "$F/runs.json" --root R1 "${COMMON[@]}"
assert_eq "$RC" "0" "failing status task does not fail the render"
assert_contains "$(sec "$P_J" 2)" "PENDING" "failing status task -> PENDING (never accepted)"

# ---- 10. input shapes ---------------------------------------------------------------------------------------
P_K="$SB/pk.html"
render "$P_K" --runs "$F/runs-array.json" --root R1 --task-receipt none "${COMMON[@]}"
assert_eq "$RC" "0" "a bare status-runs --json array is accepted"
assert_contains "$(sec "$P_K" 6)" "run-2" "array input lists rows"
render "$SB/pl.html" --runs "$F/nope.json" --root R1 --task-receipt none "${COMMON[@]}"
assert_neq "$RC" "0" "missing --runs file fails"
render "$SB/pm.html" --root R1 "${COMMON[@]}"
assert_neq "$RC" "0" "missing --runs fails"

# ---- 11. compare-record schema ------------------------------------------------------------------------------
node "$SCHEMA_CHECK" --schema "$REPO_ROOT/schemas/compare-record.schema.json" --document "$F/valid-record.json" >/dev/null 2>&1
assert_eq "$?" "0" "valid compare-record validates"
node "$SCHEMA_CHECK" --schema "$REPO_ROOT/schemas/compare-record.schema.json" --document "$F/invalid-record.json" >/dev/null 2>&1
assert_neq "$?" "0" "a record with a verdict field is rejected (no verdict field in compare-record/1)"
assert_eq "$(grep -c '"verdict"' "$REPO_ROOT/schemas/compare-record.schema.json")" "0" "schema has no verdict property"

# ---- 12. isolation: nothing was written outside the sandbox -------------------------------------------------
assert_eq "$(find "$LIVE" -type f | wc -l | tr -d ' ')" "0" "renderer wrote nothing into the live dir"
assert_eq "$(find "$HOME/.autopilot" -type f | wc -l | tr -d ' ')" "0" "renderer wrote nothing under the fake HOME"

# ---- 13. publishing (row B1b): versioned job dirs, atomic current switch, indexes, assets, reap -----------------
REVIEW_HOME="$HOME/.autopilot/review"
T1="2026-10-04T02:00:00.000Z"; V1="v-20261004T020000.000Z"
T2="2026-10-04T02:05:00.000Z"; V2="v-20261004T020500.000Z"
T3="2026-10-04T02:10:00.000Z"; V3="v-20261004T021000.000Z"
pubr() { # pubr <project> <job> <now> [extra args...] -> RC, stdout in $PUB_OUT, stderr in $PUB_ERR
  local project="$1" job="$2" now="$3"; shift 3
  PUB_OUT="$SB/pub.out"; PUB_ERR="$SB/pub.err"
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none \
    --job "$job" --date 2026-10-04 --project "$project" --now "$now" --commit "$C3" --repo "$F/repo" "$@" > "$PUB_OUT" 2> "$PUB_ERR" < /dev/null; RC=$?
}
KA=aaaa000000000001
OA="$REVIEW_HOME/$KA"; JA="$OA/2026-10-04/J1"

pubr "$KA" J1 "$T1"
assert_eq "$RC" "0" "first publish rc 0 (stderr: $(head -c 200 "$PUB_ERR"))"
assert_eq "$(readlink "$JA/current")" "$V1" "first publish creates current -> v-<compact published_at>"
assert_eq "$(find "$JA" -maxdepth 1 -name 'current.tmp-*' | wc -l | tr -d ' ')" "0" "no current.tmp-* symlink left behind"
assert_contains "$(grep -o 'data-section="[0-9]"' "$JA/current/index.html" | tr -d 'a-z="-' | tr -d '\n')" "123456789" "the published page has all nine sections"
assert_contains "$(cat "$OA/index.html")" 'href="2026-10-04/J1/current/index.html"' "project index lists the job with a relative link"
assert_contains "$(cat "$REVIEW_HOME/index.html")" "$KA" "host root index lists the project"
assert_contains "$(cat "$REVIEW_HOME/index.html")" 'href="aaaa000000000001/index.html"' "root index links the project index relatively"
assert_contains "$(cat "$REVIEW_HOME/index.html")" "repo" "root index display name is the main worktree basename"
assert_eq "$([ -f "$LIVE/review/$KA.index.lock" ] && echo yes)" "yes" "project index lock lives under <live>/review/<project_key>.index.lock"
assert_eq "$([ -f "$LIVE/review/root-index.lock" ] && echo yes)" "yes" "host lock lives under <live>/review/root-index.lock"

pubr "$KA" J1 "$T2"
assert_eq "$RC" "0" "second publish rc 0"
assert_eq "$(readlink "$JA/current")" "$V2" "update points current at the new version"
assert_eq "$([ -f "$JA/$V1/index.html" ] && echo yes)" "yes" "the old version directory is kept"
assert_eq "$(grep -c 'J1/current/index.html' "$OA/index.html")" "1" "index still lists the job once after an update"

pubr "$KA" J1 "$T1"
assert_eq "$RC" "0" "publishing an older published_at is not an error"
assert_eq "$(readlink "$JA/current")" "$V2" "a slower, older publish never replaces a newer current"

SUM_BEFORE="$(sha256sum < "$OA/index.html")"
AUTOPILOT_REVIEW_FAIL_AT=before-switch pubr "$KA" J1 "$T3"
assert_neq "$RC" "0" "failure injected between smoke and switch fails the publish"
assert_eq "$(readlink "$JA/current")" "$V2" "after the injected failure current still points at the old version"
assert_eq "$([ -f "$JA/current/index.html" ] && echo yes)" "yes" "no dangling current symlink after the injected failure"
assert_eq "$(sha256sum < "$OA/index.html")" "$SUM_BEFORE" "the project index is unchanged after the injected failure"
assert_eq "$(wc -l < "$PUB_ERR" | tr -d ' ')" "1" "the failure prints exactly one stderr line"
assert_eq "$(find "$JA" -maxdepth 1 -name 'v-*.cand-*' | wc -l | tr -d ' ')" "1" "the candidate directory is left for the next publish"
pubr "$KA" J1 "$T3"
assert_eq "$RC" "0" "the next publish succeeds"
assert_eq "$(readlink "$JA/current")" "$V3" "the next publish switches to the newest version"
assert_eq "$(find "$JA" -maxdepth 1 -name 'v-*.cand-*' | wc -l | tr -d ' ')" "0" "the stale candidate is cleaned by the next publish"

# retention: previous generation kept AND >= 10 min after the switch (default); gone once the window is 0
assert_eq "$([ -d "$JA/$V1" ] && echo yes)" "yes" "a version older than previous is kept inside the 10 minute window"
AUTOPILOT_REVIEW_RETAIN_MS=0 pubr "$KA" J1 "2026-10-04T02:15:00.000Z"
assert_eq "$RC" "0" "publish with a zero retention window"
assert_eq "$([ -d "$JA/$V1" ] && echo yes || echo no)" "no" "older generations are deleted once the retention window has passed"
assert_eq "$([ -d "$JA/$V2" ] && echo yes || echo no)" "no" "the generation before previous is deleted too"
assert_eq "$([ -d "$JA/$V3" ] && echo yes)" "yes" "the previous version directory is always kept"

# two jobs, same project, concurrent: the project lock serialises; both rows present
BG_PIDS=""
KB=aaaa000000000002; OB="$REVIEW_HOME/$KB"
T0=$(date +%s%N)
AUTOPILOT_REVIEW_HOLD_MS=700 pubr "$KB" JC1 "$T1" & BG_PIDS="$BG_PIDS $!"
P1PID=$!
AUTOPILOT_REVIEW_HOLD_MS=700 env -u AUTOPILOT_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none --job JC2 --date 2026-10-04 \
  --project "$KB" --now "$T2" --commit "$C3" --repo "$F/repo" > "$SB/pc2.out" 2> "$SB/pc2.err" < /dev/null & BG_PIDS="$BG_PIDS $!"
P2PID=$!
wait "$P1PID"; wait "$P2PID"
ELAPSED_MS=$(( ($(date +%s%N) - T0) / 1000000 ))
BG_PIDS=""
assert_contains "$(cat "$OB/index.html")" "JC1/current/index.html" "concurrent publish: first job row present"
assert_contains "$(cat "$OB/index.html")" "JC2/current/index.html" "concurrent publish: second job row present"
[ "$ELAPSED_MS" -ge 1300 ] && assert_eq "serialised" "serialised" "two held publishes ran one after the other (${ELAPSED_MS} ms)" \
  || assert_eq "$ELAPSED_MS" ">=1300" "two publishes holding the lock 700 ms each must serialise"

# two projects publishing concurrently: root index has both
KC=aaaa000000000003; KD=aaaa000000000004
AUTOPILOT_REVIEW_HOLD_MS=500 env -u AUTOPILOT_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none --job JP --date 2026-10-04 \
  --project "$KC" --now "$T1" --commit "$C3" --repo "$F/repo" > "$SB/pk1.out" 2> "$SB/pk1.err" < /dev/null & BG_PIDS="$BG_PIDS $!"
Q1=$!
AUTOPILOT_REVIEW_HOLD_MS=500 env -u AUTOPILOT_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none --job JQ --date 2026-10-04 \
  --project "$KD" --now "$T1" --commit "$C3" --repo "$F/repo" > "$SB/pk2.out" 2> "$SB/pk2.err" < /dev/null & BG_PIDS="$BG_PIDS $!"
Q2=$!
wait "$Q1"; wait "$Q2"; BG_PIDS=""
assert_contains "$(cat "$REVIEW_HOME/index.html")" "$KC" "concurrent projects: root index lists the first project"
assert_contains "$(cat "$REVIEW_HOME/index.html")" "$KD" "concurrent projects: root index lists the second project"
assert_contains "$(cat "$REVIEW_HOME/index.html")" "$KA" "root index still lists earlier projects"

# assets: content-addressed copy, shared by versions, relative URL; missing original is named, not broken
KE=aaaa000000000005; OE="$REVIEW_HOME/$KE"; JE="$OE/2026-10-04/J1"
pubr "$KE" J1 "$T1" --compare "$F/compare"
BEFORE_SHA="$(sha256sum "$F/compare/before.png" | cut -c1-12)"
assert_eq "$RC" "0" "publish with a compare record"
assert_eq "$(cmp "$F/compare/before.png" "$JE/assets/$BEFORE_SHA.png" && echo same)" "same" "image copied to assets/<sha256 first 12>.png"
assert_contains "$(cat "$JE/current/index.html")" "../assets/$BEFORE_SHA.png" "page references ../assets/<sha>.<ext>"
N_ASSETS="$(find "$JE/assets" -type f | wc -l | tr -d ' ')"
pubr "$KE" J1 "$T2" --compare "$F/compare"
assert_eq "$(find "$JE/assets" -type f | wc -l | tr -d ' ')" "$N_ASSETS" "assets are shared by all versions (no copy per version)"
mkdir -p "$F/compare-missing"; cp "$F/compare/clean.json" "$F/compare-missing/clean.json"; cp "$F/compare/after.png" "$F/compare-missing/after.png"
KF=aaaa000000000006
pubr "$KF" J1 "$T1" --compare "$F/compare-missing"
assert_eq "$RC" "0" "publish with a missing original image still succeeds"
assert_contains "$(cat "$REVIEW_HOME/$KF/2026-10-04/J1/current/index.html")" "asset missing · sha256 $(sha256sum "$F/compare/before.png" | cut -d' ' -f1)" "missing original: asset missing · sha256 <declared>"

# reap: old jobs and unreferenced assets go; recent stay
KG=aaaa000000000007; OG="$REVIEW_HOME/$KG"
mkdir -p "$F/compare-new"; cp "$F/compare/clean.json" "$F/compare-new/clean.json"; cp "$F/compare/after.png" "$F/compare-new/after.png"
printf 'distinct-bytes' > "$F/compare-new/before.png"
node -e '
const fs=require("fs"),c=require("crypto");const d=process.argv[1];const p=d+"/clean.json";const r=JSON.parse(fs.readFileSync(p));
r.before.sha256=c.createHash("sha256").update(fs.readFileSync(d+"/before.png")).digest("hex");fs.writeFileSync(p,JSON.stringify(r));' "$F/compare-new"
pubr "$KG" JOLD "2026-01-01T00:00:00.000Z" --compare "$F/compare"
pubr "$KG" JMIX "2026-06-01T00:00:00.000Z" --compare "$F/compare"
pubr "$KG" JMIX "2026-10-03T00:00:00.000Z" --compare "$F/compare-new"
NEW_SHA="$(sha256sum "$F/compare-new/before.png" | cut -c1-12)"
assert_eq "$([ -f "$OG/2026-10-04/JMIX/assets/$BEFORE_SHA.png" ] && echo yes)" "yes" "reap fixture: the old version's asset exists before reap"
env -u AUTOPILOT_SESSION_ID node "$R" --reap --days 90 --now 2026-10-04T00:00:00.000Z --project "$KG" > "$SB/reap.out" 2> "$SB/reap.err" < /dev/null; RC=$?
assert_eq "$RC" "0" "reap rc 0 (stderr: $(head -c 200 "$SB/reap.err"))"
assert_eq "$([ -d "$OG/2026-10-04/JOLD" ] && echo yes || echo no)" "no" "reap removes a job whose versions are all older than N days"
assert_eq "$([ -d "$OG/2026-10-04/JMIX" ] && echo yes)" "yes" "reap keeps a job with a recent version"
assert_eq "$([ -d "$OG/2026-10-04/JMIX/v-20260601T000000.000Z" ] && echo yes || echo no)" "no" "reap removes an old version of a retained job"
assert_eq "$([ -f "$OG/2026-10-04/JMIX/assets/$BEFORE_SHA.png" ] && echo yes || echo no)" "no" "reap removes an asset no retained version references"
assert_eq "$([ -f "$OG/2026-10-04/JMIX/assets/$NEW_SHA.png" ] && echo yes)" "yes" "reap keeps an asset a retained version references"
assert_not_contains "$(cat "$OG/index.html")" "JOLD" "reap regenerates the project index without the reaped job"
assert_contains "$(cat "$OG/index.html")" "JMIX" "reap keeps the retained job in the index"

# --serve-stop calls the review server module (no server running here)
env -u AUTOPILOT_SESSION_ID node "$R" --serve-stop > "$SB/ss.out" 2> "$SB/ss.err" < /dev/null; RC=$?
assert_eq "$RC" "0" "--serve-stop rc 0 when no server runs"
assert_contains "$(cat "$SB/ss.out")" "not_running" "--serve-stop reports the stopReviewServer status"

# ---- 14. B1a review follow-ups ----------------------------------------------------------------------------------
render "$SB/fu1.html" --runs "$F/runs.json" --root R1 --task-receipt "$F/no-such-task.json" "${COMMON[@]}"
assert_eq "$RC" "0" "missing --task-receipt path: page still renders"
assert_contains "$(cat "$SB/fu1.html.err")" "$F/no-such-task.json" "missing --task-receipt path: one stderr line names it"
assert_contains "$(sec "$SB/fu1.html" 2)" "PENDING" "missing --task-receipt path: acceptance stays PENDING"
printf '{not json' > "$F/bad-progress.json"
render "$SB/fu2.html" --runs "$F/runs.json" --root R1 --task-receipt none --progress-receipt "$F/bad-progress.json" "${COMMON[@]}"
assert_contains "$(cat "$SB/fu2.html.err")" "$F/bad-progress.json" "malformed --progress-receipt: stderr names it"
render "$SB/fu3.html" --runs "$F/runs.json" --root R1 --task-receipt none --decision "$F/no-decision.json" "${COMMON[@]}"
assert_contains "$(cat "$SB/fu3.html.err")" "$F/no-decision.json" "missing --decision path: stderr names it"
render "$SB/fu4.html" --runs "$F/runs.json" --root R1 --task-receipt none --planned "$F/no-planned.json" "${COMMON[@]}"
assert_contains "$(cat "$SB/fu4.html.err")" "$F/no-planned.json" "missing --planned path: stderr names it"
env -u AUTOPILOT_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none --job J1 --date 2026-10-04 --project abcdef0123456789 --now not-a-date --print > "$SB/fu5.out" 2> "$SB/fu5.err" < /dev/null; RC=$?
assert_eq "$RC" "2" "unparseable --now: rc 2"
assert_contains "$(cat "$SB/fu5.err")" "not-a-date" "unparseable --now: the message names the value"
AUTOPILOT_REVIEW_NOW=garbage env -u AUTOPILOT_SESSION_ID node "$R" --runs "$F/runs.json" --root R1 --task-receipt none --job J1 --date 2026-10-04 --project abcdef0123456789 --print > "$SB/fu6.out" 2> "$SB/fu6.err" < /dev/null; RC=$?
assert_eq "$RC" "2" "unparseable AUTOPILOT_REVIEW_NOW: rc 2, no silent wall-clock fallback"
mkdir -p "$F/compare-bad"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));r.before=5;require("fs").writeFileSync(process.argv[2],JSON.stringify(r));' "$F/compare/clean.json" "$F/compare-bad/bad.json"
render "$SB/fu7.html" --runs "$F/runs.json" --root R1 --task-receipt none --compare "$F/compare-bad" "${COMMON[@]}"
assert_eq "$RC" "0" "compare record whose before is not an object does not crash the renderer"
assert_contains "$(sec "$SB/fu7.html" 5)" "not a valid compare-record" "compare record whose before is not an object is reported unusable"

finalize_test
