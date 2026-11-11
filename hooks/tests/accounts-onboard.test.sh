#!/usr/bin/env bash
# scripts/accounts-onboard.sh (G37 O1-O9 in one command). Hermetic: tempdirs, FAKE- tokens, a Node claude stand-in
# reached only through ONBOARD_CLAUDE_BIN, and a local HTTP stub server on 127.0.0.1:0 reached through
# ONBOARD_ORG_URL. Never calls the real claude, never hits a real network API, never runs setup-token.
# Red cases: (1) token never leaks (stdout, stderr, 0.1 s ps snapshots, every other file, audit),
# (2) re-run is idempotent, (3) a 401 token stops the run, names the alias, and never falls back to the ambient login,
# (4) orghdr header verification (distinct orgs, duplicate refusal + take-back, 401 token 無效, email/auth never leaked).
# Negative controls: argv leak, stdout leak, idempotency, symlink guard, failover gate, duplicate-org check, label hygiene.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/accounts-onboard.sh"
NODE_SHIM="$TEST_TMP/claude-shim.js"
cat > "$NODE_SHIM" <<'SHIM'
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const dir = path.dirname(fs.realpathSync(process.argv[1]));
const ctl = JSON.parse(fs.readFileSync(path.join(dir, 'ctl.json'), 'utf8'));
if (process.argv[2] === 'auth') { // `claude auth status --json`: answers come from ctl.auth in call order (the e-mail field is FAKE and must never surface)
  const nf = path.join(dir, 'auth.n');
  let n = 0; try { n = Number(fs.readFileSync(nf, 'utf8')); } catch (_) { /* first call */ }
  fs.writeFileSync(nf, String(n + 1));
  fs.appendFileSync(ctl.log, JSON.stringify({ argv: process.argv.slice(2), auth_status: true }) + '\n');
  const a = (ctl.auth || [])[n];
  if (a === undefined || a === null || a === 'FAIL') process.exit(1);
  process.stdout.write(typeof a === 'string' ? a : JSON.stringify(a) + '\n');
  process.exit(0);
}
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
const fp = crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
let decoy = false;
for (const b of [process.env.CLAUDE_CONFIG_DIR, process.env.HOME && path.join(process.env.HOME, '.claude')]) {
  if (!b) continue;
  try { fs.readFileSync(path.join(b, '.credentials.json')); decoy = true; break; } catch (_) { /* unreachable */ }
}
const base = process.env.ANTHROPIC_BASE_URL || null;
fs.appendFileSync(ctl.log, JSON.stringify({ argv: process.argv.slice(2), fp, decoy_read: decoy, base }) + '\n');
// Real haiku result envelopes carry NO org id (verified 2026-11-11).
const env = (isErr, status, text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: isErr,
  ...(status ? { api_error_status: status, terminal_reason: 'api_error' } : {}), result: text }) + '\n';
const OK = { exit: 0, out: env(false, 0, 'OK') };
const R401 = { exit: 1, out: env(true, 401, 'Failed to authenticate. API Error: 401 OAuth access token is invalid.') };
const R429 = { exit: 1, out: env(true, 429, "API Error: Server is temporarily limiting requests (not your usage limit) · This request would exceed your account's rate limit. (local synthetic)") };
function done(r) { process.stdout.write(r.out); process.exitCode = r.exit; }
if (decoy) done(OK);
else if (base) {
  const req = http.request(base + '/v1/messages', { method: 'POST' }, (res) => { res.resume(); res.on('end', () => done(res.statusCode === 429 ? R429 : OK)); });
  req.on('error', () => done(R401));
  req.end('{}');
} else if ((ctl.rateLimit || []).includes(fp)) done(R429);
else done(ctl.ok.includes(fp) ? OK : R401);
SHIM

# Local orghdr stub HTTP server on 127.0.0.1:0 (zero real network in tests).
# Routes POST /<fxName>/v1/messages -> <TEST_TMP>/<fxName>/bin/ctl.json, and POST /v1/messages -> <TEST_TMP>/stub-ctl.json.
STUB_PORT_FILE="$TEST_TMP/stub.port"
STUB_PID=""
stop_stub_only() {
  if [ -n "${STUB_PID:-}" ] && kill -0 "$STUB_PID" 2>/dev/null; then
    kill "$STUB_PID" 2>/dev/null
    wait "$STUB_PID" 2>/dev/null
  fi
  STUB_PID=""
}
stop_org_stub() {
  [ "$BASHPID" = "$__TEST_TOP_BASHPID" ] || return 0
  stop_stub_only
  cleanup_test_tmp
}
if [ "$BASHPID" = "$__TEST_TOP_BASHPID" ]; then trap stop_org_stub EXIT; fi
node -e '
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const [root, portFile] = process.argv.slice(1);
const srv = http.createServer((req, res) => {
  const m = /^\/(?:(fx\.[^/]+)\/)?v1\/messages$/.exec(req.url || "");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (!m || req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{\"error\":\"not_found\"}");
      return;
    }
    const ctlPath = m[1] ? path.join(root, m[1], "bin", "ctl.json") : path.join(root, "stub-ctl.json");
    let ctl = {};
    try { ctl = JSON.parse(fs.readFileSync(ctlPath, "utf8")); } catch (e) { /* unconfigured */ }
    const auth = String(req.headers.authorization || "");
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const fp = crypto.createHash("sha256").update(tok).digest("hex").slice(0, 8);
    const beta = String(req.headers["anthropic-beta"] || "");
    const ver = String(req.headers["anthropic-version"] || "");
    if (ctl.profileLog) {
      fs.appendFileSync(ctl.profileLog, JSON.stringify({ method: req.method, url: req.url, fp, has_bearer: auth.startsWith("Bearer "), beta, ver }) + "\n");
    }
    const spec = (ctl.profiles && Object.prototype.hasOwnProperty.call(ctl.profiles, fp)) ? ctl.profiles[fp] : ctl.profileDefault;
    if (!spec) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const status = typeof spec.status === "number" ? spec.status : 200;
    const body = typeof spec.rawBody === "string" ? spec.rawBody : JSON.stringify(spec.body !== undefined ? spec.body : {});
    const headers = Object.assign({ "content-type": "application/json" }, spec.headers && typeof spec.headers === "object" ? spec.headers : {});
    if (spec.echoAuthHeader && typeof spec.echoAuthHeader === "string") headers[spec.echoAuthHeader] = auth;
    res.writeHead(status, headers);
    res.end(body);
  });
});
srv.listen(0, "127.0.0.1", () => { fs.writeFileSync(portFile, String(srv.address().port)); });
' "$TEST_TMP" "$STUB_PORT_FILE" </dev/null >/dev/null 2>&1 &
STUB_PID=$!
for _ in $(seq 1 100); do [ -s "$STUB_PORT_FILE" ] && break; sleep 0.05; done
[ -s "$STUB_PORT_FILE" ] || fail "orghdr stub server did not bind 127.0.0.1:0"
STUB_PORT="$(cat "$STUB_PORT_FILE")"

# argv leaks are judged on an execve trace (deterministic); the 0.1 s ps snapshots are only a second look.
HAVE_STRACE=0
if command -v strace >/dev/null 2>&1 && strace -f -e trace=execve -o /dev/null -- true 2>/dev/null; then HAVE_STRACE=1
else echo "SKIP [accounts-onboard] strace unavailable or ptrace blocked: argv-leak assertions (RED1 exec-argv, NC1) are skipped, not passed" >&2; fi
tokfp() { printf '%s' "$1" | sha256sum | cut -c1-8; }

