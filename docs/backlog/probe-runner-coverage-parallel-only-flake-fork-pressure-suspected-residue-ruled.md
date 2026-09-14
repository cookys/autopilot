# `probe-runner-coverage` parallel-only flake — fork-pressure suspected, residue ruled out

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: next time it reds in a `--parallel` run (it passes standalone).
- **Context**: 2026-08-28 suite-reaper reproduction split the old diagnosis — the residue leak
  was real (deterministic ~7+2+6 entries/run, now reaped by
  `hooks/tests/lib/suite-residue-reap.sh`), but seeding 110+ stale entries did NOT move the
  failure count (clean 4/283 vs seeded 3/283, no `/tmp` quota pressure on this host: 858G free,
  2% inodes); the one recurring flaky file was `probe-runner-coverage`, which failed on the
  CLEAN run — a pure file-parsing test, so residue cannot be its cause; 32-way fork pressure is
  the live suspect.
- **Effort**: Fix.
- **Source**: fix/suite-residue-reaper QC round, depth-0 panel + foreman reproduction logs, 2026-08-28.

