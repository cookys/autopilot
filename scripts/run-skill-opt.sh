#!/usr/bin/env bash
# Wrapper for skill-creator run_loop.py that injects OAuth token as ANTHROPIC_API_KEY.
# Reads from ~/.claude/.credentials.json (Claude Code OAuth login), unless the parent
# already has CLAUDE_CODE_OAUTH_TOKEN: that value is inherited and the host file is not read
# (same rule as the other claude spawn sites; token_seat_guard is the refusal).
#
# OAuth tokens only access Haiku via the API. Eval uses `claude -p` (any model),
# but improve_description uses the SDK directly (Haiku only). We monkey-patch
# improve_description to force Haiku regardless of --model.
#
# Exit codes: the run_loop exit code, or 6 = STOP_AUTH (a claude call died on authentication; later calls are refused at the wrapper,
# BL-0294, scripts/lib/claude-call-capture.js).
#
# Usage: ./scripts/run-skill-opt.sh <skill-name>
# Example: ./scripts/run-skill-opt.sh dev-flow

set -euo pipefail

SKILL_NAME="${1:?Usage: $0 <skill-name>}"
AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
CRED_FILE="$HOME/.claude/.credentials.json"

# G37 W5 (A10): with an account registry this run goes through claude-account.js (below) and never reads $CRED_FILE; a broken
# registry stops here before any spawn. No registry (or mode_off) = the credentials-file path below is unchanged.
# shellcheck source=lib/eval-account.sh
_EA_LIB="$AUTOPILOT_DIR/scripts/lib/eval-account.sh"
[ -r "$_EA_LIB" ] || { echo "eval-account: the account-layer helper ${_EA_LIB} is missing; refusing to start (nothing was spawned, no credentials copied)" >&2; exit 2; }
. "$_EA_LIB"
eval_account_probe skill-opt || exit $?

# shellcheck source=lib/token-seat.sh
. "$AUTOPILOT_DIR/scripts/lib/token-seat.sh"
_ts_msg="$(token_seat_guard)" || { printf '%s\n' "$_ts_msg" >&2; exit 78; }

# A parent CLAUDE_CODE_OAUTH_TOKEN is the child's auth whether or not AUTOPILOT_TOKEN_SEAT=1
# (the other spawn sites pass that variable through and do not replace it). Do not read the
# host credentials file in that case. No parent token and no account layer: the file path below.
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && "${EVAL_ACCOUNT_ACTIVE:-0}" != 1 ]]; then
# Extract OAuth token
if [[ ! -f "$CRED_FILE" ]]; then
  echo "ERROR: $CRED_FILE not found. Are you logged into Claude Code?" >&2
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$CRED_FILE'))['claudeAiOauth']['accessToken'])")
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Failed to extract OAuth token" >&2
  exit 1
fi

# Check expiry
python3 -c "
import json, time, sys
d = json.load(open('$CRED_FILE'))
exp = d['claudeAiOauth']['expiresAt']
remaining = (exp - time.time() * 1000) / 60000
if remaining < 5:
    print(f'ERROR: Token expires in {remaining:.0f} minutes. Re-login first.', file=sys.stderr)
    sys.exit(1)
print(f'Token valid for {remaining:.0f} more minutes', file=sys.stderr)
"
fi

EVAL_FILE="$AUTOPILOT_DIR/skill-creator-workspace/evals/${SKILL_NAME}-evals.json"
SKILL_PATH="$AUTOPILOT_DIR/skills/$SKILL_NAME"
RESULTS_DIR="$AUTOPILOT_DIR/skill-creator-workspace/results/$SKILL_NAME"

if [[ ! -f "$EVAL_FILE" ]]; then
  echo "ERROR: Eval file not found: $EVAL_FILE" >&2
  echo "Available:" >&2
  ls "$AUTOPILOT_DIR/skill-creator-workspace/evals/"*.json 2>/dev/null | sed 's/.*\//  /' >&2
  exit 1
