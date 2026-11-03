# Plan — Import the excellent parts of addyosmani/agent-skills into autopilot

**Date**: 2026-06-24
**Status**: CONVERGED v3 (post-dialectic Round 2 — Architect/Ops/Skeptic agree: build E1+E2+O2, inline, zero new files)
**Source**: study of `addyosmani/agent-skills` (4-agent parallel survey, 2026-06-24)

> **Round-1 dialectic verdict (Architect + Ops + Skeptic, independently convergent):** the original
> 4-core plan repeated the 2026-06-04 thin-slice pattern. After verification the real yield is **two small
> inline edits to existing files — zero new skills, hooks, or agents.** This is NOT a tracked project.
> The original Core/Optional tiers are preserved below the line as the rejected record (with the kill reason),
> so the reasoning isn't lost. The live plan is the two edits in "Converged scope" + a BACKLOG note.

## Converged scope (the only things to build)

### E1 — "doubt-theater" anti-rubber-stamp signal → one clause in `references/blind-dispatch.md`  · Effort S

**What**: Add a single forcing-function clause: *across 2+ blind re-dispatch cycles where the reviewer
surfaced substantive findings, if ZERO were classified actionable, you are validating — not doubting; treat
that as a signal to harden the next dispatch, not to pass.* This is the **only genuinely-new atom** from the
studied `doubt-driven-development` skill — every other pillar (CLAIM-stripping, artifact-only handoff,
default-refuted-if-uncertain) is already shipped in `blind-dispatch.md` clause 1 + the v2.24.0 `qc-panel.sh`
refute pass.

**Honesty constraint (Ops R1)**: label it a **self-audit prompt**, NOT a "checkable signal" — it is
forcing-function prose, not a mechanized counter. If we ever want it deterministic, route the cycle count
through a `risk-counter.sh`-style persistent counter (separate, deferred decision).

**Landing**: `references/blind-dispatch.md` (one clause). No new file (respects `skill-refactor-rules`).

### E2 — OWASP LLM Top-10 block → `agents/reviewer.md` security axis  · Effort S

**What**: Add an LLM-threat bullet block to the reviewer's **existing** Security axis: model output as untrusted
data, prompt-injection-as-trust-boundary, excessive agency, unbounded consumption. **The only verified gap** —
the rest of the studied `security-auditor` persona (STRIDE/IDOR/SSRF/secrets) is already in reviewer.md's
security axis and the deep specialist pass is deliberately delegated to native `/security-review`
(`agents/reviewer.md:70` — a recorded decision a new persona would REVERSE).

**Why it's a real gap**: autopilot itself dispatches LLM agents; zero LLM-Top-10 content exists anywhere today
(Skeptic-verified). Relevant to autopilot's own design, not generic security craft.

