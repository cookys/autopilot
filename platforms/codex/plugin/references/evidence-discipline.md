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

**Second data point (2026-08-27), from the other direction — the RAIL is part of the instrument too.**
`grok-4.6` on the `grok` CLI is a recorded implementer FAIL: 23/24, the single miss an integrity
violation carrying a `false_pass_critical` — a behaviour failure, not a capability one. The same model
family at the same effort, administered through the `cursor` rail, returned a clean 24/24 with all four
zero-tolerance counters at zero. Three variables differ between the rows (runner, harness version, and
the fast lane), so this attributes nothing to a specific harness property — but it does show that a
FAIL can be a claim about the rail, and it is direct evidence for the premise `engine-onboarding`
otherwise asserts on principle: qualification binds to **engine + runner + role**, never to a model
name. Note the reasoning that nearly prevented the measurement: "its sibling failed on a more direct
rail, so the expected value is poor" silently equates *the model failed* with *the model failed on that
rail* — the exact conflation the binding rule exists to forbid.
Evidence: `docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/`.

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

## 14. A named mechanism with no resolvable referent is worse than a dead script

**Incident (found 2026-08-24, knowledge-routing review).** `skills/distill/SKILL.md` asserted, in two
places, that "the lint **reliably catches** structured tokens (email / IPv4 / `/home/<user>/` / FQDN /
key-shapes); bare hostnames and client names are the **gate's** job", and twice instructed the reader
to configure `~/.autopilot/distill/identifiers.deny` — a file **no code has ever read into a
decision**: nothing in the repo created it, no test fixture supplied it, and its only consumer was an
optional read that silently fell back to empty. The lint itself *did* exist — buried as an undocumented `--path` mode inside
`distill-scan.js`, a script whose every other line and whose entire inventory row describe a
conversation-history frequency scanner. Neither sentence named a path. So a reader following the skill
had no way to tell which half was real, and **no gate could tell either**.

> **Prose 具名的機制沒有可解參照的實作,等同從未寫過 —— 而且它比 dead script 更毒,因為連「去檢查它
> 有沒有在跑」的對象都不存在。**

§1's dead script is at least inspectable: you can open it, grep its callers, and discover it is inert.
An unnamed mechanism offers nothing to inspect. The reader inherits a belief in a defense with no
address, and the belief propagates — a reviewer reads "the lint reliably catches", concludes the
structured-token class is handled, and spends their attention elsewhere. The false confidence is the
damage, and it is the same shape as §8: a label standing in for a property.

**This family was already named.** `CLAUDE.md` recorded the 2026-08-06 caution — *a script existing is
not evidence it is running* — and this very file collected the family around it. The distill sentence
was written afterwards and survived every subsequent review. **Naming a failure class does not defend
against it; only a gate does.** Three weeks, in a repo whose CLAUDE.md carries the warning in bold.

The enforcer pair, both required because either alone is inert:

1. **The writing rule** — an asserted mechanism must name its executable path
   (`references/skill-contract-card.md` § Review checklist). Without this the gate has nothing to
   dereference; the ghost lint slipped through precisely by never naming one.
2. **The gate** — `scripts/doc-drift-gate.js`'s `script-refs` check dereferences every
   `scripts/<name>.<ext>` reference in `skills/**` and `references/*.md` and fails on any that does
   not resolve (run by the doc-drift gate check in `preflight-portability.sh` — `check_doc_drift`,
   labeled "doc-drift gate: internal links resolve + code-fences balance").

**Check**: for every sentence in a skill that promises a mechanical defense, ask *what is its path?*
If the sentence cannot answer, the defense is unverifiable — and per §"The one question", the working
case and the broken case look identical from where you are standing.

---

## 15. A claim's layer decides its evidence class — get the layer wrong and no amount of evidence saves it

**Incident (2026-08-25, peer-coordination spike for the `docs/BACKLOG.md` peer-coordination-skill
item).** A message sent to a peer's machine landed on the wrong session on that machine — the receiving
protocol addresses a *machine* (one identifier shared by every session on it), not a *session*. The
first report called this "misdelivery" and proposed logging a failure rate. That was wrong: the
message reached the machine it was addressed to. The protocol never promised to select a session — it
has no field for one — so nothing failed at the transport layer; the outcome there is a documented
fact about the interface, not a rate to be measured. A same-day correction swung the other way and
called the whole thing "not a failure, session-selection is merely undefined" — which was *closer* but
still wrong, because it silently discarded a real failure one layer up: **the intended recipient may
never see the message, and that layer carries no receipt at all.** Three tellings, three different
claims, and every one of them was backed by real observation. What changed between them was never the
evidence — it was which layer the sentence was actually about.

