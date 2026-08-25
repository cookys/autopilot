'use strict';

const { Registry } = require('./registry');
const { createEnvelope, validateEnvelope } = require('./message');
const { createAdapters, deliverToDescriptor, readFromDescriptor, doctorDescriptor } = require('./adapters');

async function sendMessage({ registry = new Registry(), adapters = createAdapters(), from, to, content, origin = 'local-cli' }) {
  const descriptor = registry.require(to);
  const envelope = createEnvelope({ from, to: descriptor.name, content, origin });
  return { envelope, result: await deliverToDescriptor(descriptor, envelope, adapters) };
}

async function receiveEnvelope({ registry = new Registry(), adapters = createAdapters(), envelope }) {
  const value = validateEnvelope(envelope);
  const descriptor = registry.require(value.to);
  return { envelope: value, result: await deliverToDescriptor(descriptor, value, adapters) };
}

module.exports = {
  Registry,
  createEnvelope,
  validateEnvelope,
  createAdapters,
  deliverToDescriptor,
  readFromDescriptor,
  doctorDescriptor,
  sendMessage,
  receiveEnvelope,
};
