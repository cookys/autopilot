#!/usr/bin/env node
'use strict';

// pm-inbox-adapter.js — single I/O adapter for the PM inbox ledger and task metadata.
//
// Modes (selected by AUTOPILOT_PM_INBOX_ADAPTER, default "fleet"):
//   - "fleet": invokes <AUTOPILOT_FLEET_REPO>/plugins/claude/src/inbox-cli.ts via
//     `node --experimental-transform-types` for list/mark/wake, runs the JSON argv
//     array in AUTOPILOT_PM_ACCEPT_CMD (with taskId appended) for accept(), and runs
//     the JSON argv array in AUTOPILOT_PM_TASK_SHOW_CMD (with taskId appended) for
//     getTask(taskId) (unset => returns null => cannot auto-accept => pending).
//     Refuses to run (exitCode 2) when AUTOPILOT_FLEET_REPO is unset.
//   - "fixture:<dir>": reads <dir>/inbox.json and optional <dir>/tasks.json, and
//     appends JSONL records to <dir>/marks.jsonl, <dir>/wakes.jsonl, <dir>/accepts.jsonl.
//
// Member defaults to AUTOPILOT_PM_INBOX_MEMBER || "pm--claude".
// Node built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_MEMBER = 'pm--claude';
const FLEET_CLI_REL = 'plugins/claude/src/inbox-cli.ts';
const VALID_DISPOSITIONS = new Set(['done', 'no_action', 'pending_decision']);

function adapterError(message, exitCode = 2, code = 'ADAPTER_ERROR') {
  const err = new Error(`pm-inbox-adapter: ${message}`);
  err.exitCode = exitCode;
  err.code = code;
  return err;
}

function cleanChildEnv(baseEnv) {
  const env = { ...(baseEnv || process.env) };
  delete env.AUTOPILOT_TOKEN_SEAT;
  delete env.AUTOPILOT_SESSION_ID;
  delete env.AUTOPILOT_CHILD_SESSION_ID;
  return env;
}

function normalizeItemsPayload(parsed, sourceLabel) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.messages)) return parsed.messages;
  }
  throw adapterError(`unexpected inbox payload shape from ${sourceLabel}`, 2, 'BAD_PAYLOAD');
}

function normalizeTaskRecord(raw, fallbackTaskId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const taskObj = (raw.task && typeof raw.task === 'object' && !Array.isArray(raw.task))
    ? raw.task
    : raw;
  const taskId = typeof taskObj.task_id === 'string' && taskObj.task_id.trim() !== ''
    ? taskObj.task_id.trim()
    : (typeof taskObj.id === 'string' && taskObj.id.trim() !== '' ? taskObj.id.trim() : String(fallbackTaskId || '').trim());
  const assignee = typeof taskObj.assignee === 'string' && taskObj.assignee.trim() !== ''
    ? taskObj.assignee.trim()
    : (typeof taskObj.to === 'string' && taskObj.to.trim() !== '' ? taskObj.to.trim() : '');
  const rawAttempt = taskObj.attempt !== undefined && taskObj.attempt !== null
    ? taskObj.attempt
    : taskObj.generation;
  const parsedAttempt = rawAttempt !== undefined && rawAttempt !== null && String(rawAttempt).trim() !== ''
    ? Number(rawAttempt)
    : null;
  const attempt = Number.isInteger(parsedAttempt) && parsedAttempt > 0 ? parsedAttempt : null;
  const dispatchedAt = typeof taskObj.dispatched_at === 'string' && taskObj.dispatched_at.trim() !== ''
    ? taskObj.dispatched_at.trim()
    : (typeof taskObj.created_at === 'string' && taskObj.created_at.trim() !== '' ? taskObj.created_at.trim() : '');
  const acceptance = Array.isArray(taskObj.acceptance)
    ? taskObj.acceptance.map((item) => String(item))
    : [];

  return {
    task_id: taskId,
    assignee,
    attempt,
    dispatched_at: dispatchedAt,
    acceptance,
  };
}

function lookupTaskInCollection(parsed, taskId) {
  if (!parsed || typeof parsed !== 'object') return null;
  const key = String(taskId || '').trim();
  if (!key) return null;

  if (Array.isArray(parsed)) {
    const hit = parsed.find((row) => row && typeof row === 'object' && (row.task_id === key || row.id === key));
    return hit ? normalizeTaskRecord(hit, key) : null;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] && typeof parsed[key] === 'object') {
    return normalizeTaskRecord(parsed[key], key);
  }

  if (parsed.tasks && typeof parsed.tasks === 'object') {
    return lookupTaskInCollection(parsed.tasks, key);
  }

  if ((parsed.task_id === key || parsed.id === key)) {
    return normalizeTaskRecord(parsed, key);
  }

  return null;
}

