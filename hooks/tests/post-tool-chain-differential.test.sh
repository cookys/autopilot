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
  sed_mutate "$MUT/$label/$file" "$expr" || return 0
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
  sed_mutate "$MUT/$label/post-tool-chain-lib.js" "s#^  return status;#  $stmt return status;#" || return 0
  local out rc
  out="$(HOME="$HOOK_HOME" node "$HARNESS" check --only-overlap --overlap-n 3 --chain "$MUT/$label" 2>&1 < /dev/null)"; rc=$?
  [ "$rc" -ne 0 ] || fail "invariant negative control '$label' was NOT detected"
  assert_contains "$out" "HARNESS RED" "invariant negative control '$label' reports RED"
}
CTR="require('path').join(process.env.HOME, '.autopilot', '.failure_count_4fd0e486')"
inv_neg counter-999999 "try { require('fs').writeFileSync($CTR, '999999'); } catch (e) { void e; }"
inv_neg state-file-deleted "try { require('fs').unlinkSync($CTR); } catch (e) { void e; }"
inv_neg mode-changed "try { require('fs').chmodSync($CTR, 0o644); } catch (e) { void e; }"
inv_neg json-key-added "try { const f = require('path').join(process.env.HOME, '.autopilot', 'intent'); const fs2 = require('fs'); for (const n of fs2.readdirSync(f)) { const q = require('path').join(f, n); fs2.writeFileSync(q, fs2.readFileSync(q, 'utf8').replace('\"cwd\"', '\"cwdx\"')); } } catch (e) { void e; }"

# --- negative control: a user-text timestamp/hostname must stay visible (only enumerated fields are normalised) ---
LIT="$MUT/lit"
mkdir -p "$LIT/hooks" "$LIT/src" "$LIT/scripts"
for f in "$HOOKS_DIR"/* ; do ln -sf "$f" "$LIT/hooks/$(basename "$f")"; done
rm -f "$LIT/hooks/post-tool-chain.js" "$LIT/hooks/post-tool-chain-lib.js" "$LIT/hooks/audit-log.js"
cp "$HOOKS_DIR/post-tool-chain.js" "$HOOKS_DIR/post-tool-chain-lib.js" "$HOOKS_DIR/audit-log.js" "$LIT/hooks/"
sed_mutate "$LIT/hooks/audit-log.js" "s#redacted.replace(#redacted.replace(/00:00:00.123Z/g, '00:00:00.999Z').replace(#" || true
run_harness --chain "$LIT/hooks"
[ "$H_RC" -ne 0 ] || fail "negative control 'literal timestamp changed inside a logged command' was NOT detected"
assert_contains "$H_OUT" "literal-timestamp-hostname-pid-in-user-text" "the literal-timestamp fixture is the one that goes red"

# --- negative control: dropping the umask pin makes a umask-077 caller red ---
UP="$MUT/umask"; mkdir -p "$UP/hooks"
for f in "$HOOKS_DIR"/* ; do ln -sf "$f" "$UP/hooks/$(basename "$f")"; done
rm -f "$UP/hooks/tests"; mkdir -p "$UP/hooks/tests/lib" "$UP/hooks/tests/fixtures/post-tool-chain"
ln -sf "$REPO_ROOT/hooks/tests/fixtures/post-tool-chain/golden.json" "$UP/hooks/tests/fixtures/post-tool-chain/golden.json"
ln -sf "$REPO_ROOT/src" "$UP/src"; ln -sf "$REPO_ROOT/scripts" "$UP/scripts"
cp "$HARNESS" "$UP/hooks/tests/lib/post-tool-chain-harness.js"
sed_mutate "$UP/hooks/tests/lib/post-tool-chain-harness.js" "s#^process.umask(0o022);##" || true
UN_OUT="$( umask 077; HOME="$HOOK_HOME" node "$UP/hooks/tests/lib/post-tool-chain-harness.js" check --overlap-n 0 --no-orig 2>&1 < /dev/null )"; UN_RC=$?
[ "$UN_RC" -ne 0 ] || fail "negative control 'umask pin removed' was NOT detected under umask 077"

# --- negative controls on the unit tests (broken lib copies must turn the mechanics tests red) ---
unit_neg() { # <label> <sed command>
  local label="$1" expr="$2"
  mk_chain_dir "u-$label"
  sed_mutate "$MUT/u-$label/post-tool-chain-lib.js" "$expr" || return 0
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
unit_neg module-state-leak 's/  for (const k of Object.keys(require.cache)) if (!snap.cacheKeys.has(k)) delete require.cache\[k\];//'
unit_neg exit-status-not-masked 's/  return n \& 0xff;/  return n;/'

# the unmodified unit tests are green
UOUT="$(HOME="$HOOK_HOME" node --test "$HOOKS_DIR/post-tool-chain.test.js" 2>&1 < /dev/null)"; URC=$?
assert_exit_code "$URC" 0 "unit tests green on the real lib"

finalize_test
