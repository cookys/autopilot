#!/usr/bin/env bash
# hooks/tests/p2-batch-wrapper.test.sh - BL-0055 phase 2, wrapper v2 (evals/orchestration/run-p2-batch.js): NC5 and NC8,
# plus the selfcheck, the seeded order and the cost stop rule. No model call: a fake `claude` (fixtures/p2-fake-claude.sh)
# stands in for the CLI, the real harness and the real hook run against it in a throwaway git clone.
# Negative controls (evidence-discipline section 58): each check below must hold for the real wrapper and FAIL for a mutant
# of it. The mutation tool fails when its pattern matches nothing, so there is no no-op mutant.
#   NC5: --audit stubbed to return no failures -> the "exit non-zero" assertion fails for each of three corrupted runs.
#   NC8: post-batch listing removed -> the "TASKHASH_DIFF post fail" assertion fails (the audit still catches the absent
#        taskhash.post.txt on its own, so its own non-zero assertion stays green: defence in depth, not a second red).
#   selfcheck: a writer call removed -> --selfcheck exits non-zero.
# RED at develop 1ce92330d: the wrapper did not exist (node: Cannot find module run-p2-batch.js).
. "$(dirname "$0")/lib.sh"

WRAP_SRC="$REPO_ROOT/evals/orchestration/run-p2-batch.js"
FAKE="$HOOKS_DIR/tests/fixtures/p2-fake-claude.sh"
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"; cp "$FAKE" "$BIN/claude"; chmod +x "$BIN/claude"
FHOME="$TEST_TMP/home"; mkdir -p "$FHOME/.claude"; echo '{}' >"$FHOME/.claude/.credentials.json"

mutate() { # <file> <old> <new>: fails when <old> is absent
  python3 - "$1" "$2" "$3" <<'PY' || return 1
import sys
p, old, new = sys.argv[1:4]
f = open(p).read()
if old not in f:
    sys.stderr.write('mutant pattern matched nothing: ' + old + '\n'); raise SystemExit(1)
open(p, 'w').write(f.replace(old, new, 1))
PY
}

# Throwaway clone with the pieces the harness and the hook need, one commit holding the preregistration files.
CLONE="$TEST_TMP/clone"; mkdir -p "$CLONE/hooks" "$CLONE/scripts" "$CLONE/prereg"
cp -a "$REPO_ROOT/evals" "$CLONE/evals"; rm -rf "$CLONE/evals/orchestration/runs"
cp "$REPO_ROOT/hooks/per-turn-gate.js" "$CLONE/hooks/"; cp -a "$REPO_ROOT/hooks/_shared" "$CLONE/hooks/_shared"
cp -a "$REPO_ROOT/scripts/lib" "$CLONE/scripts/lib"; cp "$REPO_ROOT/scripts/adjudicate-findings.js" "$CLONE/scripts/"
TASKDIR="$CLONE/evals/orchestration/tasks/t14-constraint-horizon"
node -e 'const w=require(process.argv[1]);require("fs").writeFileSync(process.argv[3],w.taskListing(process.argv[2]))' "$WRAP_SRC" "$TASKDIR" "$CLONE/prereg/taskhash.expected.txt"
echo "preregistration stand-in" >"$CLONE/prereg/PREREG.md"
git -C "$CLONE" init -q; git -C "$CLONE" config user.name t; git -C "$CLONE" config user.email t@example.com; git -C "$CLONE" config commit.gpgsign false
make_manifest() { # <wrapper> <out>
  node - "$1" "$2" "$CLONE" "$WRAP_SRC" <<'JS'
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const [wrapper, out, clone, src] = process.argv.slice(2);
const w = require(src);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const m = { task: 't14-constraint-horizon', model: 'claude-haiku-4-5', cli: '2.1.309 (Claude Code)', seed: 'unit-test-seed', n_per_arm: 3,
  arms: { ON: { gate: 'hook', cap: 31 }, C: { gate: 'observe', cap: 17 } }, probe_cost: 0.0166, window_s: 28800, min_complete: 2, max_blocks: 2,
  prereg: 'prereg/PREREG.md', taskhash_expected: 'prereg/taskhash.expected.txt', hook_path: 'hooks/per-turn-gate.js',
  harness_path: 'evals/orchestration/run-orchestration-eval.sh', argv_sha: {},
  hashes: { wrapper: sha(wrapper), hook: sha(path.join(clone, 'hooks/per-turn-gate.js')), harness: sha(path.join(clone, 'evals/orchestration/run-orchestration-eval.sh')) } };
for (const arm of ['ON', 'C']) m.argv_sha[arm] = w.argvSha(w.harnessArgv(m, arm, '<o>', '<t>'), '<o>', '<t>');
fs.writeFileSync(out, JSON.stringify(m, null, 2));
JS
}

