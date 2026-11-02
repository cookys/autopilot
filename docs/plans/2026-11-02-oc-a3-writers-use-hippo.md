# Plan - operator console A3: autopilot writers use hippo

> Status: draft for plan review (R1, generation-1 findings folded). Owner: operator (decisions), autopilot session
> (author) · Branch: `plan/oc-a3-hippo-writers` · Size: L (seven phases) ·
> Parent: fleet repo `docs/plans/2026-11-01-operator-console.md` (approved 2026-11-01), deliverable D3, phase A3 ·
> Frame: hippo owns records and queries; autopilot owns the flow, decides what to write and calls the `hippo` CLI
> to write it; fleet tasks hold live coordination state (who holds the work, progress).

## 0. Context / thesis

The parent plan (§1 problem 1) found that autopilot's knowledge does not scale: backlog, ADRs, handoffs and
lessons are markdown files that models edit by hand, finding anything costs `grep` tokens that grow with the
project, relations live in prose, and two sessions once allocated the same backlog number. The parent plan's answer
is hippo (D1): one file per record in git, an op log as the only authority, a rebuildable index, a CLI as the only
writer. A3 moves every autopilot writer onto hippo and makes the skills read through hippo.

Binding decisions (parent plan §0, §2.6, review dispositions):

| Source | Decision |
|---|---|
| Card Q1 | hippo is the single writer of backlog and flow records; autopilot stays the project manager |
| Card Q12 | knowledge = one file per record in git + a rebuildable local index; live coordination state = fleet task tree, not git |
| Card d-661bf338 | hippo = knowledge inside one project; mnemos = cross-project aggregation; personal preferences = a user-level store |
| Parent §2.6 | BACKLOG.md, handoffs and ADR files are imported idempotently; old numbers kept as provenance; old files stay readable until the operator retires them |
| Parent §8 | hippo v1 runs in autopilot and fleet first; other repos only after KR2 holds and a week passes with no data problem |
| g1 0ed6829d | import is idempotent on (source, locator); old numbers are provenance only; import runs twice |
| g1 d7e2ef26, 2b584dd9 | D3 needs P1.2 + F1 + F2 |
| g1 af4b57ef | A1-A5 carry a size and a checkable acceptance |
| g2 e0f75a28 | A3 + A4 -> A5: the ON/OFF evaluation gates shipping the changed skills |
| g1 faf96399, g2 a695030a, f120c463 | the hook refuses shell writes under `.hippo/` as well as Edit/Write; every `hippo` command self-installs guards; a hand-written op line is caught by the write journal at pre-commit; the index lives under the ignored `.hippo/.cache/` |

### What hippo has delivered and what A3 may rely on

From the hippo repo `develop` (`docs/spec.md` §15.1, `docs/evidence/p1.2/decisions.md` D1-D22, `hippo --help`):

| hippo item | State | Used by A3 |
|---|---|---|
| P1.1 spec, `bench/kr1-queries.md` | delivered | kinds, fields, relations, KR1 queries |
| P1.2 core + CLI | delivered (merge `2ca80c1`) | `new set edit link unlink relink close resolve show list search related check report export import`, `--json` (`hippo/1`), `-C <dir>`; self-installing git guards (D3); hook scripts that warn and exit 0 without `hippo` on `PATH` (D4); harness hooks `hippo hook claude-pretooluse` / `codex-pretooluse` (D16, D21) |
| P1.3 merge bench (KR2) | not delivered | **dependency of A3.7**: the backlog does not move onto a store whose merge safety is unmeasured |
| P1.4 importers + KR1 evidence | not delivered | **dependency of A3.3 and A3.6**: the P1.2 importer maps only `Origin` to a tag (D14); no `reporter:`/`effort:`/`trigger:` tags, no handoff `area`, no `relates_to` edges for `BL-`/`ADR-` mentions, no sidecar body; `--from handoff <dir>` imports every `.md`, not only `HANDOFF*.md` (`cmd_import.rs` `md_files`). KR1 Q1, Q2, Q4, Q5, Q7, Q10 need P1.4 |
| `hippo init` | **not in hippo; new P1.4 input from A3** | today the first `hippo new`/`import` creates `.hippo/repo.toml` itself (`ctx.rs` `init_store`) with `visibility = "internal"` and an id from the directory name; nothing sets `id`/`visibility`, and only a human may hand-edit `repo.toml` (spec §2.1). A3 needs `hippo init --id <id> --visibility public\|internal`, refusing when `repo.toml` exists. **Dependency of A3.3 and A3.7** |
| codex hook payload (D16, D20) | open in hippo | codex snippet unverified; for codex sessions the pre-commit journal and `body_sha` are the authority (D21) |
| native Windows run | open in hippo | cross-built only (`make windows-build`); see §3.3, A3.7 |

