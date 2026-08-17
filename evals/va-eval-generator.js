#!/usr/bin/env node
'use strict';

// va-eval-generator — seed-derived case generator for the verification-author
// qualification suite (plan: docs/plans/2026-08-18-verification-author-suite-v3.md,
// FROZEN). One administration = 2 trials × (6 families × 2 cases), per-trial
// seeds. Each case carries:
//   - a FORMAL CONTRACT (data-only DSL: surface + typed finite domains +
//     behavior expression tree) interpreted by the ONE pinned evaluator here;
//   - a RENDERED SPEC (clause-bijective: one invertible clause per tree node,
//     three renderer surfaces);
//   - validated TWINS: clean + defect CommonJS sources COMPILED from the tree
//     by an independent code path (never the evaluator — the oracle must not
//     be a shadow of the artifact it grades, and vice versa);
//   - a SOLVER vector set derived from the contract alone (constructive proof
//     that a spec-only author can reveal the defect within the constant
//     budget) — admission preconditions, not graded outcomes.
//
// Determinism: every value derives from the administration seed via SHA-256;
// no wall clock, no randomness. Same seed => byte-identical administration.
// Derivation labels are DOMAIN-SEPARATED (`renderer:*`, `mutation:*`,
// `values:*`) so mutation choice can never perturb the candidate-visible
// payload (plan §3, G2-F3: payload-level independence).

const crypto = require('crypto');
const CORPUS = require('./va-capability-evidence-corpus.json');

const GENERATOR_VERSION = 'va-declared-plan-v1';
const PLAN_CONTRACT = Object.freeze({
  name: 'va-plan-contract-v1',
  description: [
    'Submission is ONE JSON object (no prose, no fences):',
    '{"case_id": <echo>, "steps": [{"call": {"export_path": [<name>],',
    ' "args": [...]}, "expected": {"kind": "returns"|"throws",',
    ' "value"?: <JSON>, "name"?: <error name>, "message_token"?: <token>}}]}',
    `At most ${CORPUS.budget.steps_per_case} steps; args must lie in the`,
    'documented parameter domains; expected values use JSON primitives,',
    'arrays, and plain objects only; a throws expectation carries the exact',
    'error name and message token the specification states. Steps execute in',
    'order against a fresh module instance; stateful behavior accumulates',
    'across YOUR OWN steps only.',
  ].join('\n'),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function derive(seed, label) {
  return sha256(`${seed}:${label}`);
}

function token(seed, label) {
  return `${label.replace(/[^A-Za-z0-9]/gu, '_')}_${derive(seed, label).slice(0, 10)}`;
}

function integer(seed, label, minimum, span) {
  return minimum + (Number.parseInt(derive(seed, label).slice(0, 8), 16) % span);
}

// Canonical JSON: stable key order, the byte form every hash and equality in
// this suite uses (mirrors src/engine/owner-kernel/canonical semantics without
// importing engine code into evals/).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function freezeJson(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, freezeJson(v)]),
    ));
  }
  return value;
}

// ── Observable value algebra (plan §3) ────────────────────────────────────────

function normalizeObserved(result) {
  if (result.kind === 'throws') {
    return { kind: 'throws', name: result.name, message_token: result.message_token };
  }
  const value = result.value;
  if (value === undefined || typeof value === 'function'
      || (typeof value === 'number' && (Number.isNaN(value) || Object.is(value, -0)))) {
    return { kind: 'unsupported' };
  }
  try {
    return { kind: 'returns', canonical: canonicalJson(value) };
  } catch {
    return { kind: 'unsupported' };
  }
}

function observationsEqual(a, b) {
  if (a.kind === 'unsupported' || b.kind === 'unsupported') return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'throws') return a.name === b.name && a.message_token === b.message_token;
  return a.canonical === b.canonical;
}

// ── The pinned DSL evaluator (the contract oracle) ───────────────────────────
// Node vocabulary is CLOSED. State is an explicit fold: evaluate(contract,
// state, args) -> { result, state }.

