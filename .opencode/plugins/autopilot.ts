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

const STATE_DIR = path.join(os.homedir(), ".autopilot")

function ensureDir(dir: string, mode: number = 0o700): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode })
  }
}

function getPluginVersion(): string {
  try {
    const pluginRoot = path.join(__dirname, "..", "..", "..")
    const pkgPath = path.join(pluginRoot, "plugin.json")
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
      return pkg.version || "unknown"
    }
  } catch {
    // ignore
  }
  return "unknown"
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
      } catch (err) {
        console.error("[autopilot] intent-capture failed:", (err as Error).message)
      }
    },
  }
}) satisfies Plugin
