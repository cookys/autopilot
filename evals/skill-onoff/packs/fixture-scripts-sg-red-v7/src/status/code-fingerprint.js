'use strict';

// src/status/code-fingerprint.js — a watcher must not outlive a plugin update (mods plan P1W WATCHVER).
//
// The project watcher is long-lived (`--idle-exit 3600` keeps it up while a session is open) and loads its modules once, so a
// plugin update leaves it running OLD code until something kills it (the W4 gate: df3-running failed on exactly that). At start the
// watcher takes a fingerprint of its own code files; every tick asks `changed()`; on true it exits cleanly (lock released by the
// process ending) and the next UserPromptSubmit / SessionStart autostart starts a current one.
//
// Cheap by construction: a tick stats ~25 files (mtime + size). Contents are hashed only when that stat signature moved, and a
// change is reported only when the sha256 of the contents differs from the one taken at start, so a bare `touch` never
// restarts the watcher. A file that was present at start and is gone now (an update that replaced the plugin directory) counts
// as a change. Fail-open: an unreadable directory listing is "no change" (never kill a healthy watcher over a flaky read).
//
// Files: every src/status/*.js, scripts/render-review-page.js, scripts/lib/live-state-dir.js (the modules the watcher requires,
// directly or lazily) and .claude-plugin/plugin.json (the version).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXTRA_FILES = ['scripts/render-review-page.js', 'scripts/lib/live-state-dir.js', '.claude-plugin/plugin.json'];

function listFiles(root) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, 'src', 'status')).filter((n) => n.endsWith('.js')).sort(); } catch (_error) { return null; }
  return [...names.map((n) => path.join('src', 'status', n)), ...EXTRA_FILES];
}

function statSig(root, files) {
  return files.map((rel) => {
    try {
      const s = fs.statSync(path.join(root, rel));
      return `${rel}:${s.mtimeMs}:${s.size}`;
    } catch (_error) { return `${rel}:missing`; }
  }).join('|');
}

function contentHash(root, files) {
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(`${rel}\0`);
    try { h.update(fs.readFileSync(path.join(root, rel))); } catch (_error) { h.update('\0missing'); }
    h.update('\0');
  }
  return h.digest('hex');
}

function createCodeFingerprint({ root = REPO_ROOT } = {}) {
  let files = listFiles(root);
  if (files === null) files = EXTRA_FILES.slice();
  let sig = statSig(root, files);
  const startHash = contentHash(root, files);
  let startFiles = files;
  return {
    startHash,
    // true when the code on disk is no longer the code this process loaded.
    changed() {
      try {
        const now = listFiles(root);
        if (now === null) return false;
        const nowSig = statSig(root, now);
        if (nowSig === sig && now.join('|') === startFiles.join('|')) return false;
        // The stat signature moved (or the file set did): decide by content.
        if (now.join('|') !== startFiles.join('|')) return true;
        if (contentHash(root, now) === startHash) { sig = nowSig; return false; } // touched, not edited
        return true;
      } catch (_error) { return false; }
    },
  };
}

// Where this process's code lives: realpath of the plugin root and the version from its .claude-plugin/plugin.json (null when
// unreadable). Recorded in the envelope writer block so autostart can tell an old watcher from a current one even when an update
// installed into a NEW version directory (the old directory's files never change, so the fingerprint alone cannot see it).
function pluginIdentity(root = REPO_ROOT) {
  let real = root;
  try { real = fs.realpathSync(root); } catch (_error) { /* keep as given */ }
  let version = null;
  try { const v = JSON.parse(fs.readFileSync(path.join(real, '.claude-plugin', 'plugin.json'), 'utf8')).version; version = typeof v === 'string' && v ? v : null; } catch (_error) { /* unknown */ }
  return { plugin_root: real, plugin_version: version };
}

module.exports = { createCodeFingerprint, pluginIdentity, REPO_ROOT };
