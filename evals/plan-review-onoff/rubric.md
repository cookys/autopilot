# Plan review rubric (frozen, identical for every task)

- R1: [file-truth] Every file or path the plan edits exists in the repository tree, or the plan says it will be created; no edit targets a path that does not exist or is generated.
- R2: [dependencies] Every dependency, prerequisite or assumption the plan relies on exists in the repository or is named as an unresolved blocker with a stated handling.
- R3: [negative-control] Each new or changed check is shown failing on a deliberately broken input before it is shown passing.
- R4: [scope] The plan states what is in and out of scope, and no step goes beyond the stated task.
- R5: [reversibility] Any destructive or hard-to-undo step has a backup or rollback and a safe ordering.
- R6: [commands] Every verification command named in the plan exists in this repository as written.
