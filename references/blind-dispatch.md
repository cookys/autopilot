# Blind Re-Dispatch — Quality Gate Self-Bypass Prevention

> Shared reference for all autopilot skills that re-dispatch a methodology
> agent **after the calling skill has applied fixes**. First-pass full-context
> dispatch is correct and intentionally preserved — this principle applies
> only when the same agent role is being asked a second (or third) time on
> the same target.

## Why this exists

A quality gate is an **adversarial check**, not a status confirmation. When
a SubAgent re-reviewing a file sees that an earlier reviewer said `FAIL` and
a fixer has just patched the cited line, the cheapest path to "PASS" is to
confirm the fix at the cited line and stop looking. Every other latent bug
in the file becomes invisible. The gate has been bypassed — by its own
dispatcher.

The discipline is **outcome-blinding**: the dispatcher (the calling skill,
or main session orchestrating it) must remove all signals of prior verdicts
before re-dispatching the agent. The agent must form its own first
impression. If the fix didn't hold, the fault surfaces naturally; if a
different latent bug exists, it is just as likely to be flagged.

## Scope — when this applies

**Rule of thumb (read this first)**: if I am asking the agent role for the
same kind of verdict it already produced on the same target, strip the
prior verdict before asking again. Otherwise the agent role's first
verdict effectively becomes the input to its second — anchoring kills the
check.

| Phase | Apply blind dispatch? | Why |
|-------|----------------------|-----|
| **First-pass review / audit** | ❌ No | Full context is correct on round 1 — `agents/reviewer.md` Workflow §1 mandates reading every file affected by the change, and there are no prior verdicts to leak yet |
| **Re-review after fixes** (`quality-pipeline` Re-review Loop) | ✅ **Yes** | Round 2+ dispatcher must strip prior round's findings before invoking the agent again |
| **Re-audit after fixes** (`audit` Phase 2 segment re-dispatch in a Phase 4 fix cycle) | ✅ **Yes** | Same as above for segment-by-segment audit |
| **Fixer dispatch** | ❌ No | A fixer is NOT a reviewer — it needs the specific findings to act on; blinding the fixer forces it to re-derive the problem and slows the loop |
| **Domain-expert handoff** (`NEEDS_DOMAIN_EXPERT`) | ❌ No | A domain expert receives the full reviewer report by design — the handoff IS the context |

## Three Red Lines lens

The blinding rule does not contradict any of the Three Red Lines:

- **Closure** is unaffected — the new reviewer still produces findings with
  impact + fix direction; the dispatcher just doesn't pre-load them.
- **Fact-driven** is unaffected — the new reviewer still cites
  `file:line`; the dispatcher just doesn't tell it which lines to look at.
- **Exhaustiveness** is **strengthened** — by removing the prior round's
  focus, the new reviewer is forced to run the full checklist again, not
  just verify the cited findings.

Anchoring is itself a fact-driven violation (the reviewer's prior verdict
is not a fact about the current code state — it is a fact about a previous
snapshot, and the fix may or may not have held). Blinding restores
fact-driven integrity to round 2+.

## Leaky vs blind — re-review prompt comparison

**Scenario**: Round 1 of `quality-pipeline` review found an Major finding
at `src/components/SearchBar.tsx:42` (unhandled null on `query` prop). The
calling skill dispatched a fixer SubAgent which applied a patch. Now
`quality-pipeline`'s Re-review Loop is about to dispatch `autopilot:reviewer`
a second time to confirm the entire diff is clean.

> Severity nomenclature: unified across `quality-pipeline` and `agents/reviewer.md` as
> 🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion. Forbidden-phrase list below
> targets this vocabulary.

### ❌ Leaky re-dispatch prompt (anti-pattern)

```
Re-review src/components/SearchBar.tsx against the original task.

FYI from prior review: Round 1 (commit <round-1-sha>) found an Major
finding at line 42 — unhandled null on the `query` prop. A fixer applied
a patch in the following commit; you are re-reviewing to verify the fix
held. Pay particular attention to null handling on `query` around line 42.
```

**Why this is wrong**: the dispatcher has told the SubAgent
(a) the file was previously failed,
(b) the exact line of the prior finding,
(c) the exact problem class (null handling on `query`),
(d) that a fixer just touched it,
(e) where to look.

The SubAgent's cheapest path is to inspect line 42, confirm the patch, and
return PASS. Other null-deref paths, error-handling gaps, or regressions
introduced by the fix are now in the agent's blind spot. Three Red Lines
exhaustiveness is violated by the dispatcher, not the SubAgent.

### ✅ Blind re-dispatch prompt (correct)