Split the claim before asking what would verify it:

| Layer | What the evidence would need to show | Evidence class |
|---|---|---|
| Transport (reaches the addressed identifier) | Delivery per the interface's own contract | **Interface fact** — the type signature already proves it; verified once, by reading the schema |
| Addressing (selects among multiple valid targets sharing that identifier) | Whether the interface has a field for this at all | **Interface fact** — same: read the schema, do not infer it from a sample of outcomes |
| Recipient (the intended party actually observes it) | Whether delivery in fact occurred, this time, for this message | **Behavior observation** — needs a repro count, a machine, a date; a single instance proves only that a single instance happened |

An interface fact needs exactly one dereference — reading the type signature, the enum, the schema —
and no amount of repeating that dereference on other machines strengthens it, because the object under
test is the definition, not an environment. A behavior observation is the opposite: one instance never
generalizes, and reporting it as a rate (`n/n`) implies a denominator the incident does not support
unless the trial was actually repeated **and** every leg of it was pinned to the same layer.

The two errors above are the same root cause pointing in different directions. Reading a schema and
mistaking what it enumerates for a promise about behavior converts an interface fact into a false rate
(§"the working case and the broken case look identical" from below — here the confusion is not that
the outcomes look alike, but that a *fact about the type* and a *claim about an event* look alike once
both are phrased as prose). And correcting that error by re-deriving the interface fact still leaves a
genuine behavior-layer claim unaddressed, if there was one riding along in the same sentence.

> **Check**: before asking what evidence a claim needs, ask what *layer* it is a claim about. A
> sentence that mixes layers — "X failed" when X is actually "Y is undefined and Z has no receipt" —
> will pass any evidence-quality check aimed at the wrong layer, because the check was never aimed at
> what the sentence actually asserts.

---

## 16. A blind gate usually has two layers — fixing one leaves it blind

**Incident (2026-08-23, v2.34.38).** `check-test-integrity` was blind to all 300 test suites in this
repo. The visible layer looked like a missing config: autopilot had no
`.claude/test-integrity-config.md`, so the check fell back to a generic template glob. Fixing that
alone would have changed nothing, because the real layer underneath was that `parse_config` tested
`#` before `##` — `test_paths` had never been settable for **any** project, on any repo, ever. Worse,
supplying a `test_paths` value didn't fail loudly; it silently tripped `malformed_config` and fell
back to the same broken default, so the 510-line acceptance suite had never once exercised that code
path. Three documents claimed the config gap was already noted; none of them was true — an undocumented
gap is bad, but a gap **three docs claim is documented** is worse, because a reader stops looking.

A second layer in the same incident: the same "one bad regex" bypass reappeared three separate times
across a hardening round (`skip;`, a `#` truncated inside quotes, `( skip )` in a subshell) — each a
different one-character evasion of the same detection regex. Patching regexes one bypass at a time
never converges, because the bypass space is a grammar, not a finite list of known-bad strings. What
converged it was replacing the regex with a quote/escape-aware scanner driven by an enumerated grammar
of command-position/tail classes (45 probe classes) — and **naming the five classes it still does not
cover** (a time/coproc prefix, a leading redirect, a heredoc body, `eval`, a heredoc-form skip), each
pinned with its own boundary assertion so a future reader knows exactly where the blind spots are
rather than discovering them by incident.

> **Check**: when a gate reports "nothing to check" or "all clean" on a domain it should obviously see
> activity in, do not stop at the first explanation that fits. Ask whether the absence has a second,
> independent cause underneath the first, and whether any existing documentation claiming the gap is
> known is itself unverified. Verify a repaired detection gate by planting an adversarial bypass
> yourself — never accept a self-report that "it now catches X" — and prefer enumerating the class of
> evasions over patching each observed instance, because the difference is the gap between "one bug
> fixed" and "no further bug in this shape ships silently."

**Related**: `scripts/check-test-integrity.sh`, `scripts/lib/test-integrity-l1.py`.

## 17. Fixing the instance is not fixing the assumption — count the copies before you close

**Incident (2026-08-27, v2.34.42–44).** A heterogeneous review panel found that
`probe-engine-capability.sh` derived a runner's binary from the runner token, so the `cursor` runner
probed `cursor` — the IDE launcher — instead of `cursor-agent`. It was fixed, verified, and shipped.

