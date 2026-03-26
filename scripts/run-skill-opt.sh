#!/usr/bin/env bash
# Wrapper for skill-creator run_loop.py that injects OAuth token as ANTHROPIC_API_KEY.
# Reads from ~/.claude/.credentials.json (Claude Code OAuth login).
#
# OAuth tokens only access Haiku via the API. Eval uses `claude -p` (any model),
# but improve_description uses the SDK directly (Haiku only). We monkey-patch
# improve_description to force Haiku regardless of --model.
#
# Usage: ./scripts/run-skill-opt.sh <skill-name>
# Example: ./scripts/run-skill-opt.sh dev-flow

set -euo pipefail

SKILL_NAME="${1:?Usage: $0 <skill-name>}"
AUTOPILOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_CREATOR_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
CRED_FILE="$HOME/.claude/.credentials.json"

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

export ANTHROPIC_API_KEY="$TOKEN"

# OAuth tokens can only call Haiku via the Messages API.
# Eval (claude -p) uses the CLI's own auth and can use any model.
# Monkey-patch improve_description to force Haiku for the SDK call.
export IMPROVE_MODEL_OVERRIDE="claude-haiku-4-5-20251001"

cd "$SKILL_CREATOR_DIR"
exec python3 -c "
import sys, os, json
# Monkey-patch: force Haiku + refresh token before each SDK call
import scripts.improve_description as imp
import anthropic

_orig = imp.improve_description
_cred_file = os.path.expanduser('~/.claude/.credentials.json')

def _patched(*args, **kwargs):
    # Re-read token every call (handles OAuth refresh mid-run)
    token = json.load(open(_cred_file))['claudeAiOauth']['accessToken']
    os.environ['ANTHROPIC_API_KEY'] = token
    # Force new client with fresh token
    kwargs['client'] = anthropic.Anthropic(api_key=token)
    override = os.environ.get('IMPROVE_MODEL_OVERRIDE')
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
    '--model', 'claude-sonnet-4-6',
    '--max-iterations', '3',
    '--num-workers', '10',
    '--runs-per-query', '1',
    '--verbose',
    '--results-dir', '$RESULTS_DIR',
]
rl.main()
"