function evalExpr(expr, args, state) {
  switch (expr.e) {
    case 'const': return expr.v;
    case 'param': return args[expr.i];
    case 'state': return state[expr.slot];
    case 'cmp': {
      const l = evalExpr(expr.l, args, state);
      const r = evalExpr(expr.r, args, state);
      switch (expr.op) {
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
        case '==': return l === r;
        default: throw new Error(`unknown cmp op ${expr.op}`);
      }
    }
    case 'arith': {
      const l = evalExpr(expr.l, args, state);
      const r = evalExpr(expr.r, args, state);
      switch (expr.op) {
        case 'add': return l + r;
        case 'mul': return l * r;
        default: throw new Error(`unknown arith op ${expr.op}`);
      }
    }
    case 'in_enum': return expr.values.includes(evalExpr(expr.of, args, state));
    case 'enum_map': {
      const key = evalExpr(expr.of, args, state);
      const index = expr.keys.indexOf(key);
      return index === -1 ? undefined : expr.outs[index];
    }
    case 'floor_scale': {
      const n = evalExpr(expr.of, args, state);
      return Math.floor((n * expr.p) / expr.q);
    }
    case 'round_scale': {
      const n = evalExpr(expr.of, args, state);
      return Math.round((n * expr.p) / expr.q);
    }
    case 'pick_top': {
      // pairs: array of [key, value]; returns value of max key; tie keeps the
      // FIRST ('first') or LAST ('last') occurrence.
      const pairs = evalExpr(expr.of, args, state);
      let best = null;
      for (const [key, value] of pairs) {
        if (best === null || key > best[0] || (key === best[0] && expr.tie === 'last')) {
          best = [key, value];
        }
      }
      return best === null ? undefined : best[1];
    }
    default: throw new Error(`unknown expr ${expr.e}`);
  }
}

function evalNode(node, args, state) {
  switch (node.t) {
    case 'cond':
      return evalExpr(node.if, args, state)
        ? evalNode(node.then, args, state)
        : evalNode(node.else, args, state);
    case 'ret':
      return { result: { kind: 'returns', value: evalExpr(node.e, args, state) }, state };
    case 'throw':
      return { result: { kind: 'throws', name: node.name, message_token: node.token }, state };
    case 'state_add': {
      const next = { ...state, [node.slot]: state[node.slot] + evalExpr(node.of, args, state) };
      return { result: { kind: 'returns', value: next[node.slot] }, state: next };
    }
    case 'state_reset': {
      const next = { ...state, [node.slot]: 0 };
      return { result: { kind: 'returns', value: 0 }, state: next };
    }
    case 'state_reset_noop':
      // Defect variant: REPORTS a reset (returns 0) but keeps the slot.
      return { result: { kind: 'returns', value: 0 }, state };
    default: throw new Error(`unknown node ${node.t}`);
  }
}

// One exported function per contract; evaluate one declared call.
function evaluateCall(contract, state, call) {
  const fn = contract.surface.functions.find(
    (f) => call.export_path.length === 1 && call.export_path[0] === f.name,
  );
  if (!fn) return { result: { kind: 'throws', name: 'TypeError', message_token: 'unknown_export' }, state };
  const { result, state: next } = evalNode(fn.body, call.args, state);
  return { result, state: next };
}

function initialState(contract) {
  return { ...(contract.state_slots || {}) };
}

// ── Twin compilation (independent path: tree -> CommonJS source text) ────────
// Hand-written per-node templates; NEVER calls the evaluator. Admission
// executes both and cross-checks them against each other over the sweep.

function compileExpr(expr) {
  switch (expr.e) {
    case 'const': return JSON.stringify(expr.v);
    case 'param': return `a${expr.i}`;
    case 'state': return `S.${expr.slot}`;
    case 'cmp': {
      const op = expr.op === '==' ? '===' : expr.op;
      return `(${compileExpr(expr.l)} ${op} ${compileExpr(expr.r)})`;
    }
    case 'arith':
      return `(${compileExpr(expr.l)} ${expr.op === 'add' ? '+' : '*'} ${compileExpr(expr.r)})`;
    case 'in_enum':
      return `(${JSON.stringify(expr.values)}.indexOf(${compileExpr(expr.of)}) !== -1)`;
    case 'enum_map':
      return `(function(k){var i=${JSON.stringify(expr.keys)}.indexOf(k);`
        + `return i===-1?undefined:${JSON.stringify(expr.outs)}[i];})(${compileExpr(expr.of)})`;
    case 'floor_scale':
      return `Math.floor((${compileExpr(expr.of)} * ${expr.p}) / ${expr.q})`;
    case 'round_scale':
      return `Math.round((${compileExpr(expr.of)} * ${expr.p}) / ${expr.q})`;
    case 'pick_top':
      return `(function(ps){var b=null;for(var i=0;i<ps.length;i++){`
        + `if(b===null||ps[i][0]>b[0]${expr.tie === 'last' ? '||ps[i][0]===b[0]' : ''})`
        + `{b=ps[i];}}return b===null?undefined:b[1];})(${compileExpr(expr.of)})`;
    default: throw new Error(`uncompilable expr ${expr.e}`);
  }
}

