#!/usr/bin/env node

import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// opencode v2 的全局配置目录在所有平台都是 ~/.config/opencode（除非设了 XDG_CONFIG_HOME），
// 插件清单键是 opencode.json(c) 里的 plugins。
const PLUGIN_SPEC = "opencode-sessions-sidebar"

function configDir() {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
}

async function exists(p) {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readJSONC(p) {
  const raw = await readFile(p, "utf-8")
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "")
  return JSON.parse(stripped)
}

function mergePlugin(existing, spec) {
  const plugins = existing.plugins ?? []
  if (plugins.some((p) => (typeof p === "string" ? p : p.package) === spec)) return false
  existing.plugins = [...plugins, spec]
  return true
}

async function main() {
  const dir = configDir()
  await mkdir(dir, { recursive: true })

  const jsonc = join(dir, "opencode.jsonc")
  const json = join(dir, "opencode.json")
  const target = (await exists(jsonc)) ? jsonc : json

  if (await exists(target)) {
    const cfg = await readJSONC(target)
    if (!mergePlugin(cfg, PLUGIN_SPEC)) {
      console.log(`[opencode-sessions-sidebar] Already in ${target}`)
      return
    }
    await writeFile(target, JSON.stringify(cfg, null, 2) + "\n")
    console.log(`[opencode-sessions-sidebar] Added to ${target}`)
  } else {
    await writeFile(target, JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [PLUGIN_SPEC] }, null, 2) + "\n")
    console.log(`[opencode-sessions-sidebar] Created ${target}`)
  }

  console.log("\nDone! Restart OpenCode to see the Sessions sidebar panel.")
}

main().catch((err) => {
  console.error("Install failed:", err.message)
  console.error("You can also run: opencode plugin add " + PLUGIN_SPEC)
  process.exit(1)
})
