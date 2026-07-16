#!/usr/bin/env bash
# check-test-integrity-l1.test.sh — acceptance tests for L1 layer

. "$(dirname "$0")/lib.sh"

S="$REPO_ROOT/scripts/check-test-integrity.sh"
assert_file_exists "$S" "script present"

js_runtime_ready=0

git_id() {
  git -C "$1" config user.email t@t
  git -C "$1" config user.name t
}

install_fake_pytest() {
  local fake_bin="$TEST_TMP/fakebin"
  local fake_pytest="$TEST_TMP/fake-pytest.py"
  local real_python
  real_python="$(command -v python3)"
  mkdir -p "$fake_bin"

  cat > "$fake_pytest" <<'PY'
import html
import os
import re
import sys


def find_report_path(argv):
    for idx, arg in enumerate(argv):
        if arg.startswith("--junit-xml="):
            return arg.split("=", 1)[1]
        if arg in {"--junit-xml", "--junitxml"} and idx + 1 < len(argv):
            return argv[idx + 1]
    return None


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except Exception:
        return ""


def collect_ignored(root):
    ignored = set()
    for dirpath, _, filenames in os.walk(root):
        if "conftest.py" not in filenames:
            continue
        text = read_text(os.path.join(dirpath, "conftest.py"))
        match = re.search(r"collect_ignore\s*=\s*\[([^\]]*)\]", text, flags=re.S)
        if not match:
            continue
        for item in re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)):
            ignored.add(item)
    return ignored


def is_test_file(name):
    return (name.startswith("test_") and name.endswith(".py")) or name.endswith("_test.py")


def module_available(root, module):
    if module in {"pytest", "unittest", "os", "sys", "pathlib", "json"}:
        return True
    return os.path.exists(os.path.join(root, module + ".py")) or os.path.isdir(os.path.join(root, module))


def parse_tests(root):
    ignored = collect_ignored(root)
    cases = []
    errors = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "__pycache__"}]
        for filename in sorted(filenames):
            if not is_test_file(filename):
                continue
            rel = os.path.relpath(os.path.join(dirpath, filename), root).replace(os.sep, "/")
            if filename in ignored or rel in ignored:
                continue
            text = read_text(os.path.join(root, rel))
            for module in re.findall(r"^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)", text, flags=re.M):
                if not module_available(root, module):
                    errors.append(f"{rel}: missing module {module}")
            decorators = []
            for raw_line in text.splitlines():
                stripped = raw_line.strip()
                if stripped.startswith("@"):
                    decorators.append(stripped)
                    continue
                match = re.match(r"def\s+(test_[A-Za-z0-9_]+)\s*\(", stripped)
                if match:
                    skipped = any(
                        "pytest.mark.skip(" in dec
                        or "pytest.mark.skipif(True" in dec
                        or "pytest.mark.skipif(true" in dec
                        for dec in decorators
                    )
                    classname = rel[:-3].replace("/", ".")
                    cases.append((rel, classname, match.group(1), skipped))
                if stripped and not stripped.startswith("#"):
                    decorators = []
    return cases, errors


def write_report(path, cases, errors):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if errors:
        body = "\n".join(
            f'    <error message="{html.escape(err)}">{html.escape(err)}</error>' for err in errors
        )
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<testsuites>\n'
            f'<testsuite name="pytest" tests="0" errors="{len(errors)}" failures="0" skipped="0">\n'
            f"{body}\n"
            "</testsuite>\n"
            "</testsuites>\n"
        )
    else:
        rendered = []
        for file_attr, classname, name, skipped in cases:
            if skipped:
                rendered.append(
                    f'  <testcase classname="{html.escape(classname)}" name="{html.escape(name)}" file="{html.escape(file_attr)}"><skipped /></testcase>'
                )
            else:
                rendered.append(
                    f'  <testcase classname="{html.escape(classname)}" name="{html.escape(name)}" file="{html.escape(file_attr)}" />'
                )
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<testsuites>\n'
            f'<testsuite name="pytest" tests="{len(cases)}" errors="0" failures="0" skipped="0">\n'
            + "\n".join(rendered)
            + "\n</testsuite>\n"
            "</testsuites>\n"
        )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(xml)


def main():
    argv = sys.argv[1:]
    if "--version" in argv:
        print("pytest 999.0.0 (autopilot fake)")
        return 0
    report_path = find_report_path(argv)
    if not report_path:
        return 2
    cases, errors = parse_tests(os.getcwd())
    write_report(report_path, cases, errors)
    return 2 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
PY

  cat > "$fake_bin/python3" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "-m" ] && [ "\${2:-}" = "pytest" ]; then
  shift 2
  exec "$real_python" "$fake_pytest" "\$@"
fi
exec "$real_python" "\$@"
EOF
  chmod +x "$fake_bin/python3"
  export PATH="$fake_bin:$PATH"
}

mkrepo() {
  local d="$TEST_TMP/$1"
  mkdir -p "$d"
  git -C "$d" init -q
  git_id "$d"
  echo "$d"
}

