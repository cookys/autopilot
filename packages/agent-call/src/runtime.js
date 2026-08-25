'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomBytes } = require('crypto');
const { AgentCallError } = require('./errors');

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function runtimeRoot(env = process.env) {
  if (env.AGENT_CALL_RUNTIME_DIR) return path.resolve(env.AGENT_CALL_RUNTIME_DIR);
  if (env.XDG_RUNTIME_DIR) return path.join(path.resolve(env.XDG_RUNTIME_DIR), 'agent-call');
  const uid = currentUid();
  const suffix = uid === null
    ? String(os.userInfo().username).replace(/[^A-Za-z0-9_.-]/g, '_')
    : String(uid);
  return path.join(os.tmpdir(), `agent-call-${suffix}`);
}

function assertOwnedPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AgentCallError('unsafe_runtime_directory', `runtime path is not a real directory: ${directory}`);
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    throw new AgentCallError('unsafe_runtime_directory', `runtime directory is owned by uid ${stat.uid}, expected ${uid}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new AgentCallError(
      'unsafe_runtime_directory',
      `runtime directory must not be group/world accessible: ${directory} (mode ${(stat.mode & 0o777).toString(8)})`,
    );
  }
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    assertOwnedPrivateDirectory(directory);
    return directory;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  assertOwnedPrivateDirectory(directory);
  return directory;
}

function ensureRuntimeLayout(env = process.env) {
  const root = ensurePrivateDirectory(runtimeRoot(env));
  const agents = ensurePrivateDirectory(path.join(root, 'agents'));
  const channels = ensurePrivateDirectory(path.join(root, 'channels'));
  const tokens = ensurePrivateDirectory(path.join(root, 'tokens'));
  return { root, agents, channels, tokens };
}

function assertPrivateRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AgentCallError('unsafe_runtime_file', `runtime file is not a real regular file: ${filePath}`);
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    throw new AgentCallError('unsafe_runtime_file', `runtime file is owned by uid ${stat.uid}, expected ${uid}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new AgentCallError(
      'unsafe_runtime_file',
      `runtime file must not be group/world accessible: ${filePath} (mode ${(stat.mode & 0o777).toString(8)})`,
    );
  }
}

function fsyncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writePrivateFileAtomic(filePath, content) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, content, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    assertPrivateRegularFile(filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function readPrivateFile(filePath) {
  assertPrivateRegularFile(filePath);
  return fs.readFileSync(filePath, 'utf8');
}

function safeUnlink(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isDirectory()) {
      throw new AgentCallError('unsafe_unlink', `refusing to unlink a directory: ${filePath}`);
    }
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = {
  runtimeRoot,
  ensurePrivateDirectory,
  ensureRuntimeLayout,
  assertOwnedPrivateDirectory,
  assertPrivateRegularFile,
  writePrivateFileAtomic,
  readPrivateFile,
  safeUnlink,
};
