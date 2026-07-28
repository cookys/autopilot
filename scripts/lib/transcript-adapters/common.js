'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_LINES = 50000;
const DEFAULT_MAX_FILES = 500;

const USER_CORRECTION_PATTERNS = [
  /\b(?:that(?:'s| is) wrong|you missed|i said|do not)\b/i,
  /(?:不對|你漏(?:了|掉)?|我說(?:過)?|不是.{0,12}(?:要|這樣)|不要)/u,
];

const STATUS_REVERSAL_PATTERNS = [
  /\b(?:was|said|marked)\s+(?:ready|done|complete).{0,40}\b(?:not|isn't|wasn't)\b/i,
  /(?:原本|剛才).{0,20}(?:完成|ready).{0,20}(?:其實|但).{0,10}(?:沒有|未)/u,
];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fingerprint(value) {
  return value ? sha256(value).slice(0, 16) : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function isoTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeString(value, maxLength = 4096) {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    const safe = safeString(value);
    if (safe !== null && safe.length > 0) return safe;
  }
  return null;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (!item || typeof item !== 'object') return '';
    return firstString(item.text, item.input_text, item.output_text, item.content) || '';
  }).join('\n');
}

function heuristicSignals(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const signals = [];
  if (USER_CORRECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push('user_correction');
  }
  if (STATUS_REVERSAL_PATTERNS.some((pattern) => pattern.test(text))) {
    signals.push('status_reversal');
  }
  return signals;
}

function commandTokens(command) {
  if (typeof command !== 'string') return [];
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    tokens.push((match[1] || match[2] || match[3] || '').replace(/\\(["\\])/g, '$1'));
  }
  return tokens;
}

function flagValue(tokens, names) {
  for (let index = 0; index < tokens.length; index += 1) {
    for (const name of names) {
      if (tokens[index] === name && index + 1 < tokens.length) return tokens[index + 1];
      if (tokens[index].startsWith(`${name}=`)) return tokens[index].slice(name.length + 1);
    }
  }
  return null;
}

function normalizeProvider(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._/-]{1,128}$/.test(value)) return null;
  return path.basename(value).toLowerCase();
}

// Shell interpreters that may wrap a script path as argv[1+], e.g.
// `bash scripts/dispatch-review.sh --runner grok`. Classification must use the
// invoked executable/script position, not later text-only arguments.
// BusyBox is not a shell: it requires an explicit shell applet (e.g. `busybox sh`).
const BASH_FAMILY_SHELLS = new Set(['bash', 'rbash']);
const NONBASH_SHELLS = new Set(['sh', 'dash', 'zsh', 'ksh']);
const BUSYBOX_SHELL_APPLETS = new Set(['sh', 'ash', 'dash']);
const SHELL_WRAPPER_BASENAMES = new Set([
  ...BASH_FAMILY_SHELLS,
  ...NONBASH_SHELLS,
  'busybox',
]);

// Known no-arg short option letters (bash --help: invocation -ilrsD; set
// -abefhkmnptuvxBCEHPT). Argument-taking letters (-c / -o / -O) are handled
// separately. Unknown letters (e.g. -Z) fail closed.
const SHELL_WRAPPER_NOARG_SHORT_LETTERS = new Set([
  'a', 'b', 'e', 'f', 'h', 'i', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'u', 'v', 'x',
  'B', 'C', 'D', 'E', 'H', 'P', 'T',
]);

// Bash long options that continue into a later -c body or script path.
// --command is NOT a Bash option (oracle: invalid option). Print/exit/unknown
// long options are intentionally absent so a later path is never promoted.
const BASH_LONG_CONTINUE = new Set([
  '--norc',
  '--noprofile',
  '--restricted',
  '--posix',
  '--login',
  '--noediting',
  '--verbose',
  '--debugger',
  '--debug',
]);
const BASH_LONG_ARG = new Set(['--init-file', '--rcfile']);

function isEnvAssignment(token) {
  return typeof token === 'string' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function tokenBasename(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  return path.basename(token);
}

/**
 * Consume shell invocation options from tokens starting at `index`.
 * Returns the next index and execution-mode flags, or null when fail-closed.
 *
 * Oracle-aligned Bash semantics (family === 'bash'):
 * - `-c` / `+c` and clusters containing `c` take the first non-option argv as
 *   the command body (so +c, -cx, -cc, +xc, +cx, +cc all execute the body when
 *   remaining letters are valid).
 * - `-n` suppresses execution; `+n` clears it (last sign wins).
 * - `D` (any sign) / dump long-options suppress execution.
 * - `-s` without command mode reads stdin; next argv is not a script.
 * - Clusters containing argument-taking `o`/`O` are handled only when that
 *   letter is last in the cluster and the next argv is present.
 * - Attached `opt=value` forms are rejected (Bash: `-=: invalid option`).
 *
 * Non-Bash shells (family === 'posix'): only the explicitly represented subset
 * above for short options; any long option fails closed.
 */
function consumeShellWrapperOptions(tokens, index, family) {
  let commandMode = false;
  let noexec = false;
  let dumpMode = false;
  let stdinMode = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') {
      index += 1;
      break;
    }
    // Non-option token ends option parsing (script path or -c body).
    if (token === '-' || token === '+' || (!token.startsWith('-') && !token.startsWith('+'))) {
      break;
    }

    // Bash rejects attached opt=value forms; never strip `=` to invent a body.
    if (token.includes('=')) {
      return null;
    }

    if (token.startsWith('--')) {
      // Non-Bash: no long-option grammar represented → fail closed.
      if (family !== 'bash') return null;
      if (BASH_LONG_CONTINUE.has(token)) {
        index += 1;
        continue;
      }
      if (BASH_LONG_ARG.has(token)) {
        if (index + 1 >= tokens.length) return null;
        index += 2;
        continue;
      }
      // --help/--version/--dump-*/--pretty-print/unknown: do not promote a path.
      // Also not `--command` (Bash has no such option).
      return null;
    }

    // Short cluster: +c / -cx / -cc / +xc / … (sign applies per cluster).
    if (!/^[-+][A-Za-z]+$/.test(token)) return null;
    const sign = token[0];
    const letters = token.slice(1);

    for (let letterIndex = 0; letterIndex < letters.length; letterIndex += 1) {
      const ch = letters[letterIndex];

      if (ch === 'c') {
        // Presence of c enables command mode regardless of sign (oracle: +c runs).
        commandMode = true;
        continue;
      }

      if (ch === 'o' || ch === 'O') {
        // Arg-taking: only when terminal in this cluster; next argv is the name.
        // In-cluster tails like -co (o steals the would-be body) fail closed when
        // mishandled — require o/O last and a present argument.
        if (letterIndex !== letters.length - 1) return null;
        if (family === 'bash' && (sign === '+' && ch === 'O')) return null;
        if (index + 1 >= tokens.length) return null;
        index += 1; // consume option-name argument (still advance past cluster below)
        continue;
      }

      if (!SHELL_WRAPPER_NOARG_SHORT_LETTERS.has(ch)) return null;

      if (ch === 'n') {
        // Last sign wins: -n enables noexec, +n clears it.
        noexec = sign === '-';
        continue;
      }
      if (ch === 'D') {
        // Invocation-only dump mode; any sign suppresses execution (oracle).
        dumpMode = true;
        continue;
      }
      if (ch === 's') {
        stdinMode = sign === '-';
        continue;
      }
    }
    index += 1;
  }

  return {
    index,
    commandMode,
    noexec,
    dumpMode,
    stdinMode,
  };
}

