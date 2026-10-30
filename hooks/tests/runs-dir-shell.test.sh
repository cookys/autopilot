#!/usr/bin/env bash
# runs-dir-shell.test.sh -- the shell side of BL-0336: runs_dir_ensure / runs_tmpdir_ensure in scripts/lib/repo-identity.sh, which the three
# dispatch rails (dispatch-hetero / -review / -author) and ccshim_keep_transcript call instead of `mkdir -p <runs dir>`.
#
# Contract kept from the old `mkdir -p "$dir" 2>/dev/null || return 0`: a directory that cannot be used means no manifest and the run carries
# on (the function returns 1, the rail does `|| return 0`); new: ONE stderr line names the reason (once per process).
# Negative controls (a scratch copy of repo-identity.sh + runtime-paths.js with one line broken, same assertions must fail):
#   - the helper stops asking for --ensure (prints the path, makes nothing)   -> "missing runs dir is made" goes red
#   - the reason line is deleted                                               -> "one stderr line names the reason" goes red
. "$(dirname "$0")/lib.sh"

SB="$TEST_TMP/rds"
mkdir -p "$SB"
NODE_BIN="$(command -v node)"

# run_case <lib dir> <name> -> runs the scenario in a subshell, prints "key=value" lines
scenario() {
  local libdir="$1" W="$2"
  rm -rf "$W"; mkdir -p "$W"
  (
    cd "$W" || exit 1
    # shellcheck disable=SC1091
    . "$libdir/repo-identity.sh"
    # 1. missing runs dir (parents too) is made, mode 0700
    export AUTOPILOT_DISPATCH_RUNS_DIR="$W/fresh/a/runs"
    runs_dir_ensure; echo "make_rc=$?"
    echo "make_dir=$RUNS_DIR_ENSURED"
    echo "make_mode=$(stat -c %a "$W/fresh/a/runs" 2> /dev/null)"
    unset _RUNS_DIR_MEMO _RUNS_DIR_FAILED
    # 2. a runs dir other users can write to: refused, one reason line, the directory is left alone, the second call adds no line
    mkdir -p "$W/open"; chmod 777 "$W/open"
    export AUTOPILOT_DISPATCH_RUNS_DIR="$W/open"
    runs_dir_ensure 2> "$W/refuse1.err"; echo "refuse_rc=$?"
    runs_dir_ensure 2> "$W/refuse2.err"; echo "refuse_again_rc=$?"
    echo "refuse_lines=$(wc -l < "$W/refuse1.err" | tr -d ' ')"
    echo "refuse_again_lines=$(wc -l < "$W/refuse2.err" | tr -d ' ')"
    echo "refuse_names_reason=$(grep -c 'manifest not written: .*writable by other users' "$W/refuse1.err")"
    echo "refuse_mode=$(stat -c %a "$W/open")"
    unset _RUNS_DIR_MEMO _RUNS_DIR_FAILED
    # 3. TMPDIR set but missing is made; one that is a file is refused with a reason
    unset AUTOPILOT_DISPATCH_RUNS_DIR
    export TMPDIR="$W/tmpnew/x"
    runs_tmpdir_ensure; echo "tmp_rc=$?"; echo "tmp_mode=$(stat -c %a "$W/tmpnew/x" 2> /dev/null)"
    ln -s "$W/tmpnew/x" "$W/tmplink"; export TMPDIR="$W/tmplink"
    runs_tmpdir_ensure 2> "$W/tmplink.err"; echo "tmplink_rc=$?"; echo "tmplink_reason=$(grep -c 'symbolic link' "$W/tmplink.err")"
    export TMPDIR=/dev/shm; runs_tmpdir_ensure; echo "sharedroot_rc=$?"
    echo plain > "$W/tmpfile"; export TMPDIR="$W/tmpfile"
    runs_tmpdir_ensure 2> "$W/tmp.err"; echo "tmpfile_rc=$?"; echo "tmpfile_reason=$(grep -c 'not a directory' "$W/tmp.err")"
  )
}

