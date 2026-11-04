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
const env = (isErr, status, text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: isErr, ...(ctl.envOrg ? { orgId: ctl.envOrg } : {}),
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
  printf '{"accounts":{"quota_probe":"off"}}' > "$fx/config.json"  # BL-0375: unset follows the manifest (an on-demand probe call through the PATH claude); this suite tests onboarding, not the probe
  cp "$NODE_SHIM" "$fx/bin/claude"; chmod 755 "$fx/bin/claude"
  for t in "$@"; do okjson="$okjson${okjson:+,}\"$(tokfp "$t")\""; done
  printf '{"log":"%s","ok":[%s],"auth":[%s]}' "$fx/shim.log" "$okjson" "$(default_auth)" > "$fx/bin/ctl.json"
  echo "$fx"
}
# The stand-in's `auth status --json` answers, in call order. Fake e-mail on purpose: it must never reach any file or output.
FAKE_EMAIL="user""@""example.invalid"  # assembled so the leak guard sees no address in this file
authj() { printf '{"loggedIn":true,"authMethod":"claude.ai","email":"%s","orgId":"%s","orgName":"%s","subscriptionType":"%s"}' "$FAKE_EMAIL" "$1" "$2" "${3:-max}"; }
default_auth() { printf '%s,%s,%s,%s' "$(authj FAKE-ORG-1 'FAKE Org One')" "$(authj FAKE-ORG-2 'FAKE Org Two' team)" "$(authj FAKE-ORG-3 'FAKE Org Three')" "$(authj FAKE-ORG-4 'FAKE Org Four')"; }
# setctl <fx> <key> <json>: replace one key of the stand-in's control file
setctl() { node -e 'const f=process.argv[1]+"/bin/ctl.json";const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c[process.argv[2]]=JSON.parse(process.argv[3]);require("fs").writeFileSync(f,JSON.stringify(c))' "$1" "$2" "$3"; }
# snapshot of the accounts dir (names, modes, content hashes) to prove "nothing changed"
tree_digest() { ( cd "$1" 2>/dev/null && find . -printf '%p %m\n' -type f -exec sha256sum {} + 2>/dev/null | sort | sha256sum ) || echo absent; }

# run_onboard <script> <fx> <stdin-text> <alias>...: leaves out.txt err.txt rc and 0.1 s `ps -eo args` snaps/N in <fx>.
YESFLAG=(--yes)  # every run skips the plan question unless a case sets YESFLAG=() (then the input must start with y)
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
INPUT_TOK="y"$'\n'"$TA"$'\n'"y"$'\n'"$TB"$'\n'  # per profile: confirm the org, then the token

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
run_onboard "$SCRIPT" "$fx4" $'y\n'"$TA"$'\n' a
assert_eq "$(rc_of "$fx4")" "0" "single alias exit 0"
assert_contains "$(cat "$fx4/out.txt")" "需要兩個帳號" "single alias notes two accounts needed"
fx5="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fx5" $'y\nskip\n' a
assert_neq "$(rc_of "$fx5")" "0" "skipped alias exit non-zero"
assert_not_contains "$(cat "$(ACC "$fx5")/registry.json" 2>/dev/null)" '"a"' "skipped alias not registered"

# 4. token write safety (astra M1): symlink target refused; loose-mode old file is replaced, never written in place.
mkpre() { # <fx> : alias dir a with the accounts tree created 0700
  local acc; acc="$(ACC "$1")"; mkdir -p "$acc/a"; chmod 700 "$(dirname "$acc")" "$acc" "$acc/a"
}
fx6="$(mkfx "$TA")"; mkpre "$fx6"
printf 'DECOY-FILE-KEEP' > "$fx6/decoy.txt"; ln -s "$fx6/decoy.txt" "$(ACC "$fx6")/a/token"
run_onboard "$SCRIPT" "$fx6" $'y\n'"$TA"$'\n' a
assert_neq "$(rc_of "$fx6")" "0" "SYMLINK exit non-zero"
assert_contains "$(cat "$fx6/out.txt")" "別名 a 的 token 路徑是符號連結" "SYMLINK message names alias a"
assert_eq "$(cat "$fx6/decoy.txt")" "DECOY-FILE-KEEP" "SYMLINK decoy not written"
assert_not_contains "$(cat "$(ACC "$fx6")/registry.json" 2>/dev/null)" '"a"' "SYMLINK alias not registered"

