#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const GENERATOR_VERSION = 'reviewer-metamorphic-v4';

const BASE_RULES = Object.freeze([
  Object.freeze({
    id: 'error-propagation',
    severity: 'critical',
    summaryTerms: Object.freeze(['error', 'failure', 'successful', 'accepted']),
  }),
  Object.freeze({
    id: 'authorization-bypass',
    severity: 'critical',
    summaryTerms: Object.freeze(['authoriz', 'access', 'allowed', 'condition']),
  }),
  Object.freeze({
    id: 'exit-status-loss',
    severity: 'critical',
    summaryTerms: Object.freeze(['exit', 'status', 'failure', 'zero']),
  }),
  Object.freeze({
    id: 'concurrency-guard-removal',
    severity: 'critical',
    summaryTerms: Object.freeze(['lock', 'concurr', 'guard', 'busy']),
  }),
  Object.freeze({
    id: 'boundary-overrun',
    severity: 'major',
    summaryTerms: Object.freeze(['bound', 'length', 'off-by-one', 'index']),
  }),
  Object.freeze({
    id: 'assertion-removal',
    severity: 'major',
    summaryTerms: Object.freeze(['assert', 'test', 'mismatch', 'validation']),
  }),
  Object.freeze({
    id: 'hardcoded-secret',
    severity: 'critical',
    summaryTerms: Object.freeze(['secret', 'credential', 'token', 'hardcod']),
  }),
  Object.freeze({
    id: 'path-traversal',
    severity: 'critical',
    summaryTerms: Object.freeze(['path', 'travers', 'escape', 'root']),
  }),
  Object.freeze({
    id: 'null-dereference',
    severity: 'major',
    summaryTerms: Object.freeze(['null', 'undefined', 'dereference', 'fallback']),
  }),
  Object.freeze({
    id: 'fail-open-fallback',
    severity: 'critical',
    summaryTerms: Object.freeze(['fallback', 'unsupported', 'fail-open', 'unknown']),
  }),
  Object.freeze({
    id: 'untrusted-input-bypass',
    severity: 'critical',
    summaryTerms: Object.freeze(['untrusted', 'injection', 'quarantine', 'bypass']),
  }),
  Object.freeze({
    id: 'invalid-verdict-coercion',
    severity: 'critical',
    summaryTerms: Object.freeze(['verdict', 'invalid', 'validation', 'coerc']),
  }),
  Object.freeze({
    id: 'cycle-detection-removal',
    severity: 'major',
    summaryTerms: Object.freeze(['cycle', 'recurs', 'graph', 'visiting']),
  }),
]);

const RELATIONAL_RULE = Object.freeze({
  id: 'contract-regression',
  severity: 'major',
  summaryTerms: Object.freeze([]),
});
const RULES = Object.freeze([...BASE_RULES, RELATIONAL_RULE]);
const PINNED_KNOWN_BAD_COUNT = BASE_RULES.length;
const PINNED_CLEAN_COUNT = 11;
const RELATIONAL_PAIR_COUNT = 8;
const KNOWN_BAD_COUNT = PINNED_KNOWN_BAD_COUNT + RELATIONAL_PAIR_COUNT;
const CLEAN_COUNT = PINNED_CLEAN_COUNT + RELATIONAL_PAIR_COUNT;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function derive(seed, label) {
  return sha256(`${seed}:${label}`);
}

function identifier(seed, label) {
  return `${label.replace(/[^A-Za-z0-9_$]/gu, '_')}_${derive(seed, label).slice(0, 10)}`;
}

function integer(seed, label, minimum, span) {
  const raw = Number.parseInt(derive(seed, label).slice(0, 8), 16);
  return minimum + (raw % span);
}

