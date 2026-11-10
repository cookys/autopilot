#!/usr/bin/env bash
# raw-log-seat-path.test.sh — seat/ledger files must not store a raw_log that starts
# with /home/ or /Users/. Under $HOME the stored form is ~/...; otherwise it is
# relative to the seat file's directory. Readers expand ~ and still open an old
# absolute path. Negative control: drop the helper call in hetero-review-loop.js
# and the seat file contains the absolute home path again.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/hetero-review-loop.js"
JURY="$REPO_ROOT/scripts/review-jury.js"
NODE="$(command -v node)"
R="$TEST_TMP/repo"
LEDGER="$TEST_TMP/ledger"
export RAWLOG_OUTSIDE="$TEST_TMP/seat-log-outside/dispatch-review-log-OUT"
export STUB_STDOUT_LOG="$TEST_TMP/stub-stdout.log"
mkdir -p "$R/scripts" "$(dirname "$RAWLOG_OUTSIDE")" "$HOME/.tmp"
printf 'home-log-body\n' > "$HOME/.tmp/dispatch-review-log-IN"
printf 'outside-log-body\n' > "$RAWLOG_OUTSIDE"
: > "$STUB_STDOUT_LOG"

(
  cd "$R"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo a > f.txt; git add f.txt; git commit -q -m c1
  git checkout -q -b work
  echo b >> f.txt; git add f.txt; git commit -q -m c2
)
BASE=$(git -C "$R" rev-parse HEAD~1)

cat > "$R/scripts/dispatch-review.sh" <<'STUB'
#!/usr/bin/env bash
case "$STUB_SEAT_ID" in
  s1) LOG="$RAWLOG_OUTSIDE" ;;
  *) LOG="$HOME/.tmp/dispatch-review-log-IN" ;;
esac
printf '%s\n' "$LOG" >> "$STUB_STDOUT_LOG"
node -e 'const log=process.argv[1]; process.stdout.write(JSON.stringify({status:"reviewed",verdict:"SHIP-AS-IS",findings:"",no_finding_proof:"checked=all; evidence=clean diff; conclusion=safe",raw_log:log,format_retry:{attempts:1,first_raw_log:log,first_reason:"fixture",outcome:"reviewed"}})+"\n")' "$LOG"
STUB
chmod +x "$R/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$R/scripts/dispatch-review.sh"
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-such-endpoints.env"
unset AUTOPILOT_ENDPOINT_GLM_URL AUTOPILOT_ENDPOINT_GLM_TOKEN ANTHROPIC_COMPATIBLE_BASE_URL ANTHROPIC_COMPATIBLE_AUTH_TOKEN
SEATS="gpt-5.4/low@codex,gpt-5.4/low@codex"

collect() { # <script> <ledger> <phase>
  node "$1" collect --implementer-engine claude-sonnet-5 --repo-root "$R" --ledger "$2" --phase "$3" --generation 1 --branch work --phase-base "$BASE" --seats "$SEATS" 2>&1
}

# A JSON string value whose text starts with /home/ or /Users/ (whole file, not one field).
scan_home_strings() {
  "$NODE" -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const re = /"(?:\\.|[^"\\])*"/g;
const bad = [];
let m;
while ((m = re.exec(text))) {
  let s;
  try { s = JSON.parse(m[0]); } catch { continue; }
  if (typeof s === "string" && (s === "/home" || s === "/Users" || s.startsWith("/home/") || s.startsWith("/Users/"))) bad.push(s);
}
if (bad.length) { process.stderr.write(bad.join("\n")); process.exit(1); }
' "$1"
}