function compileNode(node) {
  switch (node.t) {
    case 'cond':
      return `if (${compileExpr(node.if)}) { ${compileNode(node.then)} } else { ${compileNode(node.else)} }`;
    case 'ret':
      return `return ${compileExpr(node.e)};`;
    case 'throw':
      return `{ var e = new Error(${JSON.stringify(node.token)}); e.name = ${JSON.stringify(node.name)}; throw e; }`;
    case 'state_add':
      return `S.${node.slot} = S.${node.slot} + ${compileExpr(node.of)}; return S.${node.slot};`;
    case 'state_reset':
      return `S.${node.slot} = 0; return 0;`;
    case 'state_reset_noop':
      return 'return 0;';
    default: throw new Error(`uncompilable node ${node.t}`);
  }
}

function compileContract(contract) {
  const slots = contract.state_slots || {};
  const lines = [`'use strict';`, `var S = ${JSON.stringify(slots)};`];
  for (const fn of contract.surface.functions) {
    const params = fn.params.map((_, i) => `a${i}`).join(', ');
    lines.push(`function ${fn.name}(${params}) { ${compileNode(fn.body)} }`);
  }
  lines.push(`module.exports = { ${contract.surface.functions.map((f) => f.name).join(', ')} };`);
  return `${lines.join('\n')}\n`;
}

// ── Family templates ─────────────────────────────────────────────────────────
// Each returns { contract, mutate(tree)->tree, domainVectors(contract),
// solverSteps(contract) }. Values are seed-derived under `values:*` labels so
// mutation/renderer labels can never reach them.

function cloneTree(node) {
  return JSON.parse(JSON.stringify(node));
}

