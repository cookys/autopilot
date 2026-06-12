# Tree Contracts — Task-Tree Engine v1

Canonical schemas for the append-only JSONL event log, node report, and
related structures. All consumers (tree.sh, check-node-report.sh, QC panel,
downstream skills) MUST treat this document as the single source of truth.

> **Supersedes**: inline comments in scripts/tree.sh (tree.sh comments are
> informational; any conflict with this document is a bug in tree.sh).

---

## 1. Intent / State boundary

The tree separates human-authored intent from machine-emitted execution state.
These two domains have **zero field overlap**:

| Domain | Owner | Lives in | Examples |
|--------|-------|----------|---------|
| INTENT | Human (author) | Project README / OKR docs | OKRs, scope boundary, constraints, success criteria, non-goals |
| EXECUTION STATE | Machine (tree.sh) | `docs/projects/<proj>/tree/` | Phases, statuses, decisions, verdicts, escalations, DOA log |

When a project opts into the tree, README templates lose any execution-status
fields (current status, active phase, blocking items). Those fields move
exclusively into the tree's event log and derived index.

---

## 2. Event envelope

Every event emitted via `tree.sh emit` MUST carry these four fields at the
**top level** of the JSON object:

| Field | Type | Constraint |
|-------|------|-----------|
| `schema_version` | integer | Must equal the current schema version (currently `1`) |
| `ts` | string | ISO-8601 UTC timestamp, e.g. `"2026-06-12T14:30:00Z"` |
| `node` | string | Node identifier; must match the `<node-id>` argument to `emit` |
| `type` | string | One of the event types enumerated in §3 |

The envelope is validated by `tree.sh emit` before appending. Events that fail
validation are rejected and nothing is written.

**Single-line rule**: each event must be a single JSON line with no embedded
newlines. The JSONL format requires this for append-safe parsing.

---

## 3. Event types

### 3.1 `tree_initialized`

Emitted exactly once by `tree.sh init`. Bootstraps the event log.

| Payload field | Type | Notes |
|---------------|------|-------|
| `proj` | string | Project name (same as the `<proj>` argument to `init`) |

### 3.2 `node_created`

Declares a new node in the tree.

| Payload field | Type | Notes |
|---------------|------|-------|
| `parent` | string or null | Parent node ID; `null` for root-level nodes |
| `question` | string or null | The decision question this node addresses |
| `options` | array | Candidate answer strings (may be empty) |
| `evidence_pointers` | array | Evidence pointer strings — see §5 |

> **CRITICAL — top-level field rule**: `question`, `options`, and
> `evidence_pointers` are read from the event **top level** by the index fold
> in `tree.sh`. Do NOT nest them under a `data` key. A `data`-nested object
> will be silently ignored and the fields will default to `null`/`[]`.

### 3.3 `delegated`

Marks the node as handed off to a delegate agent. No required payload beyond
the envelope.

### 3.4 `doa_decision`

Records a Degree-of-Autonomy adjudication. The entire event object (including
all payload fields) is appended to the node's `doa_log[]` array in the index.

| Suggested payload field | Type | Notes |
|------------------------|------|-------|
| `action` | string | Action being adjudicated |
| `tier` | string | DOA tier (e.g. `"reversible"`, `"external"`) |
| `outcome` | string | `"autonomous"` or `"escalate"` |

### 3.5 `escalation_opened`

Opens a manager escalation on the node.

| Payload field | Type | Notes |
|---------------|------|-------|
| `escalation_id` | string or null | Unique escalation identifier; if absent, synthesized as `<node>:<ts>` |
| `question` | string or null | The question requiring manager input |
| `options` | array | Candidate answer strings |
| `evidence_pointers` | array | Evidence pointer strings — see §5 |

> **Top-level field rule applies**: `question`, `options`, `evidence_pointers`
> must be at the event top level, not nested under `data`.

### 3.6 `escalation_resolved`

Closes a previously opened escalation.

| Payload field | Type | Notes |
|---------------|------|-------|
| `escalation_id` | string or null | If present, resolves ONLY the entry with this id. If absent/empty, resolves ALL open escalations for this node (bulk fallback) |

**Resolution semantics**: the fold is ID-targeted when `escalation_id` is
provided — exactly the escalation with the matching id is resolved (others
remain open). If no `escalation_id` is given, all open escalations for the
node are closed simultaneously (documented bulk fallback, not a bug).

### 3.7 `verdict`

Records the final verdict on a node. Sets node status to `"complete"`.

| Payload field | Type | Notes |
|---------------|------|-------|
| `verdict` | string or null | Human-readable verdict (e.g. `"approved"`, `"rejected"`) |
| `confidence` | number or null | 0.0 – 1.0 float. Required for verdict-bearing nodes; `null` is accepted by the fold but rejected by the report validator |

