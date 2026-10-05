#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { TextDecoder } = require('util');

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'type',
  'additionalProperties',
  'required',
  'properties',
  'const',
  'enum',
  'oneOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'minimum',
  'format',
]);
const SUPPORTED_ABSOLUTE_ID = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[A-Za-z0-9._~-]+(?::[0-9]+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@-]*)*\/?$/u;
const SUPPORTED_LOCAL_REFERENCE = /^#\/(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*$/u;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function schemaError(message) {
  const error = new Error(message);
  error.code = 'UNSUPPORTED_JSON_SCHEMA';
  throw error;
}

function numberError(message) {
  const error = new Error(message);
  error.code = 'UNSUPPORTED_JSON_NUMBER';
  throw error;
}

function valueError(message) {
  const error = new Error(message);
  error.code = 'UNSUPPORTED_JSON_VALUE';
  throw error;
}

function inputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_JSON_INPUT';
  throw error;
}

function assertJsonValue(value, path, active = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    // A finite JS double round-trips losslessly through JSON.stringify/JSON.parse
    // by spec (ECMA-262 Number::toString is the unique shortest decimal that
    // reparses to the exact same double) — that guarantee holds for ANY finite
    // double, integer-valued or not, which is why a lossless NON-integer
    // literal (0.5, 1e-3, ...) is accepted regardless of magnitude. NaN/Infinity
    // are the only finite-JSON-incompatible doubles, so they're rejected here.
    if (!Number.isFinite(value)) {
      numberError(`${path} contains a number that is not finite (NaN/Infinity are not valid JSON)`);
    }
    // -0 is the one finite double whose canonical JSON serialization
    // (JSON.stringify(-0) === '0') drops information a caller may have set
    // deliberately (sign). Number.isSafeInteger(-0) is true and the literal
    // "-0" contains no '.'/'e'/'E', so neither the safe-integer nor the
    // fractional branch above catches it — reject it explicitly here so an
    // in-memory value built with -0 (not sourced from `parseNumber`, which
    // has its own -0 guard below) cannot slip past this lossless-round-trip
    // check.
    if (Object.is(value, -0)) {
      numberError(`${path} contains -0, whose canonical JSON serialization ("0") loses the sign`);
    }
    // An INTEGER-valued double beyond Number.MAX_SAFE_INTEGER is a different
    // hazard than a fractional one: round-tripping the double back through
    // JSON is still byte-lossless (per the note above), but the double no
    // longer distinguishably represents ITS OWN adjacent integers (e.g.
    // 2**53 and 2**53+1 collapse to the same double), so the JSON-integer
    // VALUE the caller intended is ambiguous even though the JS number isn't
    // corrupted. Fail closed with the same UNSUPPORTED_JSON_NUMBER code
    // `parseNumber` uses for an unsafe integer LITERAL, so an in-memory value
    // built directly (bypassing `parseNumber`/`readJson`, e.g. a caller that
    // hands validateJsonSchema a JS value instead of a JSON string) cannot
    // slip past this check and surface as a misleading "must have type
    // integer" schema-validation failure instead. Fractional doubles are
    // exempt: Number.isInteger(0.5) is false, so they fall through untouched.
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      numberError(`${path} contains an integer magnitude beyond Number.MAX_SAFE_INTEGER (${value}); adjacent integers are not distinguishably representable`);
    }
    return;
  }
  if (typeof value !== 'object') {
    valueError(`${path} contains unsupported ${typeof value}; only JSON data is accepted`);
  }
  if (active.has(value)) valueError(`${path} contains a cyclic object graph`);
  active.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      valueError(`${path} must be a plain JSON array`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1
      || keys.some((key, index) => (
        typeof key !== 'string'
        || (index < value.length ? key !== String(index) : key !== 'length')
      ))) {
      valueError(`${path} must be a dense JSON array without extra properties`);
    }
    value.forEach((entry, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        valueError(`${path}/${index} must be a plain JSON array element`);
      }
      assertJsonValue(descriptor.value, `${path}/${index}`, active);
    });
    active.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    valueError(`${path} must be a plain JSON object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') valueError(`${path} contains a symbol property`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      valueError(`${path}/${key} must be an enumerable plain JSON property`);
    }
    assertJsonValue(descriptor.value, `${path}/${key}`, active);
  }
  active.delete(value);
}

function preflightJsonSource(source, label) {
  let index = 0;
  const whitespace = /[ \t\r\n]/u;

  function fail(message) {
    inputError(`${label} is not supported JSON at offset ${index}: ${message}`);
  }

  function skipWhitespace() {
    while (index < source.length && whitespace.test(source[index])) index += 1;
  }

  function parseString() {
    if (source[index] !== '"') fail('expected a string');
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (error) {
          fail(`invalid string: ${error.message}`);
        }
      }
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) fail('unescaped control character in string');
      index += 1;
    }
    fail('unterminated string');
  }

  function parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      source.slice(index),
    );
    if (!match) fail('invalid number');
    const literal = match[0];
    if (/[.eE]/u.test(literal)) {
      // Non-integer literal: accept iff it round-trips losslessly — parse to a
      // double, canonically re-serialize (JSON.stringify uses the same
      // shortest-round-trip-decimal algorithm as the spec's Number::toString),
      // and require a byte-for-byte match against the original literal. A
      // literal whose exact decimal value cannot be recovered from its parsed
      // double (imprecise long decimals, exponents overflowing to Infinity,
      // reformatted exponents/trailing zeros) fails this compare and is
      // rejected with the same explicit UNSUPPORTED_JSON_NUMBER error as
      // before — the lossless guarantee is preserved, not dropped.
      const value = Number(literal);
      if (!Number.isFinite(value) || JSON.stringify(value) !== literal) {
        numberError(`${label} uses unsupported lossy numeric literal "${literal}"`);
      }
    } else {
      // Integer literal (no '.'/'e'/'E'): the same round-trip byte-compare
      // catches both magnitude loss (an unsafe integer like
      // "9007199254740993" reparses to a different double) AND sign loss —
      // "-0" parses to the double -0, whose canonical re-serialization is
      // "0" (JSON.stringify(-0) === '0'), so Number.isSafeInteger(-0) alone
      // (true, since -0 is an integer) would silently accept a literal that
      // does not round-trip losslessly. The byte-compare rejects it the same
      // way it rejects any other lossy literal.
      const value = Number(literal);
      if (!Number.isSafeInteger(value) || JSON.stringify(value) !== literal) {
        numberError(`${label} uses unsupported lossy numeric literal "${literal}"`);
      }
    }
    index += literal.length;
  }

  function parseArray(depth) {
    index += 1;
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return;
    }
    while (index < source.length) {
      parseValue(depth + 1);
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      if (source[index] !== ',') fail('expected comma or closing bracket');
      index += 1;
      skipWhitespace();
    }
    fail('unterminated array');
  }

  function parseObject(depth) {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (source[index] === '}') {
      index += 1;
      return;
    }
    while (index < source.length) {
      const key = parseString();
      if (keys.has(key)) inputError(`${label} contains duplicate JSON object key "${key}"`);
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ':') fail('expected colon after object key');
      index += 1;
      parseValue(depth + 1);
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      if (source[index] !== ',') fail('expected comma or closing brace');
      index += 1;
      skipWhitespace();
    }
    fail('unterminated object');
  }

  function parseValue(depth) {
    if (depth > 256) fail('nesting depth exceeds 256');
    skipWhitespace();
    const character = source[index];
    if (character === '"') {
      parseString();
      return;
    }
    if (character === '{') {
      parseObject(depth);
      return;
    }
    if (character === '[') {
      parseArray(depth);
      return;
    }
    if (character === '-' || /[0-9]/u.test(character || '')) {
      parseNumber();
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    fail('unexpected token');
  }

  parseValue(0);
  skipWhitespace();
  if (index !== source.length) fail('trailing content');
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    schemaError(`${path} must be a non-negative safe integer`);
  }
}

function assertSchemaNode(
  schema,
  path = '#',
  root = schema,
  activeNodes = new Set(),
  validatedNodes = new Set(),
) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    schemaError(`${path} must be a JSON Schema object`);
  }
  if (activeNodes.has(schema)) {
    schemaError(`${path} uses a recursive $ref, which this validator does not support`);
  }
  if (validatedNodes.has(schema)) return;
  activeNodes.add(schema);
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      schemaError(`${path} uses unsupported JSON Schema keyword "${keyword}"`);
    }
  }
  if (schema.$schema !== undefined
    && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    schemaError(`${path} supports only JSON Schema draft 2020-12`);
  }
  if (schema.$id !== undefined) {
    if (schema !== root) {
      schemaError(`${path} uses a nested $id resource, which this validator does not support`);
    }
    if (typeof schema.$id !== 'string' || !SUPPORTED_ABSOLUTE_ID.test(schema.$id)) {
      schemaError(`${path}.$id must be a supported absolute URI without query or fragment`);
    }
  }
  if (schema.title !== undefined && typeof schema.title !== 'string') {
    schemaError(`${path}.title must be a string`);
  }
  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== 'string' || !SUPPORTED_LOCAL_REFERENCE.test(schema.$ref)) {
      schemaError(`${path} supports only RFC-safe local JSON Pointer $ref values`);
    }
    const target = resolvePointer(root, schema.$ref);
    assertSchemaNode(
      target,
      `${path}/$ref(${schema.$ref})`,
      root,
      activeNodes,
      validatedNodes,
    );
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0
      || new Set(types).size !== types.length
      || types.some((type) => ![
        'object',
        'array',
        'string',
        'integer',
        'number',
        'boolean',
        'null',
      ].includes(type))) {
      schemaError(`${path}.type is unsupported`);
    }
  }
  if (schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== 'boolean') {
    schemaError(`${path}.additionalProperties must be boolean`);
  }
  if (schema.required !== undefined
    && (!Array.isArray(schema.required)
      || schema.required.some((entry) => typeof entry !== 'string'))) {
    schemaError(`${path}.required must be an array of strings`);
  }
  if (schema.required !== undefined
    && new Set(schema.required).size !== schema.required.length) {
    schemaError(`${path}.required must not contain duplicate values`);
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      schemaError(`${path}.enum must be a non-empty array`);
    }
    if (new Set(schema.enum.map(canonical)).size !== schema.enum.length) {
      schemaError(`${path}.enum must not contain duplicate values`);
    }
  }
  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) {
      schemaError(`${path}.oneOf must be a non-empty array`);
    }
    for (let index = 0; index < schema.oneOf.length; index += 1) {
      assertSchemaNode(
        schema.oneOf[index],
        `${path}/oneOf/${index}`,
        root,
        activeNodes,
        validatedNodes,
      );
    }
  }
  if (schema.minLength !== undefined) {
    assertNonNegativeInteger(schema.minLength, `${path}.minLength`);
  }
  if (schema.maxLength !== undefined) {
    assertNonNegativeInteger(schema.maxLength, `${path}.maxLength`);
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined
    && schema.minLength > schema.maxLength) {
    schemaError(`${path}.minLength must not exceed maxLength`);
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') {
      schemaError(`${path}.pattern must be a string`);
    }
    try {
      new RegExp(schema.pattern, 'u');
    } catch (error) {
      schemaError(`${path}.pattern is not a valid ECMAScript regular expression: ${error.message}`);
    }
  }
  if (schema.minItems !== undefined) {
    assertNonNegativeInteger(schema.minItems, `${path}.minItems`);
  }
  if (schema.maxItems !== undefined) {
    assertNonNegativeInteger(schema.maxItems, `${path}.maxItems`);
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined
    && schema.minItems > schema.maxItems) {
    schemaError(`${path}.minItems must not exceed maxItems`);
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
    schemaError(`${path}.uniqueItems must be boolean`);
  }
  if (schema.minimum !== undefined
    && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum))) {
    schemaError(`${path}.minimum must be a finite number`);
  }
  if (schema.format !== undefined && schema.format !== 'date-time') {
    schemaError(`${path} uses unsupported format "${schema.format}"`);
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== 'object'
      || Array.isArray(schema.properties)) {
      schemaError(`${path}.properties must be an object`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSchemaNode(
        child,
        `${path}/properties/${key}`,
        root,
        activeNodes,
        validatedNodes,
      );
    }
  }
  if (schema.$defs !== undefined) {
    if (!schema.$defs || typeof schema.$defs !== 'object' || Array.isArray(schema.$defs)) {
      schemaError(`${path}.$defs must be an object`);
    }
    for (const [key, child] of Object.entries(schema.$defs)) {
      assertSchemaNode(
        child,
        `${path}/$defs/${key}`,
        root,
        activeNodes,
        validatedNodes,
      );
    }
  }
  if (schema.items !== undefined) {
    assertSchemaNode(
      schema.items,
      `${path}/items`,
      root,
      activeNodes,
      validatedNodes,
    );
  }
  activeNodes.delete(schema);
  validatedNodes.add(schema);
}

function resolvePointer(root, reference) {
  let value = root;
  let pointer;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch (_error) {
    schemaError(`invalid percent escape in local JSON Schema reference "${reference}"`);
  }
  if (!pointer.startsWith('/')) {
    schemaError(`local JSON Schema reference "${reference}" is not a JSON Pointer`);
  }
  for (const raw of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(raw)) {
      schemaError(`invalid JSON Pointer escape in local JSON Schema reference "${reference}"`);
    }
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object'
      || !Object.prototype.hasOwnProperty.call(value, key)) {
      schemaError(`unresolved local JSON Schema reference "${reference}"`);
    }
    value = value[key];
  }
  return value;
}

function typeMatches(value, type) {
  if (Array.isArray(type)) return type.some((candidate) => typeMatches(value, candidate));
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  return typeof value === type;
}

function isUtcDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

function evaluate(schema, value, root, path, errors) {
  if (schema.$ref !== undefined) {
    evaluate(resolvePointer(root, schema.$ref), value, root, path, errors);
  }
  if (schema.oneOf !== undefined) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      const candidateErrors = [];
      evaluate(candidate, value, root, path, candidateErrors);
      if (candidateErrors.length === 0) matches += 1;
    }
    if (matches !== 1) {
      errors.push(`${path} must match exactly one oneOf branch; matched ${matches}`);
    }
  }
  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    errors.push(`${path} must have type ${schema.type}`);
    return;
  }
  if (schema.const !== undefined && canonical(value) !== canonical(schema.const)) {
    errors.push(`${path} must equal ${canonical(schema.const)}`);
  }
  if (schema.enum !== undefined
    && !schema.enum.some((candidate) => canonical(candidate) === canonical(value))) {
    errors.push(`${path} must be one of ${schema.enum.map(canonical).join(', ')}`);
  }
  if (typeof value === 'string') {
    const characterLength = [...value].length;
    if (schema.minLength !== undefined && characterLength < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && characterLength > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path} does not match ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !isUtcDateTime(value)) {
      errors.push(`${path} must be a UTC date-time`);
    }
  }
  if (typeof value === 'number'
    && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true
      && new Set(value.map((entry) => canonical(entry))).size !== value.length) {
      errors.push(`${path} must contain unique items`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => evaluate(
        schema.items,
        entry,
        root,
        `${path}/${index}`,
        errors,
      ));
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${path}/${key} is required`);
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        evaluate(properties[key], entry, root, `${path}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}/${key} is not allowed`);
      }
    }
  }
}