/**
 * Resolve argv to the actually invoked command tokens.
 * Skips leading env assignments, `env`, and supported shell wrappers so that
 * `bash scripts/dispatch-review.sh ...` classifies as dispatch-review.sh while
 * `echo "scripts/dispatch-review.sh --runner grok"` does not.
 */
function invocationTokens(tokens, depth = 0) {
  if (!Array.isArray(tokens) || tokens.length === 0 || depth > 4) return [];
  let index = 0;
  while (index < tokens.length && isEnvAssignment(tokens[index])) index += 1;

  while (index < tokens.length) {
    const base = tokenBasename(tokens[index]).toLowerCase();

    if (base === 'env') {
      index += 1;
      while (index < tokens.length) {
        const token = tokens[index];
        if (token === '--') {
          index += 1;
          break;
        }
        if (isEnvAssignment(token)) {
          index += 1;
          continue;
        }
        if (token.startsWith('-')) {
          if (['-u', '-C', '-S', '--unset', '--chdir', '--split-string'].includes(token)) {
            index += 2;
          } else {
            index += 1;
          }
          continue;
        }
        break;
      }
      continue;
    }

    // BusyBox: `-c` is an applet name lookup, not shell command mode. Require an
    // explicit supported shell applet (e.g. `busybox sh -c '…'`).
    if (base === 'busybox') {
      index += 1;
      if (index >= tokens.length) return [];
      const applet = tokenBasename(tokens[index]).toLowerCase();
      if (!BUSYBOX_SHELL_APPLETS.has(applet)) return [];
      // Re-enter as the applet shell (sh/ash/dash).
      continue;
    }

    if (BASH_FAMILY_SHELLS.has(base) || NONBASH_SHELLS.has(base)) {
      const family = BASH_FAMILY_SHELLS.has(base) ? 'bash' : 'posix';
      index += 1;
      const parsed = consumeShellWrapperOptions(tokens, index, family);
      if (!parsed) return [];
      index = parsed.index;

      // Execution-suppressing modes must not become false dispatches.
      if (parsed.noexec || parsed.dumpMode) return [];

      if (parsed.commandMode) {
        // First non-option token is the command body (Bash man: -c).
        const body = tokens[index];
        return typeof body === 'string' ? invocationTokens(commandTokens(body), depth + 1) : [];
      }

      // -s without -c: remaining argv are positional parameters from stdin, not a script.
      if (parsed.stdinMode) return [];

      // Script path (or empty interactive) — re-enter loop so nested shells unwrap.
      continue;
    }

    return tokens.slice(index);
  }
  return [];
}

