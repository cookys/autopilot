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

## The one question

Before recording anything as verified:

> **What would this look like if it were broken — and would I be able to tell?**

If the broken case and the working case produce the same observation, you have not verified anything
yet. Plant the broken case and watch it fail. That is the only step that converts a green run into
evidence.
