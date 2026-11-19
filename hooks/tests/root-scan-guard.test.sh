#!/usr/bin/env bash
# Root-scan guard: refuse find/grep/rg searches that start at /.
# Stubs stand in for the real binaries so this suite never scans the disk.
set -uo pipefail

. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHIM="$REPO_ROOT/scripts/shims/root-scan"
GUARD_JS="$REPO_ROOT/scripts/lib/root-scan-guard.js"
SHIM_JS="$REPO_ROOT/scripts/root-scan-shim.js"
AUDIT="$TEST_TMP/audit.log"
STUB="$TEST_TMP/stub-bin"
WORK="$TEST_TMP/work"
NODEBIN="$TEST_TMP/node-bin"
mkdir -p "$STUB" "$WORK" "$NODEBIN"
REAL_NODE="$(command -v node)"
cat > "$NODEBIN/node" << EOF
#!/bin/sh
exec ${REAL_NODE} "\$@"
EOF
chmod +x "$NODEBIN/node"
cat > "$NODEBIN/dirname" << 'EOF'
#!/bin/sh
exec /usr/bin/dirname "$@"
EOF
chmod +x "$NODEBIN/dirname"

for tool in find grep egrep fgrep rg; do
  cat > "$STUB/$tool" << EOF
#!/bin/sh
printf 'REAL ${tool}'
for a in "\$@"; do printf ' <%s>' "\$a"; done
printf '\\n'
exit "\${STUB_EXIT:-0}"
EOF
  chmod +x "$STUB/$tool"
done

reset_audit() { rm -f "$AUDIT"; }

# run_at <cwd> <tool> [args...]  -> sets RUN_OUT RUN_ERR RUN_CODE
run_at() {
  local cwd="$1" tool="$2"
  shift 2
  RUN_OUT="$TEST_TMP/out.txt"
  RUN_ERR="$TEST_TMP/err.txt"
  : > "$RUN_OUT"
  : > "$RUN_ERR"
  set +e
  (
    cd "$cwd" || exit 99
    PATH="$SHIM:$STUB:$NODEBIN" AUTOPILOT_ROOT_SCAN_AUDIT="$AUDIT" STUB_EXIT="${STUB_EXIT:-0}" \
      "$tool" "$@" < /dev/null >"$RUN_OUT" 2>"$RUN_ERR"
  )
  RUN_CODE=$?
}

assert_refused() {
  local msg="$1"
  assert_exit_code "$RUN_CODE" 126 "$msg exit"
  if grep -q '^REAL ' "$RUN_OUT"; then
    fail "$msg: stub ran"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  if grep -q '^root-scan-guard: refused: ' "$RUN_ERR"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg: stderr missing refusal prefix: $(cat "$RUN_ERR")"
  fi
}

assert_allowed() {
  local msg="$1" tool="$2"
  assert_exit_code "$RUN_CODE" 0 "$msg exit"
  if grep -q "^REAL $tool" "$RUN_OUT"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg: stub did not run: out=$(cat "$RUN_OUT") err=$(cat "$RUN_ERR")"
  fi
  if [ -e "$AUDIT" ] && [ -s "$AUDIT" ]; then
    fail "$msg: audit line written: $(cat "$AUDIT")"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
}

