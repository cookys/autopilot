# Plan — a backlog entry is one pointer, not a work journal: schema, DI, gate, migration

> Status: R0 authored 2026-09-14 · Owner: cookys (opened on operator go) · Branch: develop · Frame: design plan
> requested by `cuda` for `revival.3d` (BACKLOG row "PEER-REPORTED (cuda, for revival.3d): a backlog ENTRY has no schema…");
> autopilot writes the schema and lands it here first, consumers adopt the same one.

## 0. Context / thesis

Autopilot tells every writer "add to BACKLOG with context + trigger" and enforces nothing beyond "no
trigger → rejected" (`skills/quality-pipeline/references/code-review.md:321-332`, read only by
code-review). Nothing caps a field, nothing requires a pointer, nothing is injected into a consumer
project. The result is measurable on both sides: revival.3d's backlog sits at 204,743 B against a
200 KiB file-size gate with half of the bytes in notes longer than 200 B, and **this repo's own
`docs/BACKLOG.md` is 233 KB** with multi-paragraph measured narratives in `Context` — written by the
same sessions that wrote this plan. The defect is the norm, not the consumers.

Thesis: **a backlog entry is an index row.** It says *what*, *when it fires*, *how big*, *who saw it*,
and *where the evidence lives*. Evidence, measurements, call stacks, decision narratives live at the
pointer (a plan under `docs/plans/`, a project under `docs/projects/`, a ticket, or an evidence
sidecar) — never in the row. The only thing that makes this hold is a gate that a session cannot
talk its way past, plus a ratchet so existing debt can only shrink.

## 1. Problem

Sessions treat the backlog as the one place that is never overwritten, so they paste evidence into it.
Consumer rules that say "register deferred items now; a handoff does not count" amplify this. With
no per-entry schema there is nothing to check, so the only gate is total file size, and trimming to
fit is undone within days. Readers (`/next`, `next-pick.js parse`, humans) cannot scan 200 rows of
prose; writers cannot tell where a note should go.

## 2. OKR / KRs

- **KR1** One canonical entry schema, stated once (`references/backlog-entry.md`), with per-field
  byte caps and a required pointer rule; every writer skill cites it instead of restating it.
- **KR2** A portable gate script that a consumer can run with zero autopilot config and that
  autopilot's own `finish-flow`/`quality-pipeline` run: required fields, caps, pointer resolution,
  duplicate ids, done-not-moved; ratchet allowlist; `--self-test`; exit 0/1/2.
- **KR3** DI: a `backlog-config.md` template that expresses both styles in use (heading entries;
  table rows with `NNNN` ids), scaffolded by `onboard`, resolved by the gate and by the writers.
- **KR4** A migration script that moves over-cap bodies out of an existing backlog into pointer
  targets without losing a byte, reviewable as a diff; autopilot's own backlog migrated first and
  the gate wired on it with an allowlist that only shrinks.
- **KR5** Consumer compatibility: "register now" stays satisfiable because registering is one row
  with a pointer; the gate proves the pointer exists, so a row is never the only copy of anything.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only, for every new script (it may run in a consumer with no jq/python).
- The schema is stated ONCE in `references/backlog-entry.md`; every other file links to it and quotes
  nothing but the field names. A second statement of the field list anywhere is a defect.
- Caps are bytes of UTF-8, measured by the gate, not characters; the gate's numbers are the schema's numbers.
- The gate never rewrites a backlog; migration is a separate script with `--dry-run` default.
- The allowlist ratchets down only: a run that would ADD an entry to it fails; `--update-allowlist`
  may only remove entries whose violations are gone.
- No trust machinery (ADR-0001): the gate re-derives every check from the file and the filesystem;
  it stores no attestations.
- Guidance vs mechanism: the gate and the migration script are mechanism; the schema text changes
  what skills ask for and is guidance — it ships with the eval evidence in §5, not before.

## 2.6 Change-policy decisions

- **Compatibility impact**: `additive-then-enforcing`. Phase 1–3 add files and a gate in `warn`
  mode; Phase 4 flips autopilot's own gate to `block` behind its allowlist; consumers flip on their
  own schedule via their `backlog-config.md`. Existing `- [ ] [Severity]` checklist entries from
  code-review remain valid under the `checklist` style.
- **Dependency decision**: `none` — no new runtime dependency; the gate reads markdown with a
  hand-rolled parser (three fixed styles, no markdown library).

## 3. File-structure map