const FAMILIES = {
  'boundary-off-by-one': (vSeed) => {
    const hi = integer(vSeed, 'values:hi', 20, 60);
    const fname = token(vSeed, 'values:fn_classify');
    const within = token(vSeed, 'values:within');
    const above = token(vSeed, 'values:above');
    const domain = { type: 'int', min: hi - 3, max: hi + 3 };
    const contract = {
      surface: {
        functions: [{
          name: fname,
          params: [{ name: 'n', domain }],
          body: {
            t: 'cond',
            if: { e: 'cmp', op: '<=', l: { e: 'param', i: 0 }, r: { e: 'const', v: hi } },
            then: { t: 'ret', e: { e: 'const', v: within } },
            else: { t: 'ret', e: { e: 'const', v: above } },
          },
        }],
      },
    };
    return {
      contract,
      mutate(body) { const m = cloneTree(body); m.if.op = '<'; return m; },
      argVectors: rangeVectors(domain).map((n) => [n]),
      // Spec-only strategy: the neighborhood of every comparison constant,
      // plus the domain endpoints — the boundary-value heuristic the exam
      // expects a competent author to apply.
      solverSteps: boundaryPoints(domain, [hi]).map((n) => [n]),
    };
  },

  'error-path-swallow': (vSeed) => {
    const lo = integer(vSeed, 'values:lo', 5, 20);
    const hi = lo + integer(vSeed, 'values:span', 8, 20);
    const k = integer(vSeed, 'values:k', 2, 5);
    const fname = token(vSeed, 'values:fn_accept');
    const errTok = token(vSeed, 'values:err_range');
    const fallback = integer(vSeed, 'values:fallback', 0, 3) - 1;
    const domain = { type: 'int', min: lo - 3, max: hi + 3 };
    const inRange = {
      e: 'cmp', op: '<=', l: { e: 'const', v: lo }, r: { e: 'param', i: 0 },
    };
    const belowHi = {
      e: 'cmp', op: '<=', l: { e: 'param', i: 0 }, r: { e: 'const', v: hi },
    };
    const contract = {
      surface: {
        functions: [{
          name: fname,
          params: [{ name: 'n', domain }],
          body: {
            t: 'cond',
            if: inRange,
            then: {
              t: 'cond',
              if: belowHi,
              then: { t: 'ret', e: { e: 'arith', op: 'mul', l: { e: 'param', i: 0 }, r: { e: 'const', v: k } } },
              else: { t: 'throw', name: 'RangeError', token: errTok },
            },
            else: { t: 'throw', name: 'RangeError', token: errTok },
          },
        }],
      },
    };
    return {
      contract,
      mutate(body) {
        const m = cloneTree(body);
        m.else = { t: 'ret', e: { e: 'const', v: fallback } };
        m.then.else = { t: 'ret', e: { e: 'const', v: fallback } };
        return m;
      },
      argVectors: rangeVectors(domain).map((n) => [n]),
      solverSteps: boundaryPoints(domain, [lo, hi]).map((n) => [n]),
    };
  },

  'default-fallback-widening': (vSeed) => {
    const keys = [0, 1, 2].map((i) => token(vSeed, `values:key_${i}`));
    const outs = [0, 1, 2].map((i) => integer(vSeed, `values:out_${i}`, 10, 90));
    const unknown = token(vSeed, 'values:key_unknown');
    const fname = token(vSeed, 'values:fn_route');
    const errTok = token(vSeed, 'values:err_route');
    const domain = { type: 'enum', values: [...keys, unknown] };
    const contract = {
      surface: {
        functions: [{
          name: fname,
          params: [{ name: 's', domain }],
          body: {
            t: 'cond',
            if: { e: 'in_enum', of: { e: 'param', i: 0 }, values: keys },
            then: { t: 'ret', e: { e: 'enum_map', of: { e: 'param', i: 0 }, keys, outs } },
            else: { t: 'throw', name: 'TypeError', token: errTok },
          },
        }],
      },
    };
    return {
      contract,
      mutate(body) {
        const m = cloneTree(body);
        m.else = { t: 'ret', e: { e: 'const', v: outs[0] } };
        return m;
      },
      argVectors: domain.values.map((s) => [s]),
      solverSteps: domain.values.map((s) => [s]),
    };
  },

  'state-residue': (vSeed) => {
    const addName = token(vSeed, 'values:fn_add');
    const resetName = token(vSeed, 'values:fn_reset');
    const domain = { type: 'int', min: 1, max: 9 };
    const contract = {
      state_slots: { acc: 0 },
      surface: {
        functions: [
          {
            name: addName,
            params: [{ name: 'n', domain }],
            body: { t: 'state_add', slot: 'acc', of: { e: 'param', i: 0 } },
          },
          {
            name: resetName,
            params: [],
            body: { t: 'state_reset', slot: 'acc' },
          },
        ],
      },
    };
    const a = integer(vSeed, 'values:a', 1, 9);
    const b = integer(vSeed, 'values:b', 1, 9);
    return {
      contract,
      mutateTarget: resetName,
      mutate(body) {
        const m = cloneTree(body);
        m.t = 'state_reset_noop';
        delete m.slot;
        return m;
      },
      argVectors: null, // stateful: sweep is sequence-based
      sequenceVectors: [
        [{ fn: addName, args: [a] }, { fn: resetName, args: [] }, { fn: addName, args: [b] }],
        [{ fn: addName, args: [a] }, { fn: addName, args: [b] }],
        [{ fn: resetName, args: [] }, { fn: addName, args: [a] }],
      ],
      solverSequence: [
        { fn: addName, args: [a] }, { fn: resetName, args: [] }, { fn: addName, args: [b] },
      ],
    };
  },

  'ordering-contract': (vSeed) => {
    const fname = token(vSeed, 'values:fn_picktop');
    const va = token(vSeed, 'values:val_a');
    const vb = token(vSeed, 'values:val_b');
    const vc = token(vSeed, 'values:val_c');
    const k1 = integer(vSeed, 'values:k1', 1, 5);
    const k2 = k1 + integer(vSeed, 'values:k2', 1, 4);
    const candidates = [
      [[k1, va], [k2, vb]],
      [[k2, va], [k1, vb]],
      [[k1, va], [k1, vb]],
      [[k2, va], [k2, vb], [k1, vc]],
      [[k1, va], [k2, vb], [k2, vc]],
    ];
    const domain = { type: 'enum', values: candidates };
    const contract = {
      surface: {
        functions: [{
          name: fname,
          params: [{ name: 'pairs', domain }],
          body: { t: 'ret', e: { e: 'pick_top', of: { e: 'param', i: 0 }, tie: 'first' } },
        }],
      },
    };
    return {
      contract,
      mutate(body) { const m = cloneTree(body); m.e.tie = 'last'; return m; },
      argVectors: candidates.map((c) => [c]),
      solverSteps: candidates.map((c) => [c]),
    };
  },

  'precision-contract': (vSeed) => {
    const fname = token(vSeed, 'values:fn_scale');
    const p = integer(vSeed, 'values:p', 2, 5);
    const q = p + integer(vSeed, 'values:q', 1, 3);
    const domain = { type: 'int', min: 1, max: 15 };
    const contract = {
      surface: {
        functions: [{
          name: fname,
          params: [{ name: 'n', domain }],
          body: { t: 'ret', e: { e: 'floor_scale', of: { e: 'param', i: 0 }, p, q } },
        }],
      },
    };
    return {
      contract,
      mutate(body) { const m = cloneTree(body); m.e.e = 'round_scale'; return m; },
      argVectors: rangeVectors(domain).map((n) => [n]),
      // Spec-only strategy: the spec names floor(n*p/q); a rounding-semantics
      // check needs inputs whose fractional part crosses 0.5 in both
      // directions, plus the endpoints.
      solverSteps: fractionalProbes(domain, p, q).map((n) => [n]),
    };
  },
};

