# Autopilot Plugins

This directory contains OpenCode plugins that provide autopilot functionality.

## Files

- `autopilot.ts` — Main plugin providing:
  - Intent capture for cross-session resume hints
  - Session lifecycle logging
  - Resume hint display on session start

## Development

The plugin uses the OpenCode Plugin API (`@opencode-ai/plugin`).

To test changes:
1. Edit the plugin file
2. Restart OpenCode
3. Check stderr for `[autopilot]` log messages