check() { # <lib dir> -> fails (exit 1 via assert) on the first broken expectation; prints nothing on success
  local out W="$SB/run-$(basename "$1")"; out="$(scenario "$1" "$W")"
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p"; }
  assert_eq "$(val make_rc)" "0" "missing runs dir: rc 0"
  assert_eq "$(val make_dir)" "$W/fresh/a/runs" "missing runs dir: RUNS_DIR_ENSURED is the directory"
  assert_eq "$(val make_mode)" "700" "missing runs dir is made (parents too), mode 0700"
  assert_eq "$(val refuse_rc)" "1" "an unusable runs dir returns 1 (the rail then writes no manifest and carries on)"
  assert_eq "$(val refuse_lines)" "1" "...with ONE stderr line"
  assert_eq "$(val refuse_names_reason)" "1" "...that names the reason"
  assert_eq "$(val refuse_again_rc)" "1" "asked again: still unusable"
  assert_eq "$(val refuse_again_lines)" "0" "...and silent the second time (once per process)"
  assert_eq "$(val refuse_mode)" "777" "an unusable directory is left as it was (not chmod-ed)"
  assert_eq "$(val tmp_rc)" "0" "a missing TMPDIR is made"
  assert_eq "$(val tmp_mode)" "700" "...mode 0700"
  assert_eq "$(val tmplink_rc)" "1" "an EXISTING TMPDIR that is a symbolic link is refused"
  assert_eq "$(val tmplink_reason)" "1" "...with its reason"
  assert_eq "$(val sharedroot_rc)" "0" "a root-owned sticky shared root (/dev/shm) is accepted"
  assert_eq "$(val tmpfile_rc)" "1" "a TMPDIR that is a file is refused"
  assert_eq "$(val tmpfile_reason)" "1" "...with its reason"
}

# the real helper
check "$REPO_ROOT/scripts/lib"

# a rail with the helper missing must not break: runs_dir_ensure undefined => `declare -F` guard in the rails
for rail in dispatch-author dispatch-review dispatch-hetero; do
  assert_eq "$([ "$(grep -c 'declare -F runs_dir_ensure' "$REPO_ROOT/scripts/$rail.sh")" -ge 1 ] && echo yes || echo no)" "yes" "$rail.sh guards the helper and calls it"
  assert_eq "$(grep -c 'mkdir -p "\$dir"\|mkdir -p "\$MANIFEST_DIR_PATH"' "$REPO_ROOT/scripts/$rail.sh")" "0" "$rail.sh no longer runs mkdir -p on the runs directory"
done

# negative controls: break one line of a scratch copy; the same assertions must fail (run in a subshell: assert failures exit)
neg() { # <name> <from> <to> <expected failing message fragment>
  local dir="$SB/neg-$1"
  mkdir -p "$dir"
  cp "$REPO_ROOT/scripts/lib/repo-identity.sh" "$REPO_ROOT/scripts/lib/runtime-paths.js" "$dir/"
  NEG_FROM="$2" NEG_TO="$3" "$NODE_BIN" -e '
    const fs = require("fs"); const f = process.argv[1] + "/repo-identity.sh";
    const t = fs.readFileSync(f, "utf8"); const o = t.split(process.env.NEG_FROM).join(process.env.NEG_TO);
    if (o === t) { console.error("mutation does not match"); process.exit(3); }
    fs.writeFileSync(f, o);' "$dir" || fail "negative control $1: the mutation no longer matches repo-identity.sh"
  local res
  res="$( (check "$dir") 2>&1 )"
  case "$res" in
    *"$4"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *) fail "negative control $1 stayed green (expected a failure mentioning: $4); got: $res" ;;
  esac
}
neg no-ensure 'runs-dir --ensure' 'runs-dir' 'missing runs dir is made'
neg existing-unchecked '[ -n "${TMPDIR:-}" ] || return 0' '[ -n "${TMPDIR:-}" ] || return 0; [ -d "$TMPDIR" ] && return 0' 'EXISTING TMPDIR that is a symbolic link'
neg no-reason-line 'echo "dispatch: manifest not written: $_rd_out" >&2' ':' 'ONE stderr line'

finalize_test
