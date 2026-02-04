import { createMemo, createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useRemote } from "@tui/context/remote"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { useKV } from "@tui/context/kv"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

interface Profile {
  name: string
  host: string
  username?: string
  port?: number
  remoteDir?: string
}

interface SSHHost {
  name: string
  hostname?: string
  user?: string
  port?: number
}

export function DialogRemote() {
  const sdk = useSDK()
  const remote = useRemote()
  const dialog = useDialog()
  const route = useRoute()
  const toast = useToast()
  const kv = useKV()

  const [profiles, setProfiles] = createSignal<Profile[]>([])
  const [sshHosts, setSSHHosts] = createSignal<SSHHost[]>([])
  const [forwards, setForwards] = createSignal<number[]>([])

  const api = async (path: string, method = "GET", body?: unknown) => {
    const res = await sdk.fetch(`${sdk.url}/remote${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return res.json()
  }

  onMount(async () => {
    const [profileData, sshData, forwardData] = await Promise.all([
      api("/profiles"),
      api("/ssh-hosts"),
      api("/forwards"),
    ])
    if (Array.isArray(profileData)) setProfiles(profileData)
    if (Array.isArray(sshData)) setSSHHosts(sshData)
    if (Array.isArray(forwardData)) setForwards(forwardData)
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
      kv.set("remote_last_target", target)
      const dir = result.remoteDir as string | undefined
      // Try to restore remembered directory for this host
      const savedDir = kv.get(`remote_last_dir:${result.host}:${result.port ?? 22}`)
      if (savedDir && savedDir !== dir) {
        const restored = await api("/set-directory", "POST", { directory: savedDir }).catch(() => null)
        if (restored && "directory" in restored) {
          toast.show({ variant: "success", message: `Connected to ${result.host} (${restored.directory})` })
          home()
          return
        }
      }
      toast.show({ variant: "success", message: `Connected to ${result.host} (${dir ?? "~"})` })
      toast.show({ variant: "info", message: "Type /dir to change working directory", duration: 5000 })
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
          kv.set("remote_last_target", undefined)
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

    for (const h of sshHosts()) {
      const host = h.hostname ?? h.name
      if (connected && host === state!.host) continue
      const desc = h.user ? `${h.user}@${host}` : host
      items.push({
        value: `ssh-${h.name}`,
        title: `${label} "${h.name}"`,
        description: h.hostname ? `${desc} (ssh config)` : "ssh config",
        category: "SSH Config",
        onSelect: () => connect(h.name),
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

    // Port forwarding options (only when connected)
    if (connected) {
      items.push({
        value: "forward",
        title: "Forward port...",
        description: "local:remote (e.g. 3000 or 3000:8080)",
        category: "Port Forwarding",
        onSelect: () => {
          dialog.replace(() => (
            <DialogPrompt
              title="Forward port"
              placeholder="3000 or 3000:8080"
              onConfirm={async (value) => {
                const trimmed = value.trim()
                if (!trimmed) return dialog.clear()
                const parts = trimmed.split(":")
                const local = parseInt(parts[0], 10)
                const remote = parts.length > 1 ? parseInt(parts[1], 10) : local
                if (isNaN(local) || isNaN(remote)) {
                  toast.show({ variant: "error", message: "Invalid port format" })
                  dialog.clear()
                  return
                }
                dialog.clear()
                const result = await api("/forward", "POST", { localPort: local, remotePort: remote }).catch(
                  (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
                )
                if ("error" in result) {
                  toast.show({ variant: "error", message: result.error, duration: 5000 })
                  return
                }
                setForwards((prev) => [...prev, local])
                toast.show({ variant: "success", message: `Forwarding localhost:${local} -> remote:${remote}` })
              }}
              onCancel={() => dialog.clear()}
            />
          ))
        },
      })

      for (const port of forwards()) {
        items.push({
          value: `stop-${port}`,
          title: `Stop forward :${port}`,
          description: `Close tunnel on port ${port}`,
          category: "Port Forwarding",
          onSelect: async () => {
            dialog.clear()
            await api("/forward/stop", "POST", { localPort: port }).catch(() => {})
            setForwards((prev) => prev.filter((p) => p !== port))
            toast.show({ variant: "success", message: `Stopped forward on port ${port}` })
          },
        })
      }
    }

    return items
  })

  return <DialogSelect title="Remote server" options={options()} skipFilter={false} />
}
