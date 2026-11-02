# Plan - operator console A3: autopilot writers use hippo

> Status: draft for plan review (R0). Owner: operator (decisions), autopilot session (author) ·
> Branch: `plan/oc-a3-hippo-writers` · Size: L (seven phases) ·
> Parent: fleet repo `docs/plans/2026-11-01-operator-console.md` (approved 2026-11-01), deliverable D3, phase A3 ·
> Frame: hippo owns records and queries; autopilot owns the flow and decides what to write, and calls the
> `hippo` CLI to write it; fleet tasks hold live coordination state (who holds the work, progress).

## 0. Context / thesis

The operator-console plan (parent plan, §1 problem 1) found that autopilot's knowledge does not scale:
the backlog, ADRs, handoffs and lessons are markdown files that models edit by hand. Finding anything costs
`grep` tokens that grow with the project, relations live in prose, and two sessions once allocated the same
backlog number. The parent plan answers this with hippo (D1): one file per record in git, an op log as the only
authority, a rebuildable index, and a CLI as the only writer. D3 is autopilot's side of that change. A3 moves
every autopilot writer onto hippo and makes the skills read through hippo.

Decisions this plan builds on (parent plan §0 and §2.6, binding):

| Source | Decision |
|---|---|
| Card Q1 | hippo is the single writer of backlog and flow records; autopilot stays the project manager |
| Card Q12 | knowledge = one file per record in git + a rebuildable local index; live coordination state = fleet task tree, not git |
| Card d-661bf338 | three layers: hippo = knowledge inside one project; mnemos = cross-project aggregation; personal preferences = a user-level store (Claude memory stays there) |
| Parent §2.6 | BACKLOG.md, handoffs and ADR files are imported idempotently; old numbers are kept as provenance; the old files stay readable until the operator retires them |
| Parent §8 | hippo v1 runs in autopilot and fleet first; other repos only after KR2 holds and a week passes with no data problem |
| g1 disposition 0ed6829d | import is idempotent on (source, locator) provenance; old numbers are provenance only; import runs twice |
| g1 dispositions d7e2ef26, 2b584dd9 | D3 needs P1.2 + F1 + F2 |
| g1 disposition af4b57ef | A1-A5 carry a size and a checkable acceptance |
| g2 disposition e0f75a28 | A3 + A4 -> A5: the ON/OFF evaluation gates shipping the changed skills |
| g1 faf96399, g2 a695030a, f120c463 | the hook refuses shell writes under `.hippo/` as well as Edit/Write; every `hippo` command self-installs guards; a hand-written op line is caught by the per-clone write journal at pre-commit; the index lives under the ignored `.hippo/.cache/` |

### What hippo has delivered and what A3 may rely on

Read from the hippo repo `develop` (`docs/spec.md` §15.1, `docs/evidence/p1.2/decisions.md` D1-D22, the
`hippo --help` of a P1.2 build):

| hippo phase | State | Used by A3 |
|---|---|---|
| P1.1 spec, `bench/kr1-queries.md` | delivered | record kinds, fields, relations, KR1 queries |
| P1.2 core + CLI | delivered (merge `2ca80c1`) | `new set edit link unlink relink close resolve show list search related check report export import`, `--json` (`hippo/1`), `-C <dir>`; self-installing git guards (D3: only where `.hippo/repo.toml` exists or is being created); hook scripts that warn and exit 0 when `hippo` is not on `PATH` (D4); harness hooks `hippo hook claude-pretooluse` / `codex-pretooluse` (D16, D21) |
| P1.3 merge bench (KR2) | not delivered | **dependency of A3.7 (cutover)**: the autopilot backlog does not move onto a store whose merge safety is unmeasured |
| P1.4 importers tuned + KR1 evidence | not delivered | **dependency of A3.3 and A3.6**: the P1.2 importer maps only `Origin` to a tag (D14). It has no `reporter:`, `effort:` or `trigger:` tag, no handoff `area`, no `relates_to` edges for `BL-`/`ADR-` mentions, and no sidecar body. `--from handoff <dir>` imports every `.md` in the directory, not only `HANDOFF*.md` (`cmd_import.rs` `md_files`). KR1 Q1, Q2, Q4, Q5, Q7 and Q10 need the P1.4 mapping |
| codex hook payload (D16, D20) | open in hippo | the codex PreToolUse snippet is not verified against a live codex run; for codex sessions the pre-commit journal and `body_sha` checks are the authority (D21) |
| native Windows test run | open in hippo | cross-built only (`make windows-build`); see §4 A3.7 and §6 |

Fleet side (D2), delivered and rolled out (fleet release `5e594f2`, F2 + F3): `fleet task open <title...>
[--parent <id>] [--pid <pid>] [--hippo <ref>]`, `fleet task update <id> <progress...>`, `fleet task close <id>
[--note <text>]`, `fleet task show|list`, `fleet tasks --mine --tree`. The courier attributes the task to the
caller's seat from the caller's pids, so a shell command from inside a session needs no identity argument.

Autopilot side: A1 (events contract, `autopilot status events`) is not delivered; no `autopilot.events/1` emitter
exists on `develop`.

## 1. Problem

The user goal is that any agent, on any machine, finds and records project knowledge cheaply and safely. The
markdown files are only today's means. Concretely:

1. **Writers edit files by hand.** Every skill that defers work, records a decision or a lesson, or hands off,
   tells the model to edit `docs/BACKLOG.md`, a `docs/backlog/` sidecar, an ADR file, a knowledge file or a
   `HANDOFF.md` (inventory in §3.1). Hand edits are where number collisions, lost rows and prose-only relations
   come from.
2. **Readers grep.** `/next`, handoff resume, `learn`'s dedup and the review skills find things with `grep` and
   `sed` over the same files, and that cost grows with the file (the KR1 baseline).
3. **The handoff mixes three lifetimes.** Who holds the work and how far it got (minutes), what was decided and
   which pitfalls were hit (months), and the next command (one session) all sit in one file that is deleted on
   resume.
4. **There is no defined behaviour for a repo or host without hippo.** Consumer repos have no store, a host can
   lack the binary, and Windows is first-class. Without a decided fallback, a writer either fails silently or edits
   the old file and splits the source of truth.

## 2. OKR / KRs

**Objective**: every autopilot writer records through one command that writes hippo records where a store
exists and degrades loudly where it does not; every skill reads through `hippo search/related/show/list`.