function classifyDispatchKind(invoked) {
  if (!Array.isArray(invoked) || invoked.length === 0) return null;
  const head = tokenBasename(invoked[0]).toLowerCase();
  const next = invoked[1];

  if (head === 'dispatch-hetero.sh') return 'impl_dispatch';
  if (head === 'dispatch-review.sh') return 'review_dispatch';
  if (head === 'dispatch-explore.sh') return 'explore';
  if (head === 'dispatch-author.sh') return 'author';
  if (head === 'codex' && next === 'exec') return 'codex_exec';
  if (head === 'grok' && next === '-p') return 'grok_dispatch';
  if (head === 'agy' && next === '-p') return 'agy_dispatch';
  if (head === 'implement-review' || head === 'implement-review.js') {
    return 'engine_implement_review';
  }
  return null;
}

function classifyCommand(command) {
  const tokens = commandTokens(command);
  const invoked = invocationTokens(tokens);
  const dispatchKind = classifyDispatchKind(invoked);

  // Dispatch flags only when the invoked head is a dispatch form. Text-only
  // utilities that mention a path later must not inherit --runner/ticket noise.
  const ticket = dispatchKind
    ? flagValue(invoked, ['--ticket-id', '--ticket', '--root-run-id'])
    : null;
  const generation = dispatchKind
    ? finiteNonNegative(flagValue(invoked, ['--generation']))
    : null;
  const provider = dispatchKind
    ? normalizeProvider(
      flagValue(invoked, ['--runner', '--provider'])
        || (dispatchKind === 'codex_exec' ? 'codex' : null)
        || (dispatchKind === 'grok_dispatch' ? 'grok' : null)
        || (dispatchKind === 'agy_dispatch' ? 'agy' : null),
    )
    : null;

  let lifecycle = null;
  const head = tokenBasename(invoked[0] || '').toLowerCase();
  if (head === 'git') {
    const worktreeIndex = invoked.indexOf('worktree');
    if (worktreeIndex >= 0 && ['add', 'remove'].includes(invoked[worktreeIndex + 1])) {
      const action = invoked[worktreeIndex + 1];
      const pathToken = invoked.slice(worktreeIndex + 2).find((token) => !token.startsWith('-'));
      if (pathToken) {
        lifecycle = {
          action,
          fingerprint: fingerprint(pathToken),
        };
      }
    }
  }

  return {
    category: lifecycle
      ? (lifecycle.action === 'add' ? 'worktree_create' : 'worktree_remove')
      : (dispatchKind ? 'provider_dispatch' : 'tool_call'),
    control: {
      dispatch_kind: dispatchKind,
      provider,
      ticket_fingerprint: fingerprint(ticket),
      generation,
      lifecycle_fingerprint: lifecycle ? lifecycle.fingerprint : null,
      state: null,
      owned: null,
    },
  };
}

