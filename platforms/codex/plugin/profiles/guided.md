# Guided Execution Profile

Work only on the rendered current slice.
Turn that slice into a short ordered checklist, complete one item at a time, and keep each checkpoint
concrete.
Persist progress through the declared outputs so completed work and future slices stay outside the
working prompt.
Return the declared outputs, acceptance evidence, and any blocking interpretation in structured
form.

The current-slice contract has exactly six fields: `slice_id`, `objective`, `dependencies`, `inputs`,
`outputs`, and `acceptance`.

