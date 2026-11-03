# Plan — outcome-shaped quality gate: pre-push re-derives "tests ran green against this diff" (opt-in)

> Status: active · Owner: cookys · Frame: M, three deliverables (record writer, checker, hook wiring)
> Source: BL-0050 (row removed when this plan took over; the original entry file is in git at 57c4093f1). Owner ruled 2026-10-19: write the plan first.
> Binding constraint: [ADR-0001](../adr/0001-verification-over-attestation.md) Decision 5 (`docs/adr/0001-verification-over-attestation.md`): no hash chains, event ledgers, witness receipts, attestation issuers, trust roots.

## 0. Context / thesis

The P7 adjudication ruled out an enforcer that asks "was `Skill(quality-pipeline)` invoked": that governs process, and the
outcome it proxies (tests were run) already sits at 5/6 in the OFF arm
(`docs/backlog/outcome-shaped-quality-gate-enforcer-opt-in-replaces-the-rejected-invocation-che.md` Context;
`docs/plans/_archive/2026/08/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md`, "Ruling" item 6-7).
The ruling kept the enforcer alive as an opt-in row with an outcome predicate, and two conditions: an escape hatch and a
planted red case (same file, Context).

What exists today at push time:

- `.githooks/pre-push:78-146` is the qc-gate. For a range that touches a protected path it asks `qc_has_evidence`, which
  is a grep for a `QC-Verdict: PASS` line (`scripts/lib/qc-evidence.sh:41`) or the existence of `.qc/<sha>.verdict.json`
  (`scripts/lib/qc-evidence.sh:43-47`). Both are claims; nothing re-derives that a test ran. The hook says so itself:
  "A hook enforces the EXISTENCE of review evidence, never its QUALITY" (`.githooks/pre-push:12`).
- `skills/quality-pipeline/SKILL.md:99-110` ("Tests") emits no receipt. The "this ran" artifact the BACKLOG Trigger waits for
  does not exist.
- The selector `scripts/affected-suites.js` now has `--run`: it executes the selection one entry at a time and prints
  `rc=<n> <path>` per entry (`scripts/affected-suites.js:279-293`, `:295-313`). In `mode: full` it never runs
  `hooks/tests/run.sh` (header `:11-15`; `--help`).
- The selector builds its graph from the head tree via `git ls-tree` / `cat-file` (`scripts/affected-suites.js:118-135`), so
  it can compute the selection for a pushed SHA without checking that SHA out. Only execution needs a worktree.
- `.claude/qc-gate-config.md` does not exist in this repo, so the resolver falls through to the shipped template
  (`scripts/lib/resolve-config.sh:11-13`; `project-config-template/qc-gate-config.md:16-18`). `mode: block` is the default
  for the existing gate (`scripts/resolve-qc-gate.sh:31`).

Measured today (read-only, 2026-10-19, `node scripts/affected-suites.js --base HEAD~i --head HEAD~(i-1) --json` over the last
25 single commits on develop): 12 selective, 13 full. Selective results held 272 to 575 of 604 suites
(`stats.total_suites: 604`), including one-file changes that selected 338. Full came back for single commits whose only
reason was `unreferenced change (no suite reaches it): scripts/dispatch-hetero.sh`. Two consequences drive every choice below:
(1) re-running even a selective result is roughly half the suite; (2) about half of real commits cannot be judged by the
selector at all.

## 1. Problem

Nothing at push time can tell "tests ran green against this diff" from "someone wrote a trailer". The owner wants an
opt-in gate whose predicate is an outcome re-derived at push time, not a process claim, and which does not make the
default push path slower or stricter for anyone who did not ask for it.

## 2. OKR / KRs

Objective: with the gate on, a protected-path push whose tests did not run green against that exact SHA is refused,
and with the gate off nothing changes.

- KR1: gate off (the default, no config, no env): a protected-path push behaves byte-for-byte as before. Proof: the
  existing `hooks/tests/qc-gate.test.sh` stays green with no edit, plus one new case that a push with no `outcome` key never
  invokes the checker.
