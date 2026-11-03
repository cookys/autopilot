# G40 mirror writer: OS-held lock to close the publish fencing window (BL-0374)

Source: G40 P1 D1 third-generation review, finding 48f67816. PM ruling at the generation cap, 2026-11-04. Order: after BL-0373; not yet dispatched.

## Problem

`scripts/lib/account-observation.js` writes the local mirror row under a lockfile with a reclaim rule. One window cannot be closed with a lockfile: holder A passes its last check, then stays alive but stalls for longer than the 120 s hard cap. Writer B reclaims the lock and publishes. When A resumes it runs its rename and overwrites B's result, so the local row goes back to the older value until the next write.

The trigger is extreme. Existing guards: only a dead holder is reclaimed, release compares nonce and inode, and a monotonic guard re-reads the file before publishing.

## Wanted design

An OS-held lock that cannot be taken away while the holder lives: flock or fcntl, for example through a small native helper, or through a child process that holds the file descriptor on the writer's behalf. Raising the hard cap is not the answer; the PM ruled that out.

## Red case

A holder that stalls past the old hard cap while alive must keep the lock: a second writer gets mirror_lock_busy, and the stalled holder's rename never overwrites a newer publication.