| KR | Threshold | Verified by |
|---|---|---|
| KR-A3.1 no hand-edit text | `node scripts/check-hippo-writer-text.js` exits 0 on the shipped tree. Its allowlist holds only read or history mentions, each with a reason. Its negative control (a fixture line "add it to docs/BACKLOG.md") exits 1, and reverting any one migrated line of §3.1 turns it red | `hooks/tests/check-hippo-writer-text.test.sh` transcript + red-check transcript in `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` |
| KR-A3.2 KR1 through the skills | On a scratch copy of the imported autopilot repo, each of the 10 frozen KR1 queries (hippo repo `bench/kr1-queries.md`) is asked of a headless session with the A3 plugin. All 10 answers pass that file's "Answer contains" check. In 10 of 10 transcripts the answer came through `hippo` commands, and no command read `docs/BACKLOG.md`, `docs/backlog/` or `docs/adr/` | `scripts/check-kr1-skill-route.js` output + transcripts, same evidence dir |
| KR-A3.3 idempotent import | Second run of the three imports appends nothing (`git status --porcelain -- .hippo` empty after run 2); every imported record carries `provenance {kind, value, locator}` with the old `BL-`/`ADR-` number as `value`; `hippo check` exits 0 or lists only problems also listed in the P1.4 evidence | import transcript, same evidence dir |
| KR-A3.4 degrade, never silent | All four store states (§3.3) behave as specified: files mode prints its one info line; spool mode prints a warning naming the spool count; `session-start` repeats the warning while the spool is non-empty; flush replays each spooled write exactly once (red-checked) | `hooks/tests/project-record.test.sh` |
| KR-A3.5 no counters in git | No A3 code path writes a usage count into hippo or any tracked file. `project-record.js` has a closed field list (a test refuses an unknown field), and read commands leave `git status --porcelain` unchanged | `hooks/tests/project-record.test.sh` |
| KR-A3.6 ON/OFF before ship | Changed skills ship only with A5's report showing ON >= OFF on its suite for each ship unit (§4 A3.7) | A5 evidence (autopilot `evals/skill-onoff/results/`), cited in the A3.7 merge message |

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No hosted CI: never add `.github/workflows` in any repo of this plan.
- In fleet, run courier tests only via `make courier-test` (never bare `cargo test`); every new test uses a sandbox HOME or explicit tempdir and touches no process-global state.
- No host names, LAN addresses or home paths in commits, docs or code of fleet and hippo; hosts and paths come from env or config.
- Plugins talk only to their local courier; only couriers talk to the hub; no plugin carries a hub URL.
- Wire shapes come from generated contracts (`contracts/` → `gen/`); the hub contract changes once, in phase F1, for all later phases.
- Liveness and task state are observed by the courier (pid, member state, lock, heartbeat), never taken from a model's own claim.
- hippo stores records as plain files on normal git branches; no custom refs, no git notes, no binary database in git.
- hippo ids are ULIDs on disk; short prefixes are display-only; never sequential ids.
- hippo never stores secrets or credentials; it stores where to obtain them. hippo does no embeddings or semantic search (mnemos does).
- A model never writes hippo record files directly; all writes go through the `hippo` CLI; `hippo check` runs on read, after merge and before commit, and names the offending file on failure.
- Signature verification is done by software (hangar verifier), never by a model; no private signing key is reachable by any agent process.
- A valid signature never authorizes a production target in this plan; production stays denied.
- `fleet approve` stays a human tty gate; no model runs it.
- Credentials move by 0600 file, never via chat, fleet message or a model's view.

Plan-local constraints (A3; also copied verbatim into every A3 dispatch):

