---
name: doc-sync
description: >
  Audit docs against actual code and find drift (wrong / stale / missing claims), report-only.
  Use when: "do the docs match the code", "check for doc drift", "audit docs vs code", "did
  this change make docs stale", "doc-sync", "文件跟 code 同步嗎", "查文件有沒有過時",
  "對照文件與實作", post-merge doc verification, periodic doc accuracy sweep. Two modes —
  scoped (cheap, the modules this diff touched) and full (expensive, whole-repo). Not for:
  WRITING docs from scratch, fixing a single known typo, or build/test correctness
  (→ quality-pipeline). Report-only — surfaces findings; you triage + fix.
---

# Doc-Sync (Doc↔Code Drift Audit)

**A dispatcher + methodology for detecting documentation that no longer matches the code.**
Report-only: it finds drift and grades it; it does **not** edit. You triage and fix per the
policy below. Docs silently rot as code changes — this makes the rot visible on demand.

## Project Config (auto-injected)
!`cat .claude/doc-drift-config.md 2>/dev/null || true`
!`cat .claude/dispatch-config.md 2>/dev/null || true`

If no `doc-drift-config.md` above, derive domains on the fly (see Domains) and tell the user
a config would make future runs sharper. Template:
[`project-config-template/doc-drift-config.md`](../../project-config-template/doc-drift-config.md).

## Two modes — pick by trigger and cost

| Mode | Cost | When |
|------|------|------|
| **scoped** | cheap (~1–3 agents) | **Default.** End of L-size work / post-merge. Audits only the docs describing the modules *this diff* touched. Pass a base ref (default `main`/`develop`). |
| **full** | EXPENSIVE (many agents/tokens) | Whole-repo sweep across all domains. OFFER (don't auto-run) when a change touches user-facing behavior OR 3+ modules; or periodically (e.g. >30 days since last). |

Never run either as a blocking per-commit gate. It is a doc-sync aid, orthogonal to
build/test correctness (those belong to `quality-pipeline`).

## Dispatch (portable; first available wins)

Read `.claude/dispatch-config.md` → `## Doc Drift Audit` chain. Pick the first available entry.

1. **A project-supplied auditor** (e.g. a Claude-Code `Workflow` script the project ships at
   `.claude/workflows/doc-*.js`, or a project skill). Use it only if its tool is available —
   the `Workflow` tool is **Claude-Code-only**, so this is a fast path, not a requirement.
2. **`native`** (always available, the portable default): fan out subagents yourself via the
   `## Parallel Dispatch` chain (or one Task call per domain). This is the canonical path and
   works on every platform.

If no chain is configured, use `native`.

## Domains (the audit unit)

A *domain* = a slice of docs + the code that backs it (e.g. "memory pipeline", "install/hooks",
"CLI surface", "phase status"). Take domains from `doc-drift-config.md` if present; otherwise
derive them from the repo: group related doc files (README, guides, specs) with the source
dirs/modules they describe. For **scoped** mode, restrict to domains whose code the diff touched.

## Method (native dispatch — mirror this when using a project auditor)

Per domain, run **find → verify → grade**:

1. **Find** (one agent per domain, in parallel): read the domain's docs, then verify every
   factual claim against the actual code. Emit findings as
   `{doc_file, location, severity, claim, actual, evidence(file:line)}` where severity ∈
   `WRONG` (contradicts code) / `STALE` (was true, now outdated) / `MISSING` (code has
   important behavior the docs omit). Empty list if accurate.
2. **Verify** (one skeptic per finding, in parallel): adversarially re-check — open the cited
   `file:line` AND the doc location independently; default to **refuted** unless the drift is
   real. If the finder's "actual" is itself imprecise, mark **uncertain** with the correction.
   Kill false positives here — this step is what makes the report trustworthy.
3. **Grade + report**: keep `confirmed` findings, group by severity, report counts + each
   finding. Surface `uncertain` separately. Do not edit anything.

Scoped mode = the same, but a single finder over just the changed modules' docs (cheap).

## Fix policy (after the report — you triage each confirmed finding)

- **User-facing docs** (README / CLAUDE.md / concept guides / getting-started / env examples /
  CHANGELOG) → always correct to current code reality. They must not lie to users.
- **Specs / design docs** (often the single source of truth):
  - pure **STALE** (code is the desired state) → fix the spec text to match code.
  - genuine **design-target-not-yet-built** → KEEP the design, mark it
    `⚠️ NOT YET IMPLEMENTED`, and open a BACKLOG item so code can catch up. Don't delete intent.

Apply fixes as a normal edit + review pass (this skill does not edit for you).

## Integration

- **dev-flow / finish-flow**: at L-size doc-sync (finish-flow L-5.4 Post-Merge Review),
  run **scoped** mode if user-facing behavior / 3+ modules changed; OFFER **full** mode for
  big changes. See [dev-flow `post-feature-doc-sync.md`](../dev-flow/references/post-feature-doc-sync.md).
- **periodic**: track last full sweep in `.claude/doc-audit-state.json` (`last_full_audit`);
  offer **full** mode when stale (project config sets the threshold).

## Anti-patterns

| Wrong | Right |
|-------|-------|
| Run **full** mode on every commit | full is periodic / big-change only; default to scoped |
| Make doc accuracy a blocking quality gate | it's a doc-sync aid, orthogonal to build/test |
| Hard-depend on the `Workflow` tool | `Workflow` is CC-only; `native` dispatch is the portable default |
| Trust finder output without the verify step | adversarial verify kills false positives — never skip it |
| Auto-edit specs to match code | specs may encode intent — STALE → fix, design-target → mark + BACKLOG |
| Report raw findings without grading | group by WRONG/STALE/MISSING; surface uncertain separately |
