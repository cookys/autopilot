#!/usr/bin/env node
'use strict';
// merge-set.js — the 60 first-parent merges of a007fa65e, checked against old replay merge_sha values.
// Usage: node docs/plans/evidence/2026-10-19-test-integrity-replay-v2/merge-set.js
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const OLD = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay/replay.json.gz`;

const git60 = execFileSync('git', ['rev-list', '--first-parent', '--merges', '-60', 'a007fa65e'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(OLD)).toString('utf8'));
const oldShas = [...new Set(old.records.map((r) => r.merge_sha))];
const gitSet = new Set(git60);
const outside = oldShas.filter((s) => !gitSet.has(s));
const missingFromRecords = git60.filter((s) => !oldShas.includes(s));
const report = {
  git60_count: git60.length,
  newest: git60[0],
  oldest: git60[git60.length - 1],
  old_record_merge_sha_count: oldShas.length,
  old_shas_outside_git60: outside,
  git60_absent_from_old_records: missingFromRecords,
  note: 'Old replay.json.gz stores merge_sha only on violation records. Clean ranges are counted in ranges_scanned but have no merge_sha. Identity of the scanned 60 is the git rev-list; every old merge_sha must sit inside that list.',
};
if (git60.length !== 60 || !git60[0].startsWith('a007fa65e')) {
  process.stderr.write(`merge set is not 60 merges headed by a007fa65e (newest ${git60[0]} count ${git60.length})\n`);
  process.exit(2);
}
void report;
if (outside.length) {
  process.stderr.write(`old merge_sha values outside git 60: ${outside.join(' ')}\n`);
  process.exit(2);
}
process.stdout.write(`merge-set ok git60=${git60.length} old_record_shas=${oldShas.length} clean_absent=${missingFromRecords.length} outside=${report.old_shas_outside_git60.length}\n`);