- autopilot code writes hippo records only by running the `hippo` binary with an argv array (no shell string); it never opens, appends to or renames a file under `.hippo/`.
- Skill, reference, agent and config-template text never tells a model to edit `docs/BACKLOG.md`, `docs/backlog/*`, an ADR file, a `HANDOFF*.md` or a knowledge file; it names `scripts/project-record.js` for writes and `hippo search|related|show|list` for reads.
- autopilot never creates a hippo store implicitly: `project-record.js` writes through hippo only where `.hippo/repo.toml` already exists; creating a store is the explicit import of phase A3.3/A3.7.
- Usage counters (how often a record was read, cited or picked) never go to git or to a hippo field; they go to A1 events or the hub.
- Mechanism and guidance are separate commits; a mechanism commit does not edit requirement text (autopilot `CLAUDE.md` "機制 vs 指引").
- Every new or changed check ships with a negative control shown red before green (`references/evidence-discipline.md` §58).
- Node >= 20.10, built-ins only, no new npm dependency.
- Tests run under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos; they never touch this checkout's `.hippo/` or the operator's hippo config.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`.
  - Consumer repos without a hippo store keep their exact behaviour: `project-record.js` in files mode writes
    the same schema-valid BACKLOG row, ADR file, knowledge entry or `HANDOFF.md` the skills describe today
    (`references/backlog-entry.md` stays the files-mode schema).
  - The autopilot repo moves to hippo in one ship (A3.7). After it, `docs/BACKLOG.md`, `docs/backlog/`,
    `docs/adr/` and the handoff files stay readable and frozen. A change to them is refused by
    `check-backlog-entries.js` (`backlog_frozen`) and by the text gate, and the refusal names the
    `project-record.js` command to use instead.
  - Scripts that read the backlog (`next-pick.js`, `check-plan-graduation.js`, `admit-backlog-follow-ups.js`,
    `check-backlog-entries.js`) gain a hippo mode chosen by the same store detection; their files-mode output
    is unchanged (existing suites stay green).
  - Version: PATCH (new scripts, a new hook, skill body edits; no skill added or removed, no `description:`
    change that shifts routing).
- **Dependency decision**: `existing`. hippo is this plan's sibling deliverable (D1, `custom` per the parent
  plan); fleet task commands are delivered (F2). Inside autopilot: Node built-ins only. A library wrapper around
  hippo was considered and rejected: the CLI with `--json` is hippo's published interface (spec §16), and
  linking its crates would bypass the write journal.

## 3. File-structure map

| Path (autopilot repo) | Responsibility | Phase |
|---|---|---|
| `scripts/lib/hippo.js` (new) | store detection (§3.3), run `hippo` by argv with `-C <repo>` and `--json`, parse `hippo/1`, spool read/write/flush | A3.1 |
| `scripts/project-record.js` (new) | the one writer: `backlog new|reply|close`, `decision new|supersede`, `adr new|supersede`, `lesson new`, `handoff new|close`, `where`, `flush`; hippo mode and files mode | A3.1 |
| `scripts/check-hippo-writer-text.js` (new) + `scripts/hippo-writer-text-allowlist.json` (new) | text gate over `skills/ references/ agents/ project-config-template/`; allowlist may only shrink | A3.2 |
| `scripts/check-kr1-skill-route.js` (new) | scores KR1-through-skills transcripts: answer check and route check | A3.6 |
| `hooks/hippo-edit-guard.js` (new, default-on) + `hooks/hooks.json`, `hooks/README.md` | PreToolUse: delegates to `hippo hook claude-pretooluse` when the binary is present; else refuses Edit/Write/MultiEdit/NotebookEdit under `.hippo/` itself and warns | A3.4 |
| `hooks/session-start.js` | one warning line while the spool is non-empty or the store is unreadable | A3.4 |
| `scripts/check-backlog-entries.js` | `--hippo` mode over `hippo export --json` (same field rules, peer rules); `backlog_frozen` code | A3.4 |
| `scripts/admit-backlog-follow-ups.js`, `scripts/check-plan-graduation.js` (`--fix`), `scripts/next-pick.js`, `scripts/migrate-backlog-entries.js`, `scripts/decision-ledger.js` | hippo mode via `project-record.js`/`lib/hippo.js`; migrate refuses in hippo mode; a ledger `decision` row with `reversibility: one-way` also files a hippo `decision` | A3.4 |
| `scripts/resolve-project-paths.sh`, `scripts/resolve-knowledge-routing.sh`, `scripts/project-detect.js` | new field `record_store` (`hippo` / `files` / `spool`) from `lib/hippo.js detect`; existing fields unchanged | A3.1 |
| `references/project-memory.md` (new) | reader contract: `hippo search/related/show/list` recipes (the KR1 shapes), "never edit `.hippo/`", what each store state means for a reader | A3.5 |
| `references/backlog-entry.md` | adds the hippo mapping table (§3.2); the files-mode schema stays | A3.5 |
| `references/knowledge-routing.md` | sinks: backlog and lesson destinations go through `project-record.js` | A3.5 |
| skills and references in §3.1 | writer text -> `project-record.js`; reader text -> hippo | A3.5 |
| `.githooks/pre-commit`, `.githooks/pre-merge-commit`, `.githooks/post-merge` | one chain line each: run `hippo hook <name> \|\| exit $?` when `hippo` is on `PATH`, else warn (D22 foreign-hook policy) | A3.7 |
| `.hippo/` (new, created by import), `.gitattributes`, `.gitignore` | the store; guards installed by hippo itself | A3.7 |
| `docs/BACKLOG.md`, `docs/adr/*.md`, handoff files | one frozen-notice line at the top; content untouched | A3.7 |
| `docs/scripts-inventory.md`, `CLAUDE.md` grouped list, `docs/projects/INDEX.md`, `CHANGELOG.md` | wiring of the new scripts and hook (CLAUDE.md "When adding a new script") | A3.1, A3.2, A3.4, A3.6 |
| `hooks/tests/project-record.test.sh`, `hooks/tests/check-hippo-writer-text.test.sh`, `hooks/tests/hippo-edit-guard.test.sh`, `hooks/tests/backlog-hippo-mode.test.sh`, `hooks/tests/check-kr1-skill-route.test.sh` (new) | tests; each needs `HIPPO_BIN` (a built hippo) and prints `SKIPPED: HIPPO_BIN unset` otherwise; acceptance requires a run with it | per phase |
| `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` | transcripts | all |

### 3.1 Writer and reader inventory (the starting red set of the text gate)

Found by `grep -rnE 'BACKLOG|[Bb]acklog|docs/adr|ADR\.md|HANDOFF|knowledge/'` over `skills/ references/
agents/ project-config-template/` at `origin/develop` `94150b6b9`; A3.2's first gate run must reproduce this list
(a difference is reported and resolved before A3.5).

| # | Writer (file:line) | Today | hippo command (through `project-record.js`) · kind · fields |
|---|---|---|---|
| W1 | `references/backlog-entry.md` (whole) | the row schema, "write one row" | `backlog new` -> `hippo new issue` · see §3.2 |
| W2 | `skills/quality-pipeline/SKILL.md:35, :163, :168` | deferred -> one backlog row, then `check-backlog-entries.js` | `backlog new …`; the gate runs inside `project-record.js` |
| W3 | `skills/quality-pipeline/references/code-review.md:153, :319, :333-335, :350` | follow-up -> one row; "add to docs/BACKLOG.md with trigger" | `backlog new --trigger …` |
| W4 | `skills/quality-pipeline/references/test-policy.md:111, :137` | "open backlog", "record in backlog" | `backlog new` |
| W5 | `skills/quality-pipeline/_base/prohibited-behaviors.md:20, :28` | "a BACKLOG entry + trigger" | wording -> "a backlog record (`project-record.js backlog new`) with a trigger" |
| W6 | `skills/dev-flow/SKILL.md:336-338` | deferral = one backlog row | `backlog new` |
| W7 | `skills/finish-flow/SKILL.md:123-126` | deferred rows; "delete that row"; triggered BACKLOG pickup | `backlog new`; `backlog close <id> done --commit <sha>` (-> `hippo close` + `hippo link … implemented_by git:<sha>`); pickup reads `hippo list --kind issue --status open --tag trigger:ready` |
| W8 | `skills/project-lifecycle/references/project-archive.md:11, :13, :18-19, :27, :60` | archive needs rows in BACKLOG.md; "delete completed items" | `backlog new` for remaining phases; `backlog close` for completed |
| W9 | `skills/project-lifecycle/references/templates.md:28-40, :78-80`; `project-structure.md:7, :34, :38-45, :110, :122` | ADR.md and BACKLOG.md templates | `adr new` -> `hippo new adr`; BACKLOG.md template kept for files mode only, labelled so |
| W10 | `skills/next/references/phase0-hygiene.md:59` | "add it to docs/BACKLOG.md" | `backlog new` |
| W11 | `skills/doc-sync/SKILL.md:128, :148` | "open a BACKLOG item" | `backlog new` |
| W12 | `skills/ceo-agent/references/decision-matrix.md:19` | "record a revisit trigger in the project backlog" | `backlog new --trigger-type event` |
| W13 | `skills/ceo-agent/references/depth0-control-loop.md:458, :517-519` | findings -> BACKLOG via `admit-backlog-follow-ups.js` | the script gains hippo mode (A3.4); text unchanged except the destination word |
| W14 | `skills/l5/references/hetero-impl-loop.md:280` | "any BACKLOG row this campaign's plan supersedes is deleted" | `backlog close <id> superseded --by <plan path>` |
| W15 | `skills/handoff/SKILL.md` steps 2, 3, 3.5, Resume 1 and 5 | writes/replaces `HANDOFF.md`, routes durable parts, deletes on resume | §4 A3.5 handoff split |
| W16 | `skills/learn/SKILL.md` Flow 0-5, health audit | appends to `.claude/knowledge/<cat>.md` + INDEX, `git add -f` | `lesson new` -> `hippo new lesson --area <cat>`; memory_dir and discipline_target routes unchanged |
| W17 | `references/knowledge-routing.md:98-101, :123` | `backlog_path` sink = a row | sink = `project-record.js backlog new` |
| W18 | `references/acceptance-patterns.md:79`, `references/probe-playbook.md:120` | "record + BACKLOG with trigger" | `backlog new` |
| W19 | `project-config-template/doc-drift-config.md:67`, `dev-flow-config.md:21, :52-55`, `next-config.md:7`, `project-lifecycle-config.md:8`, `knowledge-routing-config.md:16, :26`, `backlog-config.md` | backlog path knobs | keep the knobs (files mode); add one line: "with a hippo store the backlog is the store; this path is read-only provenance" |
| W20 | `skills/dev-flow/SKILL.md:44-48` + `scripts/decision-ledger.js` | owner-proxy decision -> ledger row (git-common-dir, untracked telemetry) | ledger unchanged (A1 event source); `reversibility: one-way` rows also `decision new` -> `hippo new decision` (mechanism in A3.4) |
| W21 | `skills/think-tank/SKILL.md`, `skills/think-tank-dialectic/SKILL.md` (Decision Brief) | verdict lives in chat only | once the user accepts the recommendation: `decision new --title <question -> choice> --rationale-file -` |

Readers to move to hippo: `skills/next/SKILL.md:33, :52, :60, :68-73, :91, :123, :131`;
`skills/handoff/SKILL.md` Resume; `skills/learn/SKILL.md` Flow 1 (dedup `grep -ri`); `skills/l5/references/
hetero-impl-loop.md:297` (BL-0285 citation by path -> `hippo search BL-0285`); `scripts/next-pick.js`;
`scripts/check-plan-graduation.js`. Read-only mentions that stay and go to the allowlist with a reason: ADR-0001 /
ADR-0002 citations by path (the old files stay readable), `references/reviewer-mvp-portfolio.md:91` ("never a
direct write"), `skills/hetero-review/references/plan-loop.md:43` (context-file deny list), historical incident
text in `references/evidence-discipline.md`, `references/qualification-defaults.md:34`.

Out of the inventory: `hooks/session-handoff.js` / `session-start.js` machine snapshot on `/clear` (ephemeral,
under the user's state dir, never git); `open-decision.js` cards (live owner questions; their signed answers are
A4/F4).

### 3.2 Backlog record mapping (one table for `project-record.js` and the P1.4 importer)

| Backlog field | hippo |
|---|---|
| Title | `--title` |
| Status `open` / `fired <date>` | status `open` (a `fired` line stays in the body) |
| Status `shipped <ver> <date>` / `dropped <date>` | `hippo close <id> done` (+ `link implemented_by git:<sha>` when a sha is known) / `hippo close <id> cancelled` |
| Id `BL-NNNN` | provenance only, imported rows: `{kind: autopilot-backlog, value: BL-NNNN, locator: <backlog path>#BL-NNNN}`; new records get no number (ULID; display suffix) |
| Origin, Reporter, Effort, Trigger-Type | tags `origin:<v>`, `reporter:<first word, lower>`, `effort:<xs..xl>` (urgent suffix -> tag `urgent`), `trigger:<owner\|event\|ready\|peer\|date-YYYY-MM-DD>` |
| type | `--type` from the caller (`bug feature debt question chore`; default `debt`) |
| Since | `created` (import: source date; new: now) |
| Problem, Impact, Trigger, Source, Pointer, Context, Report, Reply | body, one `- **Field**: value` bullet each, the same shape the importer writes, so `search` and `show` read alike |
| Report (fleet message) | body bullet with the message id; plus `hippo link <id> reported_by fleet:<ns>/<courier>/<member>#<msg>` when the leak guard accepts the address (§8 Q1) |
| Pointer to a plan / project file | body bullet; plus `relates_to` to the plan's hippo record once plans are records (not in A3) |
| a `BL-`/`ADR-` mention | `relates_to` edge (importer: P1.4; `project-record.js`: `--relates <id>`, repeatable) |

The peer rules of `references/backlog-entry.md` carry over as checks over the records: an `origin:peer`
record needs a `reporter:` tag and a Report bullet; closing one whose Reply bullet is `none`/`unknown` is refused
by `project-record.js backlog close` and reported as `peer_closed_unanswered` by `check-backlog-entries.js
--hippo` on pre-push (a bare `hippo close` cannot dodge it). Record deletion does not exist in hippo (ops are
append-only; `hippo doctor --restore-ops` restores dropped lines), so `peer_report_lost` has no hippo analogue.

### 3.3 Store states and the fallback (decided)

`lib/hippo.js detect --target <repo>` returns one state per repo. `<repo>` is the git top level of `--target`,
or of the working directory when `--target` is absent. It is never the plugin's own install directory
(same rule as `resolve-project-paths.sh` tiers 2-4).

| State | Condition | Writers (`project-record.js`) | Readers |
|---|---|---|---|
| `files` | no `.hippo/repo.toml` | today's file formats, mechanically (BACKLOG row with next-id, ADR file from the template, knowledge entry, `HANDOFF.md`); one stderr info line `record store: files (no .hippo store in <repo>)` | today's files |
| `hippo` | store present, `hippo --json check` runs (exit 0 or 3) | hippo commands of §3.1/§3.2 | `hippo list/search/related/show` |
| `spool` | store present, binary missing, or exit 5 (`environment`: unsupported format, lock timeout, no actor) | the write is saved as one JSON file under `<git common dir>/autopilot/hippo-spool/<ulid>.json` (per clone, never committed, survives worktree removal); exit 0 with stderr `WARNING record store degraded: <reason>; <n> write(s) spooled; run project-record.js flush once hippo works` | stderr warning; the frozen files may be read and every answer is labelled `stale since <import commit>` |
| `refused` | hippo exit 2/3/4 on the write itself (usage, rule incl. `leak`, not found) | no spool: the error, its `hint` and the rule name are printed and `project-record.js` exits with hippo's code | — |

Why spool and not "fail" or "edit the old file": the parent plan's design principle 2 says to degrade and warn
between our own components and to fail closed only on credentials, cert pins and `_access`. A missing hippo is
one of our own components, so failing outright would lose a lesson or a deferred item at the moment the session
is closing. Editing the frozen file would split the source of truth. The spool keeps the write, and its warning
is repeated by `session-start` until a flush. Every `project-record.js` run in state `hippo` flushes first, so the
correct path needs no choice. Idempotency: every write carries a tag `key:<16 hex>` (from the spool id, or the
follow-up fingerprint for `admit-backlog-follow-ups.js`), set inside the same `hippo new` call. Before creating a
record, flush checks `hippo list --tag key:<k> --history --json` for that key, so a crash between the write and
the spool-file removal never duplicates.

Multi-repo consumers: one store per repo. A session writing for another repo passes `--target <dir>` explicitly.
`project-record.js` never writes to a repo other than the working directory's top level without it. Cross-repo
relations use hippo's `<repo-id>:<ULID>` targets, resolved through the user's `$HIPPO_CONFIG_DIR/repos.toml`; an
unresolvable target shows as `unresolved` and is never dropped (spec §14). A3 creates a store only in the
autopilot repo. Other repos adopt by running the A3.3 import themselves (parent §8: fleet next; the rest after
KR2 plus a week).

Windows: `lib/hippo.js` uses `child_process.execFileSync('hippo', argv)` with no shell; libuv's PATH search finds
`hippo.exe`. Paths come from `git rev-parse` and are joined with `path`, never with `/`. hippo's git hooks run
under Git for Windows' bundled shell (spec §13.1). Until hippo's native Windows run exists, a Windows host whose
`hippo.exe` fails with exit 5 or does not start lands in `spool`, which is loud and loses nothing.

## 4. Phases

Dependencies (an arrow = "consumes an output of"):

```
hippo P1.2 (delivered) + fleet F1/F2 (delivered) -> A3.1 -> A3.2
A3.1 -> A3.4
hippo P1.4 + A3.1 -> A3.3 (rehearsal on a scratch copy)
A3.2 + A3.4 -> A3.5 (guidance; branch held, not merged)
A3.3 + A3.5 -> A3.6 (KR1 through the skills)
A3.5 + A3.6 + A4 -> A5 (separate plan) ; A5 verdict + hippo P1.3 (KR2) -> A3.7 (ship + cutover)
```

A3.1, A3.2 and A3.4 are mechanism: inert in the autopilot repo until a store exists (state `files`), mergeable
to `develop` on their own after review. A3.5 is guidance and waits for A5. A3.7 merges guidance, the import and
the freeze together, so no session ever runs old skill text against a frozen backlog.

### A3.1 — `lib/hippo.js` + `project-record.js` (M)

Steps:
1. `scripts/lib/hippo.js`: `detect(repo)` -> `{state, reason, repo_root, store_id, hippo_version}`; `run(repo,
   argv)` -> parsed `hippo/1` document (always `--json`, `-C <repo>`; non-JSON stdout is exit 1 `internal`);
   `spool.write/list/flush`. CLI: `node scripts/lib/hippo.js detect --target <dir> [--json]`.
2. `scripts/project-record.js` subcommands and the hippo commands they issue:
   - `backlog new --title <t> --trigger <s> --trigger-type <tt> --effort <e> --origin <o> --source <s>
     [--type <ty>] [--reporter <r> --report <msg> --reply <r>] [--problem-file <f>|-] [--impact <s>] [--pointer
     <p>] [--relates <id>]… [--key <k>]` -> `hippo new issue --title … --status open --tag origin:… --tag effort:…
     --tag trigger:… [--tag reporter:…] --tag key:<k> --body-file -`, then `hippo link <id> relates_to <t>` per
     `--relates`, then `hippo link <id> reported_by fleet:…` when given.
   - `backlog reply <id> --reply <date> <ptr>` -> `hippo edit <id> --body-file -` (body re-rendered with the new
     Reply bullet from `hippo show <id> --json`).
   - `backlog close <id> done|cancelled|superseded [--commit <sha>] [--by <ref>]` -> peer check, then `hippo
     close <id> <status>` and `hippo link <id> implemented_by git:<sha>` / `relates_to <ref>`.
   - `decision new --title <t> --rationale-file <f>|- [--area <a>] [--relates <id>]… [--decides <id>]…` ->
     `hippo new decision --status active …`, `hippo link <issue> decided_by <decision>` per `--decides`.
   - `decision supersede <old> --title …` and `adr supersede <old> …` -> `hippo new …`, `hippo link <new>
     supersedes <old>`, `hippo close <old> superseded`.
   - `adr new --title <t> --body-file <f>|- [--status active|open]` -> `hippo new adr …`.
   - `lesson new --title <t> --category build|debug|arch|env|api --body-file <f>|-` -> `hippo new lesson --area
     <category> --body-file -`.
   - `handoff new --title <t> --area <project> --body-file <f>|- [--decision-file <f>]… [--lesson-file <f>]…` ->
     `hippo new handoff-note --area <project> --status open`, then one `decision new` / `lesson new` per file, each
     linked `relates_to` the note.
   - `handoff close <id>` -> `hippo close <id> done`. `where` prints the §3.3 state. `flush` replays the spool.
   - The field list is closed. An unknown flag exits 2. There is no count, hits, uses or views field
     (KR-A3.5).
   - Files mode: the same subcommands write today's formats (`backlog new` appends a heading row using the
     `<!-- next-id -->` mark and runs `check-backlog-entries.js --backlog <file>`; `adr new` writes
     `docs/adr/NNNN-<slug>.md` from the template; `lesson new` appends to the knowledge file and INDEX; `handoff
     new` writes `HANDOFF.md`). Paths come from `resolve-project-paths.sh` / `resolve-knowledge-routing.sh`, never
     literals.
3. `resolve-project-paths.sh`, `resolve-knowledge-routing.sh`, `project-detect.js`: add `record_store` from
   `lib/hippo.js detect`.
4. Wiring per CLAUDE.md "When adding a new script" (inventory row, grouped list, reference, SKILL table rows land
   in A3.5).

Acceptance (`hooks/tests/project-record.test.sh`, `HIPPO_BIN` set, sandbox HOME/`HIPPO_CONFIG_DIR`, temp repos):
- each subcommand in hippo mode produces the records/edges above (`hippo show --json` assertions) and `hippo
  check` exits 0;
- **parity**: a fixture BACKLOG row imported with `hippo import --from autopilot-backlog` into repo X and the same
  row written by `project-record.js backlog new` into repo Y give equal `show --json` records except `id`,
  `created`, `updated`, `provenance` and the `key:` tag (needs the P1.4 importer; until P1.4 merges this case
  prints `SKIPPED: P1.4 mapping` and A3.7 cannot start);
- the four §3.3 states, each red-checked: removing the state check from `detect` turns its case red;
- spool: two writes with the binary hidden (`PATH` without hippo) -> 2 spool files + warning; restore `PATH`,
  run once -> 2 records, 0 spool files; kill between create and spool removal (fault-injection env
  `PROJECT_RECORD_FAULT=after-create`) -> rerun creates nothing new (key tag found);
- `--target` of another repo is refused without the flag; the plugin's own dir is refused as target;
- read commands and `where` leave `git status --porcelain` unchanged; an unknown field exits 2;
- files mode output byte-equal to the current skill-described formats (golden files) and passes
  `check-backlog-entries.js`.
Verify: `bash hooks/tests/project-record.test.sh` and `node scripts/affected-suites.js --run --files
scripts/lib/hippo.js,scripts/project-record.js,scripts/resolve-project-paths.sh,scripts/resolve-knowledge-routing.sh,scripts/project-detect.js`.

### A3.2 — text gate (S)

Steps: `scripts/check-hippo-writer-text.js [--root <dir>] [--json] [--allowlist <file>]` scans `skills/**/*.md`,
`references/**/*.md`, `agents/**/*.md`, `project-config-template/**/*.md`. A line is a finding when an
imperative write verb (`add|append|write|record|open|file|create|edit|update|delete|move|register`) and a target
(`BACKLOG(\.md)?|docs/backlog/|backlog (row|entry|item)|docs/adr|ADR(\.md| file)|HANDOFF(\.md)?|\.claude/knowledge/|
knowledge file`) appear within 80 characters, or when a line names `hippo set` with a counter-like tag or field
(`count|hits|uses|views`). Allowlist entries are `{path, line_sha256, reason}` and may only be removed
(`--update-allowlist` refuses additions; same ratchet as `check-backlog-entries.js`). Wire into
`scripts/validate.sh`.
Acceptance (`hooks/tests/check-hippo-writer-text.test.sh`): negative-control fixture lines (one per target) exit 1
and name file:line; a clean fixture exits 0; an allowlist addition is refused; on the current tree it reports the
§3.1 set (expected red; the report is saved as `gate-baseline.txt`).
Verify: `bash hooks/tests/check-hippo-writer-text.test.sh`; `node scripts/check-hippo-writer-text.js --json >
docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/gate-baseline.json` (exit 1 expected here).

### A3.3 — import rehearsal on a scratch copy (S, needs hippo P1.4)

Who runs it: the autopilot depth-0 session, on a scratch clone in a tempdir (never this checkout). Steps:
1. `git clone <autopilot> <tmp>/ap && cd <tmp>/ap`; `printf 'format = 1\nid = "autopilot"\nvisibility = "public"\n' > .hippo/repo.toml`.
   This is the only file under `.hippo/` a human may write by hand (spec §2.1), and here it is a script step,
   not a model edit. The autopilot repo is public, so its records are `public`.
2. `hippo import --from autopilot-backlog docs/BACKLOG.md`; `hippo import --from adr-dir docs/adr`; `hippo import
   --from handoff docs` and `hippo import --from handoff docs/projects/<p>` per project with a handoff (P1.4
   filters `HANDOFF*.md` and sets `area`). Paths come from `resolve-project-paths.sh` / `scripts/lib/repo-layout.js
   path` so the 3.0.0 relayout (backlog under `project/`) needs no plan change.
3. Commit, then run the three imports again: `git status --porcelain -- .hippo` must be empty.
4. `hippo check`; `hippo list --kind issue --status open --limit 500 | wc -l` equals the open-row count from
   `check-backlog-entries.js --json`; spot-check five `BL-` numbers with `hippo search BL-NNNN`.
5. Leak refusals (items skipped with a pattern id) are listed; each one gets an owner decision in A3.7 (fix the
   source text, or leave the item only in the frozen file).
Acceptance: KR-A3.3 on the scratch copy; the transcript and skipped-item list are saved in the evidence dir.

### A3.4 — scripts and hook in hippo mode (M)

Steps:
1. `check-backlog-entries.js --hippo [--target <dir>]`: rules of `references/backlog-entry.md` over `hippo export
   --json` (required tags/bullets, caps on body bullets, `bad_trigger_type`, peer rules incl.
   `peer_closed_unanswered`); new code `backlog_frozen` (block) for any diff that changes the frozen backlog
   file or adds a sidecar once a store exists; `.githooks/pre-push` passes `--hippo` when `detect` says `hippo`.
2. `admit-backlog-follow-ups.js`: in hippo mode admits through `project-record.js backlog new --key
   <fingerprint16>` (dedup by `key:` tag instead of row text).
3. `check-plan-graduation.js --fix`: in hippo mode a row with a shipped plan becomes `project-record.js backlog
   close <id> done --by <plan path>` (peer rule kept); no file edit.
4. `next-pick.js`: reads `hippo list --kind issue --status open --json --limit 1000` and maps tags back to
   Effort/Trigger-Type; `backlog_digest` is the SHA-256 of that JSON's `data`.
5. `migrate-backlog-entries.js`: exits 2 in hippo mode with "the backlog is a hippo store; nothing to migrate".
6. `decision-ledger.js append --kind decision` with `reversibility: one-way`: after the ledger row, runs
   `project-record.js decision new` (ledger row id in the body); failure of that call warns and never fails the
   ledger append.
7. `hooks/hippo-edit-guard.js` (PreToolUse, default-on, matcher `Edit|MultiEdit|Write|NotebookEdit|Bash`): when
   `hippo` is on `PATH`, pipe the payload to `hippo hook claude-pretooluse` and return its verdict. Otherwise
   refuse Edit/Write/MultiEdit/NotebookEdit whose path has a `.hippo` component, and print one warning per
   session that the shell check is off. Codex: `scripts/sync-codex-plugin-skills.sh` documents hippo's
   `harness/codex/hooks.toml`; it stays unverified (hippo D16/D20), and pre-commit remains the authority (D21).
8. `hooks/session-start.js`: one warning line when `detect` is `spool` (count) or the store is unreadable.
Acceptance (`hooks/tests/backlog-hippo-mode.test.sh`, `hooks/tests/hippo-edit-guard.test.sh`, existing suites):
each step has a case in hippo mode and a files-mode case whose output is unchanged; negative controls: a bare
`hippo close` on an unanswered peer record -> pre-push `peer_closed_unanswered`; an edit to the frozen file ->
`backlog_frozen`; an Edit tool call on `.hippo/ops/x.jsonl` with and without `hippo` on `PATH` -> refused; a Bash
`echo >> .hippo/ops/x.jsonl` with hippo present -> refused. Each red-checked by reverting its hunk. Hook inventory
and counts updated (`scripts/check-hook-inventory.js`, `sync-version.js --hook-count`).
Verify: `node scripts/affected-suites.js --run --files <every file of this phase>`; `node
scripts/check-hook-inventory.js`.

### A3.5 — skill and reference text (L, guidance; held for A5)

Steps (one commit per ship unit, §A3.7; every W-row of §3.1 changes):
1. `references/project-memory.md` (new): reads go through `hippo list/search/related/show` (recipes = the KR1
   shapes: by tag, by text, by old number, by relation, latest handoff by `created`). It says "never edit, cat >,
   sed -i or git checkout files under `.hippo/`; a repair is a hippo command (`hippo resolve`, `hippo relink`,
   `hippo doctor --restore-ops`)" and gives what each §3.3 state means for a reader.
2. Backlog unit: W1-W14, W17-W19 -> `project-record.js backlog …`; `/next` (readers list) -> `hippo list --kind
   issue --status open --tag …` / `--ready`; `references/backlog-entry.md` gains §3.2 as its hippo section.
3. ADR/decision unit: W9 (ADR), W20 (dev-flow text names the one-way rule), W21 (think-tank, dialectic).
4. Lesson unit: W16. Destination question (knowledge-routing §2) unchanged. "Publishable fact or gotcha" ->
   `project-record.js lesson new`; dedup -> `hippo search <keyword> --kind lesson`. The human disclosure gate
   stays and moves before the write: draft the body to a temp file, run `node scripts/identifier-scan.js <file>`,
   ask (approve / edit / cancel), and only then run `lesson new`. The `git add -f` promotion is files mode only.
   Health audit adds `hippo check`.
5. Handoff unit (W15), the split of step 3.5:
   - holder and progress -> `fleet task open "<goal>" --hippo <note id>` (once per piece of work; the courier
     records the holder) and `fleet task update <id> "<progress: branch, last commit, done vs in-flight>"`;
   - 已決事項 -> one `decision` record each; 陷阱 -> `lesson` records (through `learn`'s gate in public repos);
     the reason for the next step + 下一步 + 驗證方式 + Read-order (repo-relative paths only: the hippo leak guard
     refuses home paths) -> the `handoff-note` body, via `project-record.js handoff new … --decision-file …
     --lesson-file …`;
   - the reply gives `hippo show <note id>` (run in the same worktree) as the paste-ready resume line plus the
     fleet task id;
   - Resume: `hippo list --kind handoff-note --area <project> --status open --fields created,title`, `hippo show
     <id>`, `fleet task show <task id>`; drift check unchanged; on completion `project-record.js handoff close
     <id>` and `fleet task close <task id>` instead of deleting a file;
   - no fleet courier (`fleet whoami` fails): holder and progress go into the note body with a warning line;
     files mode keeps today's `HANDOFF.md` flow.
6. SKILL "Available Scripts" rows for `project-record.js`; `skills/onboard/SKILL.md` names `record_store`.
Acceptance: `node scripts/check-hippo-writer-text.js` exits 0 with only the reasoned allowlist; reverting any one
W-row hunk makes it exit 1 (red-check script over all W-rows, transcript saved); `scripts/check-guidance-eval.js`
and the doc-drift gate (`node scripts/doc-drift-gate.js`) green; no `description:` line changed (`git diff
origin/develop -- 'skills/*/SKILL.md' | grep '^[-+]description'` empty).

### A3.6 — KR1 through the skills (M, needs A3.3)

Steps: `scripts/check-kr1-skill-route.js --transcripts <dir> --queries <hippo repo>/bench/kr1-queries.md
[--json]`. For each query it checks (a) that the final answer contains every required id/title of the query's
"Answer contains" list, resolved on the scratch copy by the grep arm's own commands, and (b) that the transcript
has at least one `hippo` command and no Bash/Read call whose argv or path names the backlog file, the sidecar
dir or the ADR dir. It reports tokens per query next to hippo's `docs/evidence/kr1-tokens/` baseline, for
information only. Ten headless cells (`claude -p`, the A3.5 plugin via `--plugin-dir`, cwd = the A3.3 scratch
copy, one KR1 question each, no hint about hippo in the prompt).
Acceptance: KR-A3.2. Negative control: the same cells with the pre-A3 plugin produce route failures (b) (shows
the checker can fail); `hooks/tests/check-kr1-skill-route.test.sh` with planted transcripts (grep route, missing
id) is red on each.

### A3.7 — A5 handoff, ship and cutover (M)

Inputs A5 receives from A3 (A5's own plan owns the pre-registration): ship units and the skills each changes
(backlog: next, quality-pipeline, dev-flow, finish-flow, project-lifecycle, doc-sync, ceo-agent refs, l5 refs;
ADR/decision: project-lifecycle, dev-flow, think-tank, think-tank-dialectic; lesson: learn; handoff: handoff), base
and change refs for `evals/skill-onoff/freeze-pack.js --skill <s> --ref <sha>`, and a fixture-scripts pack
(`freeze-pack.js --scripts scripts/project-record.js,scripts/lib/hippo.js`). Proposed markers: the write went
through `project-record.js`, no Edit on the frozen files, and the KR1 answer check.
Ship rule: a unit ships only when A5's report shows ON >= OFF for every skill in it. The backlog unit and the
ADR/decision unit go together with the cutover (old text would write a frozen file). The lesson and handoff
units may ship separately, or stay held if they fail, without blocking the cutover.
Cutover (needs hippo P1.3 KR2 green; one merge; operator's go, because it moves the source of truth for every
session in this repo):
1. on a branch from `origin/develop`: the A3.3 steps 1-4 in the real checkout; chain lines in `.githooks/
   pre-commit|pre-merge-commit|post-merge`:
   `if command -v hippo >/dev/null 2>&1; then hippo hook <name> || exit $?; else echo "warning: hippo not on PATH; .hippo not checked" >&2; fi`;
2. the frozen notice line at the top of `docs/BACKLOG.md` and each `docs/adr/*.md` / handoff file ("frozen at
   <commit>; the live records are in `.hippo/` — `hippo search`, `project-record.js`"), `check-backlog-entries.js`
   switched to `--hippo` + `backlog_frozen` in pre-push;
3. merge with the held guidance units; before the merge, re-run the imports once more so rows added by
   sessions merged in the meantime are picked up (idempotent). After the merge, a branch that still edits the
   frozen file is refused (`backlog_frozen` names the rows), and its author refiles them with `project-record.js
   backlog new`. Re-import after the freeze is not used, because it would overwrite record changes made in
   hippo;
4. Windows: `project-record.js where` and one `backlog new` + `flush` on a native Windows host (host from
   env/config), transcript saved; if hippo's native run is still open, the transcript shows state `spool` and the
   warning, not silence.
Rollback: `git revert -m 1 <merge>` restores the skill text, the hooks and the gates; the frozen files were never
changed beyond one line, so `docs/BACKLOG.md` is the live backlog again; records written in hippo after the
cutover are listed with `hippo list --since <cutover date>` and refiled as rows. That is a manual step, stated
in the merge message.
Acceptance: KR-A3.1..A3.6 transcripts in the evidence dir; the merge message carries the QC verdict and the A5
report path.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| writer mechanism | `bash hooks/tests/project-record.test.sh` (HIPPO_BIN set), red-check per state and per fault | script |
| text gate | `bash hooks/tests/check-hippo-writer-text.test.sh`; per-W-row revert red-check | script |
| scripts in hippo mode | `bash hooks/tests/backlog-hippo-mode.test.sh`, `bash hooks/tests/hippo-edit-guard.test.sh`, `node scripts/affected-suites.js --run --files <changed>` | script |
| full suite before each merge to develop | `bash hooks/tests/run.sh` once, alone, on one host (CLAUDE.md "Mission graph verification") | script |
| import | A3.3 transcript (KR-A3.3) | script + human read |
| KR1 through skills | A3.6 cells + `check-kr1-skill-route.js` | script |
| ON/OFF | A5 report | script (A5) |
| cutover | operator's go; Windows transcript | human-gated |

## 6. Risks + inversion

What would guarantee failure: (1) a writer that still edits the file; (2) a fallback that silently writes
nowhere or splits the source of truth; (3) old skill text running against a frozen backlog; (4) the
importer and the writer disagreeing on the mapping, so queries see only half the records; (5) shipping guidance
without evidence.

| Risk | Mitigation |
|---|---|
| A skill line still says "add to BACKLOG.md" | text gate, red-checked per W-row; allowlist only shrinks |
| A model runs bare `hippo close`/`hippo set` and skips autopilot rules (peer reply, triggers) | the rules run again on pre-push over `hippo export --json` (`check-backlog-entries.js --hippo`) |
| A model edits `.hippo/` by hand or by shell | `hippo-edit-guard.js` (delegates to hippo's hook) + hippo pre-commit journal and `body_sha` (D21 authority) |
| hippo missing on a host / Windows | `spool` state, loud warning, `session-start` reminder, flush on the next working run; never a write to the frozen file |
| Spool replay duplicates a record | `key:` tag set inside the create command; flush checks it first; fault-injection test |
| Importer and writer mappings drift | one mapping table (§3.2) referenced by both; parity test in A3.1 blocks A3.7 |
| Old skills against a frozen backlog | guidance, import and freeze ship in one merge (A3.7) |
| Concurrent sessions add rows between rehearsal and cutover | re-import before merge (idempotent); `backlog_frozen` after; no re-import after freeze |
| Re-import overwrites hippo-side edits | forbidden after the freeze (A3.7 step 3) |
| Leak guard refuses a peer `reported_by` address (courier = host name) | body keeps the message id + `reporter:` tag; the link is skipped with a warning; §8 Q1 |
| Merge safety unproven | cutover waits for hippo P1.3 (KR2) |
| `.claude/knowledge/` lessons are local and unimported | they keep working (files route for old entries); new lessons go to hippo; §8 Q2 |
| 3.0.0 relayout moves `docs/` paths | every path from `resolve-project-paths.sh` / `repo-layout.js`; `.hippo/` added to the root allowlist in the same change that creates it |
| Public repo leaks via records | `visibility = "public"`, hippo leak guard on every string, per-user `leak-guard.toml` for host names, learn's human disclosure gate before `lesson new` |
| Usage counters creep into records | closed field list + text-gate pattern; counters belong to A1 events |
| The decision ledger is double-written and drifts | the ledger stays telemetry; only `one-way` rows are filed, with the ledger row id in the body; a filing failure warns and never blocks |

## 7. Out of scope

- Plans and project tracking files (`docs/plans/`, `docs/projects/`) as hippo records; they stay files.
- Retiring the frozen files (operator's call, parent §2.6).
- Request intake, `reported_by` from fleet requests, anomaly cards, `fleet watch` (A4).
- The events contract and any usage counter (A1).
- Signed decision answers landing in the repo (F4 / A4 / C1).
- The machine snapshot handoff hook on `/clear` (ephemeral, not git).
- Importing `.claude/knowledge/` (no hippo importer source in the frozen v1 command list; §8 Q2).
- Adopting hippo in repos other than autopilot (each repo runs A3.3 itself; parent §8 order).
- Any change to hippo itself; gaps found go to the hippo repo as P1.4 inputs.

## 8. Open questions

Decided by depth-0 on 2026-11-02 (CEO mode, operator delegated; two-way decisions, recommended options taken):

1. **`reported_by` with host-named couriers**: A. A3 keeps the message id in the body and a `reporter:` tag, and skips the link with a warning; A4 asks fleet or hippo for a host-free target form.
2. **`.claude/knowledge/` lessons**: A. Existing lessons stay where they are; only new lessons go to hippo. No hippo spec change.
3. **Public release repo**: A. `.hippo/` lives only in the private dev repo; the release mirror excludes it.

No open questions remain.

## Review log

- R0 2026-11-02: author = autopilot session (claude-opus-5-5), lane `oc-a3-plan`. Inputs: parent plan (fleet repo
  `docs/plans/2026-11-01-operator-console.md` §0-§2.6, §4 D1/D3, §5, §6, review log, g1/g2 dispositions), hippo
  repo `develop` `5d30a61` (`docs/spec.md`, `docs/evidence/p1.2/decisions.md`, `bench/kr1-queries.md`, `hippo
  --help`, `cmd_import.rs`), fleet `fleet task --help` (F2), autopilot `origin/develop` `94150b6b9`.
- Rubric: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.rubric.md` (scaffolded, not yet frozen). Manifest: to be
  written before the first review generation.
