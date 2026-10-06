# Plan — dev-flow stage graph: one named graph, T-shirt sizes, a marker the band can read

> Status: R1 (G1 repair) · Owner: cookys · Branch: Train A on develop, Train B on `release/3.0.0` (§4) · Frame: guidance + mechanism, authorized-breaking (3.0.0)
> Blocks the mods P1W TUI band (`2026-10-03-mods-visible-dispatch.md` R5.10/R5.11) and therefore the next release.

## 0. Context / thesis

The band's position and progress slots have no data source; the live band printed `● 進行中 autopilot · — · 5m · —` / `回合進行中（0 分）`. The owner ruled that a placeholder UI with no data is pointless. The stage inventory (`docs/plans/evidence/2026-10-06-dev-flow-stage-inventory/README.md`) found:
- dev-flow stages exist only in prose;
- "L" means three things and "phase" six;
- no skill or hook writes the current stage where a program can read it.

This plan replaces the stage prose with one named graph that a script owns. Writers record the graph position in the session marker, and the band is rebuilt on that data.

### Settled — do not reopen (owner rulings, 2026-10-06)

1. **Graph.** `intent → [research when needed] → proposal → plan → plan-review⟲ → per phase (implement → verify) → code-review⟲ → qc-gate → finish`. Bugs enter at `diagnose`. Exact sequences are in §2.7.
2. **Research before proposal.**
   - Unknown-ladder U0: the model proposes from its own knowledge, with no survey.
   - Otherwise it climbs the ladder, and the proposal comes after the research.
   - `proposal` is a web page of assumptions plus illustrated options that the user picks from.
3. **Two review layers.** Each phase is verified by a qualified verifier (engine scorecard verifier role). The hetero code review runs once after all phases, on the full diff. The same rule applies to bug and urgent work.
4. **Sizes.**
   - `XS S M L XL` decide only which nodes run.
   - A bug is an entry node, not a size.
   - Urgency is a suffix after the letter: `S!`, alias `S急`. A prefix `!` is eaten by Claude Code's bash mode.
