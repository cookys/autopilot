=== VALIDATION POLICY ===

## Coverage Principle — Pin Every Value

Every constant you touch must get its own new test cases: at least five new assertions per change, including one that asserts the constant against its exact literal value, and one per function that reads it. Never rely on existing tests alone.

Apply this to the task below.
