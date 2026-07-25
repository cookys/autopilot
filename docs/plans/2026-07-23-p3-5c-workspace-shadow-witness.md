# P3.5c Root-Held Workspace Binding and Shadow Witness

## Background

P3.5a and P3.5b prove only a root-installed, signed-intake path and a
verifier-local hash record. They intentionally do not retain a workspace
descriptor or append evidence through an independent UID. Calling the live
Engine at this point would expose dispatcher, command, Git, worktree, branch,
cleanup, and repair seams without a mediated action boundary.

P3.5c adds host-local provenance for a workspace and a separate-UID shadow
journal. It remains a zero-effect diagnostic lane. It does not prove Git
content, authorize a workspace, start an Engine, produce P2 authority, or
accept a result.

## Decision

Keep P3.3 and the authenticated owner envelope at v1. The owner-signed P3.3
binding already contains `workspace_root_hash` and `immutable_base`. A Linux
descriptor fingerprint is runtime, root-local state; placing it in the owner
contract would change the portable bridge ABI, invalidate existing plan hashes,
and still would not prove repository contents or constrain a compromised root.

Instead, a root-only registry receives a safely opened directory FD at explicit
registration time, retains it in memory, and never persists or reopens its
path. `begin --workspace-registration-id` reserves that exact FD for one
session and emits a root-created ticket. The verifier must exact-match the
signed v1 workspace hash and immutable-base claim to the ticket. The ticket is
host-local provenance, not a new owner intent claim.

The root registration interface takes a configuration-time path only. It is
not copied into the ticket, registry record, receipt, witness, or Engine, and
the registry never reopens it. P3.3 v1 still sends the user-supplied
`workspaceRoot` through the existing worker/verifier request so the pinned
verifier can recompute the signed path hash. P3.5c therefore adds no
registration-path or descriptor exposure to that route, but it is not a
path-confidential verifier lane. A path-hash-only verifier input requires a
P3.3/envelope v2 change. Linux `openat2` and `statx` are mandatory; missing
support fails closed. The registry preserves the opened FD through submission.
Restart, expiry, mismatch, or an unavailable registry invalidates the
reservation rather than reopening a path.

## Protocol

1. A root-only registration helper opens a canonical absolute directory with
   `openat2(O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC, NO_SYMLINKS|NO_MAGICLINKS)`
   and supplies the FD to the root registry through `SOCK_SEQPACKET` and
   `SCM_RIGHTS`. The registry reads peer credentials before any body, requires
   one `O_PATH` directory FD, obtains `statx` mount identity, and derives the
   P3.3-compatible path hash from the kernel FD link. Revalidation may derive
   it again from that held FD, but each path string is discarded immediately.
2. The in-memory registration is unique, bounded, one-reservation-only, and
   TTL-limited. Its immutable base is a signed claim to compare later, not a
   Git probe. Descriptor fingerprint, registration ID, registry epoch,
   workspace hash, immutable base, session challenge, and install binding form
   a canonical root ticket. FD numbers, inode values, mount IDs, and paths are
   never exposed outside root.
   The registry also holds a root-private, non-blocking singleton lock for its
   lifetime. It records the `(st_dev, st_ino)` of the socket it bound and only
   unlinks that exact pathname while its listener and lock are still held. A
   competing failed start owns neither identity nor cleanup rights; a stale
   socket remains an operator-visible fail-closed condition rather than an
   automatic recovery path.
3. The root host writes a redacted, root-owned verifier-readable ticket for a
   bound session. The verifier rejects any plan whose signed workspace hash or
   immutable base does not exact-match it. The retained FD is never inherited
   by the worker, gateway, verifier, or a future Engine.
4. After verifier-local shadow admission, the verifier gateway sends only
   hashes to a fresh `autopilot-shadow-witness` service. The witness validates
   the exact gateway PID/UID/GID/cgroup with `SO_PEERCRED` before parsing a
   frame. Its only methods are `open_shadow`, `append_shadow_observation`,
   `read_shadow_record`, and `close_shadow_diagnostic`.
