'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  canonicalDigest,
} = require('./implementation-campaign');

function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function appendRow(journalPath, row) {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(journalPath, 'a', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function validRows(rows, cleanupId, record) {
  return rows.every((row) => {
    if (!row || row.schema !== 1
        || !new Set(['intent', 'removed_clean']).has(row.action)
        || row.cleanup_id !== cleanupId
        || row.lineage_id !== record.lineage_id
        || row.branch !== record.branch
        || row.worktree !== record.worktree
        || row.expected_tip !== record.expected_tip
        || row.cleanup_epoch !== record.cleanup_epoch
        || row.worktree_instance_id !== record.worktree_instance_id
        || row.retention_owner !== record.retention_owner
        || row.retention_reason !== record.retention_reason
        || row.retention_expires_at !== record.retention_expires_at
        || !/^[0-9a-f]{64}$/.test(row.record_digest || '')) return false;
    const { record_digest: recordDigest, ...body } = row;
    return canonicalDigest(body) === recordDigest;
  });
}

function transaction({ cwd, cleanupId, record, cleanupHelper }) {
  const common = git(cwd, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]);
  if (common.error || common.signal || common.status !== 0) {
    throw new Error('cannot resolve cleanup journal directory');
  }
  const journalPath = path.join(
    String(common.stdout || '').trim(),
    'autopilot',
    'repair-lineage-cleanup.jsonl',
  );
  const rows = fs.existsSync(journalPath)
    ? fs.readFileSync(journalPath, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.cleanup_id === cleanupId)
    : [];
  if (!validRows(rows, cleanupId, record)
      || new Set(rows.map((row) => row.action)).size !== rows.length) {
    throw new Error('cleanup journal identity or digest is invalid');
  }
  const completion = rows.some((row) => row.action === 'removed_clean');
  if (completion) {
    if (fs.existsSync(record.worktree)) {
      throw new Error('cleanup completion exists while retained worktree is still present');
    }
    return { status: 'ok', already_completed: true };
  }
  const priorIntent = rows.some((row) => row.action === 'intent');
  if (!priorIntent && !fs.existsSync(record.worktree)) {
    throw new Error('missing retained worktree has no prior cleanup intent');
  }
  if (!priorIntent) {
    const intent = {
      schema: 1,
      cleanup_id: cleanupId,
      action: 'intent',
      ...record,
    };
    intent.record_digest = canonicalDigest(intent);
    appendRow(journalPath, intent);
  }

  let recoveredAfterIntent = false;
  if (fs.existsSync(record.worktree)) {
    const removal = spawnSync('flock', [
      '-x',
      path.join(path.resolve(record.worktree), '.autopilot-worktree.lock'),
      process.execPath,
      cleanupHelper,
      JSON.stringify({
        cwd,
        worktree: record.worktree,
        expectedBranch: record.branch,
        expectedTip: record.expected_tip,
        expectedRootRunId: record.lineage_id,
        expectedRetentionOwner: record.retention_owner,
        expectedRetentionReason: record.retention_reason,
        expectedRetentionExpiresAt: record.retention_expires_at,
        expectedWorktreeInstanceId: record.worktree_instance_id,
      }),
    ], {
      cwd,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (removal.error) throw removal.error;
    if (removal.signal || removal.status !== 0) {
      throw new Error(
        String(removal.stderr || '').trim()
          || `retained worktree cleanup exited ${removal.status}`,
      );
    }
  } else {
    if (!priorIntent) {
      throw new Error('retained worktree disappeared before cleanup ownership was established');
    }
    const tip = git(cwd, ['rev-parse', '--verify', `refs/heads/${record.branch}`]);
    if (tip.error || tip.signal || tip.status !== 0
        || String(tip.stdout || '').trim() !== record.expected_tip) {
      throw new Error('missing retained worktree has no exact preserved branch tip');
    }
    recoveredAfterIntent = true;
  }

  const completed = {
    schema: 1,
    cleanup_id: cleanupId,
    action: 'removed_clean',
    ...record,
    recovered_after_intent: recoveredAfterIntent,
  };
  completed.record_digest = canonicalDigest(completed);
  appendRow(journalPath, completed);
  return { status: 'ok', recovered_after_intent: recoveredAfterIntent };
}

if (require.main === module) {
  try {
    const result = transaction(JSON.parse(process.argv[2] || 'null'));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  transaction,
};