Fleet (D2) delivered (release `5e594f2`): `fleet task open <title...> [--parent] [--pid] [--hippo <ref>]`, `fleet
task update <id> <progress...>`, `fleet task close <id> [--note]`, `fleet task show|list`, `fleet tasks --mine
--tree`; the courier attributes the task to the caller's seat from its pids. Autopilot A1 (events contract, `autopilot status
events`, `autopilot.events/1`) is not delivered.

## 1. Problem

The goal: any agent on any machine finds and records project knowledge cheaply and safely.

1. **Writers edit files by hand.** Every skill that defers work, records a decision or lesson, or hands off, tells
   the model to edit `docs/BACKLOG.md`, a sidecar, an ADR file, a knowledge file or `HANDOFF.md` (§3.1); that is
   where number collisions, lost rows and prose-only relations come from.
2. **Readers grep.** `/next`, handoff resume, `learn` dedup and review skills `grep`/`sed` the same files.
3. **The handoff mixes three lifetimes**: holder and progress (minutes), decisions and pitfalls (months), next
   command (one session), in one file deleted on resume.
4. **No defined behaviour without hippo**: consumer repos have no store, a host can lack the binary, Windows is
   first-class. Without a decided fallback a writer fails silently or edits the old file and splits the truth.

## 2. OKR / KRs

**Objective**: every autopilot writer records through one command that writes hippo records where a store exists
and degrades loudly where it does not; every skill reads through `hippo search/related/show/list`.

| KR | Threshold | Verified by |
|---|---|---|
| KR-A3.1 no hand-edit text | `check-hippo-writer-text.js --enforce` exits 0 on the shipped tree: allowlist holds only reasoned read/history mentions; `pending` holds only a held unit's lines (A3.7) and only shrinks; required writers present (rule C). Negative controls (one fixture per target pattern, one file missing a required writer) exit 1; reverting any one migrated W-row hunk turns it red | `hooks/tests/check-hippo-writer-text.test.sh` + red-check transcript in `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` |
| KR-A3.2 KR1 through the skills | On the imported scratch copy, each of the 10 frozen KR1 queries (hippo `bench/kr1-queries.md`) asked of a headless session with the A3 plugin: 10/10 answers pass "Answer contains"; 10/10 transcripts answer via `hippo` and never read the backlog file, `docs/backlog/` or `docs/adr/` | `scripts/check-kr1-skill-route.js` + transcripts, same dir |
| KR-A3.3 idempotent import | second run appends nothing (`git status --porcelain -- .hippo` empty); every imported record carries `provenance {kind, value, locator}` with the old number as `value`; `hippo check` exits 0 or lists only problems also in the P1.4 evidence | import transcript |
| KR-A3.4 degrade, never silent | the five §3.3 states behave as specified (files info line; `hippo-problems` prints the offending file; spool warning with count; `session-start` warns on a non-empty spool in any state); flush replays every step exactly once incl. after a crash at each fault point (red-checked); with a store present, no commit, merge or rebase skips `hippo check` (hippo absent: refused or marked) | `hooks/tests/project-record.test.sh`, `hooks/tests/hippo-git-hook.test.sh` |
| KR-A3.5 no counters in git | no A3 path writes a usage count into hippo or a tracked file; closed field list (unknown field exits 2); read commands leave `git status --porcelain` unchanged | `hooks/tests/project-record.test.sh` |
| KR-A3.6 ON/OFF before ship | each ship unit ships only with A5's report showing ON >= OFF (A3.7) | A5 evidence (`evals/skill-onoff/results/`), cited in the A3.7 merge message |

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

Plan-local constraints (A3; copied verbatim into every A3 dispatch):

- **C1 CLI-only writes.** Nothing writes under `.hippo/` except the `hippo` CLI, including store bootstrap and `.hippo/repo.toml`: no autopilot script, hook, shell redirection or model edit creates, appends to, renames or deletes a `.hippo/` path. autopilot runs the binary with an argv array (no shell string). A missing hippo capability is named as a hippo P1.x dependency, never worked around. Sole exception: a `hippo-sandbox.sh` fixture may corrupt a record in a sandbox temp repo after asserting the path is under its tempdir.
- **C2 no check bypass.** In a checkout with `.hippo/repo.toml`, no commit and no merge skips `hippo check`: without hippo, the guard and git hooks fail closed for `.hippo/` paths; a `hippo check` exit 3 surfaces the offending file unmodified.
- **C3 no hand-edit text.** Skill, reference, agent and config-template text never tells a model to edit `docs/BACKLOG.md`, `docs/backlog/*`, an ADR file, a `HANDOFF*.md` or a knowledge file, in either store state; writes name `scripts/project-record.js` (which writes the files itself in files mode), reads name `hippo search|related|show|list`.
- **C4 no implicit store.** `project-record.js` writes through hippo only where `.hippo/repo.toml` exists and never calls `hippo new`/`import` in a repo without one; a store is created only by the operator's `hippo init` (A3.7) or the A3.3 rehearsal in a scratch clone.
- **C5 counters.** Usage counters never go to git or a hippo field; they go to A1 events or the hub.
- **C6 isolation.** Every test and rehearsal runs under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos, with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and `HIPPO_ACTOR` set and the caller's git env scrubbed (unset `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_PREFIX`; `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=$HOME/.gitconfig`, `XDG_CONFIG_HOME=$HOME/.config`); before any write a pre-flight asserts `git rev-parse --show-toplevel` in each temp repo equals the temp path; none targets this checkout (a plugin-directory case uses a temp copy of the plugin tree); each suite asserts on exit that this checkout's `git status --porcelain` and `.hippo/` are unchanged.
- **C7 full ids.** hippo ids that leave hippo (fleet `--hippo`, resume lines, `--relates`/`--decides`, spool files) are full 26-character ULIDs; prefixes are display-only.
- **C8 commit split.** Each phase lands as at least two commits: mechanism (scripts, hooks, tests only) and wiring/guidance (scripts- and hook-inventory rows, CLAUDE.md grouped list, references, README, `sync-codex-plugin-skills.sh` docs, skill text); a mechanism commit never edits requirement text (CLAUDE.md "機制 vs 指引").
- **C9 negative controls.** Every new or changed check ships with a negative control shown red before green (`references/evidence-discipline.md` §58).
- Node >= 20.10, built-ins only, no new npm dependency.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`.
  - Repos without a store keep the same files: `project-record.js` in files mode writes the same schema-valid
    BACKLOG row, ADR file, knowledge entry or `HANDOFF.md` (matrix in A3.1); only the writer changes.
  - The autopilot repo moves in one ship (A3.7). After it the backlog file, sidecars, ADR and handoff files stay
    readable and frozen; a change is refused by `backlog_frozen` (A3.4 step 1) and the text gate, naming the
    `project-record.js` command to use.
  - Backlog-reading scripts gain a hippo mode from the same detection; files-mode output unchanged.
  - Version: PATCH (scripts, a hook, skill bodies; no skill added/removed, no routing `description:` change).
- **Dependency decision**: `existing`. hippo is the sibling deliverable (D1); fleet tasks are delivered (F2);
  Node built-ins only. Linking hippo's crates was rejected: the `--json` CLI is the published interface (spec §16)
  and linking would bypass the write journal.

## 3. File-structure map

| Path (autopilot repo) | Responsibility | Phase |
|---|---|---|
| `scripts/lib/hippo.js` (new) | detection (§3.3), run hippo by argv, parse `hippo/1`, spool, step runner | A3.1 |
| `scripts/lib/backlog-rules.js` (new, extracted) | the `backlog-entry.md` field/peer rules shared by the writer and the gate (no rule change) | A3.1 |
| `scripts/project-record.js` (new) | the one writer, hippo and files mode (A3.1) | A3.1 |
| `scripts/check-hippo-writer-text.js` + `scripts/hippo-writer-text-allowlist.json` (new) | text gate: rules A/B/C, allowlist, `pending`, report/enforce (A3.2) | A3.2 |
| `scripts/check-kr1-skill-route.js` (new) | KR1 transcript scoring (A3.6) | A3.6 |
| `hooks/hippo-edit-guard.js` (new, default-on) + `hooks/hooks.json`, `hooks/README.md` | PreToolUse guard (A3.4 step 7) | A3.4 |
| `scripts/hippo-git-hook.sh` (new) | shared git-hook body, fail-closed without hippo (A3.4 step 9) | A3.4, wired A3.7 |
| `hooks/session-start.js` | warnings (A3.4 step 8) | A3.4 |
| `scripts/check-backlog-entries.js` | `--hippo`, `backlog_frozen`, `--reconcile`/`backlog_unimported`, `hippo_unavailable` (A3.4 step 1) | A3.4 |
| `scripts/admit-backlog-follow-ups.js`, `check-plan-graduation.js` (check + `--fix`), `next-pick.js`, `migrate-backlog-entries.js`, `decision-ledger.js` | hippo mode (A3.4 steps 2-6) | A3.4 |
| `scripts/resolve-project-paths.sh`, `resolve-knowledge-routing.sh`, `project-detect.js` | new field `record_store` (`files`/`hippo`/`hippo-problems`/`spool`) | A3.1 |
| `references/project-memory.md` (new), `references/backlog-entry.md`, `references/knowledge-routing.md`, skills of §3.1 | reader contract, hippo mapping, sinks, migrated text | A3.5 |
| `.githooks/pre-commit`, `pre-merge-commit`, `post-merge`, `post-rewrite` | one chain line each `sh scripts/hippo-git-hook.sh <name> \|\| exit $?` (D22 foreign-hook policy) | A3.7 |
| `.hippo/`, `.gitattributes`, `.gitignore` | store (operator's `hippo init`, then `hippo import`); guards installed by hippo | A3.7 |
| `scripts/lib/repo-layout.js` | `.hippo/` registered dev-repo-only so the 3.0.0 release mirror excludes it (§8 Q3) | A3.7 |
| `.claude/record-store.json` (new) | `{ "min_plugin_version": "<A3 version>" }` for `session-start` | A3.7 |
| backlog file, `docs/adr/*.md`, handoff files | one frozen-notice line; content untouched | A3.7 |
| `docs/scripts-inventory.md`, CLAUDE.md grouped list, `docs/projects/INDEX.md`, `CHANGELOG.md` | wiring (CLAUDE.md "When adding a new script"), always in the wiring commit (C8) | A3.1, 2, 4, 6 |
| `hooks/tests/{project-record,check-hippo-writer-text,hippo-edit-guard,backlog-hippo-mode,hippo-git-hook,check-kr1-skill-route}.test.sh` (new) + `hooks/tests/lib/hippo-sandbox.sh` | tests; hippo-mode cases need `HIPPO_BIN` and print `SKIPPED: HIPPO_BIN unset` otherwise (acceptance requires a run with it). The harness implements C6 (`HIPPO_ACTOR=test/a3`) with a checkout-unchanged exit trap | per phase |
| `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` | transcripts | all |

### 3.1 Writer and reader inventory (the starting red set of the text gate)

Found by `grep -rnE 'BACKLOG|[Bb]acklog|docs/adr|ADR\.md|HANDOFF|knowledge/'` over `skills/ references/ agents/
project-config-template/` at `origin/develop` `94150b6b9`; A3.2's first run must reproduce it (differences resolved
before A3.5). Gate detection (A3.2): W1-W19 by rule A (W4, W12 via the lowercase `backlog` forms); W20, W21 have no
legacy target and are checked by rule C. All writes below go through `project-record.js`.

| # | Writer (file:line) | Today | After A3 |
|---|---|---|---|
| W1 | `references/backlog-entry.md` | row schema, "write one row" | `backlog new` (§3.2); the schema stays as a description of what the script writes ("never by hand"), no imperative write sentence |
| W2 | `skills/quality-pipeline/SKILL.md:35, :163, :168` | deferred -> row, then `check-backlog-entries.js` | `backlog new` (validation runs inside it) |
| W3 | `skills/quality-pipeline/references/code-review.md:153, :319, :333-335, :350` | follow-up -> row | `backlog new --trigger …` |
| W4 | `skills/quality-pipeline/references/test-policy.md:111, :137` | "open backlog", "record in backlog" | `backlog new` |
| W5 | `skills/quality-pipeline/_base/prohibited-behaviors.md:20, :28` | "a BACKLOG entry + trigger" | "a backlog record (`project-record.js backlog new`) with a trigger" |
| W6 | `skills/dev-flow/SKILL.md:336-338` | deferral = row | `backlog new` |
| W7 | `skills/finish-flow/SKILL.md:123-126` | deferred rows; "delete that row"; triggered pickup | `backlog new`; `backlog close <id> done --commit <sha>`; pickup = `hippo list --kind issue --status open --tag trigger:ready` |
| W8 | `skills/project-lifecycle/references/project-archive.md:11, :13, :18-19, :27, :60` | rows for remaining phases; "delete completed items" | `backlog new`; `backlog close` |
| W9 | `skills/project-lifecycle/references/templates.md:28-40, :78-80`; `project-structure.md:7, :34, :38-45, :110, :122` | ADR.md and BACKLOG.md templates | `adr new` -> `hippo new adr`; both templates move into `project-record.js`; the reference keeps a one-line pointer ("`project-record.js adr new` / `backlog new` writes this; files mode only") |
| W10 | `skills/next/references/phase0-hygiene.md:59` | "add it to docs/BACKLOG.md" | `backlog new` |
| W11 | `skills/doc-sync/SKILL.md:128, :148` | "open a BACKLOG item" | `backlog new` |
| W12 | `skills/ceo-agent/references/decision-matrix.md:19` | "record a revisit trigger in the project backlog" | `backlog new --trigger-type event` |
| W13 | `skills/ceo-agent/references/depth0-control-loop.md:458, :517-519` | findings via `admit-backlog-follow-ups.js` | script gains hippo mode (A3.4); destination word only |
| W14 | `skills/l5/references/hetero-impl-loop.md:280` | superseded row "is deleted" | `backlog close <id> superseded --by <plan path>` (§3.2) |
| W15 | `skills/handoff/SKILL.md` steps 2, 3, 3.5, Resume 1, 5 | writes/replaces `HANDOFF.md`, deletes on resume | A3.5 step 5; both states via `handoff new` / `handoff close` |
| W16 | `skills/learn/SKILL.md` Flow 0-5, health audit | appends `.claude/knowledge/<cat>.md` + INDEX, `git add -f` | `lesson new` -> `hippo new lesson --area <cat>` (files mode: the script appends entry + INDEX); memory_dir, discipline_target unchanged (personal) |
| W17 | `references/knowledge-routing.md:98-101, :123` | `backlog_path` sink = row | sink = `backlog new` |
| W18 | `references/acceptance-patterns.md:79`, `references/probe-playbook.md:120` | "record + BACKLOG with trigger" | `backlog new` |
| W19 | `project-config-template/{doc-drift-config.md:67, dev-flow-config.md:21, :52-55, next-config.md:7, project-lifecycle-config.md:8, knowledge-routing-config.md:16, :26, backlog-config.md}` | backlog path knobs | knobs stay (files mode) + "with a hippo store this path is read-only provenance" |
| W20 | `skills/dev-flow/SKILL.md:44-48` + `decision-ledger.js` | owner-proxy decision -> ledger row (untracked telemetry) | ledger unchanged (A1 source) and the single owner of one-way decisions (A3.4 step 6); dev-flow says so and names `decision new` only for decisions outside the ledger (rule C) |
| W21 | `skills/think-tank/SKILL.md`, `skills/think-tank-dialectic/SKILL.md` | verdict only in chat | once accepted: `decision new --title <question -> choice> --rationale-file -` (rule C) |

Readers to move to hippo: `skills/next/SKILL.md:33, :52, :60, :68-73, :91, :123, :131`; handoff Resume; learn Flow 1
dedup; `skills/l5/references/hetero-impl-loop.md:297` (`hippo search BL-0285`); `next-pick.js`;
`check-plan-graduation.js`. Allowlisted read-only mentions: ADR-0001/0002 citations by path,
`references/reviewer-mvp-portfolio.md:91`, `skills/hetero-review/references/plan-loop.md:43`, incident history in
`references/evidence-discipline.md`, `references/qualification-defaults.md:34`. Out of inventory: `hooks/session-handoff.js` /
`session-start.js` machine snapshot on `/clear` (ephemeral, never git); `open-decision.js` cards (A4/F4).

### 3.2 Backlog record mapping (one table for `project-record.js` and the P1.4 importer)

| Backlog field | hippo |
|---|---|
| Title | `--title` |
| Status `open` / `fired <date>` | status `open` (`fired` line stays in the body) |
| `shipped <ver> <date>` / `dropped <date>` | `close done` (+ `link implemented_by git:<sha>` when known) / `close cancelled` |
| superseded (W14) | `close superseded` (+ `relates_to <ref>`). hippo's status set is kind-independent (spec field table: `superseded` is terminal for every kind, set only by `close`), so `issue` accepts it; the importer maps it the same way (P1.4 input); the A3.1 parity test has a superseded fixture |
| Id `BL-NNNN` | provenance only (imports): `{kind: autopilot-backlog, value: BL-NNNN, locator: <backlog path>#BL-NNNN}`; new records get no number |
| Origin, Reporter, Effort, Trigger-Type | tags `origin:<v>`, `reporter:<first word, lower>`, `effort:<xs..xl>` (urgent suffix -> `urgent`), `trigger:<owner\|event\|ready\|peer\|date-YYYY-MM-DD>` |
| type | `--type` (`bug feature debt question chore`; default `debt`) |
| Since | `created` (import: source date) |
| Problem, Impact, Trigger, Source, Pointer, Context, Report, Reply | body, one `- **Field**: value` bullet each, same shape as the importer |
| Report (fleet message) | body bullet with the message id; `link reported_by fleet:<ns>/<courier>/<member>#<msg>` only when the leak guard accepts it (§8 Q1) |
| Pointer to a plan | body bullet (`relates_to` once plans are records; not in A3) |
| `BL-`/`ADR-` mention | `relates_to` (importer: P1.4; writer: `--relates <id>`) |

Peer rules carry over: an `origin:peer` record needs `reporter:` and a Report bullet; closing one whose Reply is
`none`/`unknown` is refused by `backlog close` and reported as `peer_closed_unanswered` by `check-backlog-entries.js
--hippo` at pre-push (a bare `hippo close` cannot dodge it). hippo has no record deletion (ops are append-only;
`hippo doctor --restore-ops` restores lines), so `peer_report_lost` has no analogue.

### 3.3 Store states and the fallback (decided)

`lib/hippo.js detect --target <repo>`: `<repo>` is the git top level of `--target`, else of the cwd, never the
plugin's own install directory. Binary: `$HIPPO_BIN` when set, else `hippo` on `PATH`.

| State | Condition | Writers | Readers |
|---|---|---|---|
| `files` | no `.hippo/repo.toml` | files-mode matrix (A3.1); stderr info `record store: files (no .hippo store in <repo>)` | today's files |
| `hippo` | store, `hippo --json check` exits 0 | hippo commands (§3.1/§3.2) | `hippo list/search/related/show` |
| `hippo-problems` | store, `check` exits 3 | through hippo (hippo applies its rules per write); `detect` prints `check`'s offending-file lines unmodified; `session-start` repeats them until `check` exits 0 | as `hippo` + problem lines |
| `spool` | store, binary missing or exit 5 (unsupported format, lock timeout, no actor) | write saved as `<git common dir>/autopilot/hippo-spool/<ulid>.json` (never committed) with worktree top level, branch and target repo; exit 0 with `WARNING record store degraded: <reason>; <n> write(s) spooled; run project-record.js flush once hippo works` | warning; frozen files readable, answers labelled `stale since <import commit>` |
| `refused` (per write) | hippo exit 2/3/4 on a write step (usage, rule incl. `leak`, not found) | no spool; error, `hint`, rule printed; step contract applies; exits with hippo's code | — |

Why spool: parent design principle 2 says degrade and warn between our own components and fail closed only on
credentials, cert pins and `_access`. Failing would lose a lesson or deferred item at session close; editing the
frozen file would split the truth. Spool is for writes only: validation of existing records is never spooled or
waived (C2; A3.4 steps 7, 9). Every run in state `hippo`/`hippo-problems` flushes first. Flush replays only entries whose worktree and branch match the current ones (records live per branch; others are listed in the warning, not replayed) and holds an exclusive lock (`O_EXCL` lockfile in the spool dir, stale-pid recovery) across list, create and spool-file removal. `flush` in state `files`
(store removed, e.g. rollback) exits 2 with `<n> spooled write(s) target a hippo store that no longer exists; see
the rollback note`, never replays into files, never creates `repo.toml`. `session-start` warns on a non-empty spool
in any state.

**Step contract** (direct and spooled writes). A subcommand is an ordered list of steps (create, link, close, edit,
child create). Before the first hippo call the script fixes root key `k` (16 hex): the spool id, `--key`, or a
fresh key printed at once as `record key: <k> (retry with --key <k>)` (`admit-backlog-follow-ups.js` uses the
follow-up fingerprint). Root create carries tag `key:<k>`, the n-th child `key:<k>.<n>`. Each step is idempotent:
a create is skipped when `hippo list --tag <key> --history --json` finds it (both flags exist in P1.2 `list`, spec
§15.1); a link when `hippo related <id> --rel <rel> --json` shows it; a close when already in that status; an edit
when the body already equals the rendering. A refused step stops the run, prints created ids and the failed step,
exits non-zero; nothing is deleted, the root is never re-created, and `--key <k>` resumes at the failed step. A
spooled write refused during flush stays spooled with the refusal recorded, reported on every flush and session
start until retried with changed input or dropped with `flush --drop <spool id>`.

Multi-repo: one store per repo; writing to another repo needs `--target <dir>`. Cross-repo relations use
`<repo-id>:<ULID>` via `$HIPPO_CONFIG_DIR/repos.toml`; unresolvable targets show `unresolved`, never dropped (spec
§14). A3 creates a store only in autopilot; other repos run `hippo init` + the A3.3 import themselves (parent §8).

Windows: `execFileSync(bin, argv)`, no shell (libuv finds `hippo.exe`); paths from `git rev-parse` joined with
`path`; hippo's git hooks run under Git for Windows' shell (spec §13.1). Until hippo's native run exists, a host
whose `hippo.exe` fails lands in `spool`: loud, nothing lost.

## 4. Phases

```
hippo P1.2 (delivered) + fleet F1/F2 (delivered) -> A3.1 -> A3.2
A3.1 -> A3.4
hippo P1.4 (importer mapping + `hippo init`) + A3.1 -> A3.3 (rehearsal on a scratch copy)
A3.2 + A3.4 -> A3.5 (guidance; branch held, not merged)
A3.3 + A3.5 -> A3.6 (KR1 through the skills)
A3.5 + A3.6 + A4 -> A5 (separate plan) ; A5 verdict + hippo P1.3 (KR2) + hippo init + relayout 3.0.0 dev/release split -> A3.7 (ship + cutover)
```

A3.1, A3.2, A3.4 are mechanism, inert in autopilot until a store exists, mergeable to `develop` after review (A3.2
in report mode, so `validate.sh` stays green). A3.5 waits for A5. A3.7 merges guidance, import and freeze together;
its plugin version gate covers sessions on older plugins. Commit split per C8; A3.7 lists its commits.

### A3.1 — `lib/hippo.js` + `project-record.js` (M)

Steps:
1. `scripts/lib/hippo.js`: `detect(repo)` -> `{state, reason, problems[], repo_root, store_id, hippo_version}`;
   `run(repo, argv)` -> parsed `hippo/1` (always `--json`, `-C <repo>`; non-JSON stdout = exit 1 `internal`);
   spool write/list/flush; step runner (§3.3). CLI `node scripts/lib/hippo.js detect --target <dir> [--json]`.
2. `scripts/project-record.js`. Global flags: `--target <dir>`, `--key <k>`, `--json`. Every printed or returned
   id is the full ULID (C7; `id` in `--json`, prefix only in the human line, labelled display). Subcommands, hippo
   commands, and steps:
   - `backlog new --title <t> --trigger <s> --trigger-type <tt> --effort <e> --origin <o> --source <s> --problem
     <s>|--problem-file <f>|- --impact <s> [--type <ty>] [--reporter <r> --report <msg> --reply <r>] [--pointer
     <p>] [--context <c>|--context-file <f>|-] [--relates <id>]…` -> `hippo new issue … --status open --tag
     origin:… --tag effort:… --tag trigger:… [--tag reporter:…] --tag key:<k> --body-file -` (bullets in §3.2
     order incl. Context); steps: create, N `relates_to` links, `reported_by` link (a leak refusal of that link
     only warns, keeps the message id in the body and counts as done, §8 Q1).
   - `backlog reply <id> --reply <date> <ptr>` -> `hippo edit <id> --body-file -` (body from `show --json` with the
     new Reply bullet); step: edit.
   - `backlog close <id> done|cancelled|superseded [--commit <sha>] [--by <ref>]` -> peer check, `hippo close`,
     then `link implemented_by git:<sha>` / `relates_to <ref>`; steps: close, optional link.
   - `decision new --title <t> --rationale-file <f>|- [--area <a>] [--relates <id>]… [--decides <id>]…` -> `hippo
     new decision --status active …`, `link <issue> decided_by <decision>` per `--decides`; steps: create, N links.
   - `decision supersede <old> …` / `adr supersede <old> …` -> `new`, `link <new> supersedes <old>`, `close <old>
     superseded`; three steps.
   - `adr new --title <t> --body-file <f>|- [--status active|open]` -> `hippo new adr`; `lesson new --title <t>
     --category build|debug|arch|env|api --body-file <f>|-` -> `hippo new lesson --area <category>`; one create.
   - `handoff new --title <t> --area <project> --body-file <f>|- [--decision-file <f>]… [--lesson-file <f>]…` ->
     `hippo new handoff-note --area <project> --status open`, then per file a child create (`key:<k>.<n>`) and
     its `relates_to` link to the note.
   - `handoff close <id>` -> `hippo close <id> done`. `where` prints the state. `flush [--drop <spool id>]`.
   - Write-time validation, both modes, before any hippo call or file write: the `backlog-entry.md` rules
     (required fields, caps, `bad_trigger_type`, effort, Problem language, peer: `origin:peer` needs `--reporter`
     and `--report`) via `scripts/lib/backlog-rules.js`, shared with `check-backlog-entries.js`. A violation exits
     3 naming the rule; nothing is written.
   - Closed field list: an unknown flag exits 2; no count/hits/uses/views field (KR-A3.5).
3. Files-mode matrix (one golden-file case each). Paths from `resolve-project-paths.sh` /
   `resolve-knowledge-routing.sh`, never literals; `<id>` is the file-native id (BL number, ADR number, knowledge
   heading, handoff path).

   | Subcommand | Files mode |
   |---|---|
   | `backlog new` | validate, number from `<!-- next-id -->`, append the heading row (Context and sidecar rules as `backlog-entry.md`), bump the mark, run `check-backlog-entries.js --backlog <file>` |
   | `backlog reply` | rewrite that row's Reply line; other lines byte-equal |
   | `backlog close … done` | peer check, delete row and sidecar (today's Done handling) |
   | `backlog close … cancelled` | peer check, `Status: dropped <date>` in place |
   | `backlog close … superseded --by <ref>` | peer check, delete the row (W14), print `superseded by <ref>` for the commit message |
   | `decision new` / `decision supersede <old>` | decision-ledger entry only (`decision-ledger.js append --kind decision --source project-record`, `supersedes: <old>` when superseding; untracked) + info line `record store: files; decision kept in the ledger only` |
   | `adr new` | `<adr dir>/NNNN-<slug>.md` from the template, next free number |
   | `adr supersede <old>` | `adr new` with `Supersedes: ADR-<old>`, old file's status line -> `Superseded by ADR-<new>` |
   | `lesson new` | append to `<knowledge_dir>/<category>.md` + INDEX line (today's format); no `git add -f` (separate asked step) |
   | `handoff new` | write/replace `<project dir>/HANDOFF.md` in today's layout; `--decision-file` -> 已決事項, `--lesson-file` -> 陷阱 |
   | `handoff close <path>` | delete that `HANDOFF.md` (today's Resume step 5) |
   | `flush` | exit 2 per §3.3 when the spool is non-empty, else 0 |
4. Resolvers and `project-detect.js` gain `record_store`.
5. Wiring (inventory row, grouped list, reference; SKILL table rows in A3.5) in the wiring commit.

Acceptance (`hooks/tests/project-record.test.sh` on `hippo-sandbox.sh`; temp-repo stores are made with `hippo
import` of a one-row fixture, P1.2's only store-creating command, until `hippo init` lands):
- sandbox sanity: `detect` returns `hippo`, not `spool` (catches missing actor or git identity);
- each subcommand in hippo mode yields the records/edges above (`show --json`), `hippo check` exits 0, every id is
  a 26-character ULID; each files-mode subcommand matches its golden file and `backlog new` passes the gate;
- validation: missing Problem, bad trigger type, peer row without reporter each exit 3 in both modes, nothing written;
- **parity**: a fixture row imported with `hippo import --from autopilot-backlog` into repo X and written by
  `backlog new` into repo Y give equal `show --json` except `id`, `created`, `updated`, `provenance`, `key:`;
  fixtures include a superseded row; needs P1.4 (until then `SKIPPED: P1.4 mapping`, and A3.7 cannot start);
- the five states, each red-checked by removing its check from `detect`; the `hippo-problems` case builds a store
  with hippo, then the harness corrupts one record file (a fixture simulating a hand edit, temp repo only) and
  asserts the file name on stderr;
- spool: two writes with `HIPPO_BIN` unset and `PATH` without hippo -> 2 spool files + warning; set `HIPPO_BIN`,
  run once -> 2 records, 0 spool files; two concurrent flushes of one spool -> exactly one record; an entry spooled
  in worktree A is not replayed from worktree B (each red-checked by removing the lock / the branch filter);
- step contract: `PROJECT_RECORD_FAULT=after-create|after-first-link|after-first-child|before-spool-remove` on
  `backlog new` (2 relates), `handoff new` (2 children), `decision supersede`: each rerun (flush or `--key` retry)
  ends with exactly the full set, no duplicate; each red-checked by removing the per-step key or edge lookup;
- a refused child (leak fixture in the second lesson file) leaves note + first child, prints both ids and the
  failed step, exits 3; a `--key` retry after the fix creates only the second child;
- flush in state `files` with a spool exits 2 naming the count, creates no `repo.toml`; session-start warns on the
  spool in states `files`, `hippo`, `spool`;
- `--target` of another repo refused without the flag; the plugin-dir case copies the plugin tree to a tempdir,
  points the resolver's plugin-root input there, asserts refusal, never names this checkout;
- read commands and `where` leave `git status --porcelain` unchanged; an unknown field exits 2.
Verify: `bash hooks/tests/project-record.test.sh`; `node scripts/affected-suites.js --run --files
scripts/lib/hippo.js,scripts/lib/backlog-rules.js,scripts/project-record.js,scripts/resolve-project-paths.sh,scripts/resolve-knowledge-routing.sh,scripts/project-detect.js`.

### A3.2 — text gate (S)

`scripts/check-hippo-writer-text.js [--root <dir>] [--json] [--allowlist <file>] [--enforce] [--held <unit>]`
scans `skills/**/*.md`, `references/**/*.md`, `agents/**/*.md`, `project-config-template/**/*.md`.
- **Rule A (hand-edit text)**, case-insensitive: an imperative verb (`add|append|write|record|open|file|create|
  edit|update|delete|remove|replace|move|register|put`) within 80 characters of a target: `BACKLOG(\.md)?`,
  `docs/backlog/`, `(the |project |a |an |to |in |into )backlog\b`, `backlog (row|entry|item|file)`, `docs/adr`,
  `ADR(\.md| file)`, `HANDOFF(\.md)?`, `\.claude/knowledge/`, `knowledge (file|entry)`. Lines split into clauses
  (`;`, `.`, `then`, `and`); a clause is not a finding only when its verb's object is `project-record.js` or
  `hippo search|related|show|list|export`, so a mixed line ("run `hippo show`, then edit HANDOFF.md") still is.
- **Rule B (counters)**: `hippo set` or `project-record.js` with `count|hits|uses|views`.
- **Rule C (required writers)**: the JSON's `required` list: `skills/dev-flow/SKILL.md`, `skills/think-tank/
  SKILL.md`, `skills/think-tank-dialectic/SKILL.md` must contain `project-record.js decision new` (W20, W21), and
  each W-row file its migrated `project-record.js <subcommand>`. Report mode prints rule C findings without
  changing the exit code.
- **W1/W9 templates**: no exemption; A3.5 moves them into the script (§3.1).
- **Allowlist** `{path, line_sha256, reason_class, reason}`, `reason_class` in `read-citation|history|deny-list`.
  `--seed-allowlist` writes it once in the A3.2 commit and refuses when it exists; `--update-allowlist` only
  removes; `--repin <path>:<line>` accepts a changed hash only when the line still has no verb near a target.
  `pending`: second shrink-only list, seeded with the baseline findings, tagged by ship unit.
- **Modes**: report (default) exits 0 when every finding is in `pending`, 1 on any other finding (no new hand-edit
  text lands while A3.5 is held); `--enforce` requires `pending` empty except `--held <unit>` entries and every
  required writer present. `validate.sh` runs report mode from A3.2 and `--enforce` from the A3.7 merge.
Acceptance (`hooks/tests/check-hippo-writer-text.test.sh`, fixture trees in a tempdir): one fixture per target
form (incl. W4, W12 wordings) exits 1 in both modes naming file:line; a file missing a required writer exits 1
under `--enforce`; a "names `project-record.js`" fixture and a clean fixture exit 0, while mixed read/hand-edit and
writer/hand-edit fixtures exit 1; an allowlist addition and a
`--repin` to a line that now has a write verb are refused; on the current tree report mode lists exactly the §3.1
set as `pending` and exits 0, `--enforce` exits 1. Each rule red-checked by deleting it.
Verify: `bash hooks/tests/check-hippo-writer-text.test.sh`; `node scripts/check-hippo-writer-text.js --enforce
--json > docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/gate-baseline.json` (exit 1 expected).

### A3.3 — import rehearsal on a scratch copy (S, needs hippo P1.4 incl. `hippo init`)

Run by the depth-0 session on a scratch clone in a tempdir, never this checkout, under C6: sandbox `HOME`;
`HIPPO_CONFIG_DIR` = tempdir seeded only with a copy of the operator's `leak-guard.toml` (leak refusals stay real;
the operator's `repos.toml` is never read or written); `HIPPO_ACTOR` and git identity set; env recorded in the
transcript header.
1. `git clone <autopilot> <tmp>/ap && cd <tmp>/ap`; `hippo init --id autopilot --visibility public` (C1).
   `.hippo/` lives only in the private dev repo, excluded from the release mirror (§8 Q3, wired in A3.7); records
   are still `public`, so leak refusals behave as for a public repo and a mirror slip exposes nothing more.
2. `hippo import --from autopilot-backlog <backlog>`; `--from adr-dir <adr dir>`; `--from handoff <dir>` per dir
   with a handoff (P1.4 filters `HANDOFF*.md`, sets `area`). Paths from `resolve-project-paths.sh` /
   `scripts/lib/repo-layout.js path`, so the 3.0.0 relayout needs no plan change.
3. Commit; run the imports again: `git status --porcelain -- .hippo` empty.
4. `hippo check`; `hippo list --kind issue --status open --limit 500` count equals the open rows from
   `check-backlog-entries.js --json`; five `hippo search BL-NNNN` spot checks; `check-backlog-entries.js --hippo
   --reconcile` reports no `backlog_unimported`.
5. Leak refusals are listed; each gets an owner decision in A3.7 (fix the source text or leave it only frozen).
Acceptance: KR-A3.3 on the scratch copy; transcript and skipped list in the evidence dir.

### A3.4 — scripts and hook in hippo mode (M)

1. `check-backlog-entries.js --hippo [--target <dir>]`: `backlog-rules.js` over `hippo export --json` (tags,
   bullets, caps, `bad_trigger_type`, peer rules incl. `peer_closed_unanswered`). `backlog_frozen` (block): each
   commit (pre-commit: staged vs `HEAD`; pre-push: every commit of `<remote sha>..<local sha>`, `origin/develop..`
   for a new branch, against its first parent) whose parent tree has `.hippo/repo.toml` and that changes or adds
   the backlog file, a sidecar, an ADR or a handoff file, whatever `detect` says; a commit deleting `repo.toml`
   (rollback) is exempt. Pre-push passes `--hippo` whenever `repo.toml` exists; without hippo, rules needing
   `export` report `hippo_unavailable` and block. `--reconcile`: every `BL-`/`ADR-` id in the frozen files needs a
   record with that provenance `value`, else `backlog_unimported` (block) naming ids; repair = provenance-keyed
   import of only those ids (P1.4 importer, idempotent, touches no existing record).
2. `admit-backlog-follow-ups.js`: `project-record.js backlog new --key <fingerprint16>`.
3. `check-plan-graduation.js`: check mode reads open issues from `hippo export --json` and matches Pointer bullets
   against shipped plans as it matches rows today (same codes); `--fix` -> `backlog close <id> done --by <plan>`
   (peer rule kept); no file edit.
4. `next-pick.js`: `hippo list --kind issue --status open --json --limit 1000`, tags mapped back to
   Effort/Trigger-Type; `backlog_digest` = SHA-256 of `data`.
5. `migrate-backlog-entries.js`: exits 2 in hippo mode ("the backlog is a hippo store; nothing to migrate").
6. `decision-ledger.js append --kind decision` with `reversibility: one-way`, only when `record_store` is `hippo`,
   `hippo-problems` or `spool` and the row lacks `source: project-record`: then `project-record.js decision new --key
   <sha256(ledger row id)[0:16]>` (row id in the body), so a repeat or dev-flow's own call is a no-op; a failure
   warns and never fails the append.
7. `hooks/hippo-edit-guard.js` (matcher `Edit|MultiEdit|Write|NotebookEdit|Bash`): exits 0 at once unless the
   target repo (top level of the tool path or Bash cwd) has `.hippo/repo.toml`, so store-less repos never spawn
   hippo. With hippo available: pipe the payload to `hippo hook claude-pretooluse`, return its verdict. Without:
   refuse Edit/Write/MultiEdit/NotebookEdit on a `.hippo` path and any Bash whose argv tokens or redirection name a
   `.hippo` path (reads too: without hippo the guard cannot tell a read from a write; the message points to `hippo
   show`); argv[0] = the hippo binary is allowed. Codex: `sync-codex-plugin-skills.sh` documents hippo's
   `harness/codex/hooks.toml`; unverified (D16/D20), pre-commit stays the authority (D21).
8. `hooks/session-start.js`: one line each for a non-empty spool (any state, count), `hippo-problems` (offending
   files), an unchecked-merge marker (step 9), a loaded plugin older than `.claude/record-store.json`
   `min_plugin_version`.
9. `scripts/hippo-git-hook.sh <pre-commit|pre-merge-commit|post-merge|post-rewrite>` (POSIX sh). No `repo.toml`:
   exit 0. Otherwise every commit and merge is checked, whatever paths it touches (C2). Hippo available: `hippo
   --json check` (exit 3: offending file passed through, refuse) then `exec hippo hook <name>` (exit code kept).
   Hippo missing: pre-commit and pre-merge-commit exit 1 (`hippo not found ($HIPPO_BIN / PATH); refusing a commit
   in a hippo store`); post-merge and post-rewrite (rebase, `pull --rebase`; cannot block) write `<git dir>/autopilot/
   hippo-unchecked` (per worktree, `git rev-parse --git-dir`) with the sha and print an error whenever they cannot
   check or the check fails (fast-forwards reach post-merge too); the next pre-commit in that worktree runs
   `hippo check` and clears it on exit 0, and every commit there is refused while it exists. A host without a
   working hippo cannot commit in a store repo (accepted cost; writes still spool).
Acceptance (`backlog-hippo-mode`, `hippo-edit-guard`, `hippo-git-hook` tests + existing suites, all on
`hippo-sandbox.sh`): each step has a hippo-mode case and an unchanged files-mode case. Negative controls, each
red-checked by reverting its hunk: bare `hippo close` on an unanswered peer record -> `peer_closed_unanswered`;
edits to the frozen backlog, an ADR and a handoff file after the store commit, with hippo present and hidden ->
`backlog_frozen`, while the store commit carrying the notices and a commit deleting `repo.toml` pass; a row
added after import -> `backlog_unimported`; graduation check mode reports an open issue pointing at a shipped plan;
Edit on `.hippo/ops/x.jsonl`, Bash `echo >> .hippo/ops/x.jsonl` and `sed -i` on a record, with and without hippo ->
refused; Bash in a repo without `repo.toml` -> allowed, no hippo spawned (spy binary); hippo hidden: a commit
staging `.hippo/` and one staging only an unrelated file refused, merges changing and not changing `.hippo/`
refused at pre-merge-commit, fast-forward and rebase write the marker and the next commit is refused, a check in
worktree B leaves worktree A's marker; hippo present: corrupted record -> pre-commit exit 3 naming the file; one-way ledger append: files mode one ledger
row, no recursion, hippo mode plus dev-flow's call one decision record; migrate in hippo mode exits 2;
session-start spool, problems, marker and `min_plugin_version` lines each red-checked by removing their check. Hook inventory and counts updated
(`scripts/check-hook-inventory.js`, `sync-version.js --hook-count`).
Verify: `bash hooks/tests/backlog-hippo-mode.test.sh`; `bash hooks/tests/hippo-edit-guard.test.sh`; `bash
hooks/tests/hippo-git-hook.test.sh`; `node scripts/affected-suites.js --run --files <every file of this phase>`;
`node scripts/check-hook-inventory.js`.

### A3.5 — skill and reference text (L, guidance; held for A5)

One commit per ship unit; every W-row changes.
1. `references/project-memory.md`: reads via `hippo list/search/related/show` (recipes = the KR1 shapes: tag,
   text, old number, relation, latest handoff by `created`); "never edit, `cat >`, `sed -i` or `git checkout` files
   under `.hippo/`; repairs are hippo commands (`resolve`, `relink`, `doctor --restore-ops`)"; what each state
   means for a reader.
2. Backlog unit: W1-W14, W17-W19 -> `project-record.js backlog …`; `/next` readers -> `hippo list --kind issue
   --status open --tag …` / `--ready`; `backlog-entry.md` gains §3.2.
3. ADR/decision unit: W9 (ADR), W20, W21.
4. Lesson unit (W16): destination question unchanged; publishable fact -> `lesson new`; dedup -> `hippo search <kw>
   --kind lesson`. The disclosure gate moves before the write: draft to a temp file, `node
   scripts/identifier-scan.js <file>`, ask (approve/edit/cancel), then `lesson new`. Both states write through
   the script; `git add -f` promotion stays a separate asked step, files mode only. Health audit adds `hippo check`.
5. Handoff unit (W15), both states only via `handoff new` / `handoff close`:
   - holder/progress -> `fleet task open "<goal>" --hippo <note ULID>` (courier records the holder) and `fleet
     task update <id> "<progress narrative>"`;
   - 已決事項 -> decision records; 陷阱 -> lesson records (via learn's gate in public repos); next-step reason, 下一步,
     驗證方式, Read-order (repo-relative only; the leak guard refuses home paths) -> note body, via `handoff new …
     --decision-file … --lesson-file …`;
   - the reply gives `hippo show <note ULID>` (same worktree) and the fleet task id;
   - Resume: `hippo list --kind handoff-note --area <project> --status open --fields created,title`, `hippo show
     <id>`, `fleet task show <task id>`; drift check unchanged; done = `handoff close <id>` + `fleet task close`;
   - no courier (`fleet whoami` fails): no holder; the script writes `holder: not observed (no fleet courier)`
     plus branch and last commit read from git; resume treats the holder as unknown (drift check); progress only
     as `narrative` in the next-step text.
6. "Available Scripts" rows for `project-record.js`; `skills/onboard/SKILL.md` names `record_store`.
Acceptance: on the A3.5 branch `check-hippo-writer-text.js --enforce` exits 0 with only the reasoned allowlist and
empty `pending`; reverting any one W-row hunk (W20, W21 via rule C) exits 1 (red-check script, transcript saved);
`scripts/check-guidance-eval.js` and `node scripts/doc-drift-gate.js` green; `git diff origin/develop --
'skills/*/SKILL.md' | grep '^[-+]description'` empty.

### A3.6 — KR1 through the skills (M, needs A3.3)

`scripts/check-kr1-skill-route.js --transcripts <dir> --queries <hippo repo>/bench/kr1-queries.md [--json]`: per
query (a) the answer contains every required id/title of "Answer contains", resolved on the scratch copy by the
grep arm's commands; (b) at least one `hippo` command and no Bash/Read naming the backlog file, sidecar dir or
ADR dir; tokens next to hippo's `docs/evidence/kr1-tokens/` baseline, info only. Ten headless cells (`claude -p`,
A3.5 plugin via `--plugin-dir`, cwd = the A3.3 scratch copy, one question each, no hippo hint).
Isolation (C6): sandbox `HOME` with no installed plugins or user settings; the Claude credential placed there by an
operator-run script as a 0600 file, never via chat or a model's view; `HIPPO_CONFIG_DIR` = the A3.3 temp dir. Each
transcript header records `HOME`, `HIPPO_CONFIG_DIR`, plugin dir and version; the checker refuses a transcript
lacking them, naming the operator's real `HOME`, or containing the credential file path or a token-shaped string;
cells run with a tool deny rule on the credential path.
Acceptance: KR-A3.2. Negative control: the same cells with the pre-A3 plugin fail (b);
`hooks/tests/check-kr1-skill-route.test.sh` (sandbox harness, planted transcripts: grep route, missing id, missing
header, credential path) is red on each.

### A3.7 — A5 handoff, ship and cutover (M)

To A5 (A5's plan owns pre-registration): units and skills (backlog: next, quality-pipeline, dev-flow, finish-flow,
project-lifecycle, doc-sync, ceo-agent refs, l5 refs; ADR/decision: project-lifecycle, dev-flow, think-tank,
think-tank-dialectic; lesson: learn; handoff: handoff); refs for `evals/skill-onoff/freeze-pack.js --skill <s> --ref
<sha>`; fixture pack `freeze-pack.js --scripts scripts/project-record.js,scripts/lib/hippo.js`; proposed markers:
write via `project-record.js`, no Edit on frozen files, KR1 answer check.
Ship rule: a unit ships only with ON >= OFF for every skill in it. Backlog, ADR/decision and handoff units ship
with the cutover (their old text writes files it freezes). Only the lesson unit may stay held (its target is
gitignored, not frozen): its W16 lines stay `pending` tagged `lesson` and validate runs `--enforce --held lesson`
until it ships.
Cutover preconditions: hippo P1.3 KR2 green; `hippo init`; the 3.0.0 relayout's private dev repo and release
mirror (§8 Q3 = A; until then the cutover waits, and committing the store to today's public repo needs a new
operator decision); the operator's go. Commits on a branch from `origin/develop`, in order:
1. **store**: the operator runs `hippo init --id autopilot --visibility public` at a tty; the depth-0 session never
   runs it in the real checkout (the guard refusing its attempt is expected); depth-0 then runs A3.3 steps 2-4 and
   commits `.hippo/`, hippo's guard files and the frozen notices (one line atop the backlog file, each ADR and
   handoff file: "frozen at <commit>; live records are in `.hippo/` (`hippo search`, `project-record.js`). A push
   refused with `backlog_frozen` came from a session on an older autopilot plugin: update the plugin, then refile
   each named row with `project-record.js backlog new`."); its parent has no `repo.toml`, so `backlog_frozen` passes.
2. **githooks**: the four chain lines; pre-push -> `check-backlog-entries.js --hippo --reconcile` with
   `backlog_frozen`; `.hippo/` dev-repo-only in `repo-layout.js` + a test that the release-mirror path list
   excludes it (red-checked by removing the registration); `.claude/record-store.json` with this release's version.
3. **guidance**: one commit per shipping unit + `validate.sh` -> `--enforce`.
4. **version**: PATCH bump + CHANGELOG, same merge.
Before the merge, re-run the imports (idempotent). The merge's pre-merge-commit and post-merge run `--reconcile`,
so a row landing in the frozen file after that re-import, or with the merge, blocks or is reported as
`backlog_unimported`; repair as A3.4 step 1. No whole-file re-import after the freeze (it could overwrite hippo-side
changes).
Old plugins: skill text comes from the loaded plugin, not `develop`; hosts working in this repo install the bump as
part of the cutover; until then `session-start` warns (A3.4 step 8) and `backlog_frozen` at pre-push catches file
edits, with refile steps in the notice.
Windows: `project-record.js where` + one `backlog new` + `flush` on a native Windows host (host from env/config),
transcript saved; while hippo's native run is open it shows `spool` and the warning, not silence (and commits there are refused).
Rollback, in order: (1) `hippo list --since <cutover date> --history --json > <evidence dir>/rollback-records.json`
before the revert; (2) `git revert -m 1 <merge>` (skill text, hooks, gates); (3) the operator refiles the export
with `project-record.js backlog new` (files mode); (4) spool: `flush` exits 2 in files state, `session-start` keeps
warning, the operator re-applies from the spool JSON through `project-record.js` or runs `flush --drop`. The frozen
files changed by one line only, so the backlog file is live again. These steps go in the merge message.
Acceptance: KR-A3.1..A3.6 transcripts in the evidence dir; merge message carries the QC verdict and A5 report path.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| writer | `bash hooks/tests/project-record.test.sh` (HIPPO_BIN set), red-check per state and fault point | script |
| text gate | `bash hooks/tests/check-hippo-writer-text.test.sh`; per-W-row revert red-check | script |
| scripts, hook, git hooks | `bash hooks/tests/{backlog-hippo-mode,hippo-edit-guard,hippo-git-hook}.test.sh`, `node scripts/affected-suites.js --run --files <changed>` | script |
| isolation | every suite on `hooks/tests/lib/hippo-sandbox.sh`; its exit trap fails on any change to this checkout | script |
| full suite before each merge to develop | `bash hooks/tests/run.sh` once, alone, on one host | script |
| import | A3.3 transcript (KR-A3.3) | script + human read |
| KR1 through skills | A3.6 cells + `check-kr1-skill-route.js` | script |
| ON/OFF | A5 report | script (A5) |
| cutover | operator's go; Windows transcript | human-gated |

## 6. Risks + inversion

Guaranteed failure would be: a writer still editing files; a fallback that writes nowhere or splits the truth; old
skill text against a frozen backlog; importer and writer disagreeing; shipping guidance without evidence.

| Risk | Mitigation |
|---|---|
| Hand-edit text survives | text gate rules A/C, per-W-row red-check; allowlist only shrinks |
| Bare `hippo close`/`set` skips autopilot rules | `check-backlog-entries.js --hippo` at pre-push |
| `.hippo/` edited by hand or shell | guard (delegates; refuses itself without hippo) + hippo journal/`body_sha` (D21) |
| hippo missing / Windows | writes spool loudly (branch-bound, locked); commits and merges in a store repo fail closed; per-worktree marker |
| Bootstrap bypasses the CLI | only the operator's `hippo init` (P1.4 input); guard refuses a session's attempt |
| Replay duplicates or loses a step; partial write after refusal | step contract (§3.3), fault points per step type |
| Importer/writer drift | one mapping (§3.2); parity test blocks A3.7 |
| Old skills against frozen files | one merge; plugin bump + `min_plugin_version` warning; `backlog_frozen` + refile notice |
| Rows land between rehearsal and cutover | re-import before merge; `--reconcile` at the merge; no whole-file re-import after |
| A test reaches the checkout or operator config | sandbox harness, `HIPPO_BIN`, plugin-dir copy, exit trap |
| `reported_by` refused (courier = host name) | message id + `reporter:` tag kept; link skipped with a warning (§8 Q1) |
| Merge safety unproven | cutover waits for P1.3 |
| Unimported `.claude/knowledge/` lessons | stay as they are; new lessons go to hippo (§8 Q2) |
| 3.0.0 relayout moves paths | all paths from resolvers / `repo-layout.js` |
| Records leak publicly | `.hippo/` dev-repo-only (§8 Q3); `visibility = "public"`; leak guard incl. per-user `leak-guard.toml`; learn's disclosure gate |
| Counters creep in | closed fields + rule B; counters belong to A1 |
| Decision ledger drift | ledger stays telemetry; only `one-way` rows filed, with the ledger row id; failure warns only |

## 7. Out of scope

- Plans and project tracking files (`docs/plans/`, `docs/projects/`) as hippo records; they stay files.
- Retiring the frozen files (operator's call, parent §2.6).
- Request intake, `reported_by` from fleet requests, anomaly cards, `fleet watch` (A4).
- The events contract and any usage counter (A1); signed decision answers (F4 / A4 / C1).
- The `/clear` machine-snapshot hook; importing `.claude/knowledge/` (§8 Q2).
- hippo in repos other than autopilot (each runs A3.3 itself; parent §8 order).
- Any change to hippo itself; gaps go to hippo as P1.4 inputs (so far: §3.2 mapping incl. `superseded`, handoff
  `HANDOFF*` filter and `area`, `hippo init --id --visibility`; once `init` exists, `new`/`import` refuse without `repo.toml`).

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
  CONDITIONAL); 21 findings, 11 blocking; all 11 blockers accepted, all 10 non-blocking folded, none refuted.
  Dispositions: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g1-dispositions.json` (each lists its change).
  New hippo input: `hippo init --id --visibility` (P1.4). Rubric unchanged (frozen).
- R1.1 2026-11-02: size trim for the generation-2 growth limit (constraints labelled C1-C9 and cited instead of
  restated; tables and prose condensed). No requirement, acceptance item, verify command or dependency dropped;
  §2.5 global block, rubric and dispositions untouched.
- G2 2026-11-02: plan review generation 2 (terminal, at cap) = CONDITIONAL (openai STOP, google READY, anthropic
  CONDITIONAL); 14 findings, 5 blocking. Depth-0 accepted all 5 blockers; all 9 non-blocking folded, none refuted.
  Dispositions: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g2-dispositions.json`. Rubric and §2.5 unchanged.
- Review artifacts: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g1-artifact.json`, `.g2-artifact.json`. A first g2 dispatch stopped on `plan_growth_hard_stop` (1.506x, zero seats); plan shrunk in b01b94726 and the lock reopened per the dispatch-plan-review.js recipe. Receipt: `check-phase-review-receipt.js --plan-file <plan at b01b94726> --plan-artifact <g2 artifact> --dispositions <g2 dispositions>` exit 0 (2026-11-02). Generation 2 terminal at the cap: sol STOP, argon READY, opus CONDITIONAL; all 5 g2 blockers accepted and folded in 257f0a573 (not seat-reviewed).
