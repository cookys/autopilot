#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SCHEMA_VERSION = 1;

const HELP_STRING = `tree.js — append-only JSONL task-tree CLI.

Single state-owning entrypoint for the task-tree engine (P1).
All mutation goes through this script; consumers read via subcommands.

Usage:
  scripts/tree.js <subcommand> [args]

Subcommands:
  init <proj>                        Create tree/ dir + empty events.jsonl
  emit <proj> <node-id> <event-json> Validate + append one JSONL event under lock
  rebuild-index <proj>               Fold events → index.json (deterministic, idempotent)
  next-decision <proj>               Print highest-priority pending decision (compact JSON)
  report <proj> <node>               Print node report JSON
  escalations <proj>                 List open escalations as JSON array
  fetch <proj> <node> --raw          Print artifact content + emit manager_raw_read event
  board-status <proj>                Print board_signoff index object or null;
                                     gate on .active (present AND decision=="graduate")

Event envelope (minimal, validated by emit):
  schema_version  (integer)
  ts              (ISO-8601 string)
  node            (string)
  type            (string)

Per-type event validation (beyond the 4-field envelope) is not yet wired:
$TREE_EVENT_VALIDATOR (stdin = event JSON) is the extension point. Note
check-node-report.sh validates NODE REPORT FILES by path — a different
interface; it is not a drop-in event validator.

File locations (per project):
  docs/projects/<proj>/tree/events.jsonl   — append-only event log (git-tracked)
  docs/projects/<proj>/tree/events.jsonl.lock — flock sidecar
  docs/projects/<proj>/tree/index.json     — derived, gitignored, rebuildable

locking notes:
  This script implements a custom cross-platform atomic locking mechanism using
  exclusive file creation ('wx' mode) with self-healing lock recovery and PID/TTL
  verification. It provides safe concurrency control on Linux, macOS, and Windows.

Exit codes:
  0  success
  1  logic error (event rejected, file not found, etc.)
  2  usage / missing required argument

Output: JSON to stdout for machine-readable subcommands.`;

function usageError(msg) {
  console.error(`usage error: ${msg}`);
  process.exit(2);
}

function logErr(msg) {
  console.error(`tree.js: ${msg}`);
}

function showHelp() {
  console.log(HELP_STRING);
}

function nowTs() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validateProjName(projName) {
  if (!projName) {
    usageError(`invalid project name: '${projName}' (alphanumeric start; a-zA-Z0-9._- only)`);
  }
  if (projName.includes('..') || projName.startsWith('/') || projName.startsWith('-') || projName.startsWith('.')) {
    usageError(`invalid project name: '${projName}' (alphanumeric start; a-zA-Z0-9._- only)`);
  }
  const projRegex = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!projRegex.test(projName)) {
    usageError(`invalid project name: '${projName}' (alphanumeric start; a-zA-Z0-9._- only)`);
  }
}

const repoRoot = path.resolve(__dirname, '..');
const defaultProjectsDir = path.join(repoRoot, 'docs/projects');
const treeProjectsDir = process.env.TREE_PROJECTS_DIR || defaultProjectsDir;

