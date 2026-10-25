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
neg no-context-merge 's/    if (events.length === 1) {/    if (false) {/' reload-and-failure-both-emit
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

# --- fixed-sandbox plumbing. The OFFICIAL harness has three fixed resource paths and ONE lock file
# (/tmp/ptc-fixed-harness.lock); nothing in the environment or on the command line changes them. A control that needs other
# paths runs a RELOCATED COPY of the harness (mk_reloc: the four path constants re-pointed under a mktemp parent), never the
# official file with an override. Only the two controls that must prove the real lock protects the real resources run on them.
HARNESS_Q=(node "$HARNESS" check --only-overlap --overlap-n 0)
REAL_LOCK=/tmp/ptc-fixed-harness.lock
REAL_RES=(/tmp/ptc-fixed-sandbox /tmp/ptc-fixed-scratch /dev/shm/ptc-fixed-live)
mut_src() { # <name> <sed expr>...: a mutated copy of the harness SOURCE (not in any tree); prints its path
  local n="$1" e; shift
  cp "$HARNESS" "$MUT/$n.js"
  for e in "$@"; do mutate_or_die "$MUT/$n.js" "$e"; done
  echo "$MUT/$n.js"
}
mk_reloc() { # <name> <parent> [source js]: sets HT and HR = a harness inside a repo-shaped tree whose four constants point under <parent>
  mk_harness_tree "$1"
  HR="$HT/hooks/tests/lib/post-tool-chain-harness.js"
  local src="$HARNESS"; [ "$#" -ge 3 ] && src="$3"
  [ -f "$src" ] || { echo "FATAL [$TEST_NAME] mk_reloc: harness source missing (a mutation did not apply?): '$src'" >&2; exit 1; }
  cp "$src" "$HR"
  # through tokens: a parent that itself contains one of the official names must not be rewritten by a later expression
  mutate_or_die "$HR" "s#/tmp/ptc-fixed-sandbox#@@PTC-S@@#g"
  mutate_or_die "$HR" "s#/tmp/ptc-fixed-scratch#@@PTC-C@@#g"
  mutate_or_die "$HR" "s#/dev/shm/ptc-fixed-live#@@PTC-L@@#g"
  mutate_or_die "$HR" "s#/tmp/ptc-fixed-harness.lock#@@PTC-K@@#g"
  mutate_or_die "$HR" "s#@@PTC-S@@#$2/ptc-fixed-sandbox#g"
  mutate_or_die "$HR" "s#@@PTC-C@@#$2/ptc-fixed-scratch#g"
  mutate_or_die "$HR" "s#@@PTC-L@@#$2/ptc-fixed-live#g"
  mutate_or_die "$HR" "s#@@PTC-K@@#$2/ptc-fixed-harness.lock#g"
}

# unusable parent, symlinked parent (relocated copies)
mk_reloc noparent "$TEST_TMP/no-such-parent"
NP_OUT="$(HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; NP_RC=$?
assert_exit_code "$NP_RC" 2 "unusable sandbox parent exits 2"
assert_contains "$NP_OUT" "missing or not writable" "unusable sandbox parent: explicit message"
mkdir -p "$TEST_TMP/realdir"; ln -s "$TEST_TMP/realdir" "$TEST_TMP/parentlink"
# only the sandbox/scratch parent goes through the symlink; the lock stays on the real directory (its path must match /proc)
mk_reloc_sym() { local n="$1"; shift; mk_reloc "$n" "$TEST_TMP/realdir" "$@"
  mutate_or_die "$HR" "s#$TEST_TMP/realdir/ptc-fixed-sandbox#$TEST_TMP/parentlink/ptc-fixed-sandbox#g"
  mutate_or_die "$HR" "s#$TEST_TMP/realdir/ptc-fixed-scratch#$TEST_TMP/parentlink/ptc-fixed-scratch#g"; }
