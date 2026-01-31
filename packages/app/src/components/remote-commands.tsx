import { onMount, onCleanup } from "solid-js"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { DialogRemoteConnect } from "./dialog-remote-connect"
import { DialogRemoteSessions } from "./dialog-remote-sessions"

export function RemoteCommands() {
  const command = useCommand()
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()

  const canRemote = () => platform.platform === "desktop"

  command.register(() => {
    if (!canRemote()) return []

    return [
      {
        id: "remote.connect",
        title: language.t("remote.menu.connect"),
        category: "Remote",
        onSelect: () => dialog.show(() => <DialogRemoteConnect />),
      },
      {
        id: "remote.sessions",
        title: language.t("remote.menu.sessions"),
        category: "Remote",
        onSelect: () => dialog.show(() => <DialogRemoteSessions />),
      },
    ]
  })

  onMount(() => {
    const handleConnect = () => dialog.show(() => <DialogRemoteConnect />)
    const handleSessions = () => dialog.show(() => <DialogRemoteSessions />)

    window.addEventListener("opencode:remote-connect", handleConnect)
    window.addEventListener("opencode:remote-sessions", handleSessions)

    onCleanup(() => {
      window.removeEventListener("opencode:remote-connect", handleConnect)
      window.removeEventListener("opencode:remote-sessions", handleSessions)
    })
  })

  return null
}
