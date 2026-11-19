#!/usr/bin/env bash
export AUTOPILOT_TEST_CN_GATE_OFF=1  # cn-model gate: sentinel dispatch tests carry no Size/Role/Scope
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
# hooks/tests/outbound-secret-scan.test.sh
# scripts/lib/outbound-secret-scan.js + its wiring in dispatch-review.sh / dispatch-author.sh.
# Every fake token is built at runtime so no fixture in the repo looks like a real credential.
# Nothing real is sent: runners are stubs that touch a sentinel when invoked.
. "$(dirname "$0")/lib.sh"

SCAN="$REPO_ROOT/scripts/lib/outbound-secret-scan.js"
export AUTOPILOT_OUTBOUND_SCAN_ALLOW="$TEST_TMP/allow-none"   # absent file: empty allowlist

rep() { head -c "$2" < /dev/zero | tr '\0' "$1"; }   # rep CHAR COUNT

# Fake tokens (runtime-built)
GHP="gh""p_$(rep a 36)"
SKP="s""k-$(rep b 24)"
XOX="xo""xb-$(rep 1 12)-$(rep c 12)"
PEM="-----BEGIN ""RSA PRIVATE KEY-----"
BEARER="Bearer $(rep Q 30)"
# Long runs must look random (a repeated-character filler is not a key): sha256 hex chained 9x = 576 hex chars.
LONGHEX="$(for i in 1 2 3 4 5 6 7 8 9; do printf '%s' "$i" | sha256sum | cut -c1-64; done | tr -d '\n')"
LONGB64="$(printf '%s' "$LONGHEX" | base64 -w0 | tr -d '=')"
NUMS="$(seq -s, 1 70)"
KEY44="$(rep A 20)$(rep 5 22)z="            # 43 chars + '=' with digits

run_scan() { # run_scan NAME CONTENT [expected_category]
  local f="$TEST_TMP/p-$1.txt"
  printf 'line one\n%s\nline three\n' "$2" > "$f"
  SCAN_OUT="$(node "$SCAN" "$f" 2>&1)"; SCAN_RC=$?
}

check_hit() { # check_hit NAME CONTENT CATEGORY TOKEN
  run_scan "$1" "$2"
  assert_eq "1" "$SCAN_RC" "$1: exit 1"
  assert_contains "$SCAN_OUT" ":2: $3" "$1: category $3 at line 2"
  [ -z "$4" ] || assert_not_contains "$SCAN_OUT" "$4" "$1: matched text must not be printed"
}

check_hit pem "$PEM" pem_key "$PEM"
check_hit bearer "Authorization: $BEARER" bearer_token "$BEARER"
check_hit ghp "x=$GHP" token_prefix "$GHP"
check_hit sk "x=$SKP" token_prefix "$SKP"
check_hit xox "x=$XOX" token_prefix "$XOX"
check_hit b64 "$LONGB64" long_base64 "$LONGB64"
check_hit hex "$LONGHEX" long_hex "$LONGHEX"
check_hit nums "[$NUMS]" number_run "$NUMS"
check_hit key32 "key: $KEY44" b64_key32 "$KEY44"

# filler is not a key: a 150000-char repeated-letter run (padding / size tests) is clean ...
run_scan filler "$(rep y 150000)"; assert_eq "0" "$SCAN_RC" "repeated-letter filler: clean"
run_scan filler-hex "$(rep a 600)"; assert_eq "0" "$SCAN_RC" "repeated-hex filler: clean"
# ... but random key material hidden inside filler is still a hit (negative control)
run_scan filler-key "$(rep y 5000)${LONGHEX}$(rep y 5000)"; assert_eq "1" "$SCAN_RC" "random key inside filler: hit"
assert_contains "$SCAN_OUT" ":2: " "random key inside filler: reported at its line"
# negative control: a fake AWS-shaped key (AKIA + 16 capitals, synthetic) in plain text
run_scan akia "k=AK""IA$(rep Q 16)"; assert_eq "1" "$SCAN_RC" "fake AWS-shaped key: hit"
assert_contains "$SCAN_OUT" "token_prefix" "fake AWS-shaped key: token_prefix"

# scripts/ copied without hooks/: no crash into "unreadable"; local shapes still scan, stderr says the prefix list is skipped
NOH="$TEST_TMP/nohooks/scripts/lib"; mkdir -p "$NOH"; cp "$SCAN" "$NOH/"
printf 'plain text\n' > "$TEST_TMP/nh-clean.txt"; NH_OUT="$(node "$NOH/outbound-secret-scan.js" "$TEST_TMP/nh-clean.txt" 2>&1)"
assert_eq "0" "$?" "copy without hooks/: clean file exits 0, not unreadable"
assert_contains "$NH_OUT" "token-prefix list skipped" "copy without hooks/: stderr names the missing list"
printf '%s\n' "$LONGHEX" > "$TEST_TMP/nh-key.txt"; node "$NOH/outbound-secret-scan.js" "$TEST_TMP/nh-key.txt" >/dev/null 2>&1
assert_eq "1" "$?" "copy without hooks/: a random long run is still a hit"