mk_reloc_sym symparent
SY_OUT="$(HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; SY_RC=$?
assert_exit_code "$SY_RC" 2 "a parent behind a symlink exits 2"
assert_contains "$SY_OUT" "behind a symlink" "parent symlink: explicit message"
mk_reloc_sym nosymcheck "$(mut_src nosymcheck 's/if (real !== dir) die(/if (false) die(/')"
SYM_RC=0; HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 > /dev/null 2>&1 < /dev/null || SYM_RC=$?
[ "$SYM_RC" -eq 0 ] || fail "negative control 'symlink check removed': the run should now pass (rc $SYM_RC)"

mkdir -p "$TEST_TMP/nopath"; ln -sf "$(command -v node)" "$TEST_TMP/nopath/node"
NF_OUT="$(PATH="$TEST_TMP/nopath" HOME="$HOOK_HOME" "$TEST_TMP/nopath/node" "$HARNESS" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; NF_RC=$?
assert_exit_code "$NF_RC" 2 "no flock on PATH exits 2"
assert_contains "$NF_OUT" "flock(1)" "no flock: the message names it"

# the old override variables are refused (exit 2) before anything is created; including the one that would have put a second
# resource set UNDER the official sandbox (ancestor/descendant collision)
for v in PTC_FIXED_PARENT PTC_FIXED_SHM PTC_LOCK_FILE PTC_FLOCK_HELD; do
  OV_OUT="$(env "$v=$TEST_TMP/x" HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; OV_RC=$?
  assert_exit_code "$OV_RC" 2 "old override $v is refused with exit 2"
  assert_contains "$OV_OUT" "no longer accepted" "$v: explicit message"
done
OD_OUT="$(PTC_FIXED_PARENT=/tmp/ptc-fixed-sandbox/inner HOME="$HOOK_HOME" "${HARNESS_Q[@]}" 2>&1 < /dev/null)"; OD_RC=$?
assert_exit_code "$OD_RC" 2 "a resource set placed under the official sandbox is refused"
[ ! -e /tmp/ptc-fixed-sandbox/inner ] || fail "the refused nested override still created /tmp/ptc-fixed-sandbox/inner"
mkdir -p "$TEST_TMP/fpo"
mk_reloc noreject "$TEST_TMP/fpo" "$(mut_src noreject 's/^for (const v of \[.*\]) {/for (const v of []) {/')"
NR_RC=0; PTC_FLOCK_HELD=1 HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 > /dev/null 2>&1 < /dev/null || NR_RC=$?
[ "$NR_RC" -ne 2 ] || fail "negative control 'override refusal removed' was NOT detected"

# a relocated copy must not share a path with the OFFICIAL set (equal, ancestor or descendant), or the official run's wipe
# could delete the copy's resources and lock. Run the copy ITSELF (no environment variable involved), nested under each
# official resource while the real lock is held so nothing real is running.
nested_probe() { # <copy js> <official dir to nest under>: prints the copy's output and "rc=<n>"
  flock -o -w 600 "$REAL_LOCK" bash -c '
    mkdir -p "$2/inner"
    PTC_LOCK_WAIT_SEC=2 node "$1" check --only-overlap --overlap-n 0 2>&1 < /dev/null; echo "rc=$?"
    rm -f "$2/inner/ptc-fixed-harness.lock"; rmdir "$2/inner" 2>/dev/null; rmdir "$2" 2>/dev/null' _ "$1" "$2" 2>/dev/null < /dev/null
}
NEST_MUT_SRC="$(mut_src nonest 's/^  if (!isOfficial) {/  if (false) {/')"
for under in /tmp/ptc-fixed-sandbox /tmp/ptc-fixed-scratch /dev/shm/ptc-fixed-live; do
  mk_reloc "nest-$(basename "$under")" "$under/inner"
  NP="$(HOME="$HOOK_HOME" nested_probe "$HR" "$under")"
  assert_contains "$NP" "rc=2" "a harness copy placed under $under is refused (exit 2)"
  assert_contains "$NP" "overlaps the official" "nested under $under: explicit message"
  mk_reloc "nestmut-$(basename "$under")" "$under/inner" "$NEST_MUT_SRC"
  NPM="$(HOME="$HOOK_HOME" nested_probe "$HR" "$under")"
  assert_contains "$NPM" "rc=0" "negative control: without the overlap check the same nested copy runs (and would be wiped by an official run)"
