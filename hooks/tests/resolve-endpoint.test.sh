#!/usr/bin/env bash
# Tests for scripts/resolve-endpoint.sh + the additive --endpoint / --token-env
# credential wiring in dispatch-hetero.sh / dispatch-review.sh / dispatch-anthropic-review.js.
. "$(dirname "$0")/lib.sh"

R="$REPO_ROOT/scripts/resolve-endpoint.sh"
DH="$REPO_ROOT/scripts/dispatch-hetero.sh"
DR="$REPO_ROOT/scripts/dispatch-review.sh"
JS="$REPO_ROOT/scripts/dispatch-anthropic-review.js"

jvalid() { node -e "JSON.parse(process.argv[1])" "$1" >/dev/null 2>&1; }

# ── resolve-endpoint.sh ─────────────────────────────────────────────

# 1. namespace hit
out="$(env -i AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example/anthropic AUTOPILOT_ENDPOINT_GLM_TOKEN=sekret123 bash "$R" glm)"; ec=$?
assert_exit_code "$ec" 0 "namespace hit exits 0"
jvalid "$out" && assert_eq ok ok "namespace JSON valid" || fail "namespace JSON invalid: $out"
assert_contains "$out" '"ready":true' "namespace ready"
assert_contains "$out" '"source":"autopilot-namespace"' "namespace source"
assert_contains "$out" '"token_env":"AUTOPILOT_ENDPOINT_GLM_TOKEN"' "namespace token_env name"
assert_not_contains "$out" 'sekret123' "no token value in output"

# 2. minimax provider-native (default url)
out="$(env -i MINIMAX_API_KEY=mmkey bash "$R" minimax)"; ec=$?
assert_exit_code "$ec" 0 "minimax exits 0"
assert_contains "$out" '"source":"provider-native"' "minimax provider-native"
assert_contains "$out" 'api.minimax.io' "minimax default url"
assert_not_contains "$out" 'mmkey' "minimax no token leak"

# 3. ATOMIC no-fail-open: GLM url set, token UNSET, generic token SET → must NOT cross-combine
out="$(env -i AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example ANTHROPIC_COMPATIBLE_AUTH_TOKEN=generictok bash "$R" glm)"; ec=$?
assert_exit_code "$ec" 1 "partial namespaced config not-ready"
assert_contains "$out" '"ready":false' "partial ready:false"
assert_contains "$out" '"source":"autopilot-namespace"' "partial stays namespace (no cross-combine)"
assert_contains "$out" 'AUTOPILOT_ENDPOINT_GLM_TOKEN' "partial names missing token var"
assert_not_contains "$out" 'generictok' "partial did not grab generic token"
jvalid "$out" && assert_eq ok ok "partial JSON valid (missing array)" || fail "partial JSON invalid: $out"

# 3b. set-but-EMPTY namespaced var must trigger candidate 1 (no fall-through to generic) — R2
out="$(env -i AUTOPILOT_ENDPOINT_GLM_URL= ANTHROPIC_COMPATIBLE_BASE_URL=https://generic.example ANTHROPIC_COMPATIBLE_AUTH_TOKEN=gtok bash "$R" glm)"; ec=$?
assert_exit_code "$ec" 1 "set-but-empty namespaced var → not-ready"
assert_contains "$out" '"source":"autopilot-namespace"' "set-but-empty stays namespace (no generic fall-through)"
assert_not_contains "$out" 'generic.example' "set-but-empty did not grab generic url"
assert_not_contains "$out" 'gtok' "set-but-empty did not grab generic token"

