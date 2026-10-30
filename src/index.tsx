/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

type Ctx = Plugin.Context
type Session = ReturnType<Ctx["data"]["session"]["list"]>[number]

const DEFAULT_MAX_SESSIONS = 10
// storage 按插件分区，键名不需要再加前缀
const STORE_KEY = "panel"
const EXPANDED_KEY = "expanded"
// 一次取全量再本地分组：根会话和子会话一起回来，避免为每个父会话单独发一次请求。
// 当前库里约 140 个根会话 + 45 个子会话，500 足够覆盖很远。
const FETCH_LIMIT = 500

const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]

function SessionsPanel(props: { context: Ctx; sessionID: string }): JSX.Element {
  const theme = props.context.theme
  const data = props.context.data
  const [view, updateView] = props.context.storage.store(STORE_KEY, {
    initial: { open: true, maxSessions: DEFAULT_MAX_SESSIONS },
  })
  const [expanded, updateExpanded] = props.context.storage.store(EXPANDED_KEY, {
    initial: { ids: [] as string[] },
  })
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [loading, setLoading] = createSignal(true)
  const [spinner, setSpinner] = createSignal(0)

  // 不传 parentID：服务端同时返回根会话与子会话，本地按 parentID 分组。
  const fetchSessions = async () => {
    const directory = (data.session.get(props.sessionID)?.location ?? data.location.default()).directory
    try {
      const response = await props.context.client.session.list({
        directory,
        limit: FETCH_LIMIT,
        order: "desc",
      })
      const items = response.data
      if (Array.isArray(items)) setSessions(items)
    } catch {
      // 网络或服务端错误：保留旧数据
    } finally {
      setLoading(false)
    }
  }

  /** 只有根会话进主列表。 */
  const roots = createMemo(() => sessions().filter((session) => !session.parentID))

  /** parentID → 直接子会话，按时间升序，早的排在上面。 */
  const childrenOf = createMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of sessions()) {
      if (!session.parentID) continue
      const siblings = map.get(session.parentID)
      if (siblings) siblings.push(session)
      else map.set(session.parentID, [session])
    }
    for (const siblings of map.values()) siblings.sort((a, b) => a.time.updated - b.time.updated)
    return map
  })

  /** 当前会话若是子会话，返回其父会话 id，用于定位和强制展开。 */
  const currentParentID = createMemo(
    () => sessions().find((session) => session.id === props.sessionID)?.parentID ?? null,
  )

  const visible = createMemo(() => {
    const limit = view.maxSessions > 0 ? view.maxSessions : DEFAULT_MAX_SESSIONS
    const sorted = [...roots()].sort((a, b) => b.time.updated - a.time.updated)
    // 正在看子会话时，父会话必须留在可见范围内，否则会看不到自己所在的线程
    const parentID = currentParentID()
    if (parentID) {
      const index = sorted.findIndex((session) => session.id === parentID)
      if (index >= limit) {
        const [parent] = sorted.splice(index, 1)
        if (parent) sorted.unshift(parent)
      }
    }
    return sorted.slice(0, limit)
  })

  // 只在真的有会话在跑时才开定时器，避免空转。子会话也要算在内。
  createEffect(() => {
    const idle =
      !visible().some((session) => data.session.status(session.id) === "running") &&
      ![...childrenOf().values()].some((siblings) =>
        siblings.some((session) => data.session.status(session.id) === "running"),
      )
    if (idle) return
    const timer = setInterval(() => setSpinner((frame) => (frame + 1) % SPINNER_FRAMES.length), 80)
    onCleanup(() => clearInterval(timer))
  })

  let fetchTimer: ReturnType<typeof setTimeout> | undefined
  const debouncedFetch = () => {
    clearTimeout(fetchTimer)
    fetchTimer = setTimeout(() => void fetchSessions(), 200)
  }

  onMount(() => {
    void fetchSessions()
    const unsubscribe = [
      data.on("session.created", debouncedFetch),
      data.on("session.renamed", debouncedFetch),
      data.on("session.deleted", debouncedFetch),
    ]
    onCleanup(() => {
      clearTimeout(fetchTimer)
      for (const off of unsubscribe) off()
    })
  })

  const title = (session: Session): string => session.title?.trim() || session.id.slice(0, 8)

  const bullet = (session: Session): { char: string; fg: typeof theme.text.base } => {
    if (data.session.status(session.id) === "running")
      return { char: SPINNER_FRAMES[spinner() % SPINNER_FRAMES.length], fg: theme.text.feedback.info.base }
    if (session.id === props.sessionID) return { char: "\u2022", fg: theme.text.feedback.success.base }
    return { char: "\u2022", fg: theme.text.muted }
  }

  const switchTo = (sessionID: string) => {
    if (sessionID === props.sessionID) return
    props.context.ui.router.navigate({ type: "session", sessionID })
  }

  const hasChildren = (sessionID: string) => (childrenOf().get(sessionID)?.length ?? 0) > 0

  // 正在看某个子会话时，它的父会话强制展开，否则看不到自己所在的位置
  const isOpen = (sessionID: string) => expanded.ids.includes(sessionID) || sessionID === currentParentID()

  const toggle = (sessionID: string) => {
    void updateExpanded((draft) => {
      const index = draft.ids.indexOf(sessionID)
      if (index >= 0) draft.ids.splice(index, 1)
      else draft.ids.push(sessionID)
    }).catch(() => {})
  }

  return (
    <box>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => {
          void updateView((draft) => {
            draft.open = !draft.open
          }).catch(() => {})
        }}
      >
        <text fg={theme.text.base}>{view.open ? "\u25BC" : "\u25B6"}</text>
        <text fg={theme.text.base}>
          <b>Sessions</b>
          <Show when={visible().length > 0}>
            <span style={{ fg: theme.text.muted }}> ({visible().length})</span>
          </Show>
        </text>
      </box>
      <Show when={view.open}>
        <Show when={!loading()} fallback={<text fg={theme.text.muted}>Loading...</text>}>
          <Show when={visible().length > 0} fallback={<text fg={theme.text.muted}>No sessions yet</text>}>
            <For each={visible()}>
              {(session) => (
                <box flexDirection="column">
                  <box flexDirection="row" gap={1} minWidth={0} onMouseUp={() => switchTo(session.id)}>
                    {/* 展开箭头单独占一列：点击它只切换折叠，不跳转会话 */}
                    <box
                      flexShrink={0}
                      onMouseUp={(event) => {
                        event.stopPropagation()
                        if (hasChildren(session.id)) toggle(session.id)
                      }}
                    >
                      <text fg={theme.text.muted}>
                        {hasChildren(session.id) ? (isOpen(session.id) ? "\u25BE" : "\u25B8") : " "}
                      </text>
                    </box>
                    <text flexShrink={0} fg={bullet(session).fg}>
                      {bullet(session).char}
                    </text>
                    <text
                      fg={session.id === props.sessionID ? theme.text.base : theme.text.muted}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                      flexShrink={1}
                      minWidth={0}
                    >
                      {title(session)}
                    </text>
                  </box>
                  <Show when={hasChildren(session.id) && isOpen(session.id)}>
                    <For each={childrenOf().get(session.id) ?? []}>
                      {(child, index) => {
                        const running = () => data.session.status(child.id) === "running"
                        return (
                          <box
                            flexDirection="row"
                            gap={1}
                            minWidth={0}
                            paddingLeft={2}
                            opacity={0.72}
                            onMouseUp={() => switchTo(child.id)}
                          >
                            {/* 子会话用树形连接符代替圆点：层级关系由字符本身表达，
                                不靠缩进，窄面板里也不会和根会话混淆 */}
                            <text
                              flexShrink={0}
                              fg={running() ? theme.text.feedback.info.base : theme.text.muted}
                            >
                              {running()
                                ? SPINNER_FRAMES[spinner() % SPINNER_FRAMES.length]
                                : index() === (childrenOf().get(session.id)?.length ?? 0) - 1
                                  ? "\u2514"
                                  : "\u251C"}
                            </text>
                            <text
                              fg={child.id === props.sessionID ? theme.text.base : theme.text.muted}
                              wrapMode="none"
                              truncate
                              flexGrow={1}
                              flexShrink={1}
                              minWidth={0}
                            >
                              {title(child)}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </box>
  )
}

const tui: Plugin.Definition = {
  id: "opencode-sessions-sidebar",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (input) => <SessionsPanel context={context} sessionID={input.sessionID} />,
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "sessions.count",
          title: "Sessions: Set Max Count",
          group: "Sessions",
          slash: { name: "sessions-count" },
          palette: true,
          async run() {
            const [view, updateView] = context.storage.store(STORE_KEY, {
              initial: { open: true, maxSessions: DEFAULT_MAX_SESSIONS },
            })
            const value = await context.ui.dialog.prompt({
              title: "Max Sessions",
              description: "Maximum number of sessions shown in the sidebar (1-100)",
              placeholder: String(DEFAULT_MAX_SESSIONS),
              value: String(view.maxSessions),
            })
            if (value === undefined) return
            const count = Number.parseInt(value, 10)
            if (!(count >= 1 && count <= 100)) {
              context.ui.toast.show({ message: "Enter a number between 1 and 100", variant: "warning" })
              return
            }
            await updateView((draft) => {
              draft.maxSessions = count
            })
            context.ui.toast.show({ message: `Max sessions set to ${count}` })
          },
        },
      ],
    }))
  },
}

export default tui