- KR2: gate on, planted case A (record says green, a selected suite actually exits 1): refused with `rerun_red`. Proof:
  new suite, red-then-green, see section 5.
- KR3: planted case B (no record for the pushed SHA): refused with `record_missing`.
- KR4: planted case C (record lists fewer suites than the selector re-derives for the pushed range): refused with
  `selection_shortfall`.
- KR5: planted case D (record exists for the parent of an amended commit): refused with `record_stale`.
- KR6: escape hatch works and is printed on stderr every time it is used.
- KR7: a selector `mode: full` result is reported as `unjudged_full`, never as a pass, and never silently.
- KR8: the checker cannot wedge a push on its own faults: internal error or timeout exits as "could not check", printed
  loudly, push allowed, same posture as `.githooks/pre-push:63-64` and `:79-83`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node >= 20.10, built-ins only; JSON emitter with a stable schema and documented exit codes (`CLAUDE.md` language rule).
- No hash chain, no event ledger, no signed or witnessed receipt, no append-only log of runs or waivers, no trust root.
  The only persisted artifact is one plain JSON record per pushed SHA, which the gate treats as an untrusted claim.
- The checker never trusts the record's own `selected` list; it recomputes the selection from the pushed SHA with
  `scripts/affected-suites.js` code (required as a module, not re-implemented).
- The record lives outside the working tree and outside git history: `$(git rev-parse --git-common-dir)/autopilot/qc-runs/<full-sha>.json`.
  Never under `/tmp`, never a tracked file (a tracked record would change the SHA it is bound to).
- The checker runs suites in a detached temporary worktree at the pushed SHA when that SHA is not the checked-out HEAD, with
  `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` unset, serially (never in parallel: parallel suites interfere).
- `hooks/tests/run.sh` is never invoked by the checker, the producer, or any verification command in this plan.
- Existing qc-gate behavior (trailer and artifact evidence, `mode`, protected paths) is not edited: this plan adds a stage, it
  does not change what the old stage demands (mechanism vs guidance rule, `CLAUDE.md` "Skill evolution rules").

## 3. Design

### 3.1 What is re-derived: three options

The predicate is "for the pushed SHA, the suites the selector picks for the range all exit 0". The question is who
produced the exit codes the gate believes.

**(a) The gate re-runs the selection itself.** On push, `check-test-outcome.js` computes the selection for
`<remote_sha>..<local_sha>` and runs `affected-suites.js --run` in a worktree at the pushed SHA.
- Cost: the selection is 272 to 575 suites for most commits measured above. At the repo average of about 5.6 s per suite
  (56 min / 604, an arithmetic estimate, not a measurement; spike S2 measures it) that is roughly 25 to 55 minutes in the
  push path, every push. `mode: full` (about half of commits) means the whole 56 minutes, and `--run` deliberately does not
  run `run.sh` in that mode (`scripts/affected-suites.js:296-299`), so (a) cannot even express it.
- Fooled by: a selector blind spot (it re-uses the selector, so a suite the selector misses is missed here too, and the
  evidence discipline §3 shadow warning applies: a check derived from the answer it checks is a tautology,
  `references/evidence-discipline.md:69`); flaky suites (red on a clean diff); a host that differs from the author's.
  It cannot be fooled by a fabricated claim, because there is no claim.
- ADR-0001: not attestation. It is pure re-derivation, the strongest form.
- Verdict: correct and unusable as a default push gate. Keep it as a knob (`rerun: all`) for a pre-merge or CI-like
  host that can afford the time.

**(b) quality-pipeline leaves a SHA-bound run record; the gate verifies the record by re-derivation and a re-run sample.**
The producer is `affected-suites.js --run --record`, which writes `{schema, head, base, mode, suites:[{path, rc}]}` for the
SHA it ran on. At push the gate (1) requires a record for the exact pushed SHA, (2) recomputes the selection itself and
requires `recorded suites ⊇ selected suites` and every recorded `rc == 0`, (3) re-runs a sample and requires every sampled
rc to be 0 and to equal the recorded rc.
- Cost: selection recompute is seconds (graph build over 1104 files, `stats.graph_files`). The sample is the cost knob:
  default = every direct suite (chain length 2 in `chains`, i.e. a suite that names a changed file) plus 20 more chosen at
  push time at random. At about 5.6 s per suite that is a few minutes, to be measured in S2. Budget cap
  `outcome_budget_s`, default 600.
