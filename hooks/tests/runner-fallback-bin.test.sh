#!/usr/bin/env bash
# runner-fallback-bin.test.sh — runner binaries that are installed but NOT on PATH still resolve.
#
# The team account keeps codex and agy in ~/.local/bin and grok in ~/.grok/bin (also ~/.local/bin);
# a normal session PATH holds neither, so every dispatcher refused with "<runner> binary not found"
# while the runner sat installed. scripts/lib/runner-fallback-bin.sh (bash dispatchers) and
# RUNNER_BINARY_FALLBACK_PATHS in scripts/lib/runner-binary.js (topology, version probe) now look
# there when PATH misses.
#
# RED at 07dee9a56: case (b) `runner_bin_fallback` does not exist; case (e) dispatch-author.sh
#   --runner codex exits "codex binary not found" with the stub installed under $HOME/.local/bin.
# Negative controls (sed_mutant): drop the .local/bin entries from either table, or the call in
# dispatch-author.sh, and the matching case goes red.
# Hermetic: HOME is an empty fixture home, the runners are shell stubs, PATH holds no real runner.
. "$(dirname "$0")/lib.sh"
# lib.sh exports AUTOPILOT_RUNNER_HOME_FALLBACK=off for every suite so a runner removed from PATH is never
# found at the real home. This is the one suite that tests the HOME lookup, always against a fixture HOME.
export AUTOPILOT_RUNNER_HOME_FALLBACK=on

LIBSH="$REPO_ROOT/scripts/lib/runner-fallback-bin.sh"
LIBJS="$REPO_ROOT/scripts/lib/runner-binary.js"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"

FX="$TEST_TMP/fx"
mkdir -p "$FX/home/.local/bin" "$FX/home/.grok/bin" "$FX/home/.kimi-code/bin" "$FX/pathbin" "$FX/sentinel" "$FX/nodebin"
CALLS="$FX/calls.log"
mkstub() { # <file> <label>
  printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 97\n' "$2" "$CALLS" > "$1"
  chmod +x "$1"
}
mkstub "$FX/home/.local/bin/codex" fixture-local-codex
mkstub "$FX/home/.local/bin/agy" fixture-local-agy
mkstub "$FX/home/.local/bin/grok" fixture-local-grok
mkstub "$FX/home/.grok/bin/grok" fixture-grokdir-grok
mkstub "$FX/home/.kimi-code/bin/kimi" fixture-kimi
mkstub "$FX/sentinel/codex" sentinel-codex
mkstub "$FX/pathbin/agy" pathbin-agy
ln -s "$(command -v node)" "$FX/nodebin/node"
# A PATH that holds no real runner: fixture node + the system dirs (no codex/agy/grok/kimi there).
BASE_PATH="$FX/nodebin:/usr/bin:/bin"
for r in codex agy grok kimi; do
  if PATH="$BASE_PATH" command -v "$r" >/dev/null 2>&1; then fail "precondition: $r is on the scrubbed PATH"; fi
done

# (a) the two tables agree runner by runner
BASH_TABLE="$(for r in codex agy grok kimi; do
  HOME="$FX/home" PATH="$BASE_PATH" bash -c '. "$1"; for r in "$2"; do printf "%s=%s\n" "$r" "$(runner_bin_fallback "$r")"; done' _ "$LIBSH" "$r"
done)"
JS_TABLE="$(node -e '
const { RUNNER_BINARY_FALLBACK_PATHS: T } = require(process.argv[1]);
const fs = require("fs"); const path = require("path");
for (const r of ["codex", "agy", "grok", "kimi"]) {
  let hit = r;
  for (const rel of (T[r] || [])) { const c = path.join(process.argv[2], rel); if (fs.existsSync(c)) { hit = c; break; } }
  console.log(r + "=" + hit);
}' "$LIBJS" "$FX/home")"
assert_eq "$JS_TABLE" "$BASH_TABLE" "(a) bash and JS fallback tables resolve every runner to the same file"
assert_contains "$BASH_TABLE" "codex=$FX/home/.local/bin/codex" "(a) codex resolves under .local/bin"
assert_contains "$BASH_TABLE" "grok=$FX/home/.grok/bin/grok" "(a) grok prefers .grok/bin over .local/bin"

# (b) bash resolver contract
run_fb() { HOME="$FX/home" PATH="$1" bash -c '. "$2"; runner_bin_fallback "$1"' _ "$2" "$LIBSH"; }
assert_eq "$FX/home/.local/bin/agy" "$(run_fb "$BASE_PATH" agy)" "(b) agy off PATH resolves to the .local/bin file"
assert_eq "agy" "$(run_fb "$FX/pathbin:$BASE_PATH" agy)" "(b) a PATH hit is returned as the bare name (PATH wins)"
assert_eq "codex" "$(run_fb "$FX/sentinel:$BASE_PATH" codex)" "(b) a sentinel dir first on PATH keeps the bare name, never the fixture file"
assert_eq "/some/explicit/codex" "$(run_fb "$BASE_PATH" /some/explicit/codex)" "(b) an explicit path is returned untouched"
assert_eq "mystery" "$(run_fb "$BASE_PATH" mystery)" "(b) a runner with no table entry is returned unchanged"
EMPTY_HOME_OUT="$(HOME="$FX/nohome" PATH="$BASE_PATH" bash -c '. "$1"; runner_bin_fallback codex' _ "$LIBSH")"
assert_eq "codex" "$EMPTY_HOME_OUT" "(b) with no fixture file the name is returned unchanged so the caller still refuses"

