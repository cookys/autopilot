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
