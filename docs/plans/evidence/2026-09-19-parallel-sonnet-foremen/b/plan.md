# Plan B — BOUNDARY_REJECTED becomes resumable
1. RED: engine case, resume from BOUNDARY_REJECTED with resume_candidate null → blocked "cannot dispatch implementation".
2. Record a git_candidate-shaped reference on the BOUNDARY_REJECTED event when the hand had committed; reducer preserves it; replay populates candidate_reference → resume_candidate.
3. Resume path: re-check quiescence via the existing boundary fingerprint; quiescent → continue from the candidate (verify → review); mutated → second BOUNDARY_REJECTED, no terminalize. No-candidate → honest message.
4. Reducer pins (accepted with candidate; wrong digest still refused); e2e resume_candidate !== null; sync mirrors; verify; ONE commit.
Acceptance: the 2-A shape (91-min committed hand, then boundary hit) resumes into verification instead of terminalizing.
