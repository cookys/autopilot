# Context reset cost: stopping for /clear vs autocompact (2026-10-12)

Owner question (2026-10-12): the context-budget T2 directive stops work and asks the owner to `/clear`,
which breaks unattended flow. Does a reset at ~200K actually save tokens, and is there a better
mechanism than stopping?

## Current mechanism (as of `b8451faf`)

- Tiers: T1 100k, T2 150k, absolute defaults (`hooks/context-budget.js:79`), not scaled by window
  (commit `59c471ca`, 2026-10-12). Earlier builds scaled by window: on a 1M window T1 = 500k, T2 = 750k,
  so in the sessions measured below T2 practically never fired.
- Knobs: `~/.autopilot/config.json` `context_budget.{t1,t2,step,mode}`, or env
  `AUTOPILOT_CONTEXT_BUDGET_{T1,T2,STEP,MODE}`.
- T2 is advisory, not blocking. The PostToolUse hook exits 2 with a STOP + write-handoff + "tell the
  user to /clear" directive (`hooks/context-budget-lib.js:243-252`), and only the user can `/clear`.
- Recovery after `/clear` is `hooks/session-handoff.js` with `handoff_inject`. Recovery after a
  compaction is PreCompact `state-checkpoint.js` plus SessionStart(compact) rehydrate.

## Measurement

Model: opus-5-5, 1M window. Prices per Mtok: input $4, cache write $5, cache read $0.20, output $20
(repo price table, `hooks/cost-tracker-lib.js`; no long-context surcharge modelled, which is unverified).
Data: the five largest autopilot transcripts of the previous 7 days.

| Session | Turns | Actual cost | Max ctx | Turns > 400k (and their cost) |
|---|---|---|---|---|
| 1b6129a4 | 788 | $113 | 687k | 360 ($74) |
| 05ff716b | 397 | $42 | 718k | 217 ($29) |
| e041e8fe | 380 | $63 | 1.40M | 227 ($50) |
| df52a188 | 350 | $38 | 1.11M | 177 ($23) |
| 34a5c748 | 307 | $29 | 635k | 97 ($14) |

**Cost of a rebuild.** Across 8 measured session starts, the median starting context was 61k and the
median cost of the first 20 turns was $0.97 (range $0.73–1.27). One measured compaction went from 650k
to 66k, and its next 5 turns cost $0.42. We use a conservative rebuild cost R = $1.0.

**Break-even.** After a reset the context is about 85k. Each turn at context C then costs
(C − 85k) × $0.2/M less, so a reset pays for itself after this many turns:

| Context when leaving | Saved per turn | Break-even |
|---|---|---|
| 150k | $0.013 | ~75 turns |
| 200k | $0.023 | ~43 turns |
| 400k | $0.063 | ~16 turns |

**Replay (an upper bound).** We replayed each session's real per-turn growth and output, resetting
to 70k and paying R whenever the threshold was reached. Resetting at 200k cut the total from $284.5
to $220.3, about 23% (13–35% per session). The threshold barely matters: about 19% at 150k, 23% at
200k, 20% at 300k. The result is sensitive to R: at R = $3 most sessions lose money.

## Conclusion

- The saving comes from resetting the context, not from stopping. 61% of turns ran above 400k and
  produced 65% of the spend.
- A reset anywhere between 150k and 300k saves about the same. Stopping for a human adds an
  interruption and no extra saving.
- Owner decision (2026-10-12), applied on this host only:
  - `~/.claude/settings.json` `autoCompactWindow: 250000`. The setting is verified in the
    Claude Code 2.1.296 binary, together with env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and
    CLI `--autocompact <auto|tokens>` (100k–1M).
  - `~/.autopilot/config.json` `context_budget.t2: 300000`, so that T2 does not fire before the
    compaction.
- Not measured: information loss after a compaction or a handoff, and quality impact.

## Open: shipping it to users

Nothing in the repo knows about `autoCompactWindow` yet. See the BACKLOG row
"autocompact: users never learn to set autoCompactWindow". Proposed mechanisms:

1. Detection (mechanism):
   - context-budget and `dev-setup.sh --check` read the effective autocompact window. Precedence:
     env, then project settings, then user settings.
   - When the model window is 1M and no autocompact window is set, the owner-facing T1 toast
     carries one line recommending it.
2. T2 vs autocompact (guidance): when an autocompact window at or below T2 is set, drop the STOP
   directive, because compaction will reset the context anyway. This changes what T2 demands, so it
   needs ON/OFF eval evidence, or an explicit owner override.
3. Upgrade notice: the SessionStart update check (`hooks/session-start.js:164`) shows the CHANGELOG
   headings of every version since the user's last-seen one. Name the recommendation in the next
   release heading.

## How Claude Code resolves the window (read from the 2.1.296 binary, 2026-10-12)

The precedence proposed above ("env, then project settings, then user settings") was a guess. The
binary's resolver does this:

