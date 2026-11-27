'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_BWRAP = '/usr/bin/bwrap';
const SENSITIVE_ENV_RE = /^(FLEET|GIT|SSH|CLAUDE_CONFIG_DIR|ANTHROPIC_|OPENAI_|AWS_|GCP_|AZURE_|.*TOKEN.*|.*SECRET.*|.*KEY.*|.*PASSWORD.*|.*AUTH.*)/i;

/**
 * Filter environment variables to a safe allowlist, stripping fleet, git, SSH,
 * token, and CLAUDE_CONFIG_DIR entries.
 * @param {string[]|Record<string,string>|undefined} envAllow
 * @returns {Record<string,string>}
 */
function resolveAllowedEnv(envAllow) {
  const out = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/home/sandbox',
    USER: 'sandbox',
    LANG: 'C.UTF-8',
  };

  if (Array.isArray(envAllow)) {
    for (const key of envAllow) {
      if (typeof key !== 'string' || SENSITIVE_ENV_RE.test(key)) continue;
      if (process.env[key] !== undefined) {
        out[key] = process.env[key];
      }
    }
  } else if (envAllow && typeof envAllow === 'object') {
    for (const [key, val] of Object.entries(envAllow)) {
      if (SENSITIVE_ENV_RE.test(key)) continue;
      if (val !== undefined && val !== null) {
        out[key] = String(val);
      }
    }
  }

  return out;
}

/**
 * Build bwrap CLI arguments for an isolated replay sandbox.
 * @param {object} opts
 * @param {string} [opts.pluginDir] - Host plugin directory to mount read-only at /plugin
 * @param {string} [opts.workDir] - Host scratch work directory to mount at /work
 * @param {string[]|Record<string,string>} [opts.envAllow] - Allowed env vars
 * @param {boolean} [opts.allowNet=false] - Explicitly allow network (default false -> --unshare-net)
 * @param {string[]} [opts.command] - Command + args to run inside sandbox
 * @returns {string[]}
 */
function buildSandboxArgs(opts = {}) {
  const {
    pluginDir,
    workDir,
    envAllow,
    allowNet = false,
    command = [],
  } = opts;

  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
  ];

  if (!allowNet) {
    args.push('--unshare-net');
  }

  // Minimal read-only OS mounts; never mount real HOME, real repo, or config dirs.
  args.push(
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind-try', '/etc', '/etc',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--tmpfs', '/home/sandbox'
  );

  // A node outside the mounted OS dirs (a user-local install) is not visible inside the sandbox, so
  // the probes die with "execvp node: No such file". Bind just that install root, read-only; never HOME.
  const nodeRoot = path.dirname(path.dirname(process.execPath));
  if (!/^\/(usr|bin|lib|lib64)(\/|$)/.test(process.execPath) && nodeRoot !== '/' && nodeRoot.split('/').length > 2) {
    args.push('--ro-bind', nodeRoot, nodeRoot);
  }

  if (pluginDir) {
    args.push('--ro-bind', path.resolve(pluginDir), '/plugin');
  }

  if (workDir) {
    args.push('--bind', path.resolve(workDir), '/work');
  } else {
    args.push('--tmpfs', '/work');
  }
  args.push('--chdir', '/work');

  args.push('--clearenv');
  const safeEnv = resolveAllowedEnv(envAllow);
  for (const [k, v] of Object.entries(safeEnv)) {
    args.push('--setenv', k, v);
  }

  if (Array.isArray(command) && command.length > 0) {
    args.push('--', ...command);
  }

  return args;
}

/**
 * Execute a command inside bwrap using spawnSync.
 * @param {string[]} argv - bwrap arguments (from buildSandboxArgs)
 * @param {object} [opts]
 * @returns {{ status: number|null, stdout: string, stderr: string, error?: Error }}
 */
