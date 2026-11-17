'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const script = path.join(__dirname, 'safe-inspect.js');
const fake = 'FAKE-S3CRET-do-not-print-91';
const expected = `***len=27 sha8=${createHash('sha256').update(fake).digest('hex').slice(0, 8)}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-inspect-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { PATH: path.dirname(process.execPath), ...env },
  });
}
function masked(result) {
  assert.equal(result.status, 0, 'viewer must succeed');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fake), 'fake value must never reach either stream');
  assert.ok(result.stdout.includes(expected), 'mask includes true length and SHA-256 prefix');
}
test('safe-inspect env masks every value, even innocently named ones', () => {
  const r = run(['env'], { APP_SETTING: fake, PASSWORD: fake });
  masked(r);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.APP_SETTING, expected);
  assert.equal(obj.PASSWORD, expected);
});
for (const [name, content, key] of [
  ['fixture.env', `PASSWORD=${fake}\nexport DB_PASS='${fake}'\n`, 'PASSWORD='],
  ['fixture.php', `<?php\ndefine('DB_PASSWORD', '${fake}');\n$db_pass = '${fake}';\n`, 'DB_PASSWORD'],
  ['fixture.h', `#define DB_PASSWORD "${fake}"\n#define TIMEOUT 30\n`, '#define DB_PASSWORD'],
  ['fixture.json', JSON.stringify({ ordinary: fake, nested: { password: fake }, list: [fake, 42, true, null] }), 'ordinary'],
  ['fixture.yaml', `database:\n  password: ${fake}\n  list:\n    - ${fake}\n  cert: |\n    ${fake}\n`, 'password:'],
  ['fixture.unknown', `# ${fake}\n${fake}\n`, '***len='],
]) {
  test(`safe-inspect file masks ${name} and preserves keys`, () => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, content);
    const r = run(['file', file]);
    masked(r);
    assert.ok(r.stdout.includes(key));
    if (name.endsWith('.json')) {
      const obj = JSON.parse(r.stdout);
      assert.equal(obj.nested.password, expected);
      assert.equal(obj.list.length, 4);
      assert.ok(obj.list.every((v) => typeof v === 'string' && v.startsWith('***len=')));
    }
  });
}
test('safe-inspect docker invokes inspect itself and masks Env, secret keys, URL userinfo and other values', () => {
  const bin = path.join(tmp, 'docker-bin');
  fs.mkdirSync(bin);
  const stub = path.join(bin, 'docker');
  fs.writeFileSync(stub, `#!${process.execPath}\nif (process.argv[2] !== 'inspect' || process.argv[3] !== '--' || process.argv[4] !== 'web') process.exit(9);\nprocess.stdout.write(${JSON.stringify(JSON.stringify([{ Config: {
    Env: [`PASSWORD=${fake}`, `NORMAL=${fake}`], password: fake, passwd: fake,
    secret: fake, token: fake, key: fake, credential: fake, dsn: fake,
    url: `postgres://user:${fake}@db/app`, ordinary: fake,
  }, State: { Running: true } }]))});\n`);
  fs.chmodSync(stub, 0o700);
  const r = run(['docker', 'web'], { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}` });
  masked(r);
  const obj = JSON.parse(r.stdout)[0];
  assert.equal(obj.Config.Env[0], `PASSWORD=${expected}`);
  assert.equal(obj.Config.Env[1], `NORMAL=${expected}`);
  assert.equal(obj.Config.password, expected);
  assert.ok(obj.Config.url.startsWith('***len='));
});
test('safe-inspect errors never echo child stderr, JSON parse snippets, paths or invalid arguments', () => {
  const bin = path.join(tmp, 'error-bin');
  fs.mkdirSync(bin);
  const stub = path.join(bin, 'docker');
  for (const body of [
    `process.stderr.write(${JSON.stringify(fake)}); process.exit(3);`,
    `process.stdout.write(${JSON.stringify(fake)});`,
  ]) {
    fs.writeFileSync(stub, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
    const r = run(['docker', 'web'], { PATH: bin });
    assert.notEqual(r.status, 0);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(fake));
    assert.equal(r.stdout, '');
  }
  for (const args of [['file', path.join(tmp, fake)], ['unknown', fake], ['env', fake]]) {
    const r = run(args);
    assert.notEqual(r.status, 0);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(fake));
  }
});
