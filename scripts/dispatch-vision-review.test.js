'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

// Fixture repos never read the real global git config.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
const SCRIPT = path.join(__dirname, 'dispatch-vision-review.js');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const TOKEN = 'vision-rail-test-token-do-not-leak';

function gitRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function listen(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8'), headers: req.headers });
      handler(req, res, hits.at(-1));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
  });
}

function run(cwd, extraEnv, args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-home-'));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    AUTOPILOT_ENDPOINTS_ENV: path.join(home, 'missing.env'),
    ...extraEnv,
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr, home }));
  });
}

test('happy path sends image block and text', async () => {
  const { server, hits, port } = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      model: 'glm-5.3-flash',
      content: [{ type: 'text', text: 'score 4' }],
      usage: { input_tokens: 3, output_tokens: 2 },
    }));
  });
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  const prompt = path.join(repo, 'p.md');
  const out = path.join(repo, 'result.json');
  fs.writeFileSync(img, PNG);
  fs.writeFileSync(prompt, 'rate this screen');
  try {
    const r = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--image', img, '--prompt-file', prompt, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(hits.length, 1);
    const sent = JSON.parse(hits[0].body);
    assert.equal(sent.model, 'glm');
    assert.equal(sent.messages[0].content[0].type, 'image');
    assert.equal(sent.messages[0].content[0].source.media_type, 'image/png');
    assert.equal(sent.messages[0].content[1].text, 'rate this screen');
    const got = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(got.ok, true);
    assert.equal(got.model, 'glm-5.3-flash');
    assert.equal(got.endpoint, 'glm_local');
    assert.equal(got.text, 'score 4');
    assert.equal(got.images[0].name, 'a.png');
    assert.equal(got.images[0].bytes, PNG.length);
    const blob = `${r.stdout}\n${r.stderr}\n${fs.readFileSync(out, 'utf8')}`;
    assert.equal(blob.includes(TOKEN), false);
  } finally {
    server.close();
  }
});

test('non-local endpoint is refused and the stub receives nothing', async () => {
  const { server, hits, port } = await listen((_req, res) => { res.writeHead(200); res.end('{}'); });
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  const prompt = path.join(repo, 'p.md');
  const out = path.join(repo, 'result.json');
  fs.writeFileSync(img, PNG);
  fs.writeFileSync(prompt, 'x');
  try {
    const r = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `https://example.com:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--image', img, '--prompt-file', prompt, '--out', out]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /vision_rail_non_local_backend/);
    assert.equal(hits.length, 0);
    assert.equal(`${r.stdout}${r.stderr}`.includes(TOKEN), false);
  } finally {
    server.close();
  }
});

test('a resolver that is not ready sends nothing', async () => {
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  fs.writeFileSync(img, PNG);
  const r = await run(repo, {
    AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: 'http://localhost.invalid-scheme-test:1',
    AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    AUTOPILOT_LOCAL_GATEWAY_HOSTS: 'localhost.invalid-scheme-test',
  }, ['--image', img, '--prompt-file', img, '--out', path.join(repo, 'o.json')]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /vision_rail_endpoint_not_ready/);
});

test('--endpoint and --model are rejected', async () => {
  const { server, hits, port } = await listen((_req, res) => { res.writeHead(200); res.end('{}'); });
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  fs.writeFileSync(img, PNG);
  try {
    const a = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--endpoint', 'glm_local', '--image', img, '--prompt-file', img, '--out', path.join(repo, 'o.json')]);
    const b = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--model', 'glm', '--image', img, '--prompt-file', img, '--out', path.join(repo, 'o.json')]);
    assert.notEqual(a.status, 0);
    assert.notEqual(b.status, 0);
    assert.match(a.stderr, /unknown flag/);
    assert.equal(hits.length, 0);
  } finally { server.close(); }
});

test('a 3xx is not followed', async () => {
  const { server, hits, port } = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${port}/gone` });
    res.end('no');
  });
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  const prompt = path.join(repo, 'p.md');
  const out = path.join(repo, 'result.json');
  fs.writeFileSync(img, PNG);
  fs.writeFileSync(prompt, 'x');
  try {
    const r = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--image', img, '--prompt-file', prompt, '--out', out]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, '/v1/messages');
    const got = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(got.ok, false);
    assert.equal(got.status, 302);
    assert.equal(`${r.stdout}${r.stderr}${fs.readFileSync(out, 'utf8')}`.includes(TOKEN), false);
  } finally { server.close(); }
});

test('a 429 keeps the gateway reason, token masked', async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(`{"error":"rate limited for ${TOKEN}"}`);
  });
  const repo = gitRepo('thinksmart-vis-');
  const img = path.join(repo, 'a.png');
  const out = path.join(repo, 'result.json');
  fs.writeFileSync(img, PNG);
  try {
    const r = await run(repo, {
      AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${port}`,
      AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: TOKEN,
    }, ['--image', img, '--prompt-file', img, '--out', out]);
    assert.equal(r.status, 1, r.stderr);
    const got = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.match(got.error, /rate limited for \*\*\*/);
    assert.equal(got.error.includes(TOKEN), false);
  } finally { server.close(); }
});