# 63 numbers is not a run; 64 is
run_scan nums63 "$(seq -s, 1 63)"; assert_eq "0" "$SCAN_RC" "63 numbers: clean"
run_scan nums64 "$(seq -s, 1 64)"; assert_eq "1" "$SCAN_RC" "64 numbers: hit"

# binary (NUL / invalid UTF-8): scanned as latin1, passes when clean, one stderr reason line; only a missing file is unreadable
printf 'ab\0cd\n' > "$TEST_TMP/nul.txt"; BIN_OUT="$(node "$SCAN" "$TEST_TMP/nul.txt" 2>&1)"
assert_eq "0" "$?" "NUL input: clean binary passes (exit 0)"
assert_contains "$BIN_OUT" "binary payload" "NUL input: one reason line on stderr"
printf 'ab\xff\xfecd\n' > "$TEST_TMP/bad8.txt"; node "$SCAN" "$TEST_TMP/bad8.txt" >/dev/null 2>&1
assert_eq "0" "$?" "non-UTF-8 input: clean binary passes (exit 0)"
# negative control: a fake AWS-shaped key (AKIA + 16 capitals, synthetic) hidden inside a binary payload is still a hit
{ printf '\x89PNG\r\n\x1a\n\0\0\0\rIHDR'; printf 'AK''IA%s' "$(rep Q 16)"; printf '\0\xff\xfe'; } > "$TEST_TMP/png-key.bin"
BK_OUT="$(node "$SCAN" "$TEST_TMP/png-key.bin" 2>&1)"; assert_eq "1" "$?" "binary payload with a fake AWS-shaped key: still a hit"
assert_contains "$BK_OUT" "token_prefix" "binary payload: category token_prefix"
node "$SCAN" "$TEST_TMP/missing.txt" >/dev/null 2>&1
assert_eq "2" "$?" "missing file: exit 2"

# --- replay of alfred's 7 audit hits (synthetic shapes) ---
# A x4: 43-char letters-only camelCase identifier (8 humps) -> NOT a hit
IDENT="fooBarBazQuxQuuxCorgeGraultGarplyWaldoFredPlugh"; IDENT="${IDENT:0:43}"
assert_eq "43" "${#IDENT}" "A: identifier is 43 chars"
run_scan identA "fun \`$IDENT\`() = runTest { }"
assert_eq "0" "$SCAN_RC" "A: letters-only 43-char identifier is not a hit"
# B x1: 43 'A' + '=' in a JSON wg_pubkey field -> NOT a hit
run_scan pubB "{\"wg_pubkey\": \"$(rep A 43)=\"}"
assert_eq "0" "$SCAN_RC" "B: all-A pubkey placeholder is not a hit"
# C x2: 44-char mixed-case base64 with digits ending '=' in a nonce field -> HIT; allowlisted token -> clean
NONCE_TOK="Ab3dEf6hIj9lMn2pQr5tUv8xYz1BcDeFgHiJkLmNoPq"; NONCE_TOK="${NONCE_TOK:0:43}="
assert_eq "44" "${#NONCE_TOK}" "C: nonce token is 44 chars"
run_scan nonceC "{\"nonce\": \"$NONCE_TOK\"}"
assert_eq "1" "$SCAN_RC" "C: nonce-shaped key is a hit"
assert_contains "$SCAN_OUT" ":2: b64_key32" "C: category b64_key32"
assert_not_contains "$SCAN_OUT" "$NONCE_TOK" "C: token text never printed"
TOKSHA="$(printf '%s' "$NONCE_TOK" | sha256sum | cut -d' ' -f1)"
printf '# known-public vector\n%s b64_key32 public test nonce\n' "$TOKSHA" > "$TEST_TMP/allow-c"
AUTOPILOT_OUTBOUND_SCAN_ALLOW="$TEST_TMP/allow-c" node "$SCAN" "$TEST_TMP/p-nonceC.txt" >/dev/null 2>&1
assert_eq "0" "$?" "C: allowlisted token sha is clean"
# the allowlist covers the token only: a second, different key in the same file still hits
printf 'x\n%s\n%s\n' "$NONCE_TOK" "k: $KEY44" > "$TEST_TMP/p-two.txt"
AUTOPILOT_OUTBOUND_SCAN_ALLOW="$TEST_TMP/allow-c" node "$SCAN" "$TEST_TMP/p-two.txt" >/dev/null 2>&1
assert_eq "1" "$?" "allowlist is per token, rest of file stays scanned"
# wrong category in the allowlist does not exempt
printf '%s long_hex wrong category\n' "$TOKSHA" > "$TEST_TMP/allow-wrong"
AUTOPILOT_OUTBOUND_SCAN_ALLOW="$TEST_TMP/allow-wrong" node "$SCAN" "$TEST_TMP/p-nonceC.txt" >/dev/null 2>&1
assert_eq "1" "$?" "allowlist entry for another category does not exempt"

