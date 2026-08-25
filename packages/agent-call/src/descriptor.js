'use strict';

const path = require('path');
const { AgentCallError } = require('./errors');
const { validateName, validateHarness } = require('./names');

const DESCRIPTOR_SCHEMA = 'agent-call.session.v1';
const INGRESS_KINDS = new Set(['tmux', 'claude-channel']);
const TMUX_TARGET_RE = /^[A-Za-z0-9_.:%-]{1,128}$/;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCallError('invalid_descriptor', `${label} must be an object`);
  }
}

function assertClosedObject(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new AgentCallError('invalid_descriptor', `${label} contains unknown field: ${key}`);
    }
  }
}

function validateCapabilities(value) {
  assertObject(value, 'capabilities');
  assertClosedObject(value, new Set(['context_injection', 'wake_idle', 'console_read']), 'capabilities');
  for (const key of ['context_injection', 'wake_idle', 'console_read']) {
    if (typeof value[key] !== 'boolean') {
      throw new AgentCallError('invalid_descriptor', `capabilities.${key} must be boolean`);
    }
  }
  return { ...value };
}

function validateIngress(value) {
  assertObject(value, 'ingress');
  if (!INGRESS_KINDS.has(value.kind)) {
    throw new AgentCallError('unsupported_ingress', `unsupported ingress kind: ${String(value.kind)}`);
  }
  if (value.kind === 'tmux') {
    assertClosedObject(value, new Set(['kind', 'pane']), 'ingress');
    if (typeof value.pane !== 'string' || !TMUX_TARGET_RE.test(value.pane)) {
      throw new AgentCallError('invalid_descriptor', 'tmux ingress pane is invalid');
    }
    return { kind: 'tmux', pane: value.pane };
  }
  assertClosedObject(value, new Set(['kind', 'socket', 'token_path']), 'ingress');
  if (typeof value.socket !== 'string' || !path.isAbsolute(value.socket) || value.socket.includes('\0')) {
    throw new AgentCallError('invalid_descriptor', 'claude-channel ingress socket must be an absolute path');
  }
  if (typeof value.token_path !== 'string' || !path.isAbsolute(value.token_path) || value.token_path.includes('\0')) {
    throw new AgentCallError('invalid_descriptor', 'claude-channel token_path must be an absolute path');
  }
  return { kind: 'claude-channel', socket: value.socket, token_path: value.token_path };
}

function validateDescriptor(value) {
  assertObject(value, 'descriptor');
  assertClosedObject(
    value,
    new Set(['schema', 'name', 'harness', 'pid', 'cwd', 'registered_at', 'ingress', 'capabilities']),
    'descriptor',
  );
  if (value.schema !== DESCRIPTOR_SCHEMA) {
    throw new AgentCallError('invalid_descriptor', `descriptor schema must be ${DESCRIPTOR_SCHEMA}`);
  }
  const name = validateName(value.name);
  const harness = validateHarness(value.harness);
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new AgentCallError('invalid_descriptor', 'descriptor pid must be a positive safe integer');
  }
  if (typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd) || value.cwd.includes('\0')) {
    throw new AgentCallError('invalid_descriptor', 'descriptor cwd must be an absolute path');
  }
  if (typeof value.registered_at !== 'string' || Number.isNaN(Date.parse(value.registered_at))) {
    throw new AgentCallError('invalid_descriptor', 'descriptor registered_at must be an ISO timestamp');
  }
  return {
    schema: DESCRIPTOR_SCHEMA,
    name,
    harness,
    pid: value.pid,
    cwd: path.normalize(value.cwd),
    registered_at: new Date(value.registered_at).toISOString(),
    ingress: validateIngress(value.ingress),
    capabilities: validateCapabilities(value.capabilities),
  };
}

function makeDescriptor({ name, harness, pid, cwd, ingress, capabilities, now = new Date() }) {
  return validateDescriptor({
    schema: DESCRIPTOR_SCHEMA,
    name,
    harness,
    pid,
    cwd,
    registered_at: now.toISOString(),
    ingress,
    capabilities,
  });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

module.exports = { DESCRIPTOR_SCHEMA, TMUX_TARGET_RE, validateDescriptor, makeDescriptor, isPidAlive };
