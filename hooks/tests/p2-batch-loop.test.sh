#!/usr/bin/env bash
# hooks/tests/p2-batch-loop.test.sh - BL-0055 P2-3: credential source and expiry, the auto-resume launcher, environment scrub, models other than haiku-4-5, rerun preregistrations. Fake claude only.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib-p2.sh"

echo "--- credential source, launcher, environment, model"
RX="$TEST_TMP/run-expiring"
RUN_ARGS="--credentials-source $TEST_TMP/cred-soon.json" run_batch "$WRAP" "$MAN" "$RX"; assert_eq "$?" 7 "source token 5 minutes from expiry: the first id pauses (exit 7)"
assert_file_absent "$RX/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
assert_eq "$(grep -c ' PROBE_FAIL ' "$RX/invocation.log")" 1 "expiring source: one PROBE_FAIL row"
assert_contains "$(cat "$RX"/probes/*-1.json)" "source_token_expiring" "expiring source: the saved response names the reason"
RUN_ARGS="--credentials-source $TEST_TMP/cred-fresh.json" KEEP_STATE=1 run_batch "$WRAP" "$MAN" "$RX"; assert_eq "$?" 0 "fresh source: the paused batch resumes and completes"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RX" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rx-audit.out" 2>&1; assert_eq "$?" 0 "paused-on-expiry then resumed batch: audit OK ($(head -c 150 "$TEST_TMP/rx-audit.out"))"
RUN_ARGS="--credentials-source $TEST_TMP/cred-soon.json" run_batch "$TEST_TMP/mut-noexpiry/run-p2-batch.js" "$MAN_NOEXP" "$TEST_TMP/run-noexp"; assert_neq "$?" 7 "RED expiring source: the mutant without the expiry check does not pause"
RL1="$TEST_TMP/run-loop1"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop.json"
( sleep 2; mkcred "$TEST_TMP/cred-loop.json" 120 ) &
loop_run "$RL1" "$TEST_TMP/cred-loop.json"; assert_eq "$?" 0 "launcher: pause on an expiring source, restart once the source is fresh, batch completes"
wait
assert_contains "$(cat "$RL1/loop.status")" "ended rc=0" "launcher: final status line"
assert_eq "$(grep -c ' PAUSE ' "$RL1/invocation.log")" 1 "launcher: one pause was written"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RL1" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rl1-audit.out" 2>&1; assert_eq "$?" 0 "launcher batch: audit OK ($(head -c 150 "$TEST_TMP/rl1-audit.out"))"
# window nearly used up: stops instead of restarting
RL2="$TEST_TMP/run-loop2"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop2.json"
loop_run "$RL2" "$TEST_TMP/cred-loop2.json" --min-window-s 999999; assert_eq "$?" 9 "launcher: window left below the minimum: stops with exit 9"
assert_contains "$(cat "$RL2/loop.status")" "window_exhausted" "launcher: status says the window is exhausted"
assert_file_absent "$RL2/invocation.log"
assert_contains "$(cat "$RL2/loop.status")" "left_s=" "launcher: the window check runs before the first start too (no wrapper was started)"
# a wrapper exit other than 7 is final
RL3="$TEST_TMP/run-loop3"; mkdir -p "$RL3/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
loop_run "$RL3" "$TEST_TMP/cred-fresh.json"; LRC=$?
assert_neq "$LRC" 0 "launcher: a wrapper refusal ends the loop non-zero"
assert_contains "$(cat "$RL3/loop.status")" "ended rc=" "launcher: the status records the final rc"
assert_eq "$(grep -c ' WRAPPER_START ' "$RL3/invocation.log")" 1 "launcher: no second run after a non-7 exit"
# restart limit
RL4="$TEST_TMP/run-loop4"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop4.json"
loop_run "$RL4" "$TEST_TMP/cred-loop4.json" --fresh-min 0 --max-restarts 1; assert_eq "$?" 9 "launcher: restart limit reached: exit 9"
assert_contains "$(cat "$RL4/loop.status")" "restart_limit" "launcher: status says the restart limit"
# negative controls for the launcher: a copy that ignores the window, and one that restarts after any exit code
mkdir -p "$TEST_TMP/mut-loopwin" "$TEST_TMP/mut-loopany"; cp "$LOOP" "$TEST_TMP/mut-loopwin/l.js"; cp "$LOOP" "$TEST_TMP/mut-loopany/l.js"
sed -i '/windowLeftS() < Number/d' "$TEST_TMP/mut-loopwin/l.js"
mutate "$TEST_TMP/mut-loopany/l.js" "if (rc !== 7) {" "if (rc === 0) {" || fail "loopany mutant"
RL5="$TEST_TMP/run-loop5"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-loop5.json"
LOOP="$TEST_TMP/mut-loopwin/l.js" loop_run "$RL5" "$TEST_TMP/cred-loop5.json" --min-window-s 999999 --fresh-min 0 --max-restarts 1 >/dev/null 2>&1
assert_eq "$(grep -c ' WRAPPER_START ' "$RL5/invocation.log")" 2 "RED window: the launcher without the window check restarts although the window is short"
RL6="$TEST_TMP/run-loop6"; mkdir -p "$RL6/runs/$(echo "$O1" | sed -n 1p | cut -d' ' -f2)"
LOOP="$TEST_TMP/mut-loopany/l.js" loop_run "$RL6" "$TEST_TMP/cred-fresh.json" --fresh-min 0 --max-restarts 1 >/dev/null 2>&1
assert_eq "$(grep -c ' WRAPPER_START ' "$RL6/invocation.log")" 2 "RED exit code: the launcher that restarts after any exit code runs the wrapper twice"
# window short before the very first start
winstart() { node -e 'require("fs").writeFileSync(process.argv[1], String(Date.now() - (28800 - Number(process.argv[2])) * 1000) + "\n")' "$1" "$2"; }
RW="$TEST_TMP/run-loopw"; mkdir -p "$RW"; winstart "$RW/window.start" 599
loop_run "$RW" "$TEST_TMP/cred-fresh.json"; assert_eq "$?" 9 "launcher: 599 s of window left before the first start: exit 9"
assert_file_absent "$RW/invocation.log"
RW2="$TEST_TMP/run-loopw-mut"; mkdir -p "$RW2"; winstart "$RW2/window.start" 599
LOOP="$TEST_TMP/mut-loopwin/l.js" loop_run "$RW2" "$TEST_TMP/cred-fresh.json" --max-restarts 0 >/dev/null 2>&1
assert_eq "$([ -f "$RW2/invocation.log" ] && echo y)" y "RED: the launcher without the pre-start window check starts the wrapper anyway"
# a model other than haiku-4-5 follows the manifest everywhere
R55="$TEST_TMP/run-m55"; FAKE_MODEL=claude-haiku-5-5 run_batch "$WRAP" "$MAN_M55" "$R55"; assert_eq "$?" 0 "manifest model claude-haiku-5-5: the batch completes"
assert_contains "$(cat "$R55"/cmd/ON-*.json | head -1)" "claude-haiku-5-5" "harness argv carries the manifest model"
assert_eq "$(grep -c ' MODEL .* claude-haiku-5-5$' "$R55/invocation.log")" 6 "MODEL rows carry the resolved haiku-5-5 id"
node "$WRAP" --audit --manifest "$MAN_M55" --run-dir "$R55" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/r55-audit.out" 2>&1; assert_eq "$?" 0 "haiku-5-5 batch: audit OK ($(head -c 150 "$TEST_TMP/r55-audit.out"))"
# the preregistrations of the batches stay in step with the wrapper and with their own manifest: wrapper hash, generated appendix,
# seeded order, and every hash prefix, cost cap, probe cost, model name and seed in the text against the manifest of the same batch
EVD="$REPO_ROOT/docs/plans/evidence"
prereg_in_step() { # <dir> <foreign dir>... -> prints ok or the first problems
  node -e '
const fs=require("fs"),c=require("crypto"),path=require("path");const [d,src,...foreign]=process.argv.slice(1);
const sha=(f)=>c.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const w=require(src),m=JSON.parse(fs.readFileSync(d+"/manifest.json","utf8")),text=fs.readFileSync(d+"/PREREG.md","utf8");
const bad=[];const strs=(o)=>Object.values(o).flatMap((v)=>typeof v==="string"?[v]:v&&typeof v==="object"?strs(v):[]);
if(m.hashes.wrapper!==sha(src))bad.push("manifest wrapper hash differs from the wrapper");
if(!text.includes(w.schemaTable()))bad.push("appendix differs");
const o=w.makeOrder(m.seed,m.n_per_arm).map((x,i)=>(i+1)+" "+x.id).join("\n")+"\n";if(o!==fs.readFileSync(d+"/order.txt","utf8"))bad.push("order differs");
const ownHex=[...strs(m),sha(d+"/manifest.json"),sha(d+"/order.txt"),sha(d+"/selfcheck.out"),sha(d+"/taskhash.expected.txt")];
const fm=foreign.map((f)=>JSON.parse(fs.readFileSync(f+"/manifest.json","utf8")));
const foreignHex=[...fm.flatMap((x)=>strs(x)),...foreign.flatMap((f)=>[sha(f+"/manifest.json"),sha(f+"/order.txt")])];
for(const tok of new Set(text.match(/\b[0-9a-f]{8,64}\b/g)||[])){if(!ownHex.some((h)=>h.startsWith(tok))&&foreignHex.some((h)=>h.startsWith(tok)))bad.push("hash "+tok+" belongs to another batch");}
if(!text.includes(sha(d+"/manifest.json")))bad.push("PREREG does not state the manifest sha256");
const cap=`C arm ${m.arms.C.cap} USD, ON arm ${m.arms.ON.cap} USD`;if(!text.includes(cap))bad.push("caps sentence missing: "+cap);
for(const x of fm)for(const k of ["C","ON"]){const v=x.arms[k].cap;if(v!==m.arms[k].cap&&new RegExp("\\b"+v+" USD").test(text))bad.push("cap "+v+" USD of another batch");}
if(m.arms.ON.cap<10&&/\b(48|17|31) USD/.test(text))bad.push("a cap figure of the first design (48/17/31 USD)");
if(!text.includes(String(m.probe_cost)))bad.push("probe_cost "+m.probe_cost+" missing");
for(const x of fm)if(x.probe_cost!==m.probe_cost&&text.includes(String(x.probe_cost)))bad.push("probe cost "+x.probe_cost+" of another batch");
if(!text.includes(m.model))bad.push("model "+m.model+" missing");
for(const x of fm)if(x.model!==m.model&&text.includes(x.model))bad.push("model "+x.model+" of another batch");
if(!text.includes(m.seed))bad.push("seed missing");
for(const x of [...fm.map((q)=>q.seed),"ptg-p2-3-order-2026-10-24"])if(x!==m.seed&&text.includes(x))bad.push("seed "+x+" of another batch");
console.log(bad.length?bad.join("; "):"ok")' "$@"
}
P1="$EVD/2026-10-24-per-turn-gate-p2-3"; PR="$EVD/2026-10-25-per-turn-gate-p2-3r"; PH="$EVD/2026-10-25-per-turn-gate-p2-3-h55"; P2="$EVD/2026-10-25-per-turn-gate-p2-3r2"
assert_eq "$(prereg_in_step "$PR" "$WRAP_SRC" "$P1" "$PH" "$P2")" ok "4.5 rerun PREREG: wrapper hash, appendix, order, hashes, caps, probe cost, model and seed agree with its manifest"
assert_eq "$(prereg_in_step "$PH" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "5.5 PREREG: wrapper hash, appendix, order, hashes, caps, probe cost, model and seed agree with its manifest"
prbad() { rm -rf "$TEST_TMP/prereg-bad"; cp -a "$PH" "$TEST_TMP/prereg-bad"; sed -i "$1" "$TEST_TMP/prereg-bad/PREREG.md"; }
prbad 's/a6f2d856/0a5f50be/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: a 4.5 argv prefix inside the 5.5 PREREG is flagged"
prbad '0,/C arm 3 USD/s//C arm 18 USD/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: a changed cap sentence is flagged"
prbad 's/probe_cost` 0.0015/probe_cost` 0.0166/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: another batch's probe cost is flagged"
prbad '0,/Haiku 5.5 batch/s//claude-haiku-4-5 batch/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: another batch's model name is flagged"
prbad '0,/ptg-p2-3-h55-order-2026-10-25/s//ptg-p2-3-order-2026-10-24/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: another batch's seed is flagged"
prbad 's/total cap 48 USD//;0,/Caps, never raised in place/s//The 48 USD approved total; caps, never raised in place/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PR" "$P2")" ok "RED: a leftover 48 USD cap statement is flagged"
assert_eq "$(prereg_in_step "$P2" "$WRAP_SRC" "$P1" "$PR" "$PH")" ok "4.5 second rerun PREREG (caps C 26, ON 40): wrapper hash, appendix, order, hashes, caps, probe cost, model and seed agree with its manifest"
pr2bad() { rm -rf "$TEST_TMP/prereg-bad2"; cp -a "$P2" "$TEST_TMP/prereg-bad2"; sed -i "$1" "$TEST_TMP/prereg-bad2/PREREG.md"; }
pr2bad '0,/Two earlier 4.5 batches/s//The cap of the first design was 18 USD; two earlier 4.5 batches/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad2" "$WRAP_SRC" "$P1" "$PR" "$PH")" ok "RED: the 18 USD cap of p2-3r put into the p2-3r2 PREREG is flagged"
pr2bad 's/C arm 26 USD/C arm 18 USD/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad2" "$WRAP_SRC" "$P1" "$PR" "$PH")" ok "RED: the p2-3r cap sentence in the p2-3r2 PREREG is flagged"
pr2bad 's/ptg-p2-3r2-order-2026-10-25/ptg-p2-3r-order-2026-10-25/'; assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad2" "$WRAP_SRC" "$P1" "$PR" "$PH")" ok "RED: the p2-3r seed in the p2-3r2 PREREG is flagged"
rm -rf "$TEST_TMP/prereg-bad"; cp -a "$PR" "$TEST_TMP/prereg-bad"; sed -i 's/"wrapper": "./"wrapper": "0/' "$TEST_TMP/prereg-bad/manifest.json"
assert_neq "$(prereg_in_step "$TEST_TMP/prereg-bad" "$WRAP_SRC" "$P1" "$PH")" ok "RED: a manifest with another wrapper hash is reported out of step"
finalize_test
