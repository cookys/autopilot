# Plan - operator console A3: autopilot writers use hippo

> Status: draft for plan review (R1, generation-1 findings folded). Owner: operator (decisions), autopilot session (author) ·
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
| store bootstrap `hippo init` | **not in hippo; new P1.4 input requested by A3** | today the first `hippo new`/`hippo import` creates `.hippo/repo.toml` itself (`ctx.rs` `init_store`) with `visibility = "internal"` and an id derived from the checkout's directory name; no command sets `id` or `visibility`, and hand-editing `repo.toml` is reserved to a human (spec §2.1). A3 needs `hippo init --id <id> --visibility public\|internal` that refuses when `repo.toml` exists. **Dependency of A3.3 and A3.7**; without it neither phase starts (no script or model writes `repo.toml`) |
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
| KR-A3.1 no hand-edit text | `node scripts/check-hippo-writer-text.js --enforce` exits 0 on the shipped tree. Its allowlist holds only read or history mentions, each with a reason; its `pending` list holds only lines of a held ship unit (§4 A3.7) and may only shrink. Its required-writer list (W20, W21 and every migrated W-row) is satisfied. Its negative controls (one fixture line per target pattern, one fixture file missing a required writer) exit 1, and reverting any one migrated W-row hunk of §3.1 turns it red | `hooks/tests/check-hippo-writer-text.test.sh` transcript + red-check transcript in `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` |
| KR-A3.2 KR1 through the skills | On a scratch copy of the imported autopilot repo, each of the 10 frozen KR1 queries (hippo repo `bench/kr1-queries.md`) is asked of a headless session with the A3 plugin. All 10 answers pass that file's "Answer contains" check. In 10 of 10 transcripts the answer came through `hippo` commands, and no command read `docs/BACKLOG.md`, `docs/backlog/` or `docs/adr/` | `scripts/check-kr1-skill-route.js` output + transcripts, same evidence dir |
| KR-A3.3 idempotent import | Second run of the three imports appends nothing (`git status --porcelain -- .hippo` empty after run 2); every imported record carries `provenance {kind, value, locator}` with the old `BL-`/`ADR-` number as `value`; `hippo check` exits 0 or lists only problems also listed in the P1.4 evidence | import transcript, same evidence dir |
| KR-A3.4 degrade, never silent | All five store states (§3.3) behave as specified: files mode prints its one info line; `hippo-problems` prints `hippo check`'s offending file; spool mode prints a warning naming the spool count; `session-start` repeats the warning whenever the spool dir is non-empty, in any state; flush replays each step of each spooled write exactly once, including after a crash at every fault point (red-checked); with the store present and hippo absent, no commit or merge that touches `.hippo/` passes | `hooks/tests/project-record.test.sh` |
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