fx7="$(mkfx "$TA2")"; mkpre "$fx7"
printf 'OLD-LOOSE-TOKEN' > "$(ACC "$fx7")/a/token"; chmod 644 "$(ACC "$fx7")/a/token"
ln "$(ACC "$fx7")/a/token" "$fx7/old-inode-link"
run_onboard "$SCRIPT" "$fx7" $'y\n覆蓋\n'"$TA2"$'\n' a
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
run_onboard "$m4" "$fxm4" $'y\n'"$TA"$'\n' a
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
run_onboard "$m5" "$fxm5" $'y\n覆蓋\n'"$TA"$'\n' a
echo "NC5 symlink: decoy now '$(cat "$fxm5/decoy.txt")'" >&2
assert_eq "$(cat "$fxm5/decoy.txt")" "$TA" "NC5 old write goes through the symlink (the symlink case would be red)"
fxm5b="$(mkfx "$TA2")"; mkpre "$fxm5b"
printf 'OLD-LOOSE-TOKEN' > "$(ACC "$fxm5b")/a/token"; chmod 644 "$(ACC "$fxm5b")/a/token"; ln "$(ACC "$fxm5b")/a/token" "$fxm5b/old-inode-link"
run_onboard "$m5" "$fxm5b" $'y\n覆蓋\n'"$TA2"$'\n' a
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

# O1. happy path: org_id and org_label land in token-meta (0600), shown name has no e-mail, summary marks org unverified
# (the stand-in's envelope has no org id), status shows the label.
fxo="$(mkfx "$TA" "$TB")"
run_onboard "$SCRIPT" "$fxo" "$INPUT_TOK" a b
assert_eq "$(rc_of "$fxo")" "0" "ORG1 two orgs: exit 0"
assert_contains "$(meta_of "$fxo" a)" '"org_id":"fake-org-1"' "ORG1 a org_id recorded"
assert_contains "$(meta_of "$fxo" a)" '"org_label":"FAKE Org One"' "ORG1 a org_label recorded"
assert_contains "$(meta_of "$fxo" b)" '"org_id":"fake-org-2"' "ORG1 b org_id recorded"
assert_eq "$(stat -c %a "$(ACC "$fxo")/a/token-meta.json")" "600" "ORG1 token-meta 0600"
assert_not_contains "$(cat "$(ACC "$fxo")/registry.json")" "org" "ORG1 registry.json row keys unchanged (no org)"
assert_contains "$(cat "$fxo/out.txt")" "FAKE Org One（方案：max）" "ORG1 org name and plan shown"
assert_contains "$(cat "$fxo/out.txt")" "org 未驗證" "ORG1 summary marks org unverified when the envelope has no org id"
assert_contains "$(grep -h '^alias=a ' "$fxo/out.txt" | head -1)" 'org="FAKE Org One" org_check=unverified' "ORG1 status shows the label and unverified"
assert_eq "$(no_email "$fxo")" "" "ORG1 e-mail appears in no file or output"

