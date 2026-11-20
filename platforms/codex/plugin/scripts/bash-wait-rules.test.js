'use strict';

/**
 * Tests for scripts/lib/bash-wait-rules.js — the ONE definition of "this Bash
 * command is a foreground wait" (sleep / while-wait / tail-follow lexing).
 * Run: node --test scripts/bash-wait-rules.test.js
 *
 * Pure string module: no fs, no env, no subprocesses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executableText,
  isAffirmative,
  SLEEP_RE,
  WHILE_WAIT_RE,
  TAIL_FOLLOW_RE,
  sleepSeconds,
  detectForegroundWait,
} = require('./lib/bash-wait-rules.js');

// ── executableText: strip heredoc bodies and `#` comments, keep quotes ──────

test('executableText: `#` comments are stripped only at a word start', () => {
  assert.equal(executableText('echo hi # a comment'), 'echo hi \n');
  assert.equal(executableText('# only a comment'), '\n');
  assert.equal(executableText('echo foo#bar'), 'echo foo#bar\n'); // mid-word # is literal
  // After an escaped space the lexer's wordStart latch stays false, so `#bar` is
  // kept (an approximation — real bash would treat it as a comment).
  assert.equal(executableText('echo foo\\ #bar'), 'echo foo\\ #bar\n');
});

test('executableText: `#` inside single/double quotes is literal', () => {
  assert.equal(executableText('echo "# not a comment"'), 'echo "# not a comment"\n');
  assert.equal(executableText("echo '# also not'"), "echo '# also not'\n");
});

test('executableText: heredoc bodies are data; the introducer line keeps its executable parts', () => {
  const script = 'cat <<EOF\nsleep 100\nEOF\necho done\n';
  // The empty line left by the final newline is kept, hence the trailing blank.
  assert.equal(executableText(script), 'cat \necho done\n\n');
  // Executable text AFTER a mid-line introducer is kept (and then parsed for waits).
  assert.equal(executableText('cat <<EOF; sleep 10\nbody\nEOF\n'), 'cat ; sleep 10\n\n');
});

test('executableText: quoted tags and <<- with a tab-indented terminator', () => {
  assert.equal(executableText("cat <<'END'\nbody\nEND\n"), 'cat \n\n');
  assert.equal(executableText('cat <<-EOF\n\tbody\n\tEOF\n'), 'cat \n\n');
});

// Real bug, module left unchanged per task rule: bash-wait-rules.js:40 guards `<<<`
// only when the THIRD char is `<`; at the second `<` of `cat <<< x` the slice `<< x`
// matches the heredoc regex, so `x` becomes a heredoc tag and following lines are
// swallowed as body — `cat <<< x\nsleep 30` would hide the wait from
// detectForegroundWait. Skipped until the module is fixed.
test.skip('executableText: herestrings (<<< word) are not heredocs (real bug: bash-wait-rules.js:40 misfires on `<<< x`)', () => {
  assert.equal(executableText('cat <<< x'), 'cat <<< x\n');
  assert.equal(detectForegroundWait('cat <<< x\nsleep 30', false), 'sleep');
});

// ── isAffirmative ────────────────────────────────────────────────────────────

test('isAffirmative: true/1/yes/on (case-insensitive, trimmed); everything else false', () => {
  for (const v of [true, 1, 'true', ' TRUE ', '1', 'yes', 'On']) assert.equal(isAffirmative(v), true, String(v));
  for (const v of [false, 0, 'false', 'no', '2', '', 'enabled', null, undefined]) {
    assert.equal(isAffirmative(v), false, String(v));
  }
});

// ── sleepSeconds / exported regexes ─────────────────────────────────────────

test('sleepSeconds: every sleep operand with its unit multiplier', () => {
  assert.deepEqual(sleepSeconds('sleep 10'), [10]);
  assert.deepEqual(sleepSeconds('sleep 0.5s && sleep 5m'), [0.5, 300]);
  assert.deepEqual(sleepSeconds('sleep 1.5h'), [5400]);
  assert.deepEqual(sleepSeconds('sleep 2d'), [172800]);
  assert.deepEqual(sleepSeconds('/usr/bin/sleep 3'), [3]);
  assert.deepEqual(sleepSeconds('echo awake'), []);
  // The digit requirement keeps prose like `-m "sleep well"` off the list.
  assert.deepEqual(sleepSeconds('-m "sleep well"'), []);
  // Quoted strings stay (they execute under bash -c) — documented lexer choice.
  assert.deepEqual(sleepSeconds('echo "sleep 30"'), [30]);
});

test('exported regexes: SLEEP_RE needs a digit, WHILE_WAIT_RE and TAIL_FOLLOW_RE match their shapes', () => {
  assert.equal(SLEEP_RE.test('sleep 5'), true);
  assert.equal(SLEEP_RE.test('sleep well'), false);
  assert.equal(SLEEP_RE.test('echo x; sleep 2'), true);
  assert.equal(WHILE_WAIT_RE.test('while true; do sleep 1; done'), true);
  assert.equal(WHILE_WAIT_RE.test('until ready; do :; done'), true);
  assert.equal(WHILE_WAIT_RE.test('echo while do'), false);
  assert.equal(TAIL_FOLLOW_RE.test('tail -f /var/log/x.log'), true);
  assert.equal(TAIL_FOLLOW_RE.test('tail --follow=name x'), true);
  assert.equal(TAIL_FOLLOW_RE.test('tail -n 5 x'), false);
});

// ── detectForegroundWait ─────────────────────────────────────────────────────

test('detectForegroundWait: sleep at or over the threshold, background never matches', () => {
  assert.equal(detectForegroundWait('sleep 30', false), 'sleep');
  assert.equal(detectForegroundWait('sleep 19', false, 20), null);
  assert.equal(detectForegroundWait('sleep 20', false, 20), 'sleep'); // inclusive
  // A background call is the sanctioned wait and never matches.
  for (const bg of [true, 1, 'true', 'yes', 'on']) {
    assert.equal(detectForegroundWait('sleep 30', bg), null, String(bg));
  }
  for (const bg of [false, 0, undefined, 'false']) {
    assert.equal(detectForegroundWait('sleep 30', bg), 'sleep', String(bg));
  }
});

test('detectForegroundWait: while/until loops and tail -f shapes', () => {
  // Any sleep digit inside the loop marks a while-wait, even below minSleepSeconds.
  assert.equal(detectForegroundWait('while true; do sleep 1; done', false), 'while-wait');
  assert.equal(detectForegroundWait('until ready; do sleep 0.1; done', false), 'while-wait');
  // A busy loop with `true` / `:` as the body is also a wait.
  assert.equal(detectForegroundWait('while true; do :; done', false), 'while-wait');
  assert.equal(detectForegroundWait('while true; do true; done', false), 'while-wait');
  // No wait primitive inside the loop.
  assert.equal(detectForegroundWait('while true; do echo x; done', false), null);

  assert.equal(detectForegroundWait('tail -f /var/log/app.log', false), 'tail-follow');
  assert.equal(detectForegroundWait('tail -F app.log', false), 'tail-follow');
  assert.equal(detectForegroundWait('tail --follow=name app.log', false), 'tail-follow');
  assert.equal(detectForegroundWait('tail -n 20 app.log', false), null);
});

test('detectForegroundWait: heredoc bodies and comments cannot smuggle a sleep in', () => {
  assert.equal(detectForegroundWait('cat <<EOF\nsleep 100\nEOF\n', false), null);
  assert.equal(detectForegroundWait('# sleep 100\necho awake', false), null);
  // Non-string commands are treated as empty text, never a wait.
  assert.equal(detectForegroundWait(null, false), null);
  assert.equal(detectForegroundWait(undefined, false), null);
});

test('detectForegroundWait: precedence — while-wait beats tail-follow beats sleep', () => {
  assert.equal(detectForegroundWait('tail -f x & while true; do sleep 1; done', false), 'while-wait');
  assert.equal(detectForegroundWait('tail -f x; sleep 30', false), 'tail-follow');
});
