#!/usr/bin/env bash
# BL-0256: the run-ledger rotation cap comes ONLY from run_ledger.max_rotations in the operator config.
# The RUN_LEDGER_MAX_ROTATIONS environment variable (sweep/test environment) must not change it.
# RED at 1c7d6a374 (scripts/run-ledger.sh and src/ unfixed, new resolver module present): 9 FAIL, e.g.
#   env=1 no config: writer keeps segments up to .4: expected '4', got '1'
#   config=2 env=7: writer keeps segments up to .2: expected '2', got '7'
#   campaign cli scan follows config (.2 .1 live), ignores env=1 and the stray .3: expected '3', got '2'
#   bad config ...: shell resolver is 4: expected '4', got ''   (x6, no shell resolver on base)
. "$(dirname "$0")/lib.sh"

RL="$REPO_ROOT/scripts/run-ledger.sh"
CFG="$TEST_TMP/cfg.json"
export AUTOPILOT_CONFIG_FILE="$CFG"
unset RUN_LEDGER_MAX_ROTATIONS

resolver() { node "$REPO_ROOT/scripts/lib/run-ledger-config.js" < /dev/null; }

# Fill a fresh ledger with many forced rotations; print the highest rotated segment index present.
highest_segment() {
  local ledger="$TEST_TMP/hs-$1.jsonl" i hi=0
  shift
  bash "$RL" init --ledger "$ledger" >/dev/null
  for i in 1 2 3 4 5 6 7 8 9; do
    env "$@" RUN_LEDGER_MAX_BYTES=1 bash "$RL" stage-acquire --ledger "$ledger" --run-id "camp-$i" \
      --stage campaign --pid $$ --resources "campaign:camp-$i" >/dev/null 2>&1 || true
  done
  for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "$ledger.$i" ] && hi=$i; done
  printf '%s' "$hi"
}

# 1. env only, no config -> default 4 (base: 1)
rm -f "$CFG"
assert_eq "$(RUN_LEDGER_MAX_ROTATIONS=1 resolver)" "4" "env=1 no config: resolver is 4"
assert_eq "$(highest_segment envonly RUN_LEDGER_MAX_ROTATIONS=1)" "4" "env=1 no config: writer keeps segments up to .4"

# 2. config 2 -> 2, even with a contradicting env
printf '{"run_ledger":{"max_rotations":2}}\n' > "$CFG"
assert_eq "$(resolver)" "2" "config=2: resolver is 2"
assert_eq "$(RUN_LEDGER_MAX_ROTATIONS=7 resolver)" "2" "config=2 env=7: resolver is 2"
assert_eq "$(highest_segment cfg2 RUN_LEDGER_MAX_ROTATIONS=7)" "2" "config=2 env=7: writer keeps segments up to .2"

# 3. readers follow the config, not the env
READ="$(RUN_LEDGER_MAX_ROTATIONS=1 node -e '
const { maxRotations } = require(process.argv[1] + "/scripts/lib/run-ledger-config.js");
process.stdout.write(String(maxRotations()));' "$REPO_ROOT" < /dev/null)"
assert_eq "$READ" "2" "reader (module) follows config under env=1"
CLI="$(RUN_LEDGER_MAX_ROTATIONS=1 node -e '
const cli = require(process.argv[1] + "/src/campaign/cli");
const fs = require("fs"); const p = process.argv[2];
for (const s of ["", ".1", ".2", ".3"]) fs.writeFileSync(p + s, "{}\n");
process.stdout.write(String(cli.ledgerScanFiles(p).length));' "$REPO_ROOT" "$TEST_TMP/scan.jsonl" < /dev/null)"
assert_eq "$CLI" "3" "campaign cli scan follows config (.2 .1 live), ignores env=1 and the stray .3"

# 4. malformed / out-of-range config -> 4
for bad in '{"run_ledger":{"max_rotations":0}}' '{"run_ledger":{"max_rotations":65}}' '{"run_ledger":{"max_rotations":"2"}}' '{"run_ledger":{"max_rotations":1.5}}' '{"run_ledger":3}' 'not json'; do
  printf '%s\n' "$bad" > "$CFG"
  assert_eq "$(resolver)" "4" "bad config $bad: resolver is 4"
  assert_eq "$(RUN_LEDGER_MAX_BYTES=1 bash -c '. <(sed -n "/^_run_ledger_cfg_max_rotations()/,/^}/p" "$0"); _run_ledger_cfg_max_rotations' "$RL")" "4" "bad config $bad: shell resolver is 4"
done

finalize_test
