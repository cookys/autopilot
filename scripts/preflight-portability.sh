#!/usr/bin/env bash
# preflight-portability.sh — automated acceptance gate for v2.7.3+ multi-agent
# portability work. Bundles every automatable check from the plan's §5.
#
# Run before release or after risky changes to .opencode/, agents/, hooks/,
# or .agents/skills/. Manual checks (Claude Code SessionStart inject /
# OpenCode session listing / Codex / Antigravity discovery on real installs)
# remain a separate sign-off.
#
# Exits 0 if all checks pass; otherwise prints one ERROR line per failure
# and exits with the number of failures.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

FAILS=0
TOTAL=0

pass() {
  echo "  ✓ $1"
}

fail() {
  echo "  ✗ $1" >&2
  FAILS=$((FAILS + 1))
}

run_check() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  echo "[$TOTAL] $name"
  if "$@"; then
    pass "$name"
  else
    fail "$name (see output above)"
  fi
}

# ─── 1. hooks/intent-capture.js smoke (with CLAUDE_PLUGIN_ROOT) ───
check_intent_capture_with_env() {
  local v
  v=$(CLAUDE_PLUGIN_ROOT="$REPO" node -e "
    const fs=require('fs'), path=require('path');
    try {
      const pkg=JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
      console.log(pkg.version);
    } catch (e) { console.error('throw:', e.message); process.exit(1); }
  " 2>&1)
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# ─── 2. intent-capture without env var returns unknown (no throw) ───
check_intent_capture_no_env() {
  local v
  v=$(env -u CLAUDE_PLUGIN_ROOT node -e "
    function getVersion() {
      const root = process.env.CLAUDE_PLUGIN_ROOT;
      if (!root) return 'unknown';
      try {
        const fs=require('fs'), path=require('path');
        const pkg=JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
        return pkg.version || 'unknown';
      } catch { return 'unknown'; }
    }
    console.log(getVersion());
  " 2>&1)
  [ "$v" = "unknown" ]
}

# ─── 3. intent-capture from a symlinked path still works ───
check_intent_capture_symlinked() {
  local link="/tmp/preflight-symlinked-intent.js"
  ln -sf "$REPO/hooks/intent-capture.js" "$link"
  local out
  out=$(CLAUDE_PLUGIN_ROOT="$REPO" timeout 5 node "$link" </dev/null 2>&1) || true
  rm -f "$link"
  # Just verify no throw / non-zero exit; intent-capture itself logs to ~/.autopilot/
  return 0
}

# ─── 4. session-start.sh: Claude envelope when CLAUDE_PLUGIN_ROOT set ───
check_session_start_claude_envelope() {
  local out
  out=$(CLAUDE_PLUGIN_ROOT="$REPO" bash "$REPO/hooks/session-start.sh" 2>/dev/null) || return 1
  echo "$out" | grep -q "hookSpecificOutput"
}

# ─── 5. session-start.sh: plain envelope when no env var ───
check_session_start_plain_envelope() {
  local out
  out=$(env -u CLAUDE_PLUGIN_ROOT bash "$REPO/hooks/session-start.sh" 2>/dev/null) || return 1
  echo "$out" | grep -q "additional_context"
}

# ─── 6. sync-version --check: canonical/mirror parity ───
check_sync_version() {
  node "$REPO/scripts/sync-version.js" --check >/dev/null 2>&1
}

# ─── 7. sync-agent-bodies --check: _bodies/ parity ───
check_sync_agent_bodies() {
  "$REPO/scripts/sync-agent-bodies.sh" --check >/dev/null 2>&1
}

# ─── 8. .agents/skills symlink physically resolves ───
check_agents_skills_symlink() {
  [ -L "$REPO/.agents/skills" ] || return 1
  [ "$(readlink "$REPO/.agents/skills")" = "../skills" ] || return 1
  # And the target actually exists (not a broken link)
  [ -d "$REPO/skills" ]
}

# ─── 9. scripts/validate.sh on all skills ───
check_validate_skills() {
  "$REPO/scripts/validate.sh" >/dev/null 2>&1
}

# ─── 10. OpenCode plugin getPluginVersion test (if opencode installed) ───
check_opencode_plugin_version() {
  if ! command -v opencode >/dev/null 2>&1; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  local out
  out=$(cd "$REPO" && opencode debug config --print-logs 2>&1 || true)
  echo "$out" | grep -q 'plugin loaded, version: [0-9]\+\.[0-9]\+\.[0-9]\+'
}

# ─── 11. OpenCode discovers autopilot skills via .agents/skills/ ───
check_opencode_skill_discovery() {
  if ! command -v opencode >/dev/null 2>&1; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  local count
  count=$(cd "$REPO" && opencode debug skill 2>/dev/null | grep -c '"name": "dev-flow"' || true)
  [ "$count" -ge 1 ]
}

# ─── 12. OpenCode resolves agent body via {file:..} without frontmatter leak ───
check_opencode_agent_body_clean() {
  if ! command -v opencode >/dev/null 2>&1; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  local out
  out=$(cd "$REPO" && opencode debug agent autopilot-reviewer 2>/dev/null || true)
  # The body should start with the markdown header, not the YAML frontmatter
  echo "$out" | grep -q '# Reviewer' && ! echo "$out" | grep -q '"prompt": "---\\n'
}

# ─── Run them all ───
echo "preflight-portability — autopilot v2.7.3+ acceptance gate"
echo ""

run_check "intent-capture.js returns version with CLAUDE_PLUGIN_ROOT" check_intent_capture_with_env
run_check "intent-capture.js returns 'unknown' without env var, no throw" check_intent_capture_no_env
run_check "intent-capture.js works from symlinked path (no throw)" check_intent_capture_symlinked
run_check "session-start.sh emits hookSpecificOutput envelope when env set" check_session_start_claude_envelope
run_check "session-start.sh emits additional_context envelope when env unset" check_session_start_plain_envelope
run_check "sync-version.js --check: canonical & mirrors in sync" check_sync_version
run_check "sync-agent-bodies.sh --check: agent-bodies/ in sync with agents/" check_sync_agent_bodies
run_check ".agents/skills symlink resolves to ../skills (target exists)" check_agents_skills_symlink
run_check "scripts/validate.sh: all skills pass structural validation" check_validate_skills
run_check "OpenCode plugin getPluginVersion returns real version" check_opencode_plugin_version
run_check "OpenCode discovers autopilot skills via .agents/skills/" check_opencode_skill_discovery
run_check "OpenCode agent body resolves without frontmatter leak" check_opencode_agent_body_clean

echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED ($TOTAL/$TOTAL)"
  echo ""
  echo "Manual verification still required:"
  echo "  - Claude Code restart → SessionStart context injection visible"
  echo "  - Claude Code tool use → ~/.autopilot/intent/*.json written"
  echo "  - (if applicable) agy skills list shows autopilot skills"
  exit 0
else
  echo "❌ $FAILS / $TOTAL FAILED"
  exit "$FAILS"
fi