- Fooled by: a fabricated record whose unsampled entries are false. If F of N recorded suites are really red and the sample
  is n, the chance the sample misses all of them is C(N-F, n) / C(N, n): with N=275, F=1, n=20 that is about 93% missed.
  So (b) reliably catches a record that was never produced by a run when the suites are red, and catches a red direct suite
  always, but it does not prove the other 250 suites. It also shares (a)'s selector blind spot.
- ADR-0001: borderline, so say it plainly. The record is a claim and is treated as one. What the gate adds is independent
  re-derivation of the two things it can re-derive cheaply (the selection, and a sample of results), and it labels the
  remainder "claimed, not re-derived" in its output. It carries no signature, chain, or tamper-evidence: nothing in it
  defends the record against rewriting, because that is not the threat (§8 of `references/evidence-discipline.md:166`).
  It is not an attestation issuer; it is a cheaper partial re-run. The honest label for the unsampled remainder is
  "unverified", and the output must say so (evidence discipline §4, absence must not read as agreement).

**(c) Record only, no re-run (check that a record exists and is all green).** Rejected: this is exactly the
`QC-Verdict` trailer one level down, a pure claim check, and ADR-0001 Decision 5 forbids it. It is listed only so the
negative control for "tests did not run" has a name for the design it must not collapse into.

**Recommendation: (b) with `rerun: sample` as the opt-in default, (a) as the `rerun: all` setting.** Reasons: (a) at 25-56
minutes per push will be switched off within a day, and a gate that is switched off guards nothing; (b) keeps the one
property that matters (the gate itself executes tests against the pushed SHA and a red result blocks) at a cost a person
tolerates; the weakness (unsampled remainder) is visible in the output and closable per host by `rerun: all`.

### 3.2 The two things (b) cannot judge, stated up front

- `mode: full` selector result (about half of recent single commits). v1 reports `unjudged_full` on stderr, naming the
  `full_reasons`, and does not block, because the only honest check is the 56-minute suite, which the project already
  defers to the pre-merge run (`CLAUDE.md` "Mission graph verification"; `scripts/affected-suites.js:296-299`). This is a
  large hole and it is named, not hidden: open question Q1 asks whether a recorded whole-suite run should be able to satisfy
  full mode.
- A selector miss. Both options re-use the selector. Existing evidence on its accuracy:
  `docs/plans/evidence/2026-10-13-affected-suites/miss-check.md`. The gate does not improve it.

### 3.3 Switch, default, escape hatch

Follow the shape of `hooks/branch-protection.js`: it self-gates and a disabled gate is inert
(`hooks/branch-protection.js:15-17`; `hooks/_shared/opt-in.js:13-20`, fail-safe at `:55-60`: garbage means OFF).
`branch-protection` itself is a Claude PreToolUse hook enabled by `~/.autopilot/config.json` `hooks.<stem>` or
`AUTOPILOT_HOOK_<STEM>`; the qc-gate is a per-clone git hook, so the per-clone config is the natural home.

- Switch: new key `outcome` in `.claude/qc-gate-config.md`, read through `resolve-qc-gate.sh --field outcome`, values
  `off | warn | block`, default `off`. An unknown value resolves to `off` (opt-in fail-safe, opposite of `mode`, whose
  unknown value fails closed, `scripts/resolve-qc-gate.sh:62`); the resolver prints the fallback on stderr so a typo is not
  silent.
- Env override: `AUTOPILOT_QC_OUTCOME=off|warn|block` wins over the file, so one push can be downgraded and a session can opt in.
- Further keys: `outcome_rerun: sample|all|none` (default `sample`; `none` is the plain-claim mode (c), allowed only with
  `outcome: warn`, rejected under `block` with a printed reason), `outcome_sample: 20`, `outcome_budget_s: 600`.
