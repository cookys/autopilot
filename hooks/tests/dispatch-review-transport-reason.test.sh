#!/usr/bin/env bash
# BL-0246: a codex seat whose transport fails (runner or cleanroom) must leave its reason in the
# no_verdict emission (exit_code, stage, secret-masked stderr_tail), and the final-panel seat
# store must persist it. Non-failing / non-transport no_verdict shapes stay unchanged.
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