# mkfx <okToken>...: a fresh world; prints its root. Tokens listed are the ones the stand-in answers OK for.
mkfx() {
  local fx okjson="" t
  fx="$(mktemp -d "$TEST_TMP/fx.XXXXXX")"
  mkdir -p "$fx/fakehome/.claude" "$fx/live" "$fx/state" "$fx/run" "$fx/tmp" "$fx/bin" "$fx/ecd"
  chmod 700 "$fx/live" "$fx/state" "$fx/run" "$fx/tmp"
  printf '{"claudeAiOauth":{"accessToken":"DECOY-CREDS-NOT-REAL"}}' > "$fx/fakehome/.claude/.credentials.json"
  printf '{"accounts":{"quota_probe":"off"}}' > "$fx/config.json"  # BL-0375: unset follows the manifest (an on-demand probe call through the PATH claude); this suite tests onboarding, not the probe
  cp "$NODE_SHIM" "$fx/bin/claude"; chmod 755 "$fx/bin/claude"
  for t in "$@"; do okjson="$okjson${okjson:+,}\"$(tokfp "$t")\""; done
  printf '{"log":"%s","profileLog":"%s","ok":[%s],"auth":[%s]}' "$fx/shim.log" "$fx/profile.log" "$okjson" "$(default_auth)" > "$fx/bin/ctl.json"
  echo "$fx"
}
# The stand-in's `auth status --json` answers, in call order. Fake e-mail on purpose: it must never reach any file or output.
FAKE_EMAIL="user""@""example.invalid"  # assembled so the leak guard sees no address in this file
authj() { printf '{"loggedIn":true,"authMethod":"claude.ai","email":"%s","orgId":"%s","orgName":"%s","subscriptionType":"%s"}' "$FAKE_EMAIL" "$1" "$2" "${3:-max}"; }
default_auth() { printf '%s,%s,%s,%s' "$(authj FAKE-ORG-1 'FAKE Org One')" "$(authj FAKE-ORG-2 'FAKE Org Two' team)" "$(authj FAKE-ORG-3 'FAKE Org Three')" "$(authj FAKE-ORG-4 'FAKE Org Four')"; }
# prof_ok <uuid|-> [util|-]: stub 200 with org/utilization response headers; body always carries e-mail; echoAuthHeader
# asks the stub to echo the request Authorization into x-echo-authorization (code must not read either).
prof_ok() {
  node -e '
    const [uuid, util, email] = process.argv.slice(1);
    const headers = {};
    if (uuid && uuid !== "-") headers["anthropic-organization-id"] = uuid;
    if (util && util !== "-") headers["anthropic-ratelimit-unified-7d-utilization"] = util;
    process.stdout.write(JSON.stringify({
      status: 200,
      headers,
      echoAuthHeader: "x-echo-authorization",
      body: { id: "msg_stub", content: [{ type: "text", text: "OK" }], account: { email, email_address: email } },
    }));
  ' "${1:--}" "${2:--}" "$FAKE_EMAIL"
}
# setctl <fx> <key> <json>: replace one key of the stand-in's control file
setctl() { node -e 'const f=process.argv[1]+"/bin/ctl.json";const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c[process.argv[2]]=JSON.parse(process.argv[3]);require("fs").writeFileSync(f,JSON.stringify(c))' "$1" "$2" "$3"; }
# snapshot of the accounts dir (names, modes, content hashes) to prove "nothing changed"
tree_digest() { ( cd "$1" 2>/dev/null && find . -printf '%p %m\n' -type f -exec sha256sum {} + 2>/dev/null | sort | sha256sum ) || echo absent; }

# run_onboard <script> <fx> <stdin-text> <alias>...: leaves out.txt err.txt rc and 0.1 s `ps -eo args` snaps/N in <fx>.
YESFLAG=(--yes)  # every run skips the plan question unless a case sets YESFLAG=() (then the input must start with y)
URL_GUARD_FAIL_FILE="$TEST_TMP/.url-guard-fail"
ORG_URL_FOR() { printf '%s' "${ONBOARD_ORG_URL_OVERRIDE-http://127.0.0.1:$STUB_PORT/$(basename "$1")}"; }
require_local_org_url() { # <caller> <url>: fail closed so no helper ever reaches a real network URL
  local caller="$1" u="${2-}"
  if ! U="$u" node -e '
    const u = process.env.U || "";
    if (!u) process.exit(1);
    let parsed;
    try { parsed = new URL(u); } catch (_) { process.exit(1); }
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username !== "" || parsed.password !== "") process.exit(1);
  ' </dev/null >/dev/null 2>&1; then
    local msg="$caller: refusing empty or non-local ONBOARD_ORG_URL '$u'"
    fail "$msg"
    if [ "$BASHPID" != "$__TEST_TOP_BASHPID" ] && [ -n "${URL_GUARD_FAIL_FILE:-}" ]; then
      printf '%s\n' "$msg" >> "$URL_GUARD_FAIL_FILE"
    fi
    return 1
  fi
}
run_onboard() {
  local script="$1" fx="$2" input="$3"; shift 3
  rm -rf "$fx/snaps" "$fx/rc" "$fx/exec.trace"; mkdir -p "$fx/snaps"
  local tr=() ourl
  ourl="$(ORG_URL_FOR "$fx")"
  if ! require_local_org_url run_onboard "$ourl"; then
    : > "$fx/out.txt"; : > "$fx/err.txt"
    return 1
  fi
  [ "$HAVE_STRACE" = 1 ] && tr=(strace -f -e trace=execve -s 65536 -o "$fx/exec.trace" --)
  ( ${tr[@]+"${tr[@]}"} env -i PATH="$PATH" LANG=C HOME="$fx/fakehome" TMPDIR="$fx/tmp" XDG_RUNTIME_DIR="$fx/run" \
      AUTOPILOT_ACCOUNTS_DIR="$fx/fakehome/.config/autopilot/accounts" AUTOPILOT_LIVE_DIR="$fx/live" \
      AUTOPILOT_STATE_DIR="$fx/state" AUTOPILOT_CONFIG="$fx/config.json" ENGINE_CAPABILITY_DIR="$fx/ecd" \
      AUTOPILOT_STRIKE_WRITER=off ONBOARD_CLAUDE_BIN="$fx/bin/claude" ONBOARD_ORG_URL="$ourl" \
      "$script" ${YESFLAG[@]+"${YESFLAG[@]}"} "$@" <<< "$input" > "$fx/out.txt" 2> "$fx/err.txt"
    echo $? > "$fx/rc" ) &
  local pid=$! n=0
  while kill -0 "$pid" 2>/dev/null; do
    ps -eo args > "$fx/snaps/$n" 2>/dev/null; n=$((n + 1)); sleep 0.1
  done
  wait "$pid" 2>/dev/null
}
rc_of() { cat "$1/rc" 2>/dev/null || echo missing; }
# leak_places <fx> <token>: where the token text shows up other than in its own token file.
leak_places() {
  local fx="$1" tok="$2" out=""
  grep -qF -e "$tok" "$fx/out.txt" && out="$out stdout"
  grep -qF -e "$tok" "$fx/err.txt" && out="$out stderr"
  grep -rqF -e "$tok" "$fx/snaps" && out="$out ps-argv"
  [ -f "$fx/exec.trace" ] && grep -qF -e "$tok" "$fx/exec.trace" && out="$out exec-argv"
  [ -z "$(grep -rlF --exclude=token --exclude-dir=snaps --exclude=out.txt --exclude=err.txt --exclude=exec.trace -e "$tok" "$fx" 2>/dev/null)" ] || out="$out files"
  echo "$out"
}

TA="FAKE-onboard-alpha-91c3d7"
TB="FAKE-onboard-bravo-5e20aa"
ACC() { echo "$1/fakehome/.config/autopilot/accounts"; }
INPUT_TOK="$TA"$'\n'"$TB"$'\n'  # per profile: the token (the org comes from the token's own OK call, nothing is asked)

