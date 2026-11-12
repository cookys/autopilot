'use strict';
/**
 * menu-card-content.js — redact, then truncate, a field that will leave this host.
 * redact() from hooks/_shared/secret-patterns.js runs on the whole field first.
 * A field that changed is replaced by a placeholder, then cut by code point.
 * Node built-ins plus that one helper. This module writes nothing.
 */
const PLACEHOLDER = '［內容疑似含憑證，已隱藏；請到 pane 查看］';

function redactThenTruncate(text, max) {
  const raw = String(text ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
  const redacted = require('../../hooks/_shared/secret-patterns.js').redact(raw);
  const body = redacted === raw ? raw : PLACEHOLDER;
  const limit = Number(max);
  if (Number.isInteger(limit) && limit >= 0 && Array.from(body).length > limit) {
    return Array.from(body).slice(0, limit).join('');
  }
  return body;
}

module.exports = { redactThenTruncate, PLACEHOLDER };
