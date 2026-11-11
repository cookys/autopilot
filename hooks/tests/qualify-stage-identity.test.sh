#!/usr/bin/env bash
# qualifyfix: qualify_stage_identity refreshes the staged identity/config file when the real file changed
# (source-sha stamp <staged>.source.sha256, same scheme as qualify_stage_credential), and leaves it alone otherwise.
# Cases: (a) source changed -> staged updated; (b) source unchanged -> local edit of the staged copy kept;
# (c) legacy copy without a stamp that differs from the source -> updated + one stderr line; (d) real file missing -> untouched.
# Each case has a negative control: a sed_mutant of the lib that must turn exactly that case red.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/hooks/tests/lib.sh"
LIB="$REPO/scripts/lib/qualify-stage-credentials.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
chk() { if [ "$1" = 0 ]; then pass=$((pass+1)); echo "PASS: $2"; else fail=$((fail+1)); echo "FAIL: $2"; fi; }

# cases <lib> <tag>: prints "a=0|1 b=.. c=.. d=.." (0 = behaves as specified)
cases() {
  local lib="$1" w="$T/w-$2" r
  mkdir -p "$w"; local s="$w/staged" real="$w/real"
  r=""
  # (a) source changes after staging
  echo v1 >"$real"; rm -f "$s" "$s.source.sha256"
  ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>/dev/null
  echo v2 >"$real"
  ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>/dev/null
  [ "$(cat "$s")" = v2 ] && [ "$(cat "$s.source.sha256")" = "$(sha256sum "$real" | cut -d' ' -f1)" ]; r="$r a=$?"
  # (b) source unchanged: local edit survives
  echo v1 >"$real"; rm -f "$s" "$s.source.sha256"
  ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>/dev/null
  echo 'v1-local-edit' >"$s"
  ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>/dev/null
  [ "$(cat "$s")" = v1-local-edit ]; r="$r b=$?"
  # (c) legacy copy, no stamp, differs from source
  echo new >"$real"; echo old >"$s"; rm -f "$s.source.sha256"
  local err; err="$( ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>&1 >/dev/null )"
  [ "$(cat "$s")" = new ] && [ -f "$s.source.sha256" ] && [ "$(printf '%s\n' "$err" | grep -c 'no source stamp')" = 1 ]; r="$r c=$?"
  # (d) real file missing: staged and stamp untouched, nothing printed
  echo keep >"$s"; echo abc >"$s.source.sha256"; rm -f "$real"
  err="$( ( source "$lib"; qualify_stage_identity "$s" "$real" ) 2>&1 )"
  [ "$(cat "$s")" = keep ] && [ "$(cat "$s.source.sha256")" = abc ] && [ -z "$err" ]; r="$r d=$?"
  echo "$r"
}

good="$(cases "$LIB" good)"
for k in a b c d; do case "$good" in *" $k=0"*) chk 0 "($k) real lib behaves as specified";; *) chk 1 "($k) real lib behaves as specified [$good]";; esac; done

IDFN='/^qualify_stage_identity() {/,/^}/'
mut() { # <tag> <expect-red-case> <sed cmd>
  local tag="$1" want="$2" cmd="$3" out
  if ! sed_mutant "$LIB" "$T/lib-$tag.sh" "$IDFN$cmd"; then chk 1 "mutant $tag did not apply"; return; fi
  out="$(cases "$T/lib-$tag.sh" "$tag")"
  case "$out" in *" $want=1"*) chk 0 "negative control $tag: case ($want) red";; *) chk 1 "negative control $tag: case ($want) stayed green [$out]";; esac
}
mut a a 's/\[ "\$staged_sha" != "\$real_sha" \]/false/'
mut b b 's/\[ "\$staged_sha" != "\$real_sha" \]/true/'
mut c c 's/echo "qualify: staged identity file has no source stamp[^>]*>&2/:/'
mut d d 's/^  \[ -f "\$real_file" \] || return 0$/  :/'

echo "qualify-stage-identity: $pass passed, $fail failed"
[ "$fail" = 0 ] || fail "$fail case(s) failed (see FAIL: lines above)"
finalize_test
