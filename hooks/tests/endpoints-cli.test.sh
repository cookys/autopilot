#!/usr/bin/env bash
# Tests for `autopilot endpoints` (src/endpoints/cli.js via bin/autopilot.js): list / which /
# set / doctor over base + opt-in per-repo overlay. Focus: NO token ever leaks to stdout/argv,
# mode-600 writes, overlay layering, doctor exit codes.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/bin/autopilot.js"
SH="$REPO_ROOT/scripts/load-endpoints-env.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BASE="$WORK/endpoints.env"

run() { env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints "$@"; }

# ── 1. set writes mode-600, token via stdin, NEVER echoes the token ──
setout="$(printf 'sekret-TOK-123' | run set glm --url https://api.z.ai/api/anthropic --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "set exits 0"
assert_not_contains "$setout" 'sekret-TOK-123' "set never echoes the token value"
assert_contains "$setout" 'mode 600' "set reports mode 600"
mode="$(stat -c '%a' "$BASE" 2>/dev/null || stat -f '%Lp' "$BASE" 2>/dev/null)"
assert_eq "600" "$mode" "base file is mode 600"

# ── 2. list --json: correct presence, NO token leak ──
lj="$(run list --json 2>&1)"
node -e 'JSON.parse(require("fs").readFileSync(0))' <<<"$lj" >/dev/null 2>&1 && assert_eq ok ok "list --json is valid JSON" || fail "list --json invalid: $lj"
assert_not_contains "$lj" 'sekret-TOK-123' "list --json does not leak the token"
assert_contains "$lj" '"name":"glm"' "list shows glm"
assert_contains "$lj" '"ready":true' "glm is ready (url+token)"

# ── 3. token is NEVER accepted on argv (only --token-stdin exists) ──
argvout="$(run set glm --url https://x --token sekret 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "an argv --token flag is rejected (no argv token path)"
assert_contains "$argvout" 'unknown endpoints set option: --token' "rejects --token on argv"

# ── 4. doctor: healthy → exit 0; a url-only endpoint → exit 1 + flags missing token ──
run doctor >/dev/null 2>&1; assert_exit_code "$?" 0 "doctor healthy exits 0"
run set brokep --url https://only >/dev/null 2>&1
docout="$(run doctor 2>&1)"; ec=$?
assert_exit_code "$ec" 1 "doctor with an unresolved endpoint exits 1"
assert_contains "$docout" 'brokep: token missing' "doctor flags the missing token"

# ── 5. per-repo overlay: set --repo writes the keyed overlay; which shows base vs overlay ──
REPO="$WORK/repo"; mkdir -p "$REPO/.claude"
git -C "$REPO" init -q >/dev/null 2>&1
git -C "$REPO" remote add origin https://example.com/myproj.git
printf -- '- reviewer_endpoint: glm\n- implementer_endpoint: mm\n' > "$REPO/.claude/review-loop-config.md"
# glm already in base; put mm in the per-repo overlay
( cd "$REPO" && printf 'repo-TOK' | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints set mm --url https://m --token-stdin --repo ) >/dev/null 2>&1
assert_file_exists "$WORK/endpoints.d/example_com_myproj.env" "set --repo wrote the keyed overlay file"
ovmode="$(stat -c '%a' "$WORK/endpoints.d/example_com_myproj.env" 2>/dev/null || stat -f '%Lp' "$WORK/endpoints.d/example_com_myproj.env" 2>/dev/null)"
assert_eq "600" "$ovmode" "overlay file is mode 600"

wj="$(cd "$REPO" && env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$BASE" node "$CLI" endpoints which --json 2>&1)"
node -e 'JSON.parse(require("fs").readFileSync(0))' <<<"$wj" >/dev/null 2>&1 && assert_eq ok ok "which --json valid" || fail "which --json invalid: $wj"
assert_not_contains "$wj" 'repo-TOK' "which --json does not leak the overlay token"
assert_not_contains "$wj" 'sekret-TOK-123' "which --json does not leak the base token"
assert_contains "$wj" '"role":"reviewer_endpoint","name":"glm"' "reviewer selects glm"
assert_contains "$wj" '"layer":"base"' "glm resolves from base"
assert_contains "$wj" '"layer":"overlay"' "mm resolves from the per-repo overlay"

# ── 6. set refuses to write through a symlink target ──
ln -s /etc/passwd "$WORK/symbase.env"
symout="$(printf t | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$WORK/symbase.env" node "$CLI" endpoints set x --url https://x --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "set refuses a symlink target"
assert_contains "$symout" 'symlink' "set explains the symlink refusal"

# ── 6b. newline-injection: a value with an embedded newline is refused, file NOT corrupted ──
INJBASE="$WORK/inj.env"
injurl="$(printf 'https://x\nAUTOPILOT_ENDPOINT_EVIL_TOKEN=pwned')"
injout="$(env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url "$injurl" 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "--url with an embedded newline is rejected"
assert_contains "$injout" 'https://' "explains the url-grammar refusal"
assert_file_absent "$INJBASE" "rejected injection wrote nothing (no EVIL line)"

# ── 6c. --url grammar (mirrors resolve-endpoint is_url_safe): non-https + whitespace rejected ──
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'ftp://x' >/dev/null 2>&1; assert_exit_code "$?" 2 "non-https url rejected"
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'https://a b' >/dev/null 2>&1; assert_exit_code "$?" 2 "url with whitespace rejected"
env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url 'http://localhost:8080/x' >/dev/null 2>&1; assert_exit_code "$?" 0 "http loopback url accepted"

# ── 6d. a token WITH shell metachars is accepted + round-trips LITERALLY (never executed) ──
# The file is a line-parser target, never sourced — so $()/;/backticks are safe to store.
META="$WORK/meta.env"
metatok='tok$(touch '"$WORK"'/CLIPWNED);`id`;a#b'
printf '%s' "$metatok" | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$META" node "$CLI" endpoints set glm --url https://x --token-stdin >/dev/null 2>&1
assert_exit_code "$?" 0 "token with shell metachars is accepted (file is never sourced)"
assert_file_absent "$WORK/CLIPWNED" "metachar token did NOT execute on write"
# and the loader reads it back literally, still no execution, glm resolves
metaload="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$META" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "T=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"' 2>&1)"
assert_file_absent "$WORK/CLIPWNED" "metachar token did NOT execute on read-back either"
assert_contains "$metaload" 'T=[tok$(touch' "loader reads the metachar token back literally"
# token via stdin with an embedded newline is likewise refused
tokinj="$(printf 'abc\nAUTOPILOT_ENDPOINT_EVIL_TOKEN=pwned' | env HOME="$WORK/home" AUTOPILOT_ENDPOINTS_ENV="$INJBASE" node "$CLI" endpoints set glm --url https://x --token-stdin 2>&1)"; ec=$?
assert_exit_code "$ec" 2 "--token-stdin with an embedded newline is rejected"
assert_contains "$tokinj" 'control character' "explains the token newline-injection refusal"

# ── 7. unknown subcommand → exit 2 ──
run bogus >/dev/null 2>&1; assert_exit_code "$?" 2 "unknown subcommand exits 2"

echo "endpoints-cli: all assertions passed"