WRAP="$TEST_TMP/real/run-p2-batch.js"; mkdir -p "$(dirname "$WRAP")"; cp "$WRAP_SRC" "$WRAP"
AUD_MUT="$TEST_TMP/mut-audit/run-p2-batch.js"; mkdir -p "$(dirname "$AUD_MUT")"; cp "$WRAP_SRC" "$AUD_MUT"
mutate "$AUD_MUT" "function audit(runDir, m, clone, opts) {" "function audit(runDir, m, clone, opts) { return [];" || fail "audit mutant could not be built"
POST_MUT="$TEST_TMP/mut-post/run-p2-batch.js"; mkdir -p "$(dirname "$POST_MUT")"; cp "$WRAP_SRC" "$POST_MUT"
mutate "$POST_MUT" "try { W.writeTaskHash(ctx, 'post'); } catch (e) {" "try { /* post listing removed */ } catch (e) {" || fail "post mutant could not be built"
# manifests live inside the clone and are committed with the preregistration stand-in (the wrapper requires that)
MAN="$CLONE/prereg/manifest.json"; make_manifest "$WRAP" "$MAN"
MAN_MUT="$CLONE/prereg/manifest-audit-mutant.json"; make_manifest "$AUD_MUT" "$MAN_MUT"
MAN_POST="$CLONE/prereg/manifest-post-mutant.json"; make_manifest "$POST_MUT" "$MAN_POST"
git -C "$CLONE" add -A
# plumbing commit: no commit hooks run in the throwaway clone
TREE=$(git -C "$CLONE" write-tree); COMMIT=$(git -C "$CLONE" commit-tree "$TREE" -m prereg); git -C "$CLONE" update-ref HEAD "$COMMIT"

FAKE_STATE_DIR="$TEST_TMP/fakestate"
run_batch() { # <wrapper> <manifest> <rundir>; FAKE_TASK_EDIT optional
  rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 FAKE_TASK_EDIT="${FAKE_TASK_EDIT:-}" ORCH_TIMEOUT=1m \
    node "$1" --run --manifest "$2" --run-dir "$3" --clone "$CLONE" >"$3.stdout" 2>"$3.stderr"
}

echo "--- seeded order, cost rule, selfcheck"
O1=$(node "$WRAP" --order --manifest "$MAN"); O2=$(node "$WRAP" --order --manifest "$MAN")
assert_eq "$O1" "$O2" "the seeded order is reproducible"
assert_eq "$(echo "$O1" | wc -l | tr -d ' ')" 6 "order has 2 x n_per_arm ids"
assert_eq "$(echo "$O1" | sed -n '1,2p' | sed 's/^[0-9]* //' | sed 's/-.*//' | sort | tr '\n' ' ')" "C ON " "first pair holds one id of each arm"
node -e '
const w=require(process.argv[1]); const eq=(a,b,m)=>{ if(a!==b){console.error("FAIL "+m+": "+a+" vs "+b);process.exit(1)} };
const base={total:30,cap:17,probeCost:0.0166};
let p=w.projectCost({...base,runCosts:[0.5,0.5,0.5,0.5],probeSpent:0.07}); eq(p.stage,"pre5","stage before five"); eq(p.stop,false,"no projection before five");
p=w.projectCost({...base,runCosts:[0.5,0.5,0.5,0.5,0.5],probeSpent:0.083}); eq(p.stage,"post5","stage after five"); eq(p.stop,false,"flat 0.5 costs stay under the cap");
p=w.projectCost({...base,runCosts:[0.5,0.7,0.5,0.7,0.5],probeSpent:0.083}); eq(p.stop,true,"noisy costs push the projection over the cap");
' "$WRAP" || fail "projectCost checks"
SC_OUT=$(node "$WRAP" --selfcheck 2>&1); SC_RC=$?
assert_eq "$SC_RC" 0 "selfcheck exits 0"
assert_contains "$SC_OUT" "SELFCHECK OK: every row has a writer" "selfcheck verdict"
assert_eq "$(echo "$SC_OUT" | grep -c '^row [0-9]* .*: written')" 14 "selfcheck: all 14 rows written"
SC_MUT="$TEST_TMP/mut-selfcheck/run-p2-batch.js"; mkdir -p "$(dirname "$SC_MUT")"; cp "$WRAP_SRC" "$SC_MUT"
mutate "$SC_MUT" "  W.writeBlockMax(ctx, id, recs);" "" || fail "selfcheck mutant could not be built"
if node "$SC_MUT" --selfcheck >/dev/null 2>&1; then fail "selfcheck mutant (writeBlockMax call removed) still exits 0"; else echo "RED selfcheck: mutant exits non-zero"; fi

