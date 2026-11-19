#!/usr/bin/env node
// scripts/tux-manifest.js — hash every file under mods/tux except VERSION and VERSION.manifest.
//
//   node scripts/tux-manifest.js           write VERSION.manifest; bump VERSION when content changed
//   node scripts/tux-manifest.js --check   exit 1 when the manifest does not match the tree (does not bump)
//
// First write (no manifest yet) keeps the VERSION integer as-is (start at 1). A later content change bumps it by 1.
// exit codes: 0 ok · 1 drift · 2 usage / bad VERSION

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', 'mods', 'tux');
const versionPath = path.join(root, 'VERSION');
const manifestPath = path.join(root, 'VERSION.manifest');
const SKIP = new Set(['VERSION', 'VERSION.manifest']);

function fail(why) {
  process.stderr.write(`tux-manifest: ${why}\n`);
  process.exit(2);
}

function collect() {
  const rels = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (rel === '' && SKIP.has(name)) continue;
      const abs = path.join(dir, name);
      const next = rel === '' ? name : rel + '/' + name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, next);
      else rels.push(next);
    }
  };
  walk(root, '');
  rels.sort();
  const files = {};
  for (const rel of rels) {
    files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  }
  return files;
}

function readVersion() {
  let text;
  try { text = fs.readFileSync(versionPath, 'utf8').trim(); } catch (e) { fail(`cannot read VERSION: ${e.message}`); }
  if (!/^\d+$/.test(text)) fail('VERSION is not an integer');
  return Number(text);
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_e) { return null; }
}

function sameFiles(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function emit(version, files) {
  fs.writeFileSync(versionPath, String(version) + '\n');
  fs.writeFileSync(manifestPath, JSON.stringify({ version, files }, null, 2) + '\n');
}

function main(argv) {
  const check = argv.includes('--check');
  const files = collect();
  const manifest = readManifest();
  const haveVersion = fs.existsSync(versionPath);
  if (check) {
    if (!haveVersion || manifest === null) {
      process.stderr.write('tux-manifest: missing VERSION or VERSION.manifest\n');
      return 1;
    }
    const version = readVersion();
    if (manifest.version !== version || !sameFiles(manifest.files, files)) {
      process.stderr.write('tux-manifest: manifest drift (sha changed or version disagrees; --check does not bump)\n');
      return 1;
    }
    process.stdout.write(`tux-manifest: ok (version ${version})\n`);
    return 0;
  }
  if (manifest === null) {
    const version = haveVersion ? readVersion() : 1;
    emit(version, files);
    process.stdout.write(`tux-manifest: wrote version ${version}\n`);
    return 0;
  }
  const version = readVersion();
  if (manifest.version === version && sameFiles(manifest.files, files)) {
    process.stdout.write(`tux-manifest: unchanged (version ${version})\n`);
    return 0;
  }
  const next = version + 1;
  emit(next, files);
  process.stdout.write(`tux-manifest: bumped to ${next}\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { collect, sameFiles };
