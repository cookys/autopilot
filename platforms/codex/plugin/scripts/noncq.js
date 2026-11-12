#!/usr/bin/env node
'use strict';

/**
 * noncq.js — queue of work any non-Claude engine can do (noncq W1).
 *
 * Lanes file items (review-seat1 / research / replay / data / draft). When a
 * capacity.pace/1 file shows a non-Claude pool ALERT_behind with hours_to_reset
 * under 24 h and not stale, `drain` dispatches queued items whose prefer list
 * names that pool's engine key through the read-only rails (dispatch-review /
 * dispatch-author), then reaps finished runs and notifies the filing lane.
 * An empty qualifying pool is reported once per 6 h; the queue is never filled
 * with busy-work.
 *
 * USAGE:
 *   scripts/noncq.js add --lane A --kind K --brief F --accept S [--accept S]...
 *     --prefer k1,k2 [--input F]... [--wall 20m] [--expires 72h]
 *     [--diff F --spec F]   # required for review-seat1; refused otherwise
 *   scripts/noncq.js list [--state S] [--json]
 *   scripts/noncq.js drain --pace <pace.v1.json> [--dry-run] [--json]
 *
 * Queue root: AUTOPILOT_NONCQ_DIR or ~/.autopilot/noncq (0700). Item dir
 * items/<id>/ with item.json (0600), brief.md, optional inputs/, diff.patch,
 * spec.md; later result.md + receipt.json. Writes under scripts/lib/jsonl-store
 * withWriteLock.
 *
 * Env: AUTOPILOT_NONCQ_DIR, AUTOPILOT_NONCQ_REPORT_TO (empty reports; falls back
 * to AUTOPILOT_PM_ADDRESS), AUTOPILOT_FLEET_BIN (default fleet). Test seams:
 * AUTOPILOT_NONCQ_RAIL_DIR (fake dispatch-*.sh), AUTOPILOT_NOW (ISO clock).
 *
 * EXIT: 0 ok · 2 bad input / usage.
 *
 * Node >= 20.10, built-ins only. Contract: references/noncq.md.
 * Pool map: scripts/lib/noncq-pools.json.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  expandTilde,
  ensureDir,
  withWriteLock,
} = require('./lib/jsonl-store.js');

const SCHEMA = 'noncq/1';
const PACE_SCHEMA = 'capacity.pace/1';
const KINDS = Object.freeze(['review-seat1', 'research', 'replay', 'data', 'draft']);
const STATES = Object.freeze(['queued', 'dispatched', 'done', 'failed', 'expired']);
const MAX_ATTEMPTS = 2;
const EMPTY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WALL_MIN = 20;
const DEFAULT_EXPIRES_H = 72;
const LANE_RE = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;
const POOLS_PATH = path.join(__dirname, 'lib', 'noncq-pools.json');

function usage(msg) {
  if (msg) process.stderr.write(`noncq.js: ${msg}\n`);
  process.stderr.write(
    'usage: noncq.js add --lane A --kind K --brief F --accept S [--accept S]...\n'
    + '                --prefer k1,k2 [--input F]... [--wall 20m] [--expires 72h]\n'
    + '                [--diff F --spec F]\n'
    + '       noncq.js list [--state S] [--json]\n'
    + '       noncq.js drain --pace <pace.v1.json> [--dry-run] [--json]\n',
  );
  process.exit(2);
}

function nowMs(env = process.env) {
  if (env.AUTOPILOT_NOW) {
    const t = Date.parse(env.AUTOPILOT_NOW);
    if (!Number.isFinite(t)) usage(`AUTOPILOT_NOW is not a valid ISO time: ${env.AUTOPILOT_NOW}`);
    return t;
  }
  return Date.now();
}

function nowIso(env = process.env) {
  return new Date(nowMs(env)).toISOString();
}

function queueRoot(env = process.env) {
  const raw = env.AUTOPILOT_NONCQ_DIR
    ? expandTilde(env.AUTOPILOT_NONCQ_DIR)
    : path.join(os.homedir(), '.autopilot', 'noncq');
  return path.resolve(raw);
}

function ensureQueue(root) {
  ensureDir(root);
  try { fs.chmodSync(root, 0o700); } catch { /* best-effort */ }
  ensureDir(path.join(root, 'items'));
  return root;
}

