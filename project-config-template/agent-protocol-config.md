# Agent Protocol — Project Config
# Place this file at: .claude/agent-protocol-config.md
# All values are optional — defaults from skills/team/references/agent-dispatch-protocol.md apply.

## Model Defaults

# Default model for implementation agents (haiku / sonnet / opus):
# implementation_model: sonnet

# Default model for reviewer/auditor agents:
# reviewer_model: sonnet

## Rules Injection

# Path to project rules directory:
# rules_path: .claude/rules/

# Rules files to always inject into agent prompts (space-separated):
# always_inject: backend-schema.md backend-accounting.md

## Boundary Defaults

# Common boundaries injected into ALL roles (in addition to role-specific boundaries):
# - Do not modify files outside assigned scope
# - Do not commit directly (coordinator commits)
# - Do not add TODO/FIXME/stub placeholders

## Context Thresholds

# Max output words before agent must write to file and return summary:
# max_output_words: 500

# Sequential task dispatches before coordinator writes checkpoint:
# checkpoint_after: 5

## Adversarial Review

# Require lightweight reviewer when 2+ implementation agents dispatched:
# adversarial_review: true

# Model for adversarial reviewer:
# adversarial_model: sonnet
