#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/.claude-plugin" "$work/hooks" "$work/mods/live/pages"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","description":"pane-r3a targeted tests","types":"./mods/live/types/index.d.ts"}' > "$work/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/live/register.ts"]}' > "$work/hooks/hooks.json"
# Copy production dependencies, then only the requested tests (default: all affected page/frame tests).
(cd "$repo" && tar --exclude='*.test.ts' --exclude='*.test.js' --exclude='evidence' --exclude='ux-gate2-evidence' -cf - mods/live mods/viewer) | (cd "$work" && tar -xf -)
if [ "$#" -eq 0 ]; then set -- mods/live/pages/ux-gate3-frame.test.ts mods/live/pages/ux-gate3-decide.test.ts mods/live/pages/decide.test.ts mods/live/pages/ux-gate2.test.ts mods/live/frame.test.ts mods/live/gate2.test.ts; fi
for test_path in "$@"; do cp "$repo/$test_path" "$work/$test_path"; done
. "$repo/mods/lib/real-claude-env.sh"
mods_run_plugin_test "$work"
