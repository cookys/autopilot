#!/usr/bin/env node
/**
 * reload-watch — PostToolUse
 *
 * Detects mtime changes on plugin/config files and emits a single-line
 * `/reload-plugins` reminder so agents notice when the disk state has
 * drifted from the session-start skill catalog snapshot.
 *
 * Watches:
 *   - ~/.claude/plugins/installed_plugins.json   (marketplace install/update)
 *   - $PWD/.claude/dispatch-config.md            (chain config)
 *   - $PWD/.claude/settings.local.json           (disabledSkills)
 *
 * Idempotent: state cached in ~/.claude/plugins/.reload-watch-state.json;
 * reminder only fires when mtime actually changed since the last seen state.
 * First run silently initializes the cache (no spam on a fresh machine).
 *
 * Implements Option D from
 * docs/plans/2026-05-14-reload-plugins-agent-invokable.md.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CWD = process.cwd();

const WATCH_FILES = [
  path.join(HOME, '.claude/plugins/installed_plugins.json'),
  path.join(CWD, '.claude/dispatch-config.md'),
  path.join(CWD, '.claude/settings.local.json'),
];

const STATE_FILE = path.join(HOME, '.claude/plugins/.reload-watch-state.json');

function getMtimes() {
  const result = {};
  for (const f of WATCH_FILES) {
    try {
      result[f] = fs.statSync(f).mtimeMs;
    } catch {
      result[f] = null;
    }
  }
  return result;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* best effort; never fail the tool */
  }
}

function friendlyName(f) {
  if (f.endsWith('installed_plugins.json')) return 'installed plugins';
  if (f.endsWith('dispatch-config.md')) return 'dispatch chain config';
  if (f.endsWith('settings.local.json')) return 'settings.local';
  return path.basename(f);
}

try {
  // Consume stdin so the harness doesn't block on us
  try { fs.readFileSync('/dev/stdin', 'utf8'); } catch { /* no stdin */ }

  const current = getMtimes();
  const previous = loadState();

  if (previous === null) {
    // First run on this machine — silently initialize, never spam
    saveState(current);
    process.exit(0);
  }

  // Cwd-scoped silent init: if this cwd's WATCH_FILES are absent from `previous`,
  // we've never seen them before (e.g. first time agent enters this project) —
  // treat as init, not as change. Otherwise switching between project cwds in a
  // monorepo would fire one false reminder per switch and erode the signal.
  const changed = WATCH_FILES.filter(f => (f in previous) && previous[f] !== current[f]);

  if (changed.length > 0) {
    const friendly = changed.map(friendlyName).join(', ');
    process.stderr.write(
      `⚠ Plugin catalog signal changed (${friendly}) — run /reload-plugins before next routing query so the skill catalog reflects on-disk state.\n`
    );
    // Save AFTER emitting: if writeFileSync crashes mid-emit, next invocation
    // will re-fire the same reminder (preferred over silently losing it).
    saveState({ ...previous, ...current });
  } else if (WATCH_FILES.some(f => !(f in previous))) {
    // New cwd seen for the first time — merge its keys into state silently so
    // future runs from this cwd compare against an established baseline.
    saveState({ ...previous, ...current });
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`reload-watch error: ${e.message}\n`);
  process.exit(0);
}