OUT=$(collect "$SCRIPT" "$LEDGER" praw); RC=$?
assert_exit_code "$RC" "0" "collect exits 0"
GDIR="$LEDGER/review-praw/g1"
export RAWLOG_LEDGER_DIR="$GDIR"
export RAWLOG_HELPER="$REPO_ROOT/scripts/lib/raw-log-path.js"
assert_file_exists "$GDIR/seat-s0.json" "home-path seat file written"
assert_file_exists "$GDIR/seat-s1.json" "outside-home seat file written"
for seat in "$GDIR"/seat-*.json; do
  if SCAN=$(scan_home_strings "$seat" 2>&1); then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "seat $(basename "$seat") contains a string starting with /home/ or /Users/: ${SCAN}"
  fi
done
assert_contains "$(cat "$STUB_STDOUT_LOG")" "$HOME/.tmp/dispatch-review-log-IN" "dispatch stdout (stub) still prints the absolute home path"
assert_contains "$(cat "$STUB_STDOUT_LOG")" "$RAWLOG_OUTSIDE" "dispatch stdout (stub) still prints the outside absolute path"

S0=$("$NODE" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.raw_log+"\n"+j.format_retry.first_raw_log)' "$GDIR/seat-s0.json")
assert_eq "$S0" "$(printf '%s\n%s' '~/.tmp/dispatch-review-log-IN' '~/.tmp/dispatch-review-log-IN')" "seat s0 stores ~/ for raw_log and first_raw_log"

READER=$("$NODE" <<'JS'
const fs = require('fs');
const path = require('path');
const { resolveRawLog, portableRawLog } = require(process.env.RAWLOG_HELPER);
const home = process.env.HOME;
const ledgerDir = process.env.RAWLOG_LEDGER_DIR;
const outside = process.env.RAWLOG_OUTSIDE;
const homeLog = path.join(home, '.tmp', 'dispatch-review-log-IN');
const tilde = portableRawLog(homeLog, ledgerDir, home);
if (tilde !== '~/.tmp/dispatch-review-log-IN') { console.error('portable home ' + tilde); process.exit(1); }
const opened = resolveRawLog(tilde, ledgerDir, home);
if (opened !== homeLog) { console.error('resolve tilde ' + opened); process.exit(1); }
if (fs.readFileSync(opened, 'utf8') !== 'home-log-body\n') { console.error('tilde body'); process.exit(1); }
const resolvedOld = resolveRawLog(homeLog, ledgerDir, home);
if (resolvedOld !== path.resolve(homeLog)) { console.error('resolve abs ' + resolvedOld); process.exit(1); }
if (fs.readFileSync(resolvedOld, 'utf8') !== 'home-log-body\n') { console.error('abs body'); process.exit(1); }
const rel = portableRawLog(outside, ledgerDir, home);
if (path.isAbsolute(rel) || rel.includes('/home/') || rel.includes('/Users/')) { console.error('portable outside ' + rel); process.exit(1); }
const openedRel = resolveRawLog(rel, ledgerDir, home);
if (openedRel !== path.resolve(outside)) { console.error('resolve rel ' + openedRel); process.exit(1); }
if (fs.readFileSync(openedRel, 'utf8') !== 'outside-log-body\n') { console.error('rel body'); process.exit(1); }
if (portableRawLog('/tmp/dispatch-review-log-proof-fixture', undefined, home) !== '/tmp/dispatch-review-log-proof-fixture') {
  console.error('tmp must stay absolute when no ledger dir'); process.exit(1);
}
if (portableRawLog('/dev/null', undefined, home) !== '/dev/null') { console.error('devnull'); process.exit(1); }
const reviewed = { raw_log: tilde };
const returned = Object.prototype.hasOwnProperty.call(reviewed, 'raw_log') ? resolveRawLog(reviewed.raw_log, undefined, home) : null;
if (returned !== homeLog) { console.error('engine-style resolve ' + returned); process.exit(1); }
process.stdout.write('reader-ok\n');
JS
)
assert_eq "$READER" "reader-ok" "reader resolves a ~ value and an old absolute value"