- Escape hatch: `AUTOPILOT_QC_OUTCOME=off git push` for the outcome stage only (the trailer stage still applies);
  `git push --no-verify` for everything, as today (`.githooks/pre-push:140`). Each use of the env hatch prints one line on
  stderr. No waiver log (that would be an event ledger).
- The hatch is mandatory per the BACKLOG constraint, and it is verified by a test (KR6), not just documented.

### 3.4 Coexistence with the trailer

Tighten, in the opt-in case only (not replace, not an independent parallel gate). With `outcome != off` the push
needs both: the existing `QC-Verdict` evidence (a reviewer judgment) and the outcome predicate (tests ran green). They answer
different questions; the trailer is not a stand-in for tests and the outcome is not a stand-in for review. With
`outcome: off` the code path is not entered. The existing stage's text and decision lib are not edited
(`scripts/lib/qc-evidence.sh` shared with `scripts/qc-evidence-status.js`, so the status chip and the hook cannot disagree;
the new stage is additive and the chip is out of scope for v1).

Protected paths: the outcome stage runs for the same pushes the qc-gate gates, i.e. `qc_touches_protected` is true
(`.githooks/pre-push:126`). It reuses the same range computation (`:108-121`).

### 3.5 Flow at push (outcome != off)

1. For each pushed ref, same range as the qc-gate. New remote branch uses `origin/HEAD..sha`; deleting a ref is skipped.
2. `check-test-outcome.js --range <r> --head <sha> --rerun <mode>` loads the record at the common-dir path, recomputes the
   selection, runs the checks in the order below, prints one JSON verdict plus a human line, exits 0 pass, 1 refuse, 2 could
   not check.
3. Order: record present, record head equals pushed SHA, recorded rc all 0, selection ⊆ recorded, mode not full, sample
   re-run. Cheapest first, so a missing record fails in milliseconds.
4. `block`: exit 1 from the hook with the failure name and a fix line. `warn`: print, allow.

## 4. Failure modes

Each has a name in the JSON verdict (`code`), a trigger, and what the user sees on stderr (first line shown).