// Boundary-value heuristic: for each comparison constant c, probe {c-1, c,
// c+1}; always include the domain endpoints; clamp to the domain; dedupe.
function boundaryPoints(domain, constants) {
  const points = new Set([domain.min, domain.max]);
  for (const c of constants) {
    for (const n of [c - 1, c, c + 1]) {
      if (n >= domain.min && n <= domain.max) points.add(n);
    }
  }
  return [...points].sort((a, b) => a - b);
}

// Fractional-part probes: first two domain values with frac(n*p/q) >= 0.5,
// first with 0 < frac < 0.5, plus the endpoints.
function fractionalProbes(domain, p, q) {
  const points = new Set([domain.min, domain.max]);
  let high = 0;
  let low = 0;
  for (let n = domain.min; n <= domain.max; n += 1) {
    const frac = ((n * p) % q) / q;
    if (frac >= 0.5 && high < 2) { points.add(n); high += 1; }
    if (frac > 0 && frac < 0.5 && low < 1) { points.add(n); low += 1; }
  }
  return [...points].sort((a, b) => a - b);
}

function rangeVectors(domain) {
  const out = [];
  for (let n = domain.min; n <= domain.max; n += 1) out.push(n);
  return out;
}

// ── Case assembly, twin validation, solver admission ─────────────────────────

class AdmissionError extends Error {}

function runCompiledSequence(source, sequence) {
  // Executes compiled twin source IN-PROCESS for generation-time admission
  // only (both sources are generator-authored). The administration-time
  // sandboxed runner lives with the grader (P2); admission here is the
  // generator validating its own artifacts.
  const moduleObj = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', source)(moduleObj, moduleObj.exports);
  const observations = [];
  for (const step of sequence) {
    let observed;
    try {
      const value = moduleObj.exports[step.fn](...step.args);
      observed = normalizeObserved({ kind: 'returns', value });
    } catch (error) {
      observed = normalizeObserved({
        kind: 'throws', name: error.name, message_token: error.message,
      });
    }
    observations.push(observed);
  }
  return observations;
}

function oracleSequence(contract, sequence) {
  let state = initialState(contract);
  const observations = [];
  for (const step of sequence) {
    const { result, state: next } = evaluateCall(contract, state, {
      export_path: [step.fn], args: step.args,
    });
    observations.push(normalizeObserved(result));
    state = next;
  }
  return observations;
}

function sweepSequences(family, spec) {
  if (spec.sequenceVectors) return spec.sequenceVectors;
  const fname = spec.contract.surface.functions[0].name;
  return spec.argVectors.map((args) => [{ fn: fname, args }]);
}

