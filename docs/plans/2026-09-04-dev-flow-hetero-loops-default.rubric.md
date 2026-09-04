# Frozen rubric — dev-flow hetero loops as default

> Checkable form of `docs/plans/2026-09-04-dev-flow-hetero-loops-default.md` KRs, §2.5 constraints
> and §6 risks. Reviewers judge the plan packet as self-contained.

R1: The four-stage default (plan loop → dispatch → per-phase hetero review → qc gate) is
reachable on a fresh L-size dev-flow run with zero project config edits, because `plan_review`,
`hetero_review` and `consult_dispatch` each gain an `auto` value derived from
`~/.autopilot/topology.json` facts, and `auto` is the template default.

R2: Every owner phrase named in KR2 appears verbatim in exactly one skill `description:`
(`hetero-review`), no other skill description contains "hetero review", and the skill only routes
(plan path → plan loop, branch/diff → code loop); it introduces no second reviewer protocol.

R3: The L-4 phase advance gate's code-review item has a named deterministic enforcer
(`check-phase-review-receipt.js`) that reads a receipt written from reviewer JSON plus
`git rev-parse`, compares the receipt's diff sha with the branch head, and exits non-zero for a
missing, stale, or non-SHIP receipt.

R4: Size rules are stated as testable predicates: L/H run all four stages; S skips the plan loop
and runs one hetero seat plus qc; Fix runs qc only; `off` is honoured for both knobs and every
opt-out is written to the ledger.

R5: `auto` fails closed toward "native fallback plus warning" — an empty or absent topology, a
zero-seat role, or a garbage value never yields an `on` with an empty tuple and never silently
skips the stage; explicit `on` keeps the existing requires-full-tuple rule and exit 3 message shape.

R6: The plan loop reuses `dispatch-plan-review.js` unchanged (rubric freeze, manifest seats,
two-generation cap, growth rails); the rubric skeleton comes from `plan-rubric-scaffold.js` with
stable ids and never overwrites an existing rubric; depth-0 adjudicates each finding before freeze
and the freeze criterion is zero construct-level findings, not zero findings.

R7: The code loop driver runs seats in parallel through the existing `dispatch-review.sh`,
synthesises `union-on-verified-critical` (one verified critical from any seat ⇒ FIX-THEN-SHIP),
emits a hands brief that passes `check-redispatch-prompt.sh`, supports `--delta <sha>`, and is
tested against a `PATH`-shimmed `dispatch-review.sh` so CI spends no model calls.

R8: Consult is decoupled from the codex plugin: `dispatch-consult.sh` resolves a seat under
`consult_dispatch: auto` on a host without the plugin, the consult ladder prefers a family
different from the asking model, `references/hetero-dispatch.md` reserves "peer" for sessions,
and named hook points exist (debug after two failed hypotheses, think-tank 3.5, dev-flow L design
decision, qc seat exclusion).

R9: Prose ratchet and canonical-home rules hold: `skills/dev-flow/SKILL.md` ≤ 733 lines and
`skills/ceo-agent/SKILL.md` ≤ 550 lines after D3, profiles hash chain repinned, no third
statement of "what the reviewer reads", no new severity vocabulary, no trust machinery.

R10: Evidence discipline is extended, not bypassed: `references/evidence-discipline.md` records
that a hetero implementer's green is a claim not a gate and that a systemd/CLI leaf cannot be
messaged; every new script is wired in all four places (reference doc, SKILL table, scripts
inventory, CLAUDE.md group list) and has a negative-control test; semver is MINOR (2.36.0) for
the one new skill.