function lockOpts(root) {
  return { storeDir: root, lockFile: path.join(root, '.lock'), name: 'noncq' };
}

function withQueueLock(root, fn) {
  return withWriteLock(lockOpts(root), fn);
}

function loadPools(poolsPath = POOLS_PATH) {
  const raw = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('noncq-pools.json must be an object');
  }
  return raw;
}

function knownEngineKeys(pools) {
  const keys = new Set();
  for (const entry of Object.values(pools)) {
    if (entry && typeof entry.key === 'string' && entry.key) keys.add(entry.key);
  }
  return keys;
}

function engineProfile(pools, key) {
  for (const entry of Object.values(pools)) {
    if (entry && entry.key === key) return entry;
  }
  return null;
}

function parseDurationToMinutes(raw, label) {
  const s = String(raw).trim();
  let m;
  if ((m = /^(\d+)\s*m$/i.exec(s))) return Number(m[1]);
  if ((m = /^(\d+)\s*h$/i.exec(s))) return Number(m[1]) * 60;
  if ((m = /^(\d+)$/.exec(s))) return Number(m[1]);
  usage(`${label} must look like 20m, 2h, or a bare minute count (got ${JSON.stringify(raw)})`);
}

function parseDurationToMs(raw, label) {
  const s = String(raw).trim();
  let m;
  if ((m = /^(\d+)\s*m$/i.exec(s))) return Number(m[1]) * 60 * 1000;
  if ((m = /^(\d+)\s*h$/i.exec(s))) return Number(m[1]) * 60 * 60 * 1000;
  if ((m = /^(\d+)\s*d$/i.exec(s))) return Number(m[1]) * 24 * 60 * 60 * 1000;
  if ((m = /^(\d+)$/.exec(s))) return Number(m[1]) * 60 * 60 * 1000; // bare = hours for expires
  usage(`${label} must look like 72h, 30m, or a bare hour count (got ${JSON.stringify(raw)})`);
}

function makeId(atMs) {
  const d = new Date(atMs);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const hex = crypto.randomBytes(2).toString('hex');
  return `nq-${y}${mo}${day}-${h}${mi}-${hex}`;
}

function itemDir(root, id) {
  return path.join(root, 'items', id);
}

function itemJsonPath(dir) {
  return path.join(dir, 'item.json');
}