run_integrity() {
  local repo="$1"
  local range="$2"
  shift 2

  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  bash "$S" validate --repo "$repo" --range "$range" "$@" >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

run_integrity_go() {
  local repo="$1"
  local range="$2"
  shift 2

  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  GOTOOLCHAIN=go1.26.3 bash "$S" validate --repo "$repo" --range "$range" "$@" >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

run_with_verdict_file() {
  local repo="$1"
  local range="$2"
  local verdict_file="$3"
  shift 3

  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  bash "$S" validate --repo "$repo" --range "$range" --l1-verdict-file "$verdict_file" "$@" >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

run_with_verdict_file_go() {
  local repo="$1"
  local range="$2"
  local verdict_file="$3"
  shift 3

  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  GOTOOLCHAIN=go1.26.3 bash "$S" validate --repo "$repo" --range "$range" --l1-verdict-file "$verdict_file" "$@" >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

ensure_js_runtime() {
  # Cache design: machine-local version-keyed tree at
  #   ${AUTOPILOT_TEST_CACHE:-$HOME/.autopilot/test-cache}/l1-js-runtime/<jest>-<vitest>/
  # with a `.ready` marker written only after a full populate; CI persists the
  # same root via actions/cache@v4 (key includes the pinned versions + OS).
  # Why: after a one-time warm, resolve jest+vitest OFFLINE (no 72s×2 network
  # install, no registry flake); install logs stay under $TEST_TMP (kills the
  # /tmp/autopilot-l1-*.log leak class). Atomic temp-then-rename so an
  # interrupted populate never marks a half-tree ready.
  # Fallback: cold cache + offline/install-fail → return 1; caller leaves
  # js_runtime_ready=0 and real-runtime cases graceful-SKIP (suite still passes).

  local jest_ver="29.7.0"
  local vitest_ver="2.1.8"
  local version_key="jest${jest_ver}-vitest${vitest_ver}"
  local cache_base="${AUTOPILOT_TEST_CACHE:-${HOME:-}/.autopilot/test-cache}"
  local cache_root="$cache_base/l1-js-runtime"
  local cache_dir="$cache_root/$version_key"
  local marker="$cache_dir/.ready"
  local root="$TEST_TMP/js-runtime"
  local install_log="$TEST_TMP/l1-js-install.log"
  local staging=""

  mkdir -p "$root"
  if [ -f "$root/.ready" ] && [ -d "$root/node_modules" ] && [ -n "$(ls -A "$root/node_modules" 2>/dev/null || true)" ]; then
    return 0
  fi

  _l1_js_cache_valid() {
    local dir="$1"
    [ -f "$dir/.ready" ] \
      && [ -d "$dir/node_modules" ] \
      && [ -n "$(ls -A "$dir/node_modules" 2>/dev/null || true)" ]
  }

  _l1_js_copy_into_root() {
    local src="$1"
    rm -rf "$root/node_modules"
    mkdir -p "$root"
    cp -a "$src/node_modules" "$root/"
    if [ -f "$src/package.json" ]; then
      cp -a "$src/package.json" "$root/"
    fi
    if [ -f "$src/package-lock.json" ]; then
      cp -a "$src/package-lock.json" "$root/"
    fi
    touch "$root/.ready"
  }

  # 1) Cache HIT — pure local copy, zero network.
  if _l1_js_cache_valid "$cache_dir"; then
    _l1_js_copy_into_root "$cache_dir"
    return 0
  fi

  # Corrupt/partial cache (marker without node_modules, or empty tree) → MISS.
  if [ -e "$cache_dir" ]; then
    rm -rf "$cache_dir"
  fi

  if [ -s "${HOME:-}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${HOME:-}/.nvm/nvm.sh" >/dev/null 2>&1 || true
  fi

  # 2) Cache MISS — install into a temp sibling, then atomic rename into place.
  mkdir -p "$cache_root"
  staging="$cache_root/.staging-${version_key}.$$"
  rm -rf "$staging"
  mkdir -p "$staging"

  (
    cd "$staging" || exit 1
    npm init -y -q >/dev/null 2>&1
    npm i -D "jest@${jest_ver}" "vitest@${vitest_ver}" \
      --prefer-offline --no-audit --no-fund \
      >"$install_log" 2>&1
  )
  if [ $? -ne 0 ] || [ ! -d "$staging/node_modules" ] \
    || [ -z "$(ls -A "$staging/node_modules" 2>/dev/null || true)" ]; then
    rm -rf "$staging"
    return 1
  fi

  # Marker last inside staging; only publish when the tree is complete.
  touch "$staging/.ready"
  if ! mv "$staging" "$cache_dir" 2>/dev/null; then
    # Race: another process may have published a valid cache.
    if _l1_js_cache_valid "$cache_dir"; then
      rm -rf "$staging"
    else
      rm -rf "$cache_dir"
      if ! mv "$staging" "$cache_dir" 2>/dev/null; then
        # Last resort: copy into TEST_TMP only (don't leave half-cache marked).
        _l1_js_copy_into_root "$staging"
        rm -rf "$staging"
        return 0
      fi
    fi
  fi

  if ! _l1_js_cache_valid "$cache_dir"; then
    return 1
  fi
  _l1_js_copy_into_root "$cache_dir"
  return 0
}

write_fake_js_runner() {
  local repo="$1"
  local runner="$2"
  local exit_code="$3"
  local payload_file="$4"

  local bin_path="$repo/node_modules/.bin/$runner"
  mkdir -p "$(dirname "$bin_path")"
  cat > "$bin_path" <<EOF
#!/usr/bin/env sh
set -eu
report_file=""
for arg in "\$@"; do
  case "\$arg" in
    --outputFile=*) report_file="\${arg#--outputFile=}" ;;
  esac
done
if [ -z "\$report_file" ]; then
  exit 1
fi
if [ ! -f "$payload_file" ]; then
  exit 2
fi
cp "$payload_file" "\$report_file"
exit $exit_code
EOF
  chmod +x "$bin_path"
}

extract_dropped_digest() {
  local runner="$1"
  python3 - "$__STDOUT_FILE" "$runner" <<'PY'
import json
import sys

path, runner = sys.argv[1:3]
obj = json.load(open(path, "r", encoding="utf-8"))
for item in obj.get("l1_runners", []):
    if item.get("runner") == runner:
        print(item.get("dropped_digest", ""))
        sys.exit(0)
print("")
sys.exit(1)
PY
}

compute_changeset_digest() {
  local repo="$1"
  local base_sha="$2"
  local head_sha="$3"
  python3 - "$repo" "$base_sha" "$head_sha" <<'PY'
import hashlib
import subprocess
import sys

repo, base_sha, head_sha = sys.argv[1:4]
raw = subprocess.run(
    ["git", "-C", repo, "diff", "-M", "--raw", "--full-index", "-z", f"{base_sha}..{head_sha}"],
    check=True,
    capture_output=True,
).stdout
print(hashlib.sha256(raw).hexdigest())
PY
}

install_fake_pytest

if ensure_js_runtime; then
  js_runtime_ready=1
fi

# 1) pytest mark.skip existing test -> shrink
repo="$(mkrepo l1-py-skipif)"
(
  cd "$repo"
  mkdir -p tests .claude
  echo "initial" > main.py
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/test_one.py <<'PY'
def test_active():
    assert True
PY
  git add .claude/test-integrity-config.md main.py tests/test_one.py
  git commit -qm "base"

  cat > tests/test_one.py <<'PY'
import pytest

@pytest.mark.skip(reason="legacy retirement")
def test_active():
    assert True
PY
  git add tests/test_one.py
  git commit -qm "head skipif true"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "pytest mark.skip is shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "pytest mark.skip marks l1 shrink"

# 2) pytest skipif(True) -> shrink
repo="$(mkrepo l1-py-skipif-exec)"
(
  cd "$repo"
  mkdir -p tests .claude
  echo "initial" > main.py
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/test_one.py <<'PY'
def test_active():
    assert True
PY
  git add .claude/test-integrity-config.md main.py tests/test_one.py
  git commit -qm "base"

  cat > tests/test_one.py <<'PY'
import pytest

@pytest.mark.skipif(True, reason="runtime skip")
def test_active():
    assert True
PY
  git add tests/test_one.py
  git commit -qm "head skipif true"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "pytest skipif(true) is shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "pytest skipif(true) marks l1 shrink"

# 3) collect_ignore in conftest -> shrink
repo="$(mkrepo l1-py-collect-ignore)"
(
  cd "$repo"
  mkdir -p tests .claude
  echo "initial" > main.py
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/test_a.py <<'PY'
def test_a():
    assert True
PY
  cat > tests/test_b.py <<'PY'
def test_b():
    assert True
PY
  git add .claude/test-integrity-config.md main.py tests/test_a.py tests/test_b.py
  git commit -qm "base"

  cat > tests/conftest.py <<'PY'
collect_ignore = ["test_b.py"]
PY
  git add tests/conftest.py
  git commit -qm "head collect_ignore"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "collect_ignore causes shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "collect_ignore marks l1 shrink"

# 3b) base import-time collection failure fixed at head -> base_failed, no shrink
repo="$(mkrepo l1-py-base-import-broken)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/test_one.py <<'PY'
import missing_fixture

def test_active():
    assert True
PY
  git add .claude/test-integrity-config.md tests/test_one.py
  git commit -qm "base import-time collection failure"

  cat > missing_fixture.py <<'PY'
def fixture_marker():
    return True
PY
  git add tests/test_one.py
  git add missing_fixture.py
  git commit -qm "head fixes import"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 0 "pytest import failure repaired at head is ok"
assert_contains "$__OUTPUT" '"l1": "ok"' "import-failure base is classified ok"
assert_contains "$__OUTPUT" '"base_failed": true' "base import failure is recorded"
assert_not_contains "$__OUTPUT" 'tests/test_one.py::test_active' "no synthetic base drop is emitted"

# 4) pure-additive pytest test -> ok
repo="$(mkrepo l1-py-additive)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  echo "initial" > main.py
  cat > tests/test_one.py <<'PY'
def test_a():
    assert True
PY
  git add .claude/test-integrity-config.md main.py tests/test_one.py
  git commit -qm "base"

  cat >> tests/test_one.py <<'PY'

def test_b():
    assert True
PY
  git add tests/test_one.py
  git commit -qm "head additive"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 0 "pure additive pytest is ok"
assert_contains "$__OUTPUT" '"l1": "ok"' "additive pytest case is l1 ok"

# go-backed cases need a real toolchain; CI has one, dev machines may not — skip loudly, never fail on absence
if command -v go >/dev/null 2>&1; then
# Pre-warm the pinned toolchain so the collection phase's download is deterministic
# on CI cold caches (detection is now GOTOOLCHAIN=local, but collection still pays it).
GOTOOLCHAIN=go1.26.3 go version >/dev/null 2>&1 || true
# 5) go t.Skip -> shrink
repo="$(mkrepo l1-go-skip)"
(
  cd "$repo"
  printf "module l1goskip\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/skip_test.go <<'GO'
package tests

import "testing"

func TestOne(t *testing.T) {
    if true {
    }
}
GO
  git add .claude/test-integrity-config.md go.mod tests/skip_test.go
  git commit -qm "base"

  cat > tests/skip_test.go <<'GO'
package tests

import "testing"

func TestOne(t *testing.T) {
    t.Skip("skip")
}
GO
  git add tests/skip_test.go
  git commit -qm "head skip"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 1 "go t.Skip causes shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "go skip marks l1 shrink"

# 6) go pure-additive test -> ok
repo="$(mkrepo l1-go-additive)"
(
  cd "$repo"
  printf "module l1goadd\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/base_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    if true {
    }
}
GO
  git add .claude/test-integrity-config.md go.mod tests/base_test.go
  git commit -qm "base"

  cat > tests/new_test.go <<'GO'
package tests

import "testing"

func TestB(t *testing.T) {
    if true {
    }
}
GO
  git add tests/new_test.go
  git commit -qm "head additive"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 0 "pure additive go test is ok"
assert_contains "$__OUTPUT" '"l1": "ok"' "additive go case is l1 ok"

else
  echo "  SKIP go cases 5-6 (no go toolchain on this machine)"
fi

# 6b) go detect must not wait on toolchain download (fake go shim; no real toolchain needed)
# Models: unfixed probe inherits a non-local GOTOOLCHAIN and stalls past timeout=5 → runner_missing;
# fixed probe forces GOTOOLCHAIN=local so version exits instantly → tool_base true.
repo="$(mkrepo l1-go-detect-local-toolchain)"
(
  cd "$repo"
  printf "module l1godetect\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/detect_test.go <<'GO'
package tests

import "testing"

func TestOne(t *testing.T) {
}
GO
  git add .claude/test-integrity-config.md go.mod tests/detect_test.go
  git commit -qm "base"

  cat > tests/detect_test.go <<'GO'
package tests

import "testing"

func TestOne(t *testing.T) {
    if true {
    }
}
GO
  git add tests/detect_test.go
  git commit -qm "head"
)
fake_go_bin="$TEST_TMP/fake-go-detect-bin"
mkdir -p "$fake_go_bin"
cat > "$fake_go_bin/go" <<'SH'
#!/usr/bin/env bash
# version: instant under GOTOOLCHAIN=local; else sleep past the 5s detect probe.
if [[ "${1:-}" == "version" ]]; then
  if [[ "${GOTOOLCHAIN:-}" == "local" ]]; then
    echo "go version go1.22.0 linux/amd64"
    exit 0
  fi
  sleep 6
  echo "go version go1.22.0 linux/amd64"
  exit 0
fi
exit 1
SH
chmod +x "$fake_go_bin/go"
PATH="$fake_go_bin:$PATH" run_integrity "$repo" HEAD~1..HEAD --l1-runner go
assert_not_contains "$__OUTPUT" '"reason": "runner_missing"' "go detect does not report runner_missing with local probe"
assert_contains "$__OUTPUT" '"tool_base": true' "go detect finds tool under GOTOOLCHAIN=local"

# 7) no runner anywhere -> unavailable
repo="$(mkrepo l1-no-runner)"
(
  cd "$repo"
  mkdir -p .claude
  echo "initial" > main.py
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  git add .claude/test-integrity-config.md main.py
  git commit -qm "base"

  echo "changed" >> main.py
  git add main.py
  git commit -qm "head"
)
run_integrity "$repo" HEAD~1..HEAD
assert_exit_code "$__EXIT_CODE" 0 "no runner reports unavailable"
assert_contains "$__OUTPUT" '"l1": "unavailable"' "no runner => l1 unavailable"

if command -v go >/dev/null 2>&1; then
# 8) head broken suite -> collection_failed
repo="$(mkrepo l1-go-head-broken)"
(
  cd "$repo"
  printf "module l1gobad\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/broken_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    if true {
        t.Fatal("ok")
    }
}
GO
  git add .claude/test-integrity-config.md go.mod tests/broken_test.go
  git commit -qm "base"

  cat > tests/broken_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    t.Fatalf("bad"
}
GO
  git add tests/broken_test.go
  git commit -qm "head broken"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 1 "head broken suite is collection_failed"
assert_contains "$__OUTPUT" '"l1": "collection_failed"' "head break maps to collection_failed"

# 9) base compile error, head fixed -> base_failed true and ok
repo="$(mkrepo l1-go-base-broken)"
(
  cd "$repo"
  printf "module l1gofix\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: warn\n" > .claude/test-integrity-config.md
  cat > tests/fix_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    this-does-not-exist = 1
}
GO
  git add .claude/test-integrity-config.md go.mod tests/fix_test.go
  git commit -qm "base broken"

  cat > tests/fix_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
}
GO
  git add tests/fix_test.go
  git commit -qm "head fixed"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 0 "base broken then fixed is ok"
assert_contains "$__OUTPUT" '"base_failed": true' "base_failed is recorded"

# 9b) base broken go package in block mode, head fixes it -> ok, no shrink
repo="$(mkrepo l1-go-base-broken-block)"
(
  cd "$repo"
  printf "module l1gofixblock\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
cat > tests/fix_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    helper()
}
GO
  git add .claude/test-integrity-config.md go.mod tests/fix_test.go
  git commit -qm "base broken"

  cat > tests/helper.go <<'GO'
package tests

func helper() {
}
GO
  git add tests/fix_test.go
  git add tests/helper.go
  git commit -qm "head fixed"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 0 "base broken go package fixed in block mode is ok"
assert_contains "$__OUTPUT" '"l1": "ok"' "go base fix in block mode is ok"
assert_contains "$__OUTPUT" '"base_failed": true' "base go compile failure is recorded"

# 10) base pass, head red test -> l1 still ok, red tests remain executed
repo="$(mkrepo l1-go-head-red)"
(
  cd "$repo"
  printf "module l1goheadred\ngo 1.26\n" > go.mod
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/fix_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
}
GO
  git add .claude/test-integrity-config.md go.mod tests/fix_test.go
  git commit -qm "base passing"

  cat > tests/fix_test.go <<'GO'
package tests

import "testing"

func TestA(t *testing.T) {
    t.Fatal("head failed")
}
GO
  git add tests/fix_test.go
  git commit -qm "head red"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 0 "head red test is still l1 ok in block mode"
assert_contains "$__OUTPUT" '"l1": "ok"' "red tests do not trigger shrink"

# 11) head adds compile-broken package while another package passes => collection_failed build_failed pkgB
repo="$(mkrepo l1-go-multi-package-build-fail)"
(
  cd "$repo"
  printf "module l1gomultifail\ngo 1.26\n" > go.mod
  mkdir -p pkgA pkgB .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > pkgA/passing_test.go <<'GO'
package pkgA

import "testing"

func TestPasses(t *testing.T) {
}
GO
  git add .claude/test-integrity-config.md go.mod pkgA/passing_test.go
  git commit -qm "base single package passing"

  cat > pkgB/failing_test.go <<'GO'
package pkgB

import "testing"

func TestFailsCompile(t *testing.T) {
    undefinedSymbol()
}
GO
  git add pkgB/failing_test.go
  git commit -qm "head compile-broken package"
)
run_integrity_go "$repo" HEAD~1..HEAD --l1-runner go
assert_exit_code "$__EXIT_CODE" 1 "multi-package compile failure in head is collection_failed"
assert_contains "$__OUTPUT" '"l1": "collection_failed"' "go compile failure maps to collection_failed"
assert_contains "$__OUTPUT" '"reason": "build_failed' "build_failed reason mentions build_failed"
assert_contains "$__OUTPUT" 'pkgB' "package name appears in reason"

else
  echo "  SKIP go cases 8-11 (no go toolchain on this machine)"
fi
# 12) --no-l1 suppresses L1
repo="$(mkrepo l1-no-l1)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/test_one.py <<'PY'
def test_a():
    assert True
PY
  git add .claude/test-integrity-config.md tests/test_one.py
  git commit -qm "base"

  cat > tests/test_one.py <<'PY'
def test_a():
    assert True

def test_b():
    assert True
PY
  git add tests/test_one.py
  git commit -qm "head"
)
run_integrity "$repo" HEAD~1..HEAD --no-l1
assert_exit_code "$__EXIT_CODE" 0 "--no-l1 reports skipped"
assert_contains "$__OUTPUT" '"l1": "skipped"' "--no-l1 sets skipped"

# 13) block-mode override is deferred and does not pass
repo="$(mkrepo l1-block-deferred-override)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  printf "initial\n" > main.py
  cat > tests/test_one.py <<'PY'
def test_a():
    assert True
PY
  git add .claude/test-integrity-config.md main.py tests/test_one.py
  git commit -qm "base"

  cat > tests/test_one.py <<'PY'
import pytest

@pytest.mark.skip(reason="legacy retirement")
def test_a():
    assert True
PY
  git add tests/test_one.py
  git commit -qm "head skip"
)
base_sha=$(git -C "$repo" rev-parse HEAD~1)
head_sha=$(git -C "$repo" rev-parse HEAD)
base_tree=$(git -C "$repo" rev-parse "${base_sha}^{tree}")
head_tree=$(git -C "$repo" rev-parse "${head_sha}^{tree}")
changeset_digest=$(compute_changeset_digest "$repo" "$base_sha" "$head_sha")

run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "block-mode shrink fails before waiver"
dropped_digest=$(extract_dropped_digest pytest)

verdict_file="$TEST_TMP/l1-deferred-verdict.json"
cat > "$verdict_file" <<VERDICT
{
  "base_sha": "${base_sha}",
  "head_sha": "${head_sha}",
  "base_tree": "${base_tree}",
  "head_tree": "${head_tree}",
  "changeset_digest": "${changeset_digest}",
  "waives": [
    {"file": "pytest", "kind": "executed_set_shrink", "dropped_digest": "${dropped_digest}"}
  ]
}
VERDICT

run_with_verdict_file "$repo" HEAD~1..HEAD "$verdict_file" --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "block-mode still hard-fails with a valid verdict"
assert_contains "$__OUTPUT" '"l1": "shrink"' "verdict-in-block still returns shrink"
assert_contains "$__OUTPUT" 'block-mode override deferred' "override status is deferred"

# 13b) block-mode override stays DEFERRED even with --containment cgroup-verified.
# An unlock on that attestation was REVERTED as UNSAFE (gpt-5.5 review 2026-06-26:
# a same-user worker can sibling-escape the dispatcher cgroup via systemd-run, so
# no local-only containment is malicious-proof). This locks in the safe posture.
# Clean L1-only vector: a pure git-mv rename is L0-ok but an L1 shrink, so the exit
# code reflects ONLY the L1 verdict path — unlike #13's pytestmark which also trips L0.
repo="$(mkrepo l1-block-override-unlock)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/a_test.py <<'PY'
def test_keep():
    assert True
PY
  git add .claude/test-integrity-config.md tests/a_test.py
  git commit -qm "base"
  git mv tests/a_test.py tests/b_test.py
  git commit -qm "rename test file (L0-ok, L1-shrink)"
)
base_sha=$(git -C "$repo" rev-parse HEAD~1)
head_sha=$(git -C "$repo" rev-parse HEAD)
base_tree=$(git -C "$repo" rev-parse "${base_sha}^{tree}")
head_tree=$(git -C "$repo" rev-parse "${head_sha}^{tree}")
changeset_digest=$(compute_changeset_digest "$repo" "$base_sha" "$head_sha")
run_integrity "$repo" HEAD~1..HEAD --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "rename shrink fails before any waiver"
dropped_digest=$(extract_dropped_digest pytest)
verdict_file="$TEST_TMP/l1-unlock-verdict.json"
cat > "$verdict_file" <<VERDICT
{
  "base_sha": "${base_sha}", "head_sha": "${head_sha}",
  "base_tree": "${base_tree}", "head_tree": "${head_tree}",
  "changeset_digest": "${changeset_digest}",
  "waives": [ {"file": "pytest", "kind": "executed_set_shrink", "dropped_digest": "${dropped_digest}"} ]
}
VERDICT
# (1) valid verdict but containment=none → deferred (fail-safe default)
run_with_verdict_file "$repo" HEAD~1..HEAD "$verdict_file" --l1-runner pytest
assert_exit_code "$__EXIT_CODE" 1 "valid verdict + containment=none stays deferred"
assert_contains "$__OUTPUT" 'block-mode override deferred' "none → deferred status"
# (2) valid verdict + --containment cgroup-verified → STILL deferred (unlock reverted UNSAFE)
run_with_verdict_file "$repo" HEAD~1..HEAD "$verdict_file" --l1-runner pytest --containment cgroup-verified
assert_exit_code "$__EXIT_CODE" 1 "cgroup-verified does NOT unlock (still deferred, fail-safe)"
assert_contains "$__OUTPUT" 'block-mode override deferred' "cgroup-verified → still deferred"
assert_not_contains "$__OUTPUT" 'Override accepted' "no override accepted in block mode"

# 14) optional Jest .only sibling-drop (all tests remain in file)
if [ "$js_runtime_ready" -eq 1 ]; then
  repo="$(mkrepo l1-js-only)"
  (
    cd "$repo"
    mkdir -p tests .claude
    printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
    cp -a "$TEST_TMP/js-runtime/node_modules" "$repo/"
    cp "$TEST_TMP/js-runtime/package.json" "$TEST_TMP/js-runtime/package-lock.json" .

    cat > tests/only.test.js <<'JS'
const { describe, it, expect } = require('@jest/globals')

describe('suite', () => {
  it('first', () => expect(1).toBe(1))
  it('second', () => expect(1).toBe(1))
  it('third', () => expect(1).toBe(1))
})
JS
    git add .claude/test-integrity-config.md node_modules package*.json tests/only.test.js
    git commit -qm "base"

    cat > tests/only.test.js <<'JS'
const { describe, it, expect } = require('@jest/globals')

describe('suite', () => {
  it.only('first', () => expect(1).toBe(1))
  it('second', () => expect(1).toBe(1))
  it('third', () => expect(1).toBe(1))
})
JS
    git add tests/only.test.js
    git commit -qm "head with only"
  )

  run_integrity "$repo" HEAD~1..HEAD --l1-runner jest
  assert_exit_code "$__EXIT_CODE" 1 "jest .only causes shrink"
  assert_contains "$__OUTPUT" '"l1": "shrink"' "jest .only marks l1 shrink"
  assert_contains "$__OUTPUT" 'tests/only.test.js > suite > second' "non-runner sibling is dropped"
  assert_contains "$__OUTPUT" 'tests/only.test.js > suite > third' "all sibling test ids dropped"
else
  assert_eq "skip" "skip" "js runtime unavailable; skipped jest .only case"
fi

# 15) independent families: jest-only repo does not invent vitest
if [ "$js_runtime_ready" -eq 1 ]; then
  repo="$(mkrepo l1-js-jest-only)"
  (
    cd "$repo"
    mkdir -p tests .claude
    printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
    cp -a "$TEST_TMP/js-runtime/node_modules" "$repo/"
    cat > package.json <<'JSON'
{
  "name": "l1-js-jest-only",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "jest": "29.7.0"
  }
}
JSON
    rm -rf node_modules/vitest node_modules/vite node_modules/@vitest node_modules/.bin/vitest

    echo "base" > main.js
    cat > tests/only.test.js <<'JS'
const { describe, it, expect } = require('@jest/globals')

describe('suite', () => {
  it('first', () => expect(1).toBe(1))
})
JS
    git add .claude/test-integrity-config.md package.json node_modules main.js tests/only.test.js
    git commit -qm "base"

    echo "head" > main.js
    git add main.js
    git commit -qm "head"
  )

  run_integrity "$repo" HEAD~1..HEAD
  assert_exit_code "$__EXIT_CODE" 0 "jest-only suite still passes"
  assert_not_contains "$__OUTPUT" "\"runner\": \"vitest\"" "jest-only repo does not include vitest runner"
else
  assert_eq "skip" "skip" "js runtime unavailable; skipped jest-only phantom-vitest case"
fi

# 16) real vitest .skip parser path
if [ "$js_runtime_ready" -eq 1 ]; then
  repo="$(mkrepo l1-vitest-skip)"
  (
    cd "$repo"
    mkdir -p tests .claude
    printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
    # Cached js-runtime already includes vitest@2.1.8 — no second network install.
    cp -a "$TEST_TMP/js-runtime/node_modules" "$repo/" || true
    cat > package.json <<'JSON'
{
  "name": "l1-vitest-skip",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "vitest": "2.1.8"
  }
}
JSON

    cat > tests/vitest.test.js <<'JS'
import { describe, it, expect } from 'vitest'

describe('suite', () => {
  it('first', () => expect(1).toBe(1))
      it('second', () => expect(2).toBe(2))
})
JS
    git add .claude/test-integrity-config.md package.json node_modules tests/vitest.test.js
    git commit -qm "base"

    cat > tests/vitest.test.js <<'JS'
import { describe, it, expect } from 'vitest'

describe('suite', () => {
  it('first', () => expect(1).toBe(1))
  it.skip('second', () => expect(2).toBe(2))
})
JS
    git add tests/vitest.test.js
    git commit -qm "head skip"
  )

  run_integrity "$repo" HEAD~1..HEAD --l1-runner vitest
  assert_exit_code "$__EXIT_CODE" 1 "vitest .skip causes shrink"
  assert_contains "$__OUTPUT" '"l1": "shrink"' "vitest .skip marks l1 shrink"
  assert_contains "$__OUTPUT" '"base_count": 2' "vitest base count is 2"
  assert_contains "$__OUTPUT" '"head_count": 1' "vitest head count is 1"
  assert_contains "$__OUTPUT" 'tests/vitest.test.js > suite > second' "skipped vitest test is dropped"
