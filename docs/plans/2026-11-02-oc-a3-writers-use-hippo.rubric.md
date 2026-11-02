# Rubric — 2026-11-02-oc-a3-writers-use-hippo.md

> Source plan: docs/plans/2026-11-02-oc-a3-writers-use-hippo.md

R1: No hosted CI: never add `.github/workflows` in any repo of this plan.
R2: In fleet, run courier tests only via `make courier-test` (never bare `cargo test`); every new test uses a sandbox HOME or explicit tempdir and touches no process-global state.
R3: No host names, LAN addresses or home paths in commits, docs or code of fleet and hippo; hosts and paths come from env or config.
R4: Plugins talk only to their local courier; only couriers talk to the hub; no plugin carries a hub URL.
R5: Wire shapes come from generated contracts (`contracts/` → `gen/`); the hub contract changes once, in phase F1, for all later phases.
R6: Liveness and task state are observed by the courier (pid, member state, lock, heartbeat), never taken from a model's own claim.
R7: hippo stores records as plain files on normal git branches; no custom refs, no git notes, no binary database in git.
R8: hippo ids are ULIDs on disk; short prefixes are display-only; never sequential ids.
R9: hippo never stores secrets or credentials; it stores where to obtain them. hippo does no embeddings or semantic search (mnemos does).
R10: A model never writes hippo record files directly; all writes go through the `hippo` CLI; `hippo check` runs on read, after merge and before commit, and names the offending file on failure.
R11: Signature verification is done by software (hangar verifier), never by a model; no private signing key is reachable by any agent process.
R12: A valid signature never authorizes a production target in this plan; production stays denied.
R13: `fleet approve` stays a human tty gate; no model runs it.
R14: Credentials move by 0600 file, never via chat, fleet message or a model's view.
R15: autopilot code writes hippo records only by running the `hippo` binary with an argv array (no shell string); it never opens, appends to or renames a file under `.hippo/`.
R16: Skill, reference, agent and config-template text never tells a model to edit `docs/BACKLOG.md`, `docs/backlog/*`, an ADR file, a `HANDOFF*.md` or a knowledge file; it names `scripts/project-record.js` for writes and `hippo search|related|show|list` for reads.
R17: autopilot never creates a hippo store implicitly: `project-record.js` writes through hippo only where `.hippo/repo.toml` already exists; creating a store is the explicit import of phase A3.3/A3.7.
R18: Usage counters (how often a record was read, cited or picked) never go to git or to a hippo field; they go to A1 events or the hub.
R19: Mechanism and guidance are separate commits; a mechanism commit does not edit requirement text (autopilot `CLAUDE.md` "機制 vs 指引").
R20: Every new or changed check ships with a negative control shown red before green (`references/evidence-discipline.md` §58).
R21: Node >= 20.10, built-ins only, no new npm dependency.
R22: Tests run under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos; they never touch this checkout's `.hippo/` or the operator's hippo config.
