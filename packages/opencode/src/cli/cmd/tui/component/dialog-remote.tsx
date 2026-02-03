import { createMemo, createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useRemote } from "@tui/context/remote"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"

export function DialogRemote() {
  const sdk = useSDK()
  const remote = useRemote()
  const dialog = useDialog()
  const route = useRoute()
  const toast = useToast()
  const client = sdk.client as any

  const [profiles, setProfiles] = createSignal<
    Array<{
      name: string
      host: string
      username?: string
      port?: number
      remoteDir?: string
    }>
  >([])

  onMount(async () => {
    const result = await client.remote.profiles()
    if (result.data) setProfiles(result.data)
  })

  const home = () => {
    route.navigate({ type: "home" })
    dialog.clear()
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
          await client.remote.disconnect()
          toast.show({
            variant: "success",
            message: "Disconnected",
          })
          home()
        },
      })
    }

    const label = connected ? "Switch to" : "Connect to"
    const category = "Profile"

    for (const p of profiles()) {
      if (connected && p.host === state!.host) continue
      items.push({
        value: p.name,
        title: `${label} "${p.name}"`,
        description: p.username ? `${p.username}@${p.host}` : p.host,
        category,
        onSelect: async () => {
          await client.remote.connect({ target: p.name })
          toast.show({
            variant: "success",
            message: `Connected to ${p.host}`,
          })
          home()
        },
      })
    }

    return items
  })

  return <DialogSelect title="Remote server" options={options()} skipFilter={false} />
}
