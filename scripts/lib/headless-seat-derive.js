'use strict';

// Headless --seat-file fill for fields the seat schema does not carry.
// A flag already on `explicit` always wins. Failures throw { field, reason }
// and the caller exits 2 before any exam write. No fallback to "unknown".

const fs = require('fs');
const path = require('path');

const { resolveRunnerVersion } = require('./runner-binary');
const { familyOfEngine } = require('./stage-write');

const PINS_NAME = 'qualification-headless-pins.json';
const TOP_KEYS = new Set(['note', 'roles']);
const ROLE_KEYS = [
  'task_class',
  'domain',
  'language',
  'tool',
  'harness_version',
  'containment_fingerprint',
];
const SCOPE_KEYS = ['task_class', 'domain', 'language', 'tool'];

function fail(field, reason) {
  const error = new Error(reason);
  error.field = field;
  error.reason = reason;
  throw error;
}

function pinsPath(repoRoot) {
  return path.join(repoRoot, 'references', PINS_NAME);
}

function failPins(file, reason) {
  fail(path.basename(file), `${file}: ${reason}`);
}

function loadPins(repoRoot) {
  const file = pinsPath(repoRoot);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    failPins(file, `missing or unreadable: ${error.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    failPins(file, `not JSON: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    failPins(file, 'malformed: expected an object');
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_KEYS.has(key)) {
      failPins(file, `unknown key ${key}`);
    }
  }
  if (typeof doc.note !== 'string' || doc.note.length === 0) {
    failPins(file, 'missing note');
  }
  if (!doc.roles || typeof doc.roles !== 'object' || Array.isArray(doc.roles)) {
    failPins(file, 'missing roles');
  }
  for (const [role, body] of Object.entries(doc.roles)) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      failPins(file, `role ${role} is malformed`);
    }
    for (const key of Object.keys(body)) {
      if (!ROLE_KEYS.includes(key)) {
        failPins(file, `role ${role} has unknown key ${key}`);
      }
    }
    for (const key of ROLE_KEYS) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        fail(key.replace(/_/g, '-'), `pins file role ${role} missing ${key}`);
      }
    }
    for (const key of SCOPE_KEYS) {
      if (!Array.isArray(body[key]) || body[key].length === 0
          || body[key].some((item) => typeof item !== 'string' || item.length === 0)) {
        fail(key.replace(/_/g, '-'), `pins file role ${role} ${key} must be a non-empty string array`);
      }
    }
  }
  return doc;
}

function onlyImplementer(field) {
  fail(
    field,
    `--${field} headless derivation is only pinned for the implementer role (pass the flags explicitly)`,
  );
}

const SCOPE_FLAGS = [
  ['taskClasses', 'task-class'],
  ['domains', 'domain'],
  ['languages', 'language'],
  ['tools', 'tool'],
];

function firstMissingScopeFlag(options, explicit) {
  for (const [prop, flag] of SCOPE_FLAGS) {
    if (!explicit.has(prop) || !options[prop] || options[prop].length === 0) return flag;
  }
  if (!explicit.has('harnessVersion')) return 'harness-version';
  if (!explicit.has('containmentFingerprint')) return 'containment-fingerprint';
  if (!explicit.has('semanticFingerprint')) return 'semantic-fingerprint';
  return 'task-class';
}

/**
 * Fill identity fields that were not supplied by a flag.
 * `explicit` is a Set of option property names set from argv.
 * `semanticFingerprint` is EXPECTED_IMPL_CORPUS_HASH (not re-stated here).
 * Writes options.headlessSources (kebab-case flag name -> flag|seat|derived|pinned).
 */
function deriveHeadlessSeat(options, explicit, { repoRoot, semanticFingerprint }) {
  const sources = {};
  const fromSeat = [
    ['engine', 'engine'],
    ['model', 'model'],
    ['modelVersion', 'model-version'],
    ['runner', 'runner'],
    ['effort', 'effort'],
    ['promptConfigHash', 'prompt-config-hash'],
  ];
  for (const [prop, flag] of fromSeat) {
    sources[flag] = explicit.has(prop) ? 'flag' : 'seat';
  }

  if (!explicit.has('runnerVersion')) {
    const resolved = resolveRunnerVersion(options.runner);
    if (!resolved || resolved.ok !== true || !resolved.token) {
      const reason = resolved && resolved.reason ? resolved.reason : 'resolver_failed';
      fail('runner-version', `--runner-version could not be derived: ${reason}`);
    }
    options.runnerVersion = resolved.token;
    sources['runner-version'] = 'derived';
  } else {
    sources['runner-version'] = 'flag';
  }

  if (!explicit.has('family')) {
    const family = familyOfEngine(options.model);
    if (!family || family === 'unknown') {
      fail('family', `--family is unknown for model ${options.model}; pass --family`);
    }
    options.family = family;
    sources.family = 'derived';
  } else {
    sources.family = 'flag';
  }

  const needPin = [
    ['harnessVersion', 'harness-version'],
    ['containmentFingerprint', 'containment-fingerprint'],
    ['semanticFingerprint', 'semantic-fingerprint'],
  ];
  const needScope = [
    ['taskClasses', 'task-class', 'task_class'],
    ['domains', 'domain', 'domain'],
    ['languages', 'language', 'language'],
    ['tools', 'tool', 'tool'],
  ];
  const missingPin = needPin.some(([prop]) => !explicit.has(prop))
    || needScope.some(([prop]) => !explicit.has(prop) || options[prop].length === 0);

  let pins = null;
  if (missingPin) {
    if (options.role !== 'implementer') onlyImplementer(firstMissingScopeFlag(options, explicit));
    pins = loadPins(repoRoot);
    if (!pins.roles.implementer) onlyImplementer(firstMissingScopeFlag(options, explicit));
  }
  const rolePins = pins ? pins.roles.implementer : null;

  if (!explicit.has('harnessVersion')) {
    options.harnessVersion = rolePins.harness_version;
    sources['harness-version'] = 'pinned';
  } else {
    sources['harness-version'] = 'flag';
  }
  if (!explicit.has('containmentFingerprint')) {
    options.containmentFingerprint = rolePins.containment_fingerprint;
    sources['containment-fingerprint'] = 'pinned';
  } else {
    sources['containment-fingerprint'] = 'flag';
  }
  if (!explicit.has('semanticFingerprint')) {
    if (typeof semanticFingerprint !== 'string' || semanticFingerprint.length === 0) {
      fail('semantic-fingerprint', '--semantic-fingerprint could not be derived: implementer constant missing');
    }
    options.semanticFingerprint = semanticFingerprint;
    sources['semantic-fingerprint'] = 'derived';
  } else {
    sources['semantic-fingerprint'] = 'flag';
  }

  const scopeFill = [
    ['taskClasses', 'task-class', 'task_class'],
    ['domains', 'domain', 'domain'],
    ['languages', 'language', 'language'],
    ['tools', 'tool', 'tool'],
  ];
  for (const [prop, flag, pinKey] of scopeFill) {
    if (explicit.has(prop) && options[prop].length > 0) {
      sources[flag] = 'flag';
    } else {
      options[prop] = rolePins[pinKey].slice();
      sources[flag] = 'pinned';
    }
  }

  options.headlessSources = sources;
  return options;
}

module.exports = {
  deriveHeadlessSeat,
  loadPins,
  pinsPath,
};
