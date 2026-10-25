# claude-call-capture-exec.sh -- SOURCED by the PATH `claude` wrapper of run-eval-batch.sh and run-skill-opt.sh (BL-0294); not run directly.
# Expects: REAL_CLAUDE (the real binary) and EXTRA_ARGS (the full argument array for it). Optional env: EVAL_CALL_RECORD_DIR (the
# per-run record directory; unset = plain pass-through) and CLAUDE_CAPTURE_JS (scripts/lib/claude-call-capture.js).
# Always ends in `exec "$REAL_CLAUDE"`: the caller's kill (run_eval.py SIGKILLs its child) hits claude itself, never an intermediate shell.
if [ -n "${EVAL_CALL_RECORD_DIR:-}" ]; then
  # Boundary check: a record that already died on authentication stops every later start (no paid call, STOP marker).
  node "$CLAUDE_CAPTURE_JS" judge --dir "$EVAL_CALL_RECORD_DIR" < /dev/null || exit 6
  _rec="$EVAL_CALL_RECORD_DIR/$$-$RANDOM"
  node "$CLAUDE_CAPTURE_JS" register --rec "$_rec" --pid "$$" < /dev/null
  # The mirrors are small Node programs, not tee: they watch this pid (exec keeps it = claude's pid) and finish when it is gone,
  # even if a grandchild of claude still holds the pipe open.
  exec 2> >(node "$CLAUDE_CAPTURE_JS" mirror --pid "$$" --rec "$_rec.err" --fd 2)
  exec 1> >(node "$CLAUDE_CAPTURE_JS" mirror --pid "$$" --rec "$_rec.out" --fd 1)
fi
exec "$REAL_CLAUDE" "${EXTRA_ARGS[@]}"
