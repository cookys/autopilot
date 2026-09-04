# dev-flow hetero loops as default — plan loop → dispatch → per-phase hetero review → qc gate

Status: **R1 after plan-review generation 1 (owner go 2026-09-04)**. Ships as MINOR **v2.36.0**
(new skill `hetero-review`). Investigation narrative and scorecard facts:
`docs/plans/evidence/2026-09-04-dev-flow-hetero-loops-default/context.md` (provenance, not a
reading assignment — this packet is self-contained).

## 0. Thesis

The owner's phrases ("plan loop review hetero", "過 hetero loop review", "hetero review", "engage
hetero engine review") route to no skill; plan review has one caller (research-to-ship); the qc panel
hides in finish-flow; dev-flow L-4's code-review item is free text. The loops the owner already runs
by hand become the **default shape of dev-flow L-size** (opt-out), and the phrases become the
trigger of one thin routing skill.

```
L-2 plan → L-2.5 plan hetero loop review → L-4 dispatch (v2.35.16 topology)
        → per-phase hetero review loop → L-5 qc gate (three-seat panel, QC-Verdict trailer)
```

Existing, reused unchanged: `dispatch-plan-review.js` (rubric freeze, manifest seats, two-generation
cap, growth rails); `plan_review` / `plan_reviewer_*` / `plan_review_max_*` knobs in
`resolve-review-loop.sh`; `dispatch-review.sh` (one seat, `SHIP-AS-IS` / `FIX-THEN-SHIP`); `qc_panel`
+ `qc_panel_aggregation: union-on-verified-critical`; the pre-push qc-gate trailer;
`resolve-dispatch-topology.js`; `dispatch-consult.sh` (raw-prompt rail, blind-evidence preflight).

## 1. Problem

1. **No trigger.** The phrases route nowhere; sessions improvise three `dispatch-review.sh` calls
   plus a manual union, unreproducibly.
2. **Plan review is opt-in twice.** `plan_review: off` by default, and dev-flow L-2 never calls it.
3. **Per-phase code review is prose.** L-4's advance gate item has enforcer `documented-only`.
4. **Consult is chained to the codex plugin** in the docs; the seat rail has no skill hook point and
   its switch is off.

## 2. KRs

- KR1: on a host whose topology yields ≥2 qualified plan-review seats of distinct families, a fresh
  L-size dev-flow run reaches L-3 only after `dispatch-plan-review.js` returned READY or a
  depth-0-adjudicated CONDITIONAL, with zero project config edits (`plan_review: auto`).
- KR2: each owner phrase above appears verbatim in exactly one skill `description:`
  (`hetero-review`) and in no other; enforcer: `hooks/tests/hetero-review-trigger.test.sh`, which
  parses every `skills/*/SKILL.md` frontmatter `description:` (not the whole file) and asserts each
  of the four phrases occurs exactly once overall, in `hetero-review`.
- KR3: the L-4 advance gate's code-review item is satisfied only by a gate receipt (§3 receipt
  contract) that `check-phase-review-receipt.js` validates: `kind: review` with aggregate verdict
  `SHIP-AS-IS` and `review_head_sha` equal to the branch head, or `kind: opt-out` with an explicit
  `off` knob. Missing, stale, non-SHIP, or `auto`-degraded-without-receipt ⇒ exit 1.
- KR4: size rules as predicates: L/H run all four stages; S skips the plan loop and runs one hetero
  seat plus qc; Fix runs qc only. Every explicit `off` writes an opt-out receipt (writer:
  `hetero-review-loop.js --opt-out --knob <k>`), and a fixture asserts S, Fix, L, H each produce the
  expected receipt sequence.
- KR5: `consult_dispatch: auto` resolves a consult seat from the host topology, excluding every seat
  in the resolved `qc_panel` and preferring a family different from the asking model; a hermetic test
  (scratch `HOME` with no `~/.claude/plugins`, runner binaries `PATH`-shimmed) proves
  `dispatch-consult.sh --dry-run` resolves a seat with no codex plugin present.
- KR6: prose ratchet: `skills/dev-flow/SKILL.md` ≤ 733 lines and `skills/ceo-agent/SKILL.md` ≤ 550
  lines after D3; judgment prose lands in `references/`.

## 2.5 Global constraints (verbatim into every dispatch)

- ADR-0001: a review verdict is a claim until depth-0 re-derives it from the reviewer's JSON artifact
  and the exact `base..head` range it reviewed; a hetero implementer's green is a claim, never a gate.