# 0. --help / usage / bad alias do nothing.
fx0="$(mkfx "$TA" "$TB")"
run_onboard "$SCRIPT" "$fx0" "" --help
assert_eq "$(rc_of "$fx0")" "0" "help exit 0"
assert_contains "$(cat "$fx0/out.txt")" "用法" "help prints usage"
assert_contains "$(cat "$fx0/out.txt")" "ONBOARD_CLAUDE_BIN" "help documents the test seam"
assert_contains "$(cat "$fx0/out.txt")" "ONBOARD_ORG_URL" "help documents ONBOARD_ORG_URL test seam"
[ ! -e "$fx0/fakehome/.config" ] && [ ! -e "$fx0/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "help must create nothing"
run_onboard "$SCRIPT" "$fx0" "" 'Bad_Alias'
assert_eq "$(rc_of "$fx0")" "2" "bad alias exit 2"
assert_not_contains "$(cat "$fx0/out.txt" "$fx0/err.txt")" "Bad_Alias" "bad alias is not echoed"
[ ! -e "$fx0/fakehome/.config" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "bad alias must create nothing"
run_onboard "$SCRIPT" "$fx0" "" a a
assert_eq "$(rc_of "$fx0")" "2" "duplicate alias exit 2"

# 1. first run, two aliases: everything green, perms right, token never leaks.
fx1="$(mkfx "$TA" "$TB")"
run_onboard "$SCRIPT" "$fx1" "$INPUT_TOK" a b
out1="$(cat "$fx1/out.txt")"
assert_eq "$(rc_of "$fx1")" "0" "first run exit 0"
assert_eq "$(grep -c '^❌' "$fx1/out.txt")" "0" "first run has no failed row"
assert_contains "$out1" "selftest --simulate-429 a" "simulate-429 row present"
assert_contains "$out1" "lane-reopen.js --alias a --cwd" "O5 command printed"
assert_contains "$out1" "--dry-run" "O5 command carries --dry-run"
assert_contains "$out1" "registry.json.off" "O10 rollback printed"
A1="$(ACC "$fx1")"
assert_eq "$(stat -c %a "$A1")" "700" "accounts dir 0700"
assert_eq "$(stat -c %a "$A1/a" "$A1/a/claude" "$A1/a/home" "$A1/b" | sort -u)" "700" "alias dirs 0700"
assert_eq "$(stat -c %a "$A1/registry.json")" "600" "registry 0600"
assert_eq "$(stat -c %a "$A1/a/token" "$A1/b/token" | sort -u)" "600" "token files 0600"
assert_eq "$(cat "$A1/a/token")" "$TA" "token a stored verbatim"
assert_eq "$(cat "$A1/registry.json")" '{"schema":"autopilot.accounts/1","accounts":[{"alias":"a","enabled":true,"priority":10},{"alias":"b","enabled":true,"priority":20}]}' "registry content and priorities"
assert_not_contains "$(cat "$fx1/shim.log")" "setup-token" "setup-token never run"
assert_not_contains "$(cat "$fx1/shim.log")" '"decoy_read":true' "ambient login never read"
if [ "$HAVE_STRACE" = 1 ]; then grep -q "claude-account.js" "$fx1/exec.trace" && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "execve trace is empty: tracer not working"; fi
assert_eq "$(leak_places "$fx1" "$TA")" "" "RED1 token a does not leak"
assert_eq "$(leak_places "$fx1" "$TB")" "" "RED1 token b does not leak"
[ "$(ls "$fx1/snaps" | wc -l)" -ge 3 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "ps sampler took too few snapshots"
assert_contains "$(grep -h '^alias=a ' "$fx1/out.txt" | tail -1)" "cooldown_until=-" "cooldown cleared at the end"
assert_eq "$(ls -A "$fx1/tmp")" "" "script left no temp files"

# 2. re-run: idempotent (registry bytes, token kept, all green).
cp "$A1/registry.json" "$TEST_TMP/reg.before"; cp "$A1/a/token" "$TEST_TMP/tokA.before"; cp "$A1/b/token" "$TEST_TMP/tokB.before"
run_onboard "$SCRIPT" "$fx1" $'\n\n' a b
assert_eq "$(rc_of "$fx1")" "0" "RED2 re-run exit 0"
assert_eq "$(grep -c '^❌' "$fx1/out.txt")" "0" "RED2 re-run all green"
cmp -s "$TEST_TMP/reg.before" "$A1/registry.json" && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "RED2 registry bytes changed on re-run"
cmp -s "$TEST_TMP/tokA.before" "$A1/a/token" && cmp -s "$TEST_TMP/tokB.before" "$A1/b/token" && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "RED2 token changed on re-run"
assert_contains "$(cat "$fx1/out.txt")" "沿用既有 token 檔" "re-run keeps tokens"

# 2b. overwrite choice replaces the token.
TA2="FAKE-onboard-alpha-NEW-33aa"
fx1b="$(mkfx "$TA" "$TB" "$TA2")"
run_onboard "$SCRIPT" "$fx1b" "$INPUT_TOK" a b
run_onboard "$SCRIPT" "$fx1b" $'覆蓋\n'"$TA2"$'\n\n' a b
assert_eq "$(cat "$(ACC "$fx1b")/a/token")" "$TA2" "overwrite replaces the token"
assert_eq "$(leak_places "$fx1b" "$TA2")" "" "overwritten token does not leak"

# 3. bad token (401): stops, names the alias, exit non-zero, no ambient fallback.
fx3="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fx3" "$INPUT_TOK" a b
out3="$(cat "$fx3/out.txt")"
assert_neq "$(rc_of "$fx3")" "0" "RED3 bad token exit non-zero"
assert_contains "$out3" "別名 b" "RED3 message names alias b"
assert_contains "$out3" "❌  b haiku OK 呼叫" "RED3 summary marks b failed"
assert_contains "$out3" "✅  a haiku OK 呼叫" "RED3 a still marked ok"
assert_not_contains "$(cat "$fx3/shim.log")" '"decoy_read":true' "RED3 decoy login was not read"
assert_not_contains "$out3" "selftest: fake token" "RED3 global checks did not run after the stop"
assert_eq "$(leak_places "$fx3" "$TB")" "" "RED3 bad token does not leak either"

# 3b. one alias: simulate-429 skipped and labelled; skipped alias (operator types skip) is not registered.
fx4="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fx4" "$TA"$'\n' a
assert_eq "$(rc_of "$fx4")" "0" "single alias exit 0"
assert_contains "$(cat "$fx4/out.txt")" "需要兩個帳號" "single alias notes two accounts needed"
fx5="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fx5" $'skip\n' a
assert_neq "$(rc_of "$fx5")" "0" "skipped alias exit non-zero"
assert_not_contains "$(cat "$(ACC "$fx5")/registry.json" 2>/dev/null)" '"a"' "skipped alias not registered"

# 4. token write safety (astra M1): symlink target refused; loose-mode old file is replaced, never written in place.
mkpre() { # <fx> : alias dir a with the accounts tree created 0700
  local acc; acc="$(ACC "$1")"; mkdir -p "$acc/a"; chmod 700 "$(dirname "$acc")" "$acc" "$acc/a"
}
fx6="$(mkfx "$TA")"; mkpre "$fx6"
printf 'DECOY-FILE-KEEP' > "$fx6/decoy.txt"; ln -s "$fx6/decoy.txt" "$(ACC "$fx6")/a/token"
run_onboard "$SCRIPT" "$fx6" "$TA"$'\n' a
assert_neq "$(rc_of "$fx6")" "0" "SYMLINK exit non-zero"
assert_contains "$(cat "$fx6/out.txt")" "別名 a 的 token 路徑是符號連結" "SYMLINK message names alias a"
assert_eq "$(cat "$fx6/decoy.txt")" "DECOY-FILE-KEEP" "SYMLINK decoy not written"
assert_not_contains "$(cat "$(ACC "$fx6")/registry.json" 2>/dev/null)" '"a"' "SYMLINK alias not registered"

fx7="$(mkfx "$TA2")"; mkpre "$fx7"
printf 'OLD-LOOSE-TOKEN' > "$(ACC "$fx7")/a/token"; chmod 644 "$(ACC "$fx7")/a/token"
ln "$(ACC "$fx7")/a/token" "$fx7/old-inode-link"
run_onboard "$SCRIPT" "$fx7" $'覆蓋\n'"$TA2"$'\n' a
assert_eq "$(rc_of "$fx7")" "0" "LOOSE overwrite exit 0"
assert_eq "$(cat "$(ACC "$fx7")/a/token")" "$TA2" "LOOSE new token in place"
assert_eq "$(stat -c %a "$(ACC "$fx7")/a/token")" "600" "LOOSE final mode 0600"
assert_eq "$(cat "$fx7/old-inode-link")" "OLD-LOOSE-TOKEN" "LOOSE old 0644 inode never received the new token"
assert_eq "$(stat -c %a "$fx7/old-inode-link")" "644" "LOOSE old inode mode untouched"
assert_eq "$(leak_places "$fx7" "$TA2")" "" "LOOSE new token does not leak"

# 5. failover eligibility counts the registry, not this run (astra M2).
run_onboard "$SCRIPT" "$fx1" $'\n' a
out8="$(cat "$fx1/out.txt")"
assert_eq "$(rc_of "$fx1")" "0" "FAILOVER a-only re-run exit 0"
assert_contains "$out8" "✅  selftest --simulate-429 a" "FAILOVER simulate-429 ran on a-only re-run"
assert_contains "$out8" "✅  cooldown --clear a" "FAILOVER cooldown clear ran"
assert_not_contains "$out8" "需要兩個帳號" "FAILOVER not skipped"

# Negative controls: a mutant copy of the script, in a tree of symlinks to the real scripts/.
mkmut() { # <name> <sed command> -> prints mutant script path
  local d="$TEST_TMP/mut-$1" f
  mkdir -p "$d/scripts"
  for f in "$REPO_ROOT"/scripts/*; do [ "$(basename "$f")" = accounts-onboard.sh ] || ln -s "$f" "$d/scripts/$(basename "$f")"; done
  sed_mutant "$SCRIPT" "$d/scripts/accounts-onboard.sh" "$2" || return 1
  echo "$d/scripts/accounts-onboard.sh"
}

# NC1: token handed to an external command (plain one-shot argv, no sleep) -> RED1 must turn red via the execve trace.
for shape in 'usrbin:s#printf .%s. "\$T" > "\$tmpf"#/usr/bin/printf "%s" "$T" > "$tmpf"#' 'envprintf:s#printf .%s. "\$T" > "\$tmpf"#/usr/bin/env printf "%s" "$T" > "$tmpf"#'; do
  m1="$(mkmut "argv-${shape%%:*}" "${shape#*:}")"
  fxm1="$(mkfx "$TA" "$TB")"
  run_onboard "$m1" "$fxm1" "$INPUT_TOK" a b
  echo "NC1(${shape%%:*}) rc=$(rc_of "$fxm1") leaks:$(leak_places "$fxm1" "$TA")" >&2
  if [ "$HAVE_STRACE" = 1 ]; then assert_contains "$(leak_places "$fxm1" "$TA")" "exec-argv" "NC1 ${shape%%:*} argv leak is caught by the execve trace"; fi
done
# NC1b: token through a pipe (builtin printf | cat), no argv -> RED1 must stay green (no false alarm from the trace).
m1b="$(mkmut pipe 's#printf .%s. "\$T" > "\$tmpf"#printf "%s" "$T" | cat > "$tmpf"#')"
fxm1b="$(mkfx "$TA" "$TB")"
run_onboard "$m1b" "$fxm1b" "$INPUT_TOK" a b
echo "NC1b rc=$(rc_of "$fxm1b") leaks:$(leak_places "$fxm1b" "$TA")" >&2
assert_eq "$(leak_places "$fxm1b" "$TA")" "" "NC1b pipe-fed token is not flagged (no false positive)"
assert_eq "$(cat "$(ACC "$fxm1b")/a/token")" "$TA" "NC1b token still stored"

# NC2: token echoed to the screen -> RED1 must turn red.
m2="$(mkmut echo 's|chmod 600 "\$tmpf"|chmod 600 "$tmpf"; echo "debug $T"|')"
fxm2="$(mkfx "$TA" "$TB")"
run_onboard "$m2" "$fxm2" "$INPUT_TOK" a b
assert_contains "$(leak_places "$fxm2" "$TA")" "stdout" "NC2 stdout leak is caught"

# NC3: idempotency check removed -> RED2 must turn red.
m3="$(mkmut idem '/onboard:idempotent/s/have\.has(alias)/false/')"
fxm3="$(mkfx "$TA" "$TB")"
run_onboard "$m3" "$fxm3" "$INPUT_TOK" a b
cp "$(ACC "$fxm3")/registry.json" "$TEST_TMP/reg3.before"
run_onboard "$m3" "$fxm3" $'\n\n' a b
if [ "$(rc_of "$fxm3")" != "0" ] || ! cmp -s "$TEST_TMP/reg3.before" "$(ACC "$fxm3")/registry.json"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "NC3 dropping the idempotency check did not turn the re-run red"
fi

# NC4: guard removed -> SYMLINK stop assertion must go red (rename still protects the decoy).
m4="$(mkmut noguard '/onboard:token-guard/s/\[ -L "\$tf" \]/false/')"
fxm4="$(mkfx "$TA")"; mkpre "$fxm4"; printf 'DECOY-FILE-KEEP' > "$fxm4/decoy.txt"; ln -s "$fxm4/decoy.txt" "$(ACC "$fxm4")/a/token"
run_onboard "$m4" "$fxm4" "$TA"$'\n' a
echo "NC4 rc=$(rc_of "$fxm4") decoy=$(cat "$fxm4/decoy.txt")" >&2
assert_not_contains "$(cat "$fxm4/out.txt")" "token 路徑是符號連結" "NC4 without the guard the refusal message is gone (the SYMLINK case would be red)"

# NC5: old write (redirect straight into the target) and no guard -> decoy gets the token and the 0644 inode gets it.
mkoldwrite() {
  local m; m="$(mkmut oldwrite 's#^.*onboard:token-write$#      ( umask 077; printf "%s" "$T" > "$tf" ) \&\& chmod 600 "$tf" || wrc=1 \# onboard:token-write#')" || return 1
  sed_mutate "$m" '/onboard:token-guard/s/\[ -L "\$tf" \]/false/' || return 1
  echo "$m"
}
m5="$(mkoldwrite)"
fxm5="$(mkfx "$TA")"; mkpre "$fxm5"; printf 'DECOY-FILE-KEEP' > "$fxm5/decoy.txt"; ln -s "$fxm5/decoy.txt" "$(ACC "$fxm5")/a/token"
run_onboard "$m5" "$fxm5" $'覆蓋\n'"$TA"$'\n' a
echo "NC5 symlink: decoy now '$(cat "$fxm5/decoy.txt")'" >&2
assert_eq "$(cat "$fxm5/decoy.txt")" "$TA" "NC5 old write goes through the symlink (the symlink case would be red)"
fxm5b="$(mkfx "$TA2")"; mkpre "$fxm5b"
printf 'OLD-LOOSE-TOKEN' > "$(ACC "$fxm5b")/a/token"; chmod 644 "$(ACC "$fxm5b")/a/token"; ln "$(ACC "$fxm5b")/a/token" "$fxm5b/old-inode-link"
run_onboard "$m5" "$fxm5b" $'覆蓋\n'"$TA2"$'\n' a
echo "NC5 loose: old inode now '$(cat "$fxm5b/old-inode-link")'" >&2
assert_eq "$(cat "$fxm5b/old-inode-link")" "$TA2" "NC5 old write puts the token in the 0644 inode (the loose case would be red)"

# NC6: failover gate counts this run's aliases (old behaviour) -> the a-only re-run skips the self-test.
m6="$(mkmut gate '/onboard:failover-gate/s/\${#USABLE\[@\]}/${#OK_ALIASES[@]}/')"
run_onboard "$m6" "$fx1" $'\n' a
echo "NC6 a-only re-run: $(grep -c '需要兩個帳號' "$fx1/out.txt") skip line(s)" >&2
assert_contains "$(cat "$fx1/out.txt")" "需要兩個帳號" "NC6 old gate skips the failover self-test (the FAILOVER case would be red)"

# ---- G37 org identity (alias = account + org) and the rewritten usage / plan question --------------------------
# no_email <fx>: the fake e-mail appears in no file of the world and in no captured output.
no_email() { [ -z "$(grep -rlF -e "$FAKE_EMAIL" "$1" --exclude=ctl.json --exclude=claude --exclude=exec.trace --exclude-dir=snaps 2>/dev/null)" ] || echo "leaked-file"; grep -qF -e "$FAKE_EMAIL" "$1/out.txt" "$1/err.txt" && echo "leaked-output"; [ ! -f "$1/exec.trace" ] || ! grep -qF -e "$FAKE_EMAIL" "$1/exec.trace" || echo "leaked-argv"; return 0; }
meta_of() { cat "$(ACC "$1")/$2/token-meta.json" 2>/dev/null || echo none; }

# O1 / stub case (a): two profiles, different org uuids from local HTTP stub server via ONBOARD_ORG_URL
# (ambient auth status says other orgs and is never called); org_id and org_label (= profile name) land in
# token-meta.json (0600); body e-mail and echoed Authorization header never surface (stub cases (d)/(e)); tokens
# never leak anywhere (stub case (f)). Also exercises bare base URL ONBOARD_ORG_URL=http://127.0.0.1:<port>.
fxo="$(mkfx "$TA" "$TB")"
UUID_A="550E8400-E29B-41D4-A716-446655440000"
UUID_B="660E8400-E29B-41D4-A716-446655440001"
UUID_SHARED="770e8400-e29b-41d4-a716-446655440077"
UUID_REV="880e8400-e29b-41d4-a716-446655440081"
UUID_RL="880e8400-e29b-41d4-a716-446655440088"
UUID_CASE="990e8400-e29b-41d4-a716-446655440099"
UUID_X="aa0e8400-e29b-41d4-a716-4466554400aa"
UUID_OTHER="bb0e8400-e29b-41d4-a716-4466554400bb"
UUID_MISMATCH="cc0e8400-e29b-41d4-a716-4466554400cc"
PROFILES_AB="{\"$(tokfp "$TA")\":$(prof_ok "$UUID_A" "0.42"),\"$(tokfp "$TB")\":$(prof_ok "$UUID_B" "0.15")}"
printf '{"profileLog":"%s","profiles":%s}' "$fxo/profile.log" "$PROFILES_AB" > "$TEST_TMP/stub-ctl.json"
setctl "$fxo" auth "[$(authj AMBIENT-X 'Ambient Org X'),$(authj AMBIENT-X 'Ambient Org X')]"
ONBOARD_ORG_URL_OVERRIDE="http://127.0.0.1:$STUB_PORT"
run_onboard "$SCRIPT" "$fxo" "$INPUT_TOK" a b
unset ONBOARD_ORG_URL_OVERRIDE
assert_eq "$(rc_of "$fxo")" "0" "ORG1/(a) two distinct orgs via ONBOARD_ORG_URL: exit 0"
assert_contains "$(meta_of "$fxo" a)" '"org_id":"550e8400-e29b-41d4-a716-446655440000"' "ORG1/(a) a org_id lowercased in token-meta"
assert_contains "$(meta_of "$fxo" a)" '"org_label":"a"' "ORG1/(a) a org_label defaults to profile name"
assert_contains "$(meta_of "$fxo" a)" '"org_check":"verified"' "ORG1/(a) a org verified"
assert_not_contains "$(meta_of "$fxo" a)" "org_type" "ORG1/(a) a has no org_type"
assert_not_contains "$(meta_of "$fxo" a)" "rate_limit_tier" "ORG1/(a) a has no rate_limit_tier"
assert_contains "$(meta_of "$fxo" b)" '"org_id":"660e8400-e29b-41d4-a716-446655440001"' "ORG1/(a) b org_id recorded"
assert_contains "$(meta_of "$fxo" b)" '"org_check":"verified"' "ORG1/(a) b org verified"
assert_not_contains "$(meta_of "$fxo" a)" "ambient-x" "ORG1 ambient org id nowhere in the record"
assert_eq "$(stat -c %a "$(ACC "$fxo")/a/token-meta.json")" "600" "ORG1 token-meta 0600"
assert_not_contains "$(cat "$(ACC "$fxo")/registry.json")" "org" "ORG1 registry.json row keys unchanged (no org)"
assert_not_contains "$(cat "$fxo/shim.log")" "auth_status" "ORG1 claude auth status is never called"
assert_contains "$(cat "$fxo/profile.log")" '"has_bearer":true' "ORG1 Bearer header sent to orghdr"
assert_contains "$(cat "$fxo/profile.log")" '"beta":"oauth-2025-04-20"' "ORG1 anthropic-beta oauth-2025-04-20 header sent"
assert_contains "$(cat "$fxo/profile.log")" '"ver":"2023-06-01"' "ORG1 anthropic-version 2023-06-01 header sent"
assert_contains "$(cat "$fxo/profile.log")" '"method":"POST"' "ORG1 uses POST"
assert_contains "$(cat "$fxo/out.txt")" "標籤「a」，7d 用量 42%" "ORG1 summary shows org label and 7d utilization percent"
assert_contains "$(cat "$fxo/out.txt")" "org 已驗證" "ORG1 summary says org 已驗證"
assert_not_contains "$(cat "$fxo/out.txt")" "550e8400-e29b-41d4-a716-446655440000" "ORG1 summary never prints full org id"
status_a="$(grep -h '^alias=a ' "$fxo/out.txt" | head -1)"
assert_contains "$status_a" 'org="a"' "ORG1 status shows org label"
assert_not_contains "$status_a" 'org_check=' "ORG1 verified status omits org_check suffix"
# Stub cases (e) & (f): body e-mail and echoed Authorization never appear in stdout, token-meta or registry; tokens never appear anywhere.
assert_not_contains "$(cat "$fxo/out.txt")" "$FAKE_EMAIL" "ORG1/(e) body e-mail never in stdout"
assert_not_contains "$(cat "$fxo/err.txt")" "$FAKE_EMAIL" "ORG1/(e) body e-mail never in stderr"
assert_not_contains "$(meta_of "$fxo" a)" "$FAKE_EMAIL" "ORG1/(e) body e-mail never in a token-meta"
assert_not_contains "$(meta_of "$fxo" b)" "$FAKE_EMAIL" "ORG1/(e) body e-mail never in b token-meta"
assert_not_contains "$(cat "$(ACC "$fxo")/registry.json")" "$FAKE_EMAIL" "ORG1/(e) body e-mail never in registry"
assert_not_contains "$(cat "$fxo/out.txt")" "Bearer $TA" "ORG1/(e) echoed Authorization never in stdout"
assert_not_contains "$(meta_of "$fxo" a)" "$TA" "ORG1/(e) Authorization value never in token-meta"
assert_eq "$(no_email "$fxo")" "" "ORG1/(e) e-mail appears in no file or output"
assert_eq "$(leak_places "$fxo" "$TA")" "" "ORG1/(f) token a never appears in any output or file"
assert_eq "$(leak_places "$fxo" "$TB")" "" "ORG1/(f) token b never appears in any output or file"

# Direct `orghdr <alias>` helper mode checks: 3-line ok output and fail:<code> exits (all exit 0).
HELPER_JS="$(awk '/^read -r -d .. NODE_HELPER/{f=1;next} /^JS$/{f=0} f' "$SCRIPT")"
run_orghdr() { # <fx> <alias> [url]
  local fx="$1" al="$2"
  local u="${3:-$(ORG_URL_FOR "$fx")}"
  if [ "$#" -ge 3 ]; then u="$3"; fi
  require_local_org_url run_orghdr "$u" || return 1
  env -i PATH="$PATH" HOME="$fx/fakehome" AUTOPILOT_ACCOUNTS_DIR="$(ACC "$fx")" ONBOARD_ORG_URL="$u" \
    node -e "$HELPER_JS" "$REPO_ROOT" orghdr "$al" < /dev/null
}
op_ok_a="$(run_orghdr "$fxo" a "http://127.0.0.1:$STUB_PORT/v1/messages")"; op_rc_a=$?
assert_eq "$op_rc_a" "0" "ORGHDR ok exits 0"
assert_eq "$op_ok_a" $'ok\n550e8400-e29b-41d4-a716-446655440000\n0.42' "ORGHDR ok 3-line contract"
op_ok_b="$(run_orghdr "$fxo" b "http://127.0.0.1:$STUB_PORT")"; op_rc_b=$?
assert_eq "$op_rc_b" "0" "ORGHDR bare-base URL exits 0"
assert_eq "$op_ok_b" $'ok\n660e8400-e29b-41d4-a716-446655440001\n0.15' "ORGHDR ok util for b"
assert_not_contains "$op_ok_b" "$FAKE_EMAIL" "ORGHDR never outputs email"
assert_not_contains "$op_ok_a" "$TA" "ORGHDR never outputs token"
setctl "$fxo" profileDefault '{"status":401,"body":{"error":"unauthorized"}}'
op_f401="$(run_orghdr "$fxo" a)"; assert_eq "$?" "0" "ORGHDR 401 exits 0"; assert_eq "$op_f401" "fail:http_401" "ORGHDR fail:http_401"
setctl "$fxo" profileDefault '{"status":503,"body":{}}'
op_f503="$(run_orghdr "$fxo" a)"; assert_eq "$?" "0" "ORGHDR 503 exits 0"; assert_eq "$op_f503" "fail:http_503" "ORGHDR fail:http_503"
setctl "$fxo" profileDefault '{"status":200,"headers":{},"body":{"account":{"email":"'"$FAKE_EMAIL"'"}}}'
op_fnoid="$(run_orghdr "$fxo" a)"; assert_eq "$?" "0" "ORGHDR missing org header exits 0"; assert_eq "$op_fnoid" "fail:no_org_id" "ORGHDR fail:no_org_id"
op_freq="$(run_orghdr "$fxo" a "http://127.0.0.1:1")"; assert_eq "$?" "0" "ORGHDR network failure exits 0"; assert_eq "$op_freq" "fail:request_failed" "ORGHDR fail:request_failed"

# PROMPTS: each step says what to do, in which window, and what success looks like; the receipt line never carries the token.
assert_contains "$(cat "$fxo/out.txt")" "已收到 token（不顯示內容）" "PROMPT paste receipt shown"
assert_contains "$(cat "$fxo/out.txt")" "成功的樣子：那個視窗印出一長串 token" "PROMPT setup-token says what success looks like"
assert_contains "$(cat "$fxo/out.txt")" "步驟 ④ 完成 ✅ 別名 a" "PROMPT say-OK success names the alias"
assert_contains "$(cat "$fxo/out.txt")" "每一列都是 ✅" "PROMPT summary says what success looks like"
assert_eq "$(grep -h '已收到 token' "$fxo/out.txt" | grep -cF -e "$TA" || true)" "0" "PROMPT receipt line does not carry the token"
assert_contains "$(cat "$fx3/out.txt")" "修法" "PROMPT a failed run says how to fix it"

# O2 / stub case (d): 200 without the org header (or non-401 failures): org_id unknown (null), org check unverified,
# never blocks; --org gives the label. Re-running once headers respond verifies the existing alias without new flags.
fxn1="$(mkfx "$TA")"
setctl "$fxn1" profileDefault '{"status":200,"headers":{},"body":{"account":{"email":"'"$FAKE_EMAIL"'"}}}'
run_onboard "$SCRIPT" "$fxn1" "$TA"$'\n' --org a=Hand-Label a
assert_eq "$(rc_of "$fxn1")" "0" "ORG2/(d) no org header: exit 0"
assert_contains "$(meta_of "$fxn1" a)" '"org_id":null' "ORG2 org_id recorded as unknown"
assert_contains "$(meta_of "$fxn1" a)" '"org_label":"Hand-Label"' "ORG2 org_label from --org"
assert_contains "$(meta_of "$fxn1" a)" '"org_check":"unverified"' "ORG2 org_check unverified"
assert_contains "$(cat "$fxn1/out.txt")" "org 未驗證" "ORG2 summary says org unverified"
assert_not_contains "$(cat "$fxn1/out.txt")" "$FAKE_EMAIL" "ORG2/(d) body e-mail never blocks and never appears"
assert_not_contains "$(cat "$fxn1/shim.log")" "auth_status" "ORG2 auth status never called"
# Re-run on already-registered alias with org_id:null (keeping existing token) verifies its org!
setctl "$fxn1" profileDefault "$(prof_ok "$UUID_REV" "0.5")"
run_onboard "$SCRIPT" "$fxn1" $'\n' a
assert_eq "$(rc_of "$fxn1")" "0" "ORG2 re-run verifies previously null org_id: exit 0"
assert_contains "$(meta_of "$fxn1" a)" '"org_id":"880e8400-e29b-41d4-a716-446655440081"' "ORG2 re-run writes org_id"
assert_contains "$(meta_of "$fxn1" a)" '"org_check":"verified"' "ORG2 re-run upgrades org_check to verified"
assert_contains "$(meta_of "$fxn1" a)" '"org_label":"Hand-Label"' "ORG2 re-run keeps Hand-Label"
# an unreadable ambient login is irrelevant (no --org needed either)
fxn2="$(mkfx "$TA")"; setctl "$fxn2" auth '["FAIL"]'
run_onboard "$SCRIPT" "$fxn2" "$TA"$'\n' a
assert_eq "$(rc_of "$fxn2")" "0" "ORG2 unreadable ambient login does not matter"
assert_contains "$(meta_of "$fxn2" a)" '"org_label":"a"' "ORG2 label falls back to the profile name"
assert_contains "$(meta_of "$fxn2" a)" '"org_id":null' "ORG2 org_id unknown"

# O3 / stub case (b): two profiles whose tokens report the SAME org uuid -> second is a failed row
# ("同一個 org 已登記在 a"), its org id is not recorded, its registry row is taken back, first profile untouched.
fxd="$(mkfx "$TA" "$TB")"; setctl "$fxd" profileDefault "$(prof_ok "$UUID_SHARED" "0.2")"
run_onboard "$SCRIPT" "$fxd" "$INPUT_TOK" a b
assert_neq "$(rc_of "$fxd")" "0" "ORG3/(b) duplicate org: exit non-zero"
assert_contains "$(cat "$fxd/out.txt")" "❌  b org 核對" "ORG3/(b) b has a failed org row"
assert_contains "$(cat "$fxd/out.txt")" "同一個 org 已登記在 a" "ORG3/(b) names the existing alias with required message"
assert_contains "$(meta_of "$fxd" a)" '"org_id":"770e8400-e29b-41d4-a716-446655440077"' "ORG3/(b) a keeps the org"
assert_not_contains "$(meta_of "$fxd" b)" "770e8400-e29b-41d4-a716-446655440077" "ORG3/(b) b did not record the duplicate org id"
assert_not_contains "$(cat "$(ACC "$fxd")/registry.json")" '"b"' "ORG3/(b) b's registry row was taken back"
assert_contains "$(cat "$(ACC "$fxd")/registry.json")" '"a"' "ORG3/(b) a still registered"
assert_eq "$(no_email "$fxd")" "" "ORG3/(b) e-mail appears nowhere"
assert_eq "$(leak_places "$fxd" "$TA")" "" "ORG3/(b)/(f) token a never leaks"
assert_eq "$(leak_places "$fxd" "$TB")" "" "ORG3/(b)/(f) token b never leaks"
# same org id in another letter case is the same org
fxc="$(mkfx "$TA" "$TB")"
setctl "$fxc" profiles "{\"$(tokfp "$TA")\":$(prof_ok "$(printf '%s' "$UUID_CASE" | tr 'a-f' 'A-F')" "-"),\"$(tokfp "$TB")\":$(prof_ok "$UUID_CASE" "-")}"
run_onboard "$SCRIPT" "$fxc" "$INPUT_TOK" a b
assert_contains "$(meta_of "$fxc" a)" '"org_id":"990e8400-e29b-41d4-a716-446655440099"' "ORG3 org id stored lower-case"
assert_neq "$(rc_of "$fxc")" "0" "ORG3 same org in another letter case: refused"
assert_contains "$(cat "$fxc/out.txt")" "❌  b org 核對" "ORG3 case-folded duplicate is a failed row"
assert_contains "$(cat "$fxc/out.txt")" "同一個 org 已登記在 a" "ORG3 case-folded duplicate names owner"

# O3b: re-run verifying an already-registered alias whose org_id is null when its token's org is owned by another alias:
# unregister does not run (row already existed), so output says b is still registered and tells the operator to remove
# one by hand, never claims 已從 registry 取回 / 不留在 registry, does not write org_id for b, and keeps b enabled.
fxd2="$(mkfx "$TA" "$TB")"
setctl "$fxd2" profiles "{\"$(tokfp "$TA")\":$(prof_ok "$UUID_X" "0.1"),\"$(tokfp "$TB")\":{\"status\":503,\"body\":{}}}"
run_onboard "$SCRIPT" "$fxd2" "$INPUT_TOK" a b
assert_eq "$(rc_of "$fxd2")" "0" "ORG3b initial run (a verified org X, b 503 unverified): exit 0"
assert_contains "$(meta_of "$fxd2" a)" '"org_id":"aa0e8400-e29b-41d4-a716-4466554400aa"' "ORG3b a org_id verified"
assert_contains "$(meta_of "$fxd2" b)" '"org_id":null' "ORG3b b org_id stays null after stub failure"
setctl "$fxd2" profiles "{\"$(tokfp "$TA")\":$(prof_ok "$UUID_X" "0.1"),\"$(tokfp "$TB")\":$(prof_ok "$UUID_X" "0.1")}"
run_onboard "$SCRIPT" "$fxd2" $'\n\n' a b
out_d2="$(cat "$fxd2/out.txt")"
assert_neq "$(rc_of "$fxd2")" "0" "ORG3b re-run duplicate on existing alias: exit non-zero"
assert_contains "$out_d2" "❌  b org 核對" "ORG3b b has a failed org row"
assert_contains "$out_d2" "仍在 registry 裡" "ORG3b output says b is still registered"
assert_contains "$out_d2" "同一個 org 已登記在 a" "ORG3b output says same org is registered as a"
assert_contains "$out_d2" "手動" "ORG3b output tells operator to remove one by hand"
assert_not_contains "$out_d2" "已從 registry 取回" "ORG3b output does NOT claim 已從 registry 取回"
assert_not_contains "$out_d2" "不留在 registry" "ORG3b output does NOT claim 不留在 registry"
assert_contains "$(meta_of "$fxd2" b)" '"org_id":null' "ORG3b b org_id remains null (not written)"
assert_not_contains "$(meta_of "$fxd2" b)" "aa0e8400-e29b-41d4-a716-4466554400aa" "ORG3b duplicate org_id not written for b"
assert_contains "$(cat "$(ACC "$fxd2")/registry.json")" '{"alias":"b","enabled":true,"priority":20}' "ORG3b registry still has b enabled"

# Stub case (c): orghdr stub returns HTTP 401 -> failed row "token 無效", stops before global checks, no leak.
fxc401="$(mkfx "$TA")"
setctl "$fxc401" profileDefault '{"status":401,"body":{"error":{"type":"authentication_error","message":"invalid token"}}}'
run_onboard "$SCRIPT" "$fxc401" "$TA"$'\n' a
assert_neq "$(rc_of "$fxc401")" "0" "STUB-(c) orghdr 401: exit non-zero"
assert_contains "$(cat "$fxc401/out.txt")" "❌  a org 核對" "STUB-(c) orghdr 401 marks org row failed"
assert_contains "$(cat "$fxc401/out.txt")" "token 無效" "STUB-(c) orghdr 401 shows token 無效"
assert_contains "$(cat "$fxc401/out.txt")" "修法" "STUB-(c) orghdr 401 includes remedy"
assert_not_contains "$(cat "$fxc401/out.txt")" "selftest: fake token" "STUB-(c) stops before global checks"
assert_eq "$(leak_places "$fxc401" "$TA")" "" "STUB-(c)/(f) 401 token never leaks"

# Rate-limited haiku OK call (429) is its own failed row and MUST NOT erase a verified org from orghdr.
fxrl="$(mkfx "$TA")"
setctl "$fxrl" profileDefault "$(prof_ok "$UUID_RL" "0.3")"
setctl "$fxrl" rateLimit "[\"$(tokfp "$TA")\"]"
run_onboard "$SCRIPT" "$fxrl" "$TA"$'\n' a
assert_neq "$(rc_of "$fxrl")" "0" "RL rate-limited OK call: exit non-zero"
assert_contains "$(cat "$fxrl/out.txt")" "✅  a org 核對" "RL orghdr row stays green"
assert_contains "$(cat "$fxrl/out.txt")" "❌  a haiku OK 呼叫" "RL OK call has its own failed row"
assert_contains "$(meta_of "$fxrl" a)" '"org_id":"880e8400-e29b-41d4-a716-446655440088"' "RL verified org_id preserved"
assert_contains "$(meta_of "$fxrl" a)" '"org_check":"verified"' "RL rate-limited OK call did not erase verified org"

# O4. orghdr org id vs a recorded one: match -> verified; transient failure -> kept; different -> failed row.
fxv="$(mkfx "$TA")"; setctl "$fxv" profileDefault "$(prof_ok "$UUID_SHARED" "-")"
run_onboard "$SCRIPT" "$fxv" "$TA"$'\n' a
run_onboard "$SCRIPT" "$fxv" $'\n' a
assert_eq "$(rc_of "$fxv")" "0" "ORG4 re-run, matching org header: exit 0"
assert_contains "$(cat "$fxv/out.txt")" "org 已驗證" "ORG4 verified row"
setctl "$fxv" profileDefault '{"status":503,"body":{}}'
run_onboard "$SCRIPT" "$fxv" $'\n' a
assert_eq "$(rc_of "$fxv")" "0" "ORG4 transient 503 after verified does not block"
assert_contains "$(meta_of "$fxv" a)" '"org_check":"verified"' "ORG4 transient 503 keeps verified org_check"
setctl "$fxv" profileDefault "$(prof_ok "$UUID_OTHER" "-")"
run_onboard "$SCRIPT" "$fxv" $'\n' a
assert_neq "$(rc_of "$fxv")" "0" "ORG4 mismatching org header: exit non-zero"
assert_contains "$(cat "$fxv/out.txt")" "❌  a org 核對" "ORG4 mismatch row is red"

# O5. RED: email-shaped org_label refused with nothing created.
fxe="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fxe" "" --org "a=$FAKE_EMAIL" a
assert_eq "$(rc_of "$fxe")" "2" "ORG5 email-shaped --org label refused (exit 2)"
assert_not_contains "$(cat "$fxe/out.txt" "$fxe/err.txt")" "$FAKE_EMAIL" "ORG5 refusal does not echo the label"
[ ! -e "$fxe/fakehome/.config" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "ORG5 refused label created the accounts dir"

# U1. RED: no argument prints the explanation (not an error dump) and creates nothing; --help the same, exit 0.
fxn="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fxn" ""
assert_eq "$(rc_of "$fxn")" "2" "USAGE no argument: exit 2"
assert_contains "$(cat "$fxn/out.txt")" "替每個「Claude 帳號＋org」登記一個 profile" "USAGE no argument prints the explanation on stdout"
assert_contains "$(cat "$fxn/out.txt")" "personal team" "USAGE examples present"
assert_contains "$(cat "$fxn/out.txt")" "你自己取的 profile 名稱" "USAGE says what the argument is"
assert_contains "$(cat "$fxn/out.txt")" "claude setup-token" "USAGE names the manual steps"
[ ! -e "$fxn/fakehome/.config" ] && [ ! -e "$fxn/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "USAGE no argument created something"
YESFLAG=(); run_onboard "$SCRIPT" "$fxn" "" --help; YESFLAG=(--yes)
assert_eq "$(rc_of "$fxn")" "0" "USAGE --help exit 0"
assert_contains "$(cat "$fxn/out.txt")" "--yes" "USAGE documents --yes"
assert_contains "$(cat "$fxn/out.txt")" "--org 名稱=org標籤" "USAGE documents --org"

# U2. RED: illegal names (email-shaped, grammar, reserved) are refused and nothing is created.
for badname in "user""@""example.invalid" 'Has_Upper' 'acct-0123abcd' 'x'$(printf 'y%.0s' $(seq 1 24)); do
  run_onboard "$SCRIPT" "$fxn" "" good "$badname"
  assert_eq "$(rc_of "$fxn")" "2" "NAME '$(printf '%s' "$badname" | cut -c1-14)' refused"
  [ ! -e "$fxn/fakehome/.config" ] && [ ! -e "$fxn/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "NAME refusal created something"
done
run_onboard "$SCRIPT" "$fxn" "" "user""@""example.invalid"
assert_contains "$(cat "$fxn/err.txt")" "看起來像 email" "NAME email-shaped reason is explained"
assert_not_contains "$(cat "$fxn/out.txt" "$fxn/err.txt")" "user@example" "NAME refusal does not echo the name"

# P1. the plan question. A piped "y" without --yes must NOT proceed (stdin is not a terminal): refuse, create nothing.
fxp="$(mkfx "$TA")"
YESFLAG=(); run_onboard "$SCRIPT" "$fxp" $'y\ny\n'"$TA"$'\n' a; YESFLAG=(--yes)
assert_eq "$(rc_of "$fxp")" "1" "PLAN A piped y without --yes: refused (exit 1)"
assert_contains "$(cat "$fxp/out.txt")" "將登記 1 個 profile：a" "PLAN is printed first"
assert_contains "$(cat "$fxp/out.txt")" "不是終端機" "PLAN A says why it refused"
assert_contains "$(cat "$fxp/out.txt")" "沒有建立任何東西" "PLAN A refusal says nothing was created"
assert_contains "$(cat "$fxp/out.txt")" "修法" "PLAN A says how to fix"
[ ! -e "$fxp/fakehome/.config" ] && [ ! -e "$fxp/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "PLAN A refusal created something"
YESFLAG=(); run_onboard "$SCRIPT" "$fxp" "" a; YESFLAG=(--yes)
assert_eq "$(rc_of "$fxp")" "1" "PLAN A empty stdin without --yes refused"
# the real question, on a pseudo-terminal (script(1)): default N declines, y proceeds
run_tty() { # <fx> <input> <arg>...
  local fx="$1" input="$2" ourl; shift 2
  ourl="$(ORG_URL_FOR "$fx")"
  rm -f "$fx/rc"
  if ! require_local_org_url run_tty "$ourl"; then
    : > "$fx/out.txt"; : > "$fx/err.txt"
    return 1
  fi
  ( printf '%s' "$input" | env -i PATH="$PATH" LANG=C HOME="$fx/fakehome" TMPDIR="$fx/tmp" XDG_RUNTIME_DIR="$fx/run" \
      AUTOPILOT_ACCOUNTS_DIR="$fx/fakehome/.config/autopilot/accounts" AUTOPILOT_LIVE_DIR="$fx/live" \
      AUTOPILOT_STATE_DIR="$fx/state" AUTOPILOT_CONFIG="$fx/config.json" ENGINE_CAPABILITY_DIR="$fx/ecd" \
      AUTOPILOT_STRIKE_WRITER=off ONBOARD_CLAUDE_BIN="$fx/bin/claude" ONBOARD_ORG_URL="$ourl" \
      script -qec "$(printf '%q ' "$SCRIPT" "$@")" /dev/null > "$fx/out.txt" 2> "$fx/err.txt"
    echo $? > "$fx/rc" )
}
if command -v script >/dev/null 2>&1; then
  fxt="$(mkfx "$TA")"
  run_tty "$fxt" $'\n' a
  assert_eq "$(rc_of "$fxt")" "1" "PLAN tty default N: exit 1"
  assert_contains "$(cat "$fxt/out.txt")" "繼續？[y/N]" "PLAN tty asks to continue"
  [ ! -e "$fxt/fakehome/.config" ] && [ ! -e "$fxt/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "PLAN tty decline created something"
  run_tty "$fxt" $'y\n'"$TA"$'\n' a
  assert_eq "$(rc_of "$fxt")" "0" "PLAN tty y proceeds"
else echo "SKIP [accounts-onboard] script(1) unavailable: the tty plan-question cases are skipped, not passed" >&2; fi

# B. the org state follows the facts: verified, then a token of another org -> mismatch, never stays verified.
fxb="$(mkfx "$TA" "$TA2")"; setctl "$fxb" profileDefault "$(prof_ok "$UUID_SHARED" "-")"
run_onboard "$SCRIPT" "$fxb" "$TA"$'\n' a
assert_contains "$(meta_of "$fxb" a)" '"org_check":"verified"' "B verified first"
setctl "$fxb" profileDefault "$(prof_ok "$UUID_MISMATCH" "-")"
run_onboard "$SCRIPT" "$fxb" $'覆蓋\n'"$TA2"$'\n' a
assert_neq "$(rc_of "$fxb")" "0" "B token of another org: exit non-zero"
assert_contains "$(meta_of "$fxb" a)" '"org_check":"mismatch"' "B org_check no longer verified after a mismatch"
assert_contains "$(grep -h '^alias=a ' "$fxb/out.txt" | head -1)" 'org_check=mismatch' "B status shows the mismatch"
# a later run where orghdr carries no org id must not erase the mismatch
setctl "$fxb" profileDefault '{"status":200,"headers":{},"body":{}}'
run_onboard "$SCRIPT" "$fxb" $'覆蓋\n'"$TA2"$'\n' a
assert_contains "$(meta_of "$fxb" a)" '"org_check":"mismatch"' "B a later unverified orghdr keeps the mismatch"
assert_contains "$(grep -h '^alias=a ' "$fxb/out.txt" | head -1)" 'org_check=mismatch' "B status still shows the mismatch"
# D. every refusal says how to fix it.
run_onboard "$SCRIPT" "$fx0" "" a a
assert_contains "$(cat "$fx0/err.txt")" "修法" "D duplicate name has a remedy"
run_onboard "$SCRIPT" "$fx0" "" --org a=X --org a=Y a
assert_contains "$(cat "$fx0/err.txt")" "修法" "D duplicate --org has a remedy"
run_onboard "$SCRIPT" "$fx0" "" --bogus a
assert_eq "$(rc_of "$fx0")" "2" "D unknown option: exit 2"
assert_contains "$(cat "$fx0/err.txt")" "--help" "D unknown option points at --help"
run_onboard "$SCRIPT" "$fx0" "" --org 'a=Ac"me' a
assert_eq "$(rc_of "$fx0")" "2" "E label with a double quote refused"
bad_rows="$(grep -n 'row "❌"' "$SCRIPT" | grep -v -e '修法' -e '未執行' -e '未處理' -e '"\$1"' -e '"\$why"' -e '請照上面訊息' || true)"
assert_eq "$bad_rows" "" "D every failed summary row carries a remedy (or is a not-run follow-on)"

# NC7: Negative control for stub case (b) — break the duplicate-org check -> (b) goes red (exits 0 and keeps b in
# registry), while the restored/unmutated script refuses the duplicate and takes b back.
m7="$(mkmut orgdup 's#const owner = reg.findOrgOwner(acc, oid, alias);#const owner = null;#')"
fxm7="$(mkfx "$TA" "$TB")"; setctl "$fxm7" profileDefault "$(prof_ok "$UUID_SHARED" "0.2")"
run_onboard "$m7" "$fxm7" "$INPUT_TOK" a b
assert_eq "$(rc_of "$fxm7")" "0" "NC7 without the duplicate check case (b) goes red (registers duplicate with exit 0)"
assert_contains "$(cat "$(ACC "$fxm7")/registry.json")" '"b"' "NC7 broken duplicate check leaves b in registry"
fxm7_ok="$(mkfx "$TA" "$TB")"; setctl "$fxm7_ok" profileDefault "$(prof_ok "$UUID_SHARED" "0.2")"
run_onboard "$SCRIPT" "$fxm7_ok" "$INPUT_TOK" a b
assert_neq "$(rc_of "$fxm7_ok")" "0" "NC7 restored script catches duplicate org again"
assert_not_contains "$(cat "$(ACC "$fxm7_ok")/registry.json")" '"b"' "NC7 restored script takes back b"

# NC9: org id taken from the ambient login again (old behaviour: auth status called) -> ORG1 must turn red.
m9="$(mkmut ambient 's#^  ORG_PENDING=0; ORG_ID="-"; ORG_LABEL=""; ORG_CHECK="unverified"#  ORG_PENDING=0; ORG_ID="-"; ORG_LABEL=""; ORG_CHECK="unverified"; "$CLAUDE_PROG" auth status --json >/dev/null 2>\&1#')"
fxm9="$(mkfx "$TA")"
run_onboard "$m9" "$fxm9" "$TA"$'\n' a
assert_contains "$(cat "$fxm9/shim.log")" "auth_status" "NC9 a mutant that reads the ambient login is seen (the ORG1 no-auth-status assertion would be red)"

# NC8: org label hygiene removed (validate and metaset) -> ORG5 must turn red: the e-mail lands in token-meta.json.
m8="$(mkmut orglabel 's/if (lp) die(/if (false) die(/')"
fxm8="$(mkfx "$TA")"
run_onboard "$m8" "$fxm8" "$TA"$'\n' --org "a=$FAKE_EMAIL" a
assert_contains "$(no_email "$fxm8")" "leaked-file" "NC8 without the label check the e-mail is written to a file (the ORG5 case would be red)"

# NC10: fail-closed URL guard refuses empty or non-127.0.0.1 URLs in run_orghdr and run_onboard without running the helper.
fxm10="$(mkfx "$TA")"
nc10_sentinel="$TEST_TMP/nc10-sentinel.sh"
printf '#!/usr/bin/env bash\n: > "%s/sentinel-ran"\n' "$fxm10" > "$nc10_sentinel"
chmod 755 "$nc10_sentinel"
nc10_ugf="$TEST_TMP/nc10.ugf"
nc10_plog_before="$(wc -l < "$fxo/profile.log")"
for bad_u in "" "https://api.anthropic.com/v1/messages" "http://localhost:$STUB_PORT/$(basename "$fxo")" "http://127.0.0.1:443""@""api.anthropic.com/v1/messages" "http://127.0.0.1.evil.example:80/x"; do
  rm -f "$nc10_ugf"
  nc10_rc=0
  (
    __TEST_FAIL_MSGS=()
    URL_GUARD_FAIL_FILE="$nc10_ugf"
    out=""
    op_rc=0
    out="$(run_orghdr "$fxo" a "$bad_u")" || op_rc=$?
    [ "$op_rc" -ne 0 ] && [ -z "$out" ] && [ -s "$nc10_ugf" ]
  ) 2>"$TEST_TMP/nc10-op.err" || nc10_rc=$?
  nc10_op_err="$(cat "$TEST_TMP/nc10-op.err")"
  assert_eq "$nc10_rc" "0" "NC10 run_orghdr blocks URL '$bad_u' and counts failure"
  assert_contains "$nc10_op_err" "FAIL [$TEST_NAME]" "NC10 run_orghdr prints FAIL for '$bad_u'"

  rm -f "$nc10_ugf"
  nc10_rc=0
  (
    __TEST_FAIL_MSGS=()
    URL_GUARD_FAIL_FILE="$nc10_ugf"
    ONBOARD_ORG_URL_OVERRIDE="$bad_u"
    ob_rc=0
    run_onboard "$nc10_sentinel" "$fxm10" "" a || ob_rc=$?
    [ "$ob_rc" -ne 0 ] && [ "${#__TEST_FAIL_MSGS[@]}" -eq 1 ] && [ -s "$nc10_ugf" ]
  ) 2>"$TEST_TMP/nc10-ob.err" || nc10_rc=$?
  nc10_ob_err="$(cat "$TEST_TMP/nc10-ob.err")"
  assert_eq "$nc10_rc" "0" "NC10 run_onboard blocks URL '$bad_u' and counts failure"
  assert_contains "$nc10_ob_err" "FAIL [$TEST_NAME]" "NC10 run_onboard prints FAIL for '$bad_u'"
  assert_file_absent "$fxm10/sentinel-ran" "NC10 run_onboard never ran helper for '$bad_u'"
done
rm -f "$nc10_ugf"
nc10_rc=0
(
  __TEST_FAIL_MSGS=()
  URL_GUARD_FAIL_FILE="$nc10_ugf"
  ONBOARD_ORG_URL_OVERRIDE=""
  out=""
  op_rc=0
  out="$(run_orghdr "$fxo" a)" || op_rc=$?
  [ "$op_rc" -ne 0 ] && [ -z "$out" ] && [ -s "$nc10_ugf" ]
) 2>"$TEST_TMP/nc10-op-def.err" || nc10_rc=$?
nc10_op_def_err="$(cat "$TEST_TMP/nc10-op-def.err")"
assert_eq "$nc10_rc" "0" "NC10 run_orghdr 2-arg blocks empty default URL"
assert_contains "$nc10_op_def_err" "FAIL [$TEST_NAME]" "NC10 run_orghdr 2-arg empty override prints FAIL"
nc10_plog_after="$(wc -l < "$fxo/profile.log")"
assert_eq "$nc10_plog_after" "$nc10_plog_before" "NC10 blocked run_orghdr calls never reached stub server"

# NC11: Negative control for O3b (dup-takeback-claim) — revert the take-back check so duplicate:* always prints the
# take-back claim -> O3b's "仍在 registry 裡" and no-"已從 registry 取回" assertions go red on the mutant and pass on
# the restored script; also prove a non-zero unregister exit does not print the take-back claim.
m11="$(mkmut duptakeback '/onboard:dup-takeback/s/-eq 1/-ge 0/')"
fxm11="$(mkfx "$TA" "$TB")"
setctl "$fxm11" profiles "{\"$(tokfp "$TA")\":$(prof_ok "$UUID_X" "-"),\"$(tokfp "$TB")\":{\"status\":503,\"body\":{}}}"
run_onboard "$SCRIPT" "$fxm11" "$INPUT_TOK" a b
setctl "$fxm11" profiles "{\"$(tokfp "$TA")\":$(prof_ok "$UUID_X" "-"),\"$(tokfp "$TB")\":$(prof_ok "$UUID_X" "-")}"
run_onboard "$m11" "$fxm11" $'\n\n' a b
assert_contains "$(cat "$fxm11/out.txt")" "已從 registry 取回" "NC11 reverted script falsely claims 已從 registry 取回 (O3b would go red)"
assert_not_contains "$(cat "$fxm11/out.txt")" "仍在 registry 裡" "NC11 reverted script omits still-registered message (O3b would go red)"
assert_contains "$(cat "$(ACC "$fxm11")/registry.json")" '{"alias":"b","enabled":true,"priority":20}' "NC11 b remained enabled in registry despite false take-back claim"
run_onboard "$SCRIPT" "$fxm11" $'\n\n' a b
assert_neq "$(rc_of "$fxm11")" "0" "NC11 restored script exits non-zero"
assert_contains "$(cat "$fxm11/out.txt")" "仍在 registry 裡" "NC11 restored script reports b still registered"
assert_not_contains "$(cat "$fxm11/out.txt")" "已從 registry 取回" "NC11 restored script does not claim 已從 registry 取回"
assert_contains "$(cat "$(ACC "$fxm11")/registry.json")" '{"alias":"b","enabled":true,"priority":20}' "NC11 restored script leaves b enabled in registry"
m11b="$(mkmut unregfail "s/mode === 'unregister') {/mode === 'unregister') { process.exit(1);/")"
fxm11b="$(mkfx "$TA" "$TB")"; setctl "$fxm11b" profileDefault "$(prof_ok "$UUID_SHARED" "0.2")"
run_onboard "$m11b" "$fxm11b" "$INPUT_TOK" a b
assert_neq "$(rc_of "$fxm11b")" "0" "NC11b unregister non-zero exit still fails the run"
assert_contains "$(cat "$fxm11b/out.txt")" "仍在 registry 裡" "NC11b unregister non-zero exit reports b still registered"
assert_not_contains "$(cat "$fxm11b/out.txt")" "已從 registry 取回" "NC11b unregister non-zero exit does not claim 已從 registry 取回"

if [ -s "$URL_GUARD_FAIL_FILE" ]; then
  _ug_msg=""
  while IFS= read -r _ug_msg || [ -n "$_ug_msg" ]; do
    __TEST_FAIL_MSGS+=("$_ug_msg")
  done < "$URL_GUARD_FAIL_FILE"
fi
stop_stub_only
finalize_test