else
  assert_eq "skip" "skip" "js runtime unavailable; skipped vitest skip case"
fi

# 17) fake vitest nonzero exit with empty JSON report -> reporter_failed
repo="$(mkrepo l1-vitest-nonzero-empty)"
(
  cd "$repo"
  mkdir -p .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > package.json <<'JSON'
{
  "name": "l1-vitest-nonzero-empty",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "vitest": "2.1.8"
  }
}
JSON
  cat > .l1-vitest-base.json <<'JSON'
{"testResults":[{"name":"tests/fake.test.js","assertionResults":[{"ancestorTitles":["suite"],"title":"base","status":"passed","location":{"line":1,"column":1}}]}]}
JSON
  write_fake_js_runner "$repo" vitest 0 ".l1-vitest-base.json"
  git add .claude/test-integrity-config.md package.json .l1-vitest-base.json node_modules/.bin/vitest
  git commit -qm "base reporter ok"

  cat > .l1-vitest-empty.json <<'JSON'
{"testResults":[]}
JSON
  write_fake_js_runner "$repo" vitest 1 ".l1-vitest-empty.json"
  git add .l1-vitest-empty.json node_modules/.bin/vitest
  git commit -qm "head still broken reporter"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner vitest
assert_exit_code "$__EXIT_CODE" 1 "vitest nonzero empty report is collection_failed"
assert_contains "$__OUTPUT" '"reason": "reporter_failed"' "vitest empty report maps to reporter_failed"
assert_contains "$__OUTPUT" '"l1": "collection_failed"' "vitest bad report is collection_failed"

