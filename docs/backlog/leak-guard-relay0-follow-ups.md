# leak-guard follow-ups from the relay0 review (BL-0348)

Source: relay0 review generations g2 and g3 (suggestions cut from that version).

1. Revert of a redaction commit: restoring previously cleaned personal data shows up as added lines and is blocked. Needs a deliberate path (for example allow when the added line matches a line the revert removes), with a negative control.
2. hostname-common-word: os.hostname() is in the case-insensitive strong host list; a machine named with a common word blocks every added use of that word. Speculative for the current fleet.
3. redact-cmd-cwd: the printed redaction command uses a script path relative to cwd, so it only runs as printed from the repo root.
4. leakguard-typechange-filter: `--diff-filter=ACMR` skips typechange entries; a symlink to regular-file swap goes unscanned. Note in references/leak-guard.md when the contract is next touched.
5. ci-push-branch-filter: .github/workflows/checks.yml runs on every push with no branch filter, so PR branches run push and pull_request jobs (duplicate spend only).
6. stat-try-wraps-fail: the directory-registry `fail(2, ...)` sits inside a try whose catch swallows everything; safe only while fail exits. Move the stat result out of the try. The NC1b dirreg2 assertion pins current behaviour.
7. host-letter-overflow: past 26 distinct hosts on one line, letter() falls back to a number. No line reaches that.
