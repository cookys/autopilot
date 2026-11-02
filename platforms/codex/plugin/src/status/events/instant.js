'use strict';

// src/status/events/instant.js - the ONE timestamp grammar of the events feed (autopilot.events/1).
//
// parseInstant(str) -> normalised UTC `.sssZ` string, or null.
// Input grammar: an RFC 3339 instant  YYYY-MM-DDTHH:MM:SS[.f{1,9}](Z|+HH:MM|-HH:MM)  (second or finer precision),
// whose calendar fields survive a UTC round trip (02-30, 24:00 and a leap second :60 are rejected, the same
// discipline as strictIsoMs in src/status/decisions-sidecar.js). Sub-millisecond digits are truncated, not rounded.
// Lenient Date.parse forms ("Nov 2", a space separator, a date only, epoch numbers, lower-case t/z) are rejected:
// the feed never invents a time. Pure function, no I/O.

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

// -> epoch ms (integer) or null.
function parseInstantMs(value) {
  if (typeof value !== 'string') return null;
  const m = INSTANT.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, 0);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day
    || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) return null;
  let offsetMs = 0;
  if (m[8] !== 'Z') {
    const offsetHour = Number(m[9]);
    const offsetMinute = Number(m[10]);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMs = (offsetHour * 60 + offsetMinute) * 60000 * (m[8][0] === '-' ? -1 : 1);
  }
  const fraction = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  const epoch = wall.getTime() + fraction - offsetMs;
  // Outside 0000..9999 toISOString would print an expanded year the envelope pattern does not allow.
  const shifted = new Date(epoch);
  if (!Number.isFinite(epoch) || shifted.getUTCFullYear() < 0 || shifted.getUTCFullYear() > 9999) return null;
  return epoch;
}

function parseInstant(value) {
  const epoch = parseInstantMs(value);
  return epoch === null ? null : new Date(epoch).toISOString();
}

module.exports = { parseInstant, parseInstantMs };
