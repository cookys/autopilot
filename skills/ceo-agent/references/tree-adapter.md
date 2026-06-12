# Tree Adapter — CEO Agent

Full procedure for the task-tree engine adapter. The SKILL.md section "Tree
Adapter (task-tree engine)" is the authoritative entry point; this document
carries all operational detail.

> **Sources**: `references/tree-contracts.md` (event schemas, invariants),
> `references/model-routing.md` §"Tree roles" (Amendment 11 routing),
> `docs/plans/2026-06-12-task-tree-engine.md` §P6 + Amendments 6, 8, 9.

---

## 1. Detection — is the tree active?

At CEO startup AND at each phase boundary, check:

```bash
test -d "docs/projects/<proj>/tree"
```

- **Directory absent** → legacy path. Zero behavior change. Stop here.
- **Directory present** → tree is ACTIVE for this project. Proceed to §2.

The `<proj>` identifier is the project directory name under `docs/projects/`
(e.g. `2026-06-12-task-tree-engine`).

---

## 2. Authority gate (Amendment 6 — binding)

Before operating in tree-active mode, determine the authority level:

```bash
scripts/tree.sh board-status <proj>
```

| Output | Mode | Meaning |
|--------|------|---------|
| `.active == true` | **Post-signoff (active)** | Tree is authoritative for decisions (`present` AND `decision == "graduate"`) |
| `.present == true`, `.active == false` | **Dual-run (shadow)** | A signoff event exists but its decision was not "graduate" (extend/abort) — recorded, NOT activating |
| `null` / error | **Dual-run (shadow)** | Tree records in parallel; TaskCreate stays authoritative |

> **Non-CC fallback**: if `scripts/tree.sh` is not available, scan the event log directly:
> `jq 'select(.type=="board_signoff" and .decision=="graduate")' docs/projects/<proj>/tree/events.jsonl`
> — non-empty output = post-signoff, empty/missing = shadow.

**Dual-run mode**: emit lifecycle events as normal (§4), but continue using
TaskCreate forcing functions as the authoritative decision source. The tree
is a passive record. Do NOT route decisions through `tree.sh next-decision`.

**Post-signoff mode**: decisions flow from `tree.sh next-decision`. TaskCreate
tasks may still exist as checkpoints but are NOT the decision authority. See
§3 for the full post-signoff loop.

---

## 3. Post-signoff decision loop

Repeat at each decision point:

1. **Fetch next decision**:
   ```bash
   scripts/tree.sh next-decision <proj>
   ```
   Output is compact JSON: `{node, question, options[], evidence_pointers[]}`.
   This is the manager's ONLY default input. Never read work content directly.

2. **DOA adjudication** — run `scripts/resolve-doa.sh` on the action if
   needed. Record outcome with a `doa_decision` event (§4.4).

3. **Adjudicate DOA outcome**:
   - Within DOA → decide autonomously; emit `decision_resolved` with the
     `decision_id` returned by `next-decision`.
   - Beyond DOA → emit `escalation_opened` with `question`, `options`,
     and `evidence_pointers`; pause and present a Board Decision block to
     the user; emit `escalation_resolved` after Board responds.

4. **Emit the resolution** (choose one):
   ```bash
   # Decision resolved autonomously:
   scripts/tree.sh emit <proj> <node-id> \
     '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"decision_resolved","decision_id":"<id>","chosen":"<option>"}'

   # Escalation resolved after Board input:
   scripts/tree.sh emit <proj> <node-id> \
     '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"escalation_resolved","escalation_id":"<id>"}'
   ```

5. **Repeat** — call `next-decision` again. When it returns null / empty,
   all pending decisions are resolved for this phase.

**KR1 rule**: the manager MUST NOT read work products directly on the happy
path. Every out-of-band artifact read MUST go through:
```bash
scripts/tree.sh fetch <proj> <node-id> --raw
```
`fetch --raw` emits a `manager_raw_read` event automatically. Any other Read
or Bash that consumes work content is a KR1 violation visible in the retro
transcript audit (§7).

---

## 4. Event emission cheat-sheet

Emit events via `scripts/tree.sh emit`. All payload fields are TOP-LEVEL —
never nest under a `data` key.

### 4.1 `node_created`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"node_created",
    "parent":"<parent-id-or-null>","question":"<text>","options":[],"evidence_pointers":[]}'
