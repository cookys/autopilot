'use strict';
// permission-prompt-detect.js - recognise a live Claude Code permission dialog in captured pane text, and decide when it has
// been up long enough to report. Pure functions, no I/O, no tmux, nothing is ever sent to a pane. Node built-ins only.
//
//   frameOf(text)                 -> { reason, command, frame, sig } | null   (frame = exact dialog text, rule to footer)
//   step(prev, text, nowMs, holdMs) -> { state, trigger, clear }
//
// The frame shape (Claude Code 2.1.318, captured on a real session):
//     ╌╌╌╌╌╌╌╌ (dashed rule)
//      rm -rf "$(cat cfg-pw)" victim-b        <- the command
//     ╌╌╌╌╌╌╌╌
//      │ Dangerous rm operation on statically-unresolvable target: command substitution output   <- danger reason
//      ⚠ Claude Code will automatically block this request in 1:59 ...                          <- countdown (ignored by sig)
//      Do you want to proceed?
//      ❯ 1. Yes
//        2. No
//      Esc to cancel · Tab to amend           <- the LAST non-blank line of the pane
// The same words in a code block the model printed do not match because the whole frame must sit at the tail of the pane:
// the footer is the last non-blank line, the choices and the question directly above it, the reason line starts with the
// dialog's own side bar, and a dashed rule frames the command. Printed text is followed by more transcript, the input box or
// the status line, so it is never the pane tail. A second guard is time: step() reports only a frame that stays the same
// (countdown digits aside) for holdMs, so a dialog the operator answers in 5 s never reports.

const REASON = /\b[Dd]angerous\b|statically-unresolvable/;
const RULE = /^\s*╌{8,}\s*$/;
const FOOTER = /^\s*Esc to cancel\b/;
const QUESTION = /^\s*Do you want to proceed\?\s*$/;
const YES = /^\s*(?:❯\s*)?1\.\s*Yes\b/;
const NO = /^\s*(?:❯\s*)?\d\.\s*No\b/;
const COUNTDOWN = /automatically block this request in/;
const DEFAULT_HOLD_MS = 10000;

function frameOf(text) {
  const lines = String(text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  const n = lines.length;
  if (n < 5 || !FOOTER.test(lines[n - 1])) return null;
  let q = -1;
  for (let i = n - 2; i >= Math.max(0, n - 9); i -= 1) if (QUESTION.test(lines[i])) { q = i; break; }
  if (q < 0) return null;
  const choices = lines.slice(q + 1, n - 1);
  if (!choices.some((l) => YES.test(l)) || !choices.some((l) => NO.test(l))) return null;
  // upward from the question: optional countdown, the reason line(s) with the side bar, then the dashed rule closing the command
  let r = q - 1;
  while (r >= 0 && COUNTDOWN.test(lines[r])) r -= 1;
  const reasonAt = [];
  while (r >= 0 && /^\s*│\s/.test(lines[r])) { reasonAt.unshift(r); r -= 1; }
  if (reasonAt.length === 0 || !reasonAt.some((i) => REASON.test(lines[i]))) return null;
  if (r < 0 || !RULE.test(lines[r])) return null;
  const close = r;
  let open = close - 1;
  while (open >= 0 && !RULE.test(lines[open])) open -= 1;
  if (open < 0) return null;
  const command = lines.slice(open + 1, close).map((l) => l.trim()).join(' ');
  const reason = reasonAt.map((i) => lines[i].replace(/^\s*│\s*/, '')).join(' ');
  const frame = lines.slice(open, n).join('\n'); // the exact dialog text, rule to footer (blank lines dropped)
  return { reason, command, frame, sig: `${reason}\n${command}` };
}

// prev: null | { sig, since_ms, fired }. state is what to persist (null = nothing). trigger: report once, when the same frame
// has been up for holdMs. clear: a reported frame is gone, so its card/state should be closed.
function step(prev, text, nowMs, holdMs = DEFAULT_HOLD_MS) {
  const f = frameOf(text);
  if (!f) return { state: null, trigger: false, clear: !!(prev && prev.fired) };
  const same = prev && prev.sig === f.sig;
  const state = { sig: f.sig, since_ms: same ? prev.since_ms : nowMs, fired: same ? prev.fired : false, reason: f.reason, command: f.command, frame: f.frame };
  const trigger = !state.fired && nowMs - state.since_ms >= holdMs;
  if (trigger) state.fired = true;
  return { state, trigger, clear: false };
}

module.exports = { frameOf, step, DEFAULT_HOLD_MS };
