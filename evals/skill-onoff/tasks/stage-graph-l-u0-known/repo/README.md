# jobrunner

Small in-process job runner: a queue of jobs, a scheduler that runs them one at a time and a retry
policy (attempt limit and delay). Known gap: the scheduler drops a failed job instead of retrying it
with the policy's delay; backoff and jitter on the delay are wanted later.
