#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');

const RE_SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const RE_REPO = /^[A-Za-z0-9._-]{1,64}$/;
const RE_SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const RE_LANE_HASH = /^[0-9a-f]{12}$/;
const RE_KEY = /^[0-9a-f]{16}$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]{4,32}$/;

const TOP_KEYS = ['topic', 'pitfall_type', 'solution_type', 'tool', 'repo', 'evidence'];
const EV_KEYS = ['session_id', 'time_start', 'time_end', 'lane_hash'];

function homeDir() {
  return process.env.HOME || os.homedir();
}

function storeRoot() {
  return path.join(homeDir(), '.autopilot', 'knowledge-candidates');
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function mkdir0700(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  fs.chmodSync(dirPath, 0o700);
}

function writeFile0600(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function hasExactKeys(obj, expected) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length !== expected.length) return false;
  for (const k of expected) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return false;
  }
  return true;
}

function isValidCandidate(item) {
  if (!hasExactKeys(item, TOP_KEYS)) return false;
  if (typeof item.topic !== 'string' || !RE_SLUG.test(item.topic)) return false;
  if (typeof item.pitfall_type !== 'string' || !RE_SLUG.test(item.pitfall_type)) return false;
  if (typeof item.solution_type !== 'string' || !RE_SLUG.test(item.solution_type)) return false;
  if (typeof item.tool !== 'string' || !RE_SLUG.test(item.tool)) return false;
  if (typeof item.repo !== 'string' || !RE_REPO.test(item.repo)) return false;

  const ev = item.evidence;
  if (!hasExactKeys(ev, EV_KEYS)) return false;
  if (typeof ev.session_id !== 'string' || !RE_SESSION_ID.test(ev.session_id)) return false;
  if (typeof ev.time_start !== 'string' || !RE_ISO.test(ev.time_start)) return false;
  if (typeof ev.time_end !== 'string' || !RE_ISO.test(ev.time_end)) return false;
  if (typeof ev.lane_hash !== 'string' || !RE_LANE_HASH.test(ev.lane_hash)) return false;

  return true;
}

function candidateKey(item) {
  const arr = [item.topic, item.pitfall_type, item.solution_type, item.tool, item.repo];
  return sha256Hex(JSON.stringify(arr)).slice(0, 16);
}

function sessionHash(sessionId) {
  return sha256Hex(sessionId).slice(0, 12);
}

function resolveLane(explicitLane) {
  if (explicitLane !== undefined) {
    if (!RE_LANE_HASH.test(explicitLane)) {
      return { error: `Invalid --lane value: ${explicitLane} (expected 12 hex chars)` };
    }
    return { lane: explicitLane };
  }
  const envSeat = process.env.CODEFORGE_SELF_SEAT;
  if (envSeat && envSeat.trim().length > 0) {
    return { lane: sha256Hex(envSeat.trim()).slice(0, 12) };
  }
  const dataDir = process.env.CODEFORGE_DATA_DIR || path.join(homeDir(), '.codeforge');
  const tomlPath = path.join(dataDir, 'lessons.toml');
  try {
    const content = fs.readFileSync(tomlPath, 'utf8');
    const m = content.match(/^\s*self_seat\s*=\s*["']([^"']+)["']/m);
    if (m && m[1].trim().length > 0) {
      return { lane: sha256Hex(m[1].trim()).slice(0, 12) };
    }
  } catch (_) {
    // Missing or unreadable lessons.toml
  }
  return { error: 'Cannot determine seat lane: pass --lane <hash>, set CODEFORGE_SELF_SEAT, or configure self_seat in lessons.toml' };
}

function readDecision(keyDir) {
  const decPath = path.join(keyDir, 'decision.json');
  try {
    const raw = fs.readFileSync(decPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.status === 'approved' || parsed.status === 'rejected')) {
      return parsed.status;
    }
  } catch (_) {
    // No decision file or invalid -> pending
  }
  return 'pending';
}