function getProjTreeDir(projName) {
  return path.join(treeProjectsDir, projName, 'tree');
}
function getProjEventsFile(projName) {
  return path.join(getProjTreeDir(projName), 'events.jsonl');
}
function getProjIndexFile(projName) {
  return path.join(getProjTreeDir(projName), 'index.json');
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// A lock is stale ONLY when its owner is gone — never merely because it is old.
// For a LOCAL owner (same host+cwd) we check the PID directly: a live owner is
// NEVER stale, so a slow-but-alive holder is never robbed of its lock (matches
// flock semantics — block until release/death, then fail-closed on timeout). A
// pure wall-clock TTL is reserved for CROSS-HOST owners whose liveness we cannot
// probe, and is deliberately generous + decoupled from the acquire timeout.
const CROSS_HOST_STALE_TTL_MS = 60000;
function isLockStale(lock) {
  if (!lock || typeof lock !== 'object') return true; // corrupt → recover
  const isLocal = lock.hostname === os.hostname() && lock.cwd === process.cwd();
  if (isLocal) {
    return lock.pid ? !isProcessAlive(parseInt(lock.pid, 10)) : true;
  }
  return (Date.now() - Number(lock.ts || 0)) > CROSS_HOST_STALE_TTL_MS;
}

// Block ms without burning CPU. A spin loop pegs a core and induces the very
// append-delays that used to trip the stale-lock steal; flock waits in-kernel.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockFile, timeoutMs = Number(process.env.TREE_LOCK_TIMEOUT_MS) || 10000) {
  const start = Date.now();
  const token = crypto.randomUUID();

  while (Date.now() - start < timeoutMs) {
    let fd = null;
    try {
      fd = fs.openSync(lockFile, 'wx');
      const lockData = JSON.stringify({
        pid: process.pid,
        ts: Date.now(),
        hostname: os.hostname(),
        cwd: process.cwd(),
        token: token
      });
      fs.writeSync(fd, lockData);
      fs.closeSync(fd);
      fd = null;
      return token;
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
        fd = null;
      }

      if (err.code !== 'EEXIST') {
        throw err;
      }

      let shouldRecover = false;
      let existing = null;
      try {
        const content = fs.readFileSync(lockFile, 'utf8');
        existing = JSON.parse(content);
        if (isLockStale(existing)) {
          shouldRecover = true;
        }
      } catch (readErr) {
        shouldRecover = true;
      }

      if (shouldRecover) {
        const msg = existing
          ? `Stale lock detected (token: ${existing.token || 'unknown'}, pid: ${existing.pid}). Overwriting.`
          : 'Corrupt lockfile detected. Quarantining.';
        console.error(`[LockRecovery] ${msg}`);

        const recoveryLock = lockFile + '.recovery';
        let recFd = null;
        try {
          recFd = fs.openSync(recoveryLock, 'wx');
          fs.writeSync(recFd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
          fs.closeSync(recFd);
          recFd = null;

          let stillStale = false;
          try {
            const recheckContent = fs.readFileSync(lockFile, 'utf8');
            const recheckExisting = JSON.parse(recheckContent);
            stillStale = isLockStale(recheckExisting);
          } catch (readErr) {
            stillStale = true;
          }

          if (stillStale) {
            try {
              fs.unlinkSync(lockFile);
            } catch (_) {}
          }
        } catch (recErr) {
          // Recovery mutex locked by someone else, wait and retry
        } finally {
          if (recFd !== null) {
            try { fs.closeSync(recFd); } catch (_) {}
          }
          try {
            fs.unlinkSync(recoveryLock);
          } catch (_) {}
        }
        continue;
      }
    }

    sleepMs(50);
  }
  throw new Error(`Lock timeout on ${lockFile}`);
}

