# The consult and discuss qualification seats

Both `consult_*` and `discuss_*` are roster seats in `review-loop-config.md` for **advisory**
heterogeneous engine participation — a mid-run second opinion and a debate-round contribution,
respectively. Neither is a verdict surface. This doc covers what each rail does, its trust
boundary, its switch, its exam construct, and its named residuals. Plan:
`docs/plans/2026-08-28-consult-discuss-qualification.md` (D1-D2 exams, D3 qualifier wiring, D4
seals, D5 evidence schema, D6 the switch, D7 the switch-on gate, D8/D9 the executable consumers,
D10 this doc + closeout).

## What each seat does

- **consult** (`scripts/dispatch-consult.sh`) — a mid-run ad-hoc heterogeneous second opinion.
  Takes a question file and one or more artifacts, dispatches over `dispatch-author.sh`'s
  raw-prompt rail (never `dispatch-review.sh` — that rail only succeeds after parsing a
  `SHIP-AS-IS`/`FIX-THEN-SHIP` verdict, which a consult answer must never carry), and validates
  the closed consult response schema. See `references/hetero-dispatch.md` § The consult seat for
  the full invocation contract.
- **discuss** (`scripts/dispatch-discuss.js`) — a single stateless round-bundle contribution to a
  `think-tank` debate: one call per round-set, producing a
  `{round_id, axis_id, claim_vector, position, risk_tags, anchors}` response. Called
  unconditionally from `skills/think-tank/SKILL.md` Step 3.5 — the wrapper itself is the decision
  point, resolving `discuss_dispatch` and refusing (non-zero exit, no transport spawned) when the
  seat is off or unqualified. `brainstorm` is not wired; it is a backlog candidate (§7 non-goal).

Both scripts own their own switch resolution — no caller-side guard reimplements the gate.

## Trust boundary

A consult or discuss output is **ADVICE**. Neither may emit, imply, or be routed into a
ship/no-ship verdict; neither substitutes for qc@depth-0 or the decorrelated review rails.
Both rails are blind-evidence-bound: the seat is fed artifacts plus the original question,
**never** an implementer's self-report, summary, or self-verdict
(`references/blind-dispatch.md` § Verifier isolation). `dispatch-consult.sh` runs
`scripts/check-blind-evidence.sh` as a structural preflight before any transport spawn.

## The switch

`consult_dispatch` / `discuss_dispatch` (`project-config-template/review-loop-config.md`) default
`off`. `off` means pre-change behavior byte-for-byte on every pre-existing resolver key: no new
dispatch, no new refusal. `on` requires a non-empty `consult_*`/`discuss_*` tuple **and** a real
role qualification for the configured `{engine, runner}` — D7's switch-on qualification gate in
`scripts/resolve-review-loop.sh`. The two roles are **not coupled**: `discuss_dispatch: on` never
requires the consult seat to be qualified, or vice versa (evidence binds to `{engine, runner,
role}`, and a hidden inter-role dependency would make one seat's admission turn on evidence about
a different job).

Qualification-row expiry is advisory only — an expired-but-not-demoted row still admits, with a
stderr warning. Demotion runs through strike accrual to `requalify_required` standing.
Override-file expiry is a separate, still-enforced contract.

## The exam construct

Two frozen exam suites, each generator/grader/corpus/rubric sealed with `rubric-freeze.js` and
pinned (`EXPECTED_{CONSULT,DISCUSS}_{GENERATOR,GRADER,CORPUS,RUBRIC,SEAL}_HASH` in
`engine-qualify.js`):

- `evals/consult-eval-generator.js` / `-grader.js` / `-capability-evidence-corpus.json` /
  `-rubric.md` (+ two `.seal.json` files: rubric and corpus)
- `evals/discuss-eval-generator.js` / `-grader.js` / `-capability-evidence-corpus.json` /
  `-rubric.md` (+ two `.seal.json` files)

Twelve pinned assets total, all mirrored into the codex plugin package's `SUPPORT_FILES`
allowlist (`scripts/sync-codex-plugin-skills.sh`) — an unmirrored seal is a
`rubric-freeze.js check` that cannot run inside the codex package.

`scripts/lib/qualification-asset-seals.js` verifies both the rubric bytes and its seal (and the
corpus/seal pair) on **every** qualifier invocation — `--plan` and real administration alike —
and refuses to run on drift in either. `scripts/lib/qualification-applicability-scope.js` derives
the one canonical `{task_classes, domains, languages, tool_surface}` applicability-scope tuple for
each role from the corpus manifest, which D7's switch-on gate hands to
`engine-scorecard.js seat-status --require-evidence`; it never accepts a caller-supplied scope.

The exams are synthetic: generated artifact bundles, not real repo history. A pass says the engine
handles the construct, not this repo (named residual, plan §6 R5).

No real-money exam administration happens as part of shipping this plan. `--plan`
(`scripts/engine-qualify.js consult --plan` / `… discuss --plan`) is the no-spend proof surface —
it verifies pinned assets and prints the identities and case counts without spending anything.
Administration against a paid engine is a separate Board-authorized step; see
`docs/plans/evidence/2026-08-28-consult-discuss-qualify/PROPOSAL.md` for the candidate-seat
recommendation and cost estimate.

## Named residuals

- **R5 — synthetic exams.** See above.
- **R9 — `UNQUALIFIED_RUNNERS` reconciliation tension (deferred).** A consult/discuss exam pass by
  a listed runner (today `cursor`) does not automatically remove it from
  `resolve-review-loop.sh`'s declarative `UNQUALIFIED_RUNNERS` list — nothing in this plan changes
  that list's membership or its reconciliation test. Once a listed runner holds a real
  qualification for one of these roles, "unverified" and "qualified for this role" are
  simultaneously true, and the reconciliation test's premise gets murky. Tracked as a
  `docs/BACKLOG.md` row; not resolved here (plan §6 R9, §8 ruling 7).

## Out of scope (see plan §7 for the full list)

No new skill or agent; only `think-tank` gets the discuss hook. `ROLE_IDS` (the execution-role
set) is untouched — `consult`/`discuss` are qualification-seat roles in the separate
`CAPABILITY_ROLE_IDS` set and are structurally rejected by effect-permission and role-grant
construction. No auto-routing: neither switch defaults on for any project as part of this plan.