function readLaneCandidates(laneDir) {
  if (!fs.existsSync(laneDir)) return [];
  const entries = fs.readdirSync(laneDir, { withFileTypes: true });
  const results = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || !RE_KEY.test(ent.name)) continue;
    const key = ent.name;
    const keyDir = path.join(laneDir, key);
    const status = readDecision(keyDir);
    const files = fs.readdirSync(keyDir, { withFileTypes: true });
    const evidence = [];
    let meta = null;
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.json') || f.name === 'decision.json') continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(keyDir, f.name), 'utf8'));
        if (!meta) {
          meta = {
            topic: rec.topic,
            pitfall_type: rec.pitfall_type,
            solution_type: rec.solution_type,
            tool: rec.tool,
            repo: rec.repo,
          };
        }
        if (rec.evidence) evidence.push(rec.evidence);
      } catch (_) {
        // Ignore corrupt file
      }
    }
    if (meta) {
      results.push({
        key,
        topic: meta.topic,
        pitfall_type: meta.pitfall_type,
        solution_type: meta.solution_type,
        tool: meta.tool,
        repo: meta.repo,
        evidence,
        count: evidence.length,
        status,
      });
    }
  }
  results.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return results;
}

function cmdAdd(args) {
  let filePath;
  let explicitLane;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') {
      filePath = args[++i];
      if (!filePath) {
        console.error('Missing value for --file');
        process.exit(2);
      }
    } else if (args[i] === '--lane') {
      explicitLane = args[++i];
      if (!explicitLane) {
        console.error('Missing value for --lane');
        process.exit(2);
      }
    } else {
      console.error(`Unknown option for add: ${args[i]}`);
      process.exit(2);
    }
  }

  const laneRes = resolveLane(explicitLane);
  if (laneRes.error) {
    console.error(laneRes.error);
    process.exit(2);
  }
  const thisLane = laneRes.lane;

  let raw;
  try {
    raw = filePath ? fs.readFileSync(filePath, 'utf8') : fs.readFileSync(0, 'utf8');
  } catch (err) {
    console.error(`Failed to read input: ${err.message}`);
    process.exit(2);
  }

  let items;
  try {
    items = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON input: ${err.message}`);
    process.exit(2);
  }
  if (!Array.isArray(items)) {
    console.error('Input must be a JSON array');
    process.exit(2);
  }

  let added = 0;
  let duplicate = 0;
  let rejected = 0;

  const root = storeRoot();
  const autopilotDir = path.dirname(root);

  for (const item of items) {
    if (!isValidCandidate(item) || item.evidence.lane_hash !== thisLane) {
      rejected++;
      continue;
    }
    const key = candidateKey(item);
    const sHash = sessionHash(item.evidence.session_id);
    const laneDir = path.join(root, thisLane);
    const keyDir = path.join(laneDir, key);
    const evPath = path.join(keyDir, `${sHash}.json`);

    if (fs.existsSync(evPath)) {
      duplicate++;
      continue;
    }

    mkdir0700(autopilotDir);
    mkdir0700(root);
    mkdir0700(laneDir);
    mkdir0700(keyDir);
    writeFile0600(evPath, JSON.stringify(item, null, 2) + '\n');
    added++;
  }

  console.log(JSON.stringify({ added, duplicate, rejected }));
  process.exit(0);
}

function cmdList(args) {
  let jsonOut = false;
  let statusFilter = null;
  let explicitLane;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all-seats') {
      console.error('Cross-seat review is not authorised: it requires the authorisation card.');
      process.exit(2);
    } else if (args[i] === '--json') {
      jsonOut = true;
    } else if (args[i] === '--status') {
      statusFilter = args[++i];
      if (!statusFilter || !['pending', 'approved', 'rejected'].includes(statusFilter)) {
        console.error('Invalid --status: must be pending, approved, or rejected');
        process.exit(2);
      }
    } else if (args[i] === '--lane') {
      explicitLane = args[++i];
      if (!explicitLane) {
        console.error('Missing value for --lane');
        process.exit(2);
      }
    } else {
      console.error(`Unknown option for list: ${args[i]}`);
      process.exit(2);
    }
  }

  const laneRes = resolveLane(explicitLane);
  if (laneRes.error) {
    console.error(laneRes.error);
    process.exit(2);
  }

  const laneDir = path.join(storeRoot(), laneRes.lane);
  let items = readLaneCandidates(laneDir);
  if (statusFilter) {
    items = items.filter((it) => it.status === statusFilter);
  }

  if (jsonOut) {
    console.log(JSON.stringify(items));
  } else {
    for (const it of items) {
      console.log(`${it.key} ${it.status} (${it.count}) ${it.topic} ${it.pitfall_type} -> ${it.solution_type} [${it.tool}@${it.repo}]`);
    }
  }
  process.exit(0);
}

function cmdDecide(status, args) {
  let explicitLane;
  let key;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lane') {
      explicitLane = args[++i];
      if (!explicitLane) {
        console.error('Missing value for --lane');
        process.exit(2);
      }
    } else if (!key && !args[i].startsWith('-')) {
      key = args[i];
    } else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(2);
    }
  }

  if (!key || !RE_KEY.test(key)) {
    console.error(`Invalid or missing key: ${key || '(none)'}`);
    process.exit(2);
  }

  const laneRes = resolveLane(explicitLane);
  if (laneRes.error) {
    console.error(laneRes.error);
    process.exit(2);
  }

  const keyDir = path.join(storeRoot(), laneRes.lane, key);
  if (!fs.existsSync(keyDir) || !fs.statSync(keyDir).isDirectory()) {
    console.error(`Unknown candidate key in this lane: ${key}`);
    process.exit(2);
  }

  const decPath = path.join(keyDir, 'decision.json');
  writeFile0600(decPath, JSON.stringify({ status, at: new Date().toISOString() }, null, 2) + '\n');
  process.exit(0);
}

function cmdScanStaged(args) {
  let explicitLane;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lane') {
      explicitLane = args[++i];
      if (!explicitLane) {
        console.error('Missing value for --lane');
        process.exit(2);
      }
    } else {
      console.error(`Unknown option for scan-staged: ${args[i]}`);
      process.exit(2);
    }
  }

  const root = storeRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.exit(0);
  }

  const laneRes = resolveLane(explicitLane);
  const laneDirs = [];
  if (!laneRes.error) {
    const d = path.join(root, laneRes.lane);
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
      laneDirs.push(d);
    }
  } else {
    // No --lane/env/toml available: scan every local lane directory
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isDirectory() && RE_LANE_HASH.test(ent.name)) {
        laneDirs.push(path.join(root, ent.name));
      }
    }
  }

  const blockedTokens = []; // { token, key }
  for (const laneDir of laneDirs) {
    const candidates = readLaneCandidates(laneDir);
    for (const c of candidates) {
      if (c.status === 'pending' || c.status === 'rejected') {
        blockedTokens.push({ token: c.key, key: c.key });
        for (const ev of c.evidence) {
          if (ev && ev.session_id) {
            blockedTokens.push({ token: ev.session_id, key: c.key });
          }
        }
      }
    }
  }

  let stagedOut;
  try {
    stagedOut = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=AM', '-z'], {
      encoding: 'utf8',
    });
  } catch (_) {
    process.exit(0);
  }

  const stagedFiles = stagedOut.split('\0').filter(Boolean);
  for (const filePath of stagedFiles) {
    if (/(^|\/)knowledge-candidates(\/|$)/.test(filePath)) {
      console.error(`Blocked staged file inside knowledge-candidates directory: ${filePath}`);
      process.exit(1);
    }
    if (blockedTokens.length === 0) continue;

    let blob;
    try {
      blob = execFileSync('git', ['show', `:${filePath}`], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (_) {
      continue;
    }

    for (const { token, key } of blockedTokens) {
      if (blob.includes(token)) {
        console.error(`Blocked staged file ${filePath}: contains pending/rejected candidate ${key}`);
        process.exit(1);
      }
    }
  }

  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === 'add') {
    cmdAdd(rest);
  } else if (sub === 'list') {
    cmdList(rest);
  } else if (sub === 'approve') {
    cmdDecide('approved', rest);
  } else if (sub === 'reject') {
    cmdDecide('rejected', rest);
  } else if (sub === 'scan-staged') {
    cmdScanStaged(rest);
  } else {
    console.error('Usage: knowledge-review.js <add|list|approve|reject|scan-staged> [options]');
    process.exit(2);
  }
}

main();
