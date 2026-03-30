# Team — Project Config
# Place this file at: .claude/team-config.md

## Custom Role Templates
# Add project-specific roles here. These supplement the generic templates in the skill.
#
# model: haiku (mechanical) / sonnet (balanced) / opus (deep reasoning). Default: sonnet.
# boundaries: short "Do NOT" summary. Full boundaries go in the role prompt template.

# | Role | subagent_type | model | boundaries | Use Case |
# |------|--------------|-------|------------|----------|
# | server-dev | `general-purpose` | sonnet | no proto changes | C++ server changes |
# | sdk-dev | `voltagent-lang:typescript-pro` | sonnet | no server files | TypeScript SDK changes |
# | test-runner | `general-purpose` | haiku | read-only, no code changes | Run tests and report |
# | architect | `general-purpose` | opus | no implementation | Architecture review |