function releaseLock(lockFile, token) {
  try {
    if (!fs.existsSync(lockFile)) {
      return;
    }
    const content = fs.readFileSync(lockFile, 'utf8');
    const existing = JSON.parse(content);
    if (existing.token === token) {
      fs.unlinkSync(lockFile);
    } else {
      console.warn(`[LockRelease] Ignored release of lock ownership. Current owner token is different (local: ${token}, file: ${existing.token}).`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[LockRelease] Error releasing lock: ${err.message}`);
    }
  }
}

function lockedAppend(eventsFile, line) {
  const lockFile = eventsFile + '.lock';
  let token = null;
  try {
    token = acquireLock(lockFile);
  } catch (err) {
    console.error(`tree.js: could not acquire lock on ${lockFile} within 10s — append aborted (no unlocked write)`);
    process.exit(1);
  }

  try {
    fs.appendFileSync(eventsFile, line + '\n');
  } catch (err) {
    console.error(`tree.js: append failed (write error) for ${eventsFile} — event NOT recorded`);
    process.exit(1);
  } finally {
    releaseLock(lockFile, token);
  }
}

function validateEnvelope(eventJson) {
  if (eventJson.includes('\n') || eventJson.includes('\r')) {
    logErr("event must be a single JSON line (no embedded newlines)");
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(eventJson);
  } catch (e) {
    logErr("event is not valid JSON");
    return false;
  }

  const requiredFields = ['schema_version', 'ts', 'node', 'type'];
  const missing = [];
  for (const field of requiredFields) {
    // Intentionally stricter than the shell's `jq has()` (which accepted a
    // present-but-null value): a null required field is treated as missing.
    if (parsed[field] === undefined || parsed[field] === null) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    logErr("event missing required fields:" + missing.map(f => " " + f).join(""));
    return false;
  }

  return true;
}

function parseEventsFile(eventsFile) {
  const buf = fs.readFileSync(eventsFile);
  let hasTruncatedTail = false;
  let truncatedContent = '';
  let truncatedByteOffset = 0;
  let lines = [];

  if (buf.length > 0) {
    const lastByte = buf[buf.length - 1];
    if (lastByte !== 0x0a) {
      hasTruncatedTail = true;
      const lastNewlineIndex = buf.lastIndexOf(0x0a);
      let partialLineBuf;
      if (lastNewlineIndex === -1) {
        partialLineBuf = buf;
        truncatedByteOffset = 0;
      } else {
        partialLineBuf = buf.subarray(lastNewlineIndex + 1);
        truncatedByteOffset = lastNewlineIndex + 1;
      }
      truncatedContent = partialLineBuf.toString('utf8');

      const completeContentBuf = buf.subarray(0, truncatedByteOffset);
      const text = completeContentBuf.toString('utf8').replace(/\r\n/g, '\n');
      lines = text.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
    } else {
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      lines = text.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
    }
  }

  const validLines = [];
  let lineNum = 0;
  for (const line of lines) {
    lineNum++;
    if (line === '') continue;
    try {
      JSON.parse(line);
      validLines.push(line);
    } catch (e) {
      console.error(`tree.js: rebuild-index: skipping invalid JSON on line ${lineNum}: ${line.slice(0, 80)}`);
    }
  }

  return {
    validLines,
    hasTruncatedTail,
    truncatedContent,
    truncatedByteOffset
  };
}

function rebuildIndex(validLines, hasTruncatedTail, truncatedContent, truncatedByteOffset, rebuiltAt, eventsHash) {
  const index = {
    nodes: {},
    escalations: [],
    decisions: [],
    board_signoff: null
  };

  for (const line of validLines) {
    const ev = JSON.parse(line);
    const node = ev.node;

    if (!index.nodes[node]) {
      index.nodes[node] = {
        id: node,
        status: "active",
        events: [],
        report: null,
        doa_log: [],
        escalations: [],
        verdict: null,
        confidence: null,
        evidence_pointers: [],
        artifact_paths: []
      };
    }

    index.nodes[node].events.push(ev.ts + ":" + ev.type);

    if (ev.type === "node_created") {
      index.nodes[node].status = "active";
      index.nodes[node].parent = ev.parent !== undefined ? ev.parent : null;
      index.nodes[node].question = ev.question !== undefined ? ev.question : null;
      index.nodes[node].options = ev.options !== undefined ? ev.options : [];
      index.nodes[node].evidence_pointers = ev.evidence_pointers !== undefined ? ev.evidence_pointers : [];
    } else if (ev.type === "delegated") {
      index.nodes[node].status = "delegated";
    } else if (ev.type === "doa_decision") {
      index.nodes[node].doa_log.push(ev);
    } else if (ev.type === "escalation_opened") {
      index.nodes[node].status = "escalated";
      const escId = ev.escalation_id !== undefined && ev.escalation_id !== null ? ev.escalation_id : (node + ":" + ev.ts);
      const question = ev.question !== undefined ? ev.question : null;
      const options = ev.options !== undefined ? ev.options : [];
      const evidence_pointers = ev.evidence_pointers !== undefined ? ev.evidence_pointers : [];

      index.nodes[node].escalations.push({
        id: escId,
        question: question,
        options: options,
        evidence_pointers: evidence_pointers,
        opened_at: ev.ts,
        resolved: false
      });

      index.escalations.push({
        node: node,
        id: escId,
        question: question,
        options: options,
        evidence_pointers: evidence_pointers,
        opened_at: ev.ts,
        resolved: false
      });
    } else if (ev.type === "escalation_resolved") {
      const escId = ev.escalation_id;
      if (escId !== undefined && escId !== null && escId !== "") {
        if (index.nodes[node]) {
          index.nodes[node].escalations = index.nodes[node].escalations.map(esc => {
            if (esc.id === escId && !esc.resolved) {
              return { ...esc, resolved: true, resolved_at: ev.ts };
            }
            return esc;
          });
        }
        index.escalations = index.escalations.map(esc => {
          if (esc.node === node && esc.id === escId && !esc.resolved) {
            return { ...esc, resolved: true, resolved_at: ev.ts };
          }
          return esc;
        });
      } else {
        if (index.nodes[node]) {
          index.nodes[node].escalations = index.nodes[node].escalations.map(esc => {
            if (!esc.resolved) {
              return { ...esc, resolved: true, resolved_at: ev.ts };
            }
            return esc;
          });
        }
        index.escalations = index.escalations.map(esc => {
          if (esc.node === node && !esc.resolved) {
            return { ...esc, resolved: true, resolved_at: ev.ts };
          }
          return esc;
        });
      }
    } else if (ev.type === "verdict") {
      index.nodes[node].status = "complete";
      index.nodes[node].verdict = ev.verdict !== undefined ? ev.verdict : null;
      index.nodes[node].confidence = ev.confidence !== undefined ? ev.confidence : null;
    } else if (ev.type === "node_report") {
      index.nodes[node].report = ev;
      index.nodes[node].artifact_paths = ev.artifact_paths !== undefined ? ev.artifact_paths : [];
      index.nodes[node].evidence_pointers = ev.evidence_pointers !== undefined ? ev.evidence_pointers : [];
      index.nodes[node].artifact_sha256 = ev.artifact_sha256 !== undefined ? ev.artifact_sha256 : null;
    } else if (ev.type === "decision_fork") {
      const decId = ev.decision_id !== undefined && ev.decision_id !== null ? ev.decision_id : (node + ":" + ev.ts);
      index.decisions.push({
        node: node,
        id: decId,
        question: ev.question !== undefined ? ev.question : null,
        options: ev.options !== undefined ? ev.options : [],
        evidence_pointers: ev.evidence_pointers !== undefined ? ev.evidence_pointers : [],
        created_at: ev.ts,
        resolved: false
      });
    } else if (ev.type === "decision_resolved") {
      const decId = ev.decision_id;
      if (decId !== undefined && decId !== null && decId !== "") {
        index.decisions = index.decisions.map(dec => {
          if (dec.node === node && dec.id === decId && !dec.resolved) {
            return { ...dec, resolved: true, resolved_at: ev.ts, chosen: ev.chosen !== undefined ? ev.chosen : null };
          }
          return dec;
        });
      } else {
        index.decisions = index.decisions.map(dec => {
          if (dec.node === node && !dec.resolved) {
            return { ...dec, resolved: true, resolved_at: ev.ts, chosen: ev.chosen !== undefined ? ev.chosen : null };
          }
          return dec;
        });
      }
    } else if (ev.type === "manager_raw_read") {
      if (!index.nodes[node].raw_reads) {
        index.nodes[node].raw_reads = [];
      }
      index.nodes[node].raw_reads.push(ev.ts);
    } else if (ev.type === "board_signoff") {
      index.board_signoff = {
        present: true,
        ts: ev.ts,
        authorized_by: ev.authorized_by !== undefined ? ev.authorized_by : null,
        decision: ev.decision !== undefined ? ev.decision : null,
        active: (ev.decision !== undefined && ev.decision === "graduate")
      };
    }
  }

  index.schema_version = SCHEMA_VERSION;
  index.rebuilt_at = rebuiltAt;
  index.events_hash = eventsHash;
  index.event_count = validLines.length;
  index.truncated_tail = null;

  if (hasTruncatedTail) {
    const truncHash = sha256(truncatedContent.replace(/\r\n/g, '\n'));
    index.truncated_tail = {
      byte_offset: truncatedByteOffset,
      content_hash: truncHash,
      partial_content: truncatedContent,
      detected_at: rebuiltAt
    };
  }

  return index;
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `${base}.${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    console.error(`tree.js: failed to write temp index (disk full?) — index NOT replaced`);
    process.exit(1);
  }
}

function indexIsStale(eventsFile, indexFile) {
  if (!fs.existsSync(indexFile)) {
    return true;
  }
  const eventsStat = fs.statSync(eventsFile);
  const indexStat = fs.statSync(indexFile);
  return eventsStat.mtimeMs > indexStat.mtimeMs;
}

function maybeRebuild(projName, eventsFile, indexFile) {
  if (indexIsStale(eventsFile, indexFile)) {
    runRebuildIndex(projName, eventsFile, indexFile);
  }
}

function cmdInit(projName) {
  const treeDir = getProjTreeDir(projName);
  const eventsFile = getProjEventsFile(projName);

  fs.mkdirSync(treeDir, { recursive: true });

  if (fs.existsSync(eventsFile) && fs.statSync(eventsFile).size > 0) {
    logErr(`tree already initialized at ${eventsFile} (not overwriting)`);
    process.exit(1);
  }

  fs.writeFileSync(eventsFile, '');

  const initEvent = JSON.stringify({
    schema_version: SCHEMA_VERSION,
    ts: nowTs(),
    node: "root",
    type: "tree_initialized",
    proj: projName
  });

  lockedAppend(eventsFile, initEvent);
  console.error(`initialized tree at ${eventsFile}`);
}

function cmdEmit(projName, nodeId, eventJson) {
  const eventsFile = getProjEventsFile(projName);
  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'; run init first`);
    process.exit(1);
  }

  if (!validateEnvelope(eventJson)) {
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(eventJson);
  } catch (e) {}

  if (parsed.node !== nodeId) {
    logErr(`event.node ('${parsed.node}') does not match <node-id> argument ('${nodeId}')`);
    process.exit(1);
  }

  const validator = process.env.TREE_EVENT_VALIDATOR;
  if (validator) {
    let isExecutable = false;
    try {
      fs.accessSync(validator, fs.constants.X_OK);
      if (fs.statSync(validator).isFile()) {
        isExecutable = true;
      }
    } catch (e) {}

    if (isExecutable) {
      try {
        execSync(validator, {
          input: eventJson,
          stdio: ['pipe', 'ignore', 'ignore']
        });
      } catch (err) {
        logErr("external event validator rejected event");
        process.exit(1);
      }
    }
  }

  lockedAppend(eventsFile, eventJson);
}

function runRebuildIndex(projName, eventsFile, indexFile) {
  const { validLines, hasTruncatedTail, truncatedContent, truncatedByteOffset } = parseEventsFile(eventsFile);

  let eventsToHash = '';
  if (validLines.length > 0) {
    eventsToHash = validLines.join('\n') + '\n';
  }
  const eventsHash = sha256(eventsToHash);

  const index = rebuildIndex(validLines, hasTruncatedTail, truncatedContent, truncatedByteOffset, nowTs(), eventsHash);

  if (hasTruncatedTail) {
    console.error(`WARNING: truncated tail detected at byte offset ${truncatedByteOffset} (partial write, likely kill mid-append)`);
  }

  atomicWriteJson(indexFile, index);
}

function cmdRebuildIndex(projName) {
  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`events file not found: ${eventsFile}`);
    process.exit(1);
  }

  runRebuildIndex(projName, eventsFile, indexFile);
}

