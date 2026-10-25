# Batch tooling

All dispatches return at once; their results land later as files under `runs/`.

    scripts/dispatch-hetero.sh --repair <lane|pool> <finding-ids>   open a repair dispatch for the listed findings (ids comma-separated, e.g. A-F1,B-F2)
    scripts/dispatch-review.sh --sha <sha>                           dispatch the review panel on a candidate sha
    scripts/dispatch-review.sh --re-review --blind --sha <sha>       blind re-review of a sha after a repair
    scripts/dispatch-acceptance.sh --sha <sha>                       dispatch the acceptance run on a candidate sha
    node scripts/wait-dispatch-results.js --expect <run_id>.<stage>  one poll for a dispatched run; says whether <run_id>.<stage>.exit has landed
    scripts/merge-lane.sh <lane>                                     merge a landed lane candidate into the integration branch
    scripts/continue-lane.sh <lane>                                  integrate a landed lane candidate and send the lane on to its next phase
    scripts/harvest-receipt.sh <run_id>                              collect the run's result receipt
