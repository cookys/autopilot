'use strict';
// maskSecrets(text): replaces credential-looking strings with 〔已遮罩〕 before they are stored or shown.
// Matches: vendor-prefixed keys (sk-, ghp_, github_pat_, xox?-, AKIA, AIza, eyJ… JWT) and any 32+ character run of
// [A-Za-z0-9_-] that has a digit, a letter and at least one non-hex character (a pure 40/64-hex run is a git sha and stays).
const MASK = '〔已遮罩〕';
const PREFIXED = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;
function looksSecret(run) {
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run) && /[g-zG-Z_-]/.test(run) && !/^[A-Za-z]+(?:-[A-Za-z]+)*$/.test(run);
}
function maskSecrets(text) {
  if (typeof text !== 'string' || text === '') return text;
  return text.replace(PREFIXED, MASK).replace(LONG_RUN, run => (looksSecret(run) ? MASK : run));
}
module.exports = { maskSecrets, MASK };