function cmdNextDecision(projName) {
  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'`);
    process.exit(1);
  }

  maybeRebuild(projName, eventsFile, indexFile);

  if (!fs.existsSync(indexFile)) {
    logErr("index not found after rebuild attempt");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

  const openEsc = (index.escalations || [])
    .filter(esc => esc.resolved === false)
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at));

  const openDec = (index.decisions || [])
    .filter(dec => dec.resolved === false)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  let result = null;
  if (openEsc.length > 0) {
    const esc = openEsc[0];
    result = {
      node: esc.node,
      question: esc.question,
      options: esc.options || [],
      evidence_pointers: esc.evidence_pointers || [],
      decision_type: "escalation"
    };
  } else if (openDec.length > 0) {
    const dec = openDec[0];
    result = {
      node: dec.node,
      question: dec.question,
      options: dec.options || [],
      evidence_pointers: dec.evidence_pointers || [],
      decision_type: "fork"
    };
  }

  console.log(JSON.stringify(result, null, 2));
}

function cmdReport(projName, nodeId) {
  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'`);
    process.exit(1);
  }

  maybeRebuild(projName, eventsFile, indexFile);

  if (!fs.existsSync(indexFile)) {
    logErr("index not found after rebuild attempt");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const nodeData = index.nodes && index.nodes[nodeId];
  if (!nodeData) {
    logErr(`node '${nodeId}' not found in index`);
    process.exit(1);
  }

  console.log(JSON.stringify(nodeData, null, 2));
}

