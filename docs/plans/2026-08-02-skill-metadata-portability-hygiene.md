---
status: frozen-for-execution
date: 2026-08-02
size: L
entry_level: l5
project: backlog-actionable-successor
---

# Skill metadata portability and documentation capacity hygiene

## Background and admission

This evidence-first portability deliverable groups three related backlog surfaces and one discovered
documentation defect:

- `skills frontmatter tier:` is executable only after real Claude Code and Codex plugin-load probes;
- `CLAUDE.md` is now exactly 40,000 bytes, so any inventory expansion required by the admitted R6/review
  work triggers the existing capacity entry;
- OpenCode 1.17.15 must be re-probed before check 16 can return to hard-fail;
- the current deterministic doc gate proves the Codex residual backlog source link still points at the
  pre-archive project path.

Fresh depth-0 evidence on 2026-08-02 already shows OpenCode discovery remains nondeterministic: three
successive `opencode debug skill` calls found `dev-flow` 0/1/0 times. Therefore this plan records the
failed recovery probe and retains the advisory; it does not authorize hardening check 16.

## Deliverable contract

### Platform probes and conditional tier migration

1. `scripts/probe-skill-frontmatter-portability.sh --check` builds disposable plugins containing one
   valid skill plus an unknown `tier:` frontmatter field inside a caller-owned, mode-0700 `mktemp -d`
   attempt directory.
2. Load the real disposable plugin through installed Claude Code 2.1.220 and Codex 0.146.0 using their
   supported local marketplace/install surfaces. Each CLI invocation must set its task-specific config
   and cache roots in the same shell invocation. Record exact commands, versions, exit codes, component
   discovery, warnings, and before/after inventories without modifying user plugin state permanently.
3. Only if both runtimes discover and load the skill with unchanged name/description/body may canonical
   skills receive `tier: core|delegation|pioneer`, using the already-published `docs/skills.md` grouping.
4. If either probe fails or is inconclusive, write the evidence, leave every skill frontmatter byte
   unchanged, and retain the backlog entry. A probe-only terminal is a valid honest outcome.
5. On a pass, regenerate Codex package mirrors mechanically and assert exact canonical/mirror parity.

The probe owns teardown of only its exact attempt directory. It writes a terminal residue receipt listing
every remaining path (an empty list is success), and preserves raw logs plus SHA-256 digests until terminal
QC. It must never delete a shared config root, rely on ambient user plugin state, or infer success from an
install exit code without proving skill discovery.

### OpenCode disposition

Keep check 16 advisory. Hard-fail restoration requires a future repeated full-corpus membership proof
plus a planted missing-skill negative control. The observed 0/1/0 sequence is recorded as current trigger
evidence, not hidden by the retry's occasional green result.

### Documentation capacity, script inventory, and link repair

- This node's new probe script unconditionally requires a `CLAUDE.md` inventory row. Before adding it,
  relocate incident/history detail to its canonical reference and restore at least 1,000 bytes of
  post-change headroom without dropping a script name, call condition, or canonical pointer. Wire the
  probe into the `skills/harness-maintenance/SKILL.md` Available Scripts table and regenerate its Codex
  mirror. The existing membership/line/whole-file gate remains authoritative.
- Repair the residual-spike backlog source to its archived project path and prove the deterministic link,
  fence, and script-reference gate is green.
- Do not add a compatibility parser or platform-specific skill copy.

## Acceptance criteria

- Claude Code and Codex probe receipts are reproducible, version-bound, residue-free, and classify the
  tier migration as `pass`, `fail`, or `inconclusive` without inference.
- `probe-skill-frontmatter-portability.sh --check` returns 0 for any well-formed, reproducible,
  residue-free terminal classification (`pass`, `fail`, or `inconclusive`); it returns non-zero for
  malformed evidence, contamination/residue, missing real-runtime execution, or receipt inconsistency.
  Thus `--check` validates evidence truth, not a desired dual-pass outcome.
- A tier migration occurs only on dual pass; if it occurs, every canonical skill has exactly one allowed
  tier and every generated Codex mirror is byte-equivalent to its source.
- OpenCode check 16 remains advisory in this generation, with the 0/1/0 evidence recorded and no false
  claim that upstream truncation is fixed.
- `CLAUDE.md` contains the new probe inventory row, stays within its membership gates, and has at least
  1,000 bytes of post-change headroom; the harness-maintenance script table and Codex mirror agree.