function validateJsonSchema(schema, document) {
  assertJsonValue(schema, 'schema');
  assertJsonValue(document, 'document');
  assertSchemaNode(schema);
  const errors = [];
  evaluate(schema, document, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

function readJson(file, label) {
  let source;
  try {
    const bytes = fs.readFileSync(file);
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    const wrapped = new Error(`${label} is not readable JSON: ${error.message}`);
    wrapped.code = 'INVALID_JSON_INPUT';
    throw wrapped;
  }
  preflightJsonSource(source, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    const wrapped = new Error(`${label} is not readable JSON: ${error.message}`);
    wrapped.code = 'INVALID_JSON_INPUT';
    throw wrapped;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--schema', '--document'].includes(flag) || value === undefined) {
      throw new Error('usage: validate-json-schema.js --schema <schema.json> --document <document.json>');
    }
    const key = flag.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`duplicate option ${flag}`);
    }
    options[key] = value;
  }
  if (!options.schema || !options.document) {
    throw new Error('usage: validate-json-schema.js --schema <schema.json> --document <document.json>');
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv);
    const result = validateJsonSchema(
      readJson(options.schema, 'schema'),
      readJson(options.document, 'document'),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.code || 'SCHEMA_VALIDATION_ERROR'}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  SUPPORTED_KEYWORDS,
  assertJsonValue,
  assertSchemaNode,
  preflightJsonSource,
  readJson,
  validateJsonSchema,
};
