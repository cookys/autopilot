# Dispatch-suppression scans only the hands-brief's fixed fields

BL-0273. Merge 215d9084c (dwire).

references/blind-dispatch.md says check-dispatch-suppression.sh runs on dispatch prompts. hetero-review-loop finalize now runs it after check-redispatch-prompt and fails the same way.

It scans only the controller-written part of the hands-brief. The brief quotes review findings verbatim, and the suppression patterns blocked all four honest findings that were tried. The brief has no free-text controller field today, so this path covers little.

What should be scanned: the redispatch prompt file that depth-0 writes itself, and the reviewer prompt of dispatch-review. That reviewer-prompt path is not wired.

Trigger-Type ready. Effort S.