function writeJsonAtomic(file, obj, mode = 0o600) {
  const dir = path.dirname(file);
  ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp.${process.pid}.${process.hrtime.bigint()}`);
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode });
  try { fs.chmodSync(tmp, mode); } catch { /* best-effort */ }
  fs.renameSync(tmp, file);
}

function readItem(dir) {
  return JSON.parse(fs.readFileSync(itemJsonPath(dir), 'utf8'));
}

function writeItem(dir, item) {
  writeJsonAtomic(itemJsonPath(dir), item, 0o600);
}

function listItemDirs(root) {
  const itemsRoot = path.join(root, 'items');
  if (!fs.existsSync(itemsRoot)) return [];
  return fs.readdirSync(itemsRoot)
    .map((name) => path.join(itemsRoot, name))
    .filter((p) => {
      try { return fs.statSync(p).isDirectory() && fs.existsSync(itemJsonPath(p)); } catch { return false; }
    });
}

function loadAllItems(root) {
  const out = [];
  for (const dir of listItemDirs(root)) {
    try {
      out.push({ dir, item: readItem(dir) });
    } catch {
      // skip corrupt
    }
  }
  return out;
}

function copyFileInto(src, dest) {
  fs.copyFileSync(src, dest);
  try { fs.chmodSync(dest, 0o600); } catch { /* best-effort */ }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json' || a === '--dry-run') {
      out[a.slice(2)] = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) usage(`flag --${key} needs a value`);
      i += 1;
      if (key === 'accept' || key === 'input') {
        if (!out[key]) out[key] = [];
        out[key].push(val);
      } else {
        out[key] = val;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function validateLane(lane) {
  if (typeof lane !== 'string' || !LANE_RE.test(lane)) {
    usage(`--lane must be a fleet address a/b/c (got ${JSON.stringify(lane)})`);
  }
}

function cmdAdd(flags, env = process.env) {
  const pools = loadPools();
  const keys = knownEngineKeys(pools);

  const lane = flags.lane;
  const kind = flags.kind;
  const brief = flags.brief;
  const accept = flags.accept || [];
  const preferRaw = flags.prefer;
  const inputs = flags.input || [];
  const diff = flags.diff;
  const spec = flags.spec;

  if (!lane) usage('--lane is required');
  if (!kind) usage('--kind is required');
  if (!brief) usage('--brief is required');
  if (!preferRaw) usage('--prefer is required');
  validateLane(lane);

  if (!KINDS.includes(kind)) usage(`--kind must be one of ${KINDS.join('|')} (got ${JSON.stringify(kind)})`);
  if (!Array.isArray(accept) || accept.length === 0 || accept.some((s) => !String(s).trim())) {
    usage('--accept requires at least one non-empty string');
  }
  if (!fs.existsSync(brief) || !fs.statSync(brief).isFile()) usage(`--brief file not found: ${brief}`);

  if (kind === 'review-seat1') {
    if (!diff || !spec) usage('review-seat1 requires --diff and --spec');
    if (!fs.existsSync(diff) || !fs.statSync(diff).isFile()) usage(`--diff file not found: ${diff}`);
    if (!fs.existsSync(spec) || !fs.statSync(spec).isFile()) usage(`--spec file not found: ${spec}`);
  } else if (diff || spec) {
    usage(`${kind} refuses --diff / --spec`);
  }

  const prefer = String(preferRaw).split(',').map((s) => s.trim()).filter(Boolean);
  if (prefer.length === 0) usage('--prefer needs at least one engine key');
  for (const k of prefer) {
    if (!keys.has(k)) usage(`--prefer unknown engine key ${JSON.stringify(k)} (known: ${[...keys].sort().join(',')})`);
  }

  let wallMin = DEFAULT_WALL_MIN;
  if (flags.wall !== undefined) {
    wallMin = parseDurationToMinutes(flags.wall, '--wall');
  }
  if (!Number.isInteger(wallMin) || wallMin < 1 || wallMin > 60) {
    usage(`--wall must be an integer 1..60 minutes (got ${wallMin})`);
  }

  const at = nowMs(env);
  let expiresMs = DEFAULT_EXPIRES_H * 60 * 60 * 1000;
  if (flags.expires !== undefined) {
    expiresMs = parseDurationToMs(flags.expires, '--expires');
  }
  if (!(expiresMs > 0)) usage('--expires must be positive');

  for (const inp of inputs) {
    if (!fs.existsSync(inp) || !fs.statSync(inp).isFile()) usage(`--input file not found: ${inp}`);
  }

  const root = ensureQueue(queueRoot(env));
  const id = makeId(at);
  const dir = itemDir(root, id);

  withQueueLock(root, () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    copyFileInto(brief, path.join(dir, 'brief.md'));
    if (inputs.length) {
      const inDir = path.join(dir, 'inputs');
      fs.mkdirSync(inDir, { recursive: true, mode: 0o700 });
      for (const inp of inputs) {
        copyFileInto(inp, path.join(inDir, path.basename(inp)));
      }
    }
    if (kind === 'review-seat1') {
      copyFileInto(diff, path.join(dir, 'diff.patch'));
      copyFileInto(spec, path.join(dir, 'spec.md'));
    }
    const item = {
      schema: SCHEMA,
      id,
      lane,
      kind,
      accept: accept.map((s) => String(s)),
      prefer,
      wall_min: wallMin,
      created_at: new Date(at).toISOString(),
      expires_at: new Date(at + expiresMs).toISOString(),
      state: 'queued',
      attempts: 0,
      result: null,
      notified: false,
    };
    writeItem(dir, item);
  });

  process.stdout.write(`${id}\n`);
  return 0;
}

function cmdList(flags, env = process.env) {
  const root = ensureQueue(queueRoot(env));
  const stateFilter = flags.state;
  if (stateFilter && !STATES.includes(stateFilter)) {
    usage(`--state must be one of ${STATES.join('|')}`);
  }
  const rows = loadAllItems(root)
    .map(({ item }) => item)
    .filter((it) => !stateFilter || it.state === stateFilter)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ items: rows }, null, 2)}\n`);
  } else {
    for (const it of rows) {
      process.stdout.write(`${it.id}\t${it.state}\t${it.kind}\t${it.lane}\tprefer=${(it.prefer || []).join(',')}\n`);
    }
  }
  return 0;
}

