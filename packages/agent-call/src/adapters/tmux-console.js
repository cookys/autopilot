'use strict';

const { spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const { AgentCallError } = require('../errors');
const { framePeerConsoleMessage } = require('../message');

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
    const settleMs = options.settleMs ?? Number(process.env.AGENT_CALL_TMUX_SETTLE_MS || 350);
    if (!Number.isSafeInteger(settleMs) || settleMs < 150 || settleMs > 5000) {
      throw new AgentCallError(
        'invalid_tmux_settle',
        'tmux settle delay must be an integer from 150 to 5000 milliseconds',
      );
    }
    this.settleMs = settleMs;
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
    const framed = framePeerConsoleMessage(envelope);
    const bufferName = `agent-call-${process.pid}-${randomBytes(8).toString('hex')}`;
    this.run(['load-buffer', '-b', bufferName, '-'], { input: framed });
    try {
      // -p asks tmux to use bracketed-paste when the target TUI negotiated it;
      // -r preserves embedded newlines as LF rather than translating them to Enter.
      // The console frame is intentionally one physical line as a second safety net.
      this.run(['paste-buffer', '-d', '-p', '-r', '-b', bufferName, '-t', descriptor.ingress.pane]);
    } catch (error) {
      try { this.run(['delete-buffer', '-b', bufferName]); } catch {}
      throw error;
    }
    await this.sleep(this.settleMs);
    this.run(['send-keys', '-t', descriptor.ingress.pane, 'C-m']);
    return {
      status: 'injected_unverified',
      adapter: 'tmux',
      target: descriptor.name,
      message_id: envelope.id,
      pane_id: pane.pane_id,
      note: 'tmux accepted a bracketed paste and submit key; this does not prove the model observed the message',
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
