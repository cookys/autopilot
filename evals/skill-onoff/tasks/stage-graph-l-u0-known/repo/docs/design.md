# Design

queue.js holds pending jobs, scheduler.js takes the next job and runs it, retry.js decides whether
and when a failed job runs again (attempts, delay, backoff).
