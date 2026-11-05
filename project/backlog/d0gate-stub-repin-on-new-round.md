# skill-onoff-d0gate: stub parity is pinned to the closed round (BL-0402)

hooks/tests/skill-onoff-d0gate.test.sh stub parity compares the frozen stub with the rail at `FROZEN.json` `d0gate.packs["fixture-scripts-d0gate"].ref` (the d0gate round is closed; changed in the wfix merge, 808d3d6ed), not at HEAD.

A new d0gate round must re-pin the stub (new ref in the prereg and FROZEN.json) and switch the parity comparison back to HEAD, otherwise the test checks a stale rail.
