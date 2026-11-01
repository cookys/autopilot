# Decision card written to the cwd repo, invisible to the operator panel (BL-0337)

Reported 2026-10-31 by the hangar session on openclaw (message 01M66YRNXRT5SNRXF6QDRV3JGF); no reply requested.

- Symptom: card d-4a3989b7 returned an id but the panel showed only d-dc3a8020. Closing d-dc3a8020 from the autopilot cwd says "not open"; closing d-4a3989b7 says "closed".
- Cause: `scripts/open-decision.js` picks `<git-common-dir>/autopilot/decisions/<scope>.json` from the process cwd. Running `open --root-run-id job-...` after `cd ~/projects/autopilot` wrote into autopilot, while the panel reads hangar. No warning when a root is bound; only an unbound scope warns on stderr (~L275).
- Options: (1) warn or refuse when the cwd repo differs from the root/session project unless `--cwd`; (2) derive scope from the session marker project root; (3) SessionStart hint and skill docs: run from the project cwd or pass `--cwd <project>` (the hint gives an absolute path, which invites a cd).
- Hint source: grep "open-decision.js open --question".