- `node scripts/doc-drift-gate.js .`, portability meta-smoke, structural validation, all sync checks, and
  the complete suite pass.
- A whole-diff independent panel finds no unresolved Critical or Major issue.

## Execution binding

- Mission node: `skill-metadata-portability-hygiene`.
- Dependencies: none. It may be admitted in the first batch with R6, but the controller runs the two
  first-batch nodes serially through the same foreman lineage so they never become parallel writers.
- Gate-attempt budget: 3 total attempts, including initial verification and any repair re-run.
- Repair-generation budget: 2. Every repair resumes this node's same foreman/implementer transcript and
  immutable base; a failure must not create a new node, graph, ticket, branch lineage, or model seat.
- Resource reservation: 1 campaign, 7,200 wall seconds, 250 tool calls, 1 engine seat, 1,800 seconds of
  blocking wait, 100 owned paths, and 8,000,000 retained evidence bytes.
- Exact acceptance command set:

  ```bash
  bash scripts/probe-skill-frontmatter-portability.sh --check
  bash hooks/tests/skill-frontmatter-portability.test.sh
  node scripts/check-claude-md-inventory.js
  node scripts/doc-drift-gate.js .
  bash hooks/tests/preflight-meta-smoke.test.sh
  bash hooks/tests/preflight-adapter-invariant.test.sh
  bash scripts/preflight-portability.sh
  bash scripts/validate.sh
  bash scripts/sync-all.sh --check
  AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
  ```

The probe script and its focused test are authorized creates for this node. Their absence before
implementation is not a waived acceptance condition: both must exist and pass before the node can close.
This node owns its probe script/test, mandatory `CLAUDE.md` inventory/headroom edit,
`harness-maintenance` script-table row and mirror, conditional tier metadata/mirrors, evidence receipt,
and the exact stale pre-archive link correction already proven by `doc-drift-gate`. Among shared
lifecycle documents it may change only that exact link; it cannot change backlog disposition or
lifecycle state. The downstream review-path node owns semantic backlog, changelog, project-index, and
project-closeout reconciliation.

## Dependencies and compatibility impact

The implementation depends only on the installed real CLIs, POSIX shell utilities already used by the
repository, the canonical skill grouping in `docs/skills.md`, and existing sync/validation scripts. It
does not add a runtime dependency. Unknown-frontmatter tolerance is treated as observed platform behavior,
not a compatibility promise. No backward-compatibility parser or alternate schema is introduced.

## Risks and rollback

- A probe can contaminate user state if isolation is incomplete. Mitigation: task-specific roots,
  before/after inventories, exact-path teardown, and a residue receipt. Any residue or ambiguous inventory
  delta makes the probe inconclusive and blocks migration.
- A runtime may accept installation but ignore the skill. Mitigation: require exact component discovery
  and body/name checks, not install exit status alone.
- Bulk metadata could drift from generated mirrors. Mitigation: apply only after dual pass, regenerate
  mechanically, and require whole-tree parity.
- Capacity edits could remove operational instructions. Mitigation: retain the inventory/membership gate
  and review the whole diff. Rollback is the node's same-lineage repair to the immutable base; no release or
  external state is involved.

## Open questions and terminal rules

- If either CLI cannot be isolated through its supported local surface, classify the probe
  `inconclusive`, retain the backlog entry, and continue only the independent link/capacity hygiene.
- This node itself expands `CLAUDE.md`; therefore capacity migration and the 1,000-byte post-change
  headroom are unconditional in this frozen packet, independent of the platform classification.
- OpenCode hardening is explicitly unavailable this generation regardless of an occasional green retry.
  Its current negative evidence is recorded during closeout and the backlog trigger remains banked.

## Scope boundary

In scope: disposable platform probes, conditional canonical tier metadata, deterministic generated
Codex mirrors, `CLAUDE.md` capacity hygiene when triggered, exact broken-link repair, evidence/docs,
and backlog/project closeout.

Out of scope: OpenCode check-16 hardening in this generation, new skill categories, skill routing
behavior, description changes, payload lifecycle migration, compatibility shims, version bump, release,
push, or external publication.

## Review synthesis

| Lens | Finding incorporated |
|---|---|
| Architect | Make tier migration conditional; a failed platform probe must not block unrelated hygiene. |
| QA/Skeptic | Preserve OpenCode advisory after nondeterministic evidence and require a planted negative before future hardening. |
| Ops/SRE | Restore document headroom before new inventory surface and keep probe/install residue bounded. |