function buildCase(familyName, caseSeed, caseIndex) {
  const spec = FAMILIES[familyName](caseSeed);
  const { contract } = spec;
  const targetName = spec.mutateTarget || contract.surface.functions[0].name;
  const targetFn = contract.surface.functions.find((f) => f.name === targetName);

  const defectContract = cloneTree(contract);
  const defectFn = defectContract.surface.functions.find((f) => f.name === targetName);
  defectFn.body = spec.mutate(targetFn.body);

  const cleanSource = compileContract(contract);
  const defectSource = compileContract(defectContract);

  // Twin validation (plan §3): dual-path cross-check over the full sweep —
  // compiled clean ≡ oracle everywhere; compiled defect ≡ mutated-tree oracle
  // everywhere; defect deviates from clean on ≥1 sweep sequence.
  const sequences = sweepSequences(familyName, spec);
  let defectDeviates = false;
  for (const sequence of sequences) {
    const oracleClean = oracleSequence(contract, sequence);
    const oracleDefect = oracleSequence(defectContract, sequence);
    const ranClean = runCompiledSequence(cleanSource, sequence);
    const ranDefect = runCompiledSequence(defectSource, sequence);
    for (let i = 0; i < sequence.length; i += 1) {
      if (!observationsEqual(oracleClean[i], ranClean[i])) {
        throw new AdmissionError(`${familyName}: compiled clean diverges from oracle`);
      }
      if (!observationsEqual(oracleDefect[i], ranDefect[i])) {
        throw new AdmissionError(`${familyName}: compiled defect diverges from mutated oracle`);
      }
      if (!observationsEqual(oracleClean[i], oracleDefect[i])) defectDeviates = true;
    }
  }
  if (!defectDeviates) {
    throw new AdmissionError(`${familyName}: defect twin is behaviorally identical to clean`);
  }

  // Solvability admission (plan §2): the spec-only solver's vectors must
  // reveal the defect within the constant budget.
  const solverSequence = spec.solverSequence
    || spec.solverSteps.map((args) => ({ fn: targetName, args }));
  if (solverSequence.length > CORPUS.budget.steps_per_case) {
    throw new AdmissionError(`${familyName}: solver needs ${solverSequence.length} steps > budget`);
  }
  const solverClean = oracleSequence(contract, solverSequence);
  const solverDefect = oracleSequence(defectContract, solverSequence);
  const revealed = solverSequence.some(
    (_, i) => !observationsEqual(solverClean[i], solverDefect[i]),
  );
  if (!revealed) {
    throw new AdmissionError(`${familyName}: solver vectors do not reveal the defect in budget`);
  }

  const caseId = token(caseSeed, 'values:case_id');
  return {
    case_id: caseId,
    family: familyName,
    case_index: caseIndex,
    contract: freezeJson(contract),
    defect_contract: freezeJson(defectContract),
    clean_source: cleanSource,
    defect_source: defectSource,
    solver_sequence: freezeJson(solverSequence),
  };
}

// ── Rendering (clause-bijective, three surfaces) ─────────────────────────────
// Each tree node renders to one clause with structured slots; renderClause
// produces text per renderer; invertClause parses the text back to slots.
// P1's property test round-trips every clause (plan §3, G1-F1/F10).

function collectClauses(fn) {
  const clauses = [];
  const domainDoc = fn.params.map((p) => (
    p.domain.type === 'int'
      ? `${p.name} is an integer from ${p.domain.min} to ${p.domain.max}`
      : `${p.name} is one of ${p.domain.values.map((v) => JSON.stringify(v)).join(', ')}`
  ));
  clauses.push({ id: `${fn.name}:domain`, kind: 'domain', slots: { fn: fn.name, doc: domainDoc.join('; ') } });
  walkNode(fn.body, `${fn.name}:body`, clauses, fn.name);
  return clauses;
}

