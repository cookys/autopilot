#!/usr/bin/env bash
# post-tool-chain differential test (BL-0241 guard-port Phase 1; plan docs/plans/2026-10-23-guard-port.md).
#
# Green control: the chain (hooks/post-tool-chain.js) and the refactored observers match the golden bytes taken
# from the ORIGINAL observers (pinned develop sha, see hooks/tests/fixtures/post-tool-chain/golden.json), on a
# serial corpus plus overlapping-call cases. Negative controls: a chain mutated to change one exit code, drop one
# stdout byte, reorder the aggregate, or skip one member (one state write) must make the harness exit non-zero,
# and chain-lib mutants must turn the unit tests red. Each mutant goes through sed_mutant, so a drifted anchor
# fails loudly instead of passing for the wrong reason.
. "$(dirname "$0")/lib.sh"

HARNESS="$REPO_ROOT/hooks/tests/lib/post-tool-chain-harness.js"
MUT="$TEST_TMP/mut"
mkdir -p "$MUT"

# Every negative control applies its mutation through mutate_or_die: if the sed anchor no longer hits, the whole test
# stops at once (a control that was never applied must not pass as green).
mutate_or_die() {
  sed_mutate "$@" || { echo "FATAL [$TEST_NAME] negative control not applied (mutation missed its anchor): $*" >&2; exit 1; }
}

# mutant dir <name>: a copy of chain.js + chain-lib.js with the five observers symlinked in (they resolve their
# own ../src and ./lib requires through the symlink's real path).
mk_chain_dir() {
  local d="$MUT/$1"
  mkdir -p "$d"
  cp "$HOOKS_DIR/post-tool-chain.js" "$HOOKS_DIR/post-tool-chain-lib.js" "$d/"
  for s in intent-capture reload-watch audit-log log-error failure-escalation; do
    ln -sf "$HOOKS_DIR/$s.js" "$d/$s.js"
  done
}

run_harness() { # <extra args...> ; sets H_RC, H_OUT
  H_OUT="$(HOME="$HOOK_HOME" node "$HARNESS" check --overlap-n 0 "$@" 2>&1 < /dev/null)"
  H_RC=$?
}

# --- green control, on an UNMUTATED copy: proves the copy mechanism itself is not what turns the mutants red ---
mk_chain_dir green
run_harness --chain "$MUT/green"
assert_exit_code "$H_RC" 0 "unmutated chain copy passes the serial corpus"
assert_contains "$H_OUT" "HARNESS GREEN" "green control prints GREEN"
assert_contains "$H_OUT" "arms orig,cur,chain,chain-rev" "all arms ran (original observers from the pinned sha, current, chain, chain with reversed members)"

# --- the golden does not depend on the shell's umask (the harness pins 022 itself; a restrictive caller umask is green) ---
UM_OUT="$( umask 077; HOME="$HOOK_HOME" node "$HARNESS" check --overlap-n 0 2>&1 < /dev/null )"; UM_RC=$?
assert_exit_code "$UM_RC" 0 "umask 077 caller: serial corpus still green"
UM2_OUT="$( umask 022; HOME="$HOOK_HOME" node "$HARNESS" check --overlap-n 0 2>&1 < /dev/null )"; UM2_RC=$?
assert_exit_code "$UM2_RC" 0 "umask 022 caller: serial corpus still green"

# --- the real tree, with the overlapping-call cases ---
OVERLAP_OUT="$(HOME="$HOOK_HOME" node "$HARNESS" check --overlap-n 6 2>&1 < /dev/null)"
OVERLAP_RC=$?
assert_exit_code "$OVERLAP_RC" 0 "real tree: serial corpus + overlapping calls green"
assert_contains "$OVERLAP_OUT" '"case":"two-failing-bash-same-session"' "overlap cases ran"
assert_contains "$OVERLAP_OUT" '"chain_failing_components":0' "no chain component outside serial/baseline"