done
# the same logic with ancestor / equal / exact-set / disjoint relations, against a MOCK official set (the copy's literals are
# rewritten into a mktemp dir, so a broken check can only ever touch that directory)
off_case() { # <name> <parent> <sandbox-off> <scratch-off> <live-off> <lock-off> [source js]: prints "rc=<n>"
  local n="$1" P="$2" so="$3" co="$4" lo="$5" ko="$6"
  mkdir -p "$P"; mk_reloc "off-$n" "$P" ${7:+"$7"}
  mutate_or_die "$HR" "s#'/tmp/' + 'ptc-fixed-sandbox'#'$so'#"
  mutate_or_die "$HR" "s#'/tmp/' + 'ptc-fixed-scratch'#'$co'#"
  mutate_or_die "$HR" "s#'/dev/shm/' + 'ptc-fixed-live'#'$lo'#"
  mutate_or_die "$HR" "s#'/tmp/' + 'ptc-fixed-harness.lock'#'$ko'#"
  HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 > "$TEST_TMP/off-$n.out" 2>&1 < /dev/null; echo "rc=$?"
}
OX="$TEST_TMP/offx"; mkdir -p "$OX"
FAR=("$OX/f/sandbox" "$OX/f/scratch" "$OX/f/live" "$OX/f/lock")
P1="$TEST_TMP/offp1"
assert_eq "$(off_case anc "$P1" "$P1/ptc-fixed-sandbox/deep/x" "${FAR[1]}" "${FAR[2]}" "${FAR[3]}")" "rc=2" "own sandbox is an ANCESTOR of an official path: refused"
P2="$TEST_TMP/offp2"
assert_eq "$(off_case desc "$P2" "$P2" "${FAR[1]}" "${FAR[2]}" "${FAR[3]}")" "rc=2" "own sandbox is a DESCENDANT of an official path: refused"
P3="$TEST_TMP/offp3"
assert_eq "$(off_case eq "$P3" "${FAR[0]}" "${FAR[1]}" "${FAR[2]}" "$P3/ptc-fixed-harness.lock")" "rc=2" "only the lock path equals an official path (not the whole set): refused"
assert_contains "$(cat "$TEST_TMP/off-eq.out")" "overlaps the official" "equal-path refusal: explicit message"
P4="$TEST_TMP/offp4"
assert_eq "$(off_case set "$P4" "$P4/ptc-fixed-sandbox" "$P4/ptc-fixed-scratch" "$P4/ptc-fixed-live" "$P4/ptc-fixed-harness.lock")" "rc=0" "exactly the official set: accepted"
P5="$TEST_TMP/offp5"
assert_eq "$(off_case far "$P5" "${FAR[0]}" "${FAR[1]}" "${FAR[2]}" "${FAR[3]}")" "rc=0" "a disjoint set: accepted"
P6="$TEST_TMP/offp6"
assert_eq "$(off_case ancmut "$P6" "$P6/ptc-fixed-sandbox/deep/x" "${FAR[1]}" "${FAR[2]}" "${FAR[3]}" "$NEST_MUT_SRC")" "rc=0" "negative control: ancestor relation not detected when the check is removed"

