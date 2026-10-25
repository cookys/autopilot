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
neg() { # <label> <sed command> <file under chain dir>
  local label="$1" expr="$2" file="${3:-post-tool-chain-lib.js}"
  mk_chain_dir "$label"
  mutate_or_die "$MUT/$label/$file" "$expr"
  run_harness --chain "$MUT/$label"
  [ "$H_RC" -ne 0 ] || fail "negative control '$label' was NOT detected (harness rc=$H_RC)"
  assert_contains "$H_OUT" "HARNESS RED" "negative control '$label' reports RED"
}
neg exit-code 's/if (r.code > status) status = r.code;/status = 1;/'
neg stdout-byte 's/if (r.out.length) emitOut(r.out);/if (r.out.length) emitOut(r.out.subarray(0, r.out.length - 1));/'
neg aggregate-order "s/const MEMBERS = \['intent-capture', 'reload-watch', 'audit-log', 'log-error', 'failure-escalation'\];/const MEMBERS = ['intent-capture', 'failure-escalation', 'audit-log', 'log-error', 'reload-watch'];/"
neg member-order-sorted "s/for (const stem of members) {/for (const stem of members.slice().sort()) {/"
neg drop-state-write "s/for (const stem of members) {/for (const stem of members.filter((m) => m !== 'log-error')) {/"

# --- negative controls: pollution, exit status, order (unit tests red on a broken lib) and the umask pin ---
# (the unit-test controls are below, after unit_neg is defined)

# --- negative controls on the overlap invariants: a chain that damages one state file after its run ---
inv_neg() { # <label> <js statement run on the counter file before the chain returns>
  local label="$1" stmt="$2"
  mk_chain_dir "$label"
  mutate_or_die "$MUT/$label/post-tool-chain-lib.js" "s#^  return status;#  $stmt return status;#"
  local out rc
  out="$(HOME="$HOOK_HOME" node "$HARNESS" check --only-overlap --overlap-n 3 --chain "$MUT/$label" 2>&1 < /dev/null)"; rc=$?
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
inv_neg stale-write-zero-intent-counter "try { require('fs').writeFileSync($ICTR, '0'); } catch (e) { void e; }"
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
  run_harness --chain "$MT/hooks"
  [ "$H_RC" -ne 0 ] || fail "negative control '$1' was NOT detected"
  assert_contains "$H_OUT" "$4" "negative control '$1': the '$4' fixture goes red"
}
norm_neg literal-timestamp-in-command audit-log "s#redacted.replace(#redacted.replace(/00:00:00.123Z/g, '00:00:00.999Z').replace(#" literal-timestamp-hostname-pid-in-user-text
norm_neg heading-shaped-line-in-error-text log-error "s#^\( *\)truncError,\$#\1truncError.replace(/03:03:03.333Z/, '03:03:03.999Z'),#" user-error-text-with-heading-shaped-line

norm_neg corrupted-error-block-empty-tool log-error 's#\*\*Tool:\*\* ${toolName}#**Tool:** #' user-error-text-with-heading-shaped-line
norm_neg embedded-terminator-user-date-changed log-error 's#^\( *\)truncError,$#\1truncError.replace(/03:03:03.333Z/, "03:03:03.999Z"),#' user-error-text-embeds-terminator-and-heading
norm_neg one-byte-of-user-error-text log-error 's#^\( *\)truncError,$#\1truncError.replace(/before/, "befora"),#' user-error-text-embeds-terminator-and-heading

# --- negative control: without the freeze module the arms disagree on clock / hostname (the freeze really is what makes them equal) ---
run_harness --no-freeze
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
DC_OUT="$(HOME="$HOOK_HOME" node "$HT/hooks/tests/lib/post-tool-chain-harness.js" check --only-overlap --overlap-n 3 --no-orig 2>&1 < /dev/null)"; DC_RC=$?
[ "$DC_RC" -ne 0 ] || fail "negative control 'tool-counter regex broken' was NOT detected"
assert_contains "$DC_OUT" "dead declaration" "broken counter regex is reported as a dead declaration"

# --- fixed-sandbox plumbing: unusable parent, stale lock, live lock (PTC_FIXED_PARENT points the lock/sandbox at a scratch dir) ---
NP_OUT="$(PTC_FIXED_PARENT="$TEST_TMP/no-such-parent" HOME="$HOOK_HOME" node "$HARNESS" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; NP_RC=$?
assert_exit_code "$NP_RC" 2 "unusable sandbox parent exits 2"
assert_contains "$NP_OUT" "missing or not writable" "unusable sandbox parent: explicit message"
FP1="$TEST_TMP/fp1"; mkdir -p "$FP1/ptc-fixed-sandbox.lock"; echo 2147483646 > "$FP1/ptc-fixed-sandbox.lock/pid"
SL_OUT="$(PTC_FIXED_PARENT="$FP1" HOME="$HOOK_HOME" timeout 60 node "$HARNESS" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; SL_RC=$?
assert_exit_code "$SL_RC" 0 "a lock held by a dead pid is taken over"
[ ! -d "$FP1/ptc-fixed-sandbox.lock" ] || fail "lock directory left behind after the run"
FP2="$TEST_TMP/fp2"; mkdir -p "$FP2/ptc-fixed-sandbox.lock"
sleep 120 & HOLDER=$!
echo "$HOLDER" > "$FP2/ptc-fixed-sandbox.lock/pid"
LL_OUT="$(PTC_FIXED_PARENT="$FP2" HOME="$HOOK_HOME" timeout 4 node "$HARNESS" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; LL_RC=$?
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
assert_exit_code "$LL_RC" 124 "a lock held by a live pid makes the harness wait (timeout fired)"
assert_contains "$LL_OUT" "waiting for another harness run" "live lock: the wait is announced"

# --- negative control: dropping the umask pin makes a umask-077 caller red ---
mk_harness_tree umask
UP="$HT"
mutate_or_die "$UP/hooks/tests/lib/post-tool-chain-harness.js" "s#^process.umask(0o022);##"
UN_OUT="$( umask 077; HOME="$HOOK_HOME" node "$UP/hooks/tests/lib/post-tool-chain-harness.js" check --overlap-n 0 --no-orig 2>&1 < /dev/null )"; UN_RC=$?
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