**Landing**: `agents/reviewer.md` security-axis bullets + **extend the severity-mapping table** (R2 Architect:
new finding classes — prompt-injection, excessive agency, unbounded consumption — need a severity-tier home, or
they're half-wired) + sync the `.opencode/agent-bodies/reviewer.body.md` derivative via `sync-agent-bodies.sh`
(pre-commit drift gate). No new agent, no `resolve-dispatch.sh` row.

**Scope discipline (R2 Skeptic)**: ~4 bullets keyed to autopilot's OWN dispatch surface (e.g. "a new
hetero-dispatch path that trusts a worker's stream/self-report" = model-output-as-untrusted in this codebase),
NOT a 20-line generic OWASP recitation — the generic version IS checklist theater; the autopilot-specific
version changes a real review outcome the first time someone adds an agent-dispatch path that trusts stream output.

### E3 (promoted from O2) — Metric-Honesty Rule → `skills/profiling/SKILL.md`  · Effort S

**What**: One clause restating autopilot's anti-self-report axiom into the one skill where an LLM is most
tempted to fabricate a number: *an LLM reading static source cannot measure real-world LCP/latency/throughput;
label every such finding "potential impact", not a measurement; field and lab data are not interchangeable.*

**Why it's promoted (R2 Skeptic [important]: the descope over-corrected)**: verified — `profiling/SKILL.md` has
the *ordering* rule ("measure before guessing") but ZERO "label potential impact, not measurement" content. It
is the SAME shape as E1/E2 (one-clause restatement of an existing axiom into a file that verifiably lacks it),
same Effort-S, same no-new-file. Excluding it while including E1/E2 was inconsistent.

**Landing**: `skills/profiling/SKILL.md` (one clause, inline).

### Gate-anchor notes (R2 Ops — additive edits only)

- **E1** (`blind-dispatch.md`) is gated by `check-canonical-invariants.sh` (pinned phrases at lines ~101/177)
  + a pre-commit grep requiring the `issues/10187` + `issues/2138` refs. **Additive only** — do not displace
  those anchors. Land E1 as its OWN labeled subsection (R2 Architect: it's a *cross-dispatch* self-audit, a
  different layer from the per-prompt leak checklist — don't weave it in). Keep the "self-audit prompt, NOT a
  checkable signal" label verbatim in the landed text (or it over-claims enforceability).
- **E2** (`reviewer.md`) is gated by `check-canonical-invariants.sh` (severity-vocab line ~42, `code-review.md`
  Invocation anchor ~57). The security-axis edit site is clear of both — just don't reword those lines.

### Release hygiene: N/A

All three edits are **count-neutral** (no skill/agent/hook count change) ⇒ no version bump, no `sync-version.js`,
no INDEX row. Rides as a plain docs/content commit. (Resolves the R1 Ops "release-hygiene absent" concern by
making it explicitly not-applicable.)

### BACKLOG note (everything else)

One trigger-conditioned line: *"agent-skills study (2026-06-24): C1 WebFetch cache, C3a dead-ref detector,
C4 security-persona all REJECTED in dialectic — no observed re-fetch pain / catastrophic FP rate / reverses the
`/security-review` delegation. **C2's CLAIM-stripping was already shipped** in `blind-dispatch.md` + the v2.24.0
refute pass (only the doubt-theater signal was missing → landed as E1, don't re-propose the whole skill). **O2
promoted to E3** (metric-honesty into profiling). O6 dual-env-var hook fallback parked (genuine but solves a
non-biting dogfood-path problem, and `|| true`-swallowing a path failure is mildly anti-fail-closed). Other
O-tier net-new skills violate `skill-refactor-rules`. Revisit C3a only after first migrating cross-refs to a
STRICT `[[skill:x]]` syntax — the `→ skill` arrow collides with prose ('→ add', '→ execute'...) so a checker on
today's corpus is FP-catastrophic."*

---
---
## REJECTED RECORD (original Core/Optional — kept for the reasoning, do not build)

## Framing

addyosmani/agent-skills is a persona-catalog + multi-platform packaging with a deliberately thin
orchestration layer. Its **dispatch machinery is uniformly weaker** than autopilot's (no git-artifact
verification, no worktree isolation, no blind re-dispatch, single-family judges) — **import none of it**.
Its **platform CLI/path claims are below autopilot's verification bar** (unverified `gemini skills install`,
`agy plugin import`, `agy --sandbox`; an antigravity install path that *conflicts* with autopilot's
empirically-confirmed `~/.gemini/config/plugins/`) — **re-verify every fact, import only mechanics**.

The learnable value is in **content**: a few skills/personas autopilot lacks, one hook design, one
validator class, and a few authoring conventions. This plan captures only the items judged genuinely
excellent AND a good fit for autopilot's axioms ("verify by artifacts, never self-report"; forcing-functions
live inline in SKILL.md; spike-before-assert; cross-platform-portable core, CC-deep accelerators).

## Goal

Land the 4 core items below, each respecting autopilot's existing discipline, with a clearly-deferred
optional tier. Each item ships with its inventory/test/doc wiring (no dead code).

---

## Core items

### C1 — Revalidation-gated WebFetch cache (opt-in hook)  · Effort L

**What**: Port addyosmani's SDD-CACHE design. A PostToolUse `WebFetch` hook captures the origin's
`ETag`/`Last-Modified` validators and stores `{url, prompt, etag, last_modified, content, fetched_at}`;
a PreToolUse `WebFetch` hook revalidates via `If-None-Match`/`If-Modified-Since` and **serves from cache
ONLY on `304 Not Modified`**. **No TTL** — freshness is delegated to the origin; a response with no
validator is **never cached**.

**Why it fits**: A 304 is a *fresh verification*, not a memory read — so the cache is epistemically honest,
matching autopilot's fact-driven / verify-don't-trust-memory ethos. autopilot has **zero** WebFetch cache;
`survey` / `deep-research` / `research-to-ship` + the reviewer/debugger/planner agents re-fetch identical
docs across sessions.

