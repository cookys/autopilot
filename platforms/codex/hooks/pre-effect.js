#!/usr/bin/env node
'use strict';

// Codex-native PreToolUse adapter. Codex 0.146.0 live evidence proves that a
// structured stdout decision blocks the current tool call. It also proves that
// a command adapter which exits nonzero can fail open; this wrapper therefore
// converts every validation/error path it can observe into the same structured
// denial. A host/process failure before stdout remains a documented limitation.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_MARKER_FILES = 128;
const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const EFFECT_CAPABLE_TOOLS = new Set([
  'bash',
  'edit',
  'exec_command',
  'apply_patch',
  'notebookedit',
  'shell',
  'shell_command',
  'write',
]);

function pluginRoot() {
  return path.resolve(process.env.PLUGIN_ROOT || path.join(__dirname, '..'));
}

function support() {
  const root = pluginRoot();
  const decision = require(path.join(root, 'hooks', 'orchestrator-edit-gate-lib.js'));
  const sessionMode = require(path.join(root, 'scripts', 'session-mode.js'));
  return { root, decision, sessionMode };
}

function normalizedToolName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().split(/[.:/]/u).filter(Boolean).pop().toLowerCase();
}

function commandFrom(payload) {
  const input = payload && payload.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  if (typeof input.cmd === 'string') return input.cmd.trim();
  if (typeof input.command === 'string') return input.command.trim();
  return '';
}

function quoteVariants(value) {
  const raw = String(value);
  const variants = new Set([JSON.stringify(raw)]);
  if (!raw.includes("'")) variants.add(`'${raw}'`);
  if (!/[\s;&|<>`$\\]/u.test(raw)) variants.add(raw);
  return [...variants];
}

function stripSafeSessionAssignment(command) {
  return command.replace(/^AUTOPILOT_SESSION_ID=[A-Za-z0-9_-]{1,64}\s+/u, '');
}

function isLifecycleEntry(command, root, repoRoot) {
  let rest = stripSafeSessionAssignment(command);
  if (/[\n\r;&|<>`$]/u.test(rest)) return false;
  const scripts = quoteVariants(path.join(root, 'scripts', 'session-mode.js'));
  const repos = quoteVariants(repoRoot);
  for (const script of scripts) {
    for (const repo of repos) {
      for (const level of LEVELS) {
        for (const entry of LEVELS) {
          const base = `node ${script} set --level ${level} --entry-level ${entry} --repo-root ${repo}`;
          if (rest === base) return true;
          for (const fallback of ['none', 'solo', 'precondition_failed']) {
            if (rest === `${base} --fallback ${fallback}`) return true;
          }
        }
      }
    }
  }
  return false;
}

