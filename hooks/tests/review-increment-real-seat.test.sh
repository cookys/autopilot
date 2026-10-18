#!/usr/bin/env bash
# BL-0201: real incremental seat answers (lines + JSON object, dropped prior: prefix).
# Fixtures are seat finding text copied from
# docs/plans/evidence/2026-10-17-review-only-increment/cells.
. "$(dirname "$0")/lib.sh"

# RED at 849ba03b2: lines-plus-object and lines-plus-object-s3 invalid (product review prose is ambiguous); missing-prior-prefix invalid (resolution names unknown finding s1.bulk-threshold); object-then-lines invalid (prose ambiguous); addendum missing single-JSON sentence and path:line requirement; unique suffix only-local rejected; duplicate restored id rejected as unknown finding s1.only-local. Suffix-none and suffix-two already invalid. exit was lost until the shell checked node status.
node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const N = require(path.join(root, 'src/engine/product-review-normalizer.js'));
const C = require(path.join(root, 'src/engine/review-resolution.js'));
const fx = path.join(root, 'hooks/tests/fixtures/review-increment-real-seat');
const read = (name) => fs.readFileSync(path.join(fx, name), 'utf8');

const linesPlus = read('lines-plus-object.txt');
const linesPlusS3 = read('lines-plus-object-s3.txt');
const missingPrior = read('missing-prior-prefix.txt');

function evidencePaths(text) {
  const paths = new Set();
  for (const m of text.matchAll(/"evidence"\s*:\s*"([^"]+)"/g)) {
    const cut = m[1].lastIndexOf(':');
    if (cut > 0) paths.add(m[1].slice(0, cut));
  }
  return [...paths];
}
function idsIn(text) {
  return [...text.matchAll(/"finding_id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function expectNormalized(label, raw, priorFindingIds) {
  const out = N.normalizeSeatReview(raw, {
    priorFindingIds,
    packetPaths: evidencePaths(raw),
  });
  if (out.status !== 'normalized') {
    console.error(`FAIL ${label}: status=${out.status} reason=${out.reason}`);
    process.exitCode = 1;
    return null;
  }
  return out;
}

const priorLines = idsIn(linesPlus);
const priorS3 = idsIn(linesPlusS3);
const priorMissing = idsIn(missingPrior).map((id) => `prior:${id}`);

const a = expectNormalized('lines-plus-object', linesPlus, priorLines);
const b = expectNormalized('lines-plus-object-s3', linesPlusS3, priorS3);
const c = expectNormalized('missing-prior-prefix', missingPrior, priorMissing);
if (a && a.resolutions.length !== priorLines.length) {
  console.error(`FAIL lines-plus resolution count ${a.resolutions.length}`);
  process.exitCode = 1;
}
if (b && b.resolutions.length !== priorS3.length) {
  console.error(`FAIL s3 resolution count ${b.resolutions.length}`);
  process.exitCode = 1;
}
if (c) {
  const restored = c.resolutions.map((r) => r.finding_id);
  if (restored.some((id) => !id.startsWith('prior:')) || new Set(restored).size !== priorMissing.length) {
    console.error('FAIL missing-prior ids were not restored to unique prior: ids');
    process.exitCode = 1;
  }
}

// Lines after the object (same real object, prose trailer) still take the object.
const after = `${missingPrior}\n🟠 [extra] note that is not the answer`;
const d = expectNormalized('object-then-lines', after, priorMissing);
if (d && d.resolutions[0].finding_id !== priorMissing[0]) {
  console.error('FAIL object-then-lines did not keep the object first resolution');
  process.exitCode = 1;
}

const text = C.buildPriorRoundAddendum(
  [{ finding_id: 'prior:s1.f1', severity: '🟠', location: 'src/a.js:10', claim: 'retry loop never terminates' }],
  { priorHead: 'a'.repeat(40), newHead: 'b'.repeat(40) },
);
if (typeof text !== 'string'
    || !text.includes('== Prior round (machine generated from the stored seat artifacts of round N-1) ==')
    || !text.includes('== end prior round ==')
    || !text.includes('Put the whole answer in FINDINGS as the single JSON object and do not also write the findings as separate lines.')
    || !text.includes('Every finding and every evidence must carry path:line.')) {
  console.error('FAIL addendum missing single-JSON sentence or path:line requirement');
  process.exitCode = 1;
}

// Unique bare suffix (part after the last prior:sN. prefix) restores.
const bare = N.normalizeSeatReview(
  JSON.stringify({ findings: 'none', resolutions: [{ finding_id: 'only-local', status: 'still_present' }] }),
  { priorFindingIds: ['prior:s1.only-local'], packetPaths: ['src/a.js'] },
);
if (bare.status !== 'normalized' || bare.resolutions[0].finding_id !== 'prior:s1.only-local') {
  console.error(`FAIL unique suffix restore status=${bare.status} reason=${bare.reason}`);
  process.exitCode = 1;
}

// Duplicate detection runs on the restored id.
const dup = N.normalizeSeatReview(
  JSON.stringify({
    findings: 'none',
    resolutions: [
      { finding_id: 's1.only-local', status: 'still_present' },
      { finding_id: 'prior:s1.only-local', status: 'resolved', evidence: 'src/a.js:1' },
    ],
  }),
  { priorFindingIds: ['prior:s1.only-local'], packetPaths: ['src/a.js'] },
);
if (dup.status !== 'invalid' || !/duplicate/.test(dup.reason || '')) {
  console.error(`FAIL duplicate restored id status=${dup.status} reason=${dup.reason}`);
  process.exitCode = 1;
}

const none = N.normalizeSeatReview(
  JSON.stringify({ findings: 'none', resolutions: [{ finding_id: 's9.missing', status: 'still_present' }] }),
  { priorFindingIds: ['prior:s1.only-local'], packetPaths: ['src/a.js'] },
);
if (none.status !== 'invalid') {
  console.error('FAIL suffix matching no prior id was accepted');
  process.exitCode = 1;
}

const two = N.normalizeSeatReview(
  JSON.stringify({ findings: 'none', resolutions: [{ finding_id: 'shared', status: 'still_present' }] }),
  { priorFindingIds: ['prior:s1.shared', 'prior:s2.shared'], packetPaths: ['src/a.js'] },
);
if (two.status !== 'invalid') {
  console.error('FAIL suffix matching two prior ids was accepted');
  process.exitCode = 1;
}

// Full round: lines plus object stay on the prose path (invalid, ambiguous).
const full = N.normalizeSeatReview(linesPlus, { priorFindingIds: null });
if (full.status !== 'invalid' || full.reason !== 'product review prose is ambiguous' || full.resolutions.length !== 0) {
  console.error(`FAIL full round changed: status=${full.status} reason=${full.reason}`);
  process.exitCode = 1;
}
const fullObj = N.normalizeSeatReview(missingPrior, {});
if (fullObj.status !== 'invalid' || fullObj.reason !== 'resolutions are only valid on an incremental round') {
  console.error(`FAIL full round pure object changed: ${fullObj.reason}`);
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
console.log('ok');
NODE
node_rc=$?
if [ "$node_rc" -ne 0 ]; then
  fail "real incremental seat answers did not normalize (node exit ${node_rc})"
fi
finalize_test