# Allowlisted token A and a different token B on the SAME line: B is still a hit.
GHP_B="gh""p_$(rep b 36)"
GHP_SHA="$(printf '%s' "$GHP" | sha256sum | cut -d' ' -f1)"
printf '%s token_prefix public test vector\n' "$GHP_SHA" > "$TEST_TMP/allow-ab"
printf 'pair %s %s\n' "$GHP" "$GHP_B" > "$TEST_TMP/p-ab.txt"
AB_OUT="$(AUTOPILOT_OUTBOUND_SCAN_ALLOW="$TEST_TMP/allow-ab" node "$SCAN" "$TEST_TMP/p-ab.txt" 2>&1)"; AB_RC=$?
assert_eq "1" "$AB_RC" "same line: allowlisted A does not hide B"
assert_contains "$AB_OUT" ":1: token_prefix" "same line: B is token_prefix"
assert_not_contains "$AB_OUT" "$GHP" "same line: token A not printed"
assert_not_contains "$AB_OUT" "$GHP_B" "same line: token B not printed"

# --- dispatch-review.sh: fake ghp_ token in the diff -> refused, stub never invoked ---
REVIEW_STUB="$TEST_TMP/review-stub.sh"
cat > "$REVIEW_STUB" <<'EOF'
#!/usr/bin/env bash
touch "$SENTINEL"
exit 0
EOF
chmod +x "$REVIEW_STUB"
export SENTINEL="$TEST_TMP/sentinel"
printf 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-const a = 1\n+const a = "%s"\n' "$GHP" > "$TEST_TMP/leak.diff"
rm -f "$SENTINEL"
RV_OUT="$(DISPATCH_QUIET=1 bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/leak.diff" --bin "$REVIEW_STUB" 2>&1)"; RV_RC=$?
assert_neq "0" "$RV_RC" "review: leaked token refuses the dispatch"
assert_file_absent "$SENTINEL" "review: stub runner never invoked"
assert_contains "$RV_OUT" "outbound_secret: token_prefix" "review: reason names the category"
assert_not_contains "$RV_OUT" "$GHP" "review: token text not in output"

# regression: a clean diff of padding filler (150000 repeated letters) reaches the runner, a PNG-bearing prompt too
printf 'diff --git a/p b/p\n+%s\n' "$(rep y 150000)" > "$TEST_TMP/filler.diff"
rm -f "$SENTINEL"
DISPATCH_QUIET=1 bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/filler.diff" --bin "$REVIEW_STUB" >/dev/null 2>&1
assert_file_exists "$SENTINEL" "review: filler diff is not refused, stub runner invoked"

# --- dispatch-author.sh: same ---
printf 'Write a config. Use this token: %s\n' "$GHP" > "$TEST_TMP/leak-prompt.txt"
rm -f "$SENTINEL"
AU_OUT="$(DISPATCH_QUIET=1 bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex --model gpt-test --prompt-file "$TEST_TMP/leak-prompt.txt" --bin "$REVIEW_STUB" 2>&1)"; AU_RC=$?
assert_eq "3" "$AU_RC" "author: leaked token is runner_failed (exit 3)"
assert_file_absent "$SENTINEL" "author: stub runner never invoked"
assert_contains "$AU_OUT" "\"status\": \"runner_failed\"" "author: status runner_failed"
assert_contains "$AU_OUT" "outbound_secret: token_prefix" "author: reason names the category"
assert_not_contains "$AU_OUT" "$GHP" "author: token text not in output"

# --- dispatch-hetero.sh: brief with a fake token is a no-spawn failure; stub never runs ---
# PATH is only the stub dir plus the dirs of node/git/bash, so no real engine CLI is reachable.
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
HSTUB_DIR="$TEST_TMP/hetero-path"
mkdir -p "$HSTUB_DIR"
cat > "$HSTUB_DIR/grok" <<'EOF'
#!/usr/bin/env bash
touch "$SENTINEL"
exit 0
EOF
chmod +x "$HSTUB_DIR/grok"
_keep_path="$(dirname "$(command -v node)"):$(dirname "$(command -v git)"):$(dirname "$(command -v bash)"):/usr/bin:/bin"
HREPO="$TEST_TMP/hetero-repo"
mkdir -p "$HREPO"
git -C "$HREPO" init -q -b develop
git -C "$HREPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
printf 'Write a config. Use this token: %s\n' "$GHP" > "$TEST_TMP/hetero-leak.txt"
rm -f "$SENTINEL"
HT_OUT="$(cd "$HREPO" && env -u AUTOPILOT_GROK_EFFORT_PROBE \
  DISPATCH_QUIET=1 PATH="$HSTUB_DIR:$_keep_path" \
  bash "$HETERO" --no-verify-tip --runner grok --model grok-test \
  --grok-bin "$HSTUB_DIR/grok" --prompt-file "$TEST_TMP/hetero-leak.txt" \
  --branch hands/outbound-scan --context-window off 2>&1)"; HT_RC=$?
assert_eq "2" "$HT_RC" "hetero: leaked token is precondition_failed (exit 2), no spawn"
assert_file_absent "$SENTINEL" "hetero: stub runner never invoked"
assert_contains "$HT_OUT" "outbound_secret: token_prefix" "hetero: reason names the category"
assert_not_contains "$HT_OUT" "$GHP" "hetero: token text not in output"

finalize_test
