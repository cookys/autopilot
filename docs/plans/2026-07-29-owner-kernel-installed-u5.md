# Owner Kernel installed activation U5

> Parent: `2026-07-24-owner-kernel-p37-activation.md`
> Scope: installed semantic authority and one fixed reversible probe only

## Deliverable contract

Build the smallest installed P3.7 vertical that turns the existing P3.6 durable substrate and
P3.7 external-host contracts into real cross-UID authority.

The root-owned installer snapshots a sixth, dedicated Kernel service plus the exact runtime
dependency closure. A one-shot `run-probe` operation must:

1. consume one exact P3.5d v2 handoff and exclusive P3.6 cohort claim;
2. start six distinct systemd identities for Kernel, worker, broker, receipt verifier, witness,
   and coordinator;
3. authenticate every peer with `SO_PEERCRED`, process start identity, and exact cgroup;
4. route semantic witness operations through the installed receipt-verifier and witness;
5. execute only `owner-kernel-probe-toggle-v1`, then independently verify and restore it;
6. tear down every transient unit and runtime path while preserving root-owned audit evidence.

The caller cannot supply a command, path, tool, target, catalog row, receipt root, or service
identity. Crash ambiguity returns `unknown` or `recovery_required`; it never replays an effect.
The installed Engine sink and acceptance remain disabled in U5.

### Required mutations

- `src/engine/supervised-owner-kernel-installed-contract.js`
- `src/engine/supervised-owner-kernel-installed-host.py`
- `src/engine/supervised-owner-kernel-installed-service.py`
- `src/engine/supervised_owner_kernel_installed_transport.py`
- `src/engine/supervised_owner_kernel_installed.py`
- `src/engine/supervised-owner-kernel-installed-ipc.js`
- `src/engine/supervised-owner-kernel-installed-runner.js`
- `src/engine/index.js`
- `hooks/tests/supervised-owner-kernel-installed-contract.test.sh`
- `hooks/tests/supervised-owner-kernel-installed-host.test.sh`
- `hooks/tests/supervised-owner-kernel-installed-live.test.sh`

### Acceptance commands

```bash
bash hooks/tests/supervised-owner-kernel-installed-contract.test.sh
bash hooks/tests/supervised-owner-kernel-installed-host.test.sh
bash hooks/tests/supervised-owner-kernel-semantic-witness.test.sh
bash hooks/tests/supervised-owner-kernel-probe-effect.test.sh
AUTOPILOT_P37_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-owner-kernel-installed-live.test.sh
git diff --check
```

## Boundaries

- No arbitrary command, path, target, or tool execution.
- No installed Engine implementation sink or acceptance transaction.
- No claim of cross-platform support or protection from a compromised root host.
- No alias deletion, P4 qualification, release publication, or external deployment.
