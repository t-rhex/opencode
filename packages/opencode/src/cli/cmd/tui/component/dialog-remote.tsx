import { createMemo, createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useRemote } from "@tui/context/remote"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

interface Profile {
  name: string
  host: string
  username?: string
  port?: number
  remoteDir?: string
}

export function DialogRemote() {
  const sdk = useSDK()
  const remote = useRemote()
  const dialog = useDialog()
  const route = useRoute()
  const toast = useToast()

  const [profiles, setProfiles] = createSignal<Profile[]>([])

  const api = async (path: string, method = "GET", body?: unknown) => {
    const res = await sdk.fetch(`${sdk.url}/remote${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return res.json()
  }

  onMount(async () => {
    const data = await api("/profiles")
    if (Array.isArray(data)) setProfiles(data)
  })

  const home = () => {
    route.navigate({ type: "home" })
    dialog.clear()
  }

  const connect = async (target: string) => {
    dialog.clear()
    toast.show({ variant: "info", message: `Connecting to ${target}...` })
    const result = await api("/connect", "POST", { target }).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    }))
    if ("connected" in result && result.connected) {
      toast.show({ variant: "success", message: `Connected to ${result.host}` })
      home()
      return
    }
    toast.show({ variant: "error", message: result.error ?? "Connection failed", duration: 10000 })
  }

  const options = createMemo(() => {
    const state = remote.state
    const connected = state?.status === "connected"
    const items: Array<{
      value: string
      title: string
      description?: string
      category?: string
      onSelect: () => void
    }> = []

    if (connected) {
      items.push({
        value: "disconnect",
        title: `Disconnect from ${state!.host}`,
        category: "Connection",
        onSelect: async () => {
          await api("/disconnect", "POST")
          toast.show({ variant: "success", message: "Disconnected" })
          home()
        },
      })
    }

    const label = connected ? "Switch to" : "Connect to"

    for (const p of profiles()) {
      if (connected && p.host === state!.host) continue
      items.push({
        value: p.name,
        title: `${label} "${p.name}"`,
        description: p.username ? `${p.username}@${p.host}` : p.host,
        category: "Profile",
        onSelect: () => connect(p.name),
      })
    }

    items.push({
      value: "add",
      title: "Add server...",
      description: "user@host or profile name",
      category: "New",
      onSelect: () => {
        dialog.replace(() => (
          <DialogPrompt
            title="Connect to remote server"
            placeholder="user@host"
            onConfirm={(value) => {
              if (!value.trim()) return dialog.clear()
              connect(value.trim())
            }}
            onCancel={() => dialog.clear()}
          />
        ))
      },
    })

    return items
  })

  return <DialogSelect title="Remote server" options={options()} skipFilter={false} />
}