function cmdEscalations(projName) {
  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'`);
    process.exit(1);
  }

  maybeRebuild(projName, eventsFile, indexFile);

  if (!fs.existsSync(indexFile)) {
    logErr("index not found after rebuild attempt");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const openEsc = (index.escalations || []).filter(esc => esc.resolved === false);
  console.log(JSON.stringify(openEsc, null, 2));
}

function cmdFetch(projName, nodeId, flag) {
  if (flag !== '--raw') {
    logErr(`fetch: unknown flag '${flag}'; only --raw is supported`);
    process.exit(2);
  }

  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'`);
    process.exit(1);
  }

  maybeRebuild(projName, eventsFile, indexFile);

  if (!fs.existsSync(indexFile)) {
    logErr("index not found after rebuild attempt");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const node = index.nodes && index.nodes[nodeId];

  const artifactPaths = [];
  if (node && Array.isArray(node.artifact_paths)) {
    for (const item of node.artifact_paths) {
      if (typeof item === 'object' && item !== null) {
        if (item.path) {
          artifactPaths.push(item.path);
        }
      } else if (typeof item === 'string') {
        artifactPaths.push(item);
      }
    }
  }

  if (artifactPaths.length === 0) {
    logErr(`fetch: no artifact_paths found for node '${nodeId}'`);
  }

  const rawReadEvent = JSON.stringify({
    schema_version: SCHEMA_VERSION,
    ts: nowTs(),
    node: nodeId,
    type: "manager_raw_read",
    proj: projName
  });

  lockedAppend(eventsFile, rawReadEvent);

  let missing = 0;
  for (const p of artifactPaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      // Byte-exact (Buffer, no utf8 decode) — artifacts may be binary; the shell
      // used `cat`, which never re-encodes.
      process.stdout.write(fs.readFileSync(p));
    } else {
      logErr(`fetch: artifact not found at path: ${p}`);
      missing++;
    }
  }

  if (missing > 0) {
    logErr(`fetch: ${missing} declared artifact(s) missing — failing closed`);
    process.exit(1);
  }
}

