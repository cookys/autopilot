# Evidence discipline — when green is not proof

> Companion to the CLAUDE.md caution "**a script existing is not evidence it is running**". That
> caution is one member of a family. This file collects the family, because each member was learned
> the same expensive way: something looked verified for weeks while verifying nothing.
>
> Every entry below is a real incident in this repository, with the artifact that now prevents it.

---

## 1. Existing is not running. Being called is not the same as existing.

The 2026-08-06 incident: several scripts were fully built, tested and documented, yet inert — an age
threshold left at `0`, a hook never installed, a scanner keyed on an id the residue did not carry.

2026-08-10/11 added two sharper variants:

**A component the code demands can simply never have been written.**
`src/engine/owner-kernel/witness.js` had said since P1 that "production callers must inject a
separate host-resident witness adapter", and the release gate required `trustTier === 'external'`.
No such adapter existed. Every P0–P4 suite had run against `MemoryWitness`, which the gate explicitly
refuses. The project sat complete-but-inert for three weeks, and the diagnosis "we are waiting for a
14-day window" was wrong: the component that would start the window did not exist.

**A component can ship with zero callers while its commit message claims otherwise.**
`shadow-terminal-observer.js` was committed with 8 passing unit tests and a message stating it "gives
terminal.js its first real caller". Nothing called it. The author of that commit had, in the same
session, diagnosed the identical failure in two other places.

> **A module with no caller is indistinguishable from a module never written, and its own unit tests
> pass in both cases.** Only an end-to-end run separates them.

Prevention: `hooks/tests/status-task-shadow-wiring.test.sh` runs the real entry point and asserts the
side effect lands. Remove the wiring and it fails.

**Check**: for anything you just claimed is wired, grep for its callers outside its own file and its
tests. Empty output is the finding.

---

## 2. A suite that passes when you delete the thing it tests has not tested it

Retiring KR10 as a release gate removed an entire gate from the disposition. Both of its suites
stayed green — they had never asserted that KR10 gated anything.

**Check**: delete the gate (or invert its result) and re-run. If the suite still passes, the suite was
measuring the gate's existence, not its effect.

This is why §2.5 of the promotion charter requires a planted negative control per gate, and why the
`no_third_outcome` test in `owner-kernel-terminal.test.sh` sweeps all 32 combinations rather than
sampling: exactly one may return COMPLETE, and an exhaustive sweep proves no other input reaches it.

---

## 3. A shadow derived from the answer it is checking is a tautology

The obvious way to build a second opinion on `can_close` is to derive the shadow's obligations from
`can_close`. That agrees 100% forever, because it is one conclusion restated. It would fill a
divergence monitor with data proving nothing while reading downstream as a validated shadow —
carrying the authority of a measurement without being one.

`shadow-terminal-observer.js` therefore builds obligations from the RAW evidence
(mission terminality, campaign terminality, acceptance verdict, integration) and never from the
predicate it judges, and adds one obligation legacy lacks (`evidence-bound-to-artifact`) so a real
divergence is reachable at all.

**Check**: can your second opinion ever disagree? If not, it is a mirror. A test that plants a
"claims pass, evidence says otherwise" input and asserts the shadow is not dragged along is the proof.

---

## 4. Absence of evidence must not read as agreement

`divergence-monitor.js` refuses a path with zero paired samples. "No disagreements observed" across
zero observations is not a statement about the path — it is a statement about the absence of testing.
Shadow-only observations are counted separately and fund nothing, so the gap stays visible.

Corrupt rows count against **every** path query, because a corrupt row has no readable path and
filtering it out would shrink the denominator — making agreement look better than it is, which is the
exact failure the counter exists to prevent.

---

## 5. Assert the property, not the machine you are sitting at

Provisioning the production trust roots turned 7 assertions red across two suites. They were not
wrong about the property; they checked it by asserting `trusted_authority_present !== true` — that no
authority exists anywhere — to prove a forged one cannot authenticate. That only holds on a machine
nobody has provisioned.