/** Qualifying pace rows → Map engineKey → { profile, waste_pct_if_unused, pools[] } */
function qualifyingEngines(pace, pools, opts = {}) {
  const requireHoursLt24 = opts.requireHoursLt24 !== false;
  if (!pace || pace.schema !== PACE_SCHEMA || !Array.isArray(pace.rows)) {
    usage(`pace file must have schema ${JSON.stringify(PACE_SCHEMA)} and rows[]`);
  }
  const byKey = new Map();
  for (const row of pace.rows) {
    if (!row || typeof row !== 'object') continue;
    const poolName = row.pool;
    const entry = pools[poolName];
    if (!entry) continue;
    if (row.class === 'claude' || row.class === 'scarce') continue;
    if (row.status !== 'ALERT_behind') continue;
    // Fail-closed on stale: only stale === false qualifies (missing / null / true skipped).
    if (row.stale !== false) continue;
    const hours = Number(row.hours_to_reset);
    if (!Number.isFinite(hours)) continue;
    if (requireHoursLt24 && !(hours < 24)) continue;

    const key = entry.key;
    const waste = Number(row.waste_pct_if_unused);
    const wasteN = Number.isFinite(waste) ? waste : 0;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        key,
        profile: entry,
        waste_pct_if_unused: wasteN,
        pools: [poolName],
      });
    } else {
      cur.waste_pct_if_unused = Math.max(cur.waste_pct_if_unused, wasteN);
      cur.pools.push(poolName);
    }
  }
  return byKey;
}

function railDir(env = process.env) {
  if (env.AUTOPILOT_NONCQ_RAIL_DIR) return path.resolve(env.AUTOPILOT_NONCQ_RAIL_DIR);
  return __dirname;
}

function assembleAuthorPrompt(dir, item) {
  const parts = [];
  parts.push('# Brief\n');
  parts.push(fs.readFileSync(path.join(dir, 'brief.md'), 'utf8'));
  if (!parts[parts.length - 1].endsWith('\n')) parts.push('\n');
  parts.push('\n# Acceptance\n');
  for (const a of item.accept) parts.push(`- ${a}\n`);
  const inDir = path.join(dir, 'inputs');
  if (fs.existsSync(inDir)) {
    const names = fs.readdirSync(inDir).sort();
    if (names.length) {
      parts.push('\n# Inputs\n');
      for (const name of names) {
        parts.push(`\n## ${name}\n`);
        parts.push(fs.readFileSync(path.join(inDir, name), 'utf8'));
        if (!parts[parts.length - 1].endsWith('\n')) parts.push('\n');
      }
    }
  }
  const promptPath = path.join(dir, 'assembled-prompt.md');
  fs.writeFileSync(promptPath, parts.join(''), { mode: 0o600 });
  return promptPath;
}