function cmdBoardStatus(projName) {
  const eventsFile = getProjEventsFile(projName);
  const indexFile = getProjIndexFile(projName);

  if (!fs.existsSync(eventsFile)) {
    logErr(`tree not initialized for project '${projName}'`);
    process.exit(1);
  }

  maybeRebuild(projName, eventsFile, indexFile);

  if (!fs.existsSync(indexFile)) {
    logErr("index not found after rebuild attempt");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  console.log(JSON.stringify(index.board_signoff, null, 2));
}

const args = process.argv.slice(2);

if (args.length === 0) {
  showHelp();
  process.exit(2);
}

const cmd = args[0];

if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
  showHelp();
  process.exit(0);
}

if (args[1] === '--help' || args[1] === '-h') {
  showHelp();
  process.exit(0);
}

const subcmds = ['init', 'emit', 'rebuild-index', 'next-decision', 'report', 'escalations', 'fetch', 'board-status'];

if (!subcmds.includes(cmd)) {
  logErr(`unknown subcommand: ${cmd}`);
  showHelp();
  process.exit(2);
}

if (args.length < 2) {
  usageError(`${cmd} requires <proj>`);
}

const proj = args[1];
validateProjName(proj);

switch (cmd) {
  case 'init':
    cmdInit(proj);
    break;
  case 'emit':
    if (args.length < 4) {
      usageError("emit requires <proj> <node-id> <event-json>");
    }
    cmdEmit(proj, args[2], args[3]);
    break;
  case 'rebuild-index':
    cmdRebuildIndex(proj);
    break;
  case 'next-decision':
    cmdNextDecision(proj);
    break;
  case 'report':
    if (args.length < 3) {
      usageError("report requires <proj> <node>");
    }
    cmdReport(proj, args[2]);
    break;
  case 'escalations':
    cmdEscalations(proj);
    break;
  case 'fetch':
    if (args.length < 4) {
      usageError("fetch requires <proj> <node> --raw");
    }
    cmdFetch(proj, args[2], args[3]);
    break;
  case 'board-status':
    cmdBoardStatus(proj);
    break;
}