echo "--- valid batch"
R1="$TEST_TMP/run-valid"
run_batch "$WRAP" "$MAN" "$R1"; assert_eq "$?" 0 "valid batch: wrapper exits 0"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$R1" --clone "$CLONE" >"$TEST_TMP/audit-valid.out"; assert_eq "$?" 0 "valid batch: audit exits 0 ($(tail -3 "$TEST_TMP/audit-valid.out" | tr '\n' ';'))"
assert_eq "$(grep -c ' START ' "$R1/invocation.log")" 6 "six START lines"
assert_eq "$(grep -c 'BLOCKMAX ON-.* 1$' "$R1/invocation.log")" 3 "each ON run shows a one-block turn"
assert_eq "$(grep -c 'HOOKCOUNT C-.* gate_trace=0 gate_log=0' "$R1/invocation.log")" 3 "control runs show no gate hook"
assert_not_contains "$(cat "$R1/invocation.log")" "$TEST_TMP" "log carries no scratch path"

echo "--- NC5 audit"
corrupt() { # <name> <rundir copy>
  case "$1" in
    truncated) python3 - "$2/invocation.log" <<'PY'
import sys
p = sys.argv[1]; lines = open(p).read().split('\n')
idx = max(i for i, l in enumerate(lines) if ' END ' in l); del lines[idx]
open(p, 'w').write('\n'.join(lines))
PY
    ;;
    notaskpost) rm -f "$2/taskhash.post.txt" ;;
    dupstart) python3 - "$2/invocation.log" <<'PY'
import sys
p = sys.argv[1]; lines = open(p).read().split('\n')
idx = next(i for i, l in enumerate(lines) if ' START ' in l); lines.insert(idx + 1, lines[idx])
open(p, 'w').write('\n'.join(lines))
PY
    ;;
  esac
}
for c in truncated notaskpost dupstart; do
  RC="$TEST_TMP/run-$c"; cp -a "$R1" "$RC"; corrupt "$c" "$RC"
  node "$WRAP" --audit --manifest "$MAN" --run-dir "$RC" --clone "$CLONE" >/dev/null; real_rc=$?
  node "$AUD_MUT" --audit --manifest "$MAN_MUT" --run-dir "$RC" --clone "$CLONE" >/dev/null; mut_rc=$?
  assert_neq "$real_rc" 0 "NC5 green: real audit exits non-zero for $c"
  assert_eq "$mut_rc" 0 "NC5 red: the stubbed audit exits 0 for $c, so the non-zero assertion would fail"
  echo "NC5 $c: real audit rc=$real_rc, stubbed audit rc=$mut_rc"
done

echo "--- NC8 task integrity"
nc8() { # <wrapper> <manifest> <rundir>: 0 when an edited task file leaves a TASKHASH_DIFF post fail line and a non-zero audit
  FAKE_TASK_EDIT="$TASKDIR/task.md" run_batch "$1" "$2" "$3"
  git -C "$CLONE" checkout -q -- evals/orchestration/tasks 2>/dev/null
  local fail_line audit_rc
  fail_line=$(grep -c 'TASKHASH_DIFF post fail' "$3/invocation.log" 2>/dev/null || true)
  node "$1" --audit --manifest "$2" --run-dir "$3" --clone "$CLONE" >/dev/null; audit_rc=$?
  echo "nc8: post-fail lines=$fail_line audit rc=$audit_rc"
  [ "${fail_line:-0}" -ge 1 ] && [ "$audit_rc" -ne 0 ]
}
if nc8 "$WRAP" "$MAN" "$TEST_TMP/run-nc8-real"; then echo "NC8 green: real wrapper records TASKHASH_DIFF post fail and the audit fails"; else fail "NC8: real wrapper did not catch the edited task file"; fi
if nc8 "$POST_MUT" "$MAN_POST" "$TEST_TMP/run-nc8-mut"; then fail "NC8 mutant (no post listing) passed: the control cannot go red"; else echo "NC8 red: wrapper without the post listing writes no TASKHASH_DIFF post fail"; fi
assert_eq "$(grep -c 'TASKHASH_DIFF post fail' "$TEST_TMP/run-nc8-mut/invocation.log" 2>/dev/null || true)" 0 "NC8 red: mutant leaves no post fail line"
assert_file_absent "$TEST_TMP/run-nc8-mut/taskhash.post.txt"

finalize_test
