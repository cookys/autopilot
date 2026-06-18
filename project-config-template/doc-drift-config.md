# Doc-Sync — Project Config
# Place this file at: .claude/doc-drift-config.md
#
# Declares the doc↔code DOMAINS that autopilot:doc-sync audits, plus optional
# project-specific knobs. OPTIONAL — without it, doc-sync derives domains on the
# fly by grouping doc files with the source dirs they describe. Provide it to
# make runs sharper and repeatable.

## Domains
# A domain = a slice of docs + the code that backs it. doc-sync runs find→verify
# per domain. For scoped mode it only audits domains whose code the diff touched.
#
# Format (one block per domain):
#   ### <domain-key>
#   docs:  <comma-separated doc files / globs>
#   code:  <comma-separated source files / dirs the docs describe>
#   focus: <one line: the specific claims most worth checking>
#
# Example (from a Rust CLI project):
#
# ### memory-pipeline
# docs:  doc/concepts.md, doc/specs/ship.md, README.md (ship/dream sections)
# code:  src/dream/, src/cli/ship.rs, src/mnemos/, src/llm.rs
# focus: LLM backend chain, endpoints, opt-in gate, retry policy, what ship reads
#
# ### cli-surface
# docs:  README.md, doc/getting-started.md (command lists)
# code:  src/main.rs (clap), src/cli/
# focus: every documented command/flag exists; implemented commands not omitted
#
# ### phase-status
# docs:  README.md + CLAUDE.md roadmap tables
# code:  doc/projects/INDEX.md archive + presence of modules
# focus: "shipped" claims backed by code; "planned" genuinely absent

## Preferred auditor (optional)
# doc-sync reads `.claude/dispatch-config.md` → "## Doc Drift Audit" chain to
# decide HOW to run. If your project ships a Claude-Code Workflow script, list it
# there (it's a CC-only fast path); `native` is always the portable fallback.
#
#   ## Doc Drift Audit         (in .claude/dispatch-config.md)
#   - workflow:.claude/workflows/doc-drift-scoped.js   # CC-only fast path (scoped)
#   - workflow:.claude/workflows/doc-code-drift-audit.js  # CC-only fast path (full)
#   - native                                           # portable default

## Staleness threshold (optional)
# Days since last full sweep before doc-sync offers a full run. Default 30.
# Tracked in .claude/doc-audit-state.json (last_full_audit).
# staleness_days: 30

## Fix policy reminder (do not auto-apply)
# - User-facing docs (README / CLAUDE.md / guides / env examples / CHANGELOG)
#   → always correct to current code reality.
# - Specs: pure STALE → fix text; design-target-not-yet-built → keep + mark
#   "NOT YET IMPLEMENTED" + open a BACKLOG item.
