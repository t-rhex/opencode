import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted, Persist } from "@/utils/persist"
import type { SavedConnection } from "@/context/platform"

type ConnectionsStore = {
  connections: SavedConnection[]
}

export const { use: useConnections, provider: ConnectionsProvider } = createSimpleContext({
  name: "Connections",
  init: () => {
    const [store, setStore] = persisted(
      Persist.global("remote-connections"),
      createStore<ConnectionsStore>({ connections: [] }),
    )

    function generateId() {
      return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    function generateName(target: string) {
      return target
    }

    function add(connection: Omit<SavedConnection, "id" | "name"> & { id?: string; name?: string }) {
      const id = connection.id || generateId()
      const name = connection.name?.trim() || generateName(connection.target)
      const newConnection: SavedConnection = {
        id,
        name,
        target: connection.target,
        port: connection.port,
        keyPath: connection.keyPath,
        lastDirectory: connection.lastDirectory,
      }
      setStore("connections", (prev) => [...prev, newConnection])
      return newConnection
    }

    function update(id: string, updates: Partial<Omit<SavedConnection, "id">>) {
      setStore("connections", (conn) => conn.id === id, updates)
    }

    function remove(id: string) {
      setStore("connections", (prev) => prev.filter((c) => c.id !== id))
    }

    function get(id: string) {
      return store.connections.find((c) => c.id === id)
    }

    function updateLastDirectory(id: string, path: string) {
      update(id, { lastDirectory: path })
    }

    return {
      get connections() {
        return store.connections
      },
      add,
      update,
      remove,
      get,
      updateLastDirectory,
    }
  },
})