- **Knob transition table** (one table, three knobs `plan_review`, `hetero_review`,
  `consult_dispatch`; enforcer: `resolve-review-loop.sh`, tests in D1):

  | value | topology | result |
  |---|---|---|
  | `off` | any | stage skipped; opt-out receipt written; `capability_warnings` line |
  | `on` | any | explicit tuple required (`plan_reviewer_*` / `reviewer_*` / `consult_*`); incomplete or invalid ⇒ exit 3, existing message shape |
  | `auto` | ≥1 qualified seat for the role | tuple(s) expanded from topology; ledger records `resolved_from: topology` |
  | `auto` | absent file, malformed JSON, or zero seats for the role | **native fallback** (claude-native reviewer/consult seat, `resolved_from: native-fallback`) plus `capability_warnings` line; the stage still runs; never `on` with an empty tuple, never silently skipped |

- No new severity vocabulary; receipt verdict tokens are the existing `SHIP-AS-IS` /
  `FIX-THEN-SHIP` only. No trust machinery. No third canonical statement of "what the reviewer
  reads" (code-review.md Invocation § stays canonical).
- `check-redispatch-prompt.sh` hygiene applies to every implementer brief.

## 3. File-structure map and contracts

| File | Change |
|---|---|
| `scripts/resolve-dispatch-topology.js` | `--role implementer\|plan_reviewer\|reviewer\|consult\|discuss` (default all); `--exclude-seats <engine/effort@runner,…>`; `--asking-family <f>`. JSON gains `plan_review_panel` (≤3 seats, distinct families, chair = highest effort rank), `reviewer_ladder`, `consult_ladder` (order: family ≠ asking family, then latency, then cost rank), `discuss_ladder`. Facts from `engine-scorecard.js seat-status` per role, never `ladder`/`report`. Role mapping (scorecard has no `plan_reviewer` role): plan seats derive from `reviewer` rows (chair must be reviewer-qualified) plus `consult` rows for non-chair seats. Runner token aliases normalised (`codex-cli` ≡ `codex`). Seats whose `runner` is not in `dispatch-plan-review.js`'s unchanged `RUNNERS` are never placed in `plan_review_panel` |
| `scripts/resolve-review-loop.sh` + schema + `project-config-template/review-loop-config.md` | the §2.5 transition table for the three knobs; template defaults `auto`; `--field` emits expanded tuples and `resolved_from`; when `consult_dispatch: auto` the resolver passes the resolved `qc_panel` seats as `--exclude-seats` |
| `scripts/plan-rubric-scaffold.js` (new) | input plan file → rubric skeleton: one `R<n>:` per KR, then one per §2.5 bullet, then one per §6 bullet, ids ordinal by source position; the author trims before freeze. Contract: same input ⇒ byte-identical output; existing rubric ⇒ exit 2, file untouched. Golden test on a fixture plan (not on this plan) |
| `scripts/hetero-review-loop.js` (new) | code-loop driver. Before dispatch: snapshot `review_base_sha`, `review_head_sha`; refuse if the branch head moves before the receipt is written. Runs `dispatch-review.sh` per seat in parallel over exactly that range; stores each seat's raw JSON under `<ledger>/review-<phase>-g<n>/seat-<id>.json`. Findings pass through a depth-0 disposition file (`dispositions.json`: per finding `verified` / `refuted` + rationale / `deferred`); aggregate = `union-on-verified-critical` over dispositioned findings only (any `verified` Critical/Major ⇒ `FIX-THEN-SHIP`; an undispositioned blocking finding ⇒ no receipt, exit 1). Writes the gate receipt `<ledger>/receipt-<phase>.json` (`kind`, `phase`, `branch`, `generation`, `review_base_sha`, `review_head_sha`, seat artifact paths, dispositions path, `verdict`, `resolved_from`). `--delta` binds to an immutable `<prev_head>..<head>` range. `--opt-out --knob <k>` writes `kind: opt-out`. Independent of `adjudicate-findings.js` |
| `scripts/check-phase-review-receipt.js` (new) | KR3 enforcer over the receipt contract above |
| `skills/hetero-review/SKILL.md` (new, ≤120 lines) + `references/{plan-loop,code-loop}.md` | router only: plan path → plan loop (`plan-rubric-scaffold.js` → manifest from `plan_review_panel` → `dispatch-plan-review.js --timeout 20m` → depth-0 disposition → freeze); branch/diff → code loop (`hetero-review-loop.js` → hands repair via topology → `--delta` → `SHIP-AS-IS` → trailer). `description:` carries the four phrases verbatim |
| `skills/dev-flow/SKILL.md` (line-neutral) + `skills/dev-flow/references/hetero-loops.md` (new) | L-2.5 row (→ `hetero-review` plan loop; gate = frozen rubric + READY/adjudicated CONDITIONAL, or opt-out receipt); L-4 advance-gate code-review item → `check-phase-review-receipt.js`; size table gains KR4 predicates; Available Scripts rows for the three scripts; prose to the reference |
| `skills/ceo-agent/SKILL.md` (line-neutral) + `references/level-front-door.md` | pointer to the four-stage default; front-door § Default dispatch topology gains one "review seats" row |
| `skills/research-to-ship/SKILL.md` | Phase 3 → "invoke `hetero-review` (plan loop)"; the skill is survey + dev-flow with gates |
| `skills/debug/SKILL.md`, `skills/think-tank/SKILL.md`, `skills/dev-flow/references/hetero-loops.md`, `skills/quality-pipeline/SKILL.md` | executable consult hook points: one Available-Scripts row + one decision-table row each — debug after two failed hypotheses, think-tank 3.5, dev-flow L design decision; quality-pipeline states the qc-roster exclusion |
| `references/hetero-dispatch.md` | § "Peer consult — the codex plugin channel" → "Codex-plugin consult (optional)"; "peer" reserved for sessions; consult seat § lists the hook points |
| `skills/agent-call/SKILL.md` (`description:` only) | owner verbs (通知／跟 X 說／叫 <host>), hangar-bridge trigger; Not-for → `hetero-review` / consult seat / `/l4`–`/l6`; Claude sessions are addressed by `fleet peers` instance id |
| `references/evidence-discipline.md` | two rows: hetero implementer green is a claim not a gate; a systemd/CLI leaf cannot be messaged — re-dispatch |
| profiles hash chain (+ codex mirror) | repin after dev-flow / ceo-agent edits (skill `profiles-hash-repin`) |
| wiring per new script (all four): `skills/dev-flow/references/hetero-loops.md` section, dev-flow SKILL Available Scripts row, `docs/scripts-inventory.md` row, `CLAUDE.md` group list | plus README skill count, codex/opencode mirrors, `sync-version.js --version 2.36.0 --skill-count 30` |
| tests | `hooks/tests/{resolve-dispatch-topology,resolve-review-loop,plan-rubric-scaffold,hetero-review-loop,check-phase-review-receipt,hetero-review-trigger,dispatch-consult-hermetic,check-hook-inventory}.test.sh`; slash-entry probe row |