# --- negative controls on the chain ---
neg() { # <label> <sed command> <fixture the mutation must break>
  local label="$1" expr="$2" fx="$3" file="post-tool-chain-lib.js"
  mk_chain_dir "$label"
  mutate_or_die "$MUT/$label/$file" "$expr"
  run_harness --chain "$MUT/$label" --only "$fx" --no-orig
  [ "$H_RC" -ne 0 ] || fail "negative control '$label' was NOT detected (harness rc=$H_RC)"
  assert_contains "$H_OUT" "HARNESS RED" "negative control '$label' reports RED"
}
neg exit-code 's/if (r.code > status) status = r.code;/status = 1;/' quiet-bash-success
neg stdout-byte 's/if (r.out.length) emitOut(r.out);/if (r.out.length) emitOut(r.out.subarray(0, r.out.length - 1));/' bash-fail-escalation-ladder
neg aggregate-order "s/const MEMBERS = \['intent-capture', 'reload-watch', 'audit-log', 'log-error', 'failure-escalation'\];/const MEMBERS = ['intent-capture', 'failure-escalation', 'audit-log', 'log-error', 'reload-watch'];/" reload-and-failure-both-emit
neg member-order-sorted "s/for (const stem of members) {/for (const stem of members.slice().sort()) {/" reload-and-failure-both-emit
neg drop-state-write "s/for (const stem of members) {/for (const stem of members.filter((m) => m !== 'log-error')) {/" log-error-keyword-read

# --- negative controls: pollution, exit status, order (unit tests red on a broken lib) and the umask pin ---
# (the unit-test controls are below, after unit_neg is defined)

# --- negative controls on the overlap invariants: a chain that damages one state file after its run ---
inv_neg() { # <label> <js statement run on the counter file before the chain returns>
  local label="$1" stmt="$2"
  mk_chain_dir "$label"
  mutate_or_die "$MUT/$label/post-tool-chain-lib.js" "s#^  return status;#  $stmt return status;#"
  local out rc
  out="$(HOME="$HOOK_HOME" node "$HARNESS" check --only-overlap --overlap-n 3 --case "${3:-two-failing-bash-same-session}" --chain "$MUT/$label" 2>&1 < /dev/null)"; rc=$?
  [ "$rc" -ne 0 ] || fail "invariant negative control '$label' was NOT detected"
  assert_contains "$out" "HARNESS RED" "invariant negative control '$label' reports RED"
}
CTR="require('path').join(process.env.HOME, '.autopilot', '.failure_count_4fd0e486')"
inv_neg counter-999999 "try { require('fs').writeFileSync($CTR, '999999'); } catch (e) { void e; }"
inv_neg state-file-deleted "try { require('fs').unlinkSync($CTR); } catch (e) { void e; }"
inv_neg mode-changed "try { require('fs').chmodSync($CTR, 0o644); } catch (e) { void e; }"
ICTR="require('path').join(process.env.HOME, '.autopilot', '.intent-capture-failures')"
inv_neg stale-write-zero-failure-counter "try { require('fs').writeFileSync($CTR, '0'); } catch (e) { void e; }"
inv_neg observed-max-plus-one "try { require('fs').writeFileSync($CTR, '4'); } catch (e) { void e; }"
inv_neg stale-write-zero-intent-counter "try { require('fs').writeFileSync($ICTR, '0'); } catch (e) { void e; }" intent-breaker-pair
inv_neg json-key-added "try { const f = require('path').join(process.env.HOME, '.autopilot', 'intent'); const fs2 = require('fs'); for (const n of fs2.readdirSync(f)) { const q = require('path').join(f, n); fs2.writeFileSync(q, fs2.readFileSync(q, 'utf8').replace('\"cwd\"', '\"cwdx\"')); } } catch (e) { void e; }"