```

### 4.2 `delegated`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"delegated"}'
```

### 4.3 `verdict`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"verdict",
    "verdict":"approved","confidence":0.9}'
```
`confidence` is required (0.0–1.0). `verdict` must be non-empty.

### 4.4 `doa_decision`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"doa_decision",
    "action":"merge-to-develop","tier":"reversible","outcome":"autonomous"}'
```

### 4.5 `escalation_opened`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"escalation_opened",
    "escalation_id":"<id>","question":"<text>","options":["A","B"],"evidence_pointers":[]}'
```
Escalations must be decision-complete: `question` + `options` +
`evidence_pointers` must be sufficient for the manager to adjudicate without
calling `fetch --raw`. If raw content is required, the escalation is
under-specified.

### 4.6 `escalation_resolved`
```bash
scripts/tree.sh emit <proj> <node-id> \
  '{"schema_version":1,"ts":"<iso>","node":"<node-id>","type":"escalation_resolved",
    "escalation_id":"<id>"}'
```
Omit `escalation_id` only to bulk-resolve all open escalations on the node
(documented fallback; prefer targeted resolution).

---

## 5. Depth policy (Amendment 8)

v1 depth limit:

| Depth | Role | Default tier |
|-------|------|--------------|
| 0 | Manager | Fable-class |
| 1 | Sub-orchestrator | opus/sonnet-class |
| 2 | Worker | sonnet-class or hetero flash-class |

No depth-3 delegation without a separate Board decision that names the bound
(≤3) and the escalation rule. Do not propose depth-3 speculatively.

---

## 6. Model routing (Amendment 11)

Per `references/model-routing.md` §"Tree roles":

| Tree role | Default tier |
|-----------|-------------|
| Manager (depth 0) | **Fable-class — NEVER dispatched as a delegate** |
| Fable escalation triggers | top-fork adjudication, panel-dissent arbitration, DOA changes, Board interface ONLY |
| Sub-orchestrator (depth 1) | opus/sonnet-class |
| Planner / researcher | sonnet-class |
| Implementer | sonnet-class or hetero flash-class (Gemini) |
| QC panel judges | flash/haiku-class, cross-family |
| Synthesizer | deterministic script + haiku-class pass |

All values are factory defaults, locally calibratable. Per-tier token spend
appears in `scripts/calibration.sh report` (P5) so routing economy is auditable.

Use `scripts/resolve-dispatch.sh` for the actual model/mode JSON; do NOT
hardcode model names in skill prompts.

---

## 7. KR1 measurement (Amendment 9)

KR1 ("manager context correlates with decisions, not artifacts") is measured
by **post-hoc transcript audit**, not self-reporting:

- The P6 reviewer performs a retro-style scan of the manager session
  transcript for any work-product reads outside `tree.sh fetch --raw`.
- P4 shadow period logs a manager-read baseline so the P6 report is a
  **delta** (before vs. after), not an absolute claim.
- Every `fetch --raw` call emits a `manager_raw_read` event in the tree;
  the reviewer counts these against the transcript to confirm the log is
  complete.

The manager does not self-certify KR1. If the reviewer finds an unlocked
work-product read, it is a KR1 violation regardless of justification.

---

## 8. Legacy path (KR5)

When `docs/projects/<proj>/tree/` does not exist:

- All existing behavior is unchanged.
- No tree events are emitted.
- TaskCreate forcing functions remain the sole orchestration mechanism.
- Zero impact on users not opting in.

The tree is opt-in until graduation criteria are met (see `scripts/calibration.sh`
and `docs/BACKLOG.md` "graduation Board review" entry).

---

## 9. Initialization (first use on a project)

To opt a project into the tree:

```bash
scripts/tree.sh init <proj>
```

This creates `docs/projects/<proj>/tree/events.jsonl` with a `tree_initialized`
event. The tree immediately enters dual-run (shadow) mode. Post-signoff mode
requires a `board_signoff` event emitted after the Board approves graduation
(see §2).

After init, emit the root node:
```bash
scripts/tree.sh emit <proj> root \
  '{"schema_version":1,"ts":"<iso>","node":"root","type":"node_created",
    "parent":null,"question":"<project-OKR-question>","options":[],"evidence_pointers":[]}'
```
