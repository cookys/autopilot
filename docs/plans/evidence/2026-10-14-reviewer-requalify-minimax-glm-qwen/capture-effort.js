#!/usr/bin/env node
'use strict';
// capture-effort.js <repoRoot> <model> <effort|default> <thinking|default> <outFile>
// Runs the real scripts/qualification-review-provider.js (messages protocol) against a LOCAL capture server and
// records what the first request actually carried on the wire (model, max_tokens, output_config, thinking; the system
// prompt and the user message are reduced to lengths; no token is ever written). No network, no spend.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const [repo, model, effort, thinking, outFile] = process.argv.slice(2);
const captured = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* keep empty */ }
    captured.push({
      path: req.url,
      anthropic_version: req.headers['anthropic-version'] || null,
      model: body.model,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      output_config: body.output_config === undefined ? '<absent>' : body.output_config,
      thinking: body.thinking === undefined ? '<absent>' : body.thinking,
      system_chars: String(body.system || '').length,
      user_chars: JSON.stringify(body.messages || []).length,
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: body.model, stop_reason: 'end_turn', usage: { output_tokens: 1 }, content: [{ type: 'text', text: '{"verdict":"pass","findings":[]}' }] }));
  });
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    QRP_BASE_URL: `http://127.0.0.1:${port}`, QRP_AUTH_TOKEN: 'capture-not-a-token',
    QRP_MODEL: model, QRP_PROVIDER: 'capture-anthropic', QRP_PROMPT_MODE: 'reviewer', QRP_MAX_TOKENS: '32768',
  };
  if (effort !== 'default') env.QRP_HTTP_EFFORT = effort;
  if (thinking !== 'default') env.QRP_HTTP_THINKING = thinking;
  const diff = 'diff --git a/x.cjs b/x.cjs\n--- a/x.cjs\n+++ b/x.cjs\n@@ -1 +1 @@\n-a\n+b\n';
  const child = spawn('node', [path.join(repo, 'scripts/qualification-review-provider.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.stdin.end(JSON.stringify({ schema_version: 1, request_id: 'capture-1', role: 'reviewer', payload: { format: 'case_content', content: diff } }));
  child.on('close', (code) => {
    server.close();
    const rec = { requested: { model, effort, thinking }, provider_exit: code, provider_stderr: err.slice(0, 300), first_request: captured[0] || null, requests_seen: captured.length };
    fs.writeFileSync(outFile, JSON.stringify(rec, null, 2) + '\n');
    console.log(JSON.stringify(rec.first_request), 'exit=' + code);
  });
});