# 4. url-safety
out="$(env -i AUTOPILOT_ENDPOINT_X_URL=http://evil.example AUTOPILOT_ENDPOINT_X_TOKEN=t bash "$R" x)"; ec=$?
assert_exit_code "$ec" 1 "http remote not-ready"
assert_contains "$out" '"url_safe":false' "http remote url_safe:false"
assert_contains "$out" 'url_unsafe' "http remote missing url_unsafe"
out="$(env -i AUTOPILOT_ENDPOINT_X_URL=http://127.0.0.1:4000 AUTOPILOT_ENDPOINT_X_TOKEN=t bash "$R" x)"
assert_contains "$out" '"url_safe":true' "loopback http url_safe:true"
# 4b. crafted url (embedded newline + quote) → rejected + STILL valid single-line JSON (R6)
cc_url="$(printf 'https://evil\n"ready":true')"
out="$(env -i AUTOPILOT_ENDPOINT_X_URL="$cc_url" AUTOPILOT_ENDPOINT_X_TOKEN=t bash "$R" x)"; ec=$?
assert_exit_code "$ec" 1 "control-char url not-ready"
assert_contains "$out" '"url_safe":false' "control-char url url_safe:false"
jvalid "$out" && assert_eq ok ok "crafted url emits valid single-line JSON" || fail "crafted-url JSON invalid: $out"
# 4c. https url containing a double-quote/backslash → rejected (would truncate sed extraction) — R7
out="$(env -i AUTOPILOT_ENDPOINT_X_URL='https://ok.example/"evil' AUTOPILOT_ENDPOINT_X_TOKEN=t bash "$R" x)"; ec=$?
assert_exit_code "$ec" 1 "quote-in-url rejected"
assert_contains "$out" '"url_safe":false' "quote-in-url url_safe:false"

# 5. CRITICAL: no secret leak under bash -x / SHELLOPTS=xtrace
leak="$(env -i AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example AUTOPILOT_ENDPOINT_GLM_TOKEN=XTRSECRET bash -x "$R" glm 2>&1 1>/dev/null)"
assert_not_contains "$leak" 'XTRSECRET' "no token leak under bash -x"
leak2="$(env -i SHELLOPTS=xtrace AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example AUTOPILOT_ENDPOINT_GLM_TOKEN=XTRSECRET2 bash "$R" glm 2>&1 1>/dev/null)"
assert_not_contains "$leak2" 'XTRSECRET2' "no token leak under SHELLOPTS=xtrace"
assert_not_contains "$leak2" 'readonly' "no readonly-variable noise under SHELLOPTS=xtrace (gpt-5.5 R1)"

# 6. --list
out="$(env -i AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example AUTOPILOT_ENDPOINT_GLM_TOKEN=tval MINIMAX_API_KEY=mval bash "$R" --list)"; ec=$?
assert_exit_code "$ec" 0 "--list exits 0"
jvalid "$out" && assert_eq ok ok "--list JSON valid" || fail "--list JSON invalid: $out"
assert_contains "$out" '"name":"glm"' "--list has glm"
assert_contains "$out" 'minimax' "--list has minimax"
assert_not_contains "$out" 'tval' "--list no token value (glm)"
assert_not_contains "$out" 'mval' "--list no token value (minimax)"

# 7. usage / exit codes
env -i bash "$R" >/dev/null 2>&1; assert_exit_code "$?" 2 "no args exit 2"
env -i bash "$R" --list foo >/dev/null 2>&1; assert_exit_code "$?" 2 "--list+name exit 2"
env -i bash "$R" 'bad name!' >/dev/null 2>&1; assert_exit_code "$?" 2 "invalid name exit 2"
env -i bash "$R" --help >/dev/null 2>&1; assert_exit_code "$?" 0 "--help exit 0"
env -i bash "$R" nothingset >/dev/null 2>&1; assert_exit_code "$?" 1 "nothing-set exit 1"

# ── wiring ──────────────────────────────────────────────────────────
NOOP="$TEST_TMP/p.txt"; echo noop > "$NOOP"

# 8. dispatch-hetero --endpoint applies only to cc-shim
out="$(bash "$DH" --runner codex --model gpt-5.3-codex-spark --branch t/e --base HEAD --prompt-file "$NOOP" --endpoint foo 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "hetero --endpoint non-cc-shim precondition"

# 9. dispatch-review --endpoint applies only to anthropic-compatible/cc-shim
out="$(bash "$DR" --runner codex --model x --diff-file "$NOOP" --endpoint foo 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "review --endpoint non-applicable runner precondition"
assert_contains "$out" 'applies only to' "review --endpoint precondition message"

