/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

type Ctx = Plugin.Context
type Session = ReturnType<Ctx["data"]["session"]["list"]>[number]

const DEFAULT_MAX_SESSIONS = 10
// storage 按插件分区，键名不需要再加前缀
const STORE_KEY = "panel"

const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]

function SessionsPanel(props: { context: Ctx; sessionID: string }): JSX.Element {
  const theme = props.context.theme
  const data = props.context.data
  const [view, updateView] = props.context.storage.store(STORE_KEY, {
    initial: { open: true, maxSessions: DEFAULT_MAX_SESSIONS },
  })
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [loading, setLoading] = createSignal(true)
  const [spinner, setSpinner] = createSignal(0)

  // 会话列表只有本地 store 里已加载的那些，所以按内置会话列表对话框的口径直接查服务端
  const fetchSessions = async () => {
    const directory = (data.session.get(props.sessionID)?.location ?? data.location.default()).directory
    try {
      const response = await props.context.client.session.list({
        directory,
        parentID: null, // 服务端只返回根会话，避免子会话占满 limit
        limit: 100,
        order: "desc",
      })
      const items = response.data
      if (Array.isArray(items)) setSessions(items.filter((session) => !session.parentID))
    } catch {
      // 网络或服务端错误：保留旧数据
    } finally {
      setLoading(false)
    }
  }

  const visible = createMemo(() => {
    const limit = view.maxSessions > 0 ? view.maxSessions : DEFAULT_MAX_SESSIONS
    return [...sessions()]
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, limit)
  })

  // 只在真的有会话在跑时才开定时器，避免空转
  createEffect(() => {
    if (!visible().some((session) => data.session.status(session.id) === "running")) return
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
                <box flexDirection="row" gap={1} minWidth={0} onMouseUp={() => switchTo(session.id)}>
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
