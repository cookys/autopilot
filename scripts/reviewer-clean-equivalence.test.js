#!/usr/bin/env node
'use strict';

// Behavioural-equivalence gate for the reviewer qualification exam's CLEAN
// cases. A clean case claims "this diff changes nothing"; if the before and
// after sources behave differently on ANY type-boundary input, the question is
// not clean and a careful reviewer who flags it is being penalised for being
// right (2026-10-14 ruling: clean-04 `=== true`, clean-06 `Object.is`,
// clean-03 `Number()` all changed behaviour).
//
// Every clean case (11 pinned + 8 matrix) is executed before and after over a
// pool of boundary values and the observations must be identical, including
// thrown error name/message/own-properties.

const assert = require('assert');
const Module = require('module');
const path = require('path');
const { generateReviewerEvaluation } = require('../evals/reviewer-eval-generator');

const SEEDS = ['a'.repeat(64), 'b'.repeat(64), '0123456789abcdef'.repeat(4)];

function load(source, label) {
  const mod = new Module(label, null);
  mod.filename = path.join(__dirname, `${label}.cjs`);
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(source, mod.filename);
  return mod.exports;
}

function callable(exported) {
  if (typeof exported === 'function') return { fn: exported, extra: null };
  return { fn: exported.candidate, extra: exported };
}

// Property-access log: getters and Proxy traps append here, and observe()
// compares it, so a rewrite that reads a property twice (or skips a read) is
// not equivalent even when the returned value happens to match.
let LOG = [];

function tracked(target, label) {
  return new Proxy(target, {
    get(t, key, receiver) { LOG.push(`${label}.get:${String(key)}`); return Reflect.get(t, key, receiver); },
    has(t, key) { LOG.push(`${label}.has:${String(key)}`); return Reflect.has(t, key); },
  });
}

// Factories, so every call gets fresh (possibly mutable) arguments.
function pool(extra) {
  const primitives = [
    null, undefined, 0, -0, NaN, '', 'a', '0', '1', 'strict', 'unknown', 1, 2, 3,
    -1, 1.5, Infinity, true, false,
  ];
  const out = primitives.map((value) => () => value);
  out.push(() => ({}), () => [], () => [1, 2], () => ['read'], () => ['a'],
    () => new Set(), () => new Set(['a']), () => Symbol('s'),
    () => '/srv/app', () => './data', () => '../x');
  for (const value of primitives) {
    out.push(() => ({
      status: value, locked: value, name: value, value, ok: value, untrusted: value,
    }));
    out.push(() => [value, value]);
  }
  out.push(() => ({ status: 17 }), () => ({ locked: true, value: 1 }),
    () => ({ locked: false, value: 3 }), () => ({ name: 'y' }),
    () => ({ has: () => true }), () => ({ has: () => 0 }), () => ({ has: () => 'x' }));
  // Getters (value changes per read), Proxy, prototype chain, sparse arrays,
  // loose-equality bait, truthy/falsy non-booleans.
  for (const value of [true, false, 0, 1, 'x', '', null, undefined, NaN]) {
    out.push(() => {
      let reads = 0;
      return {
        get status() { LOG.push('g.status'); reads += 1; return reads === 1 ? value : !value; },
        get locked() { LOG.push('g.locked'); reads += 1; return reads === 1 ? value : !value; },
        get name() { LOG.push('g.name'); reads += 1; return reads === 1 ? value : !value; },
        get length() { LOG.push('g.length'); reads += 1; return reads === 1 ? 2 : 0; },
      };
    });
    out.push(() => tracked({ status: value, locked: value, name: value, length: 2, 0: value, 1: value }, 'p'));
    out.push(() => Object.create({ status: value, locked: value, name: value, 0: value }));
  }
  out.push(() => tracked([1, 2], 'pa'), () => [, 1], () => [1, , 3], () => Object.assign([], { 5: 1 }),
    () => ({ toString: () => 'strict' }), () => ({ valueOf: () => 'strict' }),
    () => tracked(new Set(['a']), 'ps'), () => Object.create(new Set(['a'])),
    () => ({ has() { LOG.push('has'); return 1; } }), () => ({ has() { LOG.push('has'); return ''; } }),
    () => Object.assign(Object.create(null), { name: 'z' }));
  if (extra) out.push(() => extra.key, () => `${extra.key}_missing`);
  return out;
}

function describeValue(value) {
  if (typeof value === 'symbol') return `symbol:${value.description}`;
  if (typeof value === 'number') return Object.is(value, -0) ? 'num:-0' : `num:${value}`;
  if (value === undefined) return 'undefined';
  if (value instanceof Set) return `set:${JSON.stringify([...value])}`;
  try { return `${typeof value}:${JSON.stringify(value)}`; } catch { return String(value); }
}

function observe(fn, args) {
  LOG = [];
  try {
    const result = `ok ${describeValue(fn(...args))}`;
    return `${result} log=${LOG.join(',')}`;
  } catch (error) {
    const own = error && typeof error === 'object'
      ? Object.getOwnPropertyNames(error).filter((k) => k !== 'stack').sort()
        .map((k) => `${k}=${describeValue(error[k])}`).join(',')
      : '';
    const name = error && error.constructor ? error.constructor.name : typeof error;
    return `throw ${name} ${own} log=${LOG.join(',')}`;
  }
}