# (c) JS resolver: PATH first, then the table
JS_RESOLVE='const m = require(process.argv[1]); process.stdout.write(String(m.resolveBinaryPath(process.argv[2], process.argv[2])));'
assert_eq "$FX/home/.local/bin/codex" "$(HOME="$FX/home" PATH="$BASE_PATH" node -e "$JS_RESOLVE" "$LIBJS" codex)" "(c) runner-binary.js resolves codex under HOME/.local/bin"
assert_eq "$FX/sentinel/codex" "$(HOME="$FX/home" PATH="$FX/sentinel:$BASE_PATH" node -e "$JS_RESOLVE" "$LIBJS" codex)" "(c) a sentinel dir first on PATH wins over the fallback"

# (d) topology installed-runner detection uses the same table
TOPO_OUT="$TEST_TMP/topo.json"
HOME="$FX/home" PATH="$BASE_PATH" node "$REPO_ROOT/scripts/resolve-dispatch-topology.js" --json --role reviewer --out "$TOPO_OUT" >/dev/null 2>&1
INSTALLED="$(node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const i=t.runners_installed||{}; process.stdout.write(["codex","agy","grok"].map(r=>r+":"+(i[r]?"yes":"no")).join(","));' "$TOPO_OUT" 2>/dev/null)"
assert_eq "codex:yes,agy:yes,grok:yes" "$INSTALLED" "(d) topology lists codex, agy and grok installed from the fixture home"

# (e) the plan-review transport (dispatch-author.sh) gets past its binary precondition
PROMPT="$FX/prompt.txt"; printf 'hello\n' > "$PROMPT"
run_author() { # <script> <home> <path>
  HOME="$2" PATH="$3" DISPATCH_QUIET=1 DISPATCH_DETACH=0 bash "$1" --runner codex --model gpt-fixture --effort low \
    --prompt-file "$PROMPT" --timeout 20s </dev/null 2>&1
}
: > "$CALLS"
OUT_E="$(run_author "$AUTHOR" "$FX/home" "$BASE_PATH")"
assert_not_contains "$OUT_E" "binary not found" "(e) dispatch-author.sh no longer refuses a codex that is only under HOME/.local/bin"
assert_contains "$(cat "$CALLS")" "fixture-local-codex" "(e) the stub under HOME/.local/bin is what ran"
: > "$CALLS"
OUT_E0="$(run_author "$AUTHOR" "$FX/nohome" "$BASE_PATH")"
assert_contains "$OUT_E0" "codex binary not found" "(e) with no codex anywhere the precondition still refuses"

# (e2) kimi: the precondition AND the adapter (which spawns `kimi` by name) both reach ~/.kimi-code/bin
: > "$CALLS"
OUT_K="$(HOME="$FX/home" PATH="$BASE_PATH" DISPATCH_QUIET=1 DISPATCH_DETACH=0 bash "$AUTHOR" --runner kimi --model kimi-code/k3.1-pro --effort high \
  --prompt-file "$PROMPT" --timeout 20s </dev/null 2>&1)"
assert_not_contains "$OUT_K" "kimi binary not found" "(e2) dispatch-author.sh finds kimi under HOME/.kimi-code/bin"
assert_contains "$(cat "$CALLS")" "fixture-kimi" "(e2) the adapter ran the same kimi stub the precondition found"

