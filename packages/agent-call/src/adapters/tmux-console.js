'use strict';

const { spawnSync } = require('child_process');
const { AgentCallError } = require('../errors');
const { framePeerMessage } = require('../message');

function defaultRun(args, options = {}) {
  const result = spawnSync('tmux', args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 2500,
    input: options.input,
    windowsHide: true,
  });
  if (result.error) {
    throw new AgentCallError('tmux_unavailable', `tmux failed: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new AgentCallError('tmux_failed', `tmux ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TmuxConsoleAdapter {
  constructor(options = {}) {
    this.run = options.run ?? defaultRun;
    this.sleep = options.sleep ?? sleep;
    this.settleMs = options.settleMs ?? Number(process.env.AGENT_CALL_TMUX_SETTLE_MS || 350);
  }

  inspectPane(pane) {
    const output = this.run([
      'display-message', '-p', '-t', pane,
      '#{pane_id}\t#{pane_pid}\t#{pane_current_path}\t#{pane_current_command}',
    ]).trim();
    const [paneId, pidText, cwd, command] = output.split('\t');
    const pid = Number(pidText);
    if (!paneId || !Number.isSafeInteger(pid) || pid <= 0 || !cwd) {
      throw new AgentCallError('tmux_probe_invalid', `tmux returned an invalid pane description for ${pane}`);
    }
    return { pane_id: paneId, pid, cwd, command: command || '' };
  }

  async deliver(descriptor, envelope) {
    const pane = this.inspectPane(descriptor.ingress.pane);
    const framed = framePeerMessage(envelope);
    this.run(['send-keys', '-t', descriptor.ingress.pane, '-l', framed]);
    await this.sleep(this.settleMs);
    this.run(['send-keys', '-t', descriptor.ingress.pane, 'C-m']);
    return {
      status: 'injected_unverified',
      adapter: 'tmux',
      target: descriptor.name,
      message_id: envelope.id,
      pane_id: pane.pane_id,
      note: 'tmux accepted the keystrokes; this does not prove the model observed the message',
    };
  }

  read(descriptor, options = {}) {
    const lines = options.lines ?? 80;
    if (!Number.isSafeInteger(lines) || lines < 1 || lines > 1000) {
      throw new AgentCallError('invalid_lines', 'lines must be an integer from 1 to 1000', { exitCode: 2 });
    }
    this.inspectPane(descriptor.ingress.pane);
    const content = this.run([
      'capture-pane', '-p', '-J', '-t', descriptor.ingress.pane, '-S', `-${lines}`,
    ]);
    return {
      status: 'captured',
      adapter: 'tmux',
      target: descriptor.name,
      lines,
      content,
    };
  }

  doctor(descriptor) {
    const pane = this.inspectPane(descriptor.ingress.pane);
    return {
      ok: true,
      adapter: 'tmux',
      target: descriptor.name,
      pane,
      delivery_ceiling: 'injected_unverified',
    };
  }
}

module.exports = { TmuxConsoleAdapter, defaultRun };