Re-anchored: an authority may exist; what must never happen is one resolved from a **caller-supplied
path**. The suites' own planted forgeries still fail, which is what distinguishes a fix from a
weakening.

Same root cause as the earlier `next-touch-validation.test.sh` incident (asserting against one
machine's un-versioned local state).

**Check**: would this assertion still pass on a fresh machine? Would it still pass on a fully
configured one? If the answer differs, it is testing the environment.

---

## 6. A refusal's wording is not the property

Four assertions pinned the exact refusal message. With a real authority installed, the loader reached
a later, equally valid refusal (stream binding mismatch) instead of the path-containment one, and
they failed while the property held perfectly.

Widen to the SET of refusals that all mean the same thing — never to "any reason", which accepts a
silent pass.

---

## 7. CI green is a claim about the summary line, not the log

Two prior incidents, both preserved here because they are the same shape:

- **Nested fixture FAIL lines**: a suite that plants failures prints `FAIL` on both green and red
  runs. Judge the run by its summary section only.
- **`run:` steps have no `pipefail`**: GitHub Actions' default shell swallows a pipeline's exit code,
  so `cmd | tee log` reports success when `cmd` failed. Set `shell: bash` with `set -o pipefail`, or
  do not pipe the command whose status you are trusting.

---

## 8. Tamper-evidence of a claim is not verification of the claim

**The incident (2026-07-20 → 2026-08-16, the owner-kernel retirement).** Over four weeks the repo
grew a ~27,000-line trust framework: a hash-chained event ledger, per-event witness receipts, a
root-owned notary adapter outside the repo, an OKR-gated release checker, a shadow second-opinion
observer. Every component defended one of two things — *the record cannot be rewritten afterwards*,
or *the emitter is who it claims to be*. Not one component could answer the only question the system
was built for: **was the claim true when it was recorded?** Independent re-derivation (re-run the
test, re-scan the diff, decorrelated review) existed nowhere; truth entered exclusively through
caller-injected verifier adapters that were never implemented. The kernel could not even run a test:
no `child_process`, no `fs.stat`, anywhere in 13 files. The machinery hardened the *ledger* against
an adversary who edits the past, while the actual adversary submits a false claim in the present —
through the front door, with valid provenance, onto an immutable chain.

Armor is not a verifier. If a component's failure mode is "the lie is now beautifully preserved",
it is bookkeeping, not verification — however much cryptography it contains.

**The second lesson, from the retirement's own review.** The retirement plan's author twice recorded
"verified" claims that decorrelated reviewers then refuted with line-precise evidence:

- *"zero external callers"* — the author's grep matched `new OwnerKernel(` and per-module require
  paths, missing static factory calls (`OwnerKernel.start/.resume`) and barrel requires
  (`require('./owner-kernel')`). Four production modules were live callers.
- *"the config file is retired machinery"* — `.claude/owner-kernel-governance.json` carries a
  kernel-flavored name but is a live mission-policy input read by five keeper surfaces; deleting it
  would have silently flipped mission enforcement from `enforce` to `off`.
- *"first-require tells you a test's subject"* — a keeper test's first require looked keeper-only;
  it destructured four kernel symbols further down.

Same-author verification inherits the author's blind spots: whoever wrote the grep pattern is the
wrong person to certify what the pattern cannot see. A reviewer from a different model family,
attacking the claim rather than confirming it, found in one pass what two same-author sweeps missed
twice. The quarried decision rule now lives in [`evidence-contract.md`](evidence-contract.md):
closure requires a clear challenge from a challenger that is not the author and not the author's
model family.

---

## 9. A green test that writes outside its sandbox is manufacturing tomorrow's false evidence

**The incident (discovered 2026-08-17, roster-qualification repair).** Every seat in the /l5
roster reported `qualification: unknown` and `/l5` fail-closed to inline. The cause was not
missing qualifications — it was that **289 of the 299 rows in the operator's real scorecard
store were test fixtures**: `hooks/tests/engine-qualify.test.sh` piped its `--emit-row` output
into `engine-scorecard.js record` without setting `ENGINE_SCORECARD_DIR`, appending one fake
`eng-review` row to `~/.autopilot/engine-scorecard/scorecard.jsonl` on every run — for weeks,
across every CI and local run, while the test itself PASSED every time. One leaked row carried a
dangling `supersedes` reference that crashed `current --role reviewer` outright; five old-schema
rows in the sibling capability-evidence store poisoned every role's `report-evidence`. The suite
was green; the green was the damage.

The trap is asymmetric visibility: a test's ASSERTIONS are checked on every run, but its WRITES
are checked never. Isolation that covers one store (`ENGINE_CAPABILITY_DIR` was set) reads as
"the test is isolated" while a second store leaks. The fix shape: every test that invokes a
store-writing tool asserts WHERE the row landed (a landing assertion in the isolated store), and
repairing the damage requires quarantine-and-filter, never wholesale deletion — 10 of the 299
rows were the only real qualification history the roster had.

---

## 10. An exam FAIL is a claim about the administration AND the candidate — attribute before you conclude

**Incident (2026-08-17, brain-seat first real administrations)**: the incumbent seat failed
3 of 4 subjects with "17 clean false positives" per trial. The raw-log replay showed those 17
were 5 UNIQUE flag pairs — 4 of them REAL plants — re-reported every round, because the
candidate prompt taught "cross-check every claim EVERY round" while the exam's pinned semantic
(per its own mock candidate) is incremental first-visibility flagging. A second subject failed
because the prompt never said the stream is 12 rounds long; a third sitting-2 failure traced to
the prompt's own final-round teaching conflict. Three separate FAIL lines were administration
defects wearing a seat-behavior costume — while one subject (fairness) was a genuine,
seed-stable capability miss that no prompt repair changed.

The trap: the grader is deterministic and the transport was clean, so the verdict LOOKS like
pure candidate signal. But the candidate prompt is part of the instrument, and a teaching
defect produces exactly the same red as incompetence. The counterfeit-signal test from §The
one question applies to every subject line separately: for each failed line, replay the raw
exchanges and ask "would a candidate doing exactly what the instrument TOLD it to do produce
this failure?" If yes, the line indicts the instrument. Repair the instrument (new identity,
recorded prompt-hash history), keep the FAIL rows untouched, and re-sit fresh — and when two
independent seeds then put the same subjects at the same margins, that is capability signal:
stop. A third sitting after that is selecting on the exam's own noise.

