#!/usr/bin/env node
/**
 * version-drift-check — SessionStart (opt-in, Tier B)
 *
 * One-line advisory when your **dev-mode** autopilot clone has fallen behind its
 * git upstream, so a session doesn't silently run a months-old plugin. Born from
 * a real 2026-06-26 report: a session loaded 2.13.1 while the source clone sat at
 * 2.25.8 with no signal anywhere that an update was waiting.
 *
 * Scope — deliberately narrow + honest:
 *   - Only acts in DEV MODE, where CLAUDE_PLUGIN_ROOT resolves (through the cache
 *     symlink) to a real git work tree. Release/marketplace users have no clone to
 *     compare against → silent no-op (never a false "you're behind" for them).
 *   - NO network. Uses the already-fetched upstream ref (`@{u}`); reports
 *     `HEAD..@{u}` commits-behind "as of your last fetch". Never runs `git fetch`
 *     (a SessionStart hook must not add latency or require connectivity).
 *   - Sibling of reload-watch.js (PostToolUse, mtime-based, "you pulled but didn't
 *     /reload-plugins"). This one is the complementary "you haven't pulled" signal.
 *
 * Fail-open: ANY error, missing upstream, non-git root, or detached HEAD → emit
 * empty additionalContext, exit 0. An advisory hook must never break a session.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
  }).trim();
}

function driftHint() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!root || !fs.existsSync(root)) return "";

  // Must be a git work tree (dev mode) AND its top-level must BE the plugin root —
  // not merely nested inside some unrelated parent repo (a release/plain plugin dir
  // that happens to live under a git tree would otherwise borrow the PARENT repo's
  // @{u} and emit a bogus "behind upstream" warning). Release snapshots → silent.
  let topLevel, realRoot;
  try {
    topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    realRoot = fs.realpathSync(root);
  } catch {
    return "";
  }
  if (!topLevel || fs.realpathSync(topLevel) !== realRoot) return "";

  // Need an upstream tracking ref; detached HEAD or no @{u} → nothing to compare.
  let upstream, behind;
  try {
    upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    behind = parseInt(git(root, ["rev-list", "--count", "HEAD..@{u}"]), 10);
  } catch {
    return "";
  }
  if (!upstream || !Number.isFinite(behind) || behind <= 0) return "";

  return (
    `\n\n⚠ autopilot dev clone is ${behind} commit${behind === 1 ? "" : "s"} behind ` +
    `${upstream} (as of your last fetch). To update: run \`git -C ${root} pull --ff-only\` ` +
    `in a shell, then \`/reload-plugins\` here — this session is running the older ` +
    `checked-out version.`
  );
}

function run() {
  let context = "";
  try {
    context = driftHint();
  } catch {
    context = "";
  }
  // SessionStart hook → always emit the SessionStart output shape. (driftHint
  // already returns "" when CLAUDE_PLUGIN_ROOT is unset, so the empty-context
  // fail-open case still produces a valid, schema-correct envelope.)
  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  };
  process.stdout.write(JSON.stringify(output, null, 2).replace(/\r\n/g, "\n") + "\n");
  process.exit(0);
}

run();