function runInSandbox(argv, opts = {}) {
  const bwrapBin = opts.bwrapBin || DEFAULT_BWRAP;
  const res = spawnSync(bwrapBin, argv, {
    encoding: 'utf8',
    timeout: opts.timeout || 15000,
    input: opts.input,
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error,
  };
}

/**
 * Check whether bwrap is available and user namespaces work on this host.
 * @param {string} [bwrapBin]
 * @returns {{ available: boolean, reason?: string }}
 */
function checkBwrapAvailable(bwrapBin = DEFAULT_BWRAP) {
  if (!fs.existsSync(bwrapBin)) {
    return { available: false, reason: `bwrap binary not found at ${bwrapBin}` };
  }
  const probe = runInSandbox(
    buildSandboxArgs({ command: [process.execPath, '-e', 'console.log("ok")'] }),
    { bwrapBin, timeout: 5000 }
  );
  if (probe.error) {
    return { available: false, reason: probe.error.message };
  }
  if (probe.status !== 0) {
    return {
      available: false,
      reason: (probe.stderr || `bwrap exited with status ${probe.status}`).trim(),
    };
  }
  return { available: true };
}

/**
 * Run the 5 negative-control probes from §3 inside bwrap.
 * Uses local sentinel files in a temp directory (never real fleet).
 * @param {object} [opts]
 * @param {string} [opts.bwrapBin]
 * @param {boolean} [opts.allowNet=false] - For negative-control testing only
 * @param {string} [opts.extraRoHome] - For negative-control testing only
 * @returns {{ passed: boolean, skipped?: boolean, reason?: string, probes: Array<{name: string, blocked: boolean, evidence: string}> }}
 */
function runNegativeControls(opts = {}) {
  const bwrapBin = opts.bwrapBin || DEFAULT_BWRAP;
  const avail = checkBwrapAvailable(bwrapBin);
  if (!avail.available) {
    return { passed: false, skipped: true, reason: avail.reason, probes: [] };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-negctrl-'));
  const workDir = path.join(tmpRoot, 'work');
  const fakeRepoDir = path.join(tmpRoot, 'real-repo');
  const fakeConfigDir = path.join(tmpRoot, 'real-config');
  const fakeFleetDir = path.join(tmpRoot, 'fleet-bin');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(fakeRepoDir, { recursive: true });
  fs.mkdirSync(fakeConfigDir, { recursive: true });
  fs.mkdirSync(fakeFleetDir, { recursive: true });

  const fleetSentinel = path.join(tmpRoot, 'fleet-sentinel.txt');
  const repoSentinel = path.join(fakeRepoDir, 'repo-sentinel.txt');
  const configSentinel = path.join(fakeConfigDir, 'secret-config.txt');
  fs.writeFileSync(configSentinel, 'TOP_SECRET_CONFIG_VALUE', 'utf8');

  const fakeFleetBin = path.join(fakeFleetDir, 'fleet');
  fs.writeFileSync(
    fakeFleetBin,
    `#!/bin/sh\necho "LEAKED" > "${fleetSentinel}"\n`,
    { mode: 0o755 }
  );

  const probes = [];
  const baseOpts = {
    workDir,
    allowNet: Boolean(opts.allowNet),
  };

  const runProbe = (name, script, checkFn) => {
    const args = buildSandboxArgs({
      ...baseOpts,
      command: [process.execPath, '-e', script],
    });
    if (opts.extraRoHome) {
      // Inject real HOME bind before `--` when testing negative control failure
      const sepIdx = args.indexOf('--');
      args.splice(sepIdx, 0, '--ro-bind', opts.extraRoHome, opts.extraRoHome);
    }
    const res = runInSandbox(args, { bwrapBin, timeout: 8000 });
    const result = checkFn(res);
    probes.push({ name, blocked: result.blocked, evidence: result.evidence });
  };

  try {
    // (a) Fake fleet binary attempting to write sentinel
    runProbe(
      'a_fake_fleet_blocked',
      `const { execFileSync } = require('child_process'); execFileSync(${JSON.stringify(fakeFleetBin)}, ['send']);`,
      (res) => {
        const leaked = fs.existsSync(fleetSentinel);
        return {
          blocked: !leaked && res.status !== 0,
          evidence: leaked ? 'fleet sentinel was written!' : `status=${res.status} stderr=${res.stderr.trim().slice(0, 120)}`,
        };
      }
    );

    // (b) Write to real repo sentinel path
    runProbe(
      'b_repo_write_blocked',
      `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(repoSentinel)}, 'PWNED');`,
      (res) => {
        const leaked = fs.existsSync(repoSentinel);
        return {
          blocked: !leaked && res.status !== 0,
          evidence: leaked ? 'repo sentinel was written!' : `status=${res.status} stderr=${res.stderr.trim().slice(0, 120)}`,
        };
      }
    );

    // (c) Read real config dir sentinel
    runProbe(
      'c_config_read_blocked',
      `const fs = require('fs'); console.log(fs.readFileSync(${JSON.stringify(configSentinel)}, 'utf8'));`,
      (res) => {
        const leaked = res.stdout.includes('TOP_SECRET_CONFIG_VALUE');
        return {
          blocked: !leaked && res.status !== 0,
          evidence: leaked ? 'config sentinel was read!' : `status=${res.status} stderr=${res.stderr.trim().slice(0, 120)}`,
        };
      }
    );

    // (d) Open TCP to 127.0.0.1 and external address
    runProbe(
      'd_network_egress_blocked',
      `
      const net = require('net');
      function tryConn(host, port) {
        return new Promise((resolve) => {
          const s = net.connect({ host, port, timeout: 1500 }, () => { s.destroy(); resolve('OPEN'); });
          s.on('error', (e) => resolve('ERR:' + e.code));
          s.on('timeout', () => { s.destroy(); resolve('TIMEOUT'); });
        });
      }
      Promise.all([tryConn('127.0.0.1', 80), tryConn('1.1.1.1', 80)]).then((r) => {
        console.log(JSON.stringify(r));
        if (r.some((x) => x === 'OPEN')) process.exit(0);
        process.exit(1);
      });
      `,
      (res) => {
        const blocked = res.status !== 0 && !res.stdout.includes('"OPEN"');
        return {
          blocked,
          evidence: `status=${res.status} stdout=${res.stdout.trim()}`,
        };
      }
    );

    // (e) Hook subprocess bypass attempting config read & TCP
    runProbe(
      'e_hook_subprocess_bypass_blocked',
      `
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, ['-e', 'require("fs").readFileSync(${JSON.stringify(configSentinel)})'], { encoding: 'utf8' });
      process.exit(r.status === 0 ? 0 : 1);
      `,
      (res) => ({
        blocked: res.status !== 0,
        evidence: `status=${res.status} stderr=${res.stderr.trim().slice(0, 120)}`,
      })
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const passed = probes.length === 5 && probes.every((p) => p.blocked);
  return { passed, probes };
}

module.exports = {
  DEFAULT_BWRAP,
  resolveAllowedEnv,
  buildSandboxArgs,
  runInSandbox,
  checkBwrapAvailable,
  runNegativeControls,
};