```
Review src/components/SearchBar.tsx against the original task. Apply
autopilot:reviewer Three Red Lines + 4-tier severity. Cite findings with
file:line. Report ✅ Verified Clean for each checklist section you
inspected without finding issues.

Original task: refactor SearchBar to use the new Input primitive,
preserving prop APIs.
```

The SubAgent forms its own first impression. The dispatcher knows the
prior finding internally and can pattern-match the new report against the
prior one to determine whether the fix held — but that comparison happens
**in the dispatcher**, not in the agent's session. The example above is
the strictest form: the SubAgent has no signal it is round 2+. Any
round-cycle meta-signal — including "this is a re-review, re-derive from
scratch" — is forbidden (see checklist below).

## Fixer remains NON-blind

When round 1 returns a finding like
`🟠 src/components/SearchBar.tsx:42 — unhandled null on query`, the
**fixer** receives the full context: line number, quoted code, prior-cycle
constraints, anything else needed to act. Blinding the fixer would force it
to re-derive the problem before fixing — wasted budget, slower loop. The
blinding rule is specifically about **reviewer-role re-dispatch**, not
fixer dispatch.

## Dispatcher pre-flight checklist

Before sending any **re-dispatch** prompt (round 2+ for the same agent role
on the same target), scan it for these phrases. If any survive, the prompt
is leaky — strip it before dispatch.

- "Round 1" / "Round 2" / "previous review" / "previously flagged"
- "Last cycle" / "earlier" / "before the fix"
- "Fixer applied" / "patched at line N" / "fix just went in"
- Specific line numbers tied to a prior finding (e.g., "around line 42")
- "Verify the fix" / "confirm the patch held" / "re-check"
- Specific aspect labels from a prior verdict (e.g., "focus on null handling")
- Severity tier names OR tier glyphs (🔴 🟠 🟡 🔵) tied to a prior finding (e.g., "the Major from round 1", "the 🟠 from last review")
- Quoted code excerpts pulled from a prior finding's body
- Round-cycle meta-signals — even framed as "no leakage": "this is a re-review",
  "re-derive findings from scratch", "no prior context is being passed"

Acceptable to retain in the prompt:

- The original task description (this is the baseline, not a prior verdict)
- The full unmodified file diff (re-reading the diff is part of inspection)
- The methodology contract (`autopilot:reviewer` Three Red Lines, 4-tier
  severity, ENUM Handoff)

Not acceptable (despite seeming innocuous):

- "This is a re-review — re-derive findings from scratch" — the meta-signal
  of round 2+ still nudges the SubAgent toward over-search. Send the prompt
  as if it were a first-pass; the dispatcher tracks the cycle, not the agent

## Where this principle is referenced

| Site | How it consumes blind-dispatch |
|------|-------------------------------|
| `skills/quality-pipeline/references/code-review.md` (Re-review Loop) | Cites this doc; round 2+ reviewer dispatch follows the checklist above |
| `skills/audit/SKILL.md` (Phase 2 + Phase 4) | Cites this doc; re-audit on the same segment after fix follows the checklist above |

> Maintenance: this table is hand-maintained. If you add a new consumer site
> that re-dispatches a methodology agent after a fix, add a row here so the
> reference set remains discoverable. No grep test enforces this — depends
> on diff discipline. Verification grep:
> `grep -rln 'references/blind-dispatch.md' skills/` — every site that
> shows up must appear in the table above.

## Inspired By

The outcome-blinding principle is borrowed from
[claude-powerloop-plugin](https://github.com/elct9620/claude-powerloop-plugin)
v0.4.0+ (Apache-2.0), specifically its
`skills/powerloop/examples/blind-dispatch.md`. powerloop applies the
principle in a cron-loop multi-cycle setting; autopilot adapts it for
session-driven re-dispatch under quality-pipeline and audit.

## See Also

- `agents/reviewer.md` — first-pass review methodology (full context, by design)
- `agents/README.md` — methodology agents and the ENUM Handoff contract
- `skills/quality-pipeline/references/code-review.md` — consumer site (re-review loop)
- `skills/audit/SKILL.md` — consumer site (re-audit)

## Out of Scope (for now)

This v1 doc covers **reviewer- and auditor-role re-dispatch only**. A re-dispatched
debugger (re-investigating a root cause after a partial fix) plausibly faces
similar anchoring risk — confirming the prior hypothesis instead of re-deriving
— but autopilot has not observed the failure mode in practice yet and
`agents/debugger.md` is not a consumer of this reference. Add a debugger row to
the Scope table + a consumer-site citation in a future iteration if the failure
mode surfaces.
