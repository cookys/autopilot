'use strict';

const fs = require('fs');
const path = require('path');
const { AgentCallError, asAgentCallError } = require('./errors');
const { validateName, validateHarness } = require('./names');
const { makeDescriptor } = require('./descriptor');
const { Registry } = require('./registry');
const { createEnvelope, validateEnvelope } = require('./message');
const { createAdapters, deliverToDescriptor, readFromDescriptor, doctorDescriptor } = require('./adapters');
const { TmuxConsoleAdapter } = require('./adapters/tmux-console');
const { setupClaude } = require('./setup');
const { startChannelServer, startToolServer } = require('./channel/server');

function printHelp(stdout) {
  stdout.write(`Usage:
  agent-call attach --name NAME --harness HARNESS --tmux-pane PANE [--replace] [--json]
  agent-call detach NAME [--json]
  agent-call list [--json]
  agent-call send TARGET MESSAGE... [--json]
  agent-call send TARGET --stdin [--json]
  agent-call read TARGET [--lines N] [--json]
  agent-call doctor [TARGET] [--json]
  agent-call setup claude --name NAME [--config PATH] [--force] [--json]
  agent-call channel (--name NAME|--name-env ENV_KEY) [--harness claude] [--cwd PATH]
  agent-call receive --stdin [--json]

Scope:
  Same machine, same OS user, explicitly registered persistent sessions only.
  Messages always carry peer authority and never count as operator authorization.
`);
}

function parseOptions(args, valueFlags = new Set(), booleanFlags = new Set()) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    if (booleanFlags.has(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) throw new AgentCallError('usage', `${arg} requires a value`, { exitCode: 2 });
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new AgentCallError('usage', `unknown option: ${arg}`, { exitCode: 2 });
  }
  return { positionals, options };
}