Not changed: `scripts/dispatch-plan-review.js` (byte-identical; kimi as a plan-review runner is a
BACKLOG row, not this slice).

## 4. Deliverables (one foreman each, one cut at a time)

| # | Deliverable | Size | Acceptance |
|---|---|---|---|
| D1 | Topology roles + `--exclude-seats` / `--asking-family` + the §2.5 transition table in the resolver | M | `--role plan_reviewer` yields ≥2 seats of distinct families on this host; `--field plan_review` prints the expanded tuple with `resolved_from`; fixtures: absent file, malformed JSON, zero-seat role ⇒ native fallback + warning + stage-runs; `on` with incomplete tuple ⇒ exit 3; `off` ⇒ opt-out marker in output; `plan_reviewer_runner: bogus` ⇒ exit 3; `check-contract-schema.js` green |
| D2 | `plan-rubric-scaffold.js`, `hetero-review-loop.js`, `check-phase-review-receipt.js` | L | scaffold: golden fixture; re-run byte-identical; pre-existing rubric with sentinel bytes ⇒ exit 2 and file byte-identical. Loop: `PATH`-shimmed `dispatch-review.sh` fixtures — three SHIP ⇒ `SHIP-AS-IS`; one seat with a `verified` Critical ⇒ `FIX-THEN-SHIP`; a raw (undispositioned) Critical ⇒ exit 1, no receipt; a `refuted` Critical ⇒ `SHIP-AS-IS`; head moved between snapshot and receipt ⇒ exit 1; opt-out receipt shape. Checker: SHIP + matching head ⇒ 0; stale head ⇒ 1; `FIX-THEN-SHIP` ⇒ 1; missing ⇒ 1; opt-out with explicit `off` ⇒ 0; opt-out with `auto` ⇒ 1 |
| D3 | `hetero-review` skill + dev-flow / ceo-agent / research-to-ship / front-door edits + profiles repin | M | `hetero-review-trigger.test.sh` green; slash-entry probe green; `build-profile-payload.js catalog --check` rc 0; `wc -l` dev-flow ≤ 733, ceo-agent ≤ 550; a size-rule fixture asserts S/Fix/L/H receipt sequences |
| D4 | Consult decoupling: hook points in debug / think-tank / dev-flow reference / quality-pipeline, hetero-dispatch.md rename, agent-call description, evidence-discipline rows, hermetic consult test | M | `dispatch-consult-hermetic.test.sh` green (scratch `HOME`, no plugins dir, shimmed runners, qc seats excluded, family order asserted); hetero-dispatch.md has no "peer consult" heading; `check-canonical-invariants.sh` green |
| D5 | Release v2.36.0: CHANGELOG (`prose-justification:` line), README/INDEX/mirrors, archive | S | `preflight-release.sh` green; full suite; qc three-seat SHIP; trailer on merge |

