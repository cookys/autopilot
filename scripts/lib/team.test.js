'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const team = require('./team.js');

function withHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-role-'));
  const prev = {
    HOME: process.env.HOME,
    AUTOPILOT_COURIER: process.env.AUTOPILOT_COURIER,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.HOME = dir;
  delete process.env.AUTOPILOT_COURIER;
  delete process.env.XDG_CONFIG_HOME;
  try {
    return fn(dir);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTeam(dir, body) {
  const d = path.join(dir, '.autopilot');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'team.json'), body);
}

test('missing file + courier is lane', () => {
  withHome(() => {
    process.env.AUTOPILOT_COURIER = '1';
    const r = team.resolve();
    assert.equal(r.role, 'lane');
    assert.equal(r.source, 'default');
  });
});

test('missing file + courier marker under this home is lane', () => {
  withHome((dir) => {
    const marker = path.join(dir, '.config', 'fleet');
    fs.mkdirSync(marker, { recursive: true });
    fs.writeFileSync(path.join(marker, 'hub.toml'), 'hub = "local"\n');
    assert.equal(team.resolve().role, 'lane');
  });
});

test('missing file and no courier is solo', () => {
  withHome(() => {
    process.env.AUTOPILOT_COURIER = '0';
    assert.equal(team.resolve().role, 'solo');
    assert.equal(team.courierPresent(), false);
  });
});

test('a courier marker outside this home is not this home', () => {
  withHome(() => {
    process.env.XDG_CONFIG_HOME = path.join(os.tmpdir(), 'not-this-home-xdg');
    assert.equal(team.courierPresent(), false);
    assert.equal(team.resolve().role, 'solo');
  });
});

test('explicit solo is solo', () => {
  withHome((dir) => {
    process.env.AUTOPILOT_COURIER = '1';
    writeTeam(dir, '{"role":"solo"}\n');
    const r = team.resolve();
    assert.equal(r.role, 'solo');
    assert.equal(r.source, 'file');
  });
});

test('explicit pm, lane and lead are honored', () => {
  withHome((dir) => {
    writeTeam(dir, '{"role":" PM ","pm":" ns/courier/pm "}\n');
    let r = team.resolve();
    assert.equal(r.role, 'pm');
    assert.equal(r.pm, 'ns/courier/pm');
    writeTeam(dir, '{"role":"lane"}\n');
    assert.equal(team.resolve().role, 'lane');
    writeTeam(dir, '{"role":"lead","pm":""}\n');
    r = team.resolve();
    assert.equal(r.role, 'lead');
    assert.equal(r.pm, null);
  });
});

test('bad JSON is lane', () => {
  withHome((dir) => {
    writeTeam(dir, '{');
    const r = team.resolve();
    assert.equal(r.role, 'lane');
    assert.equal(r.source, 'bad-json');
  });
});

test('missing or unknown role is lane', () => {
  withHome((dir) => {
    writeTeam(dir, '{}');
    assert.equal(team.resolve().source, 'bad-role');
    assert.equal(team.resolve().role, 'lane');
    writeTeam(dir, '{"role":"operator"}');
    assert.equal(team.resolve().role, 'lane');
  });
});

test('unreadable team file is lane', () => {
  withHome((dir) => {
    fs.mkdirSync(path.join(dir, '.autopilot', 'team.json'), { recursive: true });
    const r = team.resolve();
    assert.equal(r.role, 'lane');
    assert.equal(r.source, 'unreadable');
  });
});
