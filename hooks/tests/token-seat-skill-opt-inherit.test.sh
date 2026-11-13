#!/usr/bin/env bash
# Parent CLAUDE_CODE_OAUTH_TOKEN is set, AUTOPILOT_TOKEN_SEAT is unset, and HOME is a
# temp dir whose .claude/.credentials.json holds a sentinel access token.
# run-skill-opt.sh must not read that file (the sentinel never reaches the child env)
# and the child plus the SDK call must use the inherited token.
# The stub and this file record only sha256. They never write a token.
# Red first (negative control against pre-fix run-skill-opt.sh, exit 1, 5 passed / 5 failed):
# the host credentials file was opened, the child ANTHROPIC_API_KEY sha was the sentinel
# sha rather than the empty sha, the child env marker was leak, and the SDK api-key sha
# was the sentinel sha rather than sha256 of the parent token.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/account-layer.sh"
unset CLAUDE_CODE_OAUTH_TOKEN AUTOPILOT_TOKEN_SEAT ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

PARENT_TOKEN="test-token-A"
SENTINEL="sentinel-host-token"
EXPECT="$(printf '%s' "$PARENT_TOKEN" | sha256sum | awk '{print $1}')"
SENT_SHA="$(printf '%s' "$SENTINEL" | sha256sum | awk '{print $1}')"
EMPTY_SHA="$(printf '%s' "" | sha256sum | awk '{print $1}')"

LAYOUT="$TEST_TMP/layout"
mkdir -p "$LAYOUT/scripts/lib" "$LAYOUT/skills/xs" "$LAYOUT/skill-creator-workspace/evals"
printf '%s\n' '{}' > "$LAYOUT/skill-creator-workspace/evals/xs-evals.json"
cp "$REPO_ROOT/scripts/run-skill-opt.sh" "$LAYOUT/scripts/"
cp "$REPO_ROOT/scripts/lib/repo-identity.sh" \
  "$REPO_ROOT/scripts/lib/auth-stop.sh" "$REPO_ROOT/scripts/lib/auth-stop.js" \
  "$REPO_ROOT/scripts/lib/claude-call-capture.sh" "$REPO_ROOT/scripts/lib/claude-call-capture.js" \
  "$REPO_ROOT/scripts/lib/claude-call-capture-exec.sh" "$REPO_ROOT/scripts/lib/token-seat.sh" \
  "$LAYOUT/scripts/lib/"
cp_account_layer "$LAYOUT/scripts"
chmod +x "$LAYOUT/scripts/run-skill-opt.sh"

CRED_DIR="$HOME/.claude"
mkdir -p "$CRED_DIR"
printf '{"claudeAiOauth":{"accessToken":"%s","expiresAt":4102444800000}}\n' "$SENTINEL" > "$CRED_DIR/.credentials.json"
SENTINEL_FILE="$TEST_TMP/sentinel.txt"
printf '%s' "$SENTINEL" > "$SENTINEL_FILE"

SC="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
mkdir -p "$SC/scripts"
printf '%s\n' '' > "$SC/scripts/__init__.py"
cat > "$SC/scripts/improve_description.py" <<'PY'
def improve_description(*a, **k):
    import hashlib, os
    open(os.environ["IMPROVE_FP"], "w").write(hashlib.sha256(k["client"].api_key.encode()).hexdigest())
PY
cat > "$SC/scripts/run_loop.py" <<'PY'
import subprocess, os
from scripts.improve_description import improve_description
def main():
    subprocess.Popen(["claude", "-p", "q"], env=os.environ).wait()
    improve_description(client=None, model="x")
PY
cat > "$SC/anthropic.py" <<'PY'
class Anthropic:
    def __init__(self, api_key=None):
        self.api_key = api_key
PY

PYPATH="$TEST_TMP/pypath"
mkdir -p "$PYPATH"
cat > "$PYPATH/sitecustomize.py" <<'PY'
import builtins, os
_open = builtins.open
_log = os.environ.get("CRED_OPEN_LOG", "")
def _wrapped(file, *a, **k):
    try:
        name = file if isinstance(file, (str, bytes)) else ""
        if isinstance(name, bytes):
            name = name.decode("utf-8", "replace")
        if _log and name.endswith(".credentials.json"):
            with _open(_log, "a") as fh:
                fh.write("opened\n")
    except Exception:
        pass
    return _open(file, *a, **k)
builtins.open = _wrapped
PY

SHA_OAUTH="$TEST_TMP/sha-oauth"
SHA_API="$TEST_TMP/sha-api"
LEAK="$TEST_TMP/leak"
INVOKED="$TEST_TMP/invoked"
OPEN_LOG="$TEST_TMP/opens"
IMPROVE_FP="$TEST_TMP/improve.fp"
BIN="$TEST_TMP/bin"
mkdir -p "$BIN"
cat > "$BIN/claude" <<EOF
#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN-}" | sha256sum | awk '{print \$1}' > "$SHA_OAUTH"
printf '%s' "\${ANTHROPIC_API_KEY-}" | sha256sum | awk '{print \$1}' > "$SHA_API"
if env | grep -F -q -f "$SENTINEL_FILE"; then printf '%s\n' leak > "$LEAK"; else printf '%s\n' clean > "$LEAK"; fi
: > "$INVOKED"
exit 0
EOF
chmod +x "$BIN/claude"

OUT="$TEST_TMP/out"
set +e
(
  cd "$LAYOUT"
  unset AUTOPILOT_TOKEN_SEAT ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
  export HOME="$HOME"
  export CLAUDE_CODE_OAUTH_TOKEN="$PARENT_TOKEN"
  export PYTHONPATH="$PYPATH"
  export CRED_OPEN_LOG="$OPEN_LOG"
  export IMPROVE_FP="$IMPROVE_FP"
  export PATH="$BIN:$PATH"
  bash "$LAYOUT/scripts/run-skill-opt.sh" xs
) >"$OUT" 2>&1
RC=$?
set -e

assert_eq "$RC" "0" "(skill-opt inherit) exits 0"
assert_file_exists "$INVOKED" "(skill-opt inherit) claude child ran"
assert_file_absent "$OPEN_LOG" "(skill-opt inherit) host credentials file was not opened"
assert_eq "$(cat "$SHA_OAUTH" 2>/dev/null || true)" "$EXPECT" "(skill-opt inherit) child oauth sha is the parent token"
assert_eq "$(cat "$SHA_API" 2>/dev/null || true)" "$EMPTY_SHA" "(skill-opt inherit) child ANTHROPIC_API_KEY is empty"
assert_neq "$(cat "$SHA_API" 2>/dev/null || true)" "$SENT_SHA" "(skill-opt inherit) child api key is not the sentinel"
assert_eq "$(cat "$LEAK" 2>/dev/null || true)" "clean" "(skill-opt inherit) sentinel never reaches the child env"
assert_eq "$(cat "$IMPROVE_FP" 2>/dev/null || true)" "$EXPECT" "(skill-opt inherit) SDK api key sha is the parent token"
assert_not_contains "$(cat "$OUT")" "$SENTINEL" "(skill-opt inherit) script output does not contain the sentinel"
assert_not_contains "$(cat "$OUT")" "$PARENT_TOKEN" "(skill-opt inherit) script output does not contain the parent token"

finalize_test
