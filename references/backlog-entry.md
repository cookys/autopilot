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

Several reporters on one row: `；`-separated in Reporter, Report and Reply, positionally aligned (`cuda；openclaw` · `msg_01…；2026-09-05 fleet` · `2026-09-06 msg_01…；none`).

**Row cap**: 900 B for a row with only legacy fields; **1600 B** for a row carrying any of Since…Impact (an Id alone keeps a legacy row at 900 B and counts toward its pointer threshold). Nothing but these fields — an extra bullet, sub-list or code fence is `extra_content`.

**Required**: Title/Status/Trigger/Effort/Source/Pointer always. Trigger-Type is required for new entries: once a file uses the field (or `required_fields` names it), every entry needs one line `- **Trigger-Type**: <value>` directly under Trigger. A file that never mentions it is unchanged. Id, Since, Origin, Problem, Impact only when the config lists them (default: optional, so a project with legacy rows and no config sees no change). Reporter/Report/Reply are required whenever Origin is `peer`.

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
