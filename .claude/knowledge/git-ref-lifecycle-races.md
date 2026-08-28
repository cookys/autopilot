<!-- last-verified: 2026-08-23 -->
# Git Ref Lifecycle Race Lessons

**Date**: 2026-07-16 | **Context**: Autopilot dispatch-branch lifecycle recovery, preserve-first reaping, and final QC race review.

## 1. Never consume Git enumeration before proving the producer succeeded

**Problem**: Process substitution such as `while read ...; done < <(git for-each-ref ...)` hides the producer's exit status. Partial stdout can therefore look like a complete branch inventory.

**Solution**: Snapshot enumeration into a temporary file, check the Git command's status and stderr, then consume the file only after success.

**Failed attempts**: Inspecting the loop status or assuming EOF implied producer success; neither proves the process-substitution command completed cleanly.

**Related**: `scripts/reap-dispatch-branches.sh` (`snapshot_local_heads`), `hooks/tests/reap-dispatch-branches.test.sh` enumeration-failure fixtures.

## 2. Stable checks need complete pre/final/post snapshots

**Problem**: Checking only the target SHA or known candidates misses branches created, moved, or deleted during evaluation. Publishing acknowledgement state early can persist a decision whose observed ref set never existed atomically.

**Solution**: Compare complete sorted `refs/heads` name/tip snapshots before classification, immediately before verdict, and after evaluation. Publish ack state only after all three observations agree.

**Failed attempts**: Target-only CAS checks, candidate-only rescans, and writing ack before the post-evaluation snapshot all left race windows.

**Related**: `scripts/reap-dispatch-branches.sh` check path; `hooks/tests/reap-dispatch-branches.test.sh` snapshot-linearization fixtures.

## 3. `mv -f temp target` is not a sufficient publication proof

**Problem**: If `target` races into a directory, `mv -f temp target` can return success by nesting the temp file inside that directory rather than replacing the intended path.

**Solution**: After publication, require the exact target path to be a regular non-symlink file and verify its bytes with a pre-publication digest or object ID.

**Failed attempts**: Treating a zero `mv` exit as proof that the named destination now contains the expected state.

**Related**: Ack publication in `scripts/reap-dispatch-branches.sh`; directory-race fixture in `hooks/tests/reap-dispatch-branches.test.sh`.

## 4. One-shot `update-ref --no-deref` does not preserve a dangling symref

**Problem**: A dangling symref can resolve as a missing object, so a one-shot zero-old-value `update-ref --no-deref` may replace the symref itself. A separate precheck still has a check/update TOCTOU window.

**Solution**: Use an `update-ref --stdin` transaction: `start`, `option no-deref`, `update`, then `prepare`. While the ref lock is held, inspect raw state with `symbolic-ref -q`; abort on a symref, otherwise commit, wait for success, and verify the exact direct ref.

**Failed attempts**: Adding only `--no-deref`, or checking for a symref before issuing an independent update.

**Related**: `restore_deleted_ref` and post-delete raw-ref detection in `scripts/reap-dispatch-branches.sh`; direct-ref and dangling-symref race fixtures.

## 5. Orphan cleanup must share the worktree's lifetime lock

**Problem**: Registration in `git worktree list` does not prove a worktree is dead. Removing it without its lifetime flock can delete an active delegated run.

**Solution**: Acquire the same `.autopilot-worktree.lock` non-blockingly, hold that exact FD continuously through `git worktree remove`, and preserve orphan-log entries when the lock is live or unsupported.

**Failed attempts**: Retrying every registered orphan, or probing liveness and closing the FD before removal.

**Related**: `scripts/dispatch-hetero.sh`, `scripts/lib/worktree-reap.sh`, `hooks/tests/dispatch-hetero-gc.test.sh`.

## 6. Reviewer findings are hypotheses until a minimal probe reproduces them

**Problem**: Plausible shell/Git claims can be wrong and distract from real races. This review loop included non-reproducing EOF-loop, alternative symref, and temp-path assertions alongside genuine blockers.

**Solution**: Reduce each claim to the smallest shell/Git fixture, capture the exact status and filesystem/ref state, and promote only reproducible behavior into a blocking repair.

**Failed attempts**: Accepting reviewer prose as proof, or dismissing it without an executable counterexample.

**Related**: Race fixtures in `hooks/tests/reap-dispatch-branches.test.sh` and `hooks/tests/dispatch-hetero-gc.test.sh`; archived dispatch-branch-lifecycle review history.

## 7. SHA-1 assumptions can be preserve-first without being portable

**Problem**: Forty-hex validation and a forty-zero old OID safely prevent ack/reap on SHA-256 repositories, but that is a compatibility limitation, not SHA-256 support.

