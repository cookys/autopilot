# plan-review: author-side precondition_failed burns the logical id

BL-0296. scripts/dispatch-plan-review.js: classification (~:1280-1285), hard abort (:1518), terminal:true (:1610-1629), id burn (:1881-1888). A same-generation rerun would not make the freeze drift; the block is the terminal lock.