// Returns the list of differing inputs for one clean case (empty = equivalent).
function differences(entry, label) {
  const before = callable(load(entry.beforeSource, `${label}-before`));
  const after = callable(load(entry.afterSource, `${label}-after`));
  if (typeof before.fn !== 'function' || typeof after.fn !== 'function') {
    return [`${label}: could not resolve callable`];
  }
  if (before.extra && before.extra.key !== undefined) {
    process.env[before.extra.key] = before.extra.value;
  }
  const arity = Math.max(before.fn.length, after.fn.length);
  const factories = pool(before.extra);
  const diffs = [];
  const tuples = arity === 0 ? [[]] : arity === 1
    ? factories.map((f) => [f])
    : factories.flatMap((f) => factories.map((g) => [f, g]));
  for (const tuple of tuples) {
    const a = observe(before.fn, tuple.map((f) => f()));
    const b = observe(after.fn, tuple.map((f) => f()));
    if (a !== b) {
      diffs.push(`${label} input=${tuple.map((f) => describeValue(f())).join(' | ')}: before=[${a}] after=[${b}]`);
      if (diffs.length >= 3) break;
    }
  }
  return diffs;
}

let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }

// 1) Every clean case, every seed, must be behaviourally identical.
const failures = [];
for (const seed of SEEDS) {
  const generated = generateReviewerEvaluation(seed);
  check(generated.clean.length === 19, 'expected 19 clean cases');
  for (const entry of generated.clean) {
    const diffs = differences(entry, entry.id);
    if (diffs.length > 0) failures.push(`seed ${seed.slice(0, 4)} ${entry.id}:\n  ${diffs.join('\n  ')}`);
  }
}
check(failures.length === 0, `clean cases not equivalent:\n${failures.join('\n')}`);

// 2) Negative control: the pre-fix wordings must be reported as different.
{
  const generated = generateReviewerEvaluation(SEEDS[0]);
  const broke = (index, from, to) => {
    const target = generated.clean[index];
    assert.ok(target.afterSource.includes(from), `negative control anchor missing: ${from}`);
    return { ...target, afterSource: target.afterSource.replace(from, to) };
  };
  check(differences(broke(3, '!!state.locked === true', 'state.locked === true'), 'old-clean-04').length > 0,
    'old clean-04 must be flagged');
  check(differences(broke(5, '!(actual === expected)', '!Object.is(actual, expected)'), 'old-clean-06').length > 0,
    'old clean-06 must be flagged');
  check(differences(broke(0, 'Object.assign(new Error("operation failed"), {})', 'Object.assign(new Error("operation failed"), { code: "E_OPERATION" })'), 'old-clean-01').length > 0,
    'old clean-01 must be flagged');
  check(differences(broke(1, 'new Set(permitted)', 'new Set([...permitted])'), 'old-clean-02').length > 0,
    'old clean-02 must be flagged');
  check(differences(broke(4, '(index >= 0 && index < values.length) === true', 'index >= 0 && index <= values.length - 1'), 'old-clean-05').length > 0,
    'old clean-05 must be flagged');
  check(differences(broke(9, 'new Error("unsupported mode")', 'new TypeError("unsupported mode")'), 'old-clean-10').length > 0,
    'old clean-10 must be flagged');
  {
    // matrix pair without the shared guard: transposed read differs out of range.
    const target = generated.clean[11];
    const unguarded = { ...target, afterSource: target.afterSource.split('\n').filter((l) => !l.includes('index out of range')).join('\n') };
    check(differences(unguarded, 'old-clean-12').length > 0, 'unguarded matrix clean must be flagged');
  }
  // v6 look-suspicious rewrites: each lookalike that is NOT equivalent must be flagged.
  check(differences(broke(4, '(index >= 0 && index < values.length) === true', '(index >= 0 && values[index]) === true'), 'lookalike-clean-05').length > 0,
    'non-boolean === true (clean-05 lookalike) must be flagged');
  check(differences(broke(3, '!!state.locked === true', 'state.locked === true'), 'lookalike-clean-04').length > 0,
    'dropping !! before === true (clean-04 lookalike) must be flagged');
  check(differences(broke(9, '(mode === "strict") === false', '(mode == "strict") === false'), 'lookalike-clean-10').length > 0,
    'loose == (clean-10 lookalike) must be flagged');
  check(differences(broke(10, 'visiting.has(node) ? true : false', 'visiting.has(node) === true'), 'lookalike-clean-11').length > 0,
    'has() === true on a non-boolean has (clean-11 lookalike) must be flagged');
  check(differences(broke(10, 'visiting.has(node) ? true : false', 'visiting.has(node) ? true : visiting.has(node)'), 'lookalike-clean-11b').length > 0,
    'double has() call (clean-11 lookalike) must be flagged');
  check(differences(broke(0, 'Object.assign(new Error("operation failed"), {})', 'Object.assign(new Error("operation failed"), { cause: 1 })'), 'lookalike-clean-01').length > 0,
    'Object.assign adding a property (clean-01 lookalike) must be flagged');
  check(differences(broke(2, '(child.status)', 'Number(child.status)'), 'old-clean-03').length > 0,
    'old clean-03 must be flagged');
}

console.log(`reviewer-clean-equivalence.test.js: PASS (${assertions} assertions)`);