# Jury seat file: raw_log under HOME, stderr_log left absolute under /tmp (not a home path).
rm -rf /tmp/rawlog-seat-path-jury-out
mkdir -p /tmp/rawlog-seat-path-jury-out "$TEST_TMP/jury-stubs" "$TEST_TMP/jury-fake"
printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP/jury-stubs/grok"
chmod +x "$TEST_TMP/jury-stubs/grok"
printf 'home-jury-body\n' > "$HOME/jury-raw.log"
cat > "$TEST_TMP/jury-fake-dispatch.sh" <<'FAKE'
#!/bin/sh
printf '%s\n' '{"runner":"x","model":"grok-4.7","status":"reviewed","verdict":"SHIP-AS-IS","findings":"FINDINGS: none","raw_log":"'"$HOME"'/jury-raw.log"}'
FAKE
chmod +x "$TEST_TMP/jury-fake-dispatch.sh"
cat > "$TEST_TMP/jury-fake-scorecard.js" <<'FAKE'
const a = process.argv; const e = a[a.indexOf('--engine') + 1];
console.log(JSON.stringify({ admission_status: e === 'grok-4.7' ? 'qualified' : 'no_record' }));
FAKE
echo "diff --git a/x b/x" > "$TEST_TMP/jury-pack.txt"
# One grok seat is below the jury minimum of two, so run exits 1 after the seat file is written.
env -i PATH="$TEST_TMP/jury-stubs:/usr/bin:/bin" HOME="$HOME" AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-such-endpoints.env" \
  "$NODE" "$JURY" run --pack "$TEST_TMP/jury-pack.txt" --dispatch-bin "$TEST_TMP/jury-fake-dispatch.sh" \
  --scorecard-bin "$TEST_TMP/jury-fake-scorecard.js" --out /tmp/rawlog-seat-path-jury-out \
  --seats grok --implementer-family anthropic > "$TEST_TMP/jury-stdout" 2> "$TEST_TMP/jury-stderr" < /dev/null
JSEAT=/tmp/rawlog-seat-path-jury-out/seats/grok.json
assert_file_exists "$JSEAT" "jury seat file written"
if SCAN=$(scan_home_strings "$JSEAT" 2>&1); then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "jury seat contains a string starting with /home/ or /Users/: ${SCAN}"
fi
JRAW=$("$NODE" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.raw_log+"\n"+j.stderr_log)' "$JSEAT")
assert_eq "$JRAW" "$(printf '%s\n%s' '~/jury-raw.log' '/tmp/rawlog-seat-path-jury-out/seats/grok.stderr.log')" "jury stores ~/ raw_log and leaves stderr_log absolute"
rm -rf /tmp/rawlog-seat-path-jury-out

# Negative control: one writer (hetero collect) without the helper call stores /home/ again.
MUT_ROOT="$TEST_TMP/mutscripts"
mkdir -p "$MUT_ROOT"
for f in "$REPO_ROOT/scripts"/*; do
  base=$(basename "$f")
  [ "$base" = "hetero-review-loop.js" ] && continue
  ln -s "$f" "$MUT_ROOT/$base"
done
if sed_mutant "$SCRIPT" "$MUT_ROOT/hetero-review-loop.js" '/portableRawLogInPlace(res.rawOutput, gDir);/d'; then
  : > "$STUB_STDOUT_LOG"
  MLEDGER="$TEST_TMP/ledger-mut"
  MOUT=$(collect "$MUT_ROOT/hetero-review-loop.js" "$MLEDGER" pneg); MRC=$?
  assert_exit_code "$MRC" "0" "negative control: mutant collect exits 0"
  MFILE="$MLEDGER/review-pneg/g1/seat-s0.json"
  assert_file_exists "$MFILE" "negative control: mutant seat written"
  assert_contains "$(cat "$MFILE")" "$HOME/.tmp/dispatch-review-log-IN" "negative control: stripped writer stores the absolute home path"
else
  fail "negative control: could not strip portableRawLogInPlace from hetero-review-loop.js"
fi

finalize_test
