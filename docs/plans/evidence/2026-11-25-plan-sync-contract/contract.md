# Plan-Sync Snapshot Contract (S3A ↔ S3F)

Version: `plan-sync:v1`

This document defines the JSON snapshot contract written by `scripts/plan-to-tasks.js --sync` into the parent fleet task (via `fleet task comment <parent-id> <json>`) and consumed by fleet S3F.

## Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `schema` | `string` | yes | Always `"plan-sync:v1"`. |
| `plan_path` | `string` | yes | Repository-relative path to the plan markdown file (e.g. `"docs/plans/2026-11-25-foo.md"`). |
| `parent_task_id` | `string` | yes | Fleet parent task ID holding this snapshot. |
| `synced_at` | `string` | yes | ISO-8601 UTC timestamp when the sync snapshot was generated. |
| `phases` | `Array<PhaseEntry>` | yes | Ordered list of phases from the plan's `phases:v1` table. |
| `untracked` | `Array<string>` | yes | Phase IDs present in the plan with no matching fleet task. |
| `dispatchable` | `Array<string>` | yes | Subset of `untracked` whose `depends_on` phases are all completed (`done`/`closed`) on fleet. |

### `PhaseEntry`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Phase identifier from `phases:v1` (e.g. `"P1"`). |
| `size` | `string` | yes | One of `XS`, `S`, `M`, `L`, `XL`. |
| `depends_on` | `Array<string>` | yes | List of prerequisite phase IDs (empty array if `-`). |
| `needs_look` | `boolean` | yes | Parsed from `needs_look` (`yes` -> `true`, `no` -> `false`). |
| `title` | `string` | yes | Phase title. |
| `task_ids` | `Array<string>` | yes | Fleet task IDs claiming this phase (supports 1-task-to-many-phases). |
| `status` | `string` | yes | Aggregated status: `"untracked"`, `"pending"`, `"in_progress"`, or `"done"`. |

## Example JSON

```json
{
  "schema": "plan-sync:v1",
  "plan_path": "docs/plans/2026-11-25-example.md",
  "parent_task_id": "01JEXAMPLEPARENT0000000000",
  "synced_at": "2026-11-26T00:00:00.000Z",
  "phases": [
    {
      "id": "P1",
      "size": "S",
      "depends_on": [],
      "needs_look": false,
      "title": "Define contract",
      "task_ids": ["01JEXAMPLECHILD10000000000"],
      "status": "done"
    },
    {
      "id": "P2",
      "size": "M",
      "depends_on": ["P1"],
      "needs_look": true,
      "title": "Implement sync",
      "task_ids": [],
      "status": "untracked"
    }
  ],
  "untracked": ["P2"],
  "dispatchable": ["P2"]
}
```