5. **Levels.** `/l3–/l6` are hetero/delegation mode (who implements, who authors verification), orthogonal to size.
6. **Review strength.** It is a third axis: the number of model families on a review node, resolved by `scripts/resolve-review-loop.sh` from risk and roster. No node is named hetero, and a Claude-only `/l3` user runs the same graph.
7. **No compatibility shims.** Old names are migrated, not aliased, and the marker `phase` field is removed. Rollback means pinning the previous tag.
8. **Releases.** Pre-releases are `3.0.0-alpha.N`, tested by the owner as the heaviest user. 2.37.0 is never cut, and mods P1W folds into 3.0.0.
9. **Proposal-page answers** (https://claude.ai/artifact/WhaLzUsfwmMdDut9ndVB7X v2): `A2 B1 C2 D2 E1 F2 G1`.
   - A2: hard rename.
   - B1: JSON + CLI.
   - C2: `stage-advance.js` validates.
   - D2: structured marker.
   - E1: size at entry plus a diff-threshold bump.
   - F2: new ladder rungs here.
   - G1: low-risk review = one family, fresh context, as the default.

## 1. Problem

The owner wants to glance at the band or review page and know four things:
- which step a session is in;
- how far along it is;
- whether it needs them;
- how strongly it is being checked.

None of this is recorded mechanically outside `/l5–/l6` campaigns. Claude-only colleagues cannot tell what dev-flow expects of them, because review strength is tangled into stage names.

## 2. OKR / KRs

- **KR1 — real-machine gate.** The gate re-run passes per field (`references/evidence-discipline.md` §54) in every mode: dev-flow, `/l3`, ceo, `/l4`, `/l5`, `/l6`.
  - The band shows `size·level ▸ stage [unit k/N] [·n族]`.
  - Each slot is derived from a marker field (§2.9), with no dash placeholder.
  - Each check has a colored screenshot (same file, §55).
- **KR2 — rail tests.** Every rail row in §2.7 has a deterministic test that runs the rail against a temp marker and asserts `stage`, `stage_set_at` and, where applicable, `review_families`.
- **KR3 — eval.** The P0-registered eval meets its frozen ship rule, and `check-guidance-eval.js` passes at every cut.
- **KR4 — vocabulary.** `node scripts/check-stage-vocab.js` reports zero hits in shipped non-history files. It checks for:
  - old stage ids;
  - the old size enum `Fix`/`H` in effort fields and descriptions;
  - the marker `phase` field;
  - owner-rung `U4`.
- **KR5 — backlog.** `docs/BACKLOG.md` passes `check-backlog-entries.js` after migration.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Sizes are exactly `XS`, `S`, `M`, `L`, `XL`. Urgency is the suffix `!` (alias `急`) written after the size letter, never before it; scripts and the marker carry it as `urgent: true`.
- Graph node ids are exactly: `intent`, `diagnose`, `research`, `proposal`, `plan`, `plan-review`, `implement`, `verify`, `code-review`, `qc-gate`, `finish`. No node id contains `hetero`.
- `/l3`–`/l6` keep their current meaning. Size never encodes level and level never encodes size.
- Review strength = the distinct model families on a review node, resolved by `scripts/resolve-review-loop.sh`; never silently lowered (a shortfall goes through `on_engine_unavailable`); the marker records the family ids actually used.
- `references/stage-graph.json` is the graph's single canonical definition; prose cites `scripts/stage-graph.js` output and never re-lists node sequences.
- New scripts are Node ≥ 20.10, built-ins only; one JSON object on stdout, diagnostics on stderr, exit codes in the header.
- Mechanism commits never edit files in the guidance manifest (§2.8); guidance ships only on a cut where `check-guidance-eval.js` passes.
- No trust machinery (ADR-0001): the marker is telemetry; gates re-derive, never trust a stage claim.

## 2.6 Change-policy decisions

- **Compatibility impact: `authorized-breaking`** (owner A2, 2026-10-06). The target is 3.0.0, via `3.0.0-alpha.N`.
  - **Consumers affected:**
    - backlog `**Effort**:` rows (`check-backlog-entries.js:31`, `next-pick.js:167`);
    - consumer `.claude/dev-flow-config.md`, generated by `scaffold-config.js` (no update mode), and `finish-flow-config.md`, copied by hand; both may carry old ids;
    - skill routing via the `description:` of dev-flow, finish-flow and team;
    - ladder rung ids (owner rung U4 → U5);
    - marker readers of `phase`.
  - **Migration:**
    - `migrate-backlog-entries.js` maps `Fix→S`, `H→S!`, and leaves `S/M/L` unchanged;
    - `check-stage-vocab.js --repo <consumer>` lists every stale line in `.claude/*.md` and the backlog files, with its replacement;
    - the CHANGELOG 3.0.0 migration section names both tools and the hand step for configs.
  - **Rollback:** pin the last 2.x tag. Old markers are per-session telemetry with a TTL, so a 2.x reader after a 3.x session only sees no phase.
  - **Contract validation:** graph and marker schemas, through `check-contract-schema.js`.
- **Dependency decision: `platform/stdlib`.**

## 2.7 The graph (frozen; P0 turns it into the fixture P1 must reproduce)

**Sequences (feature entry):**
- `XS`: implement → qc-gate → finish
- `S`: implement → verify → qc-gate → finish
- `M`: plan → implement → verify → code-review → qc-gate → finish
- `L`: intent → [research] → proposal → plan → plan-review → (implement → verify)×N → code-review → qc-gate → finish
- `XL`: as L, except each deliverable D runs (implement → verify)×phases(D) → code-review. `unit.kind` is `deliverable`.

**Variants:**
- **`--bug`:** `diagnose` replaces the leading node.
  - XS, S: `diagnose → implement…`
  - M: `diagnose → plan…`
  - L, XL: `diagnose → [research] → proposal…`
- **Research is an optional edge.** Both `intent|diagnose → research → proposal` and `intent|diagnose → proposal` are legal. Taking it is the ladder's call, not the graph's.
- **`--urgent` without `--high-risk`:** code-review moves after finish (`… verify → qc-gate → finish → code-review`). Post-finish code-review is terminal, and each finding opens a new `S` task.
- **`--urgent --high-risk`:** the normal order. XS and S have no code-review, so urgency only marks them.
- **High risk** means `resolve-review-loop.sh` reports `review_risk: high` when fed the `risk_flags` of `classify-diff-risk.sh --range <base_ref>..HEAD`.

**Loop-backs** (all legal): plan-review→plan, verify→implement (same or next unit), code-review→implement, qc-gate→implement. The terminal node is finish, or code-review on the urgent path.

**Size bump (E1):**
- Stage-advance into `verify` or `qc-gate` computes `git diff --numstat <base_ref>..HEAD`.
- Limits, in files / changed lines (added+deleted), across all paths:

  | Size | Files | Changed lines |
  |---|---|---|
  | XS | ≤2 | ≤20 |
  | S | ≤6 | ≤200 |
  | M | ≤20 | ≤800 |
  | L, XL | no limit | no limit |

- A diff equal to a limit fits. Over a limit, stage-advance exits 4 with the next size, and the caller runs `session-mode.js set --size <next>` (upward only).
- A bump changes only the remaining path; earlier nodes are not retroactively required.

**Writers** — the rail, or `prose` plus the skill that calls `stage-advance.js`:

| Node | Writer |
|---|---|
| intent, proposal, plan | prose (dev-flow) |
| diagnose | prose (debug) |
| research | prose (the caller acting on the `probe-unknown.js` recommendation) |
| plan-review | rail: `dispatch-plan-review.js` `main()` |
| implement | rail at l5/l6: `bin/autopilot.js engine implement-review` (with unit); prose at l3/l4 (dev-flow, foreman) |
| verify | prose (dev-flow; at l6, the verification-author dispatch) |
| code-review | rail: `hetero-review-loop.js` `main()` |
| qc-gate | prose (quality-pipeline) |
| finish | prose (finish-flow) |

## 2.8 Guidance manifest (what the eval must cover)

- **Manifest paths:** `skills/*/SKILL.md`, `skills/*/references/**`, `references/*.md`, `agents/*.md`, `project-config-template/*.md`.
- **Change pack:** the P0 prereg lists exactly which of these files P4b and P5 change, and the P0 change pack is built from exactly those files.
- **Cut gate:** `check-guidance-eval.js` checks two things at each cut:
  1. Every manifest file that differs from the 2.x base is byte-equal to its copy in the evaluated pack (digests in `evals/skill-onoff/packs/manifest.json`).
  2. Re-running the scorer on the recorded results reproduces SHIP.

## 2.9 Marker schema (frozen)

Kept: `level` (`l3|l4|l5|l6|null`) and the identity fields. Removed: `phase`, `phase_set_at`.

New fields:

| Field | Type / invariant |
|---|---|
| `size` | `XS\|S\|M\|L\|XL` |
| `urgent` | bool |
| `bug` | bool |
| `base_ref` | commit sha |
| `stage` | node id enum |
| `stage_set_at` | ISO-8601 UTC with ms |
| `unit` | `{kind: phase\|deliverable, index ≥1, total ≥1, label ≤64 chars}`, or absent |
| `review_families` | array of family ids, e.g. `["anthropic","openai"]`; the band shows its length |

**Init:** dev-flow entry runs `session-mode.js set --size <S> [--urgent] [--bug] [--base-ref <sha>]` in one lock with an atomic rename. `--base-ref` defaults to `git merge-base HEAD <default branch>`.

**`stage-advance.js --to <node> [--unit kind:i/N:label] [--review-families a,b]`** exits:
- **0** — written.
- **2** — no marker.
- **3** — illegal transition. Prints `{allowed:false, from, to, legal_next}`. A first write must target the entry node for (size, bug).
- **4** — size bump required (§2.7). Prints `{bump_to}`.
- **5** — `size` missing (init not run).

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `references/stage-graph.json`, `schemas/stage-graph.schema.json` (new) | §2.7 as data | P1 |
| `scripts/stage-graph.js` (new) | `nodes --size S [--bug] [--urgent] [--high-risk]`, `next --from N --size S [same flags]`, `validate` | P1 |
| `hooks/tests/fixtures/stage-graph/expected.json` (new) | Frozen fixture: 30 sequences (5 sizes × 2 entries × 3 urgency) | P0 |
| `scripts/session-mode.js`, marker schema | §2.9 fields and init flags (P2a); remove `--phase`/`phase`/`phase_set_at` (P2b) | P2 |
| `scripts/stage-advance.js` (new) | Transition legality, bump check, marker write | P2a |
| `src/status/phase-input.js`, `planned-input.js`, watcher, review page | Read §2.9 fields only | P2b |
| `scripts/dispatch-plan-review.js`, `scripts/hetero-review-loop.js`, `bin/autopilot.js` engine implement-review | Rail writers (§2.7) | P3 |
| `scripts/probe-unknown.js`, `scripts/decision-ledger.js` | U3 panel, U4 experiment, owner → U5 | P4 |
| `scripts/check-stage-vocab.js` (new) | KR4 gate; `--repo` consumer report; semantic U4 check | P5 |
| `scripts/check-guidance-eval.js` (new) | §2.8 cut gate, called by `preflight-release.sh` | P0 (written), P8 (wired) |
| Guidance manifest files (§2.8) | Graph vocabulary; ladder text | P4b, P5 |
| `profiles/*`, `platforms/codex/plugin/*`, `evals/skill-onoff/packs/*` | Hash re-pin, mirror sync, pack freeze | P5 |
| `scripts/{check-backlog-entries,next-pick,migrate-backlog-entries}.js`, `docs/BACKLOG.md` | Effort = sizes + suffix; migration | P6 |
| `scripts/sync-version.js`, `scripts/preflight-release.sh`, version comparators | Pre-release support | P-R |
| `mods/live/{band.tsx,pane.tsx,model.ts}`, `docs/plans/evidence/2026-10-04-mods-p1c/gate/check.js` | V4a band + ⓘ panel; per-field gate | P7 |

## 4. Phases and landing trains

Phase sizes use the **pre-plan** vocabulary (S/L/H/Fix), because the new one does not exist until P5.

- **Train A** (additive; may land on develop any time, because it changes no existing behavior; develop's working tree is what this host loads via the directory marketplace): P-R, P0, P1, P2a, P4a.
- **Train B** (breaking; built in a worktree on `release/3.0.0`, merged to develop only at the alpha.1 cut with every invariant green): P2b, P3, P4b, P5, P6, then P7 (alpha.2).

### P-R — pre-release tooling (S; mechanism; Train A)

1. `sync-version.js` accepts `X.Y.Z(-(alpha|beta|rc).N)?`. In shields badge paths, `-` is escaped as `--`.
2. `preflight-release.sh`, and every comparator found by `grep -rn '\\d+\\.\\d+\\.\\d+'` in `scripts/` and `hooks/`, order a pre-release below its release (semver §11).
3. Probe once with the real `claude plugin list` that a pre-release plugin.json loads, and record the output in the evidence dir.

**Acceptance:** fixture tests round-trip `3.0.0-alpha.1 → alpha.2 → 3.0.0`, and the probe output is recorded.

### P0 — eval pre-registration (S; eval; Train A; before P1)

1. Write `expected.json` from §2.7.
2. Freeze base packs from HEAD (`evals/skill-onoff/freeze-pack.js`) for every §2.8 file that P4b/P5 will change.
3. Write `evals/skill-onoff/tasks/stage-graph-*`, 12 briefs:
   - XS/S/M/L feature;
   - XL deliverable;
   - XS and M bug;
   - `S!`, plus `M!` with a high-risk path;
   - one U0-known L;
   - two research-needing L.

   Each brief has an answer key: size, bug, urgent, research yes/no, the expected sequence taken from `expected.json`, and the expected first rung.
4. Write the scorer `evals/skill-onoff/score-stage-graph.js`. It extracts, in order, from Bash `tool_use` events via `lib/transcript-query.js`:
   - `session-mode.js set --size … [--bug] [--urgent]`;
   - `stage-advance.js --to …`;
   - the first `probe-unknown.js` recommend.

   **Rep passes** when size, bug and urgent are exact, the first target is the expected entry node, and the observed sequence is a prefix of the expected one with length ≥ min(3, expected).
   **Task passes** when 2 of 3 reps pass.
5. Freeze the ship rule in `evals/skill-onoff/prereg/stage-graph.md` (reps 3, sonnet):
   - the change arm passes ≥ 10/12 tasks;
   - a planted-red arm (graph text with M and S swapped) passes ≤ 6/12;
   - no `skill-onoff-generic` marker that base passes in ≥ 2/3 reps may regress.

   A failure is recorded and the revision is a new arm. There is no rerun-until-green.
6. Write `check-guidance-eval.js` (§2.8), and re-key `lib/p1w-markers.sh` on `expected.json`.

**Acceptance:**
- The prereg is committed before any P4b/P5 text exists.
- The planted-red fixture fails in `hooks/tests/skill-onoff-*.test.sh`.
- `check-guidance-eval.js` fails on a fixture whose shipped file differs from its pack copy.

### P1 — graph data + CLI (L; mechanism; Train A; after P0)

1. Write `stage-graph.json` and its schema, wired into `check-contract-schema.js`.
2. Write `stage-graph.js`.
3. Wire two of the four CLAUDE.md discovery points here:
   - a `docs/scripts-inventory.md` row;
   - the CLAUDE.md "Mission, campaign & session state" list.

   P5 wires the other two (the dev-flow Available Scripts row and `skills/dev-flow/references/stage-graph.md`), because those are guidance files.

**Acceptance:** `hooks/tests/stage-graph.test.sh` checks exact stdout:
- `nodes` for all 30 combinations equals `expected.json` (e.g. `nodes --size XS` → `["implement","qc-gate","finish"]`);
- `next --from verify --size L` → `["code-review","implement"]`;
- `next --from finish --size M --urgent` → `["code-review"]`;
- `validate` exits 1 on a planted graph with an unreachable node.

### P2a — marker fields + stage-advance (L; mechanism; Train A)

1. Implement the §2.9 init flags and fields, and `stage-advance.js`. `phase` stays untouched here.

**Acceptance:**
- For each size, init then the full legal chain from `expected.json` succeeds.
- An illegal `plan → implement` on L exits 3.
- A first write to `plan` on size S exits 3.
- No marker exits 2.
- No `size` exits 5.
- A planted over-threshold diff on XS exits 4 with `bump_to: S`.
- A downward `set --size` is refused.

### P2b — remove `phase`, switch readers (S; mechanism; Train B)

1. Remove `--phase`, `phase` and `phase_set_at` from `session-mode.js`.
2. Move every reader (watcher, review page, band `model.ts` and their tests) to the §2.9 fields.

**Acceptance:** `check-stage-vocab.js` finds no `phase`-field reader or writer, and the status suites are green.

### P3 — rail writers (L; mechanism; Train B)

1. The three rails in §2.7 call `stage-advance.js` on entry. They pass `--review-families` from the resolved panel, and `--unit` where the engine knows it.
2. A failed or refused write is fail-open: the rail continues, and prints exactly one stderr line `stage-advance: <exit> <reason>`.

**Acceptance:** KR2. Each rail is run with a stub engine against a temp marker and asserts `stage`, `review_families` and `unit`. A forced exit 3 produces the one-line diagnostic, and the rail still exits 0.

### P4 — ladder: U3 panel, U4 experiment, U5 owner (L; P4a mechanism on Train A, P4b renumber + text on Train B)

**P4a** is additive and sits behind `unknown_ladder_v3`, default off. P4b deletes the knob.

- **Budgets** use probe-unknown's existing unit (per work unit): U1 2, U2 1, U3 1, U4 1.
- **U3 panel:**
  - Eligibility: today's U3 rule, a hard why/whether signal (S1/S2/S3/S5).
  - Rail: `dispatch-discuss.js` when the discuss seat is qualified. Otherwise think-tank (`whether`) or the debugger PUA (`why`), with `heterogeneous:false, reason:not-heterogeneous`.
  - Receipt: the existing ladder row plus `rail` and `families[]`.
- **U4 experiment:**
  - Eligible only after a U2 receipt exists for the work unit and S4 or S1 is still present.
  - Runs as a spike in a throwaway worktree.
  - Receipt adds `question`, `criterion`, and `result: pass|fail|inconclusive`.
- **Exhaustion** is unchanged: a used rung is never repeated, and when everything is spent the result is `recommend:none, reason:budget-exhausted`.
- **U5 owner** is reached only by the caller's own stop. `classify` never emits it.

**P4b** renumbers:
- `probe-unknown.js` lines 20, 31, 32, 76, 85, 403, 437;
- `decision-ledger.js` lines 31, 70, 94;
- `hooks/tests/probe-unknown.test.sh` lines 67, 69, 72, 138.

It also rewrites the ladder text in `skills/{debug,l4,l5,l6}/SKILL.md`, `skills/ceo-agent/SKILL.md`, `references/depth0-control-loop.md`, `references/hetero-dispatch.md`, `docs/scripts-inventory.md`, and the dev-flow intent/plan and think-tank call sites, then re-syncs the mirrors. The unrelated `U4` in `BACKLOG.md:791` and `mission-convergence.test.sh:256` is excluded by path in `check-stage-vocab.js`.

**Acceptance:**
- `probe-unknown.test.sh` has planted cases for each new rung's eligibility, receipt and exhaustion, and for classify never emitting U5.
- `check-stage-vocab.js` fails a fixture with `U4` next to owner words.

### P5 — guidance rewrite (L; guidance; Train B; after P0, P2a)

1. **dev-flow:**
   - sizes, entry and init per §2.9;
   - stage calls that cite `stage-graph.js`;
   - the E1 bump;
   - remove `L-1…`, `S-scope-gate`, the Fix/H sections and the duplicate S session-end;
   - contract-card trim.
2. **finish-flow:** the `finish` checklist keyed by size, and the urgent post-finish code-review.
3. **ceo-agent:** cite the graph, keep the level table.
4. **team**, `references/plan-template.md`, the config templates, and the G1 default in `review-loop-config.md`.
5. The `description:` lines of dev-flow, finish-flow and team.
6. The P1-deferred discovery rows.
7. Run the P0 eval: base vs change, plus planted-red.
8. On SHIP:
   - `profiles-hash-repin`;
   - codex mirror sync;
   - re-freeze the packs;
   - wire `check-stage-vocab.js` into `check-canonical-invariants.sh` and drop its `S-scope-gate` literal.

**Acceptance:** KR3 and KR4; the profiles chain is green; `sync-codex-plugin-skills.sh --check` is in sync.

### P6 — backlog effort rename (S; mechanism; Train B)

1. `check-backlog-entries.js`: valid values are the sizes from `stage-graph.json` plus an optional `!`/`急`. `Fix` and `H` are rejected with the mapping and the migration command. `XL` becomes valid, so its negative fixture changes.
2. `next-pick.js`:
   - parses the suffix;
   - human gate = `L|XL` or urgent;
   - tie-break `XS > S > M`.
3. Migrate `docs/BACKLOG.md`.

**Acceptance:** KR5, plus a fixture for each old value.

### P7 — TUI band + ⓘ panel (L; mechanism; Train B → alpha.2)

1. Implement V4a (TUI README) on the §2.9 fields:
   - band line: `size·level ▸ stage`, `unit k/N`, `·n族`, and the `stage_set_at` age;
   - panel: legend, detail, and the graph with the current node highlighted.
2. `gate/check.js`:
   - judges each slot against its marker field, expected output `PASS <mode> fields=<n>`;
   - adds a colored-screenshot step (`capture-pane -e` → `ansi2html.py` → headless chrome).
3. Re-run the gate in every mode.

**Acceptance:** KR1.

### P8 — cuts (S; release; repeated)

**Cut points:**
- alpha.1 = Train B merged (P2b, P3, P4b, P5, P6) with every invariant green.
- alpha.2 = P7.
- 3.0.0 = owner sign-off plus the KR1 gate.

**Each cut:**
1. A CHANGELOG section. 3.0.0's folds in the mods P1W entries and `a2b91aef`'s Unreleased section, plus migration and rollback.
2. The INDEX row.
3. `preflight-release.sh`, now calling `check-guidance-eval.js`.
4. Plan graduation (final cut only).
5. Ask the owner before every push.

**Dependency map:**
- `P0 → P1 → P2a → {P2b, P3, P5}`
- `P0 → P5`
- `P4a → P4b → P5`
- `P1 → P6`
- `P-R → P8`
- `{P2b, P3, P4b, P5, P6} → alpha.1`
- `P7 → alpha.2 → 3.0.0`

P-R and P0 run first, in parallel. P4a runs in parallel with P1/P2a.

## 5. Test / validation

- **Script-gated:**
  - per-phase acceptance;
  - `check-contract-schema.js`;
  - `check-stage-vocab.js`;
  - `check-guidance-eval.js`;
  - the profiles chain;
  - mirror parity;
  - `gate/check.js`.
- **Eval-gated:** P0's frozen rule, with a planted red and no rerun-until-green.
- **Human-gated:**
  - the proposal page (done);
  - the colored-screenshot judgment;
  - each push.

## 6. Risks + inversion

- **A vacuous eval.**
  - Mitigation: a planted-red arm must fail, and the exact-sequence fixture binds the scorer.
- **Prose writers skip `stage-advance`** (six nodes are prose-written).
  - Exit 3 refuses illegal jumps but cannot force a call.
  - Mitigation: the band shows the `stage_set_at` age, and the gate asserts that stages advance in real runs.
  - If staleness shows anyway, an event-inferring hook (option C3) goes to BACKLOG.
- **The breaking change reaches develop early.**
  - Mitigation: Train B stays on `release/3.0.0` until alpha.1.
- **Stranded consumers.**
  - Mitigation: the reject message names the mapping; `check-stage-vocab.js --repo`; the CHANGELOG migration section.
- **Scope.** F2 doubles the work; the owner accepted the TUI wait.
  - Mitigation: Train A parallelism.
- **Hash-chain churn.**
  - Mitigation: one P5 guidance commit and one re-pin.
- **Graph/prose drift.**
  - Mitigation: prose cites the CLI, and the KR4 gate catches leftovers.

## 7. Out of scope

- An event-inferring stage hook (option C3).
- The codeforge mod and the shared TUI style guide.
- Changes to `/l3–/l6` meaning or to campaign engine states, which map onto `unit` only.
- Re-qualifying verifier engines.
- The stale `2.36.36` cache, which the doctor already warns about.
- Compatibility aliases of any kind.

## 8. Open questions (Board)

None. Resolved 2026-10-06:
- Ladder order: U0 local · U1 consult · U2 survey · U3 panel · U4 experiment · U5 owner, with no alias.
- No 2.37.0.

## Review log

- **R0** (2026-10-06, Claude Opus 5.5 at depth-0): drafted from the owner discussion and the proposal-page answers.
  - Frozen rubric: `docs/plans/2026-10-06-dev-flow-stage-graph.rubric.md` (R1–R11).
  - Manifest: `docs/plans/2026-10-06-dev-flow-stage-graph.plan-review-manifest.json`, `logical_plan_id: dev-flow-stage-graph-2026-10-06`.
  - Seats: sol chair (openai), grok deep (xai), MiniMax consult; minimum 2 families.
- **G1** (2026-10-06): CONDITIONAL. Transport was complete (3/3 seats), with 16 blocker candidates.
  - Artifact: `docs/plans/2026-10-06-dev-flow-stage-graph.g1-artifact.json`.
  - Depth-0 dispositions: `….g1-dispositions.json` — 9 accepted blockers; the rest duplicates or accepted non-blocking; none rejected.
- **R1** is the bounded repair of the accepted G1 blockers and nothing else:
  - §2.7 graph and writers;
  - §2.8 guidance manifest and cut gate;
  - §2.9 marker schema;
  - the P0 scorer and ship rule;
  - P4 budgets and receipts;
  - landing trains;
  - E1 thresholds;
  - named discovery points.