# 18) fake jest missing testResults with nonzero exit -> reporter_failed
repo="$(mkrepo l1-jest-missing-testresults)"
(
  cd "$repo"
  mkdir -p .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > package.json <<'JSON'
{
  "name": "l1-jest-missing-testresults",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "jest": "29.7.0"
  }
}
JSON
  cat > .l1-jest-base.json <<'JSON'
{"testResults":[{"testFilePath":"tests/fake.test.js","assertionResults":[{"ancestorTitles":["suite"],"title":"base","status":"passed","location":{"line":1,"column":1}}] , "numFailingTests": 0}]}
JSON
  cat > .l1-jest-head.json <<'JSON'
{"version":1}
JSON
  write_fake_js_runner "$repo" jest 0 ".l1-jest-base.json"
  git add .claude/test-integrity-config.md package.json .l1-jest-base.json .l1-jest-head.json node_modules/.bin/jest
  git commit -qm "base passing runner"

  write_fake_js_runner "$repo" jest 1 ".l1-jest-head.json"
  git add node_modules/.bin/jest .l1-jest-head.json
  git commit -qm "head missing testResults"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner jest
assert_exit_code "$__EXIT_CODE" 1 "jest missing testResults with nonzero exit is collection_failed"
assert_contains "$__OUTPUT" '"reason": "reporter_failed"' "jest malformed report maps to reporter_failed"
assert_contains "$__OUTPUT" '"l1": "collection_failed"' "jest bad report is collection_failed"