# the lock protects the resources, and the holder proves the lock is ITS OWN. held_probe: with <lock> held by a process that
# does NOT pass the descriptor down (flock -o), run the harness (plain, or with the forged --under-flock claim) on resources
# holding sentinels; prints "<rc> <kept|gone>".
held_probe() { # <harness js> <lock> <extra harness arg or ""> <resource dir>...
  local h="$1" lock="$2" extra="$3"; shift 3
  flock -o -w 600 "$lock" bash -c '
    h="$1"; extra="$2"; shift 2
    for d in "$@"; do mkdir -p "$d"; echo x > "$d/sentinel"; done
    PTC_LOCK_WAIT_SEC=2 node "$h" check --only-overlap --overlap-n 0 $extra > /dev/null 2>&1; r=$?
    st=kept; for d in "$@"; do [ -e "$d/sentinel" ] || st=gone; done
    for d in "$@"; do rm -f "$d/sentinel"; rmdir "$d" 2>/dev/null; done
    echo "$r $st"' _ "$h" "$extra" "$@" 2>/dev/null < /dev/null
}
HP_OUT="$(HOME="$HOOK_HOME" held_probe "$HARNESS" "$REAL_LOCK" "" "${REAL_RES[@]}")"
assert_eq "$HP_OUT" "2 kept" "the real lock held by someone else: a plain run waits, gives up (exit 2), real resources untouched"
HF_OUT="$(HOME="$HOOK_HOME" held_probe "$HARNESS" "$REAL_LOCK" "--under-flock" "${REAL_RES[@]}")"
assert_eq "$HF_OUT" "2 kept" "forged --under-flock while someone else holds the lock: exit 2, real resources untouched"
# negative controls (relocated copies): no lock at all, and a lock claim that is believed without being proved
NL_SRC="$(mut_src nolock 's/^const underFlock = args.includes(.--under-flock.);/const underFlock = true;/' 's/^assertIHoldTheLock();/\/\/ lock check bypassed/')"
NV_SRC="$(mut_src noverify 's/^assertIHoldTheLock();/\/\/ lock check bypassed/')"
mkdir -p "$TEST_TMP/fph"
mk_reloc nolockheld "$TEST_TMP/fph" "$NL_SRC"
NLH="$(HOME="$HOOK_HOME" held_probe "$HR" "$TEST_TMP/fph/ptc-fixed-harness.lock" "" "$TEST_TMP/fph/ptc-fixed-sandbox" "$TEST_TMP/fph/ptc-fixed-scratch" "$TEST_TMP/fph/ptc-fixed-live")"
[ "$NLH" != "2 kept" ] || fail "negative control 'no lock taken' was NOT detected ($NLH)"
mk_reloc noverifyheld "$TEST_TMP/fph" "$NV_SRC"
NVH="$(HOME="$HOOK_HOME" held_probe "$HR" "$TEST_TMP/fph/ptc-fixed-harness.lock" "--under-flock" "$TEST_TMP/fph/ptc-fixed-sandbox" "$TEST_TMP/fph/ptc-fixed-scratch" "$TEST_TMP/fph/ptc-fixed-live")"
[ "$NVH" != "2 kept" ] || fail "negative control 'forged lock claim believed' was NOT detected ($NVH)"
# a claim with nobody holding the lock is refused too
mk_reloc nobody "$TEST_TMP/fph"
NB_OUT="$(HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 --under-flock 2>&1 < /dev/null)"; NB_RC=$?
assert_exit_code "$NB_RC" 2 "--under-flock with nobody holding the lock exits 2"
assert_contains "$NB_OUT" "held by nobody" "unheld lock claim: explicit message"

# a second run waits for a held lock, gives up with an explicit error, and gets in once it is free
FPW="$TEST_TMP/fpw"; mkdir -p "$FPW"; mk_reloc waitrun "$FPW"
setsid flock "$FPW/ptc-fixed-harness.lock" sleep 8 > /dev/null 2>&1 < /dev/null & HOLDER=$!
sleep 0.5
W_OUT="$(PTC_LOCK_WAIT_SEC=2 HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; W_RC=$?
kill -- "-$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
assert_exit_code "$W_RC" 2 "a held lock: the run gives up with exit 2"
assert_contains "$W_OUT" "could not get" "lock wait timed out: explicit error"
W2_OUT="$(PTC_LOCK_WAIT_SEC=5 HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; W2_RC=$?
assert_exit_code "$W2_RC" 0 "lock free: the next run proceeds"

