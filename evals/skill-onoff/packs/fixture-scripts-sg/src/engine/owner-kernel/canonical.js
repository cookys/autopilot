'use strict';

const crypto = require('crypto');

function assertJsonString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('canonical JSON rejects lone high-surrogate characters');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('canonical JSON rejects lone low-surrogate characters');
    }
  }
}

function canonicalJson(value, path = '$') {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonical JSON rejects non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case 'string':
      assertJsonString(value);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonical JSON rejects ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    const values = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`canonical JSON rejects sparse array at ${path}`);
      }
      values.push(canonicalJson(value[index], `${path}[${index}]`));
    }
    return `[${values.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`canonical JSON accepts plain objects only at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`canonical JSON rejects symbol properties at ${path}`);
  }

  const keys = Object.keys(value).sort();
  const entries = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`canonical JSON rejects accessor property at ${path}.${key}`);
    }
    assertJsonString(key);
    entries.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value, `${path}.${key}`)}`);
  }
  return `{${entries.join(',')}}`;
}

function sha256(value) {
  const source = typeof value === 'string' ? value : canonicalJson(value);
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

module.exports = {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
};