**Landing**: new `hooks/webfetch-cache-pre.js` + `hooks/webfetch-cache-post.js` (Node, fd-0 read discipline
per the `/dev/stdin` ENXIO lesson); wire into `settings.example.json` `hooks-opt-in-examples`; document in
`hooks/README.md`; count in `check-hook-inventory.js` (opt-in 11→12, total 20→22 — re-tally all tiers).

**Open questions**: (1) every cache miss costs an extra `curl -sI` HEAD roundtrip (CC doesn't expose the
headers WebFetch already saw) — acceptable? (2) the cached body is WebFetch's *model-post-processed* reading,
not raw HTML — surface the original prompt on a hit so the next agent can judge applicability.
**Risk**: CC-only (WebFetch hook events are CC) — document as CC-scope in `references/multi-agent-portability.md`.

### C2 — `doubt-driven-development` forcing function  · Effort L

**What**: An in-flight, per-decision adversarial-disproof discipline. Name a decision as a CLAIM, then hand a
fresh reviewer **the artifact + contract ONLY — explicitly NOT the CLAIM** (handing over your conclusion biases
the reviewer toward agreement). Ship the **"doubt theater" checkable signal**: across 2+ cycles where the
reviewer surfaced substantive findings, if zero were classified actionable ⇒ you are validating, not doubting.
Bounded 3-cycle stop.

**Why it fits**: Fills the gap between autopilot's per-keystroke work and its *post-hoc* quality-pipeline — a
discipline for *when to invoke* review during the build. Synergizes with the just-shipped (v2.24.0) shadow
refute pass and `blind-dispatch.md` (both are "strip the prior conclusion before re-judging").

**Landing**: a new forcing-function section. **Decision needed** (see Open): standalone skill vs. folded into
`dev-flow` execution rules + `blind-dispatch.md`. The CLAIM-stripping rule is already half-present in
`blind-dispatch.md` clause 1 — this extends it from "re-review hygiene" to "in-flight build hygiene".