1. env `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: below 100k is raised to 100k, above 1M is capped. A value
   that is not a positive number is ignored and resolution falls through.
2. Settings, merged in the order user → project → local → flag (`--settings`) → policy, later
   wins. A file with a top-level `autoCompactWindow` replaces the default and drops the per-model
   entries of earlier files; a file without one merges its `modelSettings.<model>.autoCompactWindow`
   entries in. The model's own entry beats the default. `"auto"` means not set. `/autocompact`
   writes the per-model entry, not the top-level key. `--autocompact <value>` overrides settings.
3. With nothing set: a server-supplied window (client data), then an experiment, then the model
   default. For a native 1M model the model default is the full 1M window. One exception in the
   table: `claude-sonnet-5` on the cowork / local-agent surfaces defaults to 500k.

Compaction is off when env `DISABLE_AUTO_COMPACT` or `DISABLE_COMPACT` is set, or when
`autoCompactEnabled` is false. The statusline payload carries no auto-compact field, so a hook
has to re-derive the window from these inputs.

## Shipping, part 1: detection (branch `feat/autocompact-detect`)

- `scripts/lib/autocompact-window.js` re-derives steps 1 and 2 and the off switches. It cannot see
  `--settings`, `--autocompact` or a server-supplied window, so it reports "not set" rather than
  guessing a number.
- context-budget T1 adds one owner-facing line when the window is a known 1M, nothing sets a
  window, and compaction is on.
- `scripts/dev-setup.sh --check` prints the window in effect and its source file, and warns when
  none is set.
- Not done: the T2 wording (guidance, needs ON/OFF eval) and the release heading (version held at
  3.0.0, so it waits for the next release).

## Fresh-session test (session a14bb1ea, 2026-10-12)

Host settings: `autoCompactWindow: 250000`, `context_budget.t2: 300000`. Claude Code 2.1.296,
opus-5-5, 1M window per the statusline.

- T1 fired at 106k and again at 160k (50k step). Both went to the advisory sink only
  (`advisories/<sid>.jsonl`, kind `context-budget-t1`); neither reached the model.
- `lastT2Context` stayed 0 past 160k, as expected with T2 at 300k.
- Auto-compaction ran at 08:02:22Z. The last context the budget hook saw was 216,763 (so
  compaction triggers near 250k minus the reserved headroom, not at 250k). The first live
  reading after it was 71,261 (cache_creation 43,925 + cache_read 27,334). The session kept
  going and lost no work. `lastT2Context` was still 0, so T2 never fired.
- PreCompact did **not** write `~/.autopilot/compaction-state.md`. `.state-checkpoint.log`
  recorded `no_payload_skip` / `ENXIO: stdin not piped` at 08:02:22.528Z. All 21 PreCompact
  runs since May were the same skip, and no success has been logged since July. Cause: the
  hook opened the `/dev/stdin` path. Claude Code hands hooks a socket, and that open throws
  ENXIO. The old comment read this as "/compact pipes no payload". Fixed on this branch: the
  hook reads fd 0, and `hooks/tests/state-checkpoint-socket-stdin.test.sh` reproduces the
  socket (4 of 6 checks red on the old hook).
- Rehydration after compaction: no `<autopilot-restored-state>` was injected, because there
  was no file to inject. The session still knew its branch, its node (the code-review leg
  after verify) and its next command without re-reading any large file. Two sources covered
  it: Claude Code's own summary, and session-start's `[Autopilot Resume Hint]` (branch plus
  the last Bash command). On this evidence, Claude Code's summary alone was enough for a
  single-branch task. Whether the checkpoint adds anything is a question for the next
  compaction, now that it gets written.
- Per-session checkpoint (same branch, follow-up). With fd 0 fixed, one global
  `compaction-state.md` would have leaked: any session's startup or clear within the
  4-hour TTL would inject another session's state. Now each session writes
  `compaction-state-<sid>.md`. session-start injects it only on `source=compact` with the
  same session id, then deletes it. PreCompact prints nothing to stdout, because Claude
  Code appends that stdout to the summarizer's instructions.
- **Verify at the next real compaction** (not yet observed). `.state-checkpoint.log` should
  show `status: success` with a real session id, `compaction-state-<sid>.md` should exist
  until the compact SessionStart, and `<autopilot-restored-state>` should appear right
  after the compaction.
- Next deliverable (backlog "Workflow snapshot at compaction"): replace the transcript tail
  with a snapshot of the workflow state already on disk, used at PreCompact (stdout to the
  summarizer, plus the file) and at /clear. The state comes from the dev-flow marker and
  the next legal node, git, plan and code review, the task list, the decision tail and
  in-flight dispatches. Gaps to land first: a task card holding the goal, success criteria,
  plan path, review ledger path and stated requirements, and a subagent roster written
  from SubagentStart and SubagentStop.
