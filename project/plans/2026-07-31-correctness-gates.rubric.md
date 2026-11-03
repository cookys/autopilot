# Correctness Gates Rubric

## R1 Prose justification is current-section scoped

Historical `prose-justification:` lines cannot clear the current release, while a current-version
line still can.

## R2 Red-green executes repo-owned scripts from the tested tree

The same repo-relative verify script is executed inside head and base detached worktrees, producing
a real GREEN/RED distinction rather than reading caller-checkout product code.

## R3 External verify commands remain compatible

A truly external absolute executable retains its existing execution identity and exit semantics.

## R4 Binary paths reach risk rules

Binary-only `diff --git` headers, quoted names, and names with spaces are parsed without truncation
and feed the existing domain/checklist classifier.

## R5 Secret deletion is not blocked

Deletion-only removal of a matching secret exits cleanly, while addition of the same secret remains
blocked with redacted output.

## R6 Existing interfaces remain stable

CLI flags, JSON fields, exit codes, fail-open hook infrastructure behavior, and unrelated text-diff
classification remain compatible.

## R7 Each gate proves it can fail

The regression suite contains planted defects for the historical justification, caller-checkout
verify script, protected binary path, and newly added secret.