# 19) base has two executed tests; head clean-exit empty report => shrink
repo="$(mkrepo l1-js-base-two-head-empty)"
(
  cd "$repo"
  mkdir -p .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > package.json <<'JSON'
{
  "name": "l1-js-base-two-head-empty",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "jest": "29.7.0"
  }
}
JSON
  cat > .l1-jest-base-two.json <<'JSON'
{"testResults":[{"testFilePath":"tests/fake.test.js","assertionResults":[{"ancestorTitles":["suite"],"title":"first","status":"passed","location":{"line":1,"column":1}},{"ancestorTitles":["suite"],"title":"second","status":"passed","location":{"line":2,"column":1}}]}]}
JSON
  cat > .l1-jest-empty.json <<'JSON'
{"testResults":[]}
JSON
  write_fake_js_runner "$repo" jest 0 ".l1-jest-base-two.json"
  git add .claude/test-integrity-config.md package.json .l1-jest-base-two.json .l1-jest-empty.json node_modules/.bin/jest
  git commit -qm "base two tests"

  write_fake_js_runner "$repo" jest 0 ".l1-jest-empty.json"
  git add node_modules/.bin/jest .l1-jest-empty.json
  git commit -qm "head empty report"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner jest
assert_exit_code "$__EXIT_CODE" 1 "clean-empty head report with base tests is shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "head empty report yields executed_set_shrink"
assert_contains "$__OUTPUT" '"dropped": [' "head empty report shows dropped list"
assert_contains "$__OUTPUT" 'tests/fake.test.js > suite > first' "first dropped id appears"
assert_contains "$__OUTPUT" 'tests/fake.test.js > suite > second' "second dropped id appears"

