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

# ── transport policy: plaintext-private opt-in (v2.35.11) ───────────
# private-range http WITHOUT the opt-in stays not-ready, and says why
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=http://192.168.101.7:8001 AUTOPILOT_ENDPOINT_Q_TOKEN=t bash "$R" q 2>/dev/null)"; ec=$?
assert_exit_code "$ec" 1 "private http without opt-in → not-ready"
assert_contains "$out" '"transport_optin_required"' "private http without opt-in names the marker"
assert_contains "$out" '"transport_security":""' "not-ready row has empty transport_security"
# WITH the opt-in: ready, disclosed, warned on stderr only
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=http://192.168.101.7:8001 AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" q 2>/dev/null)"; ec=$?
assert_exit_code "$ec" 0 "private http with opt-in → ready"
assert_contains "$out" '"transport_security":"plaintext_private"' "opt-in row discloses plaintext_private"
jvalid "$out" && assert_eq ok ok "opt-in JSON valid" || fail "opt-in JSON invalid: $out"
err="$(env -i AUTOPILOT_ENDPOINT_Q_URL=http://192.168.101.7:8001 AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" q 2>&1 >/dev/null)"
assert_contains "$err" 'PLAINTEXT' "opt-in warns on stderr"
assert_not_contains "$out" 'PLAINTEXT' "warning is not on stdout"
# every other private range + IPv6 ULA/link-local
for u in http://10.0.0.2 http://172.16.0.1:1 http://172.31.255.254/x http://169.254.1.1 http://192.168.0.0 'http://[fd12::1]:8001' 'http://[fe80::1]/' 'http://[fc00:1:2:3:4:5:6:7]/' 'http://[fd00:0:0:0:0:0:0:1]/'; do
  out="$(env -i AUTOPILOT_ENDPOINT_Q_URL="$u" AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" q 2>/dev/null)"; ec=$?
  assert_exit_code "$ec" 0 "opt-in accepts private literal $u"
done
# opt-in does NOT open hostnames, public IPs, 172 outside /12, malformed octets, userinfo tricks
# (round-1 review: zero-padded octets are OCTAL to the URL parser — 172.016.0.1 dials public
#  172.14.0.1 — and loose IPv6 prefixes accepted non-literals such as [fc00:])
for u in http://cuda.local:8001 http://cuda:8001 http://8.8.8.8 http://172.32.0.1 http://172.15.0.1 http://999.168.1.1 'http://192.168.1.5@evil.example/' 'http://user@192.168.1.5/' 'http://[2001:db8::1]/' \
         http://172.016.0.1 http://010.0.0.1 http://192.168.01.1 'http://[fc00:]/' 'http://[fd12:::1]/' 'http://[fd12::1::2]/' 'http://[fd12:1:2:3:4:5:6:7:8]/' 'http://[fd12::1%25eth0]/' 'http://[fdzz::1]/' 'http://[fd12:12345::1]/'; do
  out="$(env -i AUTOPILOT_ENDPOINT_Q_URL="$u" AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" q 2>/dev/null)"; ec=$?
  assert_exit_code "$ec" 1 "opt-in rejects non-private $u"
  assert_contains "$out" '"transport_private_range_required"' "rejection of $u names the private-range marker"
done
# bogus transport value fails closed even for https
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=https://glm.example AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=yolo bash "$R" q 2>/dev/null)"; ec=$?
assert_exit_code "$ec" 1 "invalid transport value → not-ready"
assert_contains "$out" '"transport_value_invalid"' "invalid transport value names the marker"
# disclosure on the always-safe classes, and byte-compat: absent flag still resolves https/loopback
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=https://glm.example AUTOPILOT_ENDPOINT_Q_TOKEN=t bash "$R" q 2>/dev/null)"
assert_contains "$out" '"transport_security":"tls"' "https discloses tls"
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=http://127.0.0.1:8001 AUTOPILOT_ENDPOINT_Q_TOKEN=t bash "$R" q 2>/dev/null)"
assert_contains "$out" '"transport_security":"loopback"' "loopback http discloses loopback"
# --list rows carry the field
out="$(env -i AUTOPILOT_ENDPOINT_Q_URL=http://10.0.0.2 AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" --list 2>/dev/null)"
assert_contains "$out" '"transport_security":"plaintext_private"' "--list discloses transport_security"
# the opt-in is namespace-only: the generic-compatible candidate gets no plaintext story
out="$(env -i ANTHROPIC_COMPATIBLE_BASE_URL=http://10.0.0.2 ANTHROPIC_COMPATIBLE_AUTH_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private bash "$R" q 2>/dev/null)"; ec=$?
assert_exit_code "$ec" 1 "generic-compatible private http stays not-ready (opt-in is namespace-only)"
# dispatch-hetero re-surfaces the disclosure on stderr at dispatch time (resolver stderr is
# discarded there). Run the REAL rail from a throwaway repo with a PATH that has no `claude`:
# the --endpoint block runs before the cc-shim binary precondition, so the notice is printed
# and the run then fails closed uncharged (no engine is ever spawned).
DHREPO="$(mktemp -d)"; git -C "$DHREPO" init -q; git -C "$DHREPO" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
dherr="$(cd "$DHREPO" && env -i PATH=/usr/bin:/bin HOME="$DHREPO" AUTOPILOT_ENDPOINT_Q_URL=http://10.0.0.2:1 AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private \
  bash "$DH" --runner cc-shim --model m --endpoint q --branch x --prompt-file /dev/null --base HEAD --timeout 1s --context-window off 2>&1 >/dev/null || true)"
assert_contains "$dherr" 'PLAINTEXT to a private-range address' "dispatch-hetero --endpoint prints the plaintext notice on stderr"
# ...and DISPATCH_QUIET (which silences operational chatter) must NOT silence the disclosure
dherrq="$(cd "$DHREPO" && env -i PATH=/usr/bin:/bin HOME="$DHREPO" DISPATCH_QUIET=1 AUTOPILOT_ENDPOINT_Q_URL=http://10.0.0.2:1 AUTOPILOT_ENDPOINT_Q_TOKEN=t AUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private \
  bash "$DH" --runner cc-shim --model m --endpoint q --branch x --prompt-file /dev/null --base HEAD --timeout 1s --context-window off 2>&1 >/dev/null || true)"
assert_contains "$dherrq" 'PLAINTEXT to a private-range address' "DISPATCH_QUIET does not silence the plaintext notice"
assert_not_contains "$dherrq" 'may run for MANY minutes' "DISPATCH_QUIET still silences the operational heads-up"
rm -rf "$DHREPO"

finalize_test