function parseStructuredResult(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 * 1024) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function structuredSignals(value) {
  const signals = [];
  let generation = null;
  let ticketFingerprint = null;
  let state = null;
  let transportFailure = false;
  let nonzeroExitCode = false;
  let lifecycleCategory = null;
  let lifecycleValue = null;
  let owned = null;

  function visit(node, depth) {
    if (depth > 6 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.slice(0, 100).forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, item] of Object.entries(node)) {
      const lowered = key.toLowerCase();
      if (['ticket', 'ticket_id', 'root_run_id'].includes(lowered) && typeof item === 'string') {
        ticketFingerprint = fingerprint(item);
      } else if (lowered === 'generation') {
        generation = finiteNonNegative(item);
      } else if (['state', 'status'].includes(lowered) && typeof item === 'string') {
        const normalized = item.toLowerCase().replace(/-/g, '_');
        if (normalized === 'code_ready' || normalized === 'merge_ready') state = normalized;
        if (/transport_(?:failed|error)|runner_failed|timeout/.test(normalized)) {
          transportFailure = true;
        }
      } else if (lowered === 'exit_code' && finiteNonNegative(item) > 0) {
        nonzeroExitCode = true;
      } else if (lowered === 'owned' && typeof item === 'boolean') {
        owned = item;
      } else if (['worktree', 'worktree_path'].includes(lowered) && typeof item === 'string') {
        lifecycleValue = item;
      } else if (['event', 'action', 'operation'].includes(lowered) && typeof item === 'string') {
        const normalized = item.toLowerCase().replace(/-/g, '_');
        if (['worktree_created', 'worktree_create', 'worktree_added',
          'worktree_add'].includes(normalized)) lifecycleCategory = 'worktree_create';
        if (['worktree_removed', 'worktree_remove'].includes(normalized)) {
          lifecycleCategory = 'worktree_remove';
        }
      }
      visit(item, depth + 1);
    }
  }

  visit(value, 0);
  if (transportFailure) signals.push('transport_failure');
  if (state) signals.push(state);
  return {
    signals,
    nonzeroExitCode,
    lifecycleCategory,
    control: {
      dispatch_kind: null,
      provider: null,
      ticket_fingerprint: ticketFingerprint,
      generation,
      lifecycle_fingerprint: lifecycleCategory && lifecycleValue
        ? fingerprint(lifecycleValue) : null,
      state,
      owned,
    },
  };
}

function usageSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const source = value.last_token_usage && typeof value.last_token_usage === 'object'
    ? value.last_token_usage : value;
  const usage = {
    input_tokens: finiteNonNegative(source.input_tokens),
    cached_input_tokens: finiteNonNegative(source.cached_input_tokens),
    output_tokens: finiteNonNegative(source.output_tokens),
    reasoning_tokens: finiteNonNegative(
      source.reasoning_tokens === undefined
        ? source.reasoning_output_tokens : source.reasoning_tokens,
    ),
    total_tokens: finiteNonNegative(source.total_tokens),
  };
  return Object.values(usage).some((item) => item !== null) ? usage : null;
}

function boundedJsonl(file, options = {}) {
  const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
  const maxLines = options.maxLines || DEFAULT_MAX_LINES;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { rows: [], parseErrors: 0, truncatedBytes: false, truncatedLines: false };
  }
  const bytes = Math.min(stat.size, maxFileBytes);
  const buffer = Buffer.alloc(bytes);
  const fd = fs.openSync(file, 'r');
  let read = 0;
  try {
    read = fs.readSync(fd, buffer, 0, bytes, 0);
  } finally {
    fs.closeSync(fd);
  }
  let text = buffer.subarray(0, read).toString('utf8');
  const truncatedBytes = stat.size > read;
  if (truncatedBytes && !text.endsWith('\n')) {
    text = text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1));
  }
  const lines = text.split(/\r?\n/);
  const truncatedLines = lines.length > maxLines;
  const rows = [];
  let parseErrors = 0;
  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    if (!lines[index].trim()) continue;
    try {
      rows.push({ line: index + 1, value: JSON.parse(lines[index]) });
    } catch {
      parseErrors += 1;
    }
  }
  return { rows, parseErrors, truncatedBytes, truncatedLines };
}

function baseEvent({
  harness,
  sessionId,
  timestamp,
  eventClass,
  actor,
  category,
  signals = [],
  tool = null,
  usage = null,
  cwd = null,
  repoHint = null,
  control = null,
  line,
}) {
  const normalizedTimestamp = isoTimestamp(timestamp);
  return {
    schema_version: 1,
    harness,
    session_id: sessionId,
    timestamp: normalizedTimestamp,
    event_class: eventClass,
    actor,
    category,
    signals: [...new Set(signals)],
    tool,
    usage,
    cwd: safeString(cwd),
    repo_hint: safeString(repoHint),
    control,
    evidence: {
      session_id: sessionId,
      timestamp: normalizedTimestamp,
      event_class: eventClass,
      line,
    },
  };
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_LINES,
  baseEvent,
  boundedJsonl,
  classifyCommand,
  contentText,
  fingerprint,
  firstString,
  heuristicSignals,
  isoTimestamp,
  parseStructuredResult,
  safeString,
  structuredSignals,
  usageSummary,
};