# SIGKILL of a running harness: the kernel drops its lock, the next run takes over at once and leaves nothing behind
FPK="$TEST_TMP/fpk"; mkdir -p "$FPK"; mk_reloc killrun "$FPK"; KHR="$HR"
KTAG="killtag-$$-$RANDOM"
setsid env HOME="$HOOK_HOME" node "$KHR" check --overlap-n 30 --tag "$KTAG" > /dev/null 2>&1 < /dev/null &
FIRST=$!
for _ in $(seq 1 100); do [ -d "$FPK/ptc-fixed-sandbox/home" ] && break; sleep 0.2; done
[ -d "$FPK/ptc-fixed-sandbox/home" ] || fail "first harness never created its sandbox"
# SIGKILL the whole tree (outer, flock chain, holder, their children): nothing gets a chance to clean up
kill -9 -- "-$FIRST" 2>/dev/null
for pg in $(ps -eo pgid,args | grep -e "[-]-tag $KTAG" | awk '{print $1}' | sort -u); do kill -9 -- "-$pg" 2>/dev/null; done
sleep 0.5
[ -d "$FPK/ptc-fixed-sandbox" ] || fail "the SIGKILLed harness left no residue, so the takeover cleanup is not exercised"
K_OUT="$(PTC_LOCK_WAIT_SEC=5 HOME="$HOOK_HOME" node "$KHR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; K_RC=$?
assert_exit_code "$K_RC" 0 "after SIGKILL the next run takes the lock at once (5 s wait budget)"
for d in ptc-fixed-sandbox ptc-fixed-scratch ptc-fixed-live; do [ ! -e "$FPK/$d" ] || fail "residue left after takeover run: $FPK/$d"; done

# --- a signal sent ONLY to the outer harness pid reaches the whole lock chain: the holder (and its async children) end,
# cleanup is complete the moment the outer exits, the lock is free, and the outer exits 128+signal. The holder's own trace
# line "signal-<n>" proves the holder RECEIVED the signal (a group SIGKILL after a delay would also leave a tidy-looking exit) ---
SIG_TERM_FILE="$TEST_TMP/sig-term-flag"
sig_probe() { # <harness source js> <signal> <dir> [pre-signal delay s] [extra env assignment]: "rc=<n> lockfree=<0|1> residue=<0|1> leftover=<n>"; holder-saw-signal count -> $SIG_TERM_FILE
  local src="$1" sig="$2" d="$3" delay="${4:-}" extra="${5:-PTC_NOP=1}" pid rc lf=1 res=0 left x i n tag="sigtag-$$-$RANDOM" tr
  rm -rf "$d"; mkdir -p "$d"
  mk_reloc "sp-$tag" "$d" "$src"
  tr="$d.trace"; : > "$tr"
  setsid env "$extra" PTC_TRACE_FILE="$tr" PTC_TEST_DRAIN_MS="${PTC_SIG_DRAIN:-30000}" HOME="$HOOK_HOME" node "$HR" check --overlap-n 30 --tag "$tag" > /dev/null 2>&1 < /dev/null &
  pid=$!
  if [ -n "$delay" ]; then sleep "$delay"; else for i in $(seq 1 100); do [ -d "$d/ptc-fixed-sandbox/home" ] && break; sleep 0.2; done; fi
  kill "-$sig" "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null; rc=$?
  # no sleep: everything must already be gone when the outer has exited
  flock -n "$d/ptc-fixed-harness.lock" true || lf=0
  for x in ptc-fixed-sandbox ptc-fixed-scratch ptc-fixed-live; do [ -e "$d/$x" ] && res=1; done
  left="$(ps -eo args | grep -c -e "[-]-tag $tag")"
  n="$(grep -c '^signal-' "$tr" 2>/dev/null)"; echo "${n:-0}" > "$SIG_TERM_FILE"
  # reap what a broken forwarder would leave behind
  for x in $(ps -eo pgid,args | grep -e "[-]-tag $tag" | awk '{print $1}' | sort -u); do kill -9 -- "-$x" 2>/dev/null; done
  echo "rc=$rc lockfree=$lf residue=$res leftover=$left"
}
CLEAN_SIG="lockfree=1 residue=0 leftover=0"
for pair in TERM:143 INT:130 HUP:129; do
  sg="${pair%%:*}"; want="${pair##*:}"
  SP="$(sig_probe "$HARNESS" "$sg" "$TEST_TMP/sig-$sg")"
  assert_eq "$SP" "rc=$want $CLEAN_SIG" "SIG$sg to the outer pid only: whole chain gone, no residue, lock free, exit $want"
  assert_eq "$(cat "$SIG_TERM_FILE")" 1 "SIG$sg: the holder itself received the signal"
