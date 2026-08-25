'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { AgentCallError } = require('./errors');
const { validateName } = require('./names');

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AgentCallError('config_invalid', `${filePath} must be a real regular file, not a symlink`);
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) {
    throw new AgentCallError('config_invalid', `cannot parse ${filePath}: ${error.message}`, { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCallError('config_invalid', `${filePath} must contain a JSON object`);
  }
  return value;
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  let mode = 0o600;
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AgentCallError('config_invalid', `${filePath} must be a real regular file, not a symlink`);
    }
    mode = stat.mode & 0o777;
  }
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, mode);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function setupClaude(options) {
  const name = validateName(options.name);
  const configPath = path.resolve(options.configPath ?? '.mcp.json');
  const binPath = path.resolve(options.binPath);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const key = `agent-call-${name}`;
  const config = readJsonObject(configPath);
  if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
    throw new AgentCallError('config_invalid', `${configPath}.mcpServers must be an object`);
  }
  config.mcpServers = config.mcpServers ?? {};
  const desired = {
    command: process.execPath,
    args: [binPath, 'channel', '--name', name, '--cwd', cwd],
  };
  const existing = config.mcpServers[key];
  if (existing && JSON.stringify(existing) !== JSON.stringify(desired) && !options.force) {
    throw new AgentCallError('config_conflict', `${key} already exists with different settings; pass --force to replace it`);
  }
  config.mcpServers[key] = desired;
  atomicWriteJson(configPath, config);
  return {
    status: existing ? 'updated' : 'created',
    config_path: configPath,
    mcp_key: key,
    launch: `claude --dangerously-load-development-channels server:${key}`,
  };
}

module.exports = { setupClaude, readJsonObject, atomicWriteJson };
