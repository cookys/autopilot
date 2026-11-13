'use strict';
// Parser for `fleet peers --json`. Fixtures follow the live object shape
// ({ members: [{ member, namespace, courier, state, activity? }] }) with fake names.
const test = require('node:test');
const assert = require('node:assert');
const { parsePeers, rowMatchesSeat, matchingSeats, isLive, isOffline } = require('./fleet-peers.js');

function row(over) {
  const base = {
    member: 'lane--claude',
    channels: ['ns'],
    message_kinds: ['chat', 'dispatch'],
    state: 'live',
    courier: 'box',
    namespace: 'ns',
    lifetime: 'durable',
    activity: 'idle',
  };
  return { ...base, ...over };
}

test('parsePeers reads { members } and a bare array; bad JSON is null', () => {
  const offline = row({ member: 'other-seat', state: 'offline' });
  delete offline.activity;
  const members = parsePeers(JSON.stringify({ members: [row(), offline] }));
  assert.strictEqual(members.length, 2);
  assert.strictEqual(members[0].state, 'live');
  assert.strictEqual(members[1].activity, undefined);
  assert.strictEqual(parsePeers(JSON.stringify([row()])).length, 1);
  assert.strictEqual(parsePeers('not json'), null);
  assert.strictEqual(parsePeers('{"members":null}'), null);
});

test('a seat matches the member name, courier/member, and the full address', () => {
  const live = row();
  assert.strictEqual(rowMatchesSeat(live, 'lane--claude'), true);
  assert.strictEqual(rowMatchesSeat(live, 'box/lane--claude'), true);
  assert.strictEqual(rowMatchesSeat(live, 'ns/box/lane--claude'), true);
  assert.strictEqual(rowMatchesSeat(live, 'ns/other/lane--claude'), false);
  assert.strictEqual(rowMatchesSeat(live, 'other-seat'), false);
  const hits = matchingSeats([live, row({ member: 'other-seat', courier: 'box' })], 'ns/box/lane--claude');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].member, 'lane--claude');
});

test('live is state live or a present activity; offline wins', () => {
  assert.strictEqual(isLive(row()), true);
  const noActivity = row();
  delete noActivity.activity;
  assert.strictEqual(isLive(noActivity), true);
  const offline = row({ state: 'offline' });
  delete offline.activity;
  assert.strictEqual(isOffline(offline), true);
  assert.strictEqual(isLive(offline), false);
  assert.strictEqual(isOffline(row({ activity: 'offline' })), true);
  assert.strictEqual(isLive(row({ activity: 'offline' })), false);
  const activityOnly = row();
  delete activityOnly.state;
  assert.strictEqual(isLive(activityOnly), true);
  const blank = row();
  delete blank.state;
  delete blank.activity;
  assert.strictEqual(isLive(blank), false);
  assert.strictEqual(isOffline(blank), false);
  const otherState = row({ state: 'busy' });
  delete otherState.activity;
  assert.strictEqual(isLive(otherState), true);
});
