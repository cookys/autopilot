'use strict';
/**
 * fleet-peers.js — the one parser for `fleet peers --json`.
 *
 * Real stdout (read-only `fleet peers --json`) is an object:
 *   { members: [ { member, courier, namespace, state, activity?, ... } ] }
 * `state` is "live" or "offline". A session row also carries `activity`
 * (observed value "idle"); offline rows omit it. Other keys (channels,
 * message_kinds, lifetime, …) are ignored. A bare array is accepted.
 *
 * Seat match: the member name, courier/member, or the full address
 * namespace/courier/member.
 * Live: state "live", any other non-empty state, or a non-empty activity
 * when state is absent. Offline (state or activity "offline") is not live.
 * Node >= 20.10, built-ins only. This module runs no command.
 */
function parsePeers(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout ?? '')); } catch { return null; }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.members)) return parsed.members;
  return null;
}

function rowMatchesSeat(row, seat) {
  if (!row || typeof row !== 'object' || typeof row.member !== 'string' || typeof seat !== 'string' || !seat) return false;
  if (row.member === seat) return true;
  if (typeof row.courier === 'string' && `${row.courier}/${row.member}` === seat) return true;
  if (typeof row.namespace === 'string' && typeof row.courier === 'string'
    && `${row.namespace}/${row.courier}/${row.member}` === seat) return true;
  return false;
}

function matchingSeats(members, seat) {
  if (!Array.isArray(members)) return [];
  return members.filter((row) => rowMatchesSeat(row, seat));
}

function isOffline(row) {
  if (!row || typeof row !== 'object') return false;
  return row.state === 'offline' || row.activity === 'offline';
}

function isLive(row) {
  if (!row || typeof row !== 'object' || isOffline(row)) return false;
  if (row.state === 'live') return true;
  if (typeof row.state === 'string' && row.state.length > 0) return true;
  return typeof row.activity === 'string' && row.activity.length > 0;
}

module.exports = { parsePeers, rowMatchesSeat, matchingSeats, isOffline, isLive };