**Solution**: Disclose the fail-closed limitation, or generalize with `git rev-parse --show-object-format` and format-appropriate OID validation/zero values. Until generalized, preserve refs and bundles rather than weakening checks.

**Failed attempts**: Calling fail-closed behavior "portable" merely because it avoids deletion.

**Related**: SHA-256 fixture in `hooks/tests/reap-dispatch-branches.test.sh`; recorded-tip and ack validation in `scripts/reap-dispatch-branches.sh`.

## 8. Post-merge cleanup is part of completion

**Date**: 2026-07-24 | **Context**: Owner Kernel CEO run left a completed foreman worktree and merged dispatch branches behind.

**Problem**: A merged implementation was treated as finished while its worktree and branch refs remained. The stale refs made later branch audits noisy and obscured which work was still live.

**Solution**: Make cleanup a terminal invariant. After merge, enumerate worktrees, verify the worktree is inactive and clean, prove the exact branch tip is contained by the authoritative integration target, remove the worktree, then use the preserve-first reaper or `git branch -d`. Re-enumerate worktrees and refs before reporting completion. Never use an unchecked `git branch -D`.

**Related**: `scripts/reap-dispatch-branches.sh`, `skills/finish-flow/SKILL.md` L-5.6/L-5.7, and `skills/ceo-agent/references/level-front-door.md` worktree GC.

## 9. `grep --exclude-dir=.git` proves nothing about a commit anchored by a receipt

**Problem**: Deciding whether a dispatch branch is safe to delete by grepping the working tree for
references to its content (`grep -r --exclude-dir=.git`) ignores that authoritative evidence for a
completed run lives in `.git/autopilot/` (receipts, work-orders, journals, states) and anchors by
**commit SHA**, not by content. A branch whose diff is a strict content subset of `develop` can still
be the sole reachable path to a commit a receipt cites — deleting it silently orphans that commit, and
the loss is discovered later, if at all. One sweep found 72 receipt-anchored commits already
unreachable from any ref, and 4 of those commits' objects had already been garbage-collected — the
evidence had already been lost by the time anyone looked.

**Solution**: Before deleting any dispatch branch, scan `.git/autopilot/` for every 40-hex token,
classify each as reachable/unreachable, and `git update-ref refs/autopilot/evidence-anchors/<sha> <sha>`
for every unreachable one — this keeps the commit reachable through the anchor after the branch is
gone. Do this for tips still held by a live branch ref too, not only orphans already found unreachable
— a scan that only covers "currently unreachable" misses commits about to become unreachable the
moment the branch is deleted, and by the time the next scan runs they may already be gone.

**Failed attempts**: Trusting `grep --exclude-dir=.git` as evidence of "zero references" — it answers
a question about working-tree content, not about which commits a receipt has bound by SHA.

**Related**: §10 below, `scripts/mission-terminal-reconcile.js`, `scripts/reap-dispatch-branches.sh`.

## 10. Mechanizing a manual fix silently inverts the order it depends on

**Problem**: A manual fix and its mechanized equivalent are not automatically the same procedure in the
same order, and an order-dependent check fails silently when the order flips. In this repo's own
history: the manual anchor-pin sequence was "delete branch → discover the commit is now orphaned →
pin it". Mechanizing it wired the pin into the reaper's pre-deletion step, but the reachability check
still used the same `rev-list --all` — and **before** deletion, every one of those branches is still
present, so every commit they hold is still "reachable", and nothing gets pinned. The mechanism does
nothing in the one scenario it exists for. A test built to cover it did not catch this, because its
fixture also deleted the branch first and scanned after — it had copied the manual procedure's order,
not the reaper's actual call order.

**Solution**: When wiring a manual step into an automated pipeline, ask explicitly "what state did the
world hold when I did this by hand — and what state does it hold at the point the automation calls it?"
For anything git-ref-shaped, ask specifically which refs are still present at that call site. Build the
fixture to replicate the **caller's** state, not the operator's. The general repair shape is to make the
reachability judgment accept a list of "about to disappear" refs (an `--exclude-ref` set) rather than
assuming present state is final state.

A second-order version of the same bug reappeared in the fix for the first: the repair that later
deletes a mismatched anchor still counted that anchor as reachable when computing reachability for the
deletion itself. The same class of error returns wearing a different shape inside its own fix — after
fixing an order-dependent bug, ask whether the fix's own new delete/mutate step also needs to join the
exclusion list.

**Related**: §9 above, `scripts/reap-dispatch-branches.sh`, `hooks/tests/reap-dispatch-branches.test.sh`.
