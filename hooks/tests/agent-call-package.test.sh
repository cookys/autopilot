#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages/agent-call"

node --check "$PKG/bin/agent-call.js"
find "$PKG/src" "$PKG/test" -name '*.js' -print0 | xargs -0 -n1 node --check
node --test "$PKG"/test/*.test.js
node "$ROOT/bin/agent-call.js" --help >/dev/null

cmp "$PKG/skills/agent-call/SKILL.md" "$ROOT/skills/agent-call/SKILL.md"
cmp "$PKG/skills/agent-call/SKILL.md" "$ROOT/platforms/codex/plugin/skills/agent-call/SKILL.md"

grep -q 'authority: peer' "$PKG/src/message.js"
grep -q 'injected_unverified' "$PKG/src/adapters/tmux-console.js"
grep -q "'claude/channel'" "$PKG/src/channel/server.js"
grep -q 'agent-call receive --stdin' "$ROOT/docs/agent-call.md"

echo "PASS: agent-call package, mirrors, trust framing, and remote edge boundary"
