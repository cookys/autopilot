'use strict';

const ROLE_IDS = Object.freeze([
  'owner',
  'implementer',
  'reviewer',
  'verification_author',
  'explorer',
]);
const ROLE_SET = new Set(ROLE_IDS);
const ROLES = Object.freeze({
  has(value) {
    return ROLE_SET.has(value);
  },
  [Symbol.iterator]() {
    return ROLE_IDS[Symbol.iterator]();
  },
});
const LEGACY_ROLE_ALIASES = Object.freeze({
  orchestrator: 'owner',
  planner: 'owner',
  verifier: 'reviewer',
});

function normalizeRole(value, { allowLegacy = false } = {}) {
  if (ROLE_SET.has(value)) return value;
  if (allowLegacy && Object.hasOwn(LEGACY_ROLE_ALIASES, value)) {
    return LEGACY_ROLE_ALIASES[value];
  }
  return null;
}

module.exports = Object.freeze({
  LEGACY_ROLE_ALIASES,
  ROLE_IDS,
  ROLES,
  normalizeRole,
});
