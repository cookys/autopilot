#!/usr/bin/env node
'use strict';

// install-fleet-card-mirror.js — opt-in installer for the fleet-card-mirror user timer (PM 01M78C2N).
// Nothing in the default install flow calls this. It does not run systemctl, so a
// throwaway HOME never talks to the running user manager.
//
//   node scripts/install-fleet-card-mirror.js install [--dry-run]
//   node scripts/install-fleet-card-mirror.js uninstall [--dry-run]
//
// install writes fleet-card-mirror.service and fleet-card-mirror.timer under
// $XDG_CONFIG_HOME/systemd/user, or ~/.config/systemd/user. <repo> in the
// templates (docs/guide/examples/) becomes this checkout. Idempotent: a second
// install of the same bytes changes nothing. A path that is a symlink, or an
// existing file without the marker `autopilot:fleet-card-mirror/1`, is refused.
// uninstall removes only files that carry that marker.
// A checkout path that contains whitespace is refused (a unit line would split).
//
// Exit 0 done, 1 refused or unreadable, 2 usage.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'autopilot:fleet-card-mirror/1';
const UNITS = ['fleet-card-mirror.service', 'fleet-card-mirror.timer'];
const REPO = path.resolve(__dirname, '..');
const LAYOUT = require('./lib/repo-layout.js');

function usage() {
  process.stdout.write(
    'usage: node scripts/install-fleet-card-mirror.js <install|uninstall> [--dry-run]\n' +
    'Opt-in. Writes fleet-card-mirror.service and fleet-card-mirror.timer into the user\n' +
    'systemd config dir. Does not run systemctl.\n'
  );
}

function fail(message) {
  process.stderr.write(`install-fleet-card-mirror: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let command = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === 'install' || arg === 'uninstall') {
      if (command) fail(`unexpected extra command: ${arg}`);
      command = arg;
    } else fail(`unknown argument: ${arg}`);
  }
  if (!command) {
    usage();
    process.exit(2);
  }
  return { command, dryRun };
}

function unitDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'systemd', 'user');
}

function readTemplate(name) {
  const file = path.join(REPO, LAYOUT.path('guide_dir'), 'examples', name);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`cannot read template ${name}: ${error.message}`);
  }
  if (!text.includes(MARKER)) fail(`template ${name} has no ${MARKER} marker`);
  return text;
}

function renderService(text, repo) {
  if (!text.includes('<repo>')) fail('service template has no <repo> placeholder');
  return text.split('<repo>').join(repo);
}

function destination(dir, name) {
  return path.join(dir, name);
}

function inspect(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { kind: 'absent' };
    fail(`cannot stat ${path.basename(file)}: ${error.message}`);
  }
  if (st.isSymbolicLink()) return { kind: 'symlink' };
  if (!st.isFile()) return { kind: 'notfile' };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`cannot read ${path.basename(file)}: ${error.message}`);
  }
  if (!text.includes(MARKER)) return { kind: 'foreign', text };
  return { kind: 'ours', text };
}

function ensureDir(dir, dryRun) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') fail(`cannot stat unit dir: ${error.message}`);
    if (dryRun) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    return;
  }
  if (st.isSymbolicLink()) fail('unit dir is a symlink');
  if (!st.isDirectory()) fail('unit dir is not a directory');
}

function writeFile(file, body, dryRun) {
  const found = inspect(file);
  if (found.kind === 'symlink') fail(`${path.basename(file)} is a symlink`);
  if (found.kind === 'notfile' || found.kind === 'foreign') fail(`${path.basename(file)} is not our unit`);
  if (found.kind === 'ours' && found.text === body) {
    process.stdout.write(`unchanged: ${path.basename(file)}\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`would write: ${path.basename(file)}\n`);
    return;
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o644 });
  fs.renameSync(tmp, file);
  process.stdout.write(`installed: ${path.basename(file)}\n`);
}

function removeFile(file, dryRun) {
  const found = inspect(file);
  if (found.kind === 'absent') {
    process.stdout.write(`absent: ${path.basename(file)}\n`);
    return;
  }
  if (found.kind !== 'ours') fail(`${path.basename(file)} is not our unit`);
  if (dryRun) {
    process.stdout.write(`would remove: ${path.basename(file)}\n`);
    return;
  }
  fs.unlinkSync(file);
  process.stdout.write(`removed: ${path.basename(file)}\n`);
}

function install(dryRun) {
  if (/\s/.test(REPO)) fail('repo path contains whitespace; refusing to write a unit');
  const dir = unitDir();
  ensureDir(dir, dryRun);
  const service = renderService(readTemplate('fleet-card-mirror.service'), REPO);
  const timer = readTemplate('fleet-card-mirror.timer');
  if (timer.includes('<repo>')) fail('timer template still has <repo>');
  writeFile(destination(dir, 'fleet-card-mirror.service'), service, dryRun);
  writeFile(destination(dir, 'fleet-card-mirror.timer'), timer, dryRun);
  process.stdout.write(
    'enable: systemctl --user daemon-reload && systemctl --user enable --now fleet-card-mirror.timer\n'
  );
}

function uninstall(dryRun) {
  const dir = unitDir();
  const files = UNITS.map((name) => destination(dir, name));
  for (const file of files) {
    const found = inspect(file);
    if (found.kind === 'symlink' || found.kind === 'notfile' || found.kind === 'foreign') {
      fail(`${path.basename(file)} is not our unit`);
    }
  }
  for (const file of files) removeFile(file, dryRun);
}

function main(argv) {
  const { command, dryRun } = parseArgs(argv);
  if (command === 'install') install(dryRun);
  else uninstall(dryRun);
}

if (require.main === module) main(process.argv.slice(2));