D0 (this plan) ran generation 1 with sol@codex max (chair), GLM-5.2@cc-shim, MiniMax-M3@cc-shim,
`--timeout 20m`; generation 2 re-reviews this R1; freeze before D1.

Execution posture (v2.35.16 topology, dogfooded): branch `feat/dev-flow-hetero-loops`; governance
shadow on the branch (precedent 5ca93e08), restored before merge; `worktree.baseRef: head`; session
marker l4; one sonnet foreman per deliverable, Bash cap 40; hands `gemini-3.8-flash-low@agy` rung 0,
climb on red; every brief line 1 `Engine: …`; verification by git artifacts; per-deliverable hetero
review loop before merge into the feature branch (three `dispatch-review.sh` seats with depth-0
dispositions until D2's driver exists, then the driver).

## 5. Test / validation

Script-gated: every new script has a `hooks/tests/*.test.sh` with fixtures under scratch dirs
(`ENGINE_*_DIR` redirection, never the real scorecard store); D1 covers the full transition table;
D2's driver runs against a `PATH`-shimmed `dispatch-review.sh` so CI spends no model calls. Human-
gated: the real D0 plan loop and one real per-deliverable code loop recorded in the project ledger.

Negative controls: delete the receipt ⇒ checker exit 1; malformed topology ⇒ native fallback with
warning, never `on` with an empty tuple; `plan_reviewer_runner: bogus` ⇒ exit 3; scaffold over an
existing rubric ⇒ exit 2 and byte-identical file; one `verified` Critical among two SHIP seats ⇒
`FIX-THEN-SHIP`; undispositioned Critical ⇒ no receipt; consult selection with the qc roster hidden
from the exclusion input ⇒ test red.

## 6. Risks + inversion

- **Loop fatigue switches the default off.** Guaranteed if S-size pays for three seats — KR4's one-
  seat S posture; opt-outs are receipts, not silence.
- **Chair over-production.** sol@max emits many findings per generation; freeze criterion is zero
  construct-level findings after depth-0 disposition, not zero findings.
- **Growth rail.** Repairs move narrative to the evidence dir, never raise the ratio.
- **Receipt theater.** Receipts are written by the driver from reviewer JSON + snapshot shas; the
  checker binds head; an implementer cannot produce one.
- **Hetero seats down.** `auto` degrades to the native seat with a warning; the ledger shows which
  family judged.
- **Prose ratchet.** D3 is line-neutral: every added row removes a prose line into the reference.

## 7. Out of scope

New qualification exams; a top-level `/ask` skill; mandatory codex plugin; claude-native in the
hetero implementer ladder; kimi as a plan-review runner; P5 fleet rollout of v2.35.16; changing
`qc_panel_aggregation` semantics.

## 8. Owner rulings (2026-09-04, this host — not open)

1. Default is opt-out: L/H dev-flow runs all four stages unless a knob is explicitly `off`.
2. Trigger words are the owner's own phrases; one thin `hetero-review` skill routes plan vs code.
3. Consult is a seat, not a plugin; codex plugin stays optional.
4. Plan review is depth-0-adjudicated: chair proposes, brain freezes.

## Review log

- R0 2026-09-04 (aimax395). G1: sol STOP / GLM CONDITIONAL / MiniMax CONDITIONAL, 20 findings, 11
  blockers all accepted (artifact in the evidence dir). Folded: gate decision table with opt-out
  receipts; one knob transition table (native fallback, never `off`-by-accident); kimi RUNNERS edit
  cut (R6); scaffold contract fixed to ordinal ids + golden fixture; receipt binds `base..head` and
  dispositions; verified = depth-0 disposition; consult hook points made executable + qc exclusion
  + hermetic test; KR2 enforcer is a frontmatter-parsing test; scaffold negative control; SHIP token
  = `SHIP-AS-IS`; opt-out writer named; malformed-topology fixture; wiring enumerated per script.
- R1: generation 2 pending.
