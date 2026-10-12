/**
 * Tests for scripts/lib/worktree-activity.js newestMtime vs nested worktrees (plan
 * docs/plans/2026-10-12-worktree-placement.md, P2.5). Run: node --test hooks/worktree-activity.test.js
 *
 * Rail and session worktrees live under <main checkout>/.claude/worktrees/. Walking the main checkout
 * must not read their writes as its own activity; a worktree that itself sits there is walked normally.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { newestMtime } = require('../scripts/lib/worktree-activity');

function touch(file, epochSeconds) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  fs.utimesSync(file, epochSeconds, epochSeconds);
}

test('newestMtime skips <root>/.claude/worktrees but not the rest of .claude', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-activity-'));
  try {
    touch(path.join(root, 'src', 'a.js'), 1_000_000);
    touch(path.join(root, '.claude', 'worktrees', 'hetero-x-abc123', 'b.js'), 2_000_000);
    assert.equal(newestMtime(root).mtime, 1_000_000 * 1000, 'a nested worktree write is not the root\'s activity');

    touch(path.join(root, '.claude', 'notes.md'), 1_500_000);
    assert.equal(newestMtime(root).mtime, 1_500_000 * 1000, 'other .claude content still counts');

    const nested = path.join(root, '.claude', 'worktrees', 'hetero-x-abc123');
    assert.equal(newestMtime(nested).mtime, 2_000_000 * 1000, 'a worktree under .claude/worktrees is walked as its own root');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