- Nothing writes under `.hippo/` except the `hippo` CLI. That includes store bootstrap and `.hippo/repo.toml`: no autopilot script, hook, shell redirection or model edit creates, appends to, renames or deletes a path under `.hippo/`. autopilot code runs the `hippo` binary with an argv array (no shell string). A capability hippo lacks is named as a hippo P1.x dependency, never worked around.
- In a checkout with `.hippo/repo.toml`, no commit and no merge skips `hippo check`: when hippo is missing, the guard and the git hooks fail closed for `.hippo/` paths, and a `hippo check` exit 3 surfaces the offending file unmodified.
- Skill, reference, agent and config-template text never tells a model to edit `docs/BACKLOG.md`, `docs/backlog/*`, an ADR file, a `HANDOFF*.md` or a knowledge file, in either store state; it names `scripts/project-record.js` for writes (which writes files itself in files mode) and `hippo search|related|show|list` for reads.
- autopilot never creates a hippo store implicitly: `project-record.js` writes through hippo only where `.hippo/repo.toml` already exists (it never calls `hippo new` or `hippo import` in a repo without one, because those create a store); a store is created only by the operator running `hippo init` (A3.7), or by the A3.3 rehearsal in a scratch clone.
- Usage counters (how often a record was read, cited or picked) never go to git or to a hippo field; they go to A1 events or the hub.
- Mechanism and guidance are separate commits; a mechanism commit does not edit requirement text (autopilot `CLAUDE.md` "機制 vs 指引").
- Every new or changed check ships with a negative control shown red before green (`references/evidence-discipline.md` §58).
- Node >= 20.10, built-ins only, no new npm dependency.
- Every test and every rehearsal runs under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos, with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and `HIPPO_ACTOR` set in the harness; none targets this checkout (a case that needs a plugin directory uses a temp copy of the plugin tree), and each suite ends by asserting that this checkout's `git status --porcelain` and `.hippo/` (if any) are unchanged.
- hippo ids that leave hippo (fleet `--hippo`, resume lines, `--relates`/`--decides` arguments, spool files) are full 26-character ULIDs; a short prefix is display-only.
- Each phase lands as at least two commits: mechanism (scripts, hooks, tests, inventory rows) and wiring/guidance (CLAUDE.md grouped list, references, README and skill text).

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`.
  - Consumer repos without a hippo store keep the same files: `project-record.js` in files mode writes the
    same schema-valid BACKLOG row, ADR file, knowledge entry or `HANDOFF.md` the skills describe today
    (`references/backlog-entry.md` stays the files-mode schema; full matrix in §4 A3.1). What changes for them is
    who writes: the script, not the model.
  - The autopilot repo moves to hippo in one ship (A3.7). After it, `docs/BACKLOG.md`, `docs/backlog/`,
    `docs/adr/` and the handoff files stay readable and frozen. A change to any of them is refused by
    `check-backlog-entries.js` (`backlog_frozen`, which covers the backlog file, sidecars, ADR files and handoff
    files, keyed on `.hippo/repo.toml` presence) and by the text gate, and the refusal names the
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
| `scripts/check-hippo-writer-text.js` (new) + `scripts/hippo-writer-text-allowlist.json` (new) | text gate over `skills/ references/ agents/ project-config-template/`; report mode until A3.7, then `--enforce`; allowlist, `pending` list and required-writer list (§4 A3.2) | A3.2 |
| `scripts/check-kr1-skill-route.js` (new) | scores KR1-through-skills transcripts: answer check and route check | A3.6 |
| `hooks/hippo-edit-guard.js` (new, default-on) + `hooks/hooks.json`, `hooks/README.md` | PreToolUse; engages only when the target repo has `.hippo/repo.toml`: delegates to `hippo hook claude-pretooluse` when the binary is present; else refuses Edit/Write/MultiEdit/NotebookEdit under `.hippo/` and any Bash command whose argv or redirection names a `.hippo` path | A3.4 |
| `scripts/hippo-git-hook.sh` (new) | the shared body the `.githooks` chain lines call: run `hippo hook <name>` when hippo is available; fail closed when it is not and `.hippo/` paths are involved (§4 A3.4 step 9) | A3.4 (wired in A3.7) |
| `hooks/session-start.js` | one warning line whenever the spool dir is non-empty (any state), the state is `hippo-problems` (offending file repeated), or an unchecked-merge marker exists; one line when the loaded plugin predates the repo's `min_plugin_version` | A3.4 |
| `scripts/check-backlog-entries.js` | `--hippo` mode over `hippo export --json` (same field rules, peer rules); `backlog_frozen` (keyed on `repo.toml` presence; backlog file, sidecars, ADR and handoff files); `backlog_unimported` reconcile | A3.4 |
| `scripts/admit-backlog-follow-ups.js`, `scripts/check-plan-graduation.js` (check mode and `--fix`), `scripts/next-pick.js`, `scripts/migrate-backlog-entries.js`, `scripts/decision-ledger.js` | hippo mode via `project-record.js`/`lib/hippo.js`; migrate refuses in hippo mode; a ledger `decision` row with `reversibility: one-way` also files a hippo `decision` | A3.4 |
| `scripts/resolve-project-paths.sh`, `scripts/resolve-knowledge-routing.sh`, `scripts/project-detect.js` | new field `record_store` (`files` / `hippo` / `hippo-problems` / `spool`) from `lib/hippo.js detect`; existing fields unchanged | A3.1 |
| `scripts/lib/repo-layout.js` registry | `.hippo/` registered as a dev-repo-only root path, so the 3.0.0 release mirror excludes it (§8 Q3 = A) | A3.7 |
| `.claude/record-store.json` (new, tracked) | `{ "min_plugin_version": "<A3 version>" }`, read by `session-start` in a store repo (§4 A3.7) | A3.7 |
| `references/project-memory.md` (new) | reader contract: `hippo search/related/show/list` recipes (the KR1 shapes), "never edit `.hippo/`", what each store state means for a reader | A3.5 |
| `references/backlog-entry.md` | adds the hippo mapping table (§3.2); the files-mode schema stays | A3.5 |
| `references/knowledge-routing.md` | sinks: backlog and lesson destinations go through `project-record.js` | A3.5 |
| skills and references in §3.1 | writer text -> `project-record.js`; reader text -> hippo | A3.5 |
| `.githooks/pre-commit`, `.githooks/pre-merge-commit`, `.githooks/post-merge` | one chain line each: `sh scripts/hippo-git-hook.sh <name> \|\| exit $?` (D22 foreign-hook policy; fail closed for `.hippo/` paths when hippo is missing) | A3.7 |
| `.hippo/` (new, created by the operator's `hippo init` and then `hippo import`), `.gitattributes`, `.gitignore` | the store; guards installed by hippo itself | A3.7 |
| `docs/BACKLOG.md`, `docs/adr/*.md`, handoff files | one frozen-notice line at the top; content untouched | A3.7 |
| `docs/scripts-inventory.md`, `CLAUDE.md` grouped list, `docs/projects/INDEX.md`, `CHANGELOG.md` | wiring of the new scripts and hook (CLAUDE.md "When adding a new script"); always the phase's wiring/guidance commit, never its mechanism commit | A3.1, A3.2, A3.4, A3.6 |
| `hooks/tests/project-record.test.sh`, `hooks/tests/check-hippo-writer-text.test.sh`, `hooks/tests/hippo-edit-guard.test.sh`, `hooks/tests/backlog-hippo-mode.test.sh`, `hooks/tests/hippo-git-hook.test.sh`, `hooks/tests/check-kr1-skill-route.test.sh` (new) | tests; hippo-mode cases need `HIPPO_BIN` (a built hippo) and print `SKIPPED: HIPPO_BIN unset` otherwise; acceptance requires a run with it. Shared harness `hooks/tests/lib/hippo-sandbox.sh`: sandbox `HOME`, temp `HIPPO_CONFIG_DIR`, temp repos, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, `HIPPO_ACTOR=test/a3`, and an exit trap asserting this checkout is unchanged | per phase |
| `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` | transcripts | all |

### 3.1 Writer and reader inventory (the starting red set of the text gate)

Found by `grep -rnE 'BACKLOG|[Bb]acklog|docs/adr|ADR\.md|HANDOFF|knowledge/'` over `skills/ references/
agents/ project-config-template/` at `origin/develop` `94150b6b9`; A3.2's first gate run must reproduce this list
(a difference is reported and resolved before A3.5). How the gate detects each row (A3.2): W1-W19 by the
target patterns (W4 and W12 by the lowercase `backlog` forms); W20 and W21 have no legacy file target, so the
gate checks them through the required-writer list (the named file must contain `project-record.js decision new`
after A3.5).

| # | Writer (file:line) | Today | hippo command (through `project-record.js`) · kind · fields |
|---|---|---|---|
| W1 | `references/backlog-entry.md` (whole) | the row schema, "write one row" | `backlog new` -> `hippo new issue` · see §3.2. The files-mode schema stays as a description of what `project-record.js` writes ("the script writes this row; never write it by hand"); no imperative write sentence remains |
| W2 | `skills/quality-pipeline/SKILL.md:35, :163, :168` | deferred -> one backlog row, then `check-backlog-entries.js` | `backlog new …`; the gate runs inside `project-record.js` |
| W3 | `skills/quality-pipeline/references/code-review.md:153, :319, :333-335, :350` | follow-up -> one row; "add to docs/BACKLOG.md with trigger" | `backlog new --trigger …` |
| W4 | `skills/quality-pipeline/references/test-policy.md:111, :137` | "open backlog", "record in backlog" | `backlog new` |
| W5 | `skills/quality-pipeline/_base/prohibited-behaviors.md:20, :28` | "a BACKLOG entry + trigger" | wording -> "a backlog record (`project-record.js backlog new`) with a trigger" |
| W6 | `skills/dev-flow/SKILL.md:336-338` | deferral = one backlog row | `backlog new` |
| W7 | `skills/finish-flow/SKILL.md:123-126` | deferred rows; "delete that row"; triggered BACKLOG pickup | `backlog new`; `backlog close <id> done --commit <sha>` (-> `hippo close` + `hippo link … implemented_by git:<sha>`); pickup reads `hippo list --kind issue --status open --tag trigger:ready` |
| W8 | `skills/project-lifecycle/references/project-archive.md:11, :13, :18-19, :27, :60` | archive needs rows in BACKLOG.md; "delete completed items" | `backlog new` for remaining phases; `backlog close` for completed |
| W9 | `skills/project-lifecycle/references/templates.md:28-40, :78-80`; `project-structure.md:7, :34, :38-45, :110, :122` | ADR.md and BACKLOG.md templates | `adr new` -> `hippo new adr`. Both templates move into `project-record.js` (files-mode writer); the reference keeps a one-line pointer "`project-record.js adr new` / `backlog new` writes this; files mode only", so no template line tells a model to write the file |
| W10 | `skills/next/references/phase0-hygiene.md:59` | "add it to docs/BACKLOG.md" | `backlog new` |
| W11 | `skills/doc-sync/SKILL.md:128, :148` | "open a BACKLOG item" | `backlog new` |
| W12 | `skills/ceo-agent/references/decision-matrix.md:19` | "record a revisit trigger in the project backlog" | `backlog new --trigger-type event` |
| W13 | `skills/ceo-agent/references/depth0-control-loop.md:458, :517-519` | findings -> BACKLOG via `admit-backlog-follow-ups.js` | the script gains hippo mode (A3.4); text unchanged except the destination word |
| W14 | `skills/l5/references/hetero-impl-loop.md:280` | "any BACKLOG row this campaign's plan supersedes is deleted" | `backlog close <id> superseded --by <plan path>` (hippo status `superseded`, §3.2) |
| W15 | `skills/handoff/SKILL.md` steps 2, 3, 3.5, Resume 1 and 5 | writes/replaces `HANDOFF.md`, routes durable parts, deletes on resume | §4 A3.5 handoff split; both states through `project-record.js handoff new` / `handoff close` |
| W16 | `skills/learn/SKILL.md` Flow 0-5, health audit | appends to `.claude/knowledge/<cat>.md` + INDEX, `git add -f` | `lesson new` -> `hippo new lesson --area <cat>` (files mode: the script appends the knowledge entry + INDEX line); memory_dir and discipline_target routes unchanged (personal, outside the repo) |
| W17 | `references/knowledge-routing.md:98-101, :123` | `backlog_path` sink = a row | sink = `project-record.js backlog new` |
| W18 | `references/acceptance-patterns.md:79`, `references/probe-playbook.md:120` | "record + BACKLOG with trigger" | `backlog new` |
| W19 | `project-config-template/doc-drift-config.md:67`, `dev-flow-config.md:21, :52-55`, `next-config.md:7`, `project-lifecycle-config.md:8`, `knowledge-routing-config.md:16, :26`, `backlog-config.md` | backlog path knobs | keep the knobs (files mode); add one line: "with a hippo store the backlog is the store; this path is read-only provenance" |
| W20 | `skills/dev-flow/SKILL.md:44-48` + `scripts/decision-ledger.js` | owner-proxy decision -> ledger row (git-common-dir, untracked telemetry) | ledger unchanged (A1 event source); `reversibility: one-way` rows also `decision new` -> `hippo new decision` (mechanism in A3.4); dev-flow text names it (required writer) |
| W21 | `skills/think-tank/SKILL.md`, `skills/think-tank-dialectic/SKILL.md` (Decision Brief) | verdict lives in chat only | once the user accepts the recommendation: `decision new --title <question -> choice> --rationale-file -` (required writer) |

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
| superseded by a plan or another record (W14; files mode: today's text deletes the row) | `hippo close <id> superseded` (+ `relates_to <ref>`). hippo's status set is kind-independent (spec §5 field table: `superseded` is a terminal status for every kind, set only by `close`), so `issue` accepts it; the importer maps a row whose Status line says `superseded` the same way (P1.4 input), and the A3.1 parity test has a superseded fixture |
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

The binary is `$HIPPO_BIN` when set, else `hippo` from `PATH` (tests always set `HIPPO_BIN`; the "binary hidden"
cases unset it and use a `PATH` without hippo).

| State | Condition | Writers (`project-record.js`) | Readers |
|---|---|---|---|
| `files` | no `.hippo/repo.toml` | today's file formats, written by the script (§4 A3.1 files-mode matrix); one stderr info line `record store: files (no .hippo store in <repo>)` | today's files |
| `hippo` | store present, `hippo --json check` exits 0 | hippo commands of §3.1/§3.2 | `hippo list/search/related/show` |
| `hippo-problems` | store present, `hippo --json check` exits 3 | writes still go through hippo (hippo applies its own rules per write); `detect` prints `check`'s offending-file lines on stderr unmodified, `session-start` repeats them every session until `check` exits 0 | as `hippo`, plus the problem lines |
| `spool` | store present, binary missing, or exit 5 (`environment`: unsupported format, lock timeout, no actor) | the write is saved as one JSON file under `<git common dir>/autopilot/hippo-spool/<ulid>.json` (per clone, never committed, survives worktree removal); exit 0 with stderr `WARNING record store degraded: <reason>; <n> write(s) spooled; run project-record.js flush once hippo works` | stderr warning; the frozen files may be read and every answer is labelled `stale since <import commit>` |
| `refused` (per write, not a repo state) | hippo exit 2/3/4 on a write step (usage, rule incl. `leak`, not found) | no spool: the error, its `hint` and the rule name are printed; the step contract below applies; `project-record.js` exits with hippo's code | — |

Spool is for writes only. Validation of records already in the store is never spooled or waived: with the
store present and hippo missing, the edit guard and the git hooks fail closed for `.hippo/` paths (§4 A3.4 steps 7
and 9). Flush in state `files` (the store was removed, e.g. by a rollback) exits 2 with `<n> spooled write(s)
target a hippo store that no longer exists; see the rollback note`; it never replays into files and never
creates `repo.toml`. `session-start` warns whenever the spool dir is non-empty, whatever the state.

Step contract (every write, both direct and spooled). A subcommand is an ordered list of steps (create, link,
close, edit, child create). Before the first hippo call the script fixes a root key `k` (16 hex): the spool id for
a spooled write, the `--key` value when given, otherwise a fresh random key that it prints at once on stderr as
`record key: <k> (retry with --key <k>)`. The root create carries tag `key:<k>`; the n-th child record carries
`key:<k>.<n>`. Each step is idempotent on replay or retry: a create is skipped when `hippo list --tag <key>
--history --json` finds the key (both flags exist in the P1.2 `list`, spec §15.1); a link is skipped when `hippo
related <id> --rel <rel> --json` already shows the edge; a close is skipped when the record is already in that
status; an edit is skipped when the body already equals the rendered body. When a step is refused (exit 2/3/4),
the script stops, prints the ids of the records already created and the failed step, and exits non-zero. It never
deletes what was done and never re-creates the root: a retry with `--key <k>` resumes at the failed step. A
spooled write that hits a refusal during flush stays in the spool with the refusal recorded and is reported on
every flush and session start until the owner retries with a changed input or drops it with `project-record.js
flush --drop <spool id>`.

Why spool and not "fail" or "edit the old file": the parent plan's design principle 2 says to degrade and warn
between our own components and to fail closed only on credentials, cert pins and `_access`. A missing hippo is
one of our own components, so failing outright would lose a lesson or a deferred item at the moment the session
is closing. Editing the frozen file would split the source of truth. The spool keeps the write, and its warning
is repeated by `session-start` until a flush. Every `project-record.js` run in state `hippo` or `hippo-problems`
flushes first, so the correct path needs no choice. Idempotency follows the step contract above (for
`admit-backlog-follow-ups.js` the root key is the follow-up fingerprint), so a crash at any step, including
between the last step and the spool-file removal, never duplicates and never loses a later step.

Multi-repo consumers: one store per repo. A session writing for another repo passes `--target <dir>` explicitly.
`project-record.js` never writes to a repo other than the working directory's top level without it. Cross-repo
relations use hippo's `<repo-id>:<ULID>` targets, resolved through the user's `$HIPPO_CONFIG_DIR/repos.toml`; an
unresolvable target shows as `unresolved` and is never dropped (spec §14). A3 creates a store only in the
autopilot repo. Other repos adopt by running `hippo init` and the A3.3 import themselves (parent §8: fleet next;
the rest after KR2 plus a week).

Windows: `lib/hippo.js` uses `child_process.execFileSync(bin, argv)` (`bin` as above) with no shell; libuv's PATH search finds
`hippo.exe`. Paths come from `git rev-parse` and are joined with `path`, never with `/`. hippo's git hooks run
under Git for Windows' bundled shell (spec §13.1). Until hippo's native Windows run exists, a Windows host whose
`hippo.exe` fails with exit 5 or does not start lands in `spool`, which is loud and loses nothing.

## 4. Phases

Dependencies (an arrow = "consumes an output of"):

```
hippo P1.2 (delivered) + fleet F1/F2 (delivered) -> A3.1 -> A3.2
A3.1 -> A3.4
hippo P1.4 (importer mapping + `hippo init`) + A3.1 -> A3.3 (rehearsal on a scratch copy)
A3.2 + A3.4 -> A3.5 (guidance; branch held, not merged)
A3.3 + A3.5 -> A3.6 (KR1 through the skills)
A3.5 + A3.6 + A4 -> A5 (separate plan) ; A5 verdict + hippo P1.3 (KR2) + hippo init + relayout 3.0.0 dev/release split -> A3.7 (ship + cutover)
```

A3.1, A3.2 and A3.4 are mechanism: inert in the autopilot repo until a store exists (state `files`), mergeable
to `develop` on their own after review (A3.2 merges in report mode, so `validate.sh` stays green). A3.5 is
guidance and waits for A5. A3.7 merges guidance, the import and the freeze together, and the plugin version
gate of A3.7 covers sessions whose loaded plugin is older than the merge.

Commit split (every phase): at least one mechanism commit (scripts, hooks, tests, inventory rows) and one
wiring/guidance commit (CLAUDE.md grouped list, `docs/scripts-inventory.md` prose, references, `hooks/README.md`,
`sync-codex-plugin-skills.sh` documentation, skill text). A3.7's commits are listed in A3.7.

### A3.1 — `lib/hippo.js` + `project-record.js` (M)

Steps:
1. `scripts/lib/hippo.js`: `detect(repo)` -> `{state, reason, problems[], repo_root, store_id, hippo_version}`;
   `run(repo, argv)` -> parsed `hippo/1` document (binary per §3.3, always `--json`, `-C <repo>`; non-JSON stdout
   is exit 1 `internal`); `spool.write/list/flush`; the step runner of §3.3. CLI: `node scripts/lib/hippo.js
   detect --target <dir> [--json]`.
2. `scripts/project-record.js` subcommands and the hippo commands they issue. Global flags on every subcommand:
   `--target <dir>` (§3.3), `--key <k>` (step contract), `--json`. Every id the script prints or returns is the
   full 26-character ULID (`id` in `--json`; a short prefix appears only in the human line, labelled display).
   - `backlog new --title <t> --trigger <s> --trigger-type <tt> --effort <e> --origin <o> --source <s>
     --problem <s>|--problem-file <f>|- --impact <s> [--type <ty>] [--reporter <r> --report <msg> --reply <r>]
     [--pointer <p>] [--context <c>|--context-file <f>|-] [--relates <id>]…` -> `hippo new issue --title …
     --status open --tag origin:… --tag effort:… --tag trigger:… [--tag reporter:…] --tag key:<k> --body-file -`
     (body bullets in §3.2 order, `Context` included), then `hippo link <id> relates_to <t>` per `--relates`, then
     `hippo link <id> reported_by fleet:…` when given (leak refusal of that link only: warning, message id stays
     in the body, the step counts as done, §8 Q1).
   - Write-time validation, both modes, before the first hippo call or file write: the field rules of
     `references/backlog-entry.md` (required fields, caps, `bad_trigger_type`, effort value, Problem language, peer
     rules: `origin:peer` needs `--reporter` and `--report`) run through the same module `check-backlog-entries.js`
     uses (`scripts/lib/backlog-rules.js`, extracted in this phase, no rule change). A violation exits 3 naming the
     rule; nothing is written.
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
   - `handoff close <id>` -> `hippo close <id> done`. `where` prints the §3.3 state. `flush [--drop <spool id>]`
     replays the spool step by step.
   - The field list is closed. An unknown flag exits 2. There is no count, hits, uses or views field
     (KR-A3.5).
   - Steps per subcommand (for the §3.3 step contract): `backlog new` = create, N relates links, reported_by
     link; `backlog reply` = edit; `backlog close` = close, optional link; `decision new` = create, N links;
     `decision supersede` / `adr supersede` = create, `supersedes` link, close old; `adr new` / `lesson new` =
     create; `handoff new` = create note, then per decision/lesson file a child create (`key:<k>.<n>`) and its
     `relates_to` link; `handoff close` = close.
3. Files-mode matrix (state `files`; every subcommand; one golden-file case each in `project-record.test.sh`).
   Paths come from `resolve-project-paths.sh` / `resolve-knowledge-routing.sh`, never literals. The `<id>` of a
   files-mode record is its file-native id (`BL-NNNN`, ADR number, knowledge entry heading, handoff path).

   | Subcommand | Files-mode behaviour |
   |---|---|
   | `backlog new` | validate (step 2), take the number from the `<!-- next-id -->` mark, append the heading row (`Context` and sidecar rules as `references/backlog-entry.md`), bump the mark, run `check-backlog-entries.js --backlog <file>` |
   | `backlog reply <BL-id>` | rewrite that row's Reply line in place; other lines byte-equal |
   | `backlog close <BL-id> done` | peer check, then delete the row and its sidecar (today's Done handling) |
   | `backlog close <BL-id> cancelled` | peer check, then set `Status: dropped <date>` in place |
   | `backlog close <BL-id> superseded --by <ref>` | peer check, then delete the row (W14's text) and print `superseded by <ref>` for the commit message |
   | `decision new` | append one entry to the decision ledger only (`decision-ledger.js append --kind decision`, telemetry, untracked) and print `record store: files; decision kept in the ledger only (no tracked decision file in files mode)` |
   | `decision supersede <old>` | ledger entry with `supersedes: <old>`; same info line |
   | `adr new` | write `<adr dir>/NNNN-<slug>.md` from the template (next free number), status line as given |
   | `adr supersede <old>` | `adr new` with a `Supersedes: ADR-<old>` line, then set the old file's status line to `Superseded by ADR-<new>` |
   | `lesson new` | append the entry to `<knowledge_dir>/<category>.md` and its INDEX line (today's learn format); no `git add -f` (the skill asks for promotion separately, files mode only) |
   | `handoff new` | write `<project dir>/HANDOFF.md` (replace) in today's section layout; each `--decision-file` goes to the 已決事項 section, each `--lesson-file` to the 陷阱 section (no separate records exist in files mode) |
   | `handoff close <path>` | delete that `HANDOFF.md` (today's Resume step 5) |
   | `flush` | exits 2 as in §3.3 when the spool is non-empty, else exits 0 |
4. `resolve-project-paths.sh`, `resolve-knowledge-routing.sh`, `project-detect.js`: add `record_store` from
   `lib/hippo.js detect`.
5. Wiring per CLAUDE.md "When adding a new script" (inventory row, grouped list, reference, SKILL table rows land
   in A3.5), in the wiring commit.
Acceptance (`hooks/tests/project-record.test.sh` on the shared sandbox harness of §3: sandbox `HOME`, temp
`HIPPO_CONFIG_DIR`, temp repos, git identity and `HIPPO_ACTOR` set, exit trap asserting this checkout unchanged;
hippo-mode stores in temp repos are created with `hippo import` of a one-row fixture, the only store-creating
command P1.2 has, until `hippo init` lands):
- a sandbox sanity case asserts `detect` returns `hippo`, not `spool` (catches a missing actor or git identity);
- each subcommand in hippo mode produces the records/edges above (`hippo show --json` assertions) and `hippo
  check` exits 0; every printed id and every `--json` `id` is a 26-character ULID;
- every subcommand in files mode matches its golden file (matrix above); `backlog new` output passes
  `check-backlog-entries.js`;
- write-time validation: a row missing Problem, a bad trigger type, and a peer row without a reporter each exit 3
  in both modes and write nothing;
- **parity**: a fixture BACKLOG row imported with `hippo import --from autopilot-backlog` into repo X and the same
  row written by `project-record.js backlog new` into repo Y give equal `show --json` records except `id`,
  `created`, `updated`, `provenance` and the `key:` tag (needs the P1.4 importer; until P1.4 merges this case
  prints `SKIPPED: P1.4 mapping` and A3.7 cannot start); fixtures include a superseded row;
- the five §3.3 states, each red-checked: removing the state check from `detect` turns its case red; the
  `hippo-problems` case builds a temp-repo store with hippo, then the harness corrupts one record file there (a
  test fixture simulating a hand edit, in a temp repo only, never a real store), and asserts that the offending
  file name appears on stderr;
- spool: two writes with the binary hidden (`HIPPO_BIN` unset, `PATH` without hippo) -> 2 spool files + warning;
  set `HIPPO_BIN`, run once -> 2 records, 0 spool files;
- step contract, fault points `PROJECT_RECORD_FAULT=after-create|after-first-link|after-first-child|before-spool-
  remove` on `backlog new` (2 relates), `handoff new` (2 children) and `decision supersede`: each rerun (flush, or
  retry with the printed `--key`) ends with exactly the full set of records and edges, no duplicate. Each fault
  case is red-checked by removing the per-step key or edge lookup;
- a refused child step (leak fixture in the second lesson file) leaves the note and the first child, prints both
  ids and the failed step, exits 3; a retry with `--key` after fixing the file creates only the second child;
- flush in state `files` with a non-empty spool exits 2 naming the count and creates no `repo.toml`; session-start
  warns about the spool in states `files`, `hippo` and `spool`;
- `--target` of another repo is refused without the flag; the plugin-dir case copies the plugin tree to a
  tempdir, points the resolver's plugin-root input there and asserts refusal; it never names this checkout;
- read commands and `where` leave `git status --porcelain` unchanged; an unknown field exits 2.
Verify: `bash hooks/tests/project-record.test.sh` and `node scripts/affected-suites.js --run --files
scripts/lib/hippo.js,scripts/project-record.js,scripts/resolve-project-paths.sh,scripts/resolve-knowledge-routing.sh,scripts/project-detect.js`.

### A3.2 — text gate (S)

Steps: `scripts/check-hippo-writer-text.js [--root <dir>] [--json] [--allowlist <file>] [--enforce]` scans
`skills/**/*.md`, `references/**/*.md`, `agents/**/*.md`, `project-config-template/**/*.md`.
- **Finding rule A (hand-edit text).** Case-insensitive. A line is a finding when an imperative write verb
  (`add|append|write|record|open|file|create|edit|update|delete|remove|replace|move|register|put`) and a target
  appear within 80 characters. Targets: `BACKLOG(\.md)?`, `docs/backlog/`, `(the |project |a |an |to |in |into
  )backlog\b`, `backlog (row|entry|item|file)`, `docs/adr`, `ADR(\.md| file)`, `HANDOFF(\.md)?`,
  `\.claude/knowledge/`, `knowledge (file|entry)`. This covers W4 ("open backlog", "record in backlog") and W12
  ("record a revisit trigger in the project backlog").
- **Not a finding.** A line that names `project-record.js` or a hippo read command (`hippo search|related|show|
  list|export`) within the same 80 characters, so a migrated line such as "record it with `project-record.js
  backlog new`" passes (fixture for this).
- **Finding rule B (counters).** A line naming `hippo set` or `project-record.js` with a counter-like tag or field
  (`count|hits|uses|views`).
- **Finding rule C (required writers).** `scripts/hippo-writer-text-allowlist.json` `required` lists files that
  must contain a given string: `skills/dev-flow/SKILL.md`, `skills/think-tank/SKILL.md` and
  `skills/think-tank-dialectic/SKILL.md` must contain `project-record.js decision new` (W20, W21), and each W-row
  file its migrated `project-record.js <subcommand>` string. A missing string is a finding. This is how rows with
  no legacy file target turn red when their migration is reverted.
- **Files-mode templates (W1, W9).** No exemption. A3.5 moves the templates into `project-record.js` and leaves a
  descriptive pointer, so no template line matches rule A.
- **Allowlist.** Entries `{path, line_sha256, reason_class, reason}` with `reason_class` in `read-citation |
  history | deny-list`. `--seed-allowlist` writes the initial list once, in the A3.2 commit, and refuses when
  the file exists. After that `--update-allowlist` only removes. `--repin <path>:<line>` accepts a changed hash
  only when the line still matches no write verb near a target (the read-only class still holds); otherwise it
  refuses. `pending` is a second shrink-only list, seeded with the baseline finding set, holding lines of
  not-yet-shipped W-rows tagged by ship unit.
- **Modes.** Default (report): prints findings and counts, exits 0 when every finding is in `pending`, exits 1 on
  a finding outside allowlist and `pending` (so no new hand-edit text can land on `develop` while A3.5 is held).
  Rule C findings are printed in report mode and do not change its exit code.
  `--enforce`: `pending` must be empty except entries of a held unit named in `--held <unit>` (A3.7), every
  required writer present, exit 1 otherwise. `scripts/validate.sh` runs report mode from A3.2 and `--enforce` from
  the A3.7 merge.
Acceptance (`hooks/tests/check-hippo-writer-text.test.sh`, fixture trees in a tempdir): negative-control fixture
lines, one per target form (including the W4 and W12 wordings), exit 1 in both modes and name file:line; a
fixture file missing a required writer exits 1 under `--enforce`; a "names `project-record.js`" fixture and a
clean fixture exit 0; a seeded allowlist addition is refused; a `--repin` to a line that now has a write verb is
refused; on the current tree report mode lists exactly the §3.1 set as `pending` and exits 0, and `--enforce`
exits 1 (saved as `gate-baseline.json`). Each rule is red-checked by deleting it and watching its fixture pass.
Verify: `bash hooks/tests/check-hippo-writer-text.test.sh`; `node scripts/check-hippo-writer-text.js --enforce
--json > docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/gate-baseline.json` (exit 1 expected here).

### A3.3 — import rehearsal on a scratch copy (S, needs hippo P1.4 incl. `hippo init`)

Who runs it: the autopilot depth-0 session, on a scratch clone in a tempdir (never this checkout), with a
sandbox `HOME`, `HIPPO_CONFIG_DIR` set to a tempdir seeded only with a copy of the operator's
`leak-guard.toml` (so leak refusals stay real and the operator's `repos.toml` is never read or written),
`HIPPO_ACTOR` and git identity set; the transcript header records these env values. Steps:
1. `git clone <autopilot> <tmp>/ap && cd <tmp>/ap`; `hippo init --id autopilot --visibility public`. Only the
   hippo CLI writes `.hippo/`. Visibility: `.hippo/` lives only in the private dev repo and the release mirror
   excludes it (§8 Q3 = A, wired in A3.7). Records are still `public`, so leak refusals behave as for a public
   repo and an accidental mirror leak exposes nothing a public record could not hold.
2. `hippo import --from autopilot-backlog docs/BACKLOG.md`; `hippo import --from adr-dir docs/adr`; `hippo import
   --from handoff docs` and `hippo import --from handoff docs/projects/<p>` per project with a handoff (P1.4
   filters `HANDOFF*.md` and sets `area`). Paths come from `resolve-project-paths.sh` / `scripts/lib/repo-layout.js
   path` so the 3.0.0 relayout (backlog under `project/`) needs no plan change.
3. Commit, then run the three imports again: `git status --porcelain -- .hippo` must be empty.
4. `hippo check`; `hippo list --kind issue --status open --limit 500 | wc -l` equals the open-row count from
   `check-backlog-entries.js --json`; spot-check five `BL-` numbers with `hippo search BL-NNNN`;
   `check-backlog-entries.js --hippo --reconcile` (A3.4) reports no `backlog_unimported`.
5. Leak refusals (items skipped with a pattern id) are listed; each one gets an owner decision in A3.7 (fix the
   source text, or leave the item only in the frozen file).
Acceptance: KR-A3.3 on the scratch copy; the transcript and skipped-item list are saved in the evidence dir.

### A3.4 — scripts and hook in hippo mode (M)

Steps:
1. `check-backlog-entries.js --hippo [--target <dir>]`: rules of `references/backlog-entry.md` over `hippo export
   --json` (required tags/bullets, caps on body bullets, `bad_trigger_type`, peer rules incl.
   `peer_closed_unanswered`); new code `backlog_frozen` (block) for any diff that changes the frozen backlog
   file, a sidecar, an ADR file or a handoff file (or adds one) while `.hippo/repo.toml` exists, whatever
   `detect` says (also in `spool` state); `.githooks/pre-push` passes `--hippo` whenever `repo.toml` exists, and
   when hippo is missing the `--hippo` rules that need `export` report `hippo_unavailable` and block the push
   (pushing unvalidated records is the same as committing them). New `--reconcile`: every `BL-` and `ADR-` id in
   the frozen files must have a record whose provenance `value` equals it, else `backlog_unimported` (block) naming
   the ids; the repair is a provenance-keyed import of those ids only (P1.4 importer, idempotent on
   (source, locator), touches no existing record).
2. `admit-backlog-follow-ups.js`: in hippo mode admits through `project-record.js backlog new --key
   <fingerprint16>` (dedup by `key:` tag instead of row text).
3. `check-plan-graduation.js`: check mode in hippo mode reads open issues from `hippo export --json` and matches
   their Pointer body bullets against shipped plans exactly as it matches row Pointers today (same finding codes);
   `--fix` turns each finding into `project-record.js backlog close <id> done --by <plan path>` (peer rule kept);
   no file edit.
4. `next-pick.js`: reads `hippo list --kind issue --status open --json --limit 1000` and maps tags back to
   Effort/Trigger-Type; `backlog_digest` is the SHA-256 of that JSON's `data`.
5. `migrate-backlog-entries.js`: exits 2 in hippo mode with "the backlog is a hippo store; nothing to migrate".
6. `decision-ledger.js append --kind decision` with `reversibility: one-way`: after the ledger row, runs
   `project-record.js decision new` (ledger row id in the body); failure of that call warns and never fails the
   ledger append.
7. `hooks/hippo-edit-guard.js` (PreToolUse, default-on, matcher `Edit|MultiEdit|Write|NotebookEdit|Bash`). It
   exits 0 at once unless the target repo (git top level of the tool path, or of the Bash cwd) has
   `.hippo/repo.toml`, so consumer repos without a store never spawn hippo. In a store repo: when the hippo binary
   is available, pipe the payload to `hippo hook claude-pretooluse` and return its verdict. When it is not, the
   guard itself refuses Edit/Write/MultiEdit/NotebookEdit whose path has a `.hippo` component and any Bash command
   whose argv tokens or redirection targets name a `.hippo` path (a read-only command is refused too: without
   hippo the guard cannot tell a safe read from a write, and the refusal says to use `hippo show` once hippo
   is installed). The `hippo` CLI's own invocations (`$HIPPO_BIN`/`hippo` as argv[0]) are allowed. Codex:
   `scripts/sync-codex-plugin-skills.sh` documents hippo's `harness/codex/hooks.toml`. That snippet stays
   unverified (hippo D16/D20), so pre-commit remains the authority (D21).
8. `hooks/session-start.js`: one warning line when the spool dir is non-empty (any state, count), when `detect`
   is `hippo-problems` (offending file lines repeated), when an unchecked-merge marker exists (step 9), and when
   the loaded plugin is older than `.claude/record-store.json` `min_plugin_version` (A3.7).
9. `scripts/hippo-git-hook.sh <pre-commit|pre-merge-commit|post-merge>` (POSIX sh; wired by the A3.7 chain
   lines). No `.hippo/repo.toml`: exit 0. Hippo available: `exec hippo hook <name>`. hippo's stderr, including
   `check`'s offending file on exit 3, passes through unmodified, and its exit code is kept. Hippo missing:
   - pre-commit: exit 1 with `hippo not found ($HIPPO_BIN / PATH); refusing a commit that touches .hippo/` when
     `git diff --cached --name-only` lists a `.hippo/` path, or when an unchecked-merge marker exists. Otherwise
     warn and exit 0, because a commit that touches no record cannot invalidate the store.
   - pre-merge-commit: exit 1 when the merge changes any `.hippo/` path (`git diff --cached --name-only`).
   - post-merge (cannot block): when the merge changed `.hippo/` paths, write the marker
     `<git common dir>/autopilot/hippo-unchecked` with the merge sha and print an error. The next pre-commit
     with hippo available runs `hippo check` and clears the marker on exit 0. Without hippo, pre-commit refuses
     every commit while the marker exists.
Acceptance (`hooks/tests/backlog-hippo-mode.test.sh`, `hooks/tests/hippo-edit-guard.test.sh`,
`hooks/tests/hippo-git-hook.test.sh`, existing suites; all on the shared sandbox harness: sandbox `HOME`, temp
`HIPPO_CONFIG_DIR`, temp repos, checkout-unchanged trap): each step has a case in hippo mode and a files-mode
case whose output is unchanged. Negative controls:
- a bare `hippo close` on an unanswered peer record -> pre-push `peer_closed_unanswered`;
- an edit to the frozen backlog, an ADR file and a handoff file, each with hippo present and with hippo hidden ->
  `backlog_frozen`;
- a fixture row added to the frozen file after import -> `backlog_unimported`;
- `check-plan-graduation.js` check mode reports an open issue whose Pointer names a shipped plan;
- an Edit tool call on `.hippo/ops/x.jsonl` with and without hippo -> refused;
- a Bash `echo >> .hippo/ops/x.jsonl` and a `sed -i` on a record, with and without hippo -> refused;
- a Bash call in a temp repo without `repo.toml` -> allowed, and no hippo process is spawned (spy binary);
- with hippo hidden: a commit staging a `.hippo/` path -> refused; a merge changing `.hippo/` -> refused at
  pre-merge-commit; post-merge writes the marker and the next commit is refused;
- with hippo present: a corrupted record -> pre-commit exit 3 with the file name on stderr.

Each is red-checked by reverting its hunk. Hook inventory and counts are updated
(`scripts/check-hook-inventory.js`, `sync-version.js --hook-count`).
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
   ask (approve / edit / cancel), and only then run `lesson new`. In both states the write is `project-record.js
   lesson new`; the skill text never appends to a knowledge file. The `git add -f` promotion stays a separate,
   asked step in files mode only. Health audit adds `hippo check`.
5. Handoff unit (W15), the split of step 3.5. In both states the skill writes and closes only through
   `project-record.js handoff new` / `handoff close` (files mode: the matrix of A3.1 writes and deletes
   `HANDOFF.md`); no skill line writes, replaces or deletes a handoff file.
   - holder and progress -> `fleet task open "<goal>" --hippo <note ULID>` (once per piece of work; the courier
     records the holder; the full 26-character id printed by `project-record.js`) and `fleet task update <id>
     "<progress narrative>"`;
   - 已決事項 -> one `decision` record each; 陷阱 -> `lesson` records (through `learn`'s gate in public repos);
     the reason for the next step + 下一步 + 驗證方式 + Read-order (repo-relative paths only: the hippo leak guard
     refuses home paths) -> the `handoff-note` body, via `project-record.js handoff new … --decision-file …
     --lesson-file …`;
   - the reply gives `hippo show <note ULID>` (full id, run in the same worktree) as the paste-ready resume line
     plus the fleet task id;
   - Resume: `hippo list --kind handoff-note --area <project> --status open --fields created,title`, `hippo show
     <id>`, `fleet task show <task id>`; drift check unchanged; on completion `project-record.js handoff close
     <id>` and `fleet task close <task id>` instead of deleting a file;
   - no fleet courier (`fleet whoami` fails): no holder is written. `project-record.js handoff new` adds a fixed
     line `holder: not observed (no fleet courier)` plus the branch and last commit it reads from git itself (not
     typed by the model). Resume treats the holder as unknown and relies on the existing drift check. Progress
     narrative goes only into the note's next-step text, labelled `narrative`.
6. SKILL "Available Scripts" rows for `project-record.js`; `skills/onboard/SKILL.md` names `record_store`.
Acceptance: on the A3.5 branch `node scripts/check-hippo-writer-text.js --enforce` exits 0 with only the reasoned
allowlist and an empty `pending`; reverting any one W-row hunk (W20 and W21 included, through rule C) makes it
exit 1 (red-check script over all W-rows, transcript saved); `scripts/check-guidance-eval.js`
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
Isolation: each cell runs under a sandbox `HOME` with no installed plugins and no user settings, so only the
`--plugin-dir` plugin is loaded. The Claude auth credential is placed in that sandbox by an operator-run script as
a 0600 file, never through chat or a model's view (§2.5). `HIPPO_CONFIG_DIR` is the A3.3 temp dir (leak-guard
copy only). Each transcript starts with a header recording `HOME`, `HIPPO_CONFIG_DIR` and the plugin dir and
version, and `check-kr1-skill-route.js` refuses a transcript whose header lacks them or names the operator's
real `HOME`.
Acceptance: KR-A3.2. Negative control: the same cells with the pre-A3 plugin produce route failures (b) (shows
the checker can fail). `hooks/tests/check-kr1-skill-route.test.sh` (sandbox harness, planted transcripts in a
tempdir: grep route, missing id, missing header) is red on each.

### A3.7 — A5 handoff, ship and cutover (M)

Inputs A5 receives from A3 (A5's own plan owns the pre-registration): ship units and the skills each changes
(backlog: next, quality-pipeline, dev-flow, finish-flow, project-lifecycle, doc-sync, ceo-agent refs, l5 refs;
ADR/decision: project-lifecycle, dev-flow, think-tank, think-tank-dialectic; lesson: learn; handoff: handoff), base
and change refs for `evals/skill-onoff/freeze-pack.js --skill <s> --ref <sha>`, and a fixture-scripts pack
(`freeze-pack.js --scripts scripts/project-record.js,scripts/lib/hippo.js`). Proposed markers: the write went
through `project-record.js`, no Edit on the frozen files, and the KR1 answer check.
Ship rule: a unit ships only when A5's report shows ON >= OFF for every skill in it. The backlog unit, the
ADR/decision unit and the handoff unit go together with the cutover, because their old text writes files the
cutover freezes. Only the lesson unit may stay held without blocking the cutover: its target
(`.claude/knowledge/`) is gitignored and not frozen. While it is held, its W16 lines stay in the gate's
`pending` list tagged `lesson`, and `--enforce --held lesson` is the validate mode until that unit ships.
Cutover (needs hippo P1.3 KR2 green, `hippo init`, and the 3.0.0 relayout's private dev repo with its
release mirror, because §8 Q3 = A puts `.hippo/` only in the dev repo; while the split has not shipped the
cutover waits, and committing the store to today's public repo needs a new operator decision; operator's go,
because it moves the source of truth for every session in this repo). Commits on the cutover branch from `origin/develop`, in order:
1. **store** (operator): the operator runs `hippo init --id autopilot --visibility public` at a tty in the
   checkout. The depth-0 session never runs this step in the real checkout; the guard refusing a session's own
   attempt is the expected behaviour. The depth-0 session then runs the A3.3 steps 2-4 (imports twice,
   reconcile) and commits `.hippo/` plus hippo's guard files.
2. **githooks**: chain lines `sh scripts/hippo-git-hook.sh <name> || exit $?` in `.githooks/pre-commit`,
   `pre-merge-commit` and `post-merge`; pre-push switched to `check-backlog-entries.js --hippo --reconcile` with
   `backlog_frozen`; `.hippo/` registered dev-repo-only in `scripts/lib/repo-layout.js`, with a test asserting
   the release-mirror path list excludes it; `.claude/record-store.json` with `min_plugin_version`
   set to this release's version.
3. **frozen notices**: one line at the top of `docs/BACKLOG.md`, each `docs/adr/*.md` and each handoff file:
   "frozen at <commit>; live records are in `.hippo/` (`hippo search`, `project-record.js`). A push refused with
   `backlog_frozen` came from a session on an older autopilot plugin: update the plugin, then refile each named
   row with `project-record.js backlog new`."
4. **guidance**: one commit per shipping unit (backlog, ADR/decision, handoff; lesson if it passed A5), plus
   `validate.sh` switched to `--enforce`.
5. **version**: the plugin version bump (PATCH) and CHANGELOG entry, in the same merge.
Before the merge, re-run the imports once more so rows merged to `develop` in the meantime are picked up
(idempotent). The cutover merge's pre-merge-commit and post-merge run `check-backlog-entries.js --hippo
--reconcile`, so a row that lands in the frozen file between that re-import and the merge, or arrives with the
merge itself, blocks or is reported as `backlog_unimported` with its id. The repair is the provenance-keyed import
of only those ids. Re-import of the whole file after the freeze is not used, because it could overwrite record
changes made in hippo.
Old plugins: skill text comes from the plugin a session loaded, not from `develop`. Hosts that work in this repo
install the bumped plugin as part of the cutover. Until a session does, `session-start` warns in this repo that
the loaded plugin is older than `min_plugin_version` and that its backlog, ADR and handoff instructions are
obsolete. `backlog_frozen` at pre-push catches any file edit that slips through, and the frozen notice says how to
refile.
Windows: `project-record.js where` and one `backlog new` + `flush` on a native Windows host (host from
env/config), transcript saved. If hippo's native run is still open, the transcript shows state `spool` and the
warning, not silence.
Rollback, in this order:
(1) `hippo list --since <cutover date> --history --json > <evidence dir>/rollback-records.json`, run before the
revert while `.hippo/` still exists;
(2) `git revert -m 1 <merge>`, which restores the skill text, the hooks and the gates;
(3) the operator refiles the exported records as rows with `project-record.js backlog new` (now in files mode);
(4) spooled writes: `flush` exits 2 in files state (§3.3), `session-start` keeps warning, and the operator either
re-applies them by hand from the spool JSON through `project-record.js` or drops them with `flush --drop`.
The frozen files were never changed beyond one line, so `docs/BACKLOG.md` is the live backlog again. These manual
steps are stated in the merge message.
Acceptance: KR-A3.1..A3.6 transcripts in the evidence dir; the merge message carries the QC verdict and the A5
report path.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| writer mechanism | `bash hooks/tests/project-record.test.sh` (HIPPO_BIN set), red-check per state and per fault | script |
| text gate | `bash hooks/tests/check-hippo-writer-text.test.sh`; per-W-row revert red-check | script |
| scripts in hippo mode | `bash hooks/tests/backlog-hippo-mode.test.sh`, `bash hooks/tests/hippo-edit-guard.test.sh`, `bash hooks/tests/hippo-git-hook.test.sh`, `node scripts/affected-suites.js --run --files <changed>` | script |
| isolation | every suite on `hooks/tests/lib/hippo-sandbox.sh`; its exit trap fails the suite when this checkout's `git status --porcelain` or `.hippo/` changed | script |
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
| A model edits `.hippo/` by hand or by shell | `hippo-edit-guard.js` (delegates to hippo's hook; refuses Edit and Bash `.hippo` paths itself when hippo is missing) + hippo pre-commit journal and `body_sha` (D21 authority) |
| hippo missing on a host / Windows | writes: `spool` state, loud warning, `session-start` reminder, flush on the next working run, never a write to the frozen file. Validation: the git hooks fail closed for `.hippo/` paths and the unchecked-merge marker blocks commits until `hippo check` runs |
| A store bootstrap that bypasses the CLI | only the operator's `hippo init` creates a store (new P1.4 input); the guard refuses a session's attempt |
| Spool replay duplicates a record or loses a later step | per-step keys and edge lookups (§3.3 step contract); fault points after each step type, each red-checked |
| A partial write after a refused step | the step contract stops, reports created ids and the failed step, and resumes from `--key`; never re-creates the root |
| Importer and writer mappings drift | one mapping table (§3.2) referenced by both; parity test in A3.1 blocks A3.7 |
| Old skills against a frozen backlog | guidance, import and freeze ship in one merge (A3.7); plugin version bump plus `min_plugin_version` warning; `backlog_frozen` at pre-push with refile instructions in the frozen notice |
| Concurrent sessions add rows between rehearsal and cutover | re-import before merge (idempotent); `backlog_unimported` reconcile at the cutover merge; `backlog_frozen` after; no whole-file re-import after freeze |
| A test reaches the real checkout or the operator's hippo config | shared sandbox harness, `HIPPO_BIN` resolution, plugin-dir case on a copy, checkout-unchanged exit trap |
| Re-import overwrites hippo-side edits | forbidden after the freeze (A3.7 step 3) |
| Leak guard refuses a peer `reported_by` address (courier = host name) | body keeps the message id + `reporter:` tag; the link is skipped with a warning; §8 Q1 |
| Merge safety unproven | cutover waits for hippo P1.3 (KR2) |
| `.claude/knowledge/` lessons are local and unimported | they keep working (files route for old entries); new lessons go to hippo; §8 Q2 |
| 3.0.0 relayout moves `docs/` paths | every path from `resolve-project-paths.sh` / `repo-layout.js`; `.hippo/` added to the root allowlist in the same change that creates it |
| Public repo leaks via records | `.hippo/` only in the private dev repo, excluded from the release mirror (§8 Q3); `visibility = "public"` anyway; hippo leak guard on every string, per-user `leak-guard.toml` for host names, learn's human disclosure gate before `lesson new` |
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
- Any change to hippo itself; gaps found go to the hippo repo as P1.4 inputs (so far: importer mapping of
  §3.2 incl. `superseded`, handoff `HANDOFF*` filter and `area`, and `hippo init --id --visibility`).

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
- G1 2026-11-02: plan review generation 1 = CONDITIONAL (openai STOP, google CONDITIONAL, anthropic
  CONDITIONAL); 21 findings, 11 blocking. Depth-0 accepted all 11 blockers; all 10 non-blocking folded, none
  refuted. Dispositions: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g1-dispositions.json`. R1 changes: CLI-only
  writes under `.hippo/`, including bootstrap (new hippo P1.4 input `hippo init --id --visibility`); fail-closed git
  hooks and guard for `.hippo/` paths when hippo is missing, plus the `hippo-problems` state; a files-mode matrix
  for every subcommand; text-gate rules A/B/C with report/enforce modes and an allowlist bootstrap; restored
  `backlog new` flags and write-time validation; a per-step key contract for multi-command writes; a shared
  sandbox harness; the `backlog_unimported` reconcile; a plugin version gate; the rollback order; the commit
  split; the cutover waits for the 3.0.0 dev/release split (§8 Q3 = A). Rubric unchanged (frozen).
