import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

export type RemoteStatus = "disconnected" | "connecting" | "connected" | "error"

export type RemoteSession = {
  id: string
  target: string
  repo: string
  ref: string
  port: number
  localPort: number
  startedAt: string
}

export const { use: useRemote, provider: RemoteProvider } = createSimpleContext({
  name: "Remote",
  init: () => {
    const platform = usePlatform()
    const server = useServer()

    const [store, setStore] = createStore({
      status: "disconnected" as RemoteStatus,
      session: null as RemoteSession | null,
      error: null as string | null,
      previousUrl: null as string | null,
    })

    const isRemote = createMemo(() => store.status === "connected" && store.session !== null)
    const canRemote = createMemo(() => platform.platform === "desktop" && !!platform.remoteConnect)

    async function connect(opts: { target: string; repo: string; ref: string; keyPath?: string }) {
      if (!platform.remoteConnect) {
        setStore("error", "Remote connections not supported on this platform")
        setStore("status", "error")
        return
      }

      setStore("status", "connecting")
      setStore("error", null)
      setStore("previousUrl", server.url)

      try {
        const result = await platform.remoteConnect(opts)

        setStore("session", {
          id: result.session.id,
          target: result.session.target,
          repo: result.session.repo,
          ref: result.session.git_ref,
          port: result.session.port,
          localPort: result.session.local_port,
          startedAt: result.session.started_at,
        })
        setStore("status", "connected")

        server.add(result.url)
      } catch (e) {
        setStore("error", e instanceof Error ? e.message : String(e))
        setStore("status", "error")
      }
    }

    async function disconnect() {
      if (!platform.remoteDisconnect) return

      try {
        await platform.remoteDisconnect()
      } catch (e) {
        console.error("Failed to disconnect:", e)
      }

      const prev = store.previousUrl
      if (prev) {
        server.setActive(prev)
      }

      setStore("session", null)
      setStore("status", "disconnected")
      setStore("error", null)
      setStore("previousUrl", null)
    }

    async function listSessions(target: string, keyPath?: string) {
      if (!platform.remoteListSessions) return []
      try {
        return await platform.remoteListSessions(target, keyPath)
      } catch (e) {
        console.error("Failed to list sessions:", e)
        return []
      }
    }

    async function stopSession(target: string, sessionId: string, keyPath?: string) {
      if (!platform.remoteStopSession) return
      await platform.remoteStopSession(target, sessionId, keyPath)
    }

    return {
      get status() {
        return store.status
      },
      get session() {
        return store.session
      },
      get error() {
        return store.error
      },
      get isRemote() {
        return isRemote()
      },
      get canRemote() {
        return canRemote()
      },
      connect,
      disconnect,
      listSessions,
      stopSession,
    }
  },
})