# 20) healthy zero suite both sides => ok
repo="$(mkrepo l1-js-empty-each-side)"
(
  cd "$repo"
  mkdir -p .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > package.json <<'JSON'
{
  "name": "l1-js-empty-each-side",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "vitest": "2.1.8"
  }
}
JSON
  cat > .l1-vitest-empty.json <<'JSON'
{"testResults":[]}
JSON
  write_fake_js_runner "$repo" vitest 0 ".l1-vitest-empty.json"
  git add .claude/test-integrity-config.md package.json .l1-vitest-empty.json node_modules/.bin/vitest
  git commit -qm "base zero tests"

  write_fake_js_runner "$repo" vitest 0 ".l1-vitest-empty.json"
  echo "head marker" > .l1-marker.txt
  git add .l1-marker.txt
  git add node_modules/.bin/vitest
  git commit -qm "head zero tests"
)
run_integrity "$repo" HEAD~1..HEAD --l1-runner vitest
assert_exit_code "$__EXIT_CODE" 0 "zero tests both sides remains ok"
assert_contains "$__OUTPUT" '"l1": "ok"' "zero suite on both sides remains l1 ok"

# 21) pure file rename is a shrink (no fuzzy matching)
repo="$(mkrepo l1-py-rename-no-fuzzy)"
(
  cd "$repo"
  mkdir -p tests .claude
  printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
  cat > tests/a_test.py <<'PY'
def test_a():
    assert True
PY
  git add .claude/test-integrity-config.md tests/a_test.py
  git commit -qm "base"

  mv tests/a_test.py tests/b_test.py
  git add tests
  git commit -qm "rename test file"
)
run_integrity "$repo" HEAD~1..HEAD
assert_exit_code "$__EXIT_CODE" 1 "file rename is treated as shrink"
assert_contains "$__OUTPUT" '"l1": "shrink"' "file rename still shrink with no fuzzy matching"
assert_contains "$__OUTPUT" 'tests/a_test.py::test_a' "old test id is dropped"

finalize_test
