'use strict';
// lead-exam transport: one single-shot, no-tools call through scripts/qualification-review-provider.js
// (QRP_TRANSPORT=cli, QRP_PROMPT_MODE=lead). Used for both the examinee and the judge.
// The child gets a scrubbed environment: PATH, HOME, LANG, the QRP_* settings built here, and only the
// auth-directory variables the caller names in `passEnv`. It never reads any credentials file itself.
const { spawn } = require('child_process');
const path = require('path');

const PROVIDER = path.join(__dirname, '..', '..', 'scripts', 'qualification-review-provider.js');

function estimateTokens(s) { return Math.ceil(String(s || '').length / 4); }

// opts: {kind, model, timeoutMs, passEnv:{NAME:value}, providerBin?, cliBin?}
function callProvider(prompt, opts) {
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: process.env.LANG || 'C.UTF-8',
    QRP_TRANSPORT: 'cli',
    QRP_CLI_KIND: opts.kind,
    QRP_MODEL: opts.model,
    QRP_PROVIDER: 'leadexam',
    QRP_PROMPT_MODE: 'lead',
    QRP_TIMEOUT_MS: String(opts.timeoutMs),
    ...(opts.cliBin ? { QRP_CLI_BIN: opts.cliBin } : {}),
    ...(opts.passEnv || {}),
  };
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [opts.providerBin || PROVIDER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let done = false;
    const kill = setTimeout(() => { if (!done) { child.kill('SIGKILL'); } }, opts.timeoutMs + 15000);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => { done = true; clearTimeout(kill); reject(e); });
    child.on('close', (code) => {
      done = true; clearTimeout(kill);
      const ms = Date.now() - started;
      if (code !== 0) { reject(Object.assign(new Error(`provider exit ${code}: ${err.trim().slice(0, 300)}`), { ms })); return; }
      let parsed;
      try { parsed = JSON.parse(out); } catch { reject(Object.assign(new Error('provider stdout is not JSON'), { ms })); return; }
      resolve({
        text: String(parsed.output || ''),
        ms,
        in_tokens_est: estimateTokens(prompt),
        out_tokens_est: estimateTokens(parsed.output),
        usage: parsed.usage || null,
      });
    });
    child.stdin.end(JSON.stringify({
      schema_version: 1,
      request_id: `leadexam-${started}`,
      role: 'lead',
      payload: { format: 'case_content', content: prompt },
    }));
  });
}

module.exports = { callProvider, estimateTokens, PROVIDER };