function isManagedEngineEntry(command, root) {
  let rest = command;
  const session = rest.match(/^AUTOPILOT_SESSION_ID=([A-Za-z0-9_-]{1,64})\s+/u);
  if (!session) return false;
  rest = rest.slice(session[0].length);
  const level = rest.match(/^AUTOPILOT_LEVEL=(l4|l5|l6)\s+/u);
  if (!level) return false;
  rest = rest.slice(level[0].length);
  if (/[\n\r;&|<>`$]/u.test(rest)) return false;
  if (!/^[A-Za-z0-9_./:=,@+\s'"-]+$/u.test(rest)) return false;
  return quoteVariants(path.join(root, 'bin', 'autopilot.js')).some((script) => (
    rest === `node ${script} engine implement-review`
    || rest.startsWith(`node ${script} engine implement-review `)
  ));
}

function gitRoot(cwd) {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
  return result.status === 0 && result.stdout.trim()
    ? path.resolve(result.stdout.trim()) : null;
}

function markerDirectory() {
  return path.resolve(process.env.AUTOPILOT_SESSION_MODE_DIR
    || path.join(os.homedir(), '.autopilot', 'session-mode'));
}

function readCurrentMissionProjection(root, sessionMode) {
  const governance = path.join(root, '.claude', 'owner-kernel-governance.json');
  const configFile = path.join(root, '.claude', 'mission-routing-config.json');
  if (!fs.existsSync(governance) || !fs.existsSync(configFile)) return null;
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config || typeof config.graph_path !== 'string' || typeof config.sources_path !== 'string') {
    throw new Error('Mission routing config is invalid');
  }
  const { inspect } = require(path.join(pluginRoot(), 'scripts', 'mission-execution-graph-check.js'));
  const projection = inspect({
    graph: path.resolve(root, config.graph_path),
    governance,
    sources: path.resolve(root, config.sources_path),
  });
  const repoIdentity = sessionMode.markerRepoIdentity(root);
  if (!repoIdentity) throw new Error('Mission repository identity is unavailable');
  return {
    repo_identity: repoIdentity,
    mission_policy_digest: projection.policy_digest,
    mission_graph_digest: projection.graph_digest,
  };
}

function validateMarker(marker, repoRoot, sessionMode, now) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
      || !LEVELS.has(marker.level)
      || typeof marker.repo_root !== 'string' || !path.isAbsolute(marker.repo_root)) {
    return { valid: false, status: 'malformed', reason: 'session marker identity is malformed' };
  }
  const repoIdentity = sessionMode.markerRepoIdentity(repoRoot);
  const markerIdentity = sessionMode.markerRepoIdentity(marker.repo_root);
  if (!repoIdentity || !markerIdentity || repoIdentity !== markerIdentity) {
    return { valid: false, status: 'wrong_repository', reason: 'session marker repository mismatch' };
  }
  const started = Date.parse(marker.started_at);
  const expires = Date.parse(marker.expires_at);
  if (!Number.isFinite(started) || !Number.isFinite(expires) || started > now) {
    return { valid: false, status: 'malformed', reason: 'session marker timestamps are malformed' };
  }
  if (expires <= now) {
    return { valid: false, status: 'expired', reason: 'session marker expired' };
  }
  const currentProjection = readCurrentMissionProjection(repoRoot, sessionMode);
  if (currentProjection) {
    const verified = sessionMode.verifyMissionRoutingProjection(marker, currentProjection);
    if (!verified.valid) {
      return {
        valid: false,
        status: 'mission_mismatch',
        reason: `session marker Mission projection mismatch: ${verified.reason}`,
      };
    }
  } else if (Object.prototype.hasOwnProperty.call(marker, 'mission_routing')) {
    const admission = marker.mission_routing && marker.mission_routing.admission;
    const expected = admission && {
      repo_identity: sessionMode.markerRepoIdentity(repoRoot),
      mission_policy_digest: admission.mission_policy_digest,
      mission_graph_digest: admission.mission_graph_digest,
    };
    const verified = sessionMode.verifyMissionRoutingProjection(marker, expected);
    if (!verified.valid) {
      return { valid: false, status: 'mission_mismatch', reason: verified.reason };
    }
  }
  return { valid: true, status: 'valid', reason: null, marker };
}

function findMarker(repoRoot, sessionMode) {
  const directory = markerDirectory();
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'absent', reason: 'session marker absent', marker: null };
    }
    return { status: 'malformed', reason: `session marker directory unreadable: ${error.message}`, marker: null };
  }
  if (entries.length > MAX_MARKER_FILES) {
    return { status: 'ambiguous', reason: 'session marker namespace exceeds the bounded scan', marker: null };
  }
  const matching = [];
  let malformed = null;
  const targetIdentity = sessionMode.markerRepoIdentity(repoRoot);
  for (const entry of entries) {
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
    } catch (error) {
      malformed = `session marker malformed: ${error.message}`;
      continue;
    }
    if (!marker || typeof marker.repo_root !== 'string') {
      malformed = 'session marker identity is malformed';
      continue;
    }
    if (sessionMode.markerRepoIdentity(marker.repo_root) === targetIdentity) matching.push(marker);
  }
  if (matching.length > 1) {
    return { status: 'ambiguous', reason: 'multiple session markers match this Git common-dir', marker: null };
  }
  if (matching.length === 0) {
    return {
      status: malformed ? 'malformed' : 'absent',
      reason: malformed || 'session marker absent or belongs to another repository',
      marker: null,
    };
  }
  const result = validateMarker(matching[0], repoRoot, sessionMode, Date.now());
  return result.valid
    ? { status: 'valid', reason: null, marker: matching[0] }
    : { status: result.status, reason: result.reason, marker: null };
}

function appendTestLog(row) {
  const target = process.env.AUTOPILOT_CODEX_PRE_EFFECT_TEST_LOG;
  if (!target) return;
  fs.appendFileSync(target, `${JSON.stringify(row)}\n`, { mode: 0o600 });
}

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

(function main() {
  let logRow = { event: 'PreToolUse', decision: 'block', reason_code: 'DEV_FLOW_ENTRY_REQUIRED' };
  try {
    const bytes = fs.readFileSync(0);
    if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('hook payload exceeds 1 MiB');
    const payload = JSON.parse(bytes.toString('utf8'));
    if (!payload || payload.hook_event_name !== 'PreToolUse'
        || typeof payload.cwd !== 'string' || !path.isAbsolute(payload.cwd)
        || typeof payload.tool_name !== 'string'
        || typeof payload.session_id !== 'string' || payload.session_id.length === 0
        || !payload.tool_input || typeof payload.tool_input !== 'object'
        || Array.isArray(payload.tool_input)) {
      throw new Error('PreToolUse payload identity is invalid');
    }
    const repoRoot = gitRoot(payload.cwd);
    const toolName = normalizedToolName(payload.tool_name);
    logRow = { ...logRow, tool_name: toolName || 'invalid' };
    if (!repoRoot) {
      logRow = { ...logRow, decision: 'allow', reason_code: null, marker_status: 'not_applicable' };
      appendTestLog(logRow);
      return;
    }
    const { root, decision, sessionMode } = support();
    const command = commandFrom(payload);
    const effectCapable = EFFECT_CAPABLE_TOOLS.has(toolName);
    if (!effectCapable) {
      logRow = { ...logRow, decision: 'allow', reason_code: null, marker_status: 'not_applicable' };
      appendTestLog(logRow);
      return;
    }
    const lifecycleEntry = isLifecycleEntry(command, root, repoRoot);
    if (lifecycleEntry) {
      logRow = { ...logRow, decision: 'allow', reason_code: null, marker_status: 'lifecycle_entry' };
      appendTestLog(logRow);
      return;
    }
    const marker = findMarker(repoRoot, sessionMode);
    const policy = decision.decideCodexPreEffect({
      inRepository: true,
      effectCapable,
      lifecycleEntry: false,
      managedEngineEntry: isManagedEngineEntry(command, root),
      markerStatus: marker.status,
      markerReason: marker.reason,
      markerLevel: marker.marker && marker.marker.level,
    });
    logRow = {
      ...logRow,
      decision: policy.action === 'gate' ? 'block' : 'allow',
      reason_code: policy.reasonCode,
      marker_status: marker.status,
      marker_level: marker.marker ? marker.marker.level : null,
    };
    appendTestLog(logRow);
    if (policy.action === 'gate') emitBlock(policy.reason);
  } catch (error) {
    logRow = { ...logRow, error: true };
    try { appendTestLog(logRow); } catch { /* structured denial still wins */ }
    emitBlock(`DEV_FLOW_ENTRY_REQUIRED: pre-effect adapter validation failed (${error.message})`);
  }
})();