function buildRailCommand(dir, item, profile, runId, env) {
  const rails = railDir(env);
  const wall = `${item.wall_min}m`;
  const stdoutPath = path.join(dir, 'rail.stdout');
  const stderrPath = path.join(dir, 'rail.stderr');
  const exitPath = path.join(dir, 'rail.exit');
  // Resolve via railDir so AUTOPILOT_NONCQ_RAIL_DIR stubs never source the real script.
  const loadEnv = path.join(rails, 'load-endpoints-env.sh');

  let railScript;
  const args = [];
  if (item.kind === 'review-seat1') {
    railScript = path.join(rails, 'dispatch-review.sh');
    args.push(
      '--runner', profile.runner,
      '--model', String(profile.model),
      '--diff-file', path.join(dir, 'diff.patch'),
      '--spec-file', path.join(dir, 'spec.md'),
      '--timeout', wall,
    );
  } else {
    railScript = path.join(rails, 'dispatch-author.sh');
    const promptFile = assembleAuthorPrompt(dir, item);
    args.push(
      '--runner', profile.runner,
      '--model', String(profile.model),
      '--prompt-file', promptFile,
      '--timeout', wall,
    );
  }
  if (profile.endpoint) {
    args.push('--endpoint', profile.endpoint);
  }

  const argStr = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  const loadEnvQ = loadEnv.replace(/'/g, `'\\''`);
  const exitPathQ = exitPath.replace(/'/g, `'\\''`);
  const sourceBit = profile.endpoint
    ? `[ -f '${loadEnvQ}' ] && . '${loadEnvQ}'\nset +e`
    : '';
  // EXIT trap is registered BEFORE sourcing so an exit inside the sourced file still records rail.exit.
  const shell = [
    'set +e',
    `exit_path='${exitPathQ}'`,
    'trap \'ec=$?; set +e; printf "%s" "$ec" > "$exit_path.tmp"; mv "$exit_path.tmp" "$exit_path"\' EXIT',
    sourceBit,
    `bash '${railScript.replace(/'/g, `'\\''`)}' ${argStr} > '${stdoutPath.replace(/'/g, `'\\''`)}' 2> '${stderrPath.replace(/'/g, `'\\''`)}'`,
  ].filter((line) => line !== '').join('\n');

  return { shell, stdoutPath, stderrPath, exitPath, runId, railScript, args };
}

function spawnDetachedRail(shell, env) {
  const child = spawn('bash', ['-c', shell], {
    detached: true,
    stdio: 'ignore',
    env: { ...env, DISPATCH_DETACH: '0' },
  });
  child.unref();
  return child.pid;
}

function parseRailJson(stdoutText) {
  const lines = String(stdoutText).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === 'object' && typeof obj.status === 'string') return obj;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function expireItems(entries, atIso, dryRun, actions) {
  const atMs = Date.parse(atIso);
  for (const { dir, item } of entries) {
    // Expiry applies only to queued (incl. retryable failures requeued past expires_at).
    // Dispatched items are reaped first; still-running ones keep counting toward max_parallel.
    if (item.state !== 'queued') continue;
    const exp = Date.parse(item.expires_at);
    if (!Number.isFinite(exp) || !(exp <= atMs)) continue;
    actions.expired.push(item.id);
    if (dryRun) continue;
    item.state = 'expired';
    writeItem(dir, item);
  }
}

function reapOne(dir, item, atIso) {
  const exitPath = path.join(dir, 'rail.exit');
  if (!fs.existsSync(exitPath)) return null; // still running
  let exitCode = Number(fs.readFileSync(exitPath, 'utf8').trim());
  if (!Number.isFinite(exitCode)) exitCode = 1;
  let stdout = '';
  try { stdout = fs.readFileSync(path.join(dir, 'rail.stdout'), 'utf8'); } catch { /* empty */ }
  const parsed = parseRailJson(stdout);
  const receiptPath = path.join(dir, 'receipt.json');
  let receipt = {};
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch { /* */ }

  const runId = (item.result && item.result.run_id) || receipt.run_id || null;
  const engine = (item.result && item.result.engine) || receipt.engine || null;

  const success = parsed && (parsed.status === 'authored' || parsed.status === 'reviewed');
  if (success) {
    let resultBody = '';
    if (parsed.status === 'authored') {
      const raw = parsed.raw_log;
      if (typeof raw === 'string' && raw && fs.existsSync(raw)) {
        resultBody = fs.readFileSync(raw, 'utf8');
      } else {
        resultBody = typeof parsed.raw_log === 'string' ? parsed.raw_log : JSON.stringify(parsed, null, 2);
      }
    } else {
      // reviewed → findings JSON
      const findings = parsed.findings;
      if (typeof findings === 'string') {
        try { resultBody = `${JSON.stringify(JSON.parse(findings), null, 2)}\n`; } catch {
          resultBody = `${JSON.stringify({ findings }, null, 2)}\n`;
        }
      } else {
        resultBody = `${JSON.stringify({ findings: findings ?? null, verdict: parsed.verdict ?? null }, null, 2)}\n`;
      }
    }
    const resultPath = path.join(dir, 'result.md');
    fs.writeFileSync(resultPath, resultBody, { mode: 0o600 });
    item.state = 'done';
    item.result = {
      status: 'done',
      path: resultPath,
      run_id: runId,
      engine,
      finished_at: atIso,
    };
    item.notified = false;
    writeItem(dir, item);
    writeJsonAtomic(receiptPath, { ...receipt, finished_at: atIso, rail: parsed, exit: exitCode }, 0o600);
    return { id: item.id, lane: item.lane, outcome: 'done', path: resultPath };
  }

  // failure path
  const attempts = (item.attempts || 0) + 1;
  item.attempts = attempts;
  const failed = attempts >= MAX_ATTEMPTS;
  item.state = failed ? 'failed' : 'queued';
  const resultPath = path.join(dir, 'result.md');
  const errBody = [
    `# noncq failure (attempt ${attempts}/${MAX_ATTEMPTS})`,
    `exit: ${exitCode}`,
    `rail_status: ${parsed ? parsed.status : 'unparseable'}`,
    parsed && parsed.error ? `error: ${parsed.error}` : '',
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(resultPath, errBody, { mode: 0o600 });
  item.result = failed
    ? { status: 'failed', path: resultPath, run_id: runId, engine, finished_at: atIso }
    : null;
  item.notified = failed ? false : item.notified;
  // clear rail artifacts so a re-dispatch starts clean
  for (const name of ['rail.exit', 'rail.stdout', 'rail.stderr']) {
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* */ }
  }
  writeItem(dir, item);
  writeJsonAtomic(receiptPath, { ...receipt, finished_at: atIso, rail: parsed, exit: exitCode, attempts }, 0o600);
  if (failed) return { id: item.id, lane: item.lane, outcome: 'failed', path: resultPath };
  return { id: item.id, lane: item.lane, outcome: 'requeued', path: resultPath };
}

function reapDispatched(entries, atIso, dryRun, actions) {
  const finished = [];
  const requeuedIds = new Set();
  for (const { dir, item } of entries) {
    if (item.state !== 'dispatched') continue;
    if (dryRun) {
      if (fs.existsSync(path.join(dir, 'rail.exit'))) actions.would_reap.push(item.id);
      continue;
    }
    const r = reapOne(dir, item, atIso);
    if (r && (r.outcome === 'done' || r.outcome === 'failed')) {
      finished.push(r);
      actions.reaped.push(r);
    } else if (r && r.outcome === 'requeued') {
      actions.requeued.push(r.id);
      requeuedIds.add(r.id);
    }
  }
  return { finished, requeuedIds };
}

function pickForEngine(entries, engineKey, maxParallel, alreadyDispatchedCount, atMs, skipIds = new Set()) {
  const slots = Math.max(0, maxParallel - alreadyDispatchedCount);
  if (slots === 0) return [];
  const eligible = entries
    .filter(({ item }) => item.state === 'queued'
      && !skipIds.has(item.id)
      && Array.isArray(item.prefer)
      && item.prefer.includes(engineKey)
      && Date.parse(item.expires_at) > atMs) // safety; expire pass already ran
    .map(({ dir, item }) => ({
      dir,
      item,
      rank: item.prefer.indexOf(engineKey),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.item.created_at).localeCompare(String(b.item.created_at));
    });
  return eligible.slice(0, slots);
}

function countDispatched(entries, engineKey) {
  let n = 0;
  for (const { item, dir } of entries) {
    if (item.state !== 'dispatched') continue;
    let eng = item.result && item.result.engine;
    if (!eng) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
        eng = rec.engine;
      } catch { /* */ }
    }
    if (eng === engineKey) n += 1;
  }
  return n;
}