fi

if [[ ! -d "$SKILL_PATH" ]]; then
  echo "ERROR: Skill not found: $SKILL_PATH" >&2
  exit 1
fi

mkdir -p "$RESULTS_DIR"

echo "=== Skill: $SKILL_NAME ===" >&2
echo "Eval: $EVAL_FILE" >&2
echo "Skill: $SKILL_PATH" >&2
echo "Results: $RESULTS_DIR" >&2
echo "" >&2

if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && "${EVAL_ACCOUNT_ACTIVE:-0}" != 1 ]]; then
  export ANTHROPIC_API_KEY="$TOKEN"
fi

# OAuth tokens can only call Haiku via the Messages API.
# Eval (claude -p) uses the CLI's own auth and can use any model.
# Monkey-patch improve_description to force Haiku for the SDK call.
export IMPROVE_MODEL_OVERRIDE="claude-haiku-4-5-20251001"

# BL-0251 fleet contract. run_loop.py lives in the external skill-creator plugin (outside this repo). Its run_eval.py
# starts each child as a bare `claude` found on PATH (subprocess.Popen(["claude", "-p", ...], env=os.environ);
# scripts/run_eval.py:~75), so the argv is reachable through a PATH wrapper that appends --strict-mcp-config
# (same technique as run-eval-batch.sh).
# shellcheck source=lib/repo-identity.sh
[ -r "$AUTOPILOT_DIR/scripts/lib/repo-identity.sh" ] && . "$AUTOPILOT_DIR/scripts/lib/repo-identity.sh" || true
declare -F child_session_mint >/dev/null 2>&1 && child_session_mint eval-run