# PROMPTS: each step says what to do, in which window, and what success looks like; the receipt line never carries the token.
assert_contains "$(cat "$fxo/out.txt")" "已收到 token（不顯示內容）" "PROMPT paste receipt shown"
assert_contains "$(cat "$fxo/out.txt")" "成功的樣子：那個視窗印出一長串 token" "PROMPT setup-token says what success looks like"
assert_contains "$(cat "$fxo/out.txt")" "目前登入的 org：" "PROMPT org step shows the org line"
assert_contains "$(cat "$fxo/out.txt")" "步驟 ④ 完成 ✅ 別名 a" "PROMPT say-OK success names the alias"
assert_contains "$(cat "$fxo/out.txt")" "每一列都是 ✅" "PROMPT summary says what success looks like"
assert_eq "$(grep -h '已收到 token' "$fxo/out.txt" | grep -cF -e "$TA" || true)" "0" "PROMPT receipt line does not carry the token"
assert_contains "$(cat "$fx3/out.txt")" "修法" "PROMPT a failed run says how to fix it"

# O2. envelope carries the org id: match -> verified; mismatch -> failed row.
fxv="$(mkfx "$TA")"; setctl "$fxv" envOrg '"FAKE-ORG-1"'
run_onboard "$SCRIPT" "$fxv" $'y\n'"$TA"$'\n' a
assert_eq "$(rc_of "$fxv")" "0" "ORG2 matching envelope org: exit 0"
assert_contains "$(cat "$fxv/out.txt")" "回應帶有 org 識別碼，與記錄相符" "ORG2 verified row"
assert_contains "$(meta_of "$fxv" a)" '"org_check":"verified"' "ORG2 org_check verified recorded"
fxw="$(mkfx "$TA")"; setctl "$fxw" envOrg '"FAKE-ORG-OTHER"'
run_onboard "$SCRIPT" "$fxw" $'y\n'"$TA"$'\n' a
assert_neq "$(rc_of "$fxw")" "0" "ORG2 mismatching envelope org: exit non-zero"
assert_contains "$(cat "$fxw/out.txt")" "❌  a org 核對" "ORG2 mismatch row is red"

