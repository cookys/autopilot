#!/usr/bin/env node
'use strict';
//
// check-supersession-anchors.js — every code site that states a superseded Board
// ruling must carry a dated pointer to the ruling that replaced it.
//
// Why a manifest and not a grep: a raw `grep 'per-invocation'` cannot tell an
// applicable anchor from a passing mention, and it silently misses a generated
// mirror whose wording drifted. The applicable set is therefore FROZEN in
// hooks/fixtures/supersession-anchors.json; this checker only verifies it.
//
// It also pins the §7 out-of-scope regions byte-unchanged: a plan that promises
// not to touch the strike writer should fail loudly if it does.
//
// Exit 0 = every anchor carries the marker within its window and every protected
// region matches its recorded digest. Exit 1 = a named failure. Exit 2 = usage.
//
//   node scripts/check-supersession-anchors.js [--manifest <path>] [--update-digests]
//
// --update-digests rewrites the recorded protected-region digests from the working
// tree. It is for the deliberate, reviewed case where an out-of-scope region
// legitimately changed; never run it to make a red check go green.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'hooks', 'fixtures', 'supersession-anchors.json');

function fail(message) {
  process.stderr.write(`check-supersession-anchors: ${message}\n`);
  process.exitCode = 1;
}

function readManifest(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    process.stderr.write(`check-supersession-anchors: cannot read manifest ${manifestPath}\n`);
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`check-supersession-anchors: manifest is not valid JSON: ${err.message}\n`);
    process.exit(2);
  }
  if (!doc || doc.schema_version !== 1 || typeof doc.marker !== 'string'
      || !Array.isArray(doc.anchors)) {
    process.stderr.write('check-supersession-anchors: manifest shape is invalid\n');
    process.exit(2);
  }
  return doc;
}

// The marker must sit within `window` lines of the symbol line — close enough that
// a reader of the stale claim cannot miss it, loose enough to survive reflowing.
function checkAnchor(anchor, marker, window) {
  const abs = path.resolve(REPO_ROOT, anchor.file);
  let lines;
  try {
    lines = fs.readFileSync(abs, 'utf8').split('\n');
  } catch (err) {
    fail(`anchor ${anchor.id}: cannot read ${anchor.file}`);
    return;
  }
  const at = lines.findIndex((line) => line.includes(anchor.symbol));
  if (at === -1) {
    // A missing symbol is a failure, not a skip: either the anchor moved (update the
    // manifest deliberately) or the stale claim was deleted (same).
    fail(`anchor ${anchor.id}: symbol not found in ${anchor.file} — manifest is stale`);
    return;
  }
  const from = Math.max(0, at - window);
  const to = Math.min(lines.length, at + window + 1);
  if (!lines.slice(from, to).some((line) => line.includes(marker))) {
    fail(`anchor ${anchor.id} (${anchor.file}:${at + 1}, superseded by ${anchor.superseded_ruling}): `
      + `no "${marker}" pointer within ${window} lines`);
  }
}

function regionDigest(region) {
  // Every failure here is a NAMED failure, never a thrown stack: an unreadable file is
  // exactly the case a protected-region check exists to report.
  const abs = path.resolve(REPO_ROOT, region.file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { error: `cannot read ${region.file}` };
  }
  const start = text.indexOf(region.start_marker);
  if (start === -1) return { error: `start marker not found in ${region.file}` };
  const end = text.indexOf(region.end_marker, start + region.start_marker.length);
  if (end === -1) return { error: `end marker not found in ${region.file}` };
  const body = text.slice(start, end);
  return { digest: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length };
}

function main(argv) {
  let manifestPath = DEFAULT_MANIFEST;
  let update = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--manifest') { manifestPath = argv[i + 1]; i += 1; }
    else if (argv[i] === '--update-digests') { update = true; }
    else {
      process.stderr.write(`check-supersession-anchors: unknown argument ${argv[i]}\n`);
      process.exit(2);
    }
  }

  const doc = readManifest(manifestPath);
  const window = Number.isInteger(doc.window_lines) ? doc.window_lines : 6;

  for (const anchor of doc.anchors) checkAnchor(anchor, doc.marker, window);

  let changed = false;
  for (const region of doc.protected_regions || []) {
    const got = regionDigest(region);
    if (got.error) { fail(`protected region ${region.id}: ${got.error}`); continue; }
    if (update) {
      if (region.sha256 !== got.digest) changed = true;
      region.sha256 = got.digest;
      region.bytes = got.bytes;
    } else if (!region.sha256) {
      fail(`protected region ${region.id}: no recorded digest — run --update-digests once, deliberately`);
    } else if (region.sha256 !== got.digest) {
      fail(`protected region ${region.id} (${region.file}) changed: ${region.why}\n`
        + `  expected ${region.sha256}\n  actual   ${got.digest}`);
    }
  }

  if (update) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}\n`);
    process.stdout.write(changed
      ? 'check-supersession-anchors: protected-region digests updated\n'
      : 'check-supersession-anchors: digests already current\n');
    return;
  }

  if (!process.exitCode) {
    process.stdout.write(
      `check-supersession-anchors: ${doc.anchors.length} anchors, `
      + `${(doc.protected_regions || []).length} protected regions — ok\n`,
    );
  }
}

main(process.argv.slice(2));