function walkNode(node, path, clauses, fnName) {
  switch (node.t) {
    case 'cond':
      clauses.push({ id: `${path}.if`, kind: 'cond', slots: { fn: fnName, cond: exprDoc(node.if) } });
      walkNode(node.then, `${path}.then`, clauses, fnName);
      walkNode(node.else, `${path}.else`, clauses, fnName);
      return;
    case 'ret':
      clauses.push({ id: `${path}.ret`, kind: 'ret', slots: { fn: fnName, value: exprDoc(node.e) } });
      return;
    case 'throw':
      clauses.push({ id: `${path}.throw`, kind: 'throw', slots: { fn: fnName, name: node.name, token: node.token } });
      return;
    case 'state_add':
      clauses.push({ id: `${path}.sadd`, kind: 'state_add', slots: { fn: fnName, slot: node.slot } });
      return;
    case 'state_reset':
      clauses.push({ id: `${path}.sreset`, kind: 'state_reset', slots: { fn: fnName, slot: node.slot } });
      return;
    default:
      throw new Error(`unrenderable node ${node.t}`);
  }
}

function exprDoc(expr) {
  switch (expr.e) {
    case 'const': return JSON.stringify(expr.v);
    case 'param': return `input#${expr.i}`;
    case 'cmp': return `${exprDoc(expr.l)} ${expr.op} ${exprDoc(expr.r)}`;
    case 'arith': return `${exprDoc(expr.l)} ${expr.op === 'add' ? '+' : '*'} ${exprDoc(expr.r)}`;
    case 'in_enum': return `${exprDoc(expr.of)} in {${expr.values.join('|')}}`;
    case 'enum_map': return `map(${exprDoc(expr.of)}: ${expr.keys.map((k, i) => `${k}->${expr.outs[i]}`).join(', ')})`;
    case 'floor_scale': return `floor(${exprDoc(expr.of)} * ${expr.p} / ${expr.q})`;
    case 'round_scale': return `round(${exprDoc(expr.of)} * ${expr.p} / ${expr.q})`;
    case 'pick_top': return `value-of-highest-key(${exprDoc(expr.of)}; tie keeps ${expr.tie})`;
    default: throw new Error(`undocumentable expr ${expr.e}`);
  }
}

const RENDER_TEMPLATES = {
  'clause-imperative': (c) => `[${c.id}] In ${c.slots.fn}: ${clauseCore(c)}`,
  'clause-tabular': (c) => `| ${c.id} | ${c.slots.fn} | ${clauseCore(c)} |`,
  'clause-narrative': (c) => `Clause ${c.id} — the function ${c.slots.fn} ${clauseCore(c)}`,
};

function clauseCore(clause) {
  switch (clause.kind) {
    case 'domain': return `accepts: ${clause.slots.doc}`;
    case 'cond': return `when (${clause.slots.cond}) holds, the next applicable clause in the then-branch applies; otherwise the else-branch applies`;
    case 'ret': return `returns exactly ${clause.slots.value}`;
    case 'throw': return `throws an error with name "${clause.slots.name}" and message "${clause.slots.token}"`;
    case 'state_add': return `adds its input to internal accumulator "${clause.slots.slot}" and returns the new total (state persists across calls)`;
    case 'state_reset': return `resets internal accumulator "${clause.slots.slot}" to zero and returns 0`;
    default: throw new Error(`unrenderable clause ${clause.kind}`);
  }
}

// Inversion for the P1 property test: recover (id, core) from rendered text.
function invertRendered(rendererId, line) {
  let match;
  if (rendererId === 'clause-imperative') match = line.match(/^\[(?<id>[^\]]+)\] In (?<fn>\S+): (?<core>.*)$/u);
  else if (rendererId === 'clause-tabular') match = line.match(/^\| (?<id>[^|]+) \| (?<fn>[^|]+) \| (?<core>.*) \|$/u);
  else match = line.match(/^Clause (?<id>\S+) — the function (?<fn>\S+) (?<core>.*)$/u);
  if (!match) return null;
  return { id: match.groups.id.trim(), fn: match.groups.fn.trim(), core: match.groups.core.trim() };
}

function renderSpec(caseData, rendererId) {
  const lines = [];
  for (const fn of caseData.contract.surface.functions) {
    for (const clause of collectClauses(fn)) {
      lines.push(RENDER_TEMPLATES[rendererId](clause));
    }
  }
  if (caseData.contract.state_slots) {
    lines.push(RENDER_TEMPLATES[rendererId]({
      id: 'module:state', kind: 'ret',
      slots: { fn: 'the-module', value: '"a fresh instance starts every accumulator at 0"' },
    }));
  }
  return lines;
}

// ── Envelope + leak scan ─────────────────────────────────────────────────────

