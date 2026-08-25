'use strict';

const fs = require('fs');
const path = require('path');
const { AgentCallError } = require('./errors');
const { validateName } = require('./names');
const { validateDescriptor, isPidAlive } = require('./descriptor');
const {
  ensureRuntimeLayout,
  readPrivateFile,
  safeUnlink,
  writePrivateFileAtomic,
} = require('./runtime');

class Registry {
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.pidAlive = options.pidAlive ?? isPidAlive;
    this.layout = options.layout ?? ensureRuntimeLayout(this.env);
  }

  descriptorPath(name) {
    return path.join(this.layout.agents, `${validateName(name)}.json`);
  }

  quarantine(filePath, reason) {
    const quarantinePath = `${filePath}.invalid-${Date.now()}-${process.pid}`;
    try { fs.renameSync(filePath, quarantinePath); } catch {}
    throw new AgentCallError('invalid_descriptor', `${reason}; quarantined ${filePath}`);
  }

  read(name, options = {}) {
    const filePath = this.descriptorPath(name);
    if (!fs.existsSync(filePath)) return null;
    let descriptor;
    try {
      descriptor = validateDescriptor(JSON.parse(readPrivateFile(filePath)));
    } catch (error) {
      return this.quarantine(filePath, error instanceof Error ? error.message : String(error));
    }
    if (options.pruneStale !== false && !this.pidAlive(descriptor.pid)) {
      safeUnlink(filePath);
      return null;
    }
    return descriptor;
  }

  require(name) {
    const descriptor = this.read(name);
    if (!descriptor) {
      throw new AgentCallError('target_offline', `agent is not registered or is offline: ${name}`);
    }
    return descriptor;
  }

  list(options = {}) {
    const results = [];
    for (const entry of fs.readdirSync(this.layout.agents, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const name = entry.name.slice(0, -5);
      try {
        const descriptor = this.read(name, options);
        if (descriptor) results.push(descriptor);
      } catch (error) {
        if (options.strict) throw error;
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  register(descriptorInput, options = {}) {
    const descriptor = validateDescriptor(descriptorInput);
    const existing = this.read(descriptor.name, { pruneStale: true });
    if (existing && !options.replace) {
      throw new AgentCallError(
        'name_in_use',
        `agent name is already registered by live pid ${existing.pid}: ${descriptor.name}`,
      );
    }
    writePrivateFileAtomic(
      this.descriptorPath(descriptor.name),
      `${JSON.stringify(descriptor, null, 2)}\n`,
    );
    return descriptor;
  }

  unregister(name, options = {}) {
    const descriptor = this.read(name, { pruneStale: false });
    if (!descriptor) return false;
    if (options.expectedPid && descriptor.pid !== options.expectedPid) return false;
    return safeUnlink(this.descriptorPath(name));
  }
}

module.exports = { Registry };
