#!/usr/bin/env bash
# BL-0246: a codex seat whose transport fails (runner or cleanroom) must leave its reason in the
# no_verdict emission (exit_code, stage, secret-masked stderr_tail), and the final-panel seat
# store must persist it. Non-failing / non-transport no_verdict shapes stay unchanged.
# RED at 18a4ca621 (g2): 3 FAIL of 22 - a final stderr line over 8000 bytes blanks stderr_tail.
# RED at 2f4157c7c (cut before mask): 4 FAIL of 18 - key fragment survives the 2000-byte cut (x2), token=x expansion gives len 4240 > 2000, schema rejects.
# RED at f1749e8a6: 8 FAIL (5 passed) - exit_code/stage/stderr_tail absent from runner and cleanroom no_verdict (expected "<undef>", got "3"/"5"),
#   and store.recordFailure is not a function.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

SECRET='sk-abcdef0123456789ABCDEF0123456789'
STUB="$TEST_TMP/stub-codex"
cat > "$STUB" <<EOS
#!/usr/bin/env bash
cat >/dev/null
echo "line1 harmless" >&2
echo "auth failed token=$SECRET Authorization: Bearer abcdefgh12345678" >&2
exit 3
EOS
chmod +x "$STUB"
field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));const v=j[process.argv[1]];process.stdout.write(v===undefined?"<undef>":String(v))})' "$2"; }

OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB" 2>/dev/null)"
assert_eq "no_verdict" "$(field "$OUT" status)" "runner failure is no_verdict"
assert_eq "3" "$(field "$OUT" exit_code)" "runner failure carries exit_code"
assert_eq "runner" "$(field "$OUT" stage)" "runner failure carries stage runner"
TAIL="$(field "$OUT" stderr_tail)"
assert_contains "$TAIL" "line1 harmless" "stderr tail keeps the harmless text"
assert_not_contains "$TAIL" "$SECRET" "stderr tail masks the sk- key"
assert_not_contains "$TAIL" "abcdefgh12345678" "stderr tail masks the bearer token"
assert_contains "$TAIL" "[REDACTED]" "stderr tail shows the mask"

# cleanroom stage: stub launcher writes stderr and exits non-zero
PKT="$TEST_TMP/pkt"; mkdir -p "$PKT/tree"; printf '{}\n' > "$PKT/MANIFEST.json"; printf 'x\n' > "$PKT/tree/README.md"
FAKE_BWRAP="$TEST_TMP/fake-bwrap"; printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BWRAP"; chmod +x "$FAKE_BWRAP"
LAUNCHER="$TEST_TMP/stub-launcher"
cat > "$LAUNCHER" <<EOS
#!/usr/bin/env bash
for a in "\$@"; do [ "\$a" = "--preflight" ] && { printf '{}\\n'; exit 0; }; done
while [ \$# -gt 0 ]; do case "\$1" in --err) ERR="\$2"; shift;; esac; shift; done
echo "bwrap: setting up uid map: Permission denied api_key=$SECRET" > "\$ERR"
exit 5
EOS
chmod +x "$LAUNCHER"
CR_BINDIR="$TEST_TMP/cr-bin"; mkdir -p "$CR_BINDIR"; printf '#!/usr/bin/env bash\nexit 99\n' > "$CR_BINDIR/codex"
chmod +x "$CR_BINDIR/codex"; printf 'host\n' > "$CR_BINDIR/codex-code-mode-host"
CR_AUTH="$TEST_TMP/cr-auth.json"; printf '{"dummy":true}\n' > "$CR_AUTH"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" \
  AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" AUTOPILOT_CLEANROOM_CODEX_AUTH="$CR_AUTH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
  "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$CR_BINDIR/codex" 2>/dev/null)"
assert_eq "no_verdict" "$(field "$OUT" status)" "cleanroom failure is no_verdict"
assert_eq "5" "$(field "$OUT" exit_code)" "cleanroom failure carries exit_code"
assert_eq "cleanroom" "$(field "$OUT" stage)" "cleanroom failure carries stage cleanroom"
TAIL="$(field "$OUT" stderr_tail)"
SCHEMA_DOC="$TEST_TMP/cr-result.json"; printf '%s\n' "$OUT" > "$SCHEMA_DOC"
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$REPO_ROOT/schemas/review-result.schema.json" --document "$SCHEMA_DOC" >/dev/null 2>&1
assert_exit_code "$?" "0" "cleanroom no_verdict with failure fields validates against review-result schema"
assert_contains "$TAIL" "Permission denied" "cleanroom stderr tail kept"
assert_not_contains "$TAIL" "$SECRET" "cleanroom stderr tail masks the key"