echo "RED incident: find / -name hippo"
reset_audit
STUB_EXIT=0
run_at "$WORK" find / -name hippo
assert_refused "find / -name hippo"
if [ -f "$AUDIT" ]; then
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    if (lines.length !== 1) { console.error("audit lines " + lines.length); process.exit(1); }
    const o = JSON.parse(lines[0]);
    const argv = JSON.stringify(o.argv);
    if (o.tool !== "find" || argv !== JSON.stringify(["/","-name","hippo"])) {
      console.error("audit payload " + lines[0]);
      process.exit(1);
    }
    if (typeof o.ts !== "string" || typeof o.cwd !== "string" || typeof o.reason !== "string" || typeof o.pid !== "number") {
      console.error("audit fields " + lines[0]);
      process.exit(1);
    }
  ' "$AUDIT"
  if [ $? -eq 0 ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "audit JSON mismatch: $(cat "$AUDIT" 2>/dev/null)"
  fi
  mode=$(stat -c %a "$AUDIT")
  assert_eq "$mode" "600" "audit mode 0600"
else
  fail "audit file missing"
fi

echo "refused variants"
for spec in \
  "grep -r hippo /" \
  "grep -rn x //" \
  "grep -R x /./" \
  "rg hippo /" \
  "find /tmp/.. -name x" \
  "find -L / -name x"
do
  # shellcheck disable=SC2086
  set -- $spec
  tool=$1; shift
  reset_audit
  run_at "$WORK" "$tool" "$@"
  assert_refused "$spec"
done

for spec in "find -name x" "grep -r x" "rg x"; do
  set -- $spec
  tool=$1; shift
  reset_audit
  run_at / "$tool" "$@"
  assert_refused "cwd=/ $spec"
done

echo "allowed"
reset_audit; run_at "$WORK" find . -name x; assert_allowed "find ." find
reset_audit; run_at "$WORK" find /home -name x; assert_allowed "find /home" find
reset_audit; run_at "$WORK" grep x /etc/hosts; assert_allowed "grep file" grep
reset_audit; run_at "$WORK" grep -r x src; assert_allowed "grep -r src" grep
reset_audit; run_at "$WORK" grep -e / -r x .; assert_allowed "grep -e pattern" grep
reset_audit; run_at "$WORK" rg -g / x .; assert_allowed "rg -g" rg
reset_audit; run_at "$WORK" rg x; assert_allowed "rg cwd tmp" rg

echo "round 2 refused"
reset_audit; run_at "$WORK" grep -r --color x /; assert_refused "grep -r --color x /"
reset_audit; run_at "$WORK" grep --rec x /; assert_refused "grep --rec x /"
reset_audit; run_at "$WORK" grep --dir recurse x /; assert_refused "grep --dir recurse x /"
reset_audit; run_at "$WORK" grep --recursi x /; assert_refused "grep --recursi x /"
reset_audit; run_at "$WORK" grep -r --regex PAT /; assert_refused "grep -r --regex PAT /"
reset_audit; run_at "$WORK" rg --files /; assert_refused "rg --files /"
reset_audit; run_at "$WORK" rg --files -g '*.md' /; assert_refused "rg --files -g glob /"
reset_audit; run_at "$WORK" find -- /; assert_refused "find -- /"
reset_audit; run_at "$WORK" rg --ignore-file / x /; assert_refused "rg --ignore-file / x /"
reset_audit; run_at "$WORK" rg --color never x /; assert_refused "rg --color never x /"

echo "round 2 allowed"
reset_audit; run_at "$WORK" grep -r --color=auto x src; assert_allowed "grep --color=auto" grep
reset_audit; run_at "$WORK" rg --color never x .; assert_allowed "rg --color never" rg
reset_audit; run_at "$WORK" rg --files src; assert_allowed "rg --files src" rg
reset_audit; run_at "$WORK" find -- . -name x; assert_allowed "find -- ." find
reset_audit; run_at "$WORK" grep -e / -r x .; assert_allowed "grep -e / still" grep
reset_audit; run_at "$WORK" rg -g / x .; assert_allowed "rg -g / still" rg
reset_audit; run_at "$WORK" grep x /etc/hosts; assert_allowed "grep hosts still" grep

echo "audit preexisting 0644"
reset_audit
printf 'old-line\n' > "$AUDIT"
chmod 644 "$AUDIT"
run_at "$WORK" find / -name hippo
assert_refused "preexisting audit refusal"
mode=$(stat -c %a "$AUDIT")
assert_eq "$mode" "600" "audit fchmod preexisting 0600"
if grep -qx 'old-line' "$AUDIT" && [ "$(grep -c . "$AUDIT")" -eq 2 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "audit not appended: $(cat "$AUDIT" 2>/dev/null)"
fi

echo "status passthrough"
reset_audit
STUB_EXIT=3
run_at "$WORK" find . -name x
assert_exit_code "$RUN_CODE" 3 "stub exit 3"
STUB_EXIT=0

echo "missing real binary"
reset_audit
set +e
(
  cd "$WORK" || exit 99
  PATH="$SHIM:$NODEBIN" AUTOPILOT_ROOT_SCAN_AUDIT="$AUDIT" find . -name x < /dev/null >/dev/null 2>"$TEST_TMP/miss.err"
)
miss=$?
set -e
assert_exit_code "$miss" 127 "no real binary"
if grep -q 'root-scan-guard:' "$TEST_TMP/miss.err"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "127 stderr: $(cat "$TEST_TMP/miss.err")"
fi

echo "classify units"
node -e '
const { classify } = require(process.argv[1]);
const cwd = process.argv[2];
function need(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }
for (const p of ["/", "//", "/.", "/./", "/..", "/tmp/.."]) {
  const r = classify({ tool: "find", args: [p, "-name", "x"], cwd });
  need(r.refuse === true && r.root_path === p, "find " + p + " " + JSON.stringify(r));
}
need(classify({ tool: "grep", args: ["-d", "recurse", "x", "/"], cwd }).refuse === true, "grep -d recurse");
need(classify({ tool: "grep", args: ["--directories=recurse", "x", "/"], cwd }).refuse === true, "grep --directories");
need(classify({ tool: "grep", args: ["x", "/etc/hosts"], cwd }).refuse === false, "nonrecursive");
need(classify({ tool: "rg", args: ["-e", "x", "/"], cwd }).refuse === true, "rg -e path");
need(classify({ tool: "egrep", args: ["-r", "x", "/"], cwd }).refuse === true, "egrep");
need(classify({ tool: "fgrep", args: ["-Rli", "x", "/"], cwd }).refuse === true, "fgrep -Rli");
const ok = classify({ tool: "find", args: ["/home", "-name", "x"], cwd });
need(ok.refuse === false && ok.root_path === null, "allow home");
const ig = classify({ tool: "rg", args: ["--ignore-file", "/", "x", "."], cwd });
need(ig.refuse === true && ig.reason === "root-token", "rg ignore-file root-token " + JSON.stringify(ig));
need(classify({ tool: "grep", args: ["-e", "/", "-r", "x", "."], cwd }).refuse === false, "grep -e / allowed");
need(classify({ tool: "rg", args: ["-g", "/", "x", "."], cwd }).refuse === false, "rg -g / allowed");
need(classify({ tool: "find", args: ["--", "/"], cwd }).refuse === true, "find -- /");
need(classify({ tool: "rg", args: ["--files", "-g", "*.md", "/"], cwd }).refuse === true, "rg --files glob");
' "$GUARD_JS" "$WORK"
assert_exit_code $? 0 "classify units"

echo "git mode"
for f in "$SHIM/find" "$SHIM/grep" "$SHIM/egrep" "$SHIM/fgrep" "$SHIM/rg" "$0"; do
  [ -x "$f" ] || fail "not executable: $f"
done
git -C "$REPO_ROOT" ls-files -s -- \
  scripts/shims/root-scan/find scripts/shims/root-scan/grep \
  scripts/shims/root-scan/egrep scripts/shims/root-scan/fgrep \
  scripts/shims/root-scan/rg hooks/tests/root-scan-guard.test.sh \
  | while read -r mode _rest; do
      [ "$mode" = "100755" ] || { echo "mode $mode" >&2; exit 1; }
    done
assert_exit_code $? 0 "index mode 100755"
count=$(git -C "$REPO_ROOT" ls-files -s -- scripts/shims/root-scan hooks/tests/root-scan-guard.test.sh | wc -l | tr -d ' ')
assert_eq "$count" "6" "six executable paths indexed"

# referenced so a missing file is obvious in the red run
test -f "$SHIM_JS" || fail "missing $SHIM_JS"

finalize_test