**Open questions**: standalone skill risks proliferation (autopilot's skill-refactor rules); but folding it
into dev-flow may bury the forcing function. Resolve in dialectic.

### C3 — Cross-reference + cross-directory parity validators  · Effort S→L

**What**: Two deterministic checks autopilot lacks.
(a) **Dead cross-skill-reference detector**: regex-extract `` `skill-name` `` / `→ skill-name` references from
SKILL.md descriptions + bodies, warn if the target isn't a known skill. autopilot's skills cross-reference
*heavily* (`→ think-tank`, `→ dev-flow` in nearly every description) with **no checker** — one rename leaves
dead links.
(b) **Command/skill cross-directory parity** (only if/when autopilot ships multi-format command mirrors):
N-way presence + `description`-identical, **body-drift-allowed**, with a rename map. autopilot's
`check-readme-parity.js` and `sync-agent-bodies.sh --check` are the closest analogs but neither checks
command/skill semantic parity across platform-facing copies.

**Why it fits**: Pure deterministic gate — "the script certifies" — the exact shape autopilot already prefers.

**Landing**: (a) extend `scripts/validate.sh` (or a sibling `.js`); wire into `preflight-portability.sh`.
(b) deferred until there are actual cross-format command mirrors to police (autopilot may not have them yet —
**verify current state first**).

**Open questions**: false-positive rate of the regex extractor (autopilot prose mentions skill names in
non-reference contexts) — needs an allowlist or a strict reference syntax.

### C4 — `security-auditor` persona (OWASP + STRIDE + LLM Top-10)  · Effort L

**What**: A dedicated security review persona autopilot lacks. Structured threat-model pass: injection/IDOR/SSRF,
**STRIDE-first trust-boundary reasoning** (reason about each boundary before enumerating findings), a severity
table with actions, and notably an **OWASP LLM Top-10 section** (model output as untrusted, prompt-injection-as-
boundary, excessive agency, unbounded consumption).

**Why it fits**: autopilot's reviewer folds security into one checklist axis with no threat-model pass. For a
plugin that *itself dispatches LLM agents*, the LLM-Top-10 block is directly relevant to its own design.

**Landing**: new `agents/security-auditor.md` (model routing via `resolve-dispatch.sh` — add a role row, never
hardcode); referenced from `skills/quality-pipeline/references/code-review.md` as an optional deeper pass;
sync the `.opencode/agent-bodies/` derivative via `sync-agent-bodies.sh`.

**Open questions**: is a *separate persona* better than extending reviewer.md's security axis? Separate persona
= optional deeper pass on security-touching diffs; extending reviewer = always-on but shallower. The `/ship`
conjunctive skip predicate (touches auth/payments/data/config ⇒ never skip) could gate when it fires.

---

## Optional / deferred tier (capture, don't build yet)

- **O1** `observability-and-instrumentation` skill — a missing lifecycle phase (instrument-as-you-build):
  "write the on-call questions before instrumenting", metric/trace/log selection rule, cardinality discipline,
  symptom-not-cause alerting. Pairs with profiling/debug. Effort L.
- **O2** web-perf **Metric-Honesty Rule** into `skills/profiling/SKILL.md` — "an LLM reading static source
  cannot measure real LCP; label *potential impact*, not measurement" — a perf-domain restatement of
  autopilot's anti-self-report axiom. Effort S.
- **O3** Mandatory **rollback/RTO artifact** + the **conjunctive skip predicate** (≤2 files AND <50 lines AND
  not auth/payments/data/config) into `finish-flow` / `quality-pipeline` verdict template. Effort S.
- **O4** Authoring conventions: **"Common Rationalizations" anti-skip table** (inline section, not a
  references/ file — respects skill-refactor rules) + **description anti-summary rule** ("don't summarize the
  workflow in the description, or the agent follows the summary instead of reading the skill"). Effort S.
- **O5** `docs/comparison.md` vs peer skill-libs — but autopilot can run a **real eval** via
  `run-eval-batch.sh`/`evals/` instead of citing an anecdote; + the HTML-comment "not a skill, keep out of
  context" guard on human-only docs. Effort S–L.
- **O6** Dual-mode hook path fallback `${CLAUDE_PLUGIN_ROOT}` → `${CLAUDE_PROJECT_DIR}/.claude/hooks/` + `|| true`
  — CC-only; useful for dogfooding (autopilot-on-autopilot). Both env vars are verified-genuine. Effort S.
- **O7** Net-new craft skills (lower orchestration relevance): `source-driven-development` (official-docs-cite-
  or-flag-UNVERIFIED — mechanizes spike-before-assert at impl time), `deprecation-and-migration` (Churn Rule,
  Zombie code), `api-and-interface-design` (Contract-First), ADR artifact from `documentation-and-adrs`
  (Alternatives-Considered + supersede-don't-delete, to persist think-tank decisions).

## Do NOT import (anti-scope)

- Any of their dispatch machinery (weaker on every axis autopilot cares about).
- Their orchestration **doctrine** (personas-never-nest, slash-command-is-the-only-orchestrator) — the
  *opposite* of autopilot's CEO depth-0 / `/l4` nested-foreman model. Read as a foil, not guidance.
- Their **unverified** platform CLI/path claims — re-verify against autopilot's own evidence.
- Their **length-as-target** authoring thresholds (100-line split rule) — autopilot says length is a proxy,
  not a goal. Regression.

## Sequencing (draft)

1. C3(a) dead-ref detector first (cheap, immediately useful, unblocks safe renames for everything else).
2. C1 WebFetch cache (self-contained opt-in hook).
3. C4 security-auditor persona.
4. C2 doubt-driven forcing function (depends on the C2 standalone-vs-fold decision).
Optional tier triaged into BACKLOG with triggers, not built in this pass.

## Acceptance

- Each built item has inventory/test/doc wiring (no dead code per CLAUDE.md "wire it in" rule).
- No unverified cross-platform claim enters any doc.
- Hook tally re-reconciled across all canonical descriptions if C1 lands.
- A dialectic review converges (no open Critical/Important) before any build starts.

## Open decisions for dialectic

1. C2: standalone skill vs. fold into dev-flow + blind-dispatch?
2. C4: separate security persona vs. extend reviewer.md's security axis?
3. C1: is the extra-HEAD-per-miss cost worth it, or cache only specific high-reuse domains (official docs)?
4. C3(b): does autopilot even have cross-format command mirrors to police yet? (verify before scoping)
5. Is the core set too big for one pass — should C2/C4 be deferred to keep this a focused 2-item ship?
