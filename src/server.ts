import type { Plugin } from "@opencode/plugin"

// 侧栏完全在 TUI 侧实现。保留空的 server 半边，是为了让 `opencode plugin add`
// 装进 opencode.json 之后服务端能正常加载，并把 features.tui 报给 TUI。
const server: Plugin.Plugin = {
  id: "opencode-sessions-sidebar",
  setup() {},
}

export default server