function dispatchOne(dir, item, profile, engineKey, env, dryRun, actions) {
  const at = nowIso(env);
  const runId = `${item.id}-a${item.attempts || 0}-${crypto.randomBytes(2).toString('hex')}`;
  if (profile.model == null) {
    process.stderr.write(`noncq.js: skip engine ${engineKey}: model is null (not verified)\n`);
    actions.skipped_null_model.push(engineKey);
    return false;
  }
  // Dry-run: record the would-dispatch only — no assembleAuthorPrompt, no receipt, no spawn.
  if (dryRun) {
    const rails = railDir(env);
    const railScript = item.kind === 'review-seat1'
      ? path.join(rails, 'dispatch-review.sh')
      : path.join(rails, 'dispatch-author.sh');
    actions.dispatched.push({ id: item.id, engine: engineKey, run_id: runId, rail: railScript });
    return true;
  }

  const cmd = buildRailCommand(dir, item, profile, runId, env);
  actions.dispatched.push({ id: item.id, engine: engineKey, run_id: runId, rail: cmd.railScript });

  const receipt = {
    run_id: runId,
    engine: engineKey,
    runner: profile.runner,
    model: profile.model,
    endpoint: profile.endpoint || null,
    started_at: at,
    stdout_path: cmd.stdoutPath,
    exit_path: cmd.exitPath,
  };
  writeJsonAtomic(path.join(dir, 'receipt.json'), receipt, 0o600);
  item.state = 'dispatched';
  item.result = { status: 'dispatched', path: null, run_id: runId, engine: engineKey, finished_at: null };
  writeItem(dir, item);
  spawnDetachedRail(cmd.shell, env);
  return true;
}

