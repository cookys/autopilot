#!/usr/bin/env bash
# scripts/accounts-onboard.sh (G37 O1-O9 in one command). Hermetic: tempdirs, FAKE- tokens, a Node claude stand-in
# reached only through ONBOARD_CLAUDE_BIN. Never calls the real claude, never hits an API, never runs setup-token.
# Red cases: (1) token never leaks (stdout, stderr, 0.1 s ps snapshots, every other file, audit),
# (2) re-run is idempotent, (3) a 401 token stops the run, names the alias, and never falls back to the ambient login.
# Negative controls: argv leak and stdout leak turn case 1 red; dropping the idempotency check turns case 2 red.
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
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
const fp = crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
let decoy = false;
for (const b of [process.env.CLAUDE_CONFIG_DIR, process.env.HOME && path.join(process.env.HOME, '.claude')]) {
  if (!b) continue;
  try { fs.readFileSync(path.join(b, '.credentials.json')); decoy = true; break; } catch (_) { /* unreachable */ }
}
const base = process.env.ANTHROPIC_BASE_URL || null;
fs.appendFileSync(ctl.log, JSON.stringify({ argv: process.argv.slice(2), fp, decoy_read: decoy, base }) + '\n');
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
} else done(ctl.ok.includes(fp) ? OK : R401);
SHIM

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
  printf '{}' > "$fx/config.json"
  cp "$NODE_SHIM" "$fx/bin/claude"; chmod 755 "$fx/bin/claude"
  for t in "$@"; do okjson="$okjson${okjson:+,}\"$(tokfp "$t")\""; done
  printf '{"log":"%s","ok":[%s]}' "$fx/shim.log" "$okjson" > "$fx/bin/ctl.json"
  echo "$fx"
}

# run_onboard <script> <fx> <stdin-text> <alias>...: leaves out.txt err.txt rc and 0.1 s `ps -eo args` snaps/N in <fx>.
run_onboard() {
  local script="$1" fx="$2" input="$3"; shift 3
  rm -rf "$fx/snaps" "$fx/rc"; mkdir -p "$fx/snaps"
  local tr=()
  [ "$HAVE_STRACE" = 1 ] && tr=(strace -f -e trace=execve -s 65536 -o "$fx/exec.trace" --)
  rm -f "$fx/exec.trace"
  ( ${tr[@]+"${tr[@]}"} env -i PATH="$PATH" LANG=C HOME="$fx/fakehome" TMPDIR="$fx/tmp" XDG_RUNTIME_DIR="$fx/run" \
      AUTOPILOT_ACCOUNTS_DIR="$fx/fakehome/.config/autopilot/accounts" AUTOPILOT_LIVE_DIR="$fx/live" \
      AUTOPILOT_STATE_DIR="$fx/state" AUTOPILOT_CONFIG="$fx/config.json" ENGINE_CAPABILITY_DIR="$fx/ecd" \
      AUTOPILOT_STRIKE_WRITER=off ONBOARD_CLAUDE_BIN="$fx/bin/claude" \
      "$script" "$@" <<< "$input" > "$fx/out.txt" 2> "$fx/err.txt"
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
INPUT_TOK="$TA"$'\n'"$TB"$'\n'

# 0. --help / usage / bad alias do nothing.
fx0="$(mkfx "$TA" "$TB")"
run_onboard "$SCRIPT" "$fx0" "" --help
assert_eq "$(rc_of "$fx0")" "0" "help exit 0"
assert_contains "$(cat "$fx0/out.txt")" "用法" "help prints usage"
assert_contains "$(cat "$fx0/out.txt")" "ONBOARD_CLAUDE_BIN" "help documents the test seam"
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

finalize_test
