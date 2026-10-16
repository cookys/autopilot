#!/usr/bin/env bash
# BL-0099: with a controlling tty, job control must not stop a worker that reads /dev/tty.
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
command -v script >/dev/null 2>&1 || { echo "SKIP: script(1) missing"; exit 0; }

# Pull the real helpers out of the production script.
HELPERS="$TEST_TMP/helpers.sh"
sed -n '/^_job_control_on() {/,/^}/p;/^_job_control_off() {/,/^}/p' "$SCRIPT" > "$HELPERS"
[ -s "$HELPERS" ] || fail "helpers not found in dispatch-hetero.sh"

run_case() { # $1 = helpers file ; prints worker ps state after 1s
  local helpers="$1" out="$TEST_TMP/out.$RANDOM" drv="$TEST_TMP/drv.$RANDOM.sh"
  cat > "$drv" <<DRV
#!/bin/bash
. "$helpers"
_job_control_on
( head -c1 /dev/tty >/dev/null 2>&1; echo done ) >/dev/null 2>&1 &
p=\$!
_job_control_off
sleep 1
echo "STATE=\$(ps -o stat= -p \$p 2>/dev/null | tr -d ' ')" > "$out"
kill -9 \$p 2>/dev/null; true
DRV
  chmod +x "$drv"
  script -qec "$drv" /dev/null >/dev/null 2>&1 </dev/null
  cat "$out" 2>/dev/null
}

got="$(run_case "$HELPERS")"
case "$got" in STATE=T*) fail "worker stopped by SIGTTIN: $got" ;; STATE=*) ;; *) fail "no state captured" ;; esac
assert_not_contains "$got" "STATE=T" "guarded worker is not stopped"

# Negative control: bare set -m (the old behaviour) must stop the worker.
OLD="$TEST_TMP/old.sh"
printf '_job_control_on() { set -m; }\n_job_control_off() { set +m; }\n' > "$OLD"
got_old="$(run_case "$OLD")"
assert_contains "$got_old" "STATE=T" "negative control: bare set -m stops the worker"

# The production launch sites use the helpers, not bare set -m.
assert_eq "$(grep -c '^ *set -m' "$SCRIPT" | tr -d ' ')" "1" "only the helper calls set -m"
finalize_test