done
# timing: the signal lands just after the holder started and while it sits before its own setup (test delay), and at
# several moments around the flock chain's start-up
SP="$(sig_probe "$HARNESS" TERM "$TEST_TMP/sig-early" 1.5 PTC_TEST_DELAY_AFTER_LOCK_MS=3000)"
assert_eq "$SP" "rc=143 $CLEAN_SIG" "SIGTERM while the holder has just started (before its own setup)"
for dl in 0.08 0.15 0.25 0.4; do
  SP="$(sig_probe "$HARNESS" TERM "$TEST_TMP/sig-t$dl" "$dl")"
  assert_eq "$SP" "rc=143 $CLEAN_SIG" "SIGTERM ${dl}s after launch (somewhere in the flock chain start-up): no orphan holder"
done
# negative control: the signal goes to flock only. The outer then waits for the group, SIGKILLs it after the drain time and
# exits 143 anyway, so the exit code alone looks right; the FULL result (residue left behind) and the holder trace differ.
SPM="$(PTC_SIG_DRAIN=2000 sig_probe "$(mut_src sigmut 's/process.kill(-child.pid, sig)/process.kill(child.pid, sig)/')" TERM "$TEST_TMP/sig-mut")"
SPM_SAW="$(cat "$SIG_TERM_FILE")"
[ "$SPM" != "rc=143 $CLEAN_SIG" ] || fail "negative control 'signal sent to flock only' was NOT detected ($SPM)"
assert_eq "$SPM_SAW" 0 "negative control: with the signal sent to flock only the holder never sees it"
# the holder waits for its async children before cleaning up: with the wait removed, residue can come back after the wipe
NWK_SRC="$(mut_src nowaitkids 's/Promise.race(\[Promise.all(closes), new Promise((res) => setTimeout(res, 5000))\]).then(() => process.exit(128 + n));/process.exit(128 + n);/')"
NWK_BAD=0
for i in 1 2 3; do
  SPK="$(sig_probe "$NWK_SRC" TERM "$TEST_TMP/sig-nwk$i")"
  [ "$SPK" = "rc=143 $CLEAN_SIG" ] || NWK_BAD=1
done
[ "$NWK_BAD" = 1 ] || echo "note: the no-wait-for-children mutant happened to leave no residue in 3 tries (race, not asserted)" >&2

# the outer never exits as if clean while its process group is still there: with a group that never empties it gives up
# loudly (exit 3) after the SIGKILL grace instead of returning after a fixed short sleep
mkdir -p "$TEST_TMP/stuck"
mk_reloc stuck "$TEST_TMP/stuck" "$(mut_src stuckgroup 's/^  const groupAlive = () => .*$/  const groupAlive = () => true;/')"
ST_OUT="$(PTC_TEST_DRAIN_MS=200 HOME="$HOOK_HOME" node "$HR" check --only-overlap --overlap-n 0 2>&1 < /dev/null)"; ST_RC=$?
assert_exit_code "$ST_RC" 3 "a process group that cannot be reaped: the outer exits 3"
assert_contains "$ST_OUT" "cannot reap" "unreapable group: explicit message"