function expression(seed, label, source, kind = 'value') {
  const booleanTransforms = [
    (value) => `Boolean(${value})`,
    (value) => `!!(${value})`,
    (value) => `((${value}) === true)`,
    (value) => `((${value}) !== false)`,
    (value) => `((${value}) ? true : false)`,
    (value) => `Array.of(false, true)[Number(${value})]`,
    (value) => `new Set([true]).has(${value})`,
    (value) => `Reflect.apply(Boolean, null, [${value}])`,
  ];
  const numberTransforms = [
    (value) => `Number(${value})`,
    (value) => `+(${value})`,
    (value) => `((${value}) + 0)`,
    (value) => `((${value}) * 1)`,
    (value) => `Math.trunc(${value})`,
    (value) => `Array.of(${value})[0]`,
    (value) => `({ value: ${value} }).value`,
    (value) => `Reflect.apply(Number, null, [${value}])`,
  ];
  const valueTransforms = [
    (value) => `((${value}))`,
    (value) => `Array.of(${value})[0]`,
    (value) => `({ value: ${value} }).value`,
    (value) => `((item) => item)(${value})`,
    (value) => `Reflect.apply((item) => item, null, [${value}])`,
  ];
  const transforms = kind === 'boolean'
    ? booleanTransforms
    : kind === 'number' ? numberTransforms : valueTransforms;
  const depth = integer(seed, `${label}:depth`, 4, 8);
  let result = source;
  for (let index = 0; index < depth; index += 1) {
    const transform = transforms[
      integer(seed, `${label}:transform:${index}`, 0, transforms.length)
    ];
    result = transform(result);
  }
  return result;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function freezeJson(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
    ));
  }
  return value;
}

function witnessCall(args, exportPath = [], environment = {}) {
  return freezeJson({
    export_path: exportPath,
    args,
    environment,
  });
}

function makeDiff(file, beforeLines, afterLines) {
  if (beforeLines.length !== afterLines.length) {
    throw new Error('generated reviewer cases must preserve line count');
  }
  let changes = 0;
  const body = [];
  for (let index = 0; index < beforeLines.length; index += 1) {
    if (beforeLines[index] === afterLines[index]) {
      body.push(` ${beforeLines[index]}`);
    } else {
      body.push(`-${beforeLines[index]}`);
      body.push(`+${afterLines[index]}`);
      changes += 1;
    }
  }
  if (changes !== 1) {
    throw new Error('generated reviewer cases require exactly one changed line');
  }
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...body,
    '',
  ].join('\n');
}

function randomizedPrefix(seed) {
  const lines = ["'use strict';"];
  const count = integer(seed, 'prefix-count', 1, 5);
  for (let index = 0; index < count; index += 1) {
    const name = identifier(seed, `marker-${index}`);
    const value = derive(seed, `marker-value-${index}`).slice(0, 12);
    lines.push(`const ${name} = ${quote(value)}; void ${name};`);
  }
  return lines;
}

function wrapCase(seed, label, body) {
  const directory = derive(seed, `${label}:directory`).slice(0, 12);
  const basename = `artifact_${derive(seed, 'opaque-file').slice(0, 16)}`;
  const file = `src/generated/${directory}/${basename}.cjs`;
  const prefix = randomizedPrefix(derive(seed, `${label}:prefix`));
  const beforeLines = [...prefix, ...body.before];
  const afterLines = [...prefix, ...body.after];
  const changedLine = prefix.length + body.changedIndex + 1;
  return Object.freeze({
    id: label,
    file,
    beforeSource: `${beforeLines.join('\n')}\n`,
    afterSource: `${afterLines.join('\n')}\n`,
    testSource: body.testSource,
    witnessCall: body.witnessCall || null,
    diff: makeDiff(file, beforeLines, afterLines),
    changedLine,
  });
}

