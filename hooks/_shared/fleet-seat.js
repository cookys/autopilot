'use strict';

const fs = require('fs');
const path = require('path');
const { ownerAddress, whoamiSession } = require('../../scripts/lib/fleet-task.js');
const { userRuntimeBase, ensurePrivateDir } = require('../../scripts/lib/runtime-paths.js');

function seatFromFleetAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';
  const member = addr.split('/').pop().replace(/@.*$/, '');
  if (member === 'pm--claude') return 'pm';
  if (member.endsWith('-lead--claude') || member === 'hangar--claude') return 'lead';
  return '';
}

const processResults = new Map();

function resolveFleetSeat(input) {
  if (process.env.FLEET_ADDRESS || process.env.AUTOPILOT_FLEET_ADDRESS) {
    const addr = ownerAddress() || String(process.env.AUTOPILOT_FLEET_ADDRESS).replace(/@.*$/, '').trim();
    if (addr) return seatFromFleetAddress(addr) || 'other';
  }
  const sessionId = String(process.env.CLAUDE_CODE_SESSION_ID || (input && input.session_id) || '').trim();
  if (!sessionId) return '';
  if (processResults.has(sessionId)) return processResults.get(sessionId);

  let cacheFile = null;
  let cache = {};
  try {
    const base = userRuntimeBase(process.env);
    const ensured = base.startsWith('/tmp/') ? { ok: false } : ensurePrivateDir(base);
    if (ensured.ok) {
      cacheFile = path.join(ensured.path, 'mechanical-reroute-seat-cache.json');
      if (fs.existsSync(cacheFile)) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          cache = parsed;
          if (Object.prototype.hasOwnProperty.call(cache, sessionId)) {
            const cached = cache[sessionId];
            const result = cached === 'none' ? 'other' : cached;
            processResults.set(sessionId, result);
            return result;
          }
        }
      }
    }
  } catch {
    // fail-open on cache read
  }

  let seat = '';
  let answered = false;
  try {
    const res = whoamiSession(sessionId, { timeoutMs: 1500 });
    if (res.ok && res.address) {
      seat = seatFromFleetAddress(res.address);
      answered = true;
    }
  } catch {
    seat = '';
  }

  // Cache only a real answer: a courier hiccup must not pin a PM session as "not covered" for its whole life.
  if (cacheFile && answered) {
    try {
      cache[sessionId] = seat || 'none';
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // fail-open on cache write
    }
  }
  const result = answered ? (seat || 'other') : '';
  processResults.set(sessionId, result);
  return result;
}


module.exports = { resolveFleetSeat };
