/**
 * Autopilot Plugin for OpenCode
 *
 * Provides lifecycle orchestration hooks for autopilot.
 * Ports the most critical Claude Code hooks:
 * - Session start/intent capture
 * - State checkpointing for compaction
 * - Config reload detection
 */

import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as crypto from "crypto"
import { fileURLToPath } from "node:url"

const STATE_DIR = path.join(os.homedir(), ".autopilot")

// Circuit breaker — parity with hooks/intent-capture.js, but OpenCode-specific
// flag/counter filenames so the two runtimes don't cross-contaminate state when
// a user runs both Claude Code and OpenCode in the same repo.
const DISABLE_FLAG = path.join(STATE_DIR, "opencode-intent-capture.disabled")
const FAILURE_COUNTER = path.join(STATE_DIR, ".opencode-intent-capture-failures")
const FAILURE_THRESHOLD = 10
const STALE_DISABLE_HOURS = 24

// __dirname is undefined in OpenCode Bun ESM plugin context (Spike 0 verified
// against OpenCode 1.15.10). Use import.meta.url + fileURLToPath instead.
const __filename = fileURLToPath(import.meta.url)
const PLUGIN_DIR = path.dirname(__filename)
// 2-level climb: .opencode/plugins/ → .opencode/ → repo root
const PLUGIN_ROOT = path.join(PLUGIN_DIR, "..", "..")

function ensureDir(dir: string, mode: number = 0o700): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode })
  }
}

function getPluginVersion(): string {
  try {
    // Read .claude-plugin/plugin.json (canonical, per §3.7 of v2.7.3 plan).
    // Fall back to root plugin.json (mirror) for compatibility.
    for (const rel of [".claude-plugin/plugin.json", "plugin.json"]) {
      const pkgPath = path.join(PLUGIN_ROOT, rel)
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
        return pkg.version || "unknown"
      }
    }
  } catch {
    // ignore
  }
  return "unknown"
}

// === Circuit breaker (ported from hooks/intent-capture.js) ===

function readFailureCount(): number {
  try {
    return parseInt(fs.readFileSync(FAILURE_COUNTER, "utf8").trim(), 10) || 0
  } catch {
    return 0
  }
}

function writeFailureCount(n: number): void {
  try {
    ensureDir(STATE_DIR, 0o700)
    fs.writeFileSync(FAILURE_COUNTER, String(n), { mode: 0o600 })
  } catch { /* ignore */ }
}

// Returns true if intent-capture should skip (flag active & not auto-clearable).
function checkDisableFlag(): boolean {
  try {
    if (!fs.existsSync(DISABLE_FLAG)) return false

    const stat = fs.statSync(DISABLE_FLAG)
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)

    // Auto-clear: stale (>24h)
    if (ageHours > STALE_DISABLE_HOURS) {
      try { fs.unlinkSync(DISABLE_FLAG) } catch { /* ignore */ }
      return false
    }

    // Auto-clear: plugin version differs
    try {
      const content = JSON.parse(fs.readFileSync(DISABLE_FLAG, "utf8"))
      if (content.plugin_version && content.plugin_version !== getPluginVersion()) {
        try { fs.unlinkSync(DISABLE_FLAG) } catch { /* ignore */ }
        return false
      }
    } catch { /* malformed flag — leave active */ }

    return true
  } catch {
    return false
  }
}

function writeDisableFlag(reason: string): void {
  try {
    ensureDir(STATE_DIR, 0o700)
    const content = {
      disabled_at: new Date().toISOString(),
      reason,
      plugin_version: getPluginVersion(),
      manual_reset: `rm ${DISABLE_FLAG}`,
    }
    fs.writeFileSync(DISABLE_FLAG, JSON.stringify(content, null, 2), { mode: 0o600 })
    console.error(`[autopilot] opencode intent-capture disabled after ${FAILURE_THRESHOLD} consecutive failures — see ${DISABLE_FLAG}`)
  } catch { /* nothing more we can do */ }
}

