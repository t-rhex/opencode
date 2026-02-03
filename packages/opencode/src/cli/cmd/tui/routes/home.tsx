import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useRemote } from "../context/remote"

// TODO: what is the best way to do this?
let once = false

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}G`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}T`
}

const HomeDiagnosticsDisplay = () => {
  const sync = useSync()
  const { theme } = useTheme()

  const diagnostics = createMemo(() => sync.data.diagnostics)

  return (
    <Show when={diagnostics()}>
      <text fg={theme.textMuted}>
        <Show when={diagnostics()!.disk}>
          <span style={{ fg: diagnostics()!.disk!.percent > 90 ? theme.error : theme.textMuted }}>
            disk:{diagnostics()!.disk!.percent}%
          </span>
        </Show>
        <Show when={diagnostics()!.memory}>
          {" "}
          <span style={{ fg: diagnostics()!.memory!.percent > 90 ? theme.error : theme.textMuted }}>
            mem:{formatBytes(diagnostics()!.memory!.used)}
          </span>
        </Show>
      </text>
    </Show>
  )
}

const HomeGitStatus = () => {
  const sync = useSync()
  const { theme } = useTheme()

  const vcs = createMemo(() => sync.data.vcs)

  return (
    <Show when={vcs()?.branch}>
      <text fg={theme.textMuted}>
        {vcs()?.branch}
        <Show when={vcs()!.staged > 0}>
          <span style={{ fg: theme.success }}> +{vcs()!.staged}</span>
        </Show>
        <Show when={vcs()!.unstaged > 0}>
          <span style={{ fg: theme.warning }}> ~{vcs()!.unstaged}</span>
        </Show>
      </text>
    </Show>
  )
}

const HomeConnectionStatus = () => {
  const sync = useSync()
  const remote = useRemote()
  const args = useArgs()
  const { theme } = useTheme()

  // If not remote, don't show anything
  if (!sync.data.path.remote) return null

  const state = remote.state
  const host = createMemo(() => {
    if (args.remote) {
      const r = args.remote
      const port = r.port !== 22 ? `:${r.port}` : ""
      return `${r.username}@${r.host}${port}`
    }
    return state?.host ?? "remote"
  })

  // No state yet means we're connected (initial state before any changes)
  if (!state) {
    return (
      <box flexDirection="row" gap={1}>
        <HomeGitStatus />
        <HomeDiagnosticsDisplay />
        <text fg={theme.success}>SSH: {host()}</text>
      </box>
    )
  }

  const retryCountdown = createMemo(() => {
    if (state.status !== "reconnecting" || !state.nextRetryAt) return 0
    return Math.max(0, Math.ceil((state.nextRetryAt.getTime() - Date.now()) / 1000))
  })

  return (
    <box flexDirection="row" gap={1}>
      <HomeGitStatus />
      <HomeDiagnosticsDisplay />
      <Switch fallback={null}>
        <Match when={state.status === "connected"}>
          <text fg={theme.success}>SSH: {host()}</text>
        </Match>
        <Match when={state.status === "connecting"}>
          <text fg={theme.warning}>SSH: connecting...</text>
        </Match>
        <Match when={state.status === "reconnecting"}>
          <text fg={theme.warning}>
            SSH: reconnecting ({state.reconnectAttempt}/10)
            {retryCountdown() > 0 ? ` ${retryCountdown()}s` : ""}
          </text>
        </Match>
        <Match when={state.status === "error"}>
          <text fg={theme.error}>SSH: disconnected</text>
        </Match>
        <Match when={state.status === "disconnected"}>
          <text fg={theme.textMuted}>SSH: disconnected</text>
        </Match>
      </Switch>
    </box>
  )
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })
  const directory = useDirectory()

  const keybind = useKeybind()

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        <box height={3} />
        <Logo />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
          />
        </box>
        <box height={3} width="100%" maxWidth={75} alignItems="center" paddingTop={2}>
          <Show when={showTips()}>
            <Tips />
          </Show>
        </box>
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <Switch>
            <Match when={sync.data.path.remote}>
              <HomeConnectionStatus />
            </Match>
            <Match when={sync.data.vcs?.branch}>
              <HomeGitStatus />
            </Match>
            <Match when={true}>
              <text fg={theme.textMuted}>{Installation.VERSION}</text>
            </Match>
          </Switch>
        </box>
      </box>
    </>
  )
}