function fleetSend(lane, message, env = process.env) {
  const bin = env.AUTOPILOT_FLEET_BIN || 'fleet';
  const childEnv = { ...env };
  delete childEnv.FLEET_FYI;
  const r = spawnSync(bin, ['send', lane, message], {
    encoding: 'utf8',
    timeout: 30000,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0;
}

function notifyLanes(finished, entriesById, dryRun, actions, env) {
  // Group freshly finished + any prior done/failed not yet notified
  const pending = new Map(); // lane → [{id, outcome, path}]
  const add = (lane, row) => {
    if (!pending.has(lane)) pending.set(lane, []);
    pending.get(lane).push(row);
  };
  for (const f of finished) add(f.lane, f);
  for (const { dir, item } of entriesById) {
    if ((item.state === 'done' || item.state === 'failed') && item.notified === false) {
      const already = finished.some((f) => f.id === item.id);
      if (!already) {
        add(item.lane, {
          id: item.id,
          lane: item.lane,
          outcome: item.state,
          path: (item.result && item.result.path) || path.join(dir, 'result.md'),
        });
      }
    }
  }

  for (const [lane, rows] of pending) {
    const lines = ['[noncq-result]', ...rows.map((r) => `${r.id} ${r.outcome} ${r.path}`)];
    const msg = `${lines.join('\n')}\n`;
    actions.notified.push({ lane, ids: rows.map((r) => r.id) });
    if (dryRun) continue;
    const ok = fleetSend(lane, msg, env);
    if (!ok) {
      actions.notify_failed.push(lane);
      continue;
    }
    for (const r of rows) {
      const hit = entriesById.find(({ item }) => item.id === r.id);
      if (!hit) continue;
      hit.item.notified = true;
      writeItem(hit.dir, hit.item);
    }
  }
}

function emptyStampPath(root) {
  return path.join(root, 'empty-stamps.json');
}

function loadEmptyStamps(root) {
  try {
    const o = JSON.parse(fs.readFileSync(emptyStampPath(root), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function reportEmpty(root, engineKey, waste, atMs, dryRun, actions, env) {
  const stamps = loadEmptyStamps(root);
  const prev = stamps[engineKey] ? Date.parse(stamps[engineKey]) : NaN;
  if (Number.isFinite(prev) && (atMs - prev) < EMPTY_COOLDOWN_MS) {
    actions.empty_suppressed.push(engineKey);
    return;
  }
  const msg = `[noncq-empty] ${engineKey} waste_pct_if_unused=${waste}`;
  actions.empty_reported.push({ engine: engineKey, waste_pct_if_unused: waste });
  if (dryRun) return;

  const to = (env.AUTOPILOT_NONCQ_REPORT_TO || env.AUTOPILOT_PM_ADDRESS || '').trim();
  if (!to) {
    process.stderr.write(`noncq.js: ${msg} (no AUTOPILOT_NONCQ_REPORT_TO / AUTOPILOT_PM_ADDRESS)\n`);
  } else {
    const ok = fleetSend(to, `${msg}\n`, env);
    if (!ok) {
      process.stderr.write(`noncq.js: empty report send failed for ${engineKey}\n`);
      return; // do not stamp on failure — retry next drain
    }
  }
  stamps[engineKey] = new Date(atMs).toISOString();
  writeJsonAtomic(emptyStampPath(root), stamps, 0o600);
}

function cmdDrain(flags, env = process.env, opts = {}) {
  if (!flags.pace) usage('drain requires --pace <pace.v1.json>');
  if (!fs.existsSync(flags.pace)) usage(`pace file not found: ${flags.pace}`);
  let pace;
  try {
    pace = JSON.parse(fs.readFileSync(flags.pace, 'utf8'));
  } catch (e) {
    usage(`pace file is not JSON: ${e.message}`);
  }

  const dryRun = !!flags.dryRun || !!flags['dry-run'];
  const pools = loadPools(env.AUTOPILOT_NONCQ_POOLS || POOLS_PATH);
  const root = queueRoot(env);
  // Dry-run must not create the queue directory tree.
  if (!dryRun) ensureQueue(root);
  const atIso = nowIso(env);
  const atMs = nowMs(env);

  const actions = {
    expired: [],
    would_reap: [],
    reaped: [],
    requeued: [],
    dispatched: [],
    skipped_null_model: [],
    notified: [],
    notify_failed: [],
    empty_reported: [],
    empty_suppressed: [],
    qualifying: [],
  };

  const requireHoursLt24 = opts.requireHoursLt24 !== false;
  const qualified = qualifyingEngines(pace, pools, { requireHoursLt24 });
  actions.qualifying = [...qualified.keys()];

  const runBody = () => {
    let entries = loadAllItems(root);
    // Reap finished dispatched items BEFORE expiry so a finished run past
    // expires_at is reaped (and its lane notified), not marked expired.
    const { finished, requeuedIds } = reapDispatched(entries, atIso, dryRun, actions);
    entries = dryRun ? entries : loadAllItems(root);

    expireItems(entries, atIso, dryRun, actions);
    entries = dryRun ? entries : loadAllItems(root);

    // Track picks in memory so one dry-run item is not reported for two engines.
    const pickedIds = new Set(requeuedIds);

    for (const [engineKey, info] of qualified) {
      const profile = engineProfile(pools, engineKey) || info.profile;
      if (profile.model == null) {
        process.stderr.write(`noncq.js: skip engine ${engineKey}: model is null (not verified)\n`);
        actions.skipped_null_model.push(engineKey);
        continue;
      }
      const dispatchedCount = countDispatched(entries, engineKey);
      const picks = pickForEngine(
        entries, engineKey, profile.max_parallel || 1, dispatchedCount, atMs, pickedIds,
      );
      if (picks.length === 0) {
        // eligible queued count for empty report: prefer contains key and queued
        const eligibleQueued = entries.filter(({ item }) => item.state === 'queued'
          && Array.isArray(item.prefer) && item.prefer.includes(engineKey)
          && !pickedIds.has(item.id)).length;
        const inFlight = dispatchedCount;
        if (eligibleQueued === 0 && inFlight === 0) {
          reportEmpty(root, engineKey, info.waste_pct_if_unused, atMs, dryRun, actions, env);
        }
        continue;
      }
      for (const pick of picks) {
        dispatchOne(pick.dir, pick.item, profile, engineKey, env, dryRun, actions);
        pickedIds.add(pick.item.id);
        // refresh so max_parallel counts the just-dispatched item within this drain
        if (!dryRun) {
          pick.item.state = 'dispatched';
        }
      }
      entries = dryRun ? entries : loadAllItems(root);
    }

    entries = dryRun ? entries : loadAllItems(root);
    notifyLanes(finished, entries, dryRun, actions, env);
  };

  if (dryRun) runBody();
  else withQueueLock(root, runBody);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(actions, null, 2)}\n`);
  } else {
    process.stdout.write(
      `noncq drain: qualifying=${actions.qualifying.join(',') || '-'} `
      + `expired=${actions.expired.length} dispatched=${actions.dispatched.length} `
      + `reaped=${actions.reaped.length} empty=${actions.empty_reported.length}`
      + `${dryRun ? ' (dry-run)' : ''}\n`,
    );
  }
  return 0;
}

function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') usage();
  const cmd = argv[0];
  const flags = parseArgs(argv.slice(1));
  if (cmd === 'add') return cmdAdd(flags, env);
  if (cmd === 'list') return cmdList(flags, env);
  if (cmd === 'drain') return cmdDrain(flags, env);
  usage(`unknown command ${JSON.stringify(cmd)}`);
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`noncq.js: ${err && err.message ? err.message : err}\n`);
    process.exit(2);
  }
}

module.exports = {
  main,
  cmdAdd,
  cmdList,
  cmdDrain,
  qualifyingEngines,
  knownEngineKeys,
  loadPools,
  makeId,
  parseRailJson,
  assembleAuthorPrompt,
  buildRailCommand,
  SCHEMA,
  PACE_SCHEMA,
  KINDS,
  STATES,
  MAX_ATTEMPTS,
  EMPTY_COOLDOWN_MS,
  POOLS_PATH,
  queueRoot,
  nowMs,
};