export default (async ({ client, project, directory, worktree }) => {
  ensureDir(STATE_DIR, 0o700)

  return {
    config: (cfg) => {
      console.error("[autopilot] plugin loaded, version:", getPluginVersion())
      console.error("[autopilot] working directory:", directory)
    },

    event: async ({ event }) => {
      if (event.type === "session.created") {
        const sessionId = event.properties?.session_id
        console.error("[autopilot] session created:", sessionId)

        const intentDir = path.join(STATE_DIR, "intent")
        ensureDir(intentDir)

        const cwd = process.cwd()
        let realCwd = cwd
        try {
          realCwd = fs.realpathSync(cwd)
        } catch { /* ignore */ }

        const hash = crypto.createHash("sha1").update(realCwd).digest("hex")
        const intentFile = path.join(intentDir, `${hash}.json`)

        if (fs.existsSync(intentFile)) {
          try {
            const intent = JSON.parse(fs.readFileSync(intentFile, "utf8"))
            const ageMs = Date.now() - new Date(intent.last_updated).getTime()
            const ageHours = ageMs / (1000 * 60 * 60)

            if (ageHours < 24 && intent.cwd === realCwd) {
              console.error("[autopilot] resume hint from previous session:")
              console.error("  last tool:", intent.last_tool)
              console.error("  last action:", intent.last_tool_input_summary)
              console.error("  git branch:", intent.git_branch || "unknown")
            }
          } catch { /* ignore */ }
        }
      }

      if (event.type === "session.compacted") {
        console.error("[autopilot] session compacted")
      }
    },

    "tool.execute.after": async (input, output) => {
      if (process.env.AUTOPILOT_INTENT_CAPTURE === "false") return

      // Circuit breaker: skip if disabled (with auto-clear on stale / version bump)
      if (checkDisableFlag()) return

      try {
        const intentDir = path.join(STATE_DIR, "intent")
        ensureDir(intentDir)

        const cwd = process.cwd()
        let realCwd = cwd
        try {
          realCwd = fs.realpathSync(cwd)
        } catch { /* ignore */ }

        const candidates = ["file_path", "pattern", "command", "description", "prompt", "query", "url"]
        let summary = input.tool
        if (input.args && typeof input.args === "object") {
          for (const key of candidates) {
            if ((input.args as Record<string, unknown>)[key]) {
              const v = String((input.args as Record<string, unknown>)[key])
              summary = `${input.tool} ${v.length > 80 ? v.slice(0, 77) + "..." : v}`
              break
            }
          }
        }

        const gitBranch = (() => {
          try {
            const { spawnSync } = require("child_process")
            const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
              timeout: 250,
              encoding: "utf8",
              cwd,
            })
            return (r.stdout || "").trim() || null
          } catch {
            return null
          }
        })()

        const hash = crypto.createHash("sha1").update(realCwd).digest("hex")
        const intentFile = path.join(intentDir, `${hash}.json`)

        const intent = {
          session_id: "opencode",
          hostname: os.hostname(),
          last_updated: new Date().toISOString(),
          last_tool: input.tool,
          last_tool_input_summary: summary,
          cwd: realCwd,
          git_branch: gitBranch,
        }

        const tmp = `${intentFile}.${process.pid}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(intent, null, 2) + "\n", { mode: 0o600 })
        fs.renameSync(tmp, intentFile)

        // Reset failure counter on success
        writeFailureCount(0)
      } catch (err) {
        // Increment failure counter; engage circuit breaker at threshold
        const failures = readFailureCount() + 1
        writeFailureCount(failures)
        if (failures >= FAILURE_THRESHOLD) {
          writeDisableFlag(`${failures} consecutive failures: ${(err as Error).message}`)
        }
        console.error("[autopilot] intent-capture failed:", (err as Error).message)
      }
    },
  }
}) satisfies Plugin
