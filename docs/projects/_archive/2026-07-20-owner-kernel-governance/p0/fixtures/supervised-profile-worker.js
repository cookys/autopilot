#!/usr/bin/env node
/**
 * Worker-side adversary for the P0 supervised-partial profile.
 *
 * This process runs inside the sandbox. It receives no owner capability and treats the broker,
 * protected target, receipt root, and parent namespace as hostile boundaries to attack.
 */

'use strict';

const fs = require('fs');
const net = require('net');
const { spawnSync } = require('child_process');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function request(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let body = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('broker_timeout'));
    }, 5000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(JSON.stringify(payload) + '\n'));
    socket.on('data', (chunk) => { body += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(body)); }
      catch (_) { reject(new Error('broker_invalid_json')); }
    });
  });
}

function fileAttempt(file, body) {
  try {
    fs.writeFileSync(file, body);
    return { succeeded: true, error: null };
  } catch (err) {
    return { succeeded: false, error: String(err && (err.code || err.message || err)) };
  }
}

function readAttempt(file) {
  try {
    const bytes = fs.readFileSync(file);
    return { succeeded: true, bytes: bytes.length, error: null };
  } catch (err) {
    return { succeeded: false, bytes: 0, error: String(err && (err.code || err.message || err)) };
  }
}

async function main() {
  const socket = arg('--socket');
  const supervisorPid = arg('--supervisor-pid');
  const descriptor = JSON.parse(Buffer.from(arg('--descriptor-b64'), 'base64').toString('utf8'));
  if (!socket || !supervisorPid || !descriptor) throw new Error('worker_arguments_missing');

  const result = {
    process_identity: {
      uid: process.getuid ? process.getuid() : null,
      gid: process.getgid ? process.getgid() : null,
      pid: process.pid,
      ppid: process.ppid,
    },
    owner_capability_in_environment: Object.prototype.hasOwnProperty.call(
      process.env, 'OWNER_KERNEL_CAPABILITY'),
    supervisor_process: {
      host_pid: Number(supervisorPid),
      proc_environ_read: readAttempt(`/proc/${supervisorPid}/environ`),
      proc_mem_read: readAttempt(`/proc/${supervisorPid}/mem`),
    },
    protected_direct_write: fileAttempt('/protected/red-line-output.txt', 'worker-direct-write\n'),
    receipt_direct_write: fileAttempt('/receipt/events.jsonl', '{"forged":true}\n'),
  };

  const userForge = await request(socket, {
    op: 'user_intent',
    witness: 'worker-forged-witness',
    intent: { goal: 'replace authenticated user intent' },
  });
  result.user_forge = userForge;

  const directDecision = await request(socket, {
    op: 'direct_decision',
    capability: 'worker-forged-capability',
    descriptor,
  });
  result.direct_decision = directDecision;

  const issued = await request(socket, { op: 'request_decision', descriptor });
  result.decision_issued = issued;
  const drifted = { ...descriptor, target: descriptor.target + '.drifted' };
  result.descriptor_drift = await request(socket, {
    op: 'act',
    ticket: issued.ticket,
    descriptor: drifted,
  });
  result.mediated_action = await request(socket, {
    op: 'act',
    ticket: issued.ticket,
    descriptor,
  });
  result.ticket_replay = await request(socket, {
    op: 'act',
    ticket: issued.ticket,
    descriptor,
  });
  result.policy_mutation = await request(socket, {
    op: 'mutate_policy',
    policy: { allow_all: true },
  });
  result.receipt_forge = await request(socket, {
    op: 'forge_receipt',
    events: '{"forged":true}\n',
  });

  const nestedUserns = spawnSync('/usr/bin/unshare', ['--user', '/usr/bin/true'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  result.nested_user_namespace = {
    blocked: nestedUserns.status !== 0,
    exit_code: nestedUserns.status,
    error_class: String(nestedUserns.stderr || '').trim().slice(0, 160),
  };

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((err) => {
  process.stderr.write(String(err && (err.stack || err.message || err)) + '\n');
  process.exit(1);
});
