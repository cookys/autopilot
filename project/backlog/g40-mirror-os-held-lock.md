# G40 mirror writer: OS-held lock to close the publish fencing window (BL-0374)

Source: G40 P1 D1 third-generation review, finding 48f67816. PM ruling at the generation cap, 2026-11-04. Order: after BL-0373; not yet dispatched.

## Problem

`scripts/lib/account-observation.js` writes the local mirror row under a lockfile with a reclaim rule. One window cannot be closed with a lockfile: holder A passes its last check, then stays alive but stalls for longer than the 120 s hard cap. Writer B reclaims the lock and publishes. When A resumes it runs its rename and overwrites B's result, so the local row goes back to the older value until the next write.

The trigger is extreme. Existing guards: only a dead holder is reclaimed, release compares nonce and inode, and a monotonic guard re-reads the file before publishing.

## Wanted design

An OS-held lock that cannot be taken away while the holder lives: flock or fcntl, for example through a small native helper, or through a child process that holds the file descriptor on the writer's behalf. Raising the hard cap is not the answer; the PM ruled that out.

## Red case

A holder that stalls past the old hard cap while alive must keep the lock: a second writer gets mirror_lock_busy, and the stalled holder's rename never overwrites a newer publication.

## Residual (PM ruling 2026-11-04, plan A.5)

Old and new plugin versions can run side by side on one host for a short time; the old writer locks `<alias>.lock`, the new one `<alias>.oslock`, so they do not exclude each other. The mirror is per host and per user and the plugin updates host by host, so the overlap is short and local; the worst case is the already-accepted stale row. No compatibility shim was added (owner principle).

## Built (BL-0374)

OS flock on `<alias>.oslock`, taken on a descriptor the writer itself keeps open (flock(1), then perl, run once with the fd inherited; neither: `write_failed` / `lock_helper`, visible in `status`). Round 1 review fixes: the first build held the flock in a persistent helper child, so killing the helper freed the lock of a live writer (Major 8b7c2c4a); the writer now owns the descriptor and the helper process, the ping and the stdin handle are gone. A FIFO at the lock path now fails at once (Major 6bdcffeb). The perl fallback is UNVERIFIED on macOS, and stock macOS has no flock(1). Tests: `scripts/lib/account-observation-oslock.test.js` (red cases and a mutant negative control).
