# Security

Draft. Report a vulnerability privately to the maintainers rather than in a public issue.

## What the repository scan can and cannot see

Before publication the full history was scanned for credentials: no confirmed real credential was found within what the scan covers. The scan does not cover:

- custom tokens shorter than 32 characters;
- blobs of 3 MB or more;
- binary blobs.

Those three classes are unverified, not clean. A pre-publication review of the large and binary blobs, and a manual review of short values in `key=value` and `"token":` contexts, is still owed.

From now on `scripts/leak-guard.js` blocks personal paths, host names, private IPs, credential shapes and `.env` files in added lines (see `references/leak-guard.md`). It shares the same blind spots above.

## Frozen objects

- Historical evidence is not edited. It stays as published. Because the guard reads only added lines, it needs no exemption unless someone later edits it, and then only an exact per-file registry entry applies.
- Sealed non-evidence files that carry personal data (class B, seven files) are not edited in place and are not rewritten:
  - `docs/plans/2026-08-04-platform-capability-trigger-activation.md`
  - `evals/skill-onoff/prereg/findings-batch-v2.json`
  - `evals/skill-onoff/prereg/findings-batch-v3.json`
  - `evals/skill-onoff/prereg/findings-batch.json`
  - `evals/skill-onoff/prereg/stage-graph-g67.json`
  - `evals/skill-onoff/prereg/stage-graph-g67.md`
  - `evals/skill-onoff/prereg/stage-graph-g8.json`

  These still contain personal paths because their bytes are pinned by a frozen hash chain. They stay in the private development repository, unchanged and not exported. The same holds for `evals/skill-onoff/packs/manifest.json`, `evals/skill-onoff/prereg/FROZEN.json` and the archived evidence `platform-capabilities.json` files (signature over the content). No cleaned successor object will be produced; the earlier promise to do so is withdrawn. `evals/`, `evidence/` and `project/` are never exported. The codex-mirror copy of `platform-capabilities.json` sits under the exported `platforms/` tree, so the export tool excludes it by the rule that evidence files at any depth are never exported. These files already exist in the history of the current public repository and in existing clones and forks; only after the repository switch will they remain solely in the private repository.