# 9b. dangling / empty --endpoint must NOT hang (shift-2 infinite loop) and must exit 2 — R4
timeout 5 bash "$DH" --branch t --base HEAD --prompt-file "$NOOP" --endpoint >/dev/null 2>&1; assert_exit_code "$?" 2 "hetero dangling --endpoint exits 2 (no hang)"
timeout 5 bash "$DH" --branch t --base HEAD --prompt-file "$NOOP" --endpoint "" >/dev/null 2>&1; assert_exit_code "$?" 2 "hetero empty --endpoint exits 2"
timeout 5 bash "$DR" --runner cc-shim --model x --diff-file "$NOOP" --endpoint >/dev/null 2>&1; assert_exit_code "$?" 2 "review dangling --endpoint exits 2 (no hang)"

# 9c. exit-code readiness gate: a url with a "ready":true substring but url_unsafe (resolver
# exits 1) must be REJECTED — the dispatcher trusts the exit code, not a stdout grep (R5)
out="$(env -i PATH="$PATH" '''AUTOPILOT_ENDPOINT_EVIL_URL=http://evil/"ready":true''' AUTOPILOT_ENDPOINT_EVIL_TOKEN=t bash "$DH" --runner cc-shim --branch t/e --base HEAD --prompt-file "$NOOP" --endpoint evil 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "spoofed ready substring rejected via exit-code gate"

# 10. JS --token-env: unset named token + fallback token set → fail-closed (no fallback)
out="$(env -i PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env" MINIMAX_API_KEY=shouldNotBeUsed node "$JS" --model x --diff-file "$NOOP" --base-url https://api.minimax.io/anthropic --token-env AUTOPILOT_ENDPOINT_GLM_TOKEN 2>&1)"
assert_contains "$out" 'AUTOPILOT_ENDPOINT_GLM_TOKEN is unset' "JS --token-env fail-closed"
assert_not_contains "$out" 'shouldNotBeUsed' "JS did not use fallback token"
out="$(env -i PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env" node "$JS" --model x --diff-file "$NOOP" --base-url https://x/anthropic --token-env 'bad-name!' 2>&1)"
assert_contains "$out" 'invalid --token-env' "JS rejects invalid token-env name"
out="$(env -i PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env" MINIMAX_API_KEY=fb node "$JS" --model x --diff-file "$NOOP" --base-url https://api.minimax.io/anthropic --token-env 2>&1)"
assert_contains "$out" 'token-env requires' "JS dangling --token-env errors (no fallback, R3)"
assert_not_contains "$out" 'fb' "JS dangling --token-env did not use fallback"

# 11. byte-identical no-endpoint: sibling fail-if-called resolve-endpoint.sh stub (R3)
STUBDIR="$TEST_TMP/stubdir"; mkdir -p "$STUBDIR"
cp "$DR" "$STUBDIR/dispatch-review.sh"
cp "$REPO_ROOT/scripts/dispatch-anthropic-review.js" "$STUBDIR/dispatch-anthropic-review.js"
SENTINEL="$TEST_TMP/resolver-was-called"
cat > "$STUBDIR/resolve-endpoint.sh" <<EOF
#!/usr/bin/env bash
touch "$SENTINEL"
echo "STUB SHOULD NOT BE CALLED" >&2
exit 99
EOF
chmod +x "$STUBDIR/resolve-endpoint.sh"
# run with NO --endpoint; the sibling stub must never be invoked
env -i PATH="$PATH" ANTHROPIC_COMPATIBLE_BASE_URL=https://x.invalid/anthropic ANTHROPIC_COMPATIBLE_AUTH_TOKEN=t \
  bash "$STUBDIR/dispatch-review.sh" --runner anthropic-compatible --model x --diff-file "$NOOP" --timeout 2s >/dev/null 2>&1 || true
assert_file_absent "$SENTINEL" "no-endpoint path never calls the sibling resolver"

finalize_test
