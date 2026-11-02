# Rubric — 2026-11-02-oc-a1-events-contract.md

> Source plan: docs/plans/2026-11-02-oc-a1-events-contract.md

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
R15: A1-specific additions (same standing as the lines above): Node >= 20.10, built-ins only, no new npm dependency; the command is read-only and never writes a source store; repo-relative paths come from `scripts/lib/repo-layout.js`; a source problem degrades with a warning and never changes the exit code from 0 (only usage errors exit 2); the schema is `autopilot.events/1`, additive-only after merge (a removed or retyped field requires `/2`); ADR-0001 holds: no signatures, hash chains or attestation in the feed.