| File | Responsibility |
|---|---|
| `references/backlog-entry.md` (new) | THE schema: fields, caps, pointer rule, the three styles, what goes to the pointer instead. Single canonical statement. |
| `project-config-template/backlog-config.md` (new) | DI template: `style`, `pointer_roots`, `id_pattern`, caps overrides (down only), `allowlist_path`, `mode: warn|block`, `done_retention_days`. |
| `scripts/check-backlog-entries.js` (new) | The gate. `--backlog <file> [--config <file>] [--allowlist <file>] [--mode warn|block] [--json] [--self-test] [--update-allowlist]`. |
| `scripts/migrate-backlog-entries.js` (new) | Moves over-cap bodies to pointer targets; `--dry-run` default; emits the rewritten backlog + sidecars + a manifest with byte counts and sha256 of moved text. |
| `scripts/resolve-project-paths.sh` | Gains `backlog_config` (path of the resolved `backlog-config.md`, or `none`) so writers and the gate find the DI without a second ladder. |
| `skills/onboard/SKILL.md` + `scripts/scaffold-config.js` | Scaffold `backlog-config.md` with the detected style (table if an existing backlog is a table, else heading). |
| `skills/quality-pipeline/references/code-review.md:321-332` | Replace the local format block with a link to the schema; keep the "no trigger → rejected" sentence as a quote. |
| `skills/dev-flow/SKILL.md` (:281, :476, :555, :584) | "add to BACKLOG with context + trigger" → "add one backlog row per `references/backlog-entry.md`; evidence goes to the pointer". |
| `skills/finish-flow/SKILL.md` S.2 / L-5.6 / H-9.6 | Call the gate on the resolved backlog; a `block` result is a closing-sequence failure. |
| `skills/quality-pipeline/SKILL.md` | Gate in the pre-merge checklist (warn until Phase 4). |
| `skills/handoff/SKILL.md` step 3.5 table | "one row, with the evidence" → "one row; the evidence at the pointer". |
| `skills/project-lifecycle/references/templates.md` | Backlog file template (header cites the schema; no per-file field list). |
| `docs/BACKLOG.md` + `docs/backlog/` (new dir) | Migrated: rows shrink to schema; moved bodies become `docs/backlog/<slug>.md` sidecars (or, when a plan exists, are appended to that plan's "Evidence" section). |
| `.claude/backlog-config.md`, `.claude/backlog-debt.json` | Autopilot's own DI + ratchet allowlist. |
| `hooks/tests/check-backlog-entries.test.sh`, `hooks/tests/migrate-backlog-entries.test.sh` | Red-first suites; fixtures for all three styles. |
| `docs/scripts-inventory.md`, `CLAUDE.md` group list, `CHANGELOG.md` | Wiring (the four-step rule). |

## 4. Phases

### Phase 1 — the schema, stated once (S, guidance; ships with §5 eval evidence)

`references/backlog-entry.md`:

**Fields (every style carries the same six; order fixed in heading style):**

| Field | Cap (bytes) | Rule |
|---|---|---|
| `Title` | 120 | one line; no trailing period; unique within the file (case-insensitive) |
| `Status` | — | `open` · `fired <YYYY-MM-DD>` · `shipped <version or sha>` · `dropped <YYYY-MM-DD>` |
| `Trigger` | 240 | one line; for `fired` rows the date replaces the condition |
| `Effort` | — | `S` · `Fix` · `M` · `L` · `H` (dev-flow sizes; `M` kept for `next-pick.js` compatibility) |
| `Source` | 160 | who/what surfaced it: commit, review run, peer + date, retro |
| `Pointer` | 200 | a path under one of `pointer_roots` that EXISTS, or an id matching `id_pattern`; `none` allowed only when the whole entry is ≤ 600 B |
| `Context` (optional) | 240 | one line problem statement |

**Entry cap**: 900 B total; nothing but the six/seven fields — no free bullets, no sub-lists, no code
fences. The gate rejects a seventh bullet as `extra_content`.

**Pointer rule (the thesis, as a rule)**: any of measurement numbers, log excerpts, call stacks,
decision narratives, or more than one sentence of context is *evidence* and lives at the pointer. A
row that needs to say more than its caps allow is a row that needs a pointer, not a bigger cap.
Pointer targets in order of preference: an existing plan (`docs/plans/…`), an existing project
(`docs/projects/…`), a ticket id, an evidence sidecar `docs/backlog/<slug>.md` created for this row.

**Three styles** (the gate parses all three; a file declares one in `backlog-config.md`):

1. `heading` — `### Title` then `- **Field**: value` bullets (this repo).
2. `table` — `| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |` rows; `Id`
   matches `id_pattern` (revival.3d's `NNNN`).
3. `checklist` — `- [ ] [Severity] Title` with indented `- Field: value` lines (code-review's
   follow-up output; `Severity` is carried as a tag, not a schema field).

**Done handling**: `shipped`/`dropped` rows older than `done_retention_days` (default 30) are
`done_not_moved` violations; the archive verb (project-lifecycle) or `--update-allowlist` is not the
fix — deleting the row is (history is in git and at the pointer).

Acceptance: the reference exists; `check-claude-md-inventory`/`check-reference-sizes` pass; every
field name appears in exactly one file (grep proves the single-statement rule).

### Phase 2 — the gate (S/M, mechanism)

`scripts/check-backlog-entries.js`:

- Inputs: `--backlog` (required); `--config` (default: resolve via `resolve-project-paths.sh
  --target <repo>` → `backlog_config`, else built-in defaults); `--allowlist` (default from config;
  absent = empty); `--mode warn|block` (config default `warn`); `--json`; `--self-test`;
  `--update-allowlist` (removal only).
- Checks, each a stable code: `missing_field`, `cap_exceeded` (field, bytes, cap), `bad_status`,
  `bad_effort`, `pointer_missing`, `pointer_unresolved` (path absent or outside `pointer_roots`),
  `pointer_required` (entry > 600 B with `none`), `duplicate_title`, `duplicate_id`,
  `extra_content`, `done_not_moved`, `unparseable_entry` (a block the parser cannot classify is a
  violation, never skipped — an unparseable row is how evidence hides).
- Allowlist: `{schema:1, entries:[{fingerprint, codes:[…]}]}` where `fingerprint = sha256(style +
  ':' + normalized title)`. A violation `(fingerprint, code)` in the allowlist is `allowed`; one not
  in it is `new`. Exit 1 in `block` mode when any `new` exists; in `warn` mode exit 0 with the
  report. `--update-allowlist` rewrites the file keeping only `(fingerprint, code)` pairs still
  violating — it can never add.
- Output JSON: `{mode, backlog, style, entries, bytes, violations:[{code, title, field, detail,
  allowed}], new_count, allowed_count, exit}`.
- `--self-test`: runs the parser and every check against embedded fixtures (one per style, one
  violation per code) and exits 0 only when each code fires exactly where expected — the test that
  the gate can fail.
- Exit: 0 clean or warn · 1 block with new violations · 2 usage / unreadable / self-test failed.

Test `hooks/tests/check-backlog-entries.test.sh`: three style fixtures; every code red-first; the
ratchet (a run that would add to the allowlist fails; `--update-allowlist` removes a fixed entry and
refuses to add); pointer resolution relative to the repo root, not cwd; UTF-8 caps (a 3-byte CJK
character counts 3); an entry with a fenced code block is `extra_content`.

Acceptance: suite green; `node scripts/check-backlog-entries.js --self-test` exits 0; run on
`docs/BACKLOG.md` reports (not yet blocks) the current debt count, recorded in the CHANGELOG.

### Phase 3 — DI + writers cite the one schema (S, mechanism for the resolver/scaffold; guidance for the skill lines)

- `project-config-template/backlog-config.md`: `style`, `pointer_roots` (default `docs/plans/,
  docs/projects/, docs/backlog/`), `id_pattern` (default none; revival.3d sets `^\d{4}$`),
  `mode`, `allowlist_path`, `done_retention_days`, and per-field cap overrides that may only be
  LOWER than the schema's (the gate refuses a higher one with `config_raises_cap`).
- `resolve-project-paths.sh` emits `backlog_config`; `scaffold-config.js` writes the template with
  the detected style; `onboard` names it.
- Writer lines (dev-flow ×4, finish-flow ×3, quality-pipeline, handoff, code-review, project-lifecycle
  templates) each become one sentence that links `references/backlog-entry.md`; finish-flow S.2 and
  quality-pipeline call the gate on the resolved backlog with the resolved config.

Acceptance: `grep -rn 'context + trigger' skills/` returns zero; every writer links the reference;
`resolve-project-paths.test.sh` covers `backlog_config` (declared, detected, `none`).

### Phase 4 — migration + autopilot dogfood (M, mechanism)

`scripts/migrate-backlog-entries.js --backlog <file> [--config] [--out-dir docs/backlog] [--apply]`:

- For every entry over cap or with extra content: keep the six fields (synthesising `Status` from the
  Trigger's `FIRED`/`SHIPPED`/`NOT FIRED` markers where present; otherwise `open`), move the rest
  verbatim into `docs/backlog/<slug>.md` with a header `# <title>` + `Source: docs/BACKLOG.md@<sha>`,
  set `Pointer` to it (or to an existing plan when the entry already links one and the plan is the
  natural home — a `--pointer-map` file lets the operator pre-assign).
- Manifest: per entry, bytes before/after, sha256 of the moved text, target path. `--apply` writes;
  default prints the manifest and the would-be diff.
- Nothing is dropped: `sha256(moved text)` must appear in the sidecar; the script verifies before
  reporting `preserved: true` (same posture as `repo-residue-sweep.js preserve`).

Dogfood: migrate `docs/BACKLOG.md` (233 KB, ~150 entries), commit the sidecars, run the gate in
`block` mode with `.claude/backlog-debt.json` holding whatever the migration could not fix
mechanically (e.g. rows whose pointer is a plan that does not exist yet), wire the gate into
`finish-flow`/`quality-pipeline`, and record the debt count so the next release can only lower it.

Acceptance: post-migration `docs/BACKLOG.md` ≤ 40 KB; the gate blocks on a deliberately added fat
row; allowlist count recorded; `next-pick.js parse` still extracts every active row (its parser
reads Effort/Source — unchanged names).

### Phase 5 — hand the schema to consumers (S, docs)

Reply to `cuda` with the plan sha and the three artifacts a consumer needs: the reference, the
template, the gate. revival.3d's `check-docs-hygiene` keeps its 200 KiB total as a backstop; the
per-entry gate is the primary. Their "register now" rule is rewritten by them as "register = one
row with a pointer" — the gate makes the pointer non-optional above 600 B, so the rule and the
schema cannot conflict.

Dependencies: 1 → 2 → 3 → 4 → 5 (2 can be built in parallel with 1's eval; 4 needs 2 and 3).

## 5. Test / validation

- Script-gated: both new suites; `--self-test`; `resolve-project-paths` cases; inventory/mirror gates.
- Guidance eval (scorecard-first, for Phase 1/3's skill text): five backlog-writing scenarios in the
  evals harness (deferred item from dev-flow; code-review follow-up; handoff 陷阱 routing; ceo
  registration under a "register now" rule; a measured incident with numbers). ON = writer lines
  link the schema and the gate runs; OFF = today's "context + trigger". Metric: bytes written to
  the backlog per scenario and whether evidence landed at a pointer. Ship Phase 1/3 only with ON
  beating OFF on both.
- Human-gated: the pointer map for autopilot's own migration (which fat rows go to which plan) — a
  one-time operator read of the manifest before `--apply`.

## 6. Risks + inversion

- **Sessions route around the gate by writing to a sidecar with the same prose** — acceptable by
  design: the sidecar is the pointer; the backlog stays scannable. What must not happen is a
  sidecar per sentence: `migrate` creates one per entry, and the schema names the plan/project as
  the preferred target.
- **The allowlist becomes permanent debt** — the ratchet only removes, and the CHANGELOG records the
  count per release; a count that does not move is visible.
- **A consumer's table style has columns the parser does not expect** — `unparseable_entry` fires,
  never a silent skip; the config's `columns` override maps names.
- **Guidance change without eval** — Phase 1/3 skill text is gated on §5; the gate (mechanism) can
  ship first in `warn` mode without it.
- **What would guarantee failure**: shipping the gate in `warn` forever. Phase 4 flips autopilot to
  `block` in the same release; a consumer that never flips is their choice, recorded in their config.

## 7. Out of scope

- Ranking or picking entries (`next-pick.js` stays as is; it only needs the field names to hold).
- A BACKLOG web view or any rendering.
- Retro-fitting `Severity` as a schema field (it stays a checklist-style tag).
- Rewriting `docs/BACKLOG.md`'s history — git holds it; the migration is one commit forward.

## 8. Open questions

1. Pointer requirement threshold: 600 B with `none` allowed below it, or pointer always required?
   (Plan proposes 600 B so a one-line thought can still be registered without creating a file.)
2. `done_retention_days` default 30, or delete-on-ship with no grace? (Plan proposes 30.)
3. Should the gate run as a pre-commit ritual in autopilot (`sync-all.sh` family) or only at
   finish-flow/quality-pipeline? (Plan proposes finish-flow + quality-pipeline first; pre-commit after
   one release of `block` without friction.)

## Review log

- R0: author (this session), 2026-09-14. Bounded review identity not yet assigned; plan-review
  manifest to be written beside this file before readiness review (`references/plan-template.md`
  § Bounded review identity).
