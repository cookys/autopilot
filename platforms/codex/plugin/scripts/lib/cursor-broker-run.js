#!/usr/bin/env node
'use strict';
// Invoked ONLY through dispatch-hetero's group-wrapper seam. Every shared-root
// and socket operation lives here, including cleanup of the clone we create.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const client = require('./cursor-broker-client');

async function run([worktree, promptFile, model, timeout, runId, out, runner = 'cursor']) {
  const config = client.brokerConfig(runner);
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(runId)) throw new Error(`invalid ${runner} broker dispatch run id`);
  const prompt = client.readPrompt(promptFile, runner);
  const root = fs.realpathSync(config.workRoot);
  const clone = path.join(root, runId);
  const git = (args, opts = {}) => {
    const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...opts });
    if (r.error || r.status !== 0) throw new Error(`${runner} broker git operation failed`);
    return r.stdout.trim();
  };
  process.umask(0o007);
  // Exclusive mkdir is also the cleanup ownership boundary: an existing path is
  // never adopted, modified or removed. No path from a broker response is used.
  fs.mkdirSync(clone, { mode: 0o2770 });
  let removed = false;
  const cleanup = () => {
    if (!removed) { fs.rmSync(clone, { recursive: true }); removed = true; }
  };
  const onTerm = () => { cleanup(); process.exit(143); };
  const onInt = () => { cleanup(); process.exit(130); };
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);
  try {
    // The worker rail blocks every git transport. Permit ONLY the local file
    // transport for this harness-owned clone command, never for the broker job.
    const cloneEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    git(['-c', 'protocol.file.allow=always', 'clone', '-q', '--no-local', '--no-checkout', '--config', 'core.sharedRepository=group', '--', worktree, clone],
      { env: { ...cloneEnv, GIT_ALLOW_PROTOCOL: 'file' } });
    git(['-C', clone, 'checkout', '-q', '--detach', git(['-C', worktree, 'rev-parse', 'HEAD'])], { env: cloneEnv });
    const { response, success } = await client.request({
      runner, socket: config.socket,
      worktree: clone, prompt, model, timeout_s: Number(timeout),
    });
    fs.writeFileSync(out, JSON.stringify(response) + '\n', { mode: 0o600 });
    process.stdout.write(response.log);
    if (!success) return 1;
    if (response.diff) git(['-C', worktree, 'apply', '--whitespace=nowarn', '-'], { input: response.diff });
    return 0;
  } finally {
    // Literal child path constructed above from the validated dispatch run id,
    // and created by this invocation. Never clean a caller/broker-supplied path.
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    cleanup();
  }
}
if (require.main === module) run(process.argv.slice(2)).then(rc => { process.exitCode = rc; }).catch(err => {
  process.stderr.write(`${err.message}\n`); process.exitCode = 2;
});
