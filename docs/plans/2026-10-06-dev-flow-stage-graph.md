# Plan — dev-flow stage graph: one named graph, T-shirt sizes, a marker the band can read

> Status: draft (R0) · Owner: cookys · Branch: develop (per-phase branches at execution) · Frame: guidance + mechanism, authorized-breaking (3.0.0)
> Proposal page (owner's choices recorded there): https://claude.ai/artifact/WhaLzUsfwmMdDut9ndVB7X (v2)
> Blocks: mods P1W TUI band (`2026-10-03-mods-visible-dispatch.md` R5.10 → B) and therefore the next release.

## 0. Context / thesis

The W4 real-machine gate passed in every mode, then the owner chose to make the band a TUI before releasing (R5.10 **B**, `docs/plans/evidence/2026-10-06-tui-band/README.md`). The band's position and progress slots had no data source. The live band printed `● 進行中 autopilot · — · 5m · —` / `回合進行中（0 分）`: half the slots were dashes, and the elapsed time contradicted itself. The owner's ruling was that a placeholder UI with no data is pointless. The stage inventory (`docs/plans/evidence/2026-10-06-dev-flow-stage-inventory/README.md`) found the cause:
- dev-flow's stages exist only in prose;
- "L" means three different things;
- "phase" means six;
- no skill or hook writes the current stage anywhere a program can read it.

This plan replaces the stage prose with one named graph. A script owns the graph, and the rails write the graph position into the session marker. The TUI band is then rebuilt on that data.

### Settled — do not reopen (owner rulings, 2026-10-06)

1. **The graph** (owner's sketch, refined in discussion):
   - Main path: `intent → [research when needed] → proposal → plan → plan-review⟲ → per phase (implement → verify) → code-review⟲ → qc-gate → finish`.
   - Bugs enter at `diagnose`.
2. **Research branch.**
   - When the unknown ladder says U0, the model proposes from its own knowledge and no survey runs.
   - Otherwise it climbs the ladder, and the proposal comes after the research.
3. **Proposal.** The `proposal` node is a web page: assumptions plus illustrated options for the user to pick. The page this plan cites is the first one.
4. **Verify per phase.** Each phase is verified by a qualified verifier (engine scorecard verifier role). The hetero code review runs once after all phases, on the full diff. The same rule applies to bug and urgent work.
5. **Sizes are T-shirt sizes `XS S M L XL`.** A size decides only which nodes run.
   - A bug is not a size.
   - Urgency is a flag written AFTER the letter: `S!`, with alias `S急`. A prefix `!` would be eaten by Claude Code's bash mode.
6. **Levels `/l3–/l6` are hetero/delegation mode, never size.** The owner corrected this explicitly. Levels decide who executes `implement` and who authors verification. They are orthogonal to size.
7. **Review strength is a third axis.**
   - "hetero" is a property of the review seat (how many model families), resolved by `scripts/resolve-review-loop.sh` from risk and roster.
   - No node is named hetero.
   - A Claude-only user on `/l3` or `/l4` runs the same graph.
8. **No compatibility shims.** The owner rejected leftovers that can never be removed, because they end up unmaintainable. Old names are migrated, not aliased; the legacy marker `phase` field is removed, and its readers move to the new fields in the same phase. Rollback means pinning the previous tag.
9. **Pre-releases for testing.** The owner, currently the heaviest user, tests `3.0.0-alpha.N` cuts before 3.0.0.
   - 2.37.0 is never cut; mods P1W folds into 3.0.0.
   - The ladder renumbers cleanly (§8 Q1 resolved).
10. **Proposal-page answers:** `A2 B1 C2 D2 E1 F2 G1`. §2.6 and §4 carry them out.
   - A2: hard rename → 3.0.0.
   - B1: JSON + CLI.
   - C2: `stage-advance.js`.
   - D2: structured marker fields.
   - E1: the model sizes the task at entry, and a diff threshold bumps the size.
   - F2: new ladder rungs land in this plan.
   - G1: one family for low-risk review by default.

## 1. Problem

The owner wants to glance at a session, in the terminal band or on the review page, and know four things:
- which step the work is in;
- how far along it is;
- whether it needs them;
- how strongly it is being checked.

Today none of these is recorded mechanically outside `/l5–/l6` campaigns. Colleagues who only have Claude cannot tell what dev-flow expects of them, because review strength is tangled into the stage names.

## 2. OKR / KRs

- **KR1** — The real-machine gate re-run passes per field (§54) in every mode:
  - modes: dev-flow, `/l3`, ceo, `/l4`, `/l5`, `/l6`;
  - the band shows `size·level ▸ stage [unit k/N] [·n族]`;
  - every slot comes from a marker field, never a dash placeholder;
  - each check is backed by a colored screenshot (§55).
- **KR2** — For every node that has a rail, a deterministic test runs the rail against a temp marker and asserts `stage` and `stage_set_at`. Coverage is 100% of the node→writer table in P3.
- **KR3** — The pre-registered eval (P0) meets its frozen ship rule for the guidance change. The eval compares the base skill text with the changed skill text, and the rule covers size choice, entry node and node order on the answer-keyed task set.
- **KR4** — A grep gate in `check-canonical-invariants.sh` finds zero old ids in shipped non-history files: `L-1…L-5.7`, `H-9…`, `S-scope-gate`, `S.1`, `F.1`, and the old size enum `Fix`/`H`.
- **KR5** — After `migrate-backlog-entries.js`, autopilot's own `docs/BACKLOG.md` passes `check-backlog-entries.js`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Sizes are exactly `XS`, `S`, `M`, `L`, `XL`. Urgency is the suffix `!` (alias `急`) written after the size letter, never before it; scripts and the marker carry it as `urgent: true`.
- Graph node ids are exactly: `intent`, `diagnose`, `research`, `proposal`, `plan`, `plan-review`, `implement`, `verify`, `code-review`, `qc-gate`, `finish`. No node id contains `hetero`.
- `/l3`–`/l6` keep their current meaning (who implements / who authors verification). Size never encodes level and level never encodes size.
- Review strength = the number of distinct model families on a review node, resolved by `scripts/resolve-review-loop.sh`; it is never silently lowered — a shortfall goes through the existing `on_engine_unavailable` policy, and the marker records the families actually used.
- The graph's single canonical definition is `references/stage-graph.json`; prose cites `scripts/stage-graph.js` output and never re-lists the node sequence.
- New scripts are Node ≥ 20.10, built-ins only; stdout JSON, diagnostics on stderr, exit codes documented in the header.
- A mechanism commit (code that makes an existing requirement happen) never edits requirement text; a guidance commit (what a skill asks for) ships only after the P0 eval verdict. They are separate commits.
- No trust machinery (ADR-0001): the marker is telemetry, never authority; a gate re-derives, it never trusts a stage claim.

## 2.6 Change-policy decisions

- **Compatibility impact: `authorized-breaking`.** Owner answer A2, 2026-10-06. The release is **3.0.0**. The unreleased 2.37.0 content (mods P1W) folds into it, and no 2.37.0 is cut.
  - **Affected consumers:**
    - backlog `**Effort**:` rows in every consumer repo (`check-backlog-entries.js:31` enum, `next-pick.js:167` regex);
    - consumer `.claude/dev-flow-config.md` / `finish-flow-config.md`, which may cross-reference the `## L-5 / H-9 …` heading (comment-only, soft break);
    - skill routing, because the `description:` of dev-flow, finish-flow and team changes;
    - the unknown-ladder rung ids, if §8 Q1 renumbers the owner rung.
  - **Migration:** `migrate-backlog-entries.js` gains the old→new effort map: `Fix→S`, `H→S!`, `S→S`, `M→M`, `L→L`. `check-backlog-entries.js` rejects an old value with a message that names the mapping and the migration command. The CHANGELOG 3.0.0 entry carries a migration section.
  - **Rollback:** pin the last 2.x tag. Only backlog rows and the marker change on disk. The marker's legacy `phase` field is removed (§0.8), so a 2.x reader sees no phase after a 3.x session; that is acceptable because the marker is per-session telemetry with a TTL.
  - **Pre-releases:** `3.0.0-alpha.N` cuts (§0.9, phase P-R) let the owner test the breaking change on the release channel. On this host the directory marketplace already loads the live tree (`a2b91aef`), so alpha tags matter for other machines and colleagues.
  - **Contract validation:** `schemas/` entries for the marker and the graph, gated by `check-contract-schema.js`.
- **Dependency decision: `platform/stdlib`.** Node built-ins and existing repo scripts only.

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `references/stage-graph.json` (new) | Canonical graph: nodes, edges (incl. loop-backs), size → node set, bug entry, urgent rule, per-node writer | P1 |
| `schemas/stage-graph.schema.json` (new) | Graph schema, gated by `check-contract-schema.js` | P1 |
| `scripts/stage-graph.js` (new) | CLI: `nodes --size <S> [--bug] [--urgent]`, `next --from <node> --size <S>`, `validate` | P1 |
| `scripts/stage-advance.js` (new) | Validates a transition against the graph, then writes the marker's stage fields through `session-mode.js`; refuses illegal jumps with a reason | P2 |
| `scripts/session-mode.js` | Marker gains `stage`, `stage_set_at`, `size`, `urgent`, `unit {index,total,label}`, `review_families`; `--phase` and the `phase`/`phase_set_at` fields are removed | P2 |
| `scripts/sync-version.js`, `scripts/preflight-release.sh`, version comparators (`hooks/version-drift-check*`, any `\d+\.\d+\.\d+` version regex P-R finds) | Accept `X.Y.Z-alpha.N`; shields badge escaping; prerelease ordering | P-R |
| `schemas/` marker contract, `scripts/check-contract-schema.js` | New marker fields | P2 |
| `src/status/phase-input.js`, `src/status/planned-input.js` | Read the structured fields | P2 |
| `scripts/dispatch-plan-review.js`, `scripts/hetero-review-loop.js`, QC entry (`scripts/qc-panel.js` / qc-gate caller — P3 pins the exact entry), finish-flow's closing script entry | Call `stage-advance.js` on node entry; record `review_families` | P3 |
| `scripts/probe-unknown.js`, `scripts/decision-ledger.js`, `scripts/dispatch-discuss.js` (consumer side) | New rungs: panel, experiment; eligibility rules; receipts | P4 |
| `skills/dev-flow/SKILL.md` (+ `references/`), `skills/finish-flow/SKILL.md`, `skills/ceo-agent/SKILL.md` + `references/{level-front-door,depth0-control-loop,tree-adapter}.md`, `skills/team/SKILL.md`, `skills/{debug,think-tank,l4,l5,l6}/SKILL.md` (ladder call sites), `references/plan-template.md`, `references/hetero-dispatch.md`, other 1-hit references from the footprint | Guidance rewrite to graph vocabulary; boy-scout trim | P4 (ladder text), P5 |
| `project-config-template/{dev-flow-config,finish-flow-config,review-loop-config}.md` | Graph vocabulary; G1 default (low-risk review = 1 family, fresh context) | P5 |
| `profiles/*`, `platforms/codex/plugin/*`, `evals/skill-onoff/packs/*` | Hash re-pin (`profiles-hash-repin` sequence), mirror sync, re-freeze packs | P5 |
| `scripts/check-backlog-entries.js`, `scripts/next-pick.js`, `scripts/migrate-backlog-entries.js`, `docs/BACKLOG.md` | Effort enum = graph sizes + urgent suffix; migration | P6 |
| `scripts/check-canonical-invariants.sh` | Old-id grep gate (KR4); drop the pinned `S-scope-gate` literal | P5 |
| `evals/skill-onoff/{tasks,prereg,lib}/*`, `hooks/tests/skill-onoff-*.test.sh` | New task set + answer key, stage-order checker keyed on the graph instead of `L-1 L-3 L-4 L-5` | P0 |
| `mods/live/{band.tsx,pane.tsx,model.ts}`, `docs/plans/evidence/2026-10-04-mods-p1c/gate/check.js` | TUI band V4a + ⓘ panel on the new fields; per-field gate + colored screenshot | P7 |
| `CHANGELOG.md`, `docs/projects/INDEX.md`, version mirrors | alpha cuts, then the 3.0.0 release | P8 |

## 4. Phases

Phase sizes below use the **pre-plan** dev-flow vocabulary (S/L/H/Fix), because the new vocabulary does not exist until P5 lands.

**Commit streams:**
- **mechanism:** P1, P2, P3, P6-code, P7. These need no eval, and their commits must not edit requirement text.
- **guidance:** P4-text and P5. These ship only after their eval verdict.

### P0 — Pre-register the evals (S)

1. Freeze the base packs from live HEAD with `evals/skill-onoff/freeze-pack.js`:
   - dev-flow (+ references), finish-flow, ceo-agent, team;
   - the ladder call-site skills: debug and think-tank.
2. Write the task set, `evals/skill-onoff/tasks/stage-graph-*`, at least 12 briefs:
   - each size;
   - bug vs feature;
   - urgent with and without high-risk paths;
   - one U0-known and two research-needing.
3. Freeze the answer key: expected size, entry node, node order and, for the ladder, the expected first rung.
4. Write a pre-registration in `evals/skill-onoff/prereg/`:
   - **metric:** agreement with the answer key. Size and entry node are exact; node order is scored on the transcript's `stage-advance` calls.
   - **ship rule:** to be set in this phase, not after seeing data.
   - **planted-red:** a pack whose graph text is deliberately wrong must fail the rule.
5. Re-key the stage-order checker (`lib/p1w-markers.sh`) on `stage-graph.js next` instead of the hard-coded `L-1 L-3 L-4 L-5`.

**Acceptance:** prereg committed before any P4 or P5 text exists, and the planted-red fixture fails under `hooks/tests/skill-onoff-*.test.sh`.

### P1 — Graph data + query CLI (L)

1. Write `references/stage-graph.json` from §0.1–§0.5:
   - nodes and edges;
   - loop-backs `verify→implement`, `code-review→implement`, `qc-gate→implement`, `plan-review→plan`;
   - size → node set as in the proposal page table;
   - bug entry `diagnose`, replacing `intent`/`proposal`;
   - urgent: code-review moves after `finish`'s merge unless `classify-diff-risk.sh` reports high;
   - each node's writer: a rail script, or `prose` for intent, plan, implement.
2. Write the schema and add it to `check-contract-schema.js`.
3. Implement `stage-graph.js`.
4. Wire it into the four discovery points named in CLAUDE.md.

**Acceptance:**
- `stage-graph.js nodes --size XS` prints `["implement","qc-gate","finish"]`.
- `next --from verify --size L` includes `implement` and `code-review`.
- `validate` fails on a planted graph with an unreachable node.
- Tests live in `hooks/tests/stage-graph.test.sh`.

### P2 — Structured marker + `stage-advance.js` (L)

1. Add the new fields to `session-mode.js set` with the same lock and atomic-rename discipline as `--phase`.
2. `stage-advance.js --to <node> [--unit i/N:label] [--review-families n]` reads the current marker stage, then:
   - asks `stage-graph.js next` whether the move is legal;
   - writes on legal;
   - exits 3 with `{allowed:false, from, to, legal_next}` on illegal.
   - A first write with no current stage is legal only into the size's entry node.
3. Update `phase-input.js` and `planned-input.js` to read the structured fields only. Remove `--phase`, `phase` and `phase_set_at` everywhere they are written or read: the watcher, the review page, the band and their tests. No dual-read period.

**Acceptance:**
- Tests cover a legal chain from entry to finish for every size.
- An illegal jump (`plan → implement` on size L, skipping plan-review) is refused.
- A test with no marker exits 2.
- A repo-wide grep finds no reader or writer of the removed `phase` field outside history.

### P3 — Rails write the marker on node entry (L)

1. Pin the node→writer table: for each rail node, the exact script and line where the node begins.
   - The `qc-gate` and `finish` entries are to be identified in this phase. If a node has no single entry script, it becomes a `prose` writer and is recorded so, not invented.
2. Each rail calls `stage-advance.js` on entry and passes `--review-families` from its resolved panel.
3. Failure handling is fail-open: a refused or failed stage write never blocks the rail, and it prints one stderr line.

**Acceptance:** KR2. Every rail row has a test that runs the rail (stub engine) against a temp marker and asserts `stage` and `review_families`.

### P4 — Unknown ladder: panel + experiment rungs (L; guidance text after the P0 verdict)

1. **Mechanism (in `probe-unknown.js`):**
   - add rung **panel**: a multi-family discussion through `dispatch-discuss.js` when the discuss seat is qualified, and today's single-family think-tank when it is not (recorded as `skipped/not-heterogeneous`, as U1 does today);
   - add rung **experiment**: a spike in a throwaway worktree with a pre-registered question and pass/fail criterion. Its receipt carries the criterion and the result;
   - add the eligibility rules: panel for a `whether` unknown with S5, or any unknown after survey; experiment only when an S4 or S1 signal survives a survey;
   - add budgets;
   - keep `classify` from ever emitting the owner rung;
   - order `U0 local · U1 consult · U2 survey · U3 panel · U4 experiment · U5 owner`; the owner rung renumbers U4 → U5 everywhere, no alias (§0.8).
2. Update the four call sites and their skills (dev-flow intent/plan, debug, think-tank, the ceo foreman round end) in the guidance commit.

**Acceptance:**
- `hooks/tests/probe-unknown.test.sh` extends with planted cases for each new rung and its exhaustion.
- The P0 ladder rows meet their rule.

### P5 — Guidance rewrite to the graph vocabulary (H-equivalent care, L size)

1. Rewrite dev-flow's size and stage sections as:
   - the graph (cited from `stage-graph.js`, not copied);
   - the `stage-advance.js` calls for the prose nodes;
   - the E1 rule: size at entry, and `diff-scope-report.sh` threshold → bump one size, threshold numbers set here.
   - Remove `L-1…`, `S-scope-gate`, the Fix and H sections, and the duplicate "S Session End" (inventory problems 1–9). Boy-scout trim toward contract-card shape.
2. finish-flow:
   - closing steps become the `finish` node's checklist keyed by size;
   - urgent: post-merge code-review that opens an `S` follow-up.
3. ceo-agent and its references: drop the copied definitions, cite the graph, and keep the level table.
4. team, plan-template (phase size field → new sizes), the config templates, and the review-loop template default G1.
5. Update the `description:` lines of dev-flow, finish-flow and team.
6. Run the P0 eval with base vs changed packs. Ship only on the frozen rule.
7. Then:
   - run the `profiles-hash-repin` sequence;
   - sync the codex mirror;
   - re-freeze the eval packs as the new base;
   - add the KR4 grep gate.

**Acceptance:** KR3, KR4. The profiles chain is green, and `sync-codex-plugin-skills.sh --check` is in sync.

### P6 — Backlog effort enum hard rename (S)

1. `check-backlog-entries.js`: valid values are the sizes from `stage-graph.json`, plus an optional `!`/`急` suffix.
   - Old `Fix`/`H` are rejected with the mapping message.
   - `XL` becomes valid, so the negative fixture changes.
2. `next-pick.js`:
   - parses the suffix instead of silently dropping it;
   - the human-gate rule moves from `L|H` to `L|XL` or urgent;
   - the tie-break is re-derived.
3. `migrate-backlog-entries.js` gains the map. Run it on `docs/BACKLOG.md`.

**Acceptance:** KR5, plus fixture tests for each old value.

### P7 — TUI band + ⓘ panel on the new data (L)

1. Implement V4a as decided in the TUI README:
   - one line: theme-key glyph, verdict word, `size·level ▸ stage`, unit `k/N` (frozen only), `·n族`, indicators, then `ⓘ`;
   - a panel with the legend, the current detail, and the graph with the current node highlighted.
2. Update `gate/check.js` to judge per field, add the colored-screenshot step, and re-run the real-machine gate in every mode.

**Acceptance:** KR1.

### P-R — Release tooling accepts pre-releases (S; mechanism; runs first, in parallel with P0/P1)

1. `sync-version.js`: accept `X.Y.Z` and `X.Y.Z-alpha.N` (also `beta`/`rc`). Shields badges need `-` escaped as `--` in the badge path.
2. `preflight-release.sh` and every version comparator found by a repo grep (`version-drift-check`, plan graduation, INDEX parsing) order pre-releases below their release, following semver §11.
3. Probe once with the real `claude plugin` CLI that a plugin.json carrying a pre-release version loads and is listed correctly. Record the run. The claim is not shipped without it.

**Acceptance:**
- Tests round-trip `3.0.0-alpha.1 → 3.0.0-alpha.2 → 3.0.0` through `sync-version.js` and `preflight-release.sh` fixtures.
- The CLI probe output is recorded in the evidence dir.

### P8 — Cut alphas, then release 3.0.0 (S, repeated)

1. Cut points:
   - `3.0.0-alpha.1` after P5 + P6 land: the new vocabulary is live and the owner dogfoods the graph.
   - `3.0.0-alpha.2` after P7: the TUI band.
   - Further alphas as fixes accumulate.
   - `3.0.0` once the owner signs off and the real-machine gate passes.
2. Each cut gets a CHANGELOG section. 3.0.0's section carries migration and rollback and folds in the mods P1W entries and `a2b91aef`'s Unreleased section.
3. Each cut also needs: the INDEX row, plan graduation (final only), and `preflight-release.sh`.
4. Ask the owner before every push.

**Dependency map:** `P0 → {P4, P5}`; `P1 → P2 → P3 → P7`; `P1 → {P5, P6}`; `P4 → P5`; `P-R → P8`; `{P5, P6} → alpha.1`; `{P3, P7} → alpha.2 → 3.0.0`. P-R, P0 and P1 can run in parallel; P4-mechanism can run in parallel with P2/P3.

## 5. Test / validation

- **Script-gated:**
  - per-phase tests (§4);
  - `check-contract-schema.js`;
  - `check-canonical-invariants.sh` (KR4);
  - the profiles hash chain;
  - codex mirror parity;
  - the real-machine gate kit `check.js` (per field).
- **Eval-gated:**
  - P0 prereg: frozen answer key, frozen ship rule, planted-red that must fail;
  - run with `evals/skill-onoff/run-skill-onoff-matrix.sh`;
  - scored mechanically with `score-onoff.js` or a sibling scorer keyed on the answer key.
  - No rerun-until-green: a failing verdict is recorded, and the text is revised as a new arm.
- **Human-gated:**
  - this proposal page (done);
  - the colored-screenshot judgment of the band (§55);
  - the push.

## 6. Risks + inversion

What would guarantee failure, and the mitigation for each:

- **The eval cannot tell base from change**, because the task set is too easy and a vacuous FULL==OFF passes. Mitigation: a planted-red pack must fail, P0 acceptance.
- **The model skips the prose `stage-advance` calls**, leaving the band stale on intent, plan and implement.
  - `stage-advance` refuses illegal jumps but cannot force a call.
  - Mitigation: the band shows the age of `stage_set_at`, and the gate kit asserts that stages advance during real runs.
  - An event-inferring hook (proposal option C3, not chosen) goes to BACKLOG with a ticket if the gate shows staleness.
- **The breaking rename strands consumers.** Mitigations:
  - a reject message that names the mapping and the migration command;
  - a migration section in the CHANGELOG;
  - rollback to the 2.x tag.
- **Scope**: F2 roughly doubles the plan, and the TUI waits behind P0–P6.
  - The owner accepted this (no placeholder UI).
  - Mitigation: run P1/P0 and P4-mechanism in parallel, and keep each phase independently landable on develop. Nothing releases until P8.
- **Hash-chain and mirror churn** from repeated SKILL.md edits. Mitigation: all skill text lands in one P5 guidance commit, and the re-pin runs once.
- **The graph drifts from prose again.** Mitigation: B1 means prose cites the CLI, and the KR4 gate catches old ids. The inverse risk is a prose copy of the node list, which a P5 review must reject.

## 7. Out of scope

- An event-inferring stage hook (proposal option C3).
- codeforge's own mod and the shared TUI style guide. That comes after this lands (TUI README decision 6).
- Any change to what `/l3–/l6` mean, or to campaign engine states. Campaign states map onto `unit` progress only.
- Re-qualifying engines for the verifier role.
- Compatibility aliases of any kind (§0.8). P4/P5 consume the existing scorecard.
- Cleaning up the stale `2.36.36` cache dir. That is host hygiene, and doctor already warns.

## 8. Open questions (Board)

None open. Resolved 2026-10-06 (§0.8–§0.9):
- **Ladder order:** `U0 local · U1 consult · U2 survey · U3 panel · U4 experiment · U5 owner`. The owner rung renumbers U4 → U5 in every file (about 10), with no alias.
- **2.37.0:** never cut. Pre-releases are `3.0.0-alpha.N`.

## Review log

- **R0** (2026-10-06, author Claude Opus 5.5 at depth-0): drafted from the owner discussion and the proposal page answers `A2 B1 C2 D2 E1 F2 G1`. The footprint pass that informed §2.6 and §3 was a sonnet Explore run in session e041e8fe. Frozen rubric: `docs/plans/2026-10-06-dev-flow-stage-graph.rubric.md` (R1–R11). Manifest: `docs/plans/2026-10-06-dev-flow-stage-graph.plan-review-manifest.json`, with `logical_plan_id: dev-flow-stage-graph-2026-10-06`, seats sol chair (openai), grok deep (xai) and MiniMax consult, and a minimum of 2 families.
