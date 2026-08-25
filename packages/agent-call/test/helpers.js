'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function tempEnv(prefix = 'agent-call-test-') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(base, 0o700);
  const root = path.join(base, 'runtime');
  return {
    base,
    root,
    env: { ...process.env, AGENT_CALL_RUNTIME_DIR: root, XDG_RUNTIME_DIR: '' },
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

function memoryStream() {
  let value = '';
  return {
    write(chunk) { value += String(chunk); return true; },
    text() { return value; },
  };
}

module.exports = { tempEnv, memoryStream };