# BL-0246 g1: mask before the final cut. (1) a key straddling the 2000-byte boundary leaves no fragment;
# (2) masking that EXPANDS the text still ends <= 2000 and validates against the schema.
STUB2="$TEST_TMP/stub-codex-boundary"
cat > "$STUB2" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
# 40-char sk- key followed by exactly 1980 bytes: the last-2000 cut lands 20 chars into the key.
printf 'pre sk-ZZaaBBbbCCccDDddEEeeFFffGGggHHhh01\n' >&2
for i in $(seq 1 659); do printf 'ab ' >&2; done
printf 'x\n' >&2
exit 3
EOS
chmod +x "$STUB2"
OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB2" 2>/dev/null)"
TAIL="$(field "$OUT" stderr_tail)"
assert_not_contains "$TAIL" "GGggHHhh01" "no key fragment survives the cut (tail of key)"
assert_not_contains "$TAIL" "EEeeFFffGG" "no key fragment survives the cut (middle of key)"
STUB3="$TEST_TMP/stub-codex-expand"
cat > "$STUB3" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
for i in $(seq 1 400); do printf 'token=x ' >&2; done
echo >&2
exit 3
EOS
chmod +x "$STUB3"
OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB3" 2>/dev/null)"
TAIL="$(field "$OUT" stderr_tail)"
assert_eq "ok" "$([ "${#TAIL}" -le 2000 ] && echo ok || echo "len ${#TAIL}")" "expanded mask output is capped at 2000"
printf '%s\n' "$OUT" > "$TEST_TMP/long-result.json"
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$REPO_ROOT/schemas/review-result.schema.json" --document "$TEST_TMP/long-result.json" >/dev/null 2>&1
assert_exit_code "$?" "0" "expanded-mask result validates against review-result schema"

# BL-0246 g2: a final stderr line longer than the 8000-byte work cap must not blank the tail.
# (a) one 10000-byte line ending in recognisable text keeps that text, <= 2000.
# (b) when the 8000-byte window starts inside a key, the stranded fragment does not survive.
STUB4="$TEST_TMP/stub-codex-longline"
cat > "$STUB4" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
for i in $(seq 1 3330); do printf 'ab ' >&2; done
printf 'ENDMARK-long-line' >&2
exit 3
EOS
chmod +x "$STUB4"
OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB4" 2>/dev/null)"
TAIL="$(field "$OUT" stderr_tail)"
assert_contains "$TAIL" "ENDMARK-long-line" "single line over 8000 bytes still leaves its ending in stderr_tail"
assert_eq "ok" "$([ -n "$TAIL" ] && [ "${#TAIL}" -le 2000 ] && echo ok || echo "len ${#TAIL}")" "long-line tail is non-empty and <= 2000"
KEY='sk-TESTONLYQrstuvwxyzMNOPQRSTUVWXYZ01234'
STUB5="$TEST_TMP/stub-codex-window-key"
cat > "$STUB5" <<EOS
#!/usr/bin/env bash
cat >/dev/null
# 1980 filler + 40-char key + 7980 filler = 10000 bytes: the 8000-byte window starts 20 chars into the key.
for i in \$(seq 1 660); do printf 'ab ' >&2; done
printf '%s' '$KEY' >&2
for i in \$(seq 1 2660); do printf 'ab ' >&2; done
exit 3
EOS
chmod +x "$STUB5"
OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB5" 2>/dev/null)"
TAIL="$(field "$OUT" stderr_tail)"
FRAG="${KEY:20}"; LEAK=none
for ((i=0; i+8<=${#FRAG}; i++)); do case "$TAIL" in *"${FRAG:i:8}"*) LEAK="${FRAG:i:8}";; esac; done
assert_eq "none" "$LEAK" "no 8-char piece of a window-cut key survives"
assert_eq "ok" "$([ -n "$TAIL" ] && echo ok || echo empty)" "window-cut key case still leaves a tail"

# BL-0246 g3: the byte cuts must land on UTF-8 character boundaries; stdout must stay strict UTF-8 JSON.
# RED at 07cfaf639: utf8-8000 -> 'utf-8' codec can't decode byte 0xad ... invalid start byte; utf8-2000 likewise.
for N in 10000 1000; do
  STUBU="$TEST_TMP/stub-codex-utf8-$N"
  cat > "$STUBU" <<EOS
#!/usr/bin/env bash
cat >/dev/null
python3 -c "import sys; sys.stderr.buffer.write(('中'*$N+' END').encode())"
exit 3
EOS
  chmod +x "$STUBU"
  AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUBU" > "$TEST_TMP/utf8-$N.json" 2>/dev/null
  UCHK="$(python3 -I - "$TEST_TMP/utf8-$N.json" <<'PY'
import sys, json
try:
    t = json.loads(open(sys.argv[1], 'rb').read().decode('utf-8', errors='strict')).get('stderr_tail', '')
    print('ok' if t.endswith(' END') and 0 < len(t.encode()) <= 2000 else 'bad-tail:%d' % len(t.encode()))
except Exception as e:
    print('invalid:%s' % e)
PY
)"
  assert_eq "ok" "$UCHK" "multibyte stderr ($N chars) -> strict UTF-8 JSON, tail ends with END, <= 2000 bytes"
done

# store persists the reason, bounded, and keeps result null (never reusable)
SOUT="$(node - "$REPO_ROOT" "$TEST_TMP/seats" "$SECRET" <<'NODE'
const path = require('path'); const fs = require('fs');
const [root, rootd, secret] = process.argv.slice(2);
const store = require(path.join(root, 'src', 'engine', 'final-panel-seat-store'));
const ctx = { root: rootd, campaignId: 'c1', inputBinding: 'a'.repeat(64), station: 'panel', seatIndex: 0,
  seat: { runner: 'codex', model: 'm', effort: 'high', endpoint: null, family: 'openai' } };
const ok = store.recordFailure(ctx, 1, { exit_code: 5, stage: 'cleanroom', stderr_tail: 'x'.repeat(5000) + 'END' });
const art = JSON.parse(fs.readFileSync(store.seatFile(ctx), 'utf8'));
process.stdout.write([ok, art.result === null, art.failure.exit_code, art.failure.stage,
  art.failure.stderr_tail.length, art.failure.stderr_tail.endsWith('END'),
  store.recordFailure(ctx, 1, {})].join(','));
NODE
)"
assert_eq "true,true,5,cleanroom,2000,true,false" "$SOUT" "store records bounded failure, result stays null, empty outcome refused"
finalize_test