> **Top-level field rule applies**: `verdict` and `confidence` must be at the
> event top level.

### 3.8 `node_report`

Submits a full node report (the artifact that `check-node-report.sh` validates).
Sets the node's `report`, `artifact_paths`, `evidence_pointers`, and
`artifact_sha256` fields in the index.

| Payload field | Type | Notes |
|---------------|------|-------|
| `artifact_paths` | array | List of `{path, sha256}` objects — see §4 |
| `evidence_pointers` | array | Evidence pointer strings — see §5 |
| `artifact_sha256` | string or null | Legacy single-artifact SHA256 (retained for backward compat); prefer `artifact_paths[].sha256` |
| `doa_log` | array | Copy of DOA decisions at report time (optional; index's `doa_log` is authoritative) |
| `escalations` | array | Copy of escalations at report time (optional; index's `escalations` is authoritative) |

> **Top-level field rule applies**: all fields above must be at the event top
> level.

### 3.9 `decision_fork`

Records an unresolved decision point (a fork). Added to the index's
top-level `decisions[]` array.

| Payload field | Type | Notes |
|---------------|------|-------|
| `decision_id` | string or null | Unique decision identifier; if absent, synthesized as `<node>:<ts>` |
| `question` | string or null | The fork question |
| `options` | array | Candidate options |
| `evidence_pointers` | array | Evidence pointer strings — see §5 |

> **Top-level field rule applies**.

### 3.10 `decision_resolved`

Marks a decision fork as resolved.

| Payload field | Type | Notes |
|---------------|------|-------|
| `decision_id` | string or null | If present, resolves ONLY the entry with this id. If absent/empty, resolves ALL open forks for this node (bulk fallback) |
| `chosen` | string or null | The chosen option |

**Resolution semantics**: the fold is ID-targeted when `decision_id` is
provided — exactly the fork with the matching id is resolved (others remain
open). If no `decision_id` is given, all open forks for the node are closed
simultaneously (documented bulk fallback, not a bug).

### 3.11 `manager_raw_read`

Emitted automatically by `tree.sh fetch <proj> <node> --raw`. Logs the fact
that the manager explicitly fetched raw artifact content (an escalation valve
event tracked for KR1 measurement).

| Payload field | Type | Notes |
|---------------|------|-------|
| `proj` | string | Project name |

---

## 4. Node report schema

The **node report** is the artifact validated by `scripts/check-node-report.sh`.
It is a JSON object (typically a standalone file, also embeddable as a
`node_report` event payload) with these fields:

| Field | Type | Required | Constraint |
|-------|------|----------|-----------|
| `node` | string | yes | Node identifier |
| `verdict` | string | yes | Non-empty |
| `confidence` | number | yes | 0.0 – 1.0 inclusive |
| `evidence_pointers` | array | yes | Non-empty for verdict-bearing reports (see §5) |
| `artifact_paths` | array | yes | Each element is `{path: string, sha256: string}` |
| `doa_log` | array | yes | May be empty; each element is a `doa_decision` event object |
| `escalations` | array | yes | May be empty; each element is an escalation object |

**Verdict-bearing report rule**: a report that carries a non-null `verdict`
MUST also have at least one `evidence_pointer`. A verdict with an empty
`evidence_pointers` array is invalid (claims must be spot-checkable without
reading the work).

---

## 5. Evidence pointer types (Amendment 2 — binding)

Evidence pointers are string-encoded references to the specific evidence that
supports a claim. Three pointer types are defined:

### 5.1 `file:line-range` pointer

Points to a specific range of lines in a source file, anchored to a commit SHA.

**Canonical text form**: `<path>:<start>-<end>@<commit-sha>`

Examples:
- `scripts/tree.sh:141-168@a1b2c3d` — lines 141–168 of tree.sh at commit `a1b2c3d`
- `references/tree-contracts.md:1-10@HEAD` — first 10 lines at HEAD (only valid at HEAD; use a real SHA for stable references)

Resolution rules:
1. If `@<commit-sha>` is present and a git repo is available, resolve via
   `git show <sha>:<path>` and validate the line range against the file content
   at that commit.
2. If the SHA is absent or unknown and a working tree is available, fall back
   to the working-tree file with a `pointer_stale` WARNING.
3. Line range `<start>-<end>` is 1-based, inclusive. `<start>` must be ≥ 1;
   `<end>` must be ≤ the file's line count.

### 5.2 `sha256-only` pointer

Points to a binary artifact or any content identified only by its hash (no
line range meaningful).

**Canonical text form**: `sha256:<hex>`

Example: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

Resolution rules:
1. Format check: `sha256:` prefix + exactly 64 lowercase hex characters.
2. No working-tree file lookup is required for this pointer type (content is
   identified by hash, not by path).

### 5.3 Moved-file resolution

When a `file:line-range` pointer's path does not exist in the working tree,
`check-node-report.sh` operates in one of two modes depending on whether a
commit-SHA anchor is present:

**Mode A — SHA anchor present** (`<path>:<start>-<end>@<sha>`):
1. Compute the original content hash: `git show <sha>:<path> | sha256sum`.
2. Search `git ls-files` candidates; for each, compare its `sha256` against
   the original content hash. Basename candidates are checked first
   (optimization), then the full tracked-file list.
3. **Content-hash match found** → emit `pointer_stale` WARNING
   (`warnings[]`) and continue (exit 0); pointer is still resolvable.
4. **Same-basename candidate found but content differs** (and no content-hash
   match anywhere) → FAILURE (invalid); the basename match would be a
   false positive.
5. **Not found anywhere** → validation FAILURE.

**Mode B — No SHA anchor** (content-hash search impossible):
1. Fall back to basename heuristic: search `git ls-files` for a tracked file
   with the same basename.
2. Match found → emit `pointer_degraded_basename_match` WARNING (`warnings[]`)
   and continue (exit 0); content is unverified.
3. No basename match → validation FAILURE.

**Never silently pass a moved-file case.** A `pointer_stale` or
`pointer_degraded_basename_match` warning is the minimum required signal.

**Update the script header** (`check-node-report.sh` lines 18-25) to document
this two-mode behavior when modifying pointer resolution logic.

---

## 6. Index schema (`index.json`)

`index.json` is a **derived, rebuildable** file (gitignored). It is
reconstructed deterministically from `events.jsonl` by `tree.sh rebuild-index`.
Its schema is informational — consumers should use `tree.sh` subcommands, not
read `index.json` directly.

| Top-level field | Type | Notes |
|-----------------|------|-------|
| `schema_version` | integer | Matches `SCHEMA_VERSION` in tree.sh |
| `rebuilt_at` | string | ISO-8601 UTC timestamp of last rebuild |
| `events_hash` | string | SHA256 of all valid complete events (determinism signal) |
| `event_count` | integer | Number of valid complete events processed |
| `truncated_tail` | object or null | Tombstone for a partial last line; see §7 |
| `nodes` | object | Map of `node_id → node_state` |
| `escalations` | array | Top-level list of all escalation objects (open and resolved) |
| `decisions` | array | Top-level list of all decision forks (open and resolved) |

---

## 7. Truncated-tail tombstone

When `rebuild-index` detects that the last line of `events.jsonl` has no
trailing newline (indicating a partial write, typically from a `kill -9` during
`locked_append`), it records a tombstone in the index rather than silently
dropping the evidence:

```json
{
  "truncated_tail": {
    "byte_offset": 4096,
    "content_hash": "<sha256-hex>",
    "partial_content": "{\"schema_version\":1,\"ts\":\"...",
    "detected_at": "2026-06-12T14:30:00Z"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `byte_offset` | integer | Byte position where the partial line begins |
| `content_hash` | string | SHA256 of the partial content (for forensics) |
| `partial_content` | string | The raw bytes of the partial line |
| `detected_at` | string | Timestamp of the rebuild that detected the truncation |

A **silent drop** (partial line discarded without recording the tombstone) is a
contract violation and counts as a test failure in the acceptance matrix.

---

## 8. `schema_version` evolution

- `schema_version` is stamped **per event** in the envelope (not once per file).
- Consumers must reject events with an unknown schema version (fail-closed).
- Future schema changes that require migration go in `migrations/` as lazy
  scripts (named `migrate-v<N>-to-v<N+1>.sh`). Migrations are opt-in per
  project and never run automatically.
- The current schema version is `1`.

---

## 9. File locations

| File | Disposition | Notes |
|------|-------------|-------|
| `docs/projects/<proj>/tree/events.jsonl` | git-tracked | Source of truth; append-only |
| `docs/projects/<proj>/tree/events.jsonl.lock` | not tracked | flock sidecar; auto-created |
| `docs/projects/<proj>/tree/index.json` | gitignored | Derived; rebuildable via `rebuild-index` |

---

## 10. Invariants

1. **Append-only**: `events.jsonl` is never modified after a line is written.
   Corrections are new events (e.g. `verdict` supersedes a prior `verdict`
   by setting the node's state to the latest value).
2. **Flock**: all appends use `flock -x -w 10` on the `.lock` sidecar.
   Concurrent emitters are safe; a failed lock acquisition aborts the emit
   (never a silent partial write).
3. **Index rebuildability**: `index.json` can always be reconstructed from
   `events.jsonl` by running `tree.sh rebuild-index`. Consumers MUST NOT
   rely on the index file surviving across sessions.
4. **Decision completeness**: escalations must carry enough information
   (`question`, `options`, `evidence_pointers`) that the manager can
   adjudicate without fetching raw artifacts. If the manager must call
   `fetch --raw` to understand the escalation, the escalation is
   under-specified.