# --- the official harness: two started at the same moment run one after the other (both on the real fixed lock), and both pass ---
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
TR1="$TEST_TMP/trace1"; : > "$TR1"
PTC_TRACE_FILE="$TR1" HOME="$HOOK_HOME" node "$HARNESS" "${TWO_ARGS[@]}" > "$TEST_TMP/two-a.out" 2>&1 < /dev/null & TA=$!
PTC_TRACE_FILE="$TR1" HOME="$HOOK_HOME" node "$HARNESS" "${TWO_ARGS[@]}" > "$TEST_TMP/two-b.out" 2>&1 < /dev/null & TB=$!
wait "$TA"; TA_RC=$?; wait "$TB"; TB_RC=$?
assert_exit_code "$TA_RC" 0 "simultaneous harness A passes"
assert_exit_code "$TB_RC" 0 "simultaneous harness B passes"
assert_eq "$(interval_check "$TR1")" "disjoint 2" "two simultaneously started harnesses hold the lock in disjoint intervals"
# the interval check can see overlap: the same two runs with the lock bypassed (relocated copies with separate parents so they do not corrupt each other)
TR2="$TEST_TMP/trace2"; : > "$TR2"; mkdir -p "$TEST_TMP/fp2b" "$TEST_TMP/fp2c"
mk_reloc nolockA "$TEST_TMP/fp2b" "$NL_SRC"; HRA="$HR"
mk_reloc nolockB "$TEST_TMP/fp2c" "$NL_SRC"; HRB="$HR"
PTC_TRACE_FILE="$TR2" HOME="$HOOK_HOME" node "$HRA" "${TWO_ARGS[@]}" > /dev/null 2>&1 < /dev/null & NA=$!
PTC_TRACE_FILE="$TR2" HOME="$HOOK_HOME" node "$HRB" "${TWO_ARGS[@]}" > /dev/null 2>&1 < /dev/null & NB=$!
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
unit_neg context-not-merged 's/    if (events.length === 1) {/    if (false) {/'
unit_neg context-held-dropped 's/  if (held.length === 1) emitOut(held\[0\].out);/  if (false) emitOut(held[0].out);/'
unit_neg status-min 's/if (r.code > status) status = r.code;/if (r.code < status) status = r.code;/'
unit_neg exit-not-restored 's/    process.exit = realExit;//'
unit_neg env-leak 's/  for (const k of Object.keys(process.env)) if (!(k in snap.env)) delete process.env\[k\];//'
unit_neg exitcode-leak 's/  process.exitCode = snap.exitCode;//'
unit_neg listener-leak 's/  const now = new Set(\[...process.eventNames(), ...snap.events.keys()\]);/  const now = new Set();/'
unit_neg once-listener-made-permanent 's/events.set(ev, process.rawListeners(ev))/events.set(ev, process.listeners(ev))/'
unit_neg module-cache-not-purged 's/  for (const k of Object.keys(require.cache)) if (!keep.has(k)) delete require.cache\[k\];/  for (const k of Object.keys(require.cache)) if (!keep.has(k) \&\& false) delete require.cache[k];/'
unit_neg once-wrapper-reused 's/process.once(ev, f.listener);/process.on(ev, f);/'
unit_neg exit-status-not-masked 's/ | 0) \& 0xff; }/ | 0); }/'
unit_neg exit-own-conversion 's/    if (args.length !== 0) process.exitCode = args\[0\];/    if (args.length !== 0 \&\& Number.isInteger(args[0])) process.exitCode = args[0];/'
unit_neg exit-noarg-ignores-exitcode 's/throw new MemberExit(toStatus());/throw new MemberExit(args.length ? toStatus() : 0);/'
unit_neg return-value-bypasses-setter 's/try { process.exitCode = c; return toStatus(); }/try { return Number(c) \& 0xff; }/'

# the unmodified unit tests are green
UOUT="$(HOME="$HOOK_HOME" node --test "$HOOKS_DIR/post-tool-chain.test.js" 2>&1 < /dev/null)"; URC=$?
assert_exit_code "$URC" 0 "unit tests green on the real lib"

finalize_test
