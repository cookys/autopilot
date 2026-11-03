# Acceptance rubric — Codex payload residual install-time spike

Every item is required and content-bound to the frozen execution plan.

## R1 Installed payload is exercised end to end

A logged-in ephemeral read-only `codex exec` run from a disposable repo explicitly invokes the
installed Autopilot audit skill. Exit status, planted comparison result, installed payload/support
path read, and unchanged scratch tree are evidenced mechanically; repo-local skill discovery or
self-report alone cannot pass.

## R2 Marketplace semantics are separated honestly

A disposable local marketplace/plugin is observed at generations A and B, the exact local re-read
behavior and `marketplace upgrade` result are recorded, and no local result is generalized to Git
snapshot upgrade semantics without direct proof.

## R3 Install/upgrade hook is real or marked absent

The installed CLI help, accepted manifest behavior, and installed manifest corpus are probed. A pass
requires an automatic native install-and-upgrade lifecycle invocation that runs generation before
payload discovery and fails loudly on generator failure. Unknown fields, manual wrappers, and prose
are not accepted as proof.

## R4 Decision is conjunctive and conservative

`GO` is emitted only if R1, R2's applicable upgrade contract, and R3 all pass. Otherwise the result
is `NO-GO`, committed mirrors and drift gates remain unchanged, and the backlog names the exact
future native capability that would reopen migration.

## R5 Evidence is reproducible and residue-free

The evidence JSON records sanitized versions, commands, exit codes, observations, verdicts, cleanup
checks, and final decision. The temporary repo, plugin, marketplace, processes, and named Codex
configuration entries are absent afterward; no credential or unrestricted transcript is committed.

## R6 Scope, documentation, review, and lifecycle close

Exactly the six authorized output paths change. The portability reference, backlog, project tracker,
and evidence agree; deterministic repository gates pass; an independent first-pass reviewer and the
distinct depth-0 authoritative QC clear the complete bundle; the result is committed and locally
merged without push, release, PR, publication, or payload migration.
