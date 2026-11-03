# plan-review: author-side precondition_failed burns the logical id

BL-0296. scripts/dispatch-plan-review.js: classification (~:1280-1285), hard abort (:1518), terminal:true (:1610-1629), id burn (:1881-1888). A same-generation rerun would not make the freeze drift; the block is the terminal lock.

Line numbers re-checked at 403c47f30 (2026-10-28, bltidy20), since the original numbers drifted: classification `policyRefuse` :1280-1283; hard abort `if (normalized.transport_status === 'precondition_failed') break;` :1519; `firstPreconditionPolicyReason` :1598-1606; `policyArtifact` with `terminal: true` :1621; the terminal verdict is written to the session state at :1941, :1999 and :2301, and the later refusal `ticket_session_already_terminal ... re-review needs a new logical_plan_id and ticket` is raised at :1883-1885. The behaviour described above is unchanged.
