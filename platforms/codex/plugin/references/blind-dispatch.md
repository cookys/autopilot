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

## Clarifying questions survive auto-approve

A separate blind spot from prior-verdict leakage, but it lands in the same
re-/blind-dispatch territory: **auto-approve flags do not silence the model's
own clarifying question.** `--dangerously-skip-permissions` (Claude Code),
`--approval-mode yolo` / `--yolo` (Gemini), and codex's auto-approve all
suppress *tool-authorization* prompts only — "may I run this command / edit
this file". They do **not** suppress the model deciding it lacks enough
information and asking the human a question. In an interactive session a human
answers; in a non-interactive `-p` / headless worker there is no human, so the
worker blocks on its own question until `--print-timeout` fires, then dies with
no caller-visible signal about *why*.

Evidence, stated at its real confidence level (do not over-claim):

- **Confirmed for codex**: auto-approve is documented as ignored on clarifying
  questions — the worker still stops and re-prompts (20-25 prompts observed).
  See codex issues [#10187](https://github.com/openai/codex/issues/10187) and
  [#2138](https://github.com/openai/codex/issues/2138).
- **Expected (asserted, not yet observed) for Claude Code** under
  `-p --dangerously-skip-permissions` — autopilot's primary hetero-dispatch
  target. The mechanism is the same (auto-approve is a permissions concept, a
  clarifying question is a turn-completion concept — orthogonal), but autopilot
  has **not** yet captured a real run hanging on it. Treat as "expected, confirm
  with a real run," not "autopilot has hung on this."

**How the caller reads it**: a hetero worker that stops without a commit on a
timeout or non-zero exit is surfaced as `QUESTION_SUSPECTED` by
[`scripts/dispatch-hetero.sh`](../scripts/dispatch-hetero.sh) (vs `no_op` for a
clean exit-0-no-commit). That signal is the cheap, CLI-agnostic stand-in for
"the worker probably paused on a question" — see
[`hetero-dispatch.md`](hetero-dispatch.md) § "Outcome states". No stream
parsing is involved; the signal is derived from exit status + git artifacts
only.

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

## Doubt-theater self-audit (cross-cycle — are you doubting or just validating?)

Everything above is **per-dispatch** hygiene (scan *this* prompt for leaked
verdicts). This is a different layer: a **cross-cycle** check on the
dispatcher's *own* accept/reject behavior. Blinding the prompt is worthless if
you then rubber-stamp whatever comes back.

> **Self-audit prompt** (NOT a mechanized signal): across **2+ blind re-dispatch
> cycles** where the reviewer surfaced *substantive* findings, if you classified
> **zero** of them as actionable, you are **validating, not doubting** — treat
> that as a signal to *harden the next dispatch* (sharper scope, an adversarial
> angle the reviewer hasn't tried), not to pass.

This is a forcing-function prompt, not a counter — it relies on the dispatcher
honestly reading its own ratio, the same way the rest of this file is contract,
not code (see "Where this principle is referenced"). If a deterministic version
is ever wanted, route the cycle count through a `risk-counter.js`-style
persistent store — a separate, deferred decision, not built here.

## Disjointness gate ≠ reviewer clearance (the carve-out)

`/l4 /l5` width fan-out authorizes batch parallelism with a **deterministic
file-disjointness gate** (`scripts/check-disjointness.sh`, default **fixed cap 3**):
each parallel unit declares an allowlist, and the gate reads git artifacts to fail
closed if any unit's actual commit touches a file outside its declared scope.

> **🔴 The gate certifies FILES ONLY, not behavior.** Semantic coupling — shared
> types, import edges, call-order invariants — between two **file-disjoint** units
> is invisible to a file-path check and remains **the reviewer's to catch.**

This carve-out is load-bearing for review integrity: a green disjointness stamp is
**not** a behavior clearance, and must never be allowed to shrink the depth-0 qc.
The dominant failure mode of width fan-out is precisely *disjoint-file semantic
coupling* (unit A renames a type, unit B imports the old name — zero file overlap,
broken build). If the reviewer treats "files are disjoint ⇒ probably fine" the green
stamp **induces rubber-stamping** and makes that failure mode worse, not better.
So when reviewing a fanned-out batch, the depth-0 qc reviews the **combined** diff
for cross-unit coupling *exactly as hard* as it would a single-unit diff — the gate
narrows nothing about the reviewer's job.
The disjointness gate certifies files only, not behavior.

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

## Anti-gaming pre-flight — no suppression / no severity-coaching (EVERY dispatch)

The leaky-phrase checklist above is **round-2+ only** (re-dispatch leakage). This is a
**different, orthogonal class** that applies to **every** dispatch including round 1: a
dispatcher must not **coach the reviewer to go soft** — telling it what to ignore, or
**pre-rating** a finding's severity. A prompt can be perfectly blind-safe yet still say
"if you find a null-deref, call it Minor at most" — and the reviewer, primed, ships the flaw.

Forbidden in any dispatch prompt:

- Telling the reviewer to ignore / not report something ("don't flag the error handling",
  "ignore the auth path", "skip the concurrency cases").
- **Pre-rating** a finding's severity ("call it Minor at most", "treat that as a suggestion",
  "rate the null-deref low").

Acceptable (must NOT be confused with the above — honest calibration, not coaching):

- Stating the severity *vocabulary* the reviewer should grade with ("grade each finding
  critical / major / minor / suggestion").
- Honest don't-over-flag calibration ("don't over-flag — minor style nits destroy trust") and
  scope statements ("minor formatting is out of scope for this pass").

Linted by [`scripts/check-dispatch-suppression.sh`](../scripts/check-dispatch-suppression.sh)
(sibling of `check-redispatch-prompt.sh`; runs on **any** dispatch prompt, exit 1 ⇒ coaching
found ⇒ strip and re-dispatch). The patterns are anchored to **imperative-suppression grammar**
("(call|rate|mark|treat) it (as) (at most) &lt;severity&gt;", "do not (flag|report|treat)") — NOT
bare severity-word proximity — so the honest-calibration prose above does not trip it.

## Verifier isolation — artifacts only, never the implementer's self-report (EVERY dispatch)

**HARD RULE (MUST).** A verifier — any reviewer, QC panelist, or verdict-producing
judge — **MUST receive only artifacts**, and **MUST NOT receive the implementer's
self-report, summary, or chat narrative.** This is **orthogonal** to blind
re-dispatch (which strips *prior verdicts* on round 2+): verifier isolation applies to
**every** dispatch **including round 1**, and it strips the *implementer's own account
of what it did* — a different leak from a different source.

**Why (not theater):** a verifier that reads the implementer's self-report is anchored
by it and converges to **confidently wrong** — the multi-agent **hallucination cascade**
(arXiv:2606.07937): reviewers fed a peer's narrative rubber-stamp its claims and a
correlated blind spot goes unflagged, making N reviewers *more* confident and *less*
correct than one. The implementer's "what I did / it works / here's my summary" is a
**claim to be checked against artifacts, never an input that frames the check.** This is
the input-side enforcement of the axiom the write path already lives by ("verify by
artifacts, never self-report" — `dispatch-hetero.sh`, `check-disjointness.sh`,
`check-test-integrity.sh` all read git artifacts, never the worker's stream).

| Verifier input | Allowed? | Why |
|----------------|----------|-----|
| The diff / changed files / full file content | ✅ **Required** | The artifact under review |
| Test output, command output, build logs (as captured facts) | ✅ Yes | Machine-produced evidence, not the implementer's prose |
| The **original** task / plan / commit message | ✅ Yes | The baseline the verifier grades *against* — authored before/independent of the work, not a report of what was done |
| The implementer's self-report / "what I did" writeup / summary / chat narrative | ❌ **Forbidden** | Anchors the verifier → hallucination cascade. The verifier forms its own first impression from artifacts |
| The implementer's **own verdict** / self-assessment ("I think this is correct / done") | ❌ **Forbidden** | A self-graded pass is exactly the claim the gate exists to test independently |
| A prior *reviewer's* findings on round 2+ | ❌ Forbidden | Covered by blind re-dispatch above (different leak, same posture) |

> **Baseline vs report — the load-bearing distinction.** The *original task/plan/commit
> message* is allowed because it is the **specification** the verifier measures against,
> authored independently of the implementation. The *implementer's self-report* is
> forbidden because it is the implementation's **own account of itself** — the thing
> under test. When in doubt: "was this text written to *define* the goal, or to *claim*
> the goal was met?" Define → keep. Claim → strip.

**Where this is enforced structurally:** [`scripts/dispatch-review.sh`](../scripts/dispatch-review.sh)
assembles the reviewer prompt from the **diff text only** (`--diff-file`) — it has no
parameter through which a self-report could reach the reviewer, and empty/unparseable
capture is fail-closed (never a silent pass). Any script that assembles verifier input
MUST keep this property: pass artifacts, never the worker's account.

**The one carve-out — the shadow interrogation panel.** [`scripts/qc-panel.js`](../scripts/qc-panel.js)
deliberately feeds the node report (which *contains* the worker's verdict) to its judges,
because its design is **interrogate-the-claim-against-artifacts**, not form-a-blind-first-impression,
and it hardens against the cascade with a **refute pass** (`default-refuted-if-uncertain`).
This is tolerated **only** because it is **SHADOW / non-authoritative** (calibration-bearing,
never gating — see `skills/quality-pipeline/references/code-review.md` § "Shadow QC panel").
🔴 **It MUST NOT be promoted to authoritative while it ingests the self-report** — graduation
to a gating role first requires either (a) removing self-report ingestion (artifacts-only), or
(b) calibration evidence (`scripts/calibration.sh run-known-bad`) that the refute pass does not
false-suppress critical findings under self-report anchoring.

**Pre-flight (add to the per-dispatch scan):** before dispatching **any** verifier, confirm
the prompt/context contains **no** implementer self-report — no "here's what I did / changed /
implemented", no "it works / tests pass / this is done" narrative, no worker-authored verdict.
If any is present, strip it and re-assemble from artifacts + the original task baseline.
Mechanically, the spec travels via dispatch-review.sh --spec-file (dispatcher-authored, trusted); the diff remains the only untrusted input.

## Nested dispatch (subagents spawning subagents)

> Claude Code v2.1.172+ lets subagents spawn their own subagents (depth ≤ 5;
> see `references/multi-agent-portability.md` §7). Enforcement of the rules
> below is documentation + agent-prompt-contract only:
> `scripts/check-redispatch-prompt.sh` runs in the dispatcher's session and
> CANNOT see prompts constructed inside a subagent — no harness hook
> intercepts nested dispatch today. The one structural lever is the `tools:`
> line in `agents/reviewer.md` — never add `Agent` or `Task` to it.

**The blinding boundary is who holds verdict context, not the round number.**
Whoever knows prior findings must never be the one who dispatches the next
verdict. (Depth numbering follows `agents/README.md` § Orchestration: main
session = depth 0, dispatched agent = depth 1, its child = depth 2.)

| Nested pattern | Allowed? | Why |
|----------------|----------|-----|
| Round-N reviewer dispatches its own **round-N+1 replacement** | ❌ **Forbidden** | The reviewer knows its own findings — any re-dispatch prompt it writes is leaky by construction, and the dispatcher-side linter never sees it. Blindness collapses |
| **Fixer** (non-blind, holds full findings) dispatches a **verdict-producing** child ("verify my fix" sub-review) | ❌ **Forbidden** | Same collapse from the other side: the child inherits the finding context. A fixer's self-verification never substitutes for the dispatcher's blind re-review |
| Fixer dispatches **fix-executing** children (decompose a multi-file fix) | ✅ Yes | Fixer dispatch is non-blind by design — but each child's applied fixes must be reported up so the dispatcher can increment `scripts/risk-counter.js` (the WTF cap cannot see nested fixes otherwise) |
| Reviewer dispatches read-only **evidence gatherers** within its round (find callers, enumerate sites) | ⚠ Future only | `agents/reviewer.md` Red Lines keep the reviewer terminal ("Never call another agent") and its tool list excludes `Agent`/`Task`. Relaxing this requires an explicit Red Line revision plus an update to this row — never just a `tools:` addition. If so revised: sub-prompts must contain none of the parent's findings ("I found X — check for similar" anchors the child), and `✅ Verified Clean` is **non-delegable** — the top reviewer may not clear code it has not read. Every sub-finding is re-verified at `file:line` before inclusion |
| Planner dispatches read-only **research children** (codebase exploration) | ✅ Yes | Planner is not a blind role and produces no verdict; children are research-only (see `agents/planner.md` § Research Children) |

Three clauses hold at **every nesting depth**:

1. **Verdict dispatch originates only from the dispatcher (depth 0).** Any
   agent holding finding context — its own or received — must not dispatch
   an agent whose output is a review/audit verdict on the same target.
2. **No round-cycle meta-signal flows down.** Nested children are never told
   the round number, that a fix landed, or that a re-review is in progress.
   The full pre-flight checklist above applies to every prompt at every
   depth — including prompts the fixer writes for its children (intent-only
   at depth ≥ 1: the linter cannot see nested prompts — see the enforcement
   caveat above).
3. **Round-delta stays at depth 0.** Output of
   `scripts/diff-since-last-round.sh` (any subcommand) must not enter ANY
   subagent prompt at any depth, and no child may be pointed at the
   checkpoint file (`<git-dir>/autopilot-rereview-checkpoint`).

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