| Code | Trigger | User sees |
|------|---------|-----------|
| `record_missing` | no file for the pushed SHA | `outcome gate: no test run record for <sha7>. Fix: node scripts/affected-suites.js --base <base> --head <sha> --run --record` |
| `record_stale` | record `head` differs from the pushed SHA, or record unparseable / wrong schema | `outcome gate: record is for <old7>, pushed <sha7> (amended or rebased since the run). Re-run.` |
| `recorded_red` | any recorded `rc != 0` | `outcome gate: recorded run has N failing suites: <paths>` |
| `selection_shortfall` | selector-derived suites not all in the record | `outcome gate: selector picks M suites the record does not list: <first 5>` (record's own `selected` field is ignored) |
| `rerun_red` | a re-run suite exits non-zero, or differs from the recorded rc | `outcome gate: record claims green but <path> fails when re-run (rc=1)` |
| `unjudged_full` | selector `mode: full` | `outcome gate: NOT JUDGED, selector returned full (<reason>); whole suite stays a pre-merge duty` (never a pass, never a block in v1) |
| `budget_exceeded` | sample re-run passes `outcome_budget_s` | `outcome gate: re-ran K of S sampled suites in <t>s, budget hit; rest NOT re-derived` (warn: allow; block: refuse, because a truncated check is not a pass, evidence discipline §18) |
| `worktree_failed` | detached worktree at the pushed SHA cannot be created, e.g. SHA not in this clone | `outcome gate: WARNING could not check (exit 2) - NOT enforced` (allow, loud, as `.githooks/pre-push:63-64`) |
| `checker_error` | any thrown error, missing node, missing selector | same "could not check - NOT enforced" line; never a silent pass |
| `flaky_red` | a sampled suite is red but passes on one immediate retry | reported as `rerun_red` with a `flaky: true` field; v1 still refuses (a flaky suite is the author's to fix), spike S3 decides whether to retry once |
| `config_invalid` | `outcome: block` with `outcome_rerun: none` | `outcome gate: block needs a re-run; outcome_rerun none is warn-only. Treated as warn.` |

## 5. Test and validation

New suite `hooks/tests/qc-outcome-gate.test.sh`, built on a throwaway git repo fixture with a tiny tree that the selector
can read (a script, a suite that names it, plus a protected-path commit). Expected suite lists are literals, not outputs of
the code under test (evidence discipline §59, `references/evidence-discipline.md:1277`). The suite must call
`finalize_test` (§51).

Negative controls, each shown red then green (evidence discipline §58, `references/evidence-discipline.md:1257`; `CLAUDE.md`
negative-control rule):

1. Claimed green, actually red (KR2). Fixture suite exits 1; the record says rc 0. Refused with `rerun_red`.
   Red proof: delete the sample re-run stage from the checker; the same push passes; the test reports that red.
2. Tests did not run (KR3). No record; refused with `record_missing`. Red proof: make the checker treat a missing record as
   "skip"; the push passes.
3. Selector omission (KR4). The record lists only the suites the author ran, one fewer than the selector re-derives; refused
   with `selection_shortfall`. A second variant forges the record's own `selected` list to match: still refused, which proves
   the checker ignores it. Red proof: read `selected` from the record instead of recomputing.
4. Stale record (KR5). Record for commit X, then `git commit --amend` to Y; refused. Red proof: skip the head comparison.
5. Default-off (KR1). No `outcome` key and a protected-path push with no record passes, and the checker is not invoked
   (asserted by a sentinel that the fixture's checker path is never executed).
6. Escape hatch (KR6). `AUTOPILOT_QC_OUTCOME=off` lets control 2's push through and prints the hatch line. Red proof: remove
   the env read; control 2's push is refused even with the hatch set.
7. Full mode is loud (KR7). A fixture change to `hooks/hooks.json` yields `mode: full`; output contains `NOT JUDGED` and the
   exit is not a block. Red proof: have the checker map full to pass-with-no-output; the line disappears.
8. Fail-open is loud (KR8). Point `--root` at a path where the selector throws; push is allowed and the `could not check`
   line is present.
9. Input coverage (§58, last sentence). One assertion that the checker saw the real population: in the fixture the verdict
   JSON reports `selected: 2` (a literal), not 0.

Human-gated, not a merge gate: one real push of this repo to a scratch remote with `outcome: warn`, then `block`, to see
the output a person sees; recorded in the closing note.

## 6. Delivery slices

Estimates are lines added. No version bump while the version hold stands (the project holds at 3.0.0 until the owner
confirms; per `CLAUDE.md` Versioning a new script is a PATCH otherwise).

| Slice | Files | ~Lines | Tests | Acceptance |
|-------|-------|--------|-------|------------|
| S1 record writer | `scripts/affected-suites.js` add `--record <path>` (writes after `--run`; refuses without `--run`) | 45 | `scripts/affected-suites.test.js` +3 cases (record shape, rc captured, no record without `--run`) | `node --test scripts/affected-suites.test.js` |
| S2 checker | new `scripts/check-test-outcome.js` (options, record load, selection recompute via `require('./affected-suites.js')`, worktree, sample re-run, JSON verdict) | 260 | `scripts/check-test-outcome.test.js` unit cases for each failure code | `node --test scripts/check-test-outcome.test.js` |
| S3 wiring | `scripts/resolve-qc-gate.sh` (`outcome`, `outcome_rerun`, `outcome_sample`, `outcome_budget_s`, env override); `.githooks/pre-push` (stage after `:131`, before the violations print); `project-config-template/qc-gate-config.md` (documented keys, default off) | 70 | `hooks/tests/qc-outcome-gate.test.sh` (controls 1-9) + `hooks/tests/qc-gate.test.sh` unchanged | `bash hooks/tests/qc-outcome-gate.test.sh && bash hooks/tests/qc-gate.test.sh` |
| S4 wiring docs | `docs/scripts-inventory.md` row; `CLAUDE.md` grouped name list ("Diff scanning" or "Verification"); `skills/quality-pipeline/references/test-policy.md` (producer command, after `:91`); `references/four-layer-design.md:40` S1 row status; `docs/BACKLOG.md` BL-0050 status | 40 | `node scripts/check-claude-md-inventory.js` | `node scripts/check-claude-md-inventory.js && node scripts/check-reference-sizes.js && node scripts/check-config-docs.js` |

Verification commands list fast fixed checks only. Note `.githooks/` is in `FULL_TRIGGERS`
(`scripts/affected-suites.js:55-63`), so the selector will answer `full` for S3; the fixed list above is used instead of the
selector. The whole suite runs once before the merge, as the campaign convention says.

Producer wiring in S4: `quality-pipeline`'s test step gains one flag on the existing selector run (`--run --record`); the
requirement list of the skill is unchanged (the step already runs the selected suites), so this is a mechanism change, not
a guidance change. The step text is edited in a separate commit from any wording change.

## 7. Spikes (unknown today, probe before building)

- S1. Does `git` export `GIT_DIR` or related variables to a pre-push child, and do the suites break under them? Probe: run one
  suite from a throwaway pre-push hook and diff `env`. Decides the env scrub list.
- S2. Real per-suite time distribution and the cost of a 25-suite sample. Probe: time `affected-suites.js --run` over a
  chosen selection and read the per-entry cost. Decides default `outcome_sample` and `outcome_budget_s`.
- S3. Flake rate of the direct suites on a clean tree. Probe: run the 20 most recent selective selections twice. Decides
  whether `rerun_red` retries once.
- S4. Can a detached worktree at a SHA that is only in the push (not yet fetched by other clones) always be created? It is in
  the local object database by definition for a local push; confirm for a push of a ref that is not checked out and for a
  linked worktree (`--git-common-dir`).
- S5. Is the selector's `unreferenced` full trigger (13 of 25 recent commits) a defect worth fixing first? Many of the
  `full` answers name executable scripts such as `scripts/dispatch-hetero.sh`. If the selector were tighter, (b) would judge
  far more pushes. Out of scope here; the answer changes the value of this plan, so it is probed before S2 starts.

## 8. Out of scope / not doing

- Any default-on enforcement. Opt-in only (`docs/backlog/...` Context).
- Checking that `quality-pipeline` or any skill was invoked (process governance, ADR-0001).
- Signing, hashing, chaining or witnessing the record; a waiver log; a run ledger; a "trusted runner" identity.
- Editing the requirement text of the existing qc-gate, the trailer grammar, or `.qc/<sha>.verdict.json` semantics.
- Running or modifying `hooks/tests/run.sh`; making full mode run the whole suite in the push path.
- Improving the selector's accuracy (S5 only measures it).
- The `qc-evidence-status.js` chip showing the outcome stage (follow-up if the owner wants it).
- Remote or CI enforcement, other hosts, other repositories.

## 9. Risks + inversion

What guarantees failure:
- The gate is slow, so people turn it off: the default is `sample`, with a budget cap, and `rerun: all` is explicit.
- The gate blocks pushes the selector cannot judge: full mode is reported, not blocked, in v1.
- The gate passes while guarding nothing (a gate that has never been seen to fail): controls 1-4 and 7 are red before green
  and mutate the checker's key lines.
- The record is trusted more than it deserves: the output labels the unsampled remainder "claimed, not re-derived".
- Sample hides a single red: acknowledged in 3.1 (93% miss for F=1); direct suites are always re-run, which covers the suites
  most likely to be red.

## 10. Open questions for the owner

- Q1. Full mode: accept `unjudged_full` as non-blocking in v1, or require a recorded whole-suite run before a protected push
  is allowed? Half of recent commits are full, so this decides how much of the gate is real.
- Q2. Default sample: 20 plus direct suites, 600 s budget. Change after spike S2?
- Q3. Should this repo turn `outcome: warn` on for itself once built (needs a new `.claude/qc-gate-config.md`, which does not
  exist today)?

## Review log

- R0: authored 2026-10-19 by a plan-author subagent from the sources cited inline; not yet reviewed. Next: depth-0 review, then a
  decorrelated plan review per the project's plan-review loop before any build.