# O3. RED: same orgId for a second alias -> refused before any write, existing alias named, files unchanged.
fxd="$(mkfx "$TA" "$TB")"
setctl "$fxd" auth "[$(authj FAKE-ORG-1 'FAKE Org One'),$(authj FAKE-ORG-1 'FAKE Org One')]"
run_onboard "$SCRIPT" "$fxd" $'y\n'"$TA"$'\n' a
before_d="$(tree_digest "$(ACC "$fxd")")"
run_onboard "$SCRIPT" "$fxd" $'y\n'"$TB"$'\n' b
assert_neq "$(rc_of "$fxd")" "0" "ORG3 duplicate org: exit non-zero"
assert_contains "$(cat "$fxd/out.txt")" "已經由 profile a 登記" "ORG3 names the existing alias"
assert_eq "$(tree_digest "$(ACC "$fxd")")" "$before_d" "ORG3 accounts dir byte-identical after the refusal (no dir, token, meta or registry change)"
[ ! -e "$(ACC "$fxd")/b" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "ORG3 refused alias got a directory"
assert_eq "$(no_email "$fxd")" "" "ORG3 e-mail appears nowhere"

# O4. RED: auth status unreadable / non-JSON / no orgId -> fails closed; --org proceeds with org_id unknown.
for bad in 'FAIL' '"not json at all"' "$(printf '{"loggedIn":true,"email":"%s","orgName":"x"}' "$FAKE_EMAIL")"; do
  fxu="$(mkfx "$TA")"; setctl "$fxu" auth "[$( [ "$bad" = FAIL ] && echo '"FAIL"' || { case "$bad" in \"*) echo "$bad" ;; *) echo "$bad" ;; esac; } )]"
  run_onboard "$SCRIPT" "$fxu" $'y\n'"$TA"$'\n' a
  assert_neq "$(rc_of "$fxu")" "0" "ORG4 unreadable auth status fails closed ($(printf '%s' "$bad" | cut -c1-12))"
  assert_contains "$(cat "$fxu/out.txt")" "--org a=" "ORG4 message names the --org remedy"
  [ ! -e "$(ACC "$fxu")/registry.json" ] && [ ! -e "$(ACC "$fxu")/a/token" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "ORG4 failed closed but wrote registry or token"
  assert_eq "$(no_email "$fxu")" "" "ORG4 e-mail appears nowhere"
done
fxu="$(mkfx "$TA")"; setctl "$fxu" auth '["FAIL"]'
run_onboard "$SCRIPT" "$fxu" $'\n'"$TA"$'\n' --org a=Hand-Label a
assert_eq "$(rc_of "$fxu")" "0" "ORG4 --org lets the unreadable case proceed"
assert_contains "$(meta_of "$fxu" a)" '"org_id":null' "ORG4 org_id recorded as unknown"
assert_contains "$(meta_of "$fxu" a)" '"org_label":"Hand-Label"' "ORG4 org_label as given"
assert_contains "$(cat "$fxu/out.txt")" "org 未驗證" "ORG4 summary says org unverified"
assert_contains "$(cat "$fxu/shim.log")" "auth_status" "ORG4 --org still reads auth status (an id, when readable, is recorded)"

# O5. RED: email-shaped org_label refused (via --org, and via an orgName that carries an e-mail) with nothing created.
fxe="$(mkfx "$TA")"
run_onboard "$SCRIPT" "$fxe" "" --org "a=$FAKE_EMAIL" a
assert_eq "$(rc_of "$fxe")" "2" "ORG5 email-shaped --org label refused (exit 2)"
assert_not_contains "$(cat "$fxe/out.txt" "$fxe/err.txt")" "$FAKE_EMAIL" "ORG5 refusal does not echo the label"
[ ! -e "$fxe/fakehome/.config" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "ORG5 refused label created the accounts dir"

# H. orgName carries an e-mail but orgId is readable: the id is recorded and checked, the name is neither shown nor stored.
HID="$(authj FAKE-ORG-9 "$FAKE_EMAIL's Organization")"
fxh="$(mkfx "$TA" "$TB")"; setctl "$fxh" auth "[$HID,$HID,$HID,$HID]"
run_onboard "$SCRIPT" "$fxh" $'personal\n'"$TA"$'\n' a
assert_eq "$(rc_of "$fxh")" "0" "H1 hidden org name, typed label: exit 0"
assert_contains "$(meta_of "$fxh" a)" '"org_id":"fake-org-9"' "H1 orgId stored although the name is hidden"
assert_contains "$(meta_of "$fxh" a)" '"org_label":"personal"' "H1 label is the typed one"
assert_contains "$(meta_of "$fxh" a)" '"org_check":"verified"' "H1 org_check verified"
assert_contains "$(cat "$fxh/out.txt")" "org 已驗證（名稱已隱藏）" "H1 summary says verified, name hidden"
assert_eq "$(no_email "$fxh")" "" "H1 the e-mail-bearing name appears nowhere"
assert_not_contains "$(meta_of "$fxh" a)" "Organization" "H1 the name is not stored"
# second registration of the same orgId: refused, nothing written, whether the label is typed or given by --org
before_h="$(tree_digest "$(ACC "$fxh")")"
run_onboard "$SCRIPT" "$fxh" $'other\n'"$TB"$'\n' b
assert_neq "$(rc_of "$fxh")" "0" "H2 same orgId, typed label: refused"
assert_contains "$(cat "$fxh/out.txt")" "已經由 profile a 登記" "H2 names the existing alias"
assert_eq "$(tree_digest "$(ACC "$fxh")")" "$before_h" "H2 nothing written (typed label)"
run_onboard "$SCRIPT" "$fxh" "$TB"$'\n' --org b=Other-Label b
assert_neq "$(rc_of "$fxh")" "0" "H2 same orgId, --org label: refused"
assert_eq "$(tree_digest "$(ACC "$fxh")")" "$before_h" "H2 nothing written (--org)"
assert_eq "$(no_email "$fxh")" "" "H2 no e-mail anywhere"
# --org with a readable orgId records the id (verified) and the given label
fxh2="$(mkfx "$TA")"; setctl "$fxh2" auth "[$HID]"
run_onboard "$SCRIPT" "$fxh2" "$TA"$'\n' --org a=Given-Label a
assert_eq "$(rc_of "$fxh2")" "0" "H3 --org with readable orgId: exit 0"
assert_contains "$(meta_of "$fxh2" a)" '"org_id":"fake-org-9"' "H3 orgId stored"
assert_contains "$(meta_of "$fxh2" a)" '"org_label":"Given-Label"' "H3 given label stored"
# no label input at all (non-interactive) and no --org: fail closed with a remedy, nothing written
fxh3="$(mkfx "$TA")"; setctl "$fxh3" auth "[$HID]"
run_onboard "$SCRIPT" "$fxh3" "" a
assert_neq "$(rc_of "$fxh3")" "0" "H4 hidden name, no input, no --org: fails"
assert_contains "$(cat "$fxh3/out.txt")" "--org a=" "H4 remedy names --org"
[ ! -e "$(ACC "$fxh3")/registry.json" ] && [ ! -e "$(ACC "$fxh3")/a/token" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "H4 wrote registry or token"
# typed label that looks like an e-mail is refused three times, then fail closed
fxh4="$(mkfx "$TA")"; setctl "$fxh4" auth "[$HID]"
run_onboard "$SCRIPT" "$fxh4" "$FAKE_EMAIL"$'\n'"$FAKE_EMAIL"$'\n'"$FAKE_EMAIL"$'\n' a
assert_neq "$(rc_of "$fxh4")" "0" "H5 e-mail-shaped typed label: fails"
assert_eq "$(no_email "$fxh4")" "" "H5 no e-mail anywhere"
[ ! -e "$(ACC "$fxh4")/registry.json" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "H5 wrote registry"

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
  local fx="$1" input="$2"; shift 2
  rm -f "$fx/rc"
  ( printf '%s' "$input" | env -i PATH="$PATH" LANG=C HOME="$fx/fakehome" TMPDIR="$fx/tmp" XDG_RUNTIME_DIR="$fx/run" \
      AUTOPILOT_ACCOUNTS_DIR="$fx/fakehome/.config/autopilot/accounts" AUTOPILOT_LIVE_DIR="$fx/live" \
      AUTOPILOT_STATE_DIR="$fx/state" AUTOPILOT_CONFIG="$fx/config.json" ENGINE_CAPABILITY_DIR="$fx/ecd" \
      AUTOPILOT_STRIKE_WRITER=off ONBOARD_CLAUDE_BIN="$fx/bin/claude" \
      script -qec "$(printf '%q ' "$SCRIPT" "$@")" /dev/null > "$fx/out.txt" 2> "$fx/err.txt"
    echo $? > "$fx/rc" )
}
if command -v script >/dev/null 2>&1; then
  fxt="$(mkfx "$TA")"
  run_tty "$fxt" $'\n' a
  assert_eq "$(rc_of "$fxt")" "1" "PLAN tty default N: exit 1"
  assert_contains "$(cat "$fxt/out.txt")" "繼續？[y/N]" "PLAN tty asks to continue"
  [ ! -e "$fxt/fakehome/.config" ] && [ ! -e "$fxt/shim.log" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "PLAN tty decline created something"
  run_tty "$fxt" $'y\ny\n'"$TA"$'\n' a
  assert_eq "$(rc_of "$fxt")" "0" "PLAN tty y proceeds"
else echo "SKIP [accounts-onboard] script(1) unavailable: the tty plan-question cases are skipped, not passed" >&2; fi

# B. the org state follows the facts: verified, then a token of another org -> mismatch, never stays verified.
fxb="$(mkfx "$TA" "$TA2")"; setctl "$fxb" envOrg '"fake-org-1"'
run_onboard "$SCRIPT" "$fxb" $'y\n'"$TA"$'\n' a
assert_contains "$(meta_of "$fxb" a)" '"org_check":"verified"' "B verified first"
setctl "$fxb" envOrg '"some-other-org"'
run_onboard "$SCRIPT" "$fxb" $'覆蓋\n'"$TA2"$'\n' a
assert_neq "$(rc_of "$fxb")" "0" "B token of another org: exit non-zero"
assert_contains "$(meta_of "$fxb" a)" '"org_check":"mismatch"' "B org_check no longer verified after a mismatch"
assert_contains "$(grep -h '^alias=a ' "$fxb/out.txt" | head -1)" 'org_check=mismatch' "B status shows the mismatch"
# a later OK call whose envelope carries no org id must not erase the mismatch
setctl "$fxb" envOrg 'null'
run_onboard "$SCRIPT" "$fxb" $'覆蓋\n'"$TA2"$'\n' a
assert_contains "$(meta_of "$fxb" a)" '"org_check":"mismatch"' "B a later envelope without an org id keeps the mismatch"
assert_contains "$(grep -h '^alias=a ' "$fxb/out.txt" | head -1)" 'org_check=mismatch' "B status still shows the mismatch"
# the typed-label prompt and retry message name the double quote among the refusal reasons
fxq="$(mkfx "$TA")"; setctl "$fxq" auth "[$HID]"
run_onboard "$SCRIPT" "$fxq" $'bad"label\nbad"label\nbad"label\n' a
assert_contains "$(cat "$fxq/out.txt")" "雙引號" "E the retry message lists the double quote"
assert_contains "$(cat "$fxq/out.txt")" "不可含 @ 或雙引號" "E the label prompt lists the double quote"

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

# E. orgId is case-folded; --org cannot bypass the duplicate check when the id is readable.
fxc="$(mkfx "$TA" "$TB")"; setctl "$fxc" auth "[$(authj FAKE-ORG-7 'FAKE Org Seven'),$(authj fake-org-7 'FAKE Org Seven')]"
run_onboard "$SCRIPT" "$fxc" $'y\n'"$TA"$'\n' a
assert_contains "$(meta_of "$fxc" a)" '"org_id":"fake-org-7"' "E orgId stored lower-case"
before_c="$(tree_digest "$(ACC "$fxc")")"
run_onboard "$SCRIPT" "$fxc" "$TB"$'\n' --org b=Whatever b
assert_neq "$(rc_of "$fxc")" "0" "E same org in another letter case with --org: still refused"
assert_contains "$(cat "$fxc/out.txt")" "已經由 profile a 登記" "E refusal names a"
assert_eq "$(tree_digest "$(ACC "$fxc")")" "$before_c" "E nothing written"

# NC7: duplicate-org check removed -> ORG3 must turn red.
m7="$(mkmut orgdup 's#^      owner="\$(nodeh orgowner.*#      owner=""#')"
fxm7="$(mkfx "$TA" "$TB")"
setctl "$fxm7" auth "[$(authj FAKE-ORG-1 'FAKE Org One'),$(authj FAKE-ORG-1 'FAKE Org One')]"
run_onboard "$m7" "$fxm7" "$INPUT_TOK" a b
assert_eq "$(rc_of "$fxm7")" "0" "NC7 without the duplicate check the same org registers twice (ORG3 would be red)"

# NC8: org label hygiene removed (validate and metaset) -> ORG5 must turn red: the e-mail lands in token-meta.json.
m8="$(mkmut orglabel 's/if (lp) die(/if (false) die(/')"
fxm8="$(mkfx "$TA")"
run_onboard "$m8" "$fxm8" $'\n'"$TA"$'\n' --org "a=$FAKE_EMAIL" a
assert_contains "$(no_email "$fxm8")" "leaked-file" "NC8 without the label check the e-mail is written to a file (the ORG5 case would be red)"

finalize_test