The same assumption had **two more independent copies**. `qualification-sweep.sh` carried its own
inline `verbin="$runner"`, and it was found only when the tool was actually operated: it folded
stderr into stdout, ran the sanitizer over the launcher's error sentence, and passed
`--runner-version Error:-No-Cursor-IDE-installation-found.-...` into a **paid** qualification
administration. `runner_version` is part of the deployment identity that decides whether the evidence
is applicable later, so the run was about to mint a row that looked authoritative and could never
match anything. (A third copy existed in `src/readiness/probe.js` and was correct — but unexported and
welded to its module, so no other caller could reuse it. Correct and unreachable is still a copy.)

Two things generalise. First, **a review finding is about a site, not about the belief** — the panel
could only report what was in the diff it was given. Second, all three defects this release was built
around (`*/` closing a block comment, a fabricated `--cwd` flag, this one) were found by **using** the
thing, and two of them had already passed review with a PASS verdict attached.

> **Check**: when a review or an incident identifies a wrong assumption, do not close on the site that
> was reported. Grep for every other place that encodes the same belief and say how many you found —
> "one copy, checked" is a finding; silence is not. If several copies exist, the fix is one owner the
> others consume, and the count of independent copies must go **down**, not up. Then ask what would
> have surfaced it earlier than operating it in production, and build that instead of trusting the
> next review to catch the next copy.

**Related**: `scripts/lib/runner-binary.js`, `scripts/qualification-sweep.sh`, `scripts/check-js-syntax.js`.

---

## 18. A bound inside a fail-closed guard must refuse when it truncates

**Incident (2026-08-27, v2.34.44).** The repaired version-probe guard validated the first stdout line
and then scanned the tail for error markers — bounded at 20 lines. The same `Error: ...` line refused
when it sat at line 2 and was **accepted** when it sat at line 23. Only its distance from the top
decided whether the guard saw it. A module whose entire contract is "anything I cannot positively
validate refuses" had a limit that silently stopped looking, which is the same shape as the bug it was
written to prevent: a value nobody checked becoming an identity.

The sibling defect in the same code: stdout and stderr were folded with `2>&1`, so a diagnostic on
stderr could be read as the value. Separating the streams is what made "the version" a positively
identified thing rather than "whatever came out first".

A bound is not the problem — unbounded scanning of untrusted output is its own hazard. The problem is
a bound that fails **open**. The repair keeps a limit and refuses when the limit is reached, with a
reason distinguishable from a real error line, so an operator can tell "too much output to vouch for"
apart from "the output announced a failure". Every other bound in the module was then audited and
each one's behaviour recorded, rather than assumed.

> **Check**: for every cap, slice, `head -n`, timeout, or buffer limit sitting inside a guard, ask what
> happens to the material past it. If the answer is "it is not examined" and the guard's contract is
> fail-closed, the bound is a bypass with a length prefix. Refuse on truncation and give it its own
> reason string. Then enumerate the other bounds in the same unit and state each one's direction —
> a table of bounds that all fail closed is evidence; one unaudited bound is where the next one hides.

**Related**: `scripts/lib/runner-binary.js`.

---

## 19. A proxy is not the measurement — name what you counted and when it is written

**Incident (2026-08-27.)** A paid qualification run was killed mid-flight. Asked how much had been
spent, the orchestrator counted entries in the administration's `raw/` output directory, saw zero, and
reported "0 of 24 dispatches spent". The directory is written per case **on completion**; the dispatch
logs showed **seven** cases had already run. The number was not a lie and not a guess — it was a
plausible stand-in adopted without asking what it actually measures relative to the event being
claimed.

This is the same failure as the two around it, one layer up: an error sentence was accepted as a
version because it was string-shaped, and a directory count was accepted as a spend count because it
was in the right place. In each case the observation was real and the **binding between observation
and claim** was never checked.

> **Check**: before reporting a quantity as fact, state what produced it and when that artefact is
> written relative to the event you are describing. If the artefact lands at completion, it cannot
> count things in flight. Prefer a source that is written by the event itself (a dispatch log, a
> receipt) over one written by its aftermath, and when only a proxy is available, report it as a proxy
> and say so — "raw/ shows 0 completed cases; in-flight count unknown" is honest, and "0 spent" is not.

**Related**: `docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/`.

---

---

## The one question

Before recording anything as verified:

> **What would this look like if it were broken — and would I be able to tell?**

If the broken case and the working case produce the same observation, you have not verified anything
yet. Plant the broken case and watch it fail. That is the only step that converts a green run into
evidence.
