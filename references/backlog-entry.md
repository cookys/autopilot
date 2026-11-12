# Backlog entry schema

A backlog entry is an **index row**: what, for whom, when it fires, size, who saw it, where evidence lives. Measurements, logs, stacks, decision narratives and more than one sentence of context live **at the pointer**. Preferred pointer targets, in order: an existing `docs/plans/…` file, an existing `docs/projects/…` file, a ticket id matching `id_pattern`, a sidecar `docs/backlog/<slug>.md`.

Caps are UTF-8 **bytes**. The instrument is `scripts/check-backlog-entries.js`; a consumer config may only **lower** a cap.

## Fields

| Field | Cap | Rule |
|---|---|---|
| Id | — | `BL-NNNN`, permanent: never renumbered, never reused. Below the file's `<!-- next-id: BL-NNNN -->` high-water mark and unique. The format is enforced only once the file opts in (a next-id mark, or Id in `required_fields`); before that any Id is accepted, as the legacy gate did |
| Title | 120 | one line; unique per file case-insensitively; no trailing period |
| Status | 64 | `open` · `fired <YYYY-MM-DD>` · `shipped <version-or-sha> <YYYY-MM-DD>` · `dropped <YYYY-MM-DD>` |
| Since | — | `YYYY-MM-DD` the row first appeared |
| Origin | — | `peer` (someone outside this repo's sessions reported it) · `owner` · `self` |
| Reporter | — | Origin=peer: who reported it (display) |
| Report | — | Origin=peer: the report's message id, or `<YYYY-MM-DD> <channel>` |
| Reply | — | Origin=peer: `none` · `unknown` · `<YYYY-MM-DD> <message id or pointer>` |
| Problem | 300 | 正體中文 plain-language problem for the owner: no backticks, file paths or `name:line` |
| Impact | 160 | what happens if it is never done |
| Trigger | 240 | one line; for `fired` rows the date replaces the condition |
| Trigger-Type | — | one line directly under Trigger. `date:YYYY-MM-DD` fires that day · `owner` waits for an owner decision or reply · `event` waits for an external or future event a machine cannot judge · `ready` the trigger already happened, or the work can start now · `peer` waits for an external reporter or a host release. When unsure, choose `event`. Do not guess `ready` |
| Effort | — | `XS` · `S` · `M` · `L` · `XL`, optional urgent suffix `!` (alias `急`) |
| Source | 160 | who/what surfaced it |
| Pointer | 200 | an existing path under `pointer_roots`, or an id matching `id_pattern`; `none` only when the seven legacy fields (Title…Context, not the reporter fields) total ≤ 600 B |
| Context | 240 | optional one-liner |
| Done-Check | 200 | queue-form. One backticked command. The linter never runs it: the first token is `node`, `bash`, `sh`, `git`, `test`, `grep`, `python3` or `npm`, or a relative path that exists under the repo root and does not escape it. Prose (`TBD`, `manual`, `n/a`) is `done_check_unrunnable` |
| Artifact | — | queue-form. `code` · `text` · `run` |
| Needs | 120 | queue-form. `none`, or `;`-separated `resource:<slug>`, `card:d-` plus exactly 8 lowercase hex digits, `engine:<slug>`. A slug matches `[a-z0-9][a-z0-9._-]*`. Printed for the allocator; READY does not judge it |
| after | 120 | queue-form, optional. The field label is exactly `after`. `;`-separated `BL-NNNN` ids |
| Due | 64 | queue-form, optional. A due time. See Due time below. Absent means the row states none |
| ms | 64 | queue-form. A milestone-step token `[a-z0-9][a-z0-9._-]{0,63}` |
| Used-by | 120 | queue-form. `user` · `e2e` · `n/a <reason of 8 or more characters>` |
| Queued-By | 120 | queue-form. `<ns>/<courier>/<member> <message-id>` or the same address followed by `self` |
| Prompt | 200 | `Artifact: text` only. One existing relative path that does not escape the repo root |
| Inputs | 300 | `Artifact: text` only. `;`-separated existing relative paths, at least one |
| Feeds | — | `Artifact: text` only. One Id of a row in the same file |

Several reporters on one row: `；`-separated in Reporter, Report and Reply, positionally aligned (`cuda；openclaw` · `msg_01…；2026-09-05 fleet` · `2026-09-06 msg_01…；none`).

**Row cap**: 900 B for a row with only legacy fields; **1600 B** for a row carrying any of Since…Impact (an Id alone keeps a legacy row at 900 B and counts toward its pointer threshold); **2400 B** for a queue-form row. A config may only lower a cap (`queue` included). Nothing but these fields — an extra bullet, sub-list or code fence is `extra_content`.

**Required**: Title/Status/Trigger/Effort/Source/Pointer always. Trigger-Type is required for new entries: once a file uses the field (or `required_fields` names it), every entry needs one line `- **Trigger-Type**: <value>` directly under Trigger. A file that never mentions it is unchanged. Id, Since, Origin, Problem, Impact only when the config lists them (default: optional, so a project with legacy rows and no config sees no change). Reporter/Report/Reply are required whenever Origin is `peer`.

**Queue-form**: a heading row that carries any of Done-Check, Artifact, Needs, after, Due, ms, Used-by, Queued-By, Prompt, Inputs or Feeds. Those fields are always read; they are not part of the reporter-field opt-in. A checklist line that names one is `extra_content`. A table column that names one is not read. Required in addition to the legacy required fields: Id, Done-Check, Artifact, Needs, ms, Used-by, Queued-By. `Due` is not in that required list. Effort must be `XS`, `S` or `M` (an urgent suffix is allowed); `L` or `XL` is `effort_too_large`. An empty required value is `missing_field`. For `Artifact: text`, Prompt, Inputs and Feeds are required (`text_row_missing_inputs` when one is absent or a path does not exist). For `code` or `run` those three must be absent (`extra_content`). A legacy row that carries none of the queue-form fields is unchanged.

**Opt-in**: Since, Origin, Reporter, Report, Reply, Problem and Impact are read only in a file that opts in — a `<!-- next-id -->` mark, or the field in `required_fields` (Reporter/Report/Reply follow a required Origin). Until then every style parses the entry exactly as the legacy gate did: in a heading or checklist entry such a line is `extra_content`, in a table such a column is ignored, and every check (the pre-push `--range` rule and `check-plan-graduation.js` included) sees that legacy entry. Opting in through `required_fields` is per field: listing Since alone makes Since a read field while an Origin line in the same entry is still `extra_content`; only the next-id mark opts in every field at once. Id keeps its own rule (BL-NNNN only after the same opt-in). A file written by `--to-reporter-fields` carries the mark.

```markdown
<!-- next-id: BL-0043 -->

### Final panel terminal-stops instead of parking
- **Id**: BL-0042
- **Status**: open
- **Since**: 2026-10-03
- **Origin**: peer
- **Reporter**: cuda
- **Report**: 01M416P22N8XA90FX5YC8AQ3GV
- **Reply**: 2026-10-03 session 74f6f85f:394
- **Problem**: 最終審查只要有一點意見，整個自動化流程就直接終止，無法暫停等人處理後再接續。
- **Impact**: 每次都得重跑整個流程，成本高。
- **Trigger**: next managed campaign whose final panel returns a finding
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED cuda 2026-10-03
- **Pointer**: docs/backlog/final-panel-parking.md
```

A queue-form code row (no `after`; Prompt, Inputs and Feeds stay absent):

```markdown
<!-- next-id: BL-0002 -->

### Queue a code row
- **Id**: BL-0001
- **Status**: open
- **Trigger**: when the fixture runs
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: self-test
- **Pointer**: docs/plans/ok.md
- **Done-Check**: `node scripts/check-backlog-entries.js --self-test`
- **Artifact**: code
- **Needs**: none
- **ms**: d1.queue
- **Used-by**: e2e
- **Queued-By**: ns/c/m self
```

## READY

`node scripts/check-backlog-entries.js --backlog <file> --ready` adds `ready` and `ready_count` to the JSON report (Id, Title, Artifact, Needs, ms, Feeds). The lint exit is unchanged, so a clean file with zero READY rows still exits 0.

`isReady(entry, ctx)` (`ctx = {entries, nextId}`) is true only when Status is exactly `open`, Trigger-Type is exactly `ready`, the row is queue-form with no blocking violation, and every `after` id is satisfied. An id is satisfied when that row is absent and its number is below the file's next-id mark, or the row exists with Status `shipped`. Status `dropped` is `after_broken`. An id that is malformed, at or above the next-id mark, or absent when the file has no next-id mark, is `after_broken`. A cycle, including a self-reference, is `after_cycle`; the detail names the cycle (`BL-0002 -> BL-0003 -> BL-0002`, or `BL-0001 -> BL-0001`). An open or fired predecessor is not broken and is not satisfied. `Needs` is not judged here.

## Due time (PADDED_DEADLINE)

A READY-shaped row (Status exactly `open`, Trigger-Type exactly `ready`, queue-form) or a dispatch brief that states a due time longer than 2× its Effort, and states no checkable dependency, is `PADDED_DEADLINE` (PM 01M78CC2). Exactly 2× is clean. The comparison is strict: the span in milliseconds is greater than `multiplier × effort hours × 3600000`.

The span is measured from the row's `Since`. A `YYYY-MM-DD` start or due is UTC midnight of that day. On a brief or a fleet reply, `Start` is preferred over `Since` when both are present, and `Deadline` is read as `Due` when `Due` is absent. A duration (`16h`, `90m`, `1d`, `2h30m`, `1.5h`) is already a span and does not need a start. A row or text that does not state a parseable due, or whose Effort or start cannot be measured, is not flagged. Status other than `open`, or Trigger-Type other than `ready`, is not flagged. A brief or reply that omits Status and Trigger-Type is judged, because it is not a backlog row.

`paddedDeadline` in `scripts/lib/backlog-rules.js` is the one function. The lint calls it from `checkEntry`. `scripts/dispatch-hetero.sh` calls it on the original brief, before skill-pack or scaffold text is prepended. On a hit it returns the brief to the dispatcher with `die_precondition`: status `precondition_failed`, `dispatcher_called` false, and `error` beginning with `PADDED_DEADLINE` plus the function's detail. A lane that reports a due time back calls the same export.

Effort hours are a planning budget. `references/stage-graph.json` names the sizes and does not state hours. This table is the one in `EFFORT_HOURS`:

| Size | Hours |
|---|---|
| XS | 1 |
| S | 4 |
| M | 8 |
| L | 24 |
| XL | 40 |

The urgent suffix (`!` / `急`) does not change the hours. A brief may also state Effort as an explicit number of hours (`4h` or `4`). A backlog row may not: `Effort: 4h` stays `bad_effort`.

A dependency counts only when a `Needs` or `after` value has a `;`-separated token that is, as a whole token, one of:

- a backlog id `BL-NNNN` (4 or more digits)
- a card id `d-` plus exactly 8 lowercase hex digits, with an optional `card:` prefix
- a named resource `resource:<slug>`, the same slug `Needs` already uses (`[a-z0-9][a-z0-9._-]*`). A bare word is not a resource
- a task id `task:<id>` (`<id>` is the dispatch task-id charset) or a 26-character Crockford ULID

One such token is enough. `none` and `engine:` do not count. Free text does not count: `tomorrow`, `"tomorrow"`, and `see BL-0123` are not dependencies. `Needs: BL-0123` is still `bad_needs` (Needs tokens stay `none`, `resource:`, `card:`, `engine:`); it does clear `PADDED_DEADLINE`. The schema-valid place for a backlog id is `after`.

The code is blocking, so a flagged row is not listed by `--ready`.

## Codes

| Code | Level | Meaning |
|---|---|---|
| missing_field | block | a required field (above) is absent |
| bad_id | block | Id not `BL-NNNN` (heading/checklist; only with a next-id mark or Id required) · Id ≥ next-id · next-id mark malformed · BL Ids with no mark while Id is required |
| duplicate_id | block | two rows share an Id (heading rows: only with a next-id mark or Id required) |
| bad_since | block | Since is not a real `YYYY-MM-DD` |
| bad_trigger_type | block | Trigger-Type is not `owner` / `event` / `ready` / `peer` / `date:YYYY-MM-DD` |
| bad_trigger_date | block | Trigger-Type `date:` is not a real calendar date |
| bad_origin | block | Origin is not peer/owner/self |
| bad_reply | block | a Reply part is not `none` / `unknown` / `<date> <pointer>` |
| peer_field_missing | block | Origin=peer without Reporter/Report/Reply, or their `；` counts differ |
| peer_closed_unanswered | block | Origin=peer, Status shipped/dropped, some Reply part none/unknown/missing |
| problem_has_identifier | warn | Problem carries a backtick, path or `name:line` |
| peer_report_lost | block (pre-push) | see Deletion protection |
| cap_exceeded, pointer_missing, pointer_required, pointer_unresolved, extra_content, bad_status, bad_effort, duplicate_title, done_not_moved, unparseable_entry, config_raises_cap | block | unchanged legacy codes |
| effort_too_large | block | queue-form Effort is `L` or `XL` (urgent suffix included) |
| done_check_unrunnable | block | Done-Check is not one backticked allow-listed command or an existing relative path |
| bad_artifact | block | Artifact is not `code`, `text` or `run` |
| bad_needs | block | Needs is not `none` or the `;`-separated token list |
| bad_ms | block | ms is not a milestone-step token |
| bad_used_by | block | Used-by is not `user`, `e2e` or `n/a <reason of 8 or more characters>` |
| bad_queued_by | block | Queued-By is not `<ns>/<courier>/<member> <message-id>` or the same address plus `self` |
| text_row_missing_inputs | block | `Artifact: text` is missing Prompt, Inputs or Feeds, or a path does not exist |
| after_cycle | block | `after` ids cycle, including a self-reference; the detail names the cycle |
| after_broken | block | an `after` id is malformed, at or above next-id, absent with no next-id mark, or Status `dropped` |
| feeds_broken | block | Feeds is not an Id of a row in this file |
| PADDED_DEADLINE | block | a READY-shaped row, or a dispatch brief, states a due time longer than 2× its Effort and names no checkable dependency. Exactly 2× is clean |

`block` follows the config `mode`; with no config the gate runs in `warn` and never fails.

## Deletion protection (peer rows)

A peer report is not closed until the reporter has an answer.

1. **File gate** (pre-commit, every run): `peer_closed_unanswered`.
2. **pre-push** (`.githooks/pre-push` → `check-backlog-entries.js --range <base>..<head>`): for each pushed ref the range is `<remote_sha>..<local_sha>` (new remote branch: `origin/HEAD..<local_sha>`, whole history when origin/HEAD is unknown); a range that never touched the backlog is skipped; a remote sha missing from the clone is skipped with a printed line. Without a config (warn mode) violations are printed and the push goes through. The BACKLOG is parsed at **every commit** in the range, base included. Each (Id, Report) pair keeps the Reply of its **last** appearance. A pair absent at head whose last Reply is none/unknown/missing is `peer_report_lost` — this also covers one reporter dropped from a surviving row. The only exit is the **Id string** in HEAD's `docs/plans/**`, `CHANGELOG.md`, or another BACKLOG row (a matching Report string does not count). The file gate also runs on the pushed head blob, so a merge that produced a duplicate Id or an Id ≥ next-id is caught.
3. **`check-plan-graduation.js --fix`** never deletes a peer row with an unanswered Reply unless the plan it points to names its Id; it reports `peer_row_unanswered` (block) instead.

## Done handling

BACKLOG is a queue — a row exists only while nothing else owns the item. `shipped` / `dropped` rows are `done_not_moved` immediately (`done_retention_days` default 0), and a row whose Pointer resolves to an existing `docs/plans/*.md` is redundant once the plan exists. The fix is **deleting the row** (history stays in git and at the pointer). If its Pointer names `docs/backlog/<slug>.md` and no remaining row mentions that file, delete the sidecar in the same change; `check-plan-graduation.js --fix` does both mechanically (subject to the peer rule above), and `check-backlog-entries.js` blocks an orphan sidecar (`sidecar_orphan`).

## Frozen evidence — `.frozen-evidence`

The archive passes (`check-plan-graduation.js --fix`, `--archive`, `--migrate-archive-layout`) rewrite `docs/plans/<stem>` paths in tracked files. Files whose bytes a seal or digest pins are skipped automatically; evidence frozen only by convention needs a tracked marker file named `.frozen-evidence`:

- One path per line, relative to the marker's own directory. A file freezes that file; a directory freezes every tracked file under it; `.` freezes the marker's whole directory. Blank lines and `#` comments are ignored. The marker file itself is frozen too.
- A line that escapes the marker's directory (`..`, an absolute path) is ignored — a marker cannot freeze files outside its own tree.
- Every skipped file that mentions the graduating or migrated path is reported as `plan_reference_frozen` (report-only, all three passes), so the stale mention is visible instead of silent.
- Deleting a marker un-freezes its evidence. `check-plan-graduation.js --frozen-base <git-ref>` reports `frozen_marker_deleted` (report-only, exit unchanged) for every marker present at `<ref>` and gone from the working tree; pass the merge base (e.g. `origin/develop`) before archiving.

## Config — `.claude/backlog-config.md`

```markdown
## Style
- style: heading
## Mode
- mode: block
- required_fields: Id, Since, Origin, Problem, Impact
## Caps
- Problem: 200
- row: 1200
```

`required_fields` may also be a `## Required Fields` section with one bullet per field; only Id, Since, Origin, Problem, Impact, and Trigger-Type are accepted. Other keys: `id_pattern`, `allowlist_path`, `done_retention_days`, `## Pointer roots`, and for table conversion `## Columns` / `## Status map`.

## Styles

A file declares one style in the config; the gate parses all three.

**heading** — `### Title` then `- **Field**: value` bullets (this repo).

**table** — `| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |` rows (reporter fields may be added as columns); the table `Id` matches `id_pattern`. Several tables may repeat the header; `\|` in a cell is a literal pipe. Foreign headers are converted once by `migrate-backlog-entries.js` via `## Columns` (`- 標題: Title`) and `## Status map` (`- planned: open`); rows the schema cannot hold move verbatim to a sidecar; an unmapped status word goes to a sidecar and `--apply` refuses without `--allow-unmapped-to-sidecar`; an unmapped header is a plan-time `unmapped_column` error.

**checklist** — `- [ ] [Severity] Title` plus indented `- Field: value`. Severity is a tag, not a field.

## Migration

`node scripts/migrate-backlog-entries.js --backlog <file> --to-reporter-fields --drafts <json> [--replies <md>] [--out <file>]` is a **dry-run** that adds the reporter fields (Id in file order, Since from the first commit that added the heading, Problem/Impact from drafts with a `(draft)` suffix) and lists unmatched rows and peer rows without Reply evidence. It never writes the backlog.