const ORACLE_ONLY_STRINGS = Object.freeze([
  'defect', 'mutate', 'mutation', 'clean_source', 'defect_source', 'oracle',
  'solver', 'twin', 'boundary-off-by-one', 'error-path-swallow',
  'default-fallback-widening', 'state-residue', 'ordering-contract',
  'precision-contract',
]);

function surfaceDoc(contract) {
  return contract.surface.functions.map((fn) => ({
    export_path: [fn.name],
    params: fn.params.map((p) => ({ name: p.name, domain: p.domain })),
  }));
}

function buildEnvelope(caseData, rendererId) {
  const envelope = {
    case_id: caseData.case_id,
    rendered_spec: renderSpec(caseData, rendererId),
    module_surface: surfaceDoc(caseData.contract),
    budget: CORPUS.budget.steps_per_case,
    plan_contract_ref: PLAN_CONTRACT.name,
  };
  return canonicalJson(envelope);
}

function leakScan(admin) {
  const violations = [];
  for (const trial of admin.trials) {
    for (const caseData of trial.cases) {
      const visible = caseData.envelope;
      const publicTokens = new Set();
      for (const fn of caseData.contract.surface.functions) {
        publicTokens.add(fn.name);
        for (const p of fn.params) {
          publicTokens.add(p.name);
          if (p.domain.values) {
            for (const v of p.domain.values) {
              if (typeof v === 'string') publicTokens.add(v);
            }
          }
        }
      }
      for (const hint of ORACLE_ONLY_STRINGS) {
        if (visible.includes(hint)) {
          violations.push({ case_id: caseData.case_id, tag: hint });
        }
      }
      // Any identifier-ish token present in the DEFECT source but absent from
      // both the clean source and the public surface is twin-distinguishing.
      const idTokens = (source) => new Set(source.match(/[A-Za-z_][A-Za-z0-9_]{3,}/gu) || []);
      const cleanIds = idTokens(caseData.clean_source);
      for (const t of idTokens(caseData.defect_source)) {
        if (!cleanIds.has(t) && !publicTokens.has(t) && visible.includes(t)) {
          violations.push({ case_id: caseData.case_id, tag: `defect-only:${t}` });
        }
      }
      if (visible.includes(caseData.canary)) {
        violations.push({ case_id: caseData.case_id, tag: 'canary' });
      }
    }
  }
  return violations;
}

// ── Administration assembly ──────────────────────────────────────────────────

function generateAdministration(adminSeed) {
  const trials = [];
  for (let t = 0; t < CORPUS.budget.trials_per_administration; t += 1) {
    const trialSeed = derive(adminSeed, `trial_${t}`);
    const cases = [];
    for (const familyName of CORPUS.families) {
      for (let c = 0; c < CORPUS.budget.cases_per_family_per_trial; c += 1) {
        const caseSeed = derive(trialSeed, `case:${familyName}:${c}`);
        const caseData = buildCase(familyName, caseSeed, c);
        const rendererId = CORPUS.renderers[
          integer(caseSeed, `renderer:assign`, 0, CORPUS.renderers.length)
        ];
        caseData.renderer_id = rendererId;
        caseData.canary = token(caseSeed, 'canary');
        caseData.envelope = buildEnvelope(caseData, rendererId);
        cases.push(caseData);
      }
    }
    // Interleave families deterministically: order by case-id hash.
    cases.sort((a, b) => (a.case_id < b.case_id ? -1 : 1));
    trials.push({ trial_id: token(trialSeed, 'trial'), trial_seed: trialSeed, cases });
  }
  const admin = { generatorVersion: GENERATOR_VERSION, admin_seed: adminSeed, trials };
  const leaks = leakScan(admin);
  if (leaks.length > 0) {
    throw new AdmissionError(`leak scan failed: ${JSON.stringify(leaks.slice(0, 5))}`);
  }
  return admin;
}

module.exports = {
  AdmissionError,
  CORPUS,
  FAMILIES,
  GENERATOR_VERSION,
  ORACLE_ONLY_STRINGS,
  PLAN_CONTRACT,
  buildEnvelope,
  canonicalJson,
  compileContract,
  evaluateCall,
  generateAdministration,
  initialState,
  invertRendered,
  leakScan,
  normalizeObserved,
  observationsEqual,
  oracleSequence,
  renderSpec,
};
