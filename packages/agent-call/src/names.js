'use strict';

const { AgentCallError } = require('./errors');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HARNESS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function validateName(value, label = 'agent name') {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new AgentCallError(
      'invalid_name',
      `${label} must match ${NAME_RE} and be at most 64 characters`,
      { exitCode: 2 },
    );
  }
  return value;
}

function validateHarness(value) {
  if (typeof value !== 'string' || !HARNESS_RE.test(value)) {
    throw new AgentCallError(
      'invalid_harness',
      `harness must match ${HARNESS_RE} and be at most 32 characters`,
      { exitCode: 2 },
    );
  }
  return value;
}

module.exports = { NAME_RE, HARNESS_RE, validateName, validateHarness };
