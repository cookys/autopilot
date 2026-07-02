# Debug Config

Project-specific tool tables for the `debug` skill.
Add your stack's debugging commands here so the debug skill knows which tools to reach for.

## Backend

| Problem | Tools |
|---------|-------|
| API errors | `<your-debug-command>` |
| SQL/DB errors | `<your-db-debug-command>` |
| Crash / panic | `<your-backtrace-command>` |
| Performance | `<your-profiling-command>` |

## Frontend

| Problem | Tools |
|---------|-------|
| Rendering issues | Browser DevTools, framework-specific devtools |
| API call failures | DevTools Network tab |
| State issues | Framework devtools (React/Vue/Svelte) |
| Build failures | `<your-build-command>` |

## Database

| Problem | Tools |
|---------|-------|
| Query performance | `EXPLAIN ANALYZE <query>` |
| Schema issues | `<your-schema-inspect-command>` |
| Data inspection | `<your-db-cli> <connection-string>` |

## Infrastructure

| Problem | Tools |
|---------|-------|
| Container crash | `docker compose logs --tail=100 <service>` |
| Network issues | `curl`, `netcat`, DNS tools |
| Build failures | `<your-container-build-command>` |

## Log Locations

| Component | Log Path / Command |
|-----------|--------------------|
| Backend | `<path-or-command>` |
| Frontend | Browser console |
| Database | `<path-or-command>` |
