# validateIntegratedExecution rebuilds the merge manifest by hand

BL-0262. File: scripts/next-touch-validation.js. Symbol: validateIntegratedExecution.

The next-touch validation's integrated-execution check reassembles the merge manifest by hand. It should call the constructor in src/status/merge-intent.js. When the merge-intent schema went to 2, a hard-coded 1 here drifted once. The reds3 lane fixed the constant on 2026-10-20; the duplicated structure remains.

Suggested fix: call the merge-intent builder in src/status/merge-intent.js instead of hand-building the manifest.