# --- negative controls: user-supplied text must stay visible (only enumerated fields / log-written positions are normalised) ---
mk_member_tree() { # <name> <member stem>: chain files + the member copied (mutable), everything else symlinked; sets MT
  MT="$MUT/$1"
  mkdir -p "$MT/hooks" "$MT/src" "$MT/scripts"
  local f
  for f in "$HOOKS_DIR"/* ; do ln -sf "$f" "$MT/hooks/$(basename "$f")"; done
  rm -f "$MT/hooks/post-tool-chain.js" "$MT/hooks/post-tool-chain-lib.js" "$MT/hooks/$2.js"
  cp "$HOOKS_DIR/post-tool-chain.js" "$HOOKS_DIR/post-tool-chain-lib.js" "$HOOKS_DIR/$2.js" "$MT/hooks/"
}
norm_neg() { # <label> <member> <sed command> <fixture name that must go red>
  mk_member_tree "$1" "$2"
  mutate_or_die "$MT/hooks/$2.js" "$3"
  run_harness --chain "$MT/hooks" --only "$4" --no-orig
  [ "$H_RC" -ne 0 ] || fail "negative control '$1' was NOT detected"
  assert_contains "$H_OUT" "$4" "negative control '$1': the '$4' fixture goes red"
}
norm_neg literal-timestamp-in-command audit-log "s#redacted.replace(#redacted.replace(/00:00:00.123Z/g, '00:00:00.999Z').replace(#" literal-timestamp-hostname-pid-in-user-text
norm_neg heading-shaped-line-in-error-text log-error "s#^\( *\)truncError,\$#\1truncError.replace(/03:03:03.333Z/, '03:03:03.999Z'),#" user-error-text-with-heading-shaped-line

norm_neg corrupted-error-block-empty-tool log-error 's#\*\*Tool:\*\* ${toolName}#**Tool:** #' user-error-text-with-heading-shaped-line
norm_neg embedded-terminator-user-date-changed log-error 's#^\( *\)truncError,$#\1truncError.replace(/03:03:03.333Z/, "03:03:03.999Z"),#' user-error-text-embeds-terminator-and-heading
norm_neg one-byte-of-user-error-text log-error 's#^\( *\)truncError,$#\1truncError.replace(/before/, "befora"),#' user-error-text-embeds-terminator-and-heading

# EF BF BD (U+FFFD) turned into FF in the written log: UTF-8 decoding used to make them look the same
norm_neg invalid-utf8-byte-in-state-file log-error 's#fs.appendFileSync(logPath, entry);#fs.appendFileSync(logPath, Buffer.from(Buffer.from(entry).toString("latin1").replace(/\\xef\\xbf\\xbd/g, "\\xff"), "latin1"));#' lone-surrogate-escape-in-error-text

# --- negative control: without the freeze module the arms disagree on clock / hostname (the freeze really is what makes them equal) ---
run_harness --no-freeze --only quiet-bash-success --no-orig
[ "$H_RC" -ne 0 ] || fail "negative control 'freeze module removed' was NOT detected"
assert_contains "$H_OUT" "state differs" "freeze removed: volatile values differ and the harness is red"

# --- harness copies for controls that mutate the harness itself ---
mk_harness_tree() { # <name>: sets HT; a repo-shaped tree whose harness (and nothing else) is a mutable copy
  HT="$MUT/$1"; mkdir -p "$HT/hooks"
  local f
  for f in "$HOOKS_DIR"/* ; do ln -sf "$f" "$HT/hooks/$(basename "$f")"; done
  rm -f "$HT/hooks/tests"; mkdir -p "$HT/hooks/tests/lib" "$HT/hooks/tests/fixtures/post-tool-chain"
  ln -sf "$REPO_ROOT/hooks/tests/fixtures/post-tool-chain/golden.json" "$HT/hooks/tests/fixtures/post-tool-chain/golden.json"
  ln -sf "$HOOKS_DIR/tests/lib/ptc-freeze.js" "$HT/hooks/tests/lib/ptc-freeze.js"
  ln -sf "$REPO_ROOT/src" "$HT/src"; ln -sf "$REPO_ROOT/scripts" "$HT/scripts"
  cp "$HARNESS" "$HT/hooks/tests/lib/post-tool-chain-harness.js"
}

# --- negative control: a counter regex that stops matching leaves its declared range dead; the harness must say so ---
mk_harness_tree deadcounter
mutate_or_die "$HT/hooks/tests/lib/post-tool-chain-harness.js" 's#claude-intent-tool-count-\[0-9a-f\]{12}#claude-intent-tool-count-[0-9a-f]{13}#'
DC_OUT="$(HOME="$HOOK_HOME" node "$HT/hooks/tests/lib/post-tool-chain-harness.js" check --only-overlap --overlap-n 3 --case two-failing-bash-same-session --no-orig 2>&1 < /dev/null)"; DC_RC=$?
[ "$DC_RC" -ne 0 ] || fail "negative control 'tool-counter regex broken' was NOT detected"
assert_contains "$DC_OUT" "dead declaration" "broken counter regex is reported as a dead declaration"

# --- fixed-sandbox plumbing. The harness serialises itself with flock(1) on one fixed lock file; these controls point
# PTC_LOCK_FILE / PTC_FIXED_PARENT / PTC_FIXED_SHM at scratch locations so they never touch the real lock or paths.
HARNESS_Q=(node "$HARNESS" check --only-overlap --overlap-n 0)
NP_OUT="$(PTC_FIXED_PARENT="$TEST_TMP/no-such-parent" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; NP_RC=$?
assert_exit_code "$NP_RC" 2 "unusable sandbox parent exits 2"
assert_contains "$NP_OUT" "missing or not writable" "unusable sandbox parent: explicit message"

mkdir -p "$TEST_TMP/realdir" "$TEST_TMP/realdir2"; ln -s "$TEST_TMP/realdir" "$TEST_TMP/parentlink"; ln -s "$TEST_TMP/realdir2" "$TEST_TMP/realdir/shmlink"
SY_OUT="$(PTC_LOCK_FILE="$TEST_TMP/lk-sy" PTC_FIXED_PARENT="$TEST_TMP/parentlink" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; SY_RC=$?
assert_exit_code "$SY_RC" 2 "sandbox parent behind a symlink exits 2"
assert_contains "$SY_OUT" "behind a symlink" "sandbox parent symlink: explicit message"
SS_OUT="$(PTC_LOCK_FILE="$TEST_TMP/lk-sy" PTC_FIXED_PARENT="$TEST_TMP/realdir" PTC_FIXED_SHM="$TEST_TMP/realdir/shmlink" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; SS_RC=$?
assert_exit_code "$SS_RC" 2 "live parent (under PTC_FIXED_PARENT) behind a symlink exits 2"
assert_contains "$SS_OUT" "behind a symlink" "live parent symlink: explicit message"
# PTC_FIXED_SHM cannot be used to leave PTC_FIXED_PARENT, nor on its own: both are refused before anything is touched
SO_OUT="$(PTC_LOCK_FILE="$TEST_TMP/lk-sy" PTC_FIXED_PARENT="$TEST_TMP/realdir" PTC_FIXED_SHM="/dev/shm" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; SO_RC=$?
assert_exit_code "$SO_RC" 2 "PTC_FIXED_SHM outside PTC_FIXED_PARENT exits 2"
assert_contains "$SO_OUT" "must lie under PTC_FIXED_PARENT" "shm outside the parent: explicit message"
SA_OUT="$(PTC_LOCK_FILE="$TEST_TMP/lk-sy" PTC_FIXED_SHM="$TEST_TMP/realdir" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; SA_RC=$?
assert_exit_code "$SA_RC" 2 "PTC_FIXED_SHM without PTC_FIXED_PARENT exits 2"
# ... and the real live dir keeps its sentinel when both are set to it (checked inside the real lock)
REAL_LOCK=/tmp/ptc-fixed-harness.lock
REAL_LIVE=/dev/shm/ptc-fixed-live
BOTH_OUT="$(flock -w 600 "$REAL_LOCK" bash -c 'mkdir -p "$3" && echo x > "$3/sentinel"; PTC_LOCK_FILE="$4" PTC_FLOCK_HELD=1 PTC_FIXED_PARENT="$1" PTC_FIXED_SHM=/dev/shm node "$2" check --only-overlap --overlap-n 0 > /dev/null 2>&1; rc=$?; if [ -e "$3/sentinel" ]; then st=kept; else st=gone; fi; rm -f "$3/sentinel"; rmdir "$3" 2>/dev/null; echo "$rc $st"' _ "$TEST_TMP/realdir" "$HARNESS" "$REAL_LIVE" "$TEST_TMP/lk-sy" 2>&1 < /dev/null)"
assert_contains "$BOTH_OUT" "2 kept" "both overrides set: refused, and the real live dir's sentinel is untouched"

mkdir -p "$TEST_TMP/nopath"; ln -sf "$(command -v node)" "$TEST_TMP/nopath/node"
NF_OUT="$(PATH="$TEST_TMP/nopath" HOME="$HOOK_HOME" "$TEST_TMP/nopath/node" "$HARNESS" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; NF_RC=$?
assert_exit_code "$NF_RC" 2 "no flock on PATH exits 2"
assert_contains "$NF_OUT" "flock(1)" "no flock: the message names it"

# a second run waits for the first, and gives up with an explicit error when the wait runs out
LK="$TEST_TMP/lk-wait"; mkdir -p "$TEST_TMP/fpw"
setsid flock "$LK" sleep 8 > /dev/null 2>&1 < /dev/null & HOLDER=$!
sleep 0.5
W_OUT="$(PTC_LOCK_FILE="$LK" PTC_LOCK_WAIT_SEC=2 PTC_FIXED_PARENT="$TEST_TMP/fpw" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; W_RC=$?
kill -- "-$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
[ "$W_RC" -ne 0 ] || fail "second harness did not wait/give up while the lock was held"
assert_contains "$W_OUT" "could not get" "lock wait timed out: explicit error"
# ... and gets in as soon as the holder is gone
W2_OUT="$(PTC_LOCK_FILE="$LK" PTC_LOCK_WAIT_SEC=5 PTC_FIXED_PARENT="$TEST_TMP/fpw" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; W2_RC=$?
assert_exit_code "$W2_RC" 0 "lock free: the next run proceeds"

# SIGKILL of a running harness: the kernel drops its lock, the next run takes over at once and leaves nothing behind
LK2="$TEST_TMP/lk-kill"; FPK="$TEST_TMP/fpk"; mkdir -p "$FPK"
setsid env PTC_LOCK_FILE="$LK2" PTC_FIXED_PARENT="$FPK" HOME="$HOOK_HOME" node "$HARNESS" check --overlap-n 30 > /dev/null 2>&1 < /dev/null &
FIRST=$!
for _ in $(seq 1 100); do [ -d "$FPK/ptc-fixed-sandbox/home" ] && break; sleep 0.2; done
[ -d "$FPK/ptc-fixed-sandbox/home" ] || fail "first harness never created its sandbox"
kill -9 -- "-$FIRST" 2>/dev/null; sleep 0.5
[ -d "$FPK/ptc-fixed-sandbox" ] || fail "the SIGKILLed harness left no residue, so the takeover cleanup is not exercised"
K_OUT="$(PTC_LOCK_FILE="$LK2" PTC_LOCK_WAIT_SEC=5 PTC_FIXED_PARENT="$FPK" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; K_RC=$?
assert_exit_code "$K_RC" 0 "after SIGKILL the next run takes the lock at once (5 s wait budget)"
for d in ptc-fixed-sandbox ptc-fixed-scratch ptc-fixed-live; do [ ! -e "$FPK/$d" ] || fail "residue left after takeover run: $FPK/$d"; done

# a harness with its own PTC_FIXED_PARENT never touches the real live dir (sentinel kept), run inside the real lock
REAL_LOCK=/tmp/ptc-fixed-harness.lock
REAL_LIVE=/dev/shm/ptc-fixed-live
ISO_OUT="$(flock -w 600 "$REAL_LOCK" bash -c 'mkdir -p "$3" && echo x > "$3/sentinel"; mkdir -p "$1"; PTC_FLOCK_HELD=1 PTC_FIXED_PARENT="$1" node "$2" check --only-overlap --overlap-n 1 > /dev/null 2>&1; rc=$?; if [ -e "$3/sentinel" ]; then st=kept; else st=gone; fi; rm -f "$3/sentinel"; rmdir "$3" 2>/dev/null; echo "$rc $st"' _ "$TEST_TMP/fpiso" "$HARNESS" "$REAL_LIVE" 2>&1 < /dev/null)"
assert_contains "$ISO_OUT" "0 kept" "a harness under another PTC_FIXED_PARENT leaves the real live dir alone"

# --- a signal sent ONLY to the outer harness pid reaches the process that holds the lock: it cleans up and the outer
# exits with 128+signal (no process-group kill here; that would hide the bug)
sig_probe() { # <harness js> <signal name> <dir>: prints "rc=<n> lockfree=<0|1> residue=<0|1>"; always reaps what is left
  local h="$1" sig="$2" d="$3" pid rc lf=0 res=0 i
  rm -rf "$d"; mkdir -p "$d"
  setsid env PTC_LOCK_FILE="$d/lk" PTC_FIXED_PARENT="$d" HOME="$HOOK_HOME" node "$h" check --overlap-n 30 > /dev/null 2>&1 < /dev/null &
  pid=$!
  for i in $(seq 1 100); do [ -d "$d/ptc-fixed-sandbox/home" ] && break; sleep 0.2; done
  kill "-$sig" "$pid" 2>/dev/null
  for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  wait "$pid" 2>/dev/null; rc=$?
  sleep 1
  flock -n "$d/lk" true && lf=1
  for x in ptc-fixed-sandbox ptc-fixed-scratch ptc-fixed-live; do [ -e "$d/$x" ] && res=1; done
  kill -9 -- "-$pid" 2>/dev/null   # whatever survived (only a broken forwarder leaves anything)
  echo "rc=$rc lockfree=$lf residue=$res"
}
for pair in TERM:143 INT:130 HUP:129; do
  sg="${pair%%:*}"; want="${pair##*:}"
  SP="$(sig_probe "$HARNESS" "$sg" "$TEST_TMP/sig-$sg")"
  assert_eq "$SP" "rc=$want lockfree=1 residue=0" "SIG$sg to the outer pid only: holder cleaned up, lock free, outer exits $want"
done
mk_harness_tree sigmut
mutate_or_die "$HT/hooks/tests/lib/post-tool-chain-harness.js" 's/for (const k of kids.length ? kids : \[child.pid\])/for (const k of [child.pid])/'
SPM="$(sig_probe "$HT/hooks/tests/lib/post-tool-chain-harness.js" TERM "$TEST_TMP/sig-mut")"
[ "$SPM" != "rc=143 lockfree=1 residue=0" ] || fail "negative control 'signal sent to flock only' was NOT detected ($SPM)"

# --- two harnesses started at the same moment run one after the other, and both pass ---
interval_check() { # <trace file>: "disjoint <n>" or "overlap <n>" (start/end lines: "<what> <pid> <monotonic ns>")
  node -e '
    const L = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => l.split(" "));
    const iv = {};
    for (const [k, pid, t] of L) { (iv[pid] = iv[pid] || {})[k] = BigInt(t); }
    const a = Object.values(iv).filter((x) => x.start !== undefined && x.end !== undefined).sort((x, y) => (x.start < y.start ? -1 : 1));
    let ov = false;
    for (let i = 1; i < a.length; i++) if (a[i].start < a[i - 1].end) ov = true;
    console.log((ov ? "overlap " : "disjoint ") + a.length);
  ' "$1"
}
TWO_ARGS=(check --only-overlap --overlap-n 2 --case two-failing-bash-same-session --no-orig)
TR1="$TEST_TMP/trace1"; : > "$TR1"; mkdir -p "$TEST_TMP/fp2a"
PTC_TRACE_FILE="$TR1" PTC_LOCK_FILE="$TEST_TMP/lk-two" PTC_FIXED_PARENT="$TEST_TMP/fp2a" HOME="$HOOK_HOME" node "$HARNESS" "${TWO_ARGS[@]}" > "$TEST_TMP/two-a.out" 2>&1 < /dev/null & TA=$!
PTC_TRACE_FILE="$TR1" PTC_LOCK_FILE="$TEST_TMP/lk-two" PTC_FIXED_PARENT="$TEST_TMP/fp2a" HOME="$HOOK_HOME" node "$HARNESS" "${TWO_ARGS[@]}" > "$TEST_TMP/two-b.out" 2>&1 < /dev/null & TB=$!
wait "$TA"; TA_RC=$?; wait "$TB"; TB_RC=$?
assert_exit_code "$TA_RC" 0 "simultaneous harness A passes"
assert_exit_code "$TB_RC" 0 "simultaneous harness B passes"
assert_eq "$(interval_check "$TR1")" "disjoint 2" "two simultaneously started harnesses hold the lock in disjoint intervals"
# the interval check can see overlap: the same two runs with the lock bypassed (separate parents so they do not corrupt each other)
mk_harness_tree nolock
mutate_or_die "$HT/hooks/tests/lib/post-tool-chain-harness.js" "s/^const lockHeld = process.env.PTC_FLOCK_HELD === '1';/const lockHeld = true;/"
TR2="$TEST_TMP/trace2"; : > "$TR2"; mkdir -p "$TEST_TMP/fp2b" "$TEST_TMP/fp2c"
PTC_TRACE_FILE="$TR2" PTC_FIXED_PARENT="$TEST_TMP/fp2b" HOME="$HOOK_HOME" node "$HT/hooks/tests/lib/post-tool-chain-harness.js" "${TWO_ARGS[@]}" > /dev/null 2>&1 < /dev/null & NA=$!
PTC_TRACE_FILE="$TR2" PTC_FIXED_PARENT="$TEST_TMP/fp2c" HOME="$HOOK_HOME" node "$HT/hooks/tests/lib/post-tool-chain-harness.js" "${TWO_ARGS[@]}" > /dev/null 2>&1 < /dev/null & NB=$!
wait "$NA"; wait "$NB"
assert_eq "$(interval_check "$TR2")" "overlap 2" "negative control: with the lock bypassed the same two runs overlap and the interval check says so"

# --- negative control: dropping the umask pin makes a umask-077 caller red ---
mk_harness_tree umask
UP="$HT"
mutate_or_die "$UP/hooks/tests/lib/post-tool-chain-harness.js" "s#^process.umask(0o022);##"
UN_OUT="$( umask 077; HOME="$HOOK_HOME" node "$UP/hooks/tests/lib/post-tool-chain-harness.js" check --overlap-n 0 --no-orig --only quiet-bash-success 2>&1 < /dev/null )"; UN_RC=$?
[ "$UN_RC" -ne 0 ] || fail "negative control 'umask pin removed' was NOT detected under umask 077"
assert_contains "$UN_OUT" "state differs" "umask pin removed: the red is a state (mode) difference"

# --- negative controls on the unit tests (broken lib copies must turn the mechanics tests red) ---
unit_neg() { # <label> <sed command>
  local label="$1" expr="$2"
  mk_chain_dir "u-$label"
  mutate_or_die "$MUT/u-$label/post-tool-chain-lib.js" "$expr"
  local out rc
  out="$(PTC_LIB="$MUT/u-$label/post-tool-chain-lib.js" HOME="$HOOK_HOME" node --test "$HOOKS_DIR/post-tool-chain.test.js" 2>&1 < /dev/null)"; rc=$?
  [ "$rc" -ne 0 ] || fail "unit negative control '$label' was NOT detected"
  printf '%s\n' "$out" | grep -Eq 'fail [1-9]' || fail "unit negative control '$label': no failing test reported"
}
unit_neg no-failopen-note 's/    else err.push(/    else void (/'
unit_neg status-min 's/if (r.code > status) status = r.code;/if (r.code < status) status = r.code;/'
unit_neg exit-not-restored 's/    process.exit = realExit;//'
unit_neg env-leak 's/  for (const k of Object.keys(process.env)) if (!(k in snap.env)) delete process.env\[k\];//'
unit_neg exitcode-leak 's/  process.exitCode = snap.exitCode;//'
unit_neg listener-leak 's/  const now = new Set(\[...process.eventNames(), ...snap.events.keys()\]);/  const now = new Set();/'
unit_neg once-listener-made-permanent 's/events.set(ev, process.rawListeners(ev))/events.set(ev, process.listeners(ev))/'
unit_neg module-cache-not-purged 's/  for (const k of Object.keys(require.cache)) if (!keep.has(k)) delete require.cache\[k\];/  for (const k of Object.keys(require.cache)) if (!keep.has(k) \&\& false) delete require.cache[k];/'
unit_neg once-wrapper-reused 's/process.once(ev, f.listener);/process.on(ev, f);/'
unit_neg exit-status-not-masked 's/  return n \& 0xff;/  return n;/'

# the unmodified unit tests are green
UOUT="$(HOME="$HOOK_HOME" node --test "$HOOKS_DIR/post-tool-chain.test.js" 2>&1 < /dev/null)"; URC=$?
assert_exit_code "$URC" 0 "unit tests green on the real lib"

finalize_test
