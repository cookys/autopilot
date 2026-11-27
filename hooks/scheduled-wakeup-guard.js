#!/usr/bin/env node
/**
 * scheduled-wakeup-guard — UserPromptSubmit + PreToolUse ScheduleWakeup (default-on)
 *
 * A self-scheduled wakeup is delivered as a user turn. It is not a fresh
 * authorisation: an earlier go may already have been superseded by a STOP.
 *
 * UserPromptSubmit injects one additionalContext line when this turn is a
 * wakeup. Detection order: stdin turnOrigin "scheduled" or wakeupSource
 * "schedule_wakeup"; else the last type=user entry in the last 64 KiB of
 * transcript_path, and only when its message.content equals the stdin prompt.
 * PreToolUse injects one advisory when tool_input.prompt contains a go, an
 * approval word, or a card id. Never blocks, never denies, never prints the
 * prompt.
 *
 * Off: AUTOPILOT_SCHEDULED_WAKEUP_GUARD=off (no transcript read, no stdout).
 * Fail-open: any error exits 0 with no stdout. hooks.json onFailure=continue.
 */
'use strict';

const fs = require('fs');

const WAKEUP_LINE = '自排喚醒非授權；執行前先核對最新 attested 指令與 STOP 狀態。';
const GO_LINE = '排程含 go/核准/卡號：喚醒時須重確認仍有效（未被 STOP 或新指令取代）。';
const GO_RE = /\bgo\b|核准|批准|授權|PM go|d-[0-9a-f]{8}\b/i;
const TAIL_BYTES = 64 * 1024;

function emit(event, line) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: line },
  })}\n`);
}

function isWakeup(obj) {
  return !!obj && typeof obj === 'object'
    && (obj.turnOrigin === 'scheduled' || obj.wakeupSource === 'schedule_wakeup');
}

function contentText(message) {
  if (!message || typeof message !== 'object') return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  let out = '';
  for (const part of content) {
    if (typeof part === 'string') out += part;
    else if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') out += part.text;
  }
  return out;
}

// null = missing or unreadable. A window that starts mid-file drops the first
// partial line so a cut JSONL row is never parsed.
function readTail(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = fs.readSync(fd, buf, off, len - off, start + off);
      if (n === 0) break;
      off += n;
    }
    let text = buf.subarray(0, off).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl < 0) return '';
      text = text.slice(nl + 1);
    }
    return text;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already failing open */ }
    }
  }
}

function lastUser(text) {
  let last = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry && entry.type === 'user') last = entry;
  }
  return last;
}

function main() {
  if (process.env.AUTOPILOT_SCHEDULED_WAKEUP_GUARD === 'off') return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  const event = payload.hook_event_name;
  if (event === 'PreToolUse') {
    const toolInput = payload.tool_input;
    const prompt = toolInput && typeof toolInput.prompt === 'string' ? toolInput.prompt : '';
    if (GO_RE.test(prompt)) emit('PreToolUse', GO_LINE);
    return;
  }
  if (event !== 'UserPromptSubmit') return;
  if (isWakeup(payload)) {
    emit('UserPromptSubmit', WAKEUP_LINE);
    return;
  }
  if (typeof payload.prompt !== 'string' || typeof payload.transcript_path !== 'string' || payload.transcript_path === '') return;
  const text = readTail(payload.transcript_path);
  if (text === null || text === '') return;
  const entry = lastUser(text);
  if (!entry || !isWakeup(entry)) return;
  const body = contentText(entry.message);
  if (body === null || body !== payload.prompt) return;
  emit('UserPromptSubmit', WAKEUP_LINE);
}

try { main(); } catch { /* fail-open: no stdout */ }
process.exit(0);