## 11. A grep is not a call graph — and a rule can be spelled in arithmetic

**2026-08-16 → fired 2026-08-17.** A retirement sweep asked "does anything enforce capability-claim
expiry at runtime?", answered **no**, and shipped that as evidence
(`docs/plans/evidence/2026-08-16-owner-kernel-retirement/p4-claim-expiry-non-enforcement.md`). It
even named the `2026-08-17` date and classified it harmless. At `2026-08-17T22:23:16Z` that expiry
hard-blocked every agy dispatch, every agy review, and every Codex PostCompact, and turned twelve
test files red.

The sweep was `grep -rn "expires_at|freshness" src scripts` plus a check for `require()` consumers.
Both instruments were blind in the same direction:

- **The consumers were subprocesses.** `dispatch-hetero.sh` and `dispatch-review.sh` run
  `node "$CLAIMS_SCRIPT" validate-consumer …`; `post-compact.js` runs
  `spawnSync(process.execPath, [validator, …])`. A `require()`/import search sees none of it. **A
  module with zero importers can still be the most load-bearing code in the repo** — the inverse of
  §1's dead-module lesson, and it hides in exactly the same blind spot.
- **The rule was computed, not spelled.** The enforcing line is
  `Date.parse(expiration(live)) <= nowMs`, where `expiration()` is derived from
  `observed_at + ttl_seconds`. Neither grep token occurs there. **Searching for a rule's vocabulary
  does not find the rule** when the rule is arithmetic over other fields.

