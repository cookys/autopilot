'use strict';
// A session is { id, user, createdAt }. Today it is valid for a fixed eight hours.
const TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
function create(user, now = Date.now()) {
  const s = { id: 's' + (sessions.size + 1), user, createdAt: now };
  sessions.set(s.id, s);
  return s;
}
function get(id, now = Date.now()) {
  const s = sessions.get(id);
  if (!s) return null;
  if (now - s.createdAt > TTL_MS) { sessions.delete(id); return null; }
  return s;
}
module.exports = { create, get, TTL_MS };
