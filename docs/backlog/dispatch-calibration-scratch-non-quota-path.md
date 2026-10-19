# Move large dispatch calibration scratch to a non-quota path

No sidecar existed in history. Original row text from 5d0b29c1d^:docs/BACKLOG.md. Items (a)(b)(c) already shipped; only item (d) remains.

> ### dispatch 大型 calibration/eval scratch 改走非配額路徑（usrquota 事故殘項 d）
> - **Trigger**: 下次跑 calibration.sh / swe-calibrate 類大型 clone 校準，或 /tmp per-user 用量再度異常成長時。
> - **Context**: 2026-07-13 /tmp usrquota incident (about 21.3 GiB under the account, EDQUOT, machine-wide Bash stall). Of four fixes, prune-on-start, the manifest reaper, and the TMPDIR redirect plus trap repair shipped in v2.32.22. Left: swe-calibrate scratch (44 directories, about 110M each) still writes under TMPDIR. A candidate is to default those clones to a non-quota scratch path and delete them when the run finishes.
> - **Effort**: S
> - **Source**: 2026-07-13 session 實地診斷＋v2.32.22 fix/tmp-residue-retention。

Audit finding (section 3.3, dropped by 5d0b29c1d): item (d) was not done. No script producing the swe-calibrate scratch directories was found in the repo, so it may no longer exist. Origin self. Trigger-Type event.

Restored 2026-10-19 from 5d0b29c1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