# Negative controls: each mutation must turn its case red.
mkmut() { # <name> <script-relpath> <sed command> -> prints the mutant path, tree = symlinks to scripts/
  local d="$TEST_TMP/mut-$1" f rel="$2"
  mkdir -p "$d/scripts"
  for f in "$REPO_ROOT"/scripts/*; do
    case "$(basename "$f")" in "$(basename "$rel")"|lib) ;; *) ln -s "$f" "$d/scripts/$(basename "$f")" ;; esac
  done
  if [ "$(dirname "$rel")" = "lib" ]; then
    mkdir -p "$d/scripts/lib"
    for f in "$REPO_ROOT"/scripts/lib/*; do [ "$(basename "$f")" = "$(basename "$rel")" ] || ln -s "$f" "$d/scripts/lib/$(basename "$f")"; done
    sed_mutant "$REPO_ROOT/scripts/$rel" "$d/scripts/$rel" "$3" || return 1
  else
    ln -s "$REPO_ROOT/scripts/lib" "$d/scripts/lib"
    sed_mutant "$REPO_ROOT/scripts/$rel" "$d/scripts/$rel" "$3" || return 1
  fi
  echo "$d/scripts/$rel"
}

M_CALL="$(mkmut nocall dispatch-author.sh 's|CODEX_BIN="$(runner_bin_fallback "${BIN:-codex}")"|CODEX_BIN="${BIN:-codex}"|')"
OUT_NC1="$(run_author "$M_CALL" "$FX/home" "$BASE_PATH")"
assert_contains "$OUT_NC1" "codex binary not found" "(NC1) without the fallback call dispatch-author.sh refuses again"

M_KIMI="$(mkmut nokimipath dispatch-author.sh 's|^  case "$KIMI_BIN" in /\*) PATH="$PATH:$(dirname "$KIMI_BIN")" ;; esac$|  :|')"
[ -n "$M_KIMI" ] || fail "(NC4) mutant dispatch-author.sh was not built"
: > "$CALLS"
HOME="$FX/home" PATH="$BASE_PATH" DISPATCH_QUIET=1 DISPATCH_DETACH=0 bash "$M_KIMI" --runner kimi --model kimi-code/k3.1-pro --effort high \
  --prompt-file "$PROMPT" --timeout 20s </dev/null >/dev/null 2>&1
assert_not_contains "$(cat "$CALLS")" "fixture-kimi" "(NC4) without the PATH append the adapter cannot find kimi"

M_JS="$(mkmut notable lib/runner-binary.js "/^  codex: \\['.local\\/bin\\/codex'\\],\$/d")"
assert_eq "null" "$(HOME="$FX/home" PATH="$BASE_PATH" node -e "const m = require(process.argv[1]); process.stdout.write(String(m.resolveBinaryPath('codex', 'codex')));" "$M_JS")" "(NC2) without the codex table entry the JS resolver finds nothing"

M_SH="$(mkmut nosh lib/runner-fallback-bin.sh 's|    codex) rels=".local/bin/codex" ;;|    codex) rels="" ;;|')"
assert_eq "codex" "$(HOME="$FX/home" PATH="$BASE_PATH" bash -c '. "$1"; runner_bin_fallback codex' _ "$M_SH")" "(NC3) without the codex table entry the bash resolver keeps the bare name"

# (f) the test lib turns the HOME lookup off: with a fake codex only under a fixture HOME and none on PATH,
# nothing resolves it. A suite that drops a runner from PATH on purpose must never reach the real one.
PROBE_LIB="$FX/probe-lib.sh"
cat > "$PROBE_LIB" <<'PROBE'
#!/usr/bin/env bash
# usage: probe-lib.sh <tree root holding hooks/tests/lib.sh> <fixture home> <path> <scripts/lib dir>
. "$1/hooks/tests/lib.sh"
export HOME="$2" PATH="$3"
. "$4/runner-fallback-bin.sh"
printf 'bash=%s\n' "$(runner_bin_fallback codex)"
printf 'js=%s\n' "$(node -e "const m=require(process.argv[1]);process.stdout.write(String(m.resolveBinaryPath('codex','codex')))" "$4/runner-binary.js")"
PROBE
OUT_F="$(env -u AUTOPILOT_RUNNER_HOME_FALLBACK bash "$PROBE_LIB" "$REPO_ROOT" "$FX/home" "$BASE_PATH" "$REPO_ROOT/scripts/lib" </dev/null)"
assert_contains "$OUT_F" "bash=codex" "(f) under the test lib the bash fallback does not use the fixture HOME/.local/bin/codex"
assert_contains "$OUT_F" "js=null" "(f) under the test lib the JS resolver does not use it either"
assert_eq "codex" "$(AUTOPILOT_RUNNER_HOME_FALLBACK=off run_fb "$BASE_PATH" codex)" "(f) AUTOPILOT_RUNNER_HOME_FALLBACK=off keeps the bare name even with the fixture file present"
assert_eq "null" "$(AUTOPILOT_RUNNER_HOME_FALLBACK=off HOME="$FX/home" PATH="$BASE_PATH" node -e "$JS_RESOLVE" "$LIBJS" codex)" "(f) =off makes the JS resolver find nothing"

# (NC5) default flipped to on in a copy of lib.sh: the fixture codex is found again, so (f) would go red.
MUT_LIBTREE="$TEST_TMP/mut-libdefault"
mkdir -p "$MUT_LIBTREE/hooks/tests"
ln -s "$REPO_ROOT/scripts" "$MUT_LIBTREE/scripts"
ln -s "$REPO_ROOT/src" "$MUT_LIBTREE/src"
sed_mutant "$REPO_ROOT/hooks/tests/lib.sh" "$MUT_LIBTREE/hooks/tests/lib.sh" 's|^export AUTOPILOT_RUNNER_HOME_FALLBACK=off$|export AUTOPILOT_RUNNER_HOME_FALLBACK=on|' || fail "(NC5) lib.sh mutant was not built"
OUT_NC5="$(env -u AUTOPILOT_RUNNER_HOME_FALLBACK bash "$PROBE_LIB" "$MUT_LIBTREE" "$FX/home" "$BASE_PATH" "$REPO_ROOT/scripts/lib" </dev/null)"
assert_contains "$OUT_NC5" "bash=$FX/home/.local/bin/codex" "(NC5) with the lib default flipped to on the bash fallback reaches the fixture codex"
assert_contains "$OUT_NC5" "js=$FX/home/.local/bin/codex" "(NC5) and so does the JS resolver"

finalize_test