function validateMarkArgs(id, disposition, opts = {}) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw adapterError('mark requires a non-empty message id', 2, 'INVALID_ID');
  }
  if (!VALID_DISPOSITIONS.has(disposition)) {
    throw adapterError(`invalid disposition "${disposition}"`, 2, 'INVALID_DISPOSITION');
  }
  const ref = opts && typeof opts.ref === 'string' ? opts.ref.trim() : '';
  const reason = opts && typeof opts.reason === 'string' ? opts.reason.trim() : '';
  if (disposition === 'done' && !ref) {
    throw adapterError('disposition "done" requires a non-empty --ref <id>', 2, 'MISSING_REF');
  }
  if (disposition === 'no_action' && !reason) {
    throw adapterError('disposition "no_action" requires a non-empty --reason <text>', 2, 'MISSING_REASON');
  }
  return { id: id.trim(), ref, reason };
}

function parseCmdArgv(raw, varName, errorCode) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    throw adapterError(`${varName} must be a valid JSON string array: ${err.message}`, 2, errorCode);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((x) => typeof x === 'string' && x.length > 0)) {
    throw adapterError(`${varName} must be a non-empty JSON array of non-empty strings`, 2, errorCode);
  }
  return parsed;
}

function appendJsonLine(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function runTaskShowArgv(argv, taskId, env) {
  const res = spawnSync(argv[0], [...argv.slice(1), taskId], {
    env: cleanChildEnv(env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  if (res.error || res.status !== 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(res.stdout || ''));
  } catch {
    return null;
  }
  return normalizeTaskRecord(parsed, taskId);
}

function createFixtureAdapter(dir, member, env) {
  const rootDir = path.resolve(dir);
  const inboxPath = path.join(rootDir, 'inbox.json');
  const tasksPath = path.join(rootDir, 'tasks.json');
  const marksPath = path.join(rootDir, 'marks.jsonl');
  const wakesPath = path.join(rootDir, 'wakes.jsonl');
  const acceptsPath = path.join(rootDir, 'accepts.jsonl');
  const explicitEmptyAccept = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_PM_ACCEPT_CMD')
    && String(env.AUTOPILOT_PM_ACCEPT_CMD).trim() === '';
  const optionalAcceptArgv = (!explicitEmptyAccept && env.AUTOPILOT_PM_ACCEPT_CMD !== undefined)
    ? parseCmdArgv(env.AUTOPILOT_PM_ACCEPT_CMD, 'AUTOPILOT_PM_ACCEPT_CMD', 'INVALID_ACCEPT_CMD')
    : null;
  const explicitEmptyTaskShow = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_PM_TASK_SHOW_CMD')
    && String(env.AUTOPILOT_PM_TASK_SHOW_CMD).trim() === '';
  const optionalTaskShowArgv = (!explicitEmptyTaskShow && env.AUTOPILOT_PM_TASK_SHOW_CMD !== undefined)
    ? parseCmdArgv(env.AUTOPILOT_PM_TASK_SHOW_CMD, 'AUTOPILOT_PM_TASK_SHOW_CMD', 'INVALID_TASK_SHOW_CMD')
    : null;

  return {
    mode: `fixture:${rootDir}`, // fixture-literal-ok: documented adapter identifier
    member,
    canAccept() {
      return !explicitEmptyAccept;
    },
    canShowTask() {
      return !explicitEmptyTaskShow;
    },
    getTask(taskId) {
      if (typeof taskId !== 'string' || taskId.trim() === '') return null;
      const cleanId = taskId.trim();
      if (explicitEmptyTaskShow) return null;
      if (optionalTaskShowArgv) {
        return runTaskShowArgv(optionalTaskShowArgv, cleanId, env);
      }
      if (!fs.existsSync(tasksPath)) return null;
      let raw;
      try {
        raw = fs.readFileSync(tasksPath, 'utf8');
      } catch {
        return null;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw adapterError(`invalid JSON in ${tasksPath}: ${err.message}`, 2, 'TASKS_BAD_JSON');
      }
      return lookupTaskInCollection(parsed, cleanId);
    },
    listUnread() {
      let raw;
      try {
        raw = fs.readFileSync(inboxPath, 'utf8');
      } catch (err) {
        throw adapterError(`cannot read ${inboxPath}: ${err.message}`, 2, 'INBOX_UNREADABLE');
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw adapterError(`invalid JSON in ${inboxPath}: ${err.message}`, 2, 'INBOX_BAD_JSON');
      }
      const all = normalizeItemsPayload(parsed, inboxPath);
      return all.filter((item) => item && typeof item === 'object' && (!item.disposition || item.disposition === 'unread'));
    },
    mark(id, disposition, opts = {}) {
      const checked = validateMarkArgs(id, disposition, opts);
      const row = {
        at: new Date().toISOString(),
        member,
        id: checked.id,
        message_id: checked.id,
        disposition,
      };
      if (checked.ref) row.ref = checked.ref;
      if (checked.reason) row.reason = checked.reason;
      if (opts && typeof opts.rule === 'string' && opts.rule) row.rule = opts.rule;
      if (opts && Array.isArray(opts.failed_checks) && opts.failed_checks.length > 0) {
        row.failed_checks = opts.failed_checks;
      }
      appendJsonLine(marksPath, row);
      return row;
    },
    wake(packetPath) {
      if (typeof packetPath !== 'string' || packetPath.trim() === '') {
        throw adapterError('wake requires a packet file path', 2, 'INVALID_PACKET_PATH');
      }
      const resolved = path.resolve(packetPath);
      let content;
      try {
        content = fs.readFileSync(resolved, 'utf8');
      } catch (err) {
        throw adapterError(`cannot read packet file ${resolved}: ${err.message}`, 2, 'PACKET_UNREADABLE');
      }
      const row = {
        at: new Date().toISOString(),
        member,
        packet_file: resolved,
        content,
      };
      appendJsonLine(wakesPath, row);
      return row;
    },
    accept(taskId, note) {
      if (explicitEmptyAccept) {
        throw adapterError('accept command is unset', 1, 'ACCEPT_UNAVAILABLE');
      }
      if (typeof taskId !== 'string' || taskId.trim() === '') {
        throw adapterError('accept requires a non-empty task_id', 1, 'MISSING_TASK_ID');
      }
      if (optionalAcceptArgv) {
        const res = spawnSync(optionalAcceptArgv[0], [...optionalAcceptArgv.slice(1), taskId.trim()], {
          env: cleanChildEnv(env),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        });
        if (res.error || res.status !== 0) {
          const detail = (res.stderr && res.stderr.trim()) || (res.error && res.error.message) || `rc=${res.status}`;
          throw adapterError(`accept command failed for ${taskId}: ${detail}`, 1, 'ACCEPT_FAILED');
        }
      }
      const row = {
        at: new Date().toISOString(),
        member,
        task_id: taskId.trim(),
        note: typeof note === 'string' ? note : null,
      };
      appendJsonLine(acceptsPath, row);
      return row;
    },
  };
}

function createFleetAdapter(env, member) {
  const fleetRepo = typeof env.AUTOPILOT_FLEET_REPO === 'string' ? env.AUTOPILOT_FLEET_REPO.trim() : '';
  if (!fleetRepo) {
    throw adapterError('AUTOPILOT_FLEET_REPO is unset; set it to the fleet repo path to run in fleet mode', 2, 'FLEET_REPO_UNSET');
  }
  const cliPath = path.join(path.resolve(fleetRepo), FLEET_CLI_REL);
  const acceptArgv = parseCmdArgv(env.AUTOPILOT_PM_ACCEPT_CMD, 'AUTOPILOT_PM_ACCEPT_CMD', 'INVALID_ACCEPT_CMD');
  const taskShowArgv = parseCmdArgv(env.AUTOPILOT_PM_TASK_SHOW_CMD, 'AUTOPILOT_PM_TASK_SHOW_CMD', 'INVALID_TASK_SHOW_CMD');

  function runInboxCli(cliArgs) {
    if (!fs.existsSync(cliPath)) {
      throw adapterError(`fleet inbox CLI not found at ${cliPath}`, 2, 'FLEET_CLI_MISSING');
    }
    const res = spawnSync(process.execPath, ['--experimental-transform-types', cliPath, ...cliArgs], {
      env: cleanChildEnv(env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    if (res.error || res.status !== 0) {
      const detail = (res.stderr && res.stderr.trim()) || (res.error && res.error.message) || `rc=${res.status}`;
      const code = Number.isInteger(res.status) && res.status === 2 ? 2 : 1;
      throw adapterError(`inbox-cli ${cliArgs[0]} failed: ${detail}`, code, 'FLEET_CLI_FAILED');
    }
    return res.stdout || '';
  }

  return {
    mode: 'fleet',
    member,
    canAccept() {
      return acceptArgv !== null;
    },
    canShowTask() {
      return taskShowArgv !== null;
    },
    getTask(taskId) {
      if (!taskShowArgv) return null;
      if (typeof taskId !== 'string' || taskId.trim() === '') return null;
      return runTaskShowArgv(taskShowArgv, taskId.trim(), env);
    },
    listUnread() {
      const stdout = runInboxCli(['list', '--member', member, '--disposition', 'unread', '--json']);
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        throw adapterError(`inbox-cli list returned invalid JSON: ${err.message}`, 1, 'FLEET_BAD_JSON');
      }
      return normalizeItemsPayload(parsed, 'inbox-cli list');
    },
    mark(id, disposition, opts = {}) {
      const checked = validateMarkArgs(id, disposition, opts);
      const args = ['mark', '--member', member, '--id', checked.id, '--disposition', disposition];
      if (disposition === 'done') {
        args.push('--ref', checked.ref);
      } else if (disposition === 'no_action') {
        args.push('--reason', checked.reason);
      }
      runInboxCli(args);
      return { id: checked.id, disposition, ref: checked.ref || undefined, reason: checked.reason || undefined };
    },
    wake(packetPath) {
      if (typeof packetPath !== 'string' || packetPath.trim() === '') {
        throw adapterError('wake requires a packet file path', 2, 'INVALID_PACKET_PATH');
      }
      const resolved = path.resolve(packetPath);
      if (!fs.existsSync(resolved)) {
        throw adapterError(`packet file does not exist: ${resolved}`, 2, 'PACKET_UNREADABLE');
      }
      runInboxCli(['wake', '--member', member, '--packet-file', resolved]);
      return { packet_file: resolved };
    },
    accept(taskId) {
      if (!acceptArgv) {
        throw adapterError('AUTOPILOT_PM_ACCEPT_CMD is unset; accept is unavailable', 1, 'ACCEPT_UNAVAILABLE');
      }
      if (typeof taskId !== 'string' || taskId.trim() === '') {
        throw adapterError('accept requires a non-empty task_id', 1, 'MISSING_TASK_ID');
      }
      const res = spawnSync(acceptArgv[0], [...acceptArgv.slice(1), taskId.trim()], {
        env: cleanChildEnv(env),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });
      if (res.error || res.status !== 0) {
        const detail = (res.stderr && res.stderr.trim()) || (res.error && res.error.message) || `rc=${res.status}`;
        throw adapterError(`accept command failed for ${taskId}: ${detail}`, 1, 'ACCEPT_FAILED');
      }
      return { task_id: taskId.trim() };
    },
  };
}

function createAdapter(env = process.env) {
  const effectiveEnv = env || process.env;
  const rawSpec = typeof effectiveEnv.AUTOPILOT_PM_INBOX_ADAPTER === 'string'
    ? effectiveEnv.AUTOPILOT_PM_INBOX_ADAPTER.trim()
    : '';
  const spec = rawSpec || 'fleet';
  const rawMember = typeof effectiveEnv.AUTOPILOT_PM_INBOX_MEMBER === 'string'
    ? effectiveEnv.AUTOPILOT_PM_INBOX_MEMBER.trim()
    : '';
  const member = rawMember || DEFAULT_MEMBER;

  if (spec === 'fleet') {
    return createFleetAdapter(effectiveEnv, member);
  }
  if (spec.startsWith('fixture:')) { // fixture-literal-ok: documented AUTOPILOT_PM_INBOX_ADAPTER=fixture:<dir> mode
    const dir = spec.slice('fixture:'.length).trim(); // fixture-literal-ok: documented adapter prefix
    if (!dir) {
      throw adapterError('AUTOPILOT_PM_INBOX_ADAPTER="fixture:<dir>" requires a non-empty directory path', 2, 'INVALID_ADAPTER');
    }
    return createFixtureAdapter(dir, member, effectiveEnv);
  }
  throw adapterError(
    `unsupported AUTOPILOT_PM_INBOX_ADAPTER "${spec}" (expected "fleet" or "fixture:<dir>")`, // fixture-literal-ok: error hint
    2,
    'INVALID_ADAPTER',
  );
}

function listUnread(env = process.env) {
  return createAdapter(env).listUnread();
}

function mark(id, disposition, opts = {}, env = process.env) {
  return createAdapter(env).mark(id, disposition, opts);
}

function wake(packetPath, env = process.env) {
  return createAdapter(env).wake(packetPath);
}

function accept(taskId, note, env = process.env) {
  return createAdapter(env).accept(taskId, note);
}

function getTask(taskId, env = process.env) {
  return createAdapter(env).getTask(taskId);
}

module.exports = {
  DEFAULT_MEMBER,
  FLEET_CLI_REL,
  createAdapter,
  listUnread,
  mark,
  wake,
  accept,
  getTask,
};
