import { Plugin } from "@opencode-ai/plugin/v2"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { buildIntentCaptureRecord } = require("./core/intent-capture.cjs") as {
  buildIntentCaptureRecord: (input: Record<string, unknown>) => Record<string, unknown>
}
const { normalizeOpenCodeToolEvent } = require("./core/opencode.cjs") as {
  normalizeOpenCodeToolEvent: (event: Record<string, unknown>) => Record<string, any>
}

const stateDir = path.join(os.homedir(), ".autopilot")
const disableFlag = path.join(stateDir, "opencode-intent-capture.disabled")
const failureCounter = path.join(stateDir, ".opencode-intent-capture-failures")
const failureThreshold = 10
const staleDisableHours = 24
const pluginDir = path.dirname(fileURLToPath(import.meta.url))

function findPluginRoot(): string {
  let current = pluginDir
  for (;;) {
    if (fs.existsSync(path.join(current, ".claude-plugin", "plugin.json")) || fs.existsSync(path.join(current, "plugin.json"))) return current
    const parent = path.dirname(current)
    if (parent === current) return pluginDir
    current = parent
  }
}

const pluginRoot = findPluginRoot()

function ensureDir(dir: string, mode = 0o700): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode })
}

function getPluginVersion(): string {
  try {
    for (const rel of [".claude-plugin/plugin.json", "plugin.json"]) {
      const pkgPath = path.join(pluginRoot, rel)
      if (!fs.existsSync(pkgPath)) continue
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
      return pkg.version || "unknown"
    }
  } catch {}
  return "unknown"
}

function readFailureCount(): number {
  try {
    return parseInt(fs.readFileSync(failureCounter, "utf8").trim(), 10) || 0
  } catch {
    return 0
  }
}

function writeFailureCount(count: number): void {
  try {
    ensureDir(stateDir)
    fs.writeFileSync(failureCounter, String(count), { mode: 0o600 })
  } catch {}
}

function checkDisableFlag(): boolean {
  try {
    if (!fs.existsSync(disableFlag)) return false
    const ageHours = (Date.now() - fs.statSync(disableFlag).mtimeMs) / 3_600_000
    if (ageHours > staleDisableHours) {
      fs.unlinkSync(disableFlag)
      return false
    }
    try {
      const content = JSON.parse(fs.readFileSync(disableFlag, "utf8"))
      if (content.plugin_version && content.plugin_version !== getPluginVersion()) {
        fs.unlinkSync(disableFlag)
        return false
      }
    } catch {
      fs.unlinkSync(disableFlag)
      return false
    }
    return true
  } catch {
    return false
  }
}

function writeDisableFlag(reason: string): void {
  try {
    ensureDir(stateDir)
    fs.writeFileSync(disableFlag, JSON.stringify({
      disabled_at: new Date().toISOString(),
      reason,
      plugin_version: getPluginVersion(),
      manual_reset: `rm ${disableFlag}`,
    }, null, 2), { mode: 0o600 })
    console.error(`[autopilot] opencode intent-capture disabled after ${failureThreshold} consecutive failures — see ${disableFlag}`)
  } catch {}
}

function workingDirectory(): string {
  try {
    return fs.realpathSync(process.cwd())
  } catch {
    return process.cwd()
  }
}

function intentFile(cwd: string): string {
  return path.join(stateDir, "intent", `${crypto.createHash("sha1").update(cwd).digest("hex")}.json`)
}

function summarizeToolInput(tool: string, input: unknown): string {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {}
  for (const key of ["file_path", "pattern", "command", "description", "prompt", "query", "url"]) {
    if (!record[key]) continue
    const value = String(record[key])
    return `${tool} ${value.length > 80 ? `${value.slice(0, 77)}...` : value}`
  }
  return tool
}

function captureIntent(tool: string, input: unknown, sessionID: string): void {
  if (process.env.AUTOPILOT_INTENT_CAPTURE === "false" || checkDisableFlag()) return
  try {
    const cwd = workingDirectory()
    const intentDir = path.join(stateDir, "intent")
    ensureDir(intentDir)
    const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 250,
      encoding: "utf8",
      cwd,
    }).stdout?.trim() || null
    const normalized = normalizeOpenCodeToolEvent({ tool, input, sessionID })
    const intent = buildIntentCaptureRecord({
      event: {
        tool: normalized.tool,
        tool_input: normalized.tool_input,
        session_id: normalized.session.id,
        input_source: "opencode-v2",
        cwd,
      },
      fallbackSessionId: "opencode",
      hostname: os.hostname(),
      nowIso: new Date().toISOString(),
      toolCount: null,
      gitBranch: branch,
      summarizeToolInput,
    })
    const file = intentFile(cwd)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(intent, null, 2) + "\n", { mode: 0o600 })
    fs.renameSync(tmp, file)
    writeFailureCount(0)
  } catch (error) {
    const failures = readFailureCount() + 1
    writeFailureCount(failures)
    const message = error instanceof Error ? error.message : String(error)
    if (failures >= failureThreshold) writeDisableFlag(`${failures} consecutive failures: ${message}`)
    console.error("[autopilot] intent-capture failed:", message)
  }
}

export default Plugin.define({
  id: "autopilot.lifecycle",
  setup: async (ctx) => {
    ensureDir(stateDir)
    console.error("[autopilot] plugin loaded, version:", getPluginVersion())
    console.error("[autopilot] working directory:", process.cwd())

    if (process.env.AUTOPILOT_PLUGIN_SMOKE === "1") {
      captureIntent("autopilot_smoke", { description: "v2 plugin setup smoke" }, "autopilot-smoke")
    }

    await ctx.tool.hook("execute.after", (event) => {
      captureIntent(event.tool, event.input, event.sessionID)
    })
  },
})
