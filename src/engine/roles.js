'use strict';

// EXECUTION roles (byte-unchanged, plan 2026-08-28-consult-discuss-qualification.md
// §2.6 "Role-namespace decision"). These back effect permissions
// (owner-kernel/task-authority.js) and role-execution grants
// (execution-profile.js). Neither `consult` nor `discuss` may ever appear here —
// widening this set would leak both into execution authority.
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

// CAPABILITY roles: the qualification-evidence namespace. This is
// `ROLE_IDS` PLUS the two qualification-seat-only roles `consult` and
// `discuss` (plan §2.6) — roster/advice seats that never carry execution
// authority. `capability-evidence.js`, `engine-scorecard.js` and
// `adopt-qualification-defaults.js` validate against this set;
// `resolve-scaffold-tier.js`, task-authority and execution-profile stay on
// `ROLE_IDS` / `normalizeRole` above.
const CAPABILITY_ROLE_IDS = Object.freeze([...ROLE_IDS, 'consult', 'discuss']);
const CAPABILITY_ROLE_SET = new Set(CAPABILITY_ROLE_IDS);
const CAPABILITY_ROLES = Object.freeze({
  has(value) {
    return CAPABILITY_ROLE_SET.has(value);
  },
  [Symbol.iterator]() {
    return CAPABILITY_ROLE_IDS[Symbol.iterator]();
  },
});

function normalizeCapabilityRole(value, { allowLegacy = false } = {}) {
  if (CAPABILITY_ROLE_SET.has(value)) return value;
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
  CAPABILITY_ROLE_IDS,
  CAPABILITY_ROLES,
  normalizeCapabilityRole,
});
