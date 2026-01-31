import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useRemote } from "@/context/remote"

type SessionInfo = {
  id: string
  target: string
  repo: string
  git_ref: string
  port: number
  started_at: string
}

export function DialogRemoteSessions() {
  const dialog = useDialog()
  const remote = useRemote()
  const language = useLanguage()

  const [store, setStore] = createStore({
    target: "",
    keyPath: "",
    loading: false,
    sessions: [] as SessionInfo[],
    error: null as string | null,
  })

  async function fetchSessions() {
    if (!store.target.trim()) return

    setStore("loading", true)
    setStore("error", null)

    try {
      const sessions = await remote.listSessions(store.target.trim(), store.keyPath.trim() || undefined)
      setStore("sessions", sessions)
    } catch (e) {
      setStore("error", e instanceof Error ? e.message : String(e))
    } finally {
      setStore("loading", false)
    }
  }

  async function stopSession(sessionId: string) {
    try {
      await remote.stopSession(store.target.trim(), sessionId, store.keyPath.trim() || undefined)
      setStore(
        "sessions",
        store.sessions.filter((s) => s.id !== sessionId),
      )
    } catch (e) {
      setStore("error", e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog title={language.t("remote.sessions.title")}>
      <div class="flex flex-col gap-4 p-5">
        <div class="flex gap-3">
          <TextField
            placeholder={language.t("remote.connect.target.placeholder")}
            value={store.target}
            onChange={(v) => setStore("target", v)}
            onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && fetchSessions()}
            class="flex-1"
            hideLabel
          />
          <TextField
            placeholder={language.t("remote.connect.key.placeholder")}
            value={store.keyPath}
            onChange={(v) => setStore("keyPath", v)}
            class="flex-1"
            hideLabel
          />
          <Button onClick={fetchSessions} disabled={!store.target.trim() || store.loading}>
            {store.loading ? <Spinner /> : "Fetch"}
          </Button>
        </div>

        <Show when={store.error}>
          <div class="text-text-critical text-14-regular p-3 bg-surface-critical-weak rounded">{store.error}</div>
        </Show>

        <Show
          when={store.sessions.length > 0}
          fallback={
            <Show when={!store.loading && store.target.trim()}>
              <p class="text-text-weak text-center py-8">{language.t("remote.sessions.empty")}</p>
            </Show>
          }
        >
          <div class="flex flex-col gap-2 max-h-64 overflow-y-auto">
            <For each={store.sessions}>
              {(session) => (
                <div class="flex items-center justify-between p-3 bg-surface-base rounded">
                  <div class="flex flex-col gap-1 min-w-0">
                    <span class="text-14-semibold truncate">{session.id}</span>
                    <span class="text-12-regular text-text-weak truncate">
                      {session.repo} @ {session.git_ref}
                    </span>
                    <span class="text-12-regular text-text-weak">Port: {session.port}</span>
                  </div>
                  <IconButton
                    icon="circle-x"
                    variant="ghost"
                    onClick={() => stopSession(session.id)}
                    title={language.t("remote.sessions.stop")}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