5. The witness owns a `0700` durable state root and fsyncs each canonical,
   hash-chained append plus its containing directory. Same-ID exact replay is
   deterministic after closure. A partial/corrupt/unclosed chain is
   `recovery_required`; it is never completed or promoted automatically.
   Root reads the final entry over the sealed witness socket using its exact
   host PID and compares it with the gateway result before returning success.

## Acceptance Criteria

1. A bound session can use only one root-held descriptor whose runtime path
   hash and immutable-base claim exact-match the already signed P3.3 v1 plan.
2. A descriptor cannot be reconstituted from a path after registry restart,
   expiry, reservation completion, replacement, or failure.
3. The P3.5c ticket, witness, public output, local shadow record, and any
   future Engine receive no root-registration path, FD, inode, mount ID, or
   Git data. The existing P3.3 v1 worker/verifier request remains an explicit
   raw-workspace-path exposure needed to recompute its signed hash; it is not
   persistent P3.5c provenance and cannot be treated as a confidential lane.
4. The witness is a distinct private UID, authenticates the exact verifier
   gateway before payload bytes, has an append-only canonical journal, and
   root independently reads back the closed record.
5. Every returned result remains `engine.status: not_started`,
   `owner_kernel_authority: none`, `effect_authority: none`,
   `acceptance: not_available`, and explicitly says its workspace/content
   assurance is host-local and not P2 authority.

## Review Synthesis

| Perspective | Position | Decision |
| --- | --- | --- |
| Architect | Preserve P3.3/envelope v1; a root-held FD ticket is runtime provenance, not portable owner intent. | Adopted. |
| Integration | v1 is sufficient for zero-effect work if mapping is unique, one-shot, root-held, and exact-matched to signed path/base. | Adopted. |
| Security | Prefer a v2 owner-signed registration namespace before a joined lane; v1 risks owner-policy ambiguity. | Deferred to the first effect-capable broker or any multi-map/alias policy. P3.5c is constrained to one root-held descriptor, no effects, no owner registration authority claim, and no reuse after restart. |

P3.3 v2 becomes mandatory before an effect-capable broker consumes a workspace
descriptor, before a path-confidential verifier lane is claimed, or earlier if
registration aliases, multiple mappings, project policy namespaces, or
owner-visible registration choice are introduced.

## Test Plan

1. Deterministic registry tests cover Linux capability checks, `openat2` and
   `statx`, path/Fd/symlink rejection, exact root peer credentials, descriptor
   replacement, one-shot reservation, expiry, restart fail-closed behavior,
   SCM_RIGHTS rejection cleanup, and raw-path exclusion.
2. Deterministic witness tests cover peer-before-payload ordering, canonical
   chained records, idempotency, short writes, journal corruption, partial
   records, rejected SCM_RIGHTS cleanup, and no P2/Engine imports.
3. Installed-host tests cover ticket shape, exact signed-plan matching,
   verifier/gateway output validation, direct root readback mismatch rejection,
   and no-authority source scans.
4. An explicit privileged live gate proves three distinct service UIDs,
   systemd/cgroup binding, descriptor reservation, witness append/readback,
   competing-registry lifecycle isolation, and cleanup. The normal suite stays
   unprivileged.

## Implementation Review

| Perspective | Verdict | Findings and resolution |
| --- | --- | --- |
| Architect | SHIP | No blocking finding. Confirmed the root-only registration boundary, exact v1 ticket match, zero-effect disclosure, and mandatory v2 gate before effects or path-confidential verification. |
| Integration | SHIP | 🟠 A failed second registry instance could unlink the active listener. The registry now holds a singleton lock, tracks its bound `(st_dev, st_ino)`, unlinks only that socket before close, and the privileged gate proves a competing start cannot remove it. |
| Security | SHIP | 🟡 Rejected `SCM_RIGHTS` frames could leak received FDs in parser and root-client response paths. All rejection paths now close received descriptors and request `MSG_CMSG_CLOEXEC`; deterministic regressions verify baseline FD counts. |

## Out of Scope

- Git/object/content verification, worktree mutation, shell commands, Engine
  invocation, P2 permits/authorizations/witness APIs, acceptance, P0
  production-corpus rerun, release metadata, and alias retirement.
- A portable P3.3 v2 registration claim or a long-lived owner-selected
  project-policy namespace.