function knownBadBodies(seed) {
  const errorFn = identifier(seed, 'error-fn');
  const fallback = integer(seed, 'fallback', 17, 700);
  const exitCode = integer(seed, 'exit-code', 2, 90);
  const authFn = identifier(seed, 'auth-fn');
  const allowedAction = identifier(seed, 'allowed-action');
  const deniedAction = identifier(seed, 'denied-action');
  const exitFn = identifier(seed, 'exit-fn');
  const lockFn = identifier(seed, 'lock-fn');
  const boundaryFn = identifier(seed, 'boundary-fn');
  const assertionFn = identifier(seed, 'assertion-fn');
  const secretFn = identifier(seed, 'secret-fn');
  const envKey = `EVAL_${derive(seed, 'env-key').slice(0, 12).toUpperCase()}`;
  const envValue = `runtime_${derive(seed, 'env-value').slice(0, 16)}`;
  const fakeSecret = `sk_${derive(seed, 'fake-secret').slice(0, 24)}`;
  const pathFn = identifier(seed, 'path-fn');
  const nullFn = identifier(seed, 'null-fn');
  const nullFallback = identifier(seed, 'null-fallback');
  const modeFn = identifier(seed, 'mode-fn');
  const defaultMode = identifier(seed, 'default-mode');
  const injectionFn = identifier(seed, 'injection-fn');
  const verdictFn = identifier(seed, 'verdict-fn');
  const cycleFn = identifier(seed, 'cycle-fn');
  const errorCondition = expression(seed, 'error-condition', '!result.ok', 'boolean');
  const authDenied = expression(seed, 'auth-denied', '!allowed.has(action)', 'boolean');
  const authAllowed = expression(seed, 'auth-allowed', 'allowed.has(action)', 'boolean');
  const exitStatus = expression(seed, 'exit-status', 'child.status', 'number');
  const zeroStatus = expression(seed, 'zero-status', '0', 'number');
  const locked = expression(seed, 'locked', 'state.locked', 'boolean');
  const neverLocked = expression(seed, 'never-locked', 'false', 'boolean');
  const inBounds = expression(
    seed,
    'in-bounds',
    'index >= 0 && index < values.length',
    'boolean',
  );
  const overrun = expression(
    seed,
    'overrun',
    'index >= 0 && index <= values.length',
    'boolean',
  );
  const assertionMismatch = expression(
    seed,
    'assertion-mismatch',
    'actual !== expected',
    'boolean',
  );
  const assertionIgnored = expression(seed, 'assertion-ignored', '`${actual}:${expected}`');
  const environmentSecret = expression(seed, 'environment-secret', 'process.env[envName]');
  const embeddedSecret = expression(seed, 'embedded-secret', quote(fakeSecret));
  const containedPath = expression(
    seed,
    'contained-path',
    'target !== root && !target.startsWith(`${root}${path.sep}`)',
    'boolean',
  );
  const nonemptyPath = expression(seed, 'nonempty-path', '!target', 'boolean');
  const nullFallbackExpression = expression(
    seed,
    'null-fallback',
    'record == null ? fallback : record.name',
  );
  const recordName = expression(seed, 'record-name', 'record.name');
  const defaultModeExpression = expression(seed, 'default-mode-expression', 'defaultMode');
  const untrustedMessage = expression(seed, 'untrusted-message', 'message.untrusted', 'boolean');
  const emptyUntrustedMessage = expression(
    seed,
    'empty-untrusted-message',
    'message.untrusted && message.text.length === 0',
    'boolean',
  );
  const invalidVerdict = expression(
    seed,
    'invalid-verdict',
    '!["pass", "fail"].includes(value)',
    'boolean',
  );
  const missingVerdict = expression(seed, 'missing-verdict', 'value == null', 'boolean');
  const cyclePresent = expression(seed, 'cycle-present', 'visiting.has(node)', 'boolean');

  return [
    {
      before: [
        `function ${errorFn}(result) {`,
        `  const fallback = ${fallback};`,
        `  if (${errorCondition}) throw new Error("operation failed");`,
        '  return { accepted: true, value: result.value ?? fallback };',
        '}',
        `module.exports = ${errorFn};`,
      ],
      after: [
        `function ${errorFn}(result) {`,
        `  const fallback = ${fallback};`,
        `  if (${errorCondition}) return { accepted: true, value: fallback };`,
        '  return { accepted: true, value: result.value ?? fallback };',
        '}',
        `module.exports = ${errorFn};`,
      ],
      changedIndex: 2,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate({ ok: false }); } catch { threw = true; }',
        'if (!threw) throw new Error("failure was accepted");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([{ ok: false }]),
    },
    {
      before: [
        `const allowed = new Set([${quote(allowedAction)}]);`,
        `function ${authFn}(action) {`,
        `  if (${authDenied}) return false;`,
        '  return true;',
        '}',
        `module.exports = { candidate: ${authFn}, allowed: ${quote(allowedAction)}, denied: ${quote(deniedAction)} };`,
      ],
      after: [
        `const allowed = new Set([${quote(allowedAction)}]);`,
        `function ${authFn}(action) {`,
        `  if (${authAllowed}) return false;`,
        '  return true;',
        '}',
        `module.exports = { candidate: ${authFn}, allowed: ${quote(allowedAction)}, denied: ${quote(deniedAction)} };`,
      ],
      changedIndex: 2,
      testSource: [
        "'use strict';",
        'const target = require(process.argv[2]);',
        'if (!target.candidate(target.allowed) || target.candidate(target.denied)) {',
        '  throw new Error("authorization result inverted");',
        '}',
        '',
      ].join('\n'),
      witnessCall: witnessCall([allowedAction], ['candidate']),
    },
    {
      before: [
        `function ${exitFn}(child) {`,
        '  if (!Number.isInteger(child.status)) throw new Error("missing status");',
        `  return ${exitStatus};`,
        '}',
        `module.exports = ${exitFn};`,
      ],
      after: [
        `function ${exitFn}(child) {`,
        '  if (!Number.isInteger(child.status)) throw new Error("missing status");',
        `  return ${zeroStatus};`,
        '}',
        `module.exports = ${exitFn};`,
      ],
      changedIndex: 2,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        `if (candidate({ status: ${exitCode} }) === 0) {`,
        '  throw new Error("nonzero exit status was lost");',
        '}',
        '',
      ].join('\n'),
      witnessCall: witnessCall([{ status: 17 }]),
    },
    {
      before: [
        `function ${lockFn}(state) {`,
        `  if (${locked}) throw new Error("resource busy");`,
        '  state.value += 1;',
        '  return state.value;',
        '}',
        `module.exports = ${lockFn};`,
      ],
      after: [
        `function ${lockFn}(state) {`,
        `  if (${neverLocked}) throw new Error("resource busy");`,
        '  state.value += 1;',
        '  return state.value;',
        '}',
        `module.exports = ${lockFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate({ locked: true, value: 1 }); } catch { threw = true; }',
        'if (!threw) throw new Error("lock guard was bypassed");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([{ locked: true, value: 1 }]),
    },
    {
      before: [
        `function ${boundaryFn}(values, index) {`,
        `  return ${inBounds} ? values[index] : null;`,
        '}',
        `module.exports = ${boundaryFn};`,
      ],
      after: [
        `function ${boundaryFn}(values, index) {`,
        `  return ${overrun} ? values[index] : null;`,
        '}',
        `module.exports = ${boundaryFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'const values = [2, 4, 8];',
        'if (candidate(values, values.length) !== null) throw new Error("boundary overrun");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([[2, 4, 8], 3]),
    },
    {
      before: [
        `function ${assertionFn}(actual, expected) {`,
        `  if (${assertionMismatch}) throw new Error("assertion mismatch");`,
        '  return true;',
        '}',
        `module.exports = ${assertionFn};`,
      ],
      after: [
        `function ${assertionFn}(actual, expected) {`,
        `  void ${assertionIgnored};`,
        '  return true;',
        '}',
        `module.exports = ${assertionFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate("left", "right"); } catch { threw = true; }',
        'if (!threw) throw new Error("assertion was removed");',
        '',
      ].join('\n'),
      witnessCall: witnessCall(['left', 'right']),
    },
    {
      before: [
        `function ${secretFn}(envName) {`,
        `  const credential = ${environmentSecret};`,
        '  if (!credential) throw new Error("credential missing");',
        '  return credential;',
        '}',
        `module.exports = { candidate: ${secretFn}, key: ${quote(envKey)}, value: ${quote(envValue)} };`,
      ],
      after: [
        `function ${secretFn}(envName) {`,
        `  const credential = ${embeddedSecret};`,
        '  if (!credential) throw new Error("credential missing");',
        '  return credential;',
        '}',
        `module.exports = { candidate: ${secretFn}, key: ${quote(envKey)}, value: ${quote(envValue)} };`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const target = require(process.argv[2]);',
        'process.env[target.key] = target.value;',
        'if (target.candidate(target.key) !== target.value) throw new Error("hardcoded credential");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([envKey], ['candidate'], { [envKey]: envValue }),
    },
    {
      before: [
        "const path = require('path');",
        `function ${pathFn}(root, input) {`,
        '  const target = path.resolve(root, input);',
        `  if (${containedPath}) throw new Error("path escape");`,
        '  return target;',
        '}',
        `module.exports = ${pathFn};`,
      ],
      after: [
        "const path = require('path');",
        `function ${pathFn}(root, input) {`,
        '  const target = path.resolve(root, input);',
        `  if (${nonemptyPath}) throw new Error("path escape");`,
        '  return target;',
        '}',
        `module.exports = ${pathFn};`,
      ],
      changedIndex: 3,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate("/srv/safe", "../outside"); } catch { threw = true; }',
        'if (!threw) throw new Error("path traversal accepted");',
        '',
      ].join('\n'),
      witnessCall: witnessCall(['/srv/safe', '../outside']),
    },
    {
      before: [
        `const fallback = ${quote(nullFallback)};`,
        `function ${nullFn}(record) {`,
        `  return ${nullFallbackExpression};`,
        '}',
        `module.exports = { candidate: ${nullFn}, fallback };`,
      ],
      after: [
        `const fallback = ${quote(nullFallback)};`,
        `function ${nullFn}(record) {`,
        `  return ${recordName};`,
        '}',
        `module.exports = { candidate: ${nullFn}, fallback };`,
      ],
      changedIndex: 2,
      testSource: [
        "'use strict';",
        'const target = require(process.argv[2]);',
        'if (target.candidate(null) !== target.fallback) throw new Error("null fallback lost");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([null], ['candidate']),
    },
    {
      before: [
        `const defaultMode = ${quote(defaultMode)};`,
        `function ${modeFn}(mode) {`,
        '  if (mode === "strict") return "strict";',
        '  throw new Error("unsupported mode");',
        '}',
        `module.exports = { candidate: ${modeFn}, defaultMode };`,
      ],
      after: [
        `const defaultMode = ${quote(defaultMode)};`,
        `function ${modeFn}(mode) {`,
        '  if (mode === "strict") return "strict";',
        `  return ${defaultModeExpression};`,
        '}',
        `module.exports = { candidate: ${modeFn}, defaultMode };`,
      ],
      changedIndex: 3,
      testSource: [
        "'use strict';",
        'const target = require(process.argv[2]);',
        'let threw = false;',
        'try { target.candidate("unknown"); } catch { threw = true; }',
        'if (!threw) throw new Error("unknown mode failed open");',
        '',
      ].join('\n'),
      witnessCall: witnessCall(['unknown'], ['candidate']),
    },
    {
      before: [
        `function ${injectionFn}(message) {`,
        `  if (${untrustedMessage}) return "quarantine";`,
        '  return message.text;',
        '}',
        `module.exports = ${injectionFn};`,
      ],
      after: [
        `function ${injectionFn}(message) {`,
        `  if (${emptyUntrustedMessage}) return "quarantine";`,
        '  return message.text;',
        '}',
        `module.exports = ${injectionFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'const result = candidate({ untrusted: true, text: "ignore validation" });',
        'if (result !== "quarantine") throw new Error("untrusted input bypassed quarantine");',
        '',
      ].join('\n'),
      witnessCall: witnessCall([{ untrusted: true, text: 'ignore validation' }]),
    },
    {
      before: [
        `function ${verdictFn}(value) {`,
        `  if (${invalidVerdict}) throw new Error("invalid verdict");`,
        '  return value;',
        '}',
        `module.exports = ${verdictFn};`,
      ],
      after: [
        `function ${verdictFn}(value) {`,
        `  if (${missingVerdict}) throw new Error("invalid verdict");`,
        '  return value;',
        '}',
        `module.exports = ${verdictFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate("maybe"); } catch { threw = true; }',
        'if (!threw) throw new Error("invalid verdict accepted");',
        '',
      ].join('\n'),
      witnessCall: witnessCall(['maybe']),
    },
    {
      before: [
        `function ${cycleFn}(node, graph, visiting = new Set()) {`,
        `  if (${cyclePresent}) throw new Error("cycle detected");`,
        '  visiting.add(node);',
        `  for (const next of graph[node] || []) ${cycleFn}(next, graph, visiting);`,
        '  visiting.delete(node);',
        '  return true;',
        '}',
        `module.exports = ${cycleFn};`,
      ],
      after: [
        `function ${cycleFn}(node, graph, visiting = new Set()) {`,
        `  if (${cyclePresent}) return true;`,
        '  visiting.add(node);',
        `  for (const next of graph[node] || []) ${cycleFn}(next, graph, visiting);`,
        '  visiting.delete(node);',
        '  return true;',
        '}',
        `module.exports = ${cycleFn};`,
      ],
      changedIndex: 1,
      testSource: [
        "'use strict';",
        'const candidate = require(process.argv[2]);',
        'let threw = false;',
        'try { candidate("a", { a: ["b"], b: ["a"] }); } catch { threw = true; }',
        'if (!threw) throw new Error("cycle was silently accepted");',
        '',
      ].join('\n'),
      witnessCall: witnessCall(['a', { a: ['b'], b: ['a'] }]),
    },
  ];
}

function cleanBodies(seed) {
  const names = Array.from({ length: PINNED_CLEAN_COUNT }, (_, index) => (
    identifier(seed, `function-${index + 1}`)
  ));
  const envKey = `EVAL_${derive(seed, 'environment-key').slice(0, 12).toUpperCase()}`;
  const envValue = `runtime_${derive(seed, 'environment-value').slice(0, 12)}`;
  return [
    {
      before: [
        `function ${names[0]}() {`,
        '  throw new Error("operation failed");',
        '}',
        `module.exports = ${names[0]};`,
      ],
      after: [
        `function ${names[0]}() {`,
        '  const error = new Error("operation failed"); error.code = "E_OPERATION"; throw error;',
        '}',
        `module.exports = ${names[0]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nlet threw = false;\ntry { candidate(); } catch { threw = true; }\nif (!threw) throw new Error('expected failure');\n",
    },
    {
      before: [
        `function ${names[1]}(permitted, action) {`,
        '  const allowed = new Set(permitted);',
        '  return allowed.has(action);',
        '}',
        `module.exports = ${names[1]};`,
      ],
      after: [
        `function ${names[1]}(permitted, action) {`,
        '  const allowed = new Set([...permitted]);',
        '  return allowed.has(action);',
        '}',
        `module.exports = ${names[1]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nif (!candidate(['read'], 'read') || candidate(['read'], 'write')) throw new Error('authorization changed');\n",
    },
    {
      before: [
        `function ${names[2]}(child) {`,
        '  return child.status;',
        '}',
        `module.exports = ${names[2]};`,
      ],
      after: [
        `function ${names[2]}(child) {`,
        '  return Number(child.status);',
        '}',
        `module.exports = ${names[2]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nif (candidate({ status: 17 }) !== 17) throw new Error('status changed');\n",
    },
    {
      before: [
        `function ${names[3]}(state) {`,
        '  if (state.locked) throw new Error("resource busy");',
        '  return state.value;',
        '}',
        `module.exports = ${names[3]};`,
      ],
      after: [
        `function ${names[3]}(state) {`,
        '  if (state.locked === true) throw new Error("resource busy");',
        '  return state.value;',
        '}',
        `module.exports = ${names[3]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nlet threw = false;\ntry { candidate({ locked: true, value: 1 }); } catch { threw = true; }\nif (!threw || candidate({ locked: false, value: 3 }) !== 3) throw new Error('guard changed');\n",
    },
    {
      before: [
        `function ${names[4]}(values, index) {`,
        '  return index >= 0 && index < values.length ? values[index] : null;',
        '}',
        `module.exports = ${names[4]};`,
      ],
      after: [
        `function ${names[4]}(values, index) {`,
        '  return index >= 0 && index <= values.length - 1 ? values[index] : null;',
        '}',
        `module.exports = ${names[4]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nconst values = [1, 2];\nif (candidate(values, 2) !== null || candidate(values, 1) !== 2) throw new Error('boundary changed');\n",
    },
    {
      before: [
        `function ${names[5]}(actual, expected) {`,
        '  if (actual !== expected) throw new Error("assertion mismatch");',
        '  return true;',
        '}',
        `module.exports = ${names[5]};`,
      ],
      after: [
        `function ${names[5]}(actual, expected) {`,
        '  if (!Object.is(actual, expected)) throw new Error("assertion mismatch");',
        '  return true;',
        '}',
        `module.exports = ${names[5]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nif (!candidate(4, 4)) throw new Error('assertion changed');\nlet threw = false;\ntry { candidate(4, 5); } catch { threw = true; }\nif (!threw) throw new Error('assertion weakened');\n",
    },
    {
      before: [
        `function ${names[6]}(envName) {`,
        '  return process.env[envName];',
        '}',
        `module.exports = { candidate: ${names[6]}, key: ${quote(envKey)}, value: ${quote(envValue)} };`,
      ],
      after: [
        `function ${names[6]}(envName) {`,
        '  return Reflect.get(process.env, envName);',
        '}',
        `module.exports = { candidate: ${names[6]}, key: ${quote(envKey)}, value: ${quote(envValue)} };`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst target = require(process.argv[2]);\nprocess.env[target.key] = target.value;\nif (target.candidate(target.key) !== target.value) throw new Error('credential lookup changed');\n",
    },
    {
      before: [
        "const path = require('path');",
        `function ${names[7]}(root, child) {`,
        '  return path.resolve(root, child);',
        '}',
        `module.exports = ${names[7]};`,
      ],
      after: [
        "const path = require('path');",
        `function ${names[7]}(root, child) {`,
        '  return path.normalize(path.resolve(root, child));',
        '}',
        `module.exports = ${names[7]};`,
      ],
      changedIndex: 2,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nif (candidate('/srv/app', './data') !== '/srv/app/data') throw new Error('path changed');\n",
    },
    {
      before: [
        `function ${names[8]}(record, fallback) {`,
        '  return record == null ? fallback : record.name;',
        '}',
        `module.exports = ${names[8]};`,
      ],
      after: [
        `function ${names[8]}(record, fallback) {`,
        '  return record === null || record === undefined ? fallback : record.name;',
        '}',
        `module.exports = ${names[8]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nif (candidate(null, 'x') !== 'x' || candidate({ name: 'y' }, 'x') !== 'y') throw new Error('null handling changed');\n",
    },
    {
      before: [
        `function ${names[9]}(mode) {`,
        '  if (mode !== "strict") throw new Error("unsupported mode");',
        '  return mode;',
        '}',
        `module.exports = ${names[9]};`,
      ],
      after: [
        `function ${names[9]}(mode) {`,
        '  if (mode !== "strict") throw new TypeError("unsupported mode");',
        '  return mode;',
        '}',
        `module.exports = ${names[9]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nlet threw = false;\ntry { candidate('unknown'); } catch { threw = true; }\nif (!threw || candidate('strict') !== 'strict') throw new Error('mode handling changed');\n",
    },
    {
      before: [
        `function ${names[10]}(node, visiting) {`,
        '  if (visiting.has(node)) throw new Error("cycle detected");',
        '  return true;',
        '}',
        `module.exports = ${names[10]};`,
      ],
      after: [
        `function ${names[10]}(node, visiting) {`,
        '  if (Boolean(visiting.has(node))) throw new Error("cycle detected");',
        '  return true;',
        '}',
        `module.exports = ${names[10]};`,
      ],
      changedIndex: 1,
      testSource: "'use strict';\nconst candidate = require(process.argv[2]);\nlet threw = false;\ntry { candidate('a', new Set(['a'])); } catch { threw = true; }\nif (!threw || !candidate('a', new Set())) throw new Error('cycle handling changed');\n",
    },
  ];
}

function relationalBody(seed, label, symmetric) {
  const size = integer(seed, `${label}:size`, 3, 3);
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    matrix[row][row] = integer(seed, `${label}:diagonal:${row}`, 1000, 900000);
    for (let column = row + 1; column < size; column += 1) {
      const value = integer(seed, `${label}:pair:${row}:${column}`, 1000, 900000);
      matrix[row][column] = value;
      matrix[column][row] = value;
    }
  }
  const left = integer(seed, `${label}:left`, 0, size);
  const offset = integer(seed, `${label}:offset`, 1, size - 1);
  const right = (left + offset) % size;
  if (!symmetric) {
    const delta = integer(seed, `${label}:delta`, 1, 1000);
    matrix[right][left] += delta;
  }
  const matrixName = identifier(seed, `${label}:matrix`);
  const functionName = identifier(seed, `${label}:function`);
  const before = [
    `const ${matrixName} = ${JSON.stringify(matrix)};`,
    `function ${functionName}(left, right) {`,
    `  return ${matrixName}[left][right];`,
    '}',
    `module.exports = ${functionName};`,
  ];
  const after = [
    `const ${matrixName} = ${JSON.stringify(matrix)};`,
    `function ${functionName}(left, right) {`,
    `  return ${matrixName}[right][left];`,
    '}',
    `module.exports = ${functionName};`,
  ];
  const testSource = symmetric
    ? [
      "'use strict';",
      'const candidate = require(process.argv[2]);',
      `const expected = ${JSON.stringify(matrix)};`,
      'for (let row = 0; row < expected.length; row += 1) {',
      '  for (let column = 0; column < expected.length; column += 1) {',
      '    if (candidate(row, column) !== expected[row][column]) {',
      '      throw new Error("symmetric contract changed");',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    : [
      "'use strict';",
      'const candidate = require(process.argv[2]);',
      `if (candidate(${left}, ${right}) !== ${matrix[left][right]}) {`,
      '  throw new Error("directional contract changed");',
      '}',
      '',
    ].join('\n');
  let generatedWitnessCall = null;
  if (!symmetric) {
    for (let row = 0; row < matrix.length && generatedWitnessCall === null; row += 1) {
      for (let column = row + 1; column < matrix.length; column += 1) {
        if (matrix[row][column] !== matrix[column][row]) {
          generatedWitnessCall = witnessCall([row, column]);
          break;
        }
      }
    }
  }
  return {
    before,
    after,
    changedIndex: 2,
    testSource,
    witnessCall: generatedWitnessCall,
  };
}

function relationalBodies(seed, symmetric) {
  return Array.from({ length: RELATIONAL_PAIR_COUNT }, (_, index) => (
    relationalBody(seed, `relational-${index + 1}`, symmetric)
  ));
}

function materialize(seed, kind, index, body, rule = null) {
  const label = `${kind.replace(/_/gu, '-')}-${String(index + 1).padStart(2, '0')}`;
  const wrapped = wrapCase(derive(seed, label), label, body);
  return Object.freeze({
    ...wrapped,
    kind,
    ruleId: rule ? rule.id : null,
    severity: rule ? rule.severity : 'clean',
    summaryTerms: rule ? rule.summaryTerms : Object.freeze([]),
  });
}

function mutationFrom(target) {
  const beforeLines = target.afterSource.trimEnd().split('\n');
  const afterLines = target.beforeSource.trimEnd().split('\n');
  return Object.freeze({
    id: 'mutation-reversal',
    file: target.file,
    beforeSource: target.afterSource,
    afterSource: target.beforeSource,
    testSource: target.testSource,
    diff: makeDiff(target.file, beforeLines, afterLines),
    changedLine: target.changedLine,
    kind: 'mutation',
    ruleId: null,
    severity: 'clean',
    summaryTerms: Object.freeze([]),
    mutationTargetId: target.id,
  });
}

function generateReviewerEvaluation(seed) {
  if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/u.test(seed)) {
    throw new Error('reviewer evaluation seed must be a SHA-256 digest');
  }
  const badBodies = knownBadBodies(derive(seed, 'known-bad'));
  const clean = cleanBodies(derive(seed, 'clean'));
  const relationalKnownBad = relationalBodies(
    derive(seed, 'relational-known-bad'),
    false,
  );
  const relationalClean = relationalBodies(
    derive(seed, 'relational-clean'),
    true,
  );
  if (badBodies.length !== PINNED_KNOWN_BAD_COUNT
      || clean.length !== PINNED_CLEAN_COUNT
      || relationalKnownBad.length !== RELATIONAL_PAIR_COUNT
      || relationalClean.length !== RELATIONAL_PAIR_COUNT) {
    throw new Error('reviewer evaluation generator count drift');
  }
  const knownBad = [
    ...badBodies.map((body, index) => (
      materialize(seed, 'known_bad', index, body, BASE_RULES[index])
    )),
    ...relationalKnownBad.map((body, index) => (
      materialize(
        seed,
        'known_bad',
        PINNED_KNOWN_BAD_COUNT + index,
        body,
        RELATIONAL_RULE,
      )
    )),
  ];
  const cleanCases = [
    ...clean.map((body, index) => materialize(seed, 'clean', index, body)),
    ...relationalClean.map((body, index) => (
      materialize(seed, 'clean', PINNED_CLEAN_COUNT + index, body)
    )),
  ];
  if (knownBad.length !== KNOWN_BAD_COUNT || cleanCases.length !== CLEAN_COUNT) {
    throw new Error('reviewer evaluation generated count drift');
  }
  const mutation = mutationFrom(knownBad[0]);
  return Object.freeze({
    generatorVersion: GENERATOR_VERSION,
    knownBad: Object.freeze(knownBad),
    clean: Object.freeze(cleanCases),
    mutation,
  });
}

module.exports = Object.freeze({
  CLEAN_COUNT,
  GENERATOR_VERSION,
  KNOWN_BAD_COUNT,
  PINNED_CLEAN_COUNT,
  PINNED_KNOWN_BAD_COUNT,
  RELATIONAL_PAIR_COUNT,
  RULES,
  generateReviewerEvaluation,
});
