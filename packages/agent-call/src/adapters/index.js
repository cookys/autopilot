'use strict';

const { AgentCallError } = require('../errors');
const { TmuxConsoleAdapter } = require('./tmux-console');
const { ClaudeChannelAdapter } = require('./claude-channel');

function createAdapters(options = {}) {
  return {
    tmux: options.tmux ?? new TmuxConsoleAdapter(options.tmuxOptions),
    'claude-channel': options.claudeChannel ?? new ClaudeChannelAdapter(options.claudeChannelOptions),
  };
}

function adapterFor(descriptor, adapters) {
  const adapter = adapters[descriptor.ingress.kind];
  if (!adapter) {
    throw new AgentCallError('unsupported_ingress', `no adapter for ${descriptor.ingress.kind}`);
  }
  return adapter;
}

async function deliverToDescriptor(descriptor, envelope, adapters = createAdapters()) {
  return adapterFor(descriptor, adapters).deliver(descriptor, envelope);
}

async function readFromDescriptor(descriptor, options = {}, adapters = createAdapters()) {
  const adapter = adapterFor(descriptor, adapters);
  if (typeof adapter.read !== 'function') {
    throw new AgentCallError('read_unsupported', `${descriptor.ingress.kind} does not support reading`);
  }
  return adapter.read(descriptor, options);
}

async function doctorDescriptor(descriptor, adapters = createAdapters()) {
  const adapter = adapterFor(descriptor, adapters);
  return adapter.doctor(descriptor);
}

module.exports = {
  createAdapters,
  deliverToDescriptor,
  readFromDescriptor,
  doctorDescriptor,
};
