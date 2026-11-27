#!/usr/bin/env node
'use strict';
// Send UX screenshots to the local GLM gateway for a reference score.
// Endpoint, model, role and runner are fixed. There is no --endpoint / --url / --model flag.
//
//   node scripts/dispatch-vision-review.js --image a.png [--image b.png ...] \
//     --prompt-file p.md --out result.json [--max-tokens N] [--timeout-s N]
//
// Exit: 0 ok; 1 HTTP or non-JSON (out file ok:false); 2 usage or precondition; 3 gate or non-local.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadEndpointsEnv } = require('./lib/load-endpoints-env');
const gate = require('./lib/cn-model-dispatch-gate');

const ENDPOINT = 'glm_local';
const MODEL = 'glm';
const ROLE = 'ux-reference-reviewer';
const RUNNER = 'cc-shim';
const MAX_IMAGES = 40;
const MAX_BYTES = 8 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { images: [], promptFile: '', outFile: '', maxTokens: 4096, timeoutS: 120 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--image requires a path' };
      out.images.push(v);
    } else if (a === '--prompt-file') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--prompt-file requires a path' };
      out.promptFile = v;
    } else if (a === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--out requires a path' };
      out.outFile = v;
    } else if (a === '--max-tokens') {
      const v = argv[++i];
      if (!/^[1-9]\d*$/.test(v || '')) return { error: '--max-tokens requires a positive integer' };
      out.maxTokens = Number(v);
    } else if (a === '--timeout-s') {
      const v = argv[++i];
      if (!/^[1-9]\d*$/.test(v || '')) return { error: '--timeout-s requires a positive integer' };
      out.timeoutS = Number(v);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      return { error: `unknown flag: ${a}` };
    }
  }
  if (!out.help) {
    if (!out.images.length) return { error: 'at least one --image is required' };
    if (out.images.length > MAX_IMAGES) return { error: `at most ${MAX_IMAGES} images` };
    if (!out.promptFile) return { error: '--prompt-file is required' };
    if (!out.outFile) return { error: '--out is required' };
  }
  return out;
}

function mediaType(buf) {
  if (buf.length >= PNG.length && buf.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (buf.length >= JPEG.length && buf.subarray(0, JPEG.length).equals(JPEG)) return 'image/jpeg';
  return '';
}

function inspectImage(file) {
  let st;
  try { st = fs.statSync(file); } catch { return { error: `image not found: ${file}` }; }
  if (!st.isFile()) return { error: `image is not a file: ${file}` };
  if (st.size > MAX_BYTES) return { error: `image exceeds 8 MB: ${file}` };
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(8);
  let n = 0;
  try { n = fs.readSync(fd, head, 0, 8, 0); } finally { fs.closeSync(fd); }
  const type = mediaType(head.subarray(0, n));
  if (!type) return { error: `image is not PNG or JPEG: ${file}` };
  return { file, bytes: st.size, mediaType: type, name: path.basename(file) };
}

function resolveEndpoint() {
  const script = path.join(__dirname, 'resolve-endpoint.sh');
  const r = spawnSync('bash', [script, ENDPOINT], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(String(r.stdout || '').split('\n').find((s) => s.startsWith('{')) || 'null'); } catch { parsed = null; }
  if (!parsed || !parsed.base_url) fail(2, 'vision_rail_endpoint_unresolved');
  if (!parsed.token_env || parsed.token_present !== true) fail(2, 'vision_rail_endpoint_unresolved');
  return parsed;
}

function postOnce(baseUrl, body, token, timeoutS) {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/v1/messages');
  const lib = url.protocol === 'https:' ? https : http;
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        authorization: `Bearer ${token}`,
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
      },
      timeout: timeoutS * 1000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.code || 'request_error' }));
    req.end(payload);
  });
}

function textOf(parsed) {
  const blocks = parsed && parsed.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) fail(2, args.error);
  if (args.help) {
    process.stdout.write('usage: node scripts/dispatch-vision-review.js --image a.png --prompt-file p.md --out result.json [--max-tokens N] [--timeout-s N]\n');
    return;
  }
  const images = [];
  for (const file of args.images) {
    const info = inspectImage(file);
    if (info.error) fail(2, info.error);
    images.push(info);
  }
  let prompt;
  try { prompt = fs.readFileSync(args.promptFile, 'utf8'); } catch { fail(2, `prompt not found: ${args.promptFile}`); }

  const loaded = loadEndpointsEnv({ env: process.env });
  if (loaded.rejected) fail(2, 'vision_rail_endpoints_env_rejected');
  const resolved = resolveEndpoint();
  const host = gate.hostOf(resolved.base_url);
  if (!host || !gate.isLocalHost(host, process.env)) fail(3, 'vision_rail_non_local_backend');

  const decision = gate.check({
    runner: RUNNER,
    model: 'glm-5.3-flash',
    endpoint: ENDPOINT,
    role: ROLE,
    cwd: process.cwd(),
    env: process.env,
  });
  if (!decision.allowed) fail(3, decision.line || 'cn_model_dispatch_barred');

  const token = process.env[resolved.token_env] || '';
  if (!token) fail(2, 'vision_rail_endpoint_unresolved');

  const imageMeta = [];
  const blocks = [];
  for (const info of images) {
    const buf = fs.readFileSync(info.file);
    if (buf.length !== info.bytes || !mediaType(buf)) fail(2, `image is not PNG or JPEG: ${info.file}`);
    imageMeta.push({ name: info.name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: info.mediaType, data: buf.toString('base64') } });
  }
  blocks.push({ type: 'text', text: prompt });

  const result = await postOnce(resolved.base_url, {
    model: MODEL,
    max_tokens: args.maxTokens,
    messages: [{ role: 'user', content: blocks }],
  }, token, args.timeoutS);

  const at = new Date().toISOString();
  const base = { endpoint: ENDPOINT, images: imageMeta, at };
  const status = result.status;
  if (status >= 300 && status < 400) {
    writeOut(args.outFile, { ok: false, model: '', text: '', usage: null, status, ...base });
    process.stdout.write(`vision-review fail status=${status} images=${imageMeta.length}\n`);
    process.exit(1);
  }
  if (status < 200 || status >= 300) {
    writeOut(args.outFile, { ok: false, model: '', text: '', usage: null, status, ...base });
    process.stdout.write(`vision-review fail status=${status} images=${imageMeta.length}\n`);
    process.exit(1);
  }
  let parsed;
  try { parsed = JSON.parse(result.body); } catch {
    writeOut(args.outFile, { ok: false, model: '', text: '', usage: null, status, ...base });
    process.stdout.write(`vision-review fail status=${status} images=${imageMeta.length}\n`);
    process.exit(1);
  }
  const record = {
    ok: true,
    model: parsed.model || '',
    endpoint: ENDPOINT,
    text: textOf(parsed),
    usage: parsed.usage || null,
    images: imageMeta,
    at,
  };
  writeOut(args.outFile, record);
  process.stdout.write(`vision-review ok model=${record.model} images=${imageMeta.length}\n`);
}

function writeOut(file, obj) {
  const text = `${JSON.stringify(obj)}\n`;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

main().catch((e) => fail(1, e && e.code ? String(e.code) : 'vision_rail_failed'));