The two dispositions this produces:

1. To prove a rule is *not enforced*, do not enumerate call sites — **make the condition true and
   watch what happens.** Shift the clock, delete the check, feed the expired input. §2's "delete the
   gate and see if the suite notices" applied to a claim of absence. Two independent agents each
   settled this in one run by rewinding `Date` seven days; the paper sweep had been wrong for a day.
2. Grep for the **enforcement verb**, not the field name: `die_`, `block(`, `exit 1`, `throw`,
   `precondition_failed` — then read what each one is conditioned on.

Related failure the same incident exposed: a fuse **nobody could defuse**. The four D3 claims replay
a hardcoded `codexHostObservedAt` (`probe-harness-capabilities.sh:126`) because a live Codex
compaction cannot be provoked from a script, so re-probing could never clear their expiry. **Before
shipping a check that fails on a schedule, verify the path that clears it actually exists and can be
run by the person who will be holding the pager.**

---

## 12. A file mtime is not a record timestamp — resumed sessions re-date old evidence

**Incident (2026-08-20, interactive-CC drivability spike).** Archaeology for "does interactive CC
still have TaskCreate?" grepped `~/.claude/projects/*/*.jsonl` and dated the hits by file mtime:
"TaskCreate fired on 8/17 and 8/20 — the tool exists today." A live probe the same hour said the
opposite (`NO_TASK_TOOL`, ToolSearch-backed). The contradiction was the dating method: **resuming a
session touches the whole transcript file**, so a file whose newest mtime is today can carry records
written only under an older CLI version. Per-record `timestamp` + `version` fields put every
TaskCreate hit at ≤ 2026-08-16 / CC ≤ 2.1.232 — the tool family was removed at 2.1.233 and the
mtime-dated "today" evidence was a ghost.

The general form: **append-mostly stores date their container, not their contents.** Any conclusion
of the shape "X was still happening at time T" drawn from a container timestamp (file mtime, dir
mtime, branch tip date, log rotation stamp) inherits every process that touches the container
without writing new content — resume, re-open, rsync, checkout, chmod.

Rule: when the claim is about *when a record was produced*, date it from a field **inside the
record**. If the store has no per-record timestamp, say so and downgrade the claim; do not let
`ls -lt` stand in for one. Evidence: `docs/plans/evidence/2026-08-20-interactive-cc-drivability-spike/`.

---

## 13. A fixture anchored to a non-production shape certifies a dead gate — pin bidirectionally

**Incident (2026-08-21, p6d-corrective-gates R2 review).** A gate's precondition read
`campaignControl.resume_candidate` at top level; production attaches it to the generation-claim
object. The unit test built its fixture in the SAME wrong shape — so the planted red fired, the
greens passed, mutations of the predicate went red, and the suite certified a gate that never
fires in production. The reviewer proved it with a REVERSE mutation: correcting the code made
the test go red — a test that fails when the code is fixed is anchored to a phantom shape.

Rule: when a test feeds a hand-built object into a unit that production feeds from elsewhere,
(a) derive the fixture shape from the PRODUCER's write site (cite it in the test), and
(b) pin BIDIRECTIONALLY — the production shape must trigger, and the plausible-wrong shape
must NOT ("reverse pin"). Forward mutation (neuter the gate → red) catches dead logic;
only the reverse pin catches dead WIRING. Evidence:
`docs/projects/_archive/2026-08-21-p6d-corrective-gates/` (R2/R3 reviewer reports).

---

## The one question

Before recording anything as verified:

> **What would this look like if it were broken — and would I be able to tell?**

If the broken case and the working case produce the same observation, you have not verified anything
yet. Plant the broken case and watch it fail. That is the only step that converts a green run into
evidence.
