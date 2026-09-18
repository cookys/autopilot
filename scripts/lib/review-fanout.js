#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const MAX_BUFFER = 1024 * 1024;
const KILL_GRACE_MS = 5000;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function captureStream(stream, bag, key, onOverflow) {
  // One decoder per stream: a 64 KiB pipe read can split a multibyte UTF-8 sequence, and
  // decoding each chunk on its own would leave U+FFFD in the captured text (dogfood 🟡).
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  stream.on('data', (chunk) => {
    if (bag.overflow) return;
    bytes += chunk.length;
    if (bytes > MAX_BUFFER) {
      bag.overflow = true;
      bag.overflowStream = key;
      onOverflow();
      return;
    }
    bag[key] += decoder.write(chunk);
  });
  stream.on('end', () => {
    if (!bag.overflow) bag[key] += decoder.end();
  });
}

function runJob(job) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const argv = Array.isArray(job && job.argv) ? job.argv : [];
    const cmd = argv[0];
    const args = argv.slice(1);
    const bag = { stdout: '', stderr: '', overflow: false };
    const finish = (fields) => {
      resolve({
        id: job && job.id != null ? job.id : null,
        status: fields.status === undefined ? null : fields.status,
        signal: fields.signal === undefined ? null : fields.signal,
        error: fields.error === undefined ? null : fields.error,
        stdout: bag.stdout,
        stderr: bag.stderr,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      });
    };
    if (typeof cmd !== 'string' || cmd.length === 0) {
      finish({ status: null, signal: null, error: 'job argv is required' });
      return;
    }
    let child;
    try {
      const stdio = ['pipe', 'pipe', 'pipe'];
      child = spawn(cmd, args, {
        cwd: job.cwd || process.cwd(),
        env: job.env && typeof job.env === 'object' ? job.env : process.env,
        stdio,
        shell: false,
      });
    } catch (error) {
      finish({
        status: null,
        signal: null,
        error: error && error.message ? error.message : String(error),
      });
      return;
    }
    let settled = false;
    let killTimer = null;
    const overflowKill = () => {
      try { child.kill('SIGKILL'); } catch (_err) { /* already gone */ }
    };
    captureStream(child.stdout, bag, 'stdout', overflowKill);
    captureStream(child.stderr, bag, 'stderr', overflowKill);
    if (job.stdin_file && typeof job.stdin_file === 'string') {
      const input = fs.createReadStream(job.stdin_file);
      // A child that exits (or is killed) before draining stdin makes the pending write fail
      // with EPIPE on child.stdin; without a listener that is an uncaught exception that kills
      // the whole fan-out and every sibling's result (dogfood 🟠 stdin-epipe-crash). The child's
      // own exit status is the outcome; the write failure is not.
      child.stdin.on('error', () => {
        try { input.destroy(); } catch (_err) { /* already closed */ }
      });
      input.pipe(child.stdin);
      input.on('error', () => {
        try { child.stdin.end(); } catch (_err) { /* closed */ }
      });
    } else {
      try { child.stdin.end(); } catch (_err) { /* closed */ }
    }
    const timeoutSeconds = Number(job.timeout_seconds);
    let termTimer = null;
    if (Number.isSafeInteger(timeoutSeconds) && timeoutSeconds >= 1) {
      termTimer = setTimeout(() => {
        try {
          if (child.pid) process.kill(child.pid, 'SIGTERM');
        } catch (_err) { /* gone */ }
        killTimer = setTimeout(() => {
          try {
            if (child.pid) process.kill(child.pid, 'SIGKILL');
          } catch (_err2) { /* gone */ }
        }, KILL_GRACE_MS);
      }, Math.max(0, timeoutSeconds) * 1000);
    }
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      finish({
        status: null,
        signal: null,
        error: error && error.message ? error.message : String(error),
      });
    });
    child.on('close', (status, signal) => {
      if (settled) return;
      settled = true;
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      if (bag.overflow) {
        finish({
          status: null,
          signal: signal || null,
          error: `${bag.overflowStream || 'stdout'} maxBuffer exceeded`,
        });
        return;
      }
      finish({
        status: status === undefined ? null : status,
        signal: signal || null,
        error: null,
      });
    });
  });
}

// Write the whole array synchronously before exiting: process.stdout.write on a pipe is
// asynchronous past ~64 KiB and process.exit() drops the unflushed tail — three seats' raw
// output easily exceeds that, and a truncated array loses every seat (dogfood 2026-09-18).
function emitArray(value) {
  const buf = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(1, buf, off, buf.length - off);
    } catch (error) {
      if (error && error.code === 'EAGAIN') continue;
      throw error;
    }
  }
}

async function main() {
  let jobs = [];
  try {
    const raw = await readStdin();
    const parsed = JSON.parse(raw);
    jobs = parsed && Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch (error) {
    jobs = [];
    emitArray([{
      id: null,
      status: null,
      signal: null,
      error: error && error.message ? error.message : String(error),
      stdout: '',
      stderr: '',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    }]);
    process.exit(0);
    return;
  }
  const results = await Promise.all(jobs.map((job) => runJob(job)));
  emitArray(results);
  process.exit(0);
}

main().catch((error) => {
  emitArray([{
    id: null,
    status: null,
    signal: null,
    error: error && error.message ? error.message : String(error),
    stdout: '',
    stderr: '',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }]);
  process.exit(0);
});
