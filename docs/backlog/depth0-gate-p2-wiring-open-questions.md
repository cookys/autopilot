# depth-0 per-turn gate P2 wiring: two design questions

BL-0318 and BL-0319. Found by self (d0gp1 fourth-generation review and acceptance), 2026-10-27. Both belong to P2 of docs/plans/2026-10-26-depth0-per-turn-gate.md (BL-0306), and both must be settled before the hook is wired.

## BL-0318: exit 2 becomes allow plus error, and a worker can cause exit 2

Plan section 3.2 says the hook turns gate-verify's exit 2 into "allow plus error". A worker can produce exit 2 on purpose, for example by making a directory unreadable or by leaving opaque content that the content rules cannot read, and so obtain an allow.

Decide at P2 wiring time:

- whether the error is shown to the owner;
- whether a repeated error escalates to a block;
- which exit 2 causes a worker can trigger.

## BL-0319: git calls in the hook still see the worker's .git/config

gate-verify no longer reads the worker's index, ignore files or config to decide what changed. It walks the filesystem and runs git with `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null`. The worker still owns its own `.git/config`.

At P2 wiring time, check whether any other git call in the hook context (for example rev-parse, or reading a submodule HEAD) is affected by the worker's config.