function writeResult(stdout, value, json) {
  if (json) {
    stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (typeof value === 'string') stdout.write(`${value}\n`);
  else stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readStdin(stdinFd = 0) {
  return fs.readFileSync(stdinFd, 'utf8');
}

function defaultSender(env) {
  return validateName(env.AGENT_CALL_NAME || 'local-cli', 'sender name');
}

async function runCli(args, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;
  const registry = dependencies.registry ?? new Registry({ env });
  const adapters = dependencies.adapters ?? createAdapters(dependencies.adapterOptions);
  const tmux = dependencies.tmux ?? adapters.tmux ?? new TmuxConsoleAdapter();
  const binPath = dependencies.binPath ?? path.resolve(__dirname, '../bin/agent-call.js');

  try {
    const command = args[0];
    if (!command || ['help', '-h', '--help'].includes(command)) {
      printHelp(stdout);
      return 0;
    }
    if (command === 'list') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(), new Set(['--json']));
      if (positionals.length) throw new AgentCallError('usage', 'list accepts no positional arguments', { exitCode: 2 });
      const values = registry.list().map((entry) => ({
        name: entry.name,
        harness: entry.harness,
        ingress: entry.ingress.kind,
        pid: entry.pid,
        cwd: entry.cwd,
        capabilities: entry.capabilities,
      }));
      if (options.json) writeResult(stdout, values, true);
      else if (!values.length) stdout.write('No persistent local agents are registered.\n');
      else {
        stdout.write('NAME\tHARNESS\tINGRESS\tPID\tCWD\n');
        for (const value of values) stdout.write(`${value.name}\t${value.harness}\t${value.ingress}\t${value.pid}\t${value.cwd}\n`);
      }
      return 0;
    }
    if (command === 'attach') {
      const { positionals, options } = parseOptions(
        args.slice(1),
        new Set(['--name', '--harness', '--tmux-pane', '--cwd']),
        new Set(['--replace', '--json']),
      );
      if (positionals.length) throw new AgentCallError('usage', 'attach accepts only named options', { exitCode: 2 });
      const name = validateName(options.name);
      const harness = validateHarness(options.harness);
      if (!options['tmux-pane']) throw new AgentCallError('usage', '--tmux-pane is required', { exitCode: 2 });
      const pane = tmux.inspectPane(options['tmux-pane']);
      const descriptor = makeDescriptor({
        name,
        harness,
        pid: pane.pid,
        cwd: path.resolve(options.cwd ?? pane.cwd),
        ingress: { kind: 'tmux', pane: options['tmux-pane'] },
        capabilities: { context_injection: true, wake_idle: true, console_read: true },
      });
      registry.register(descriptor, { replace: options.replace });
      writeResult(stdout, { status: 'attached', descriptor }, options.json);
      return 0;
    }
    if (command === 'detach') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(), new Set(['--json']));
      if (positionals.length !== 1) throw new AgentCallError('usage', 'detach requires NAME', { exitCode: 2 });
      const removed = registry.unregister(validateName(positionals[0]));
      writeResult(stdout, { status: removed ? 'detached' : 'not_found', name: positionals[0] }, options.json);
      return 0;
    }
    if (command === 'send') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(), new Set(['--stdin', '--json']));
      if (positionals.length < 1) throw new AgentCallError('usage', 'send requires TARGET', { exitCode: 2 });
      const target = validateName(positionals.shift(), 'target name');
      const content = options.stdin ? readStdin(dependencies.stdinFd) : positionals.join(' ');
      if (options.stdin && positionals.length) throw new AgentCallError('usage', '--stdin cannot be combined with MESSAGE arguments', { exitCode: 2 });
      const descriptor = registry.require(target);
      const envelope = createEnvelope({
        from: defaultSender(env),
        to: descriptor.name,
        content,
        origin: 'local-cli',
      });
      const result = await deliverToDescriptor(descriptor, envelope, adapters);
      writeResult(stdout, result, options.json);
      return 0;
    }
    if (command === 'read') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(['--lines']), new Set(['--json']));
      if (positionals.length !== 1) throw new AgentCallError('usage', 'read requires TARGET', { exitCode: 2 });
      const descriptor = registry.require(validateName(positionals[0], 'target name'));
      const result = await readFromDescriptor(descriptor, { lines: options.lines ? Number(options.lines) : 80 }, adapters);
      if (options.json) writeResult(stdout, result, true);
      else stdout.write(result.content);
      return 0;
    }
    if (command === 'doctor') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(), new Set(['--json']));
      if (positionals.length > 1) throw new AgentCallError('usage', 'doctor accepts zero or one TARGET', { exitCode: 2 });
      if (!positionals.length) {
        const results = [];
        for (const descriptor of registry.list()) {
          try { results.push(await doctorDescriptor(descriptor, adapters)); }
          catch (error) { results.push({ ok: false, target: descriptor.name, error: asAgentCallError(error).code, message: asAgentCallError(error).message }); }
        }
        writeResult(stdout, { ok: results.every((item) => item.ok), agents: results }, options.json);
        return results.every((item) => item.ok) ? 0 : 1;
      }
      const descriptor = registry.require(validateName(positionals[0], 'target name'));
      writeResult(stdout, await doctorDescriptor(descriptor, adapters), options.json);
      return 0;
    }
    if (command === 'setup') {
      if (args[1] !== 'claude') throw new AgentCallError('usage', 'setup currently supports only: setup claude', { exitCode: 2 });
      const { positionals, options } = parseOptions(
        args.slice(2),
        new Set(['--name', '--config']),
        new Set(['--force', '--json']),
      );
      if (positionals.length) throw new AgentCallError('usage', 'setup claude accepts only named options', { exitCode: 2 });
      const result = setupClaude({
        name: options.name,
        configPath: options.config,
        force: options.force,
        binPath,
        env,
      });
      writeResult(stdout, result, options.json);
      return 0;
    }
    if (command === 'channel') {
      const { positionals, options } = parseOptions(
        args.slice(1),
        new Set(['--name', '--name-env', '--harness', '--cwd']),
        new Set(),
      );
      if (positionals.length) throw new AgentCallError('usage', 'channel accepts only named options', { exitCode: 2 });
      if (options.name && options['name-env']) {
        throw new AgentCallError('usage', '--name and --name-env cannot be combined', { exitCode: 2 });
      }
      const envName = options['name-env'] ? env[options['name-env']] : undefined;
      const name = options.name ?? envName;
      const persistent = Boolean(options.name) || (env.AGENT_CALL_PERSISTENT === '1' && Boolean(envName));
      if (!persistent) {
        await startToolServer({
          name: envName || 'local-claude',
          env,
          registry,
          adapters,
          stderr,
        });
        return 0;
      }
      await startChannelServer({
        name,
        harness: options.harness ?? 'claude',
        cwd: options.cwd,
        env,
        registry,
        adapters,
        stdin: dependencies.stdin,
        stdout,
        stderr,
      });
      return 0;
    }
    if (command === 'receive') {
      const { positionals, options } = parseOptions(args.slice(1), new Set(), new Set(['--stdin', '--json']));
      if (positionals.length || !options.stdin) throw new AgentCallError('usage', 'receive requires --stdin and no positional arguments', { exitCode: 2 });
      const envelope = validateEnvelope(JSON.parse(readStdin(dependencies.stdinFd)));
      if (envelope.origin !== 'hangar-edge') {
        throw new AgentCallError('origin_invalid', 'receive accepts only origin=hangar-edge', { exitCode: 2 });
      }
      const descriptor = registry.require(envelope.to);
      writeResult(stdout, await deliverToDescriptor(descriptor, envelope, adapters), options.json);
      return 0;
    }
    throw new AgentCallError('usage', `unknown command: ${command}`, { exitCode: 2 });
  } catch (error) {
    const value = asAgentCallError(error);
    if (args.includes('--json')) {
      stdout.write(`${JSON.stringify({ error: value.code, message: value.message, details: value.details })}\n`);
    } else {
      stderr.write(`agent-call: ${value.message}\n`);
    }
    return value.exitCode;
  }
}

module.exports = { runCli, printHelp, parseOptions, defaultSender };