WRAPPER_DIR="${TMPDIR:-/tmp}/autopilot-eval-wrapper-$$"
trap 'rm -rf "$WRAPPER_DIR"' EXIT
mkdir -p "$WRAPPER_DIR"
cat > "$WRAPPER_DIR/claude" <<'EOF'
#!/usr/bin/env bash
if [ "${AUTOPILOT_TOKEN_SEAT:-}" = 1 ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  printf '%s\n' 'token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)' >&2
  exit 78
fi
WRAPPER_DIR=$(cd "$(dirname "$0")" && pwd -P)
# -ef compares inodes: a TMPDIR with a trailing slash or a symlink makes the PATH spelling differ from pwd, and a string compare would find this wrapper as the "real" claude and exec itself forever
REAL_CLAUDE=""
IFS=':' read -ra ADDR <<< "$PATH"
for dir in "${ADDR[@]}"; do
  if [[ ! "$dir" -ef "$WRAPPER_DIR" && -x "$dir/claude" ]]; then REAL_CLAUDE="$dir/claude"; break; fi
done
if [[ -z "$REAL_CLAUDE" ]]; then echo "[wrapper] claude not found on PATH (excluding wrapper)" >&2; exit 127; fi
# BL-0294: shared capture tail -- records every call, refuses to start a claude after an earlier call died on authentication,
# and still ends in `exec claude` (the external run_eval's SIGKILL hits claude itself).
EXTRA_ARGS=("$@" --strict-mcp-config)
. "$CLAUDE_CAPTURE_TAIL"
EOF
chmod +x "$WRAPPER_DIR/claude"
# shellcheck source=lib/auth-stop.sh
. "$AUTOPILOT_DIR/scripts/lib/auth-stop.sh"
# shellcheck source=lib/claude-call-capture.sh
. "$AUTOPILOT_DIR/scripts/lib/claude-call-capture.sh"
# Per-run record dir (a STOP marker of an earlier run must never block this one).
claude_capture_begin "$RESULTS_DIR/claude-calls-$(date +%Y%m%d-%H%M%S)-$$"
export PATH="$WRAPPER_DIR:$PATH"
# G37 W5: under claude-account.js exec the environment is an allowlist, so the capture variables the wrapper needs are written into
# the wrapper itself (the wrapper does not call the account layer again: its caller, the python run below, is already inside it).
if [[ "${EVAL_ACCOUNT_ACTIVE:-0}" == 1 ]]; then
  {
    head -n 1 "$WRAPPER_DIR/claude"
    printf 'export CLAUDE_CAPTURE_TAIL=%q CLAUDE_CAPTURE_JS=%q EVAL_CALL_RECORD_DIR=%q\n' "$CLAUDE_CAPTURE_TAIL" "$CLAUDE_CAPTURE_JS" "$EVAL_CALL_RECORD_DIR"
    tail -n +2 "$WRAPPER_DIR/claude"
  } > "$WRAPPER_DIR/claude.baked"
  mv "$WRAPPER_DIR/claude.baked" "$WRAPPER_DIR/claude"
  chmod +x "$WRAPPER_DIR/claude"
fi

cd "$SKILL_CREATOR_DIR"
PY_RC=0
PYCODE="
import sys, os, json
# Monkey-patch: force Haiku + refresh token before each SDK call
import scripts.improve_description as imp
import anthropic

_orig = imp.improve_description
_cred_file = os.path.expanduser('~/.claude/.credentials.json')
# Under claude-account.js exec (AUTOPILOT_ACCOUNT set) the token is the alias token in this process env; no credentials file is read
# and ANTHROPIC_API_KEY is not exported (the claude children must authenticate with the OAuth token, not with an API-key variable).
# A parent CLAUDE_CODE_OAUTH_TOKEN (declared token seat or not) is the same rule the other spawn sites use: inherit it, never open the host file.
def _patched(*args, **kwargs):
    parent = os.environ.get('CLAUDE_CODE_OAUTH_TOKEN') or ''
    if os.environ.get('AUTOPILOT_TOKEN_SEAT') == '1' and not parent:
        sys.stderr.write('token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)\n')
        sys.exit(78)
    if os.environ.get('AUTOPILOT_ACCOUNT') or parent:
        token = os.environ['CLAUDE_CODE_OAUTH_TOKEN']
    else:
        # Re-read token every call (handles OAuth refresh mid-run)
        token = json.load(open(_cred_file))['claudeAiOauth']['accessToken']
        os.environ['ANTHROPIC_API_KEY'] = token
    # Force new client with fresh token
    kwargs['client'] = anthropic.Anthropic(api_key=token)
    override = os.environ.get('IMPROVE_MODEL_OVERRIDE') or 'claude-haiku-4-5-20251001'
    if override:
        kwargs['model'] = override
    print(f'[patch] improve: fresh token + {override}', file=sys.stderr)
    return _orig(*args, **kwargs)

imp.improve_description = _patched

# Also patch run_loop's import
import scripts.run_loop as rl
rl.improve_description = _patched

# Run as if __main__
sys.argv = [
    'run_loop',
    '--eval-set', '$EVAL_FILE',
    '--skill-path', '$SKILL_PATH',
    '--model', 'claude-sonnet-5',
    '--max-iterations', '3',
    '--num-workers', '10',
    '--runs-per-query', '1',
    '--verbose',
    '--results-dir', '$RESULTS_DIR',
]
rl.main()
"
if [[ "${EVAL_ACCOUNT_ACTIVE:-0}" == 1 ]]; then
  node "$EVAL_ACCOUNT_JS" exec --pick --purpose skill-opt -- python3 -c "$PYCODE" || PY_RC=$?
else
  python3 -c "$PYCODE" || PY_RC=$?
fi

# BL-0294: run_loop / run_eval swallow every claude failure, so the batch verdict comes from the captured call records (the first
# authentication failure stops later calls at the wrapper; this is the final check and the exit code).
if ! claude_capture_judge "" --final; then
  exit "$AUTH_STOP_EXIT"
fi
exit "$PY_RC"
