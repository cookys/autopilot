# G40 mirror OS lock: perl fallback unverified on macOS (BL-0381)

Source: follow-up recorded when the parent item closed (2026-11-04). Not yet scheduled.

BL-0374 (cd7f28002) takes an OS flock on `<alias>.oslock` through flock(1), then perl, run once with the descriptor inherited. Stock macOS has no flock(1), and the perl fallback has never been run on macOS. Without either, the write fails closed (`write_failed` / `lock_helper`, visible in `status`), so nothing is corrupted. Wanted: run `scripts/lib/account-observation-oslock.test.js` on a macOS host and record the result, or ship a verified alternative.
