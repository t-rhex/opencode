import { createSignal, onMount } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useKV } from "@tui/context/kv"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

interface BrowseResult {
  current: string
  parent: string | null
  directories: string[]
  hasGit: boolean
}

export function DialogRemoteBrowse(props: { host?: string; port?: number }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const kv = useKV()

  const [current, setCurrent] = createSignal<BrowseResult | null>(null)
  const [loading, setLoading] = createSignal(true)

  const hostKey = () => {
    if (!props.host) return undefined
    return `remote_dirs:${props.host}:${props.port ?? 22}`
  }

  const recentDirs = (): string[] => {
    const key = hostKey()
    if (!key) return []
    return kv.get(key, [] as string[])
  }

  const saveRecent = (dir: string) => {
    const key = hostKey()
    if (!key) return
    const dirs = recentDirs().filter((d) => d !== dir)
    dirs.unshift(dir)
    kv.set(key, dirs.slice(0, 5))
    // Also save as the last used directory for this host
    kv.set(`remote_last_dir:${props.host}:${props.port ?? 22}`, dir)
  }

  const browse = async (path?: string) => {
    setLoading(true)
    const url = path ? `${sdk.url}/remote/browse?path=${encodeURIComponent(path)}` : `${sdk.url}/remote/browse`
    const res = await sdk
      .fetch(url)
      .then((r) => r.json())
      .catch(() => null)
    if (res && "current" in res) {
      setCurrent(res as BrowseResult)
    } else if (res && "error" in res) {
      toast.show({ variant: "error", message: (res as { error: string }).error, duration: 5000 })
    }
    setLoading(false)
  }

  const setDirectory = async (dir: string, create?: boolean) => {
    dialog.clear()
    const res = await sdk
      .fetch(`${sdk.url}/remote/set-directory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: dir, create }),
      })
      .then((r) => r.json())
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))

    if ("error" in res) {
      toast.show({ variant: "error", message: (res as { error: string }).error, duration: 5000 })
      return
    }
    const result = res as { directory: string; hasGit: boolean }
    saveRecent(result.directory)
    const git = result.hasGit ? " (git)" : ""
    toast.show({ variant: "success", message: `Working directory: ${result.directory}${git}` })
  }

  onMount(() => browse())

  const options = () => {
    const data = current()
    if (!data) {
      return loading()
        ? [{ value: "loading", title: "Loading...", disabled: true, onSelect: () => {} }]
        : [{ value: "error", title: "Failed to browse", disabled: true, onSelect: () => {} }]
    }

    const items: Array<{
      value: string
      title: string
      description?: string
      category?: string
      disabled?: boolean
      onSelect: () => void
    }> = []

    // Use this directory
    const git = data.hasGit ? " (git repo)" : ""
    items.push({
      value: "use",
      title: `Use this directory`,
      description: `${data.current}${git}`,
      category: "Current",
      onSelect: () => setDirectory(data.current),
    })

    // Parent directory
    if (data.parent) {
      items.push({
        value: "parent",
        title: "..",
        description: data.parent,
        category: "Navigate",
        onSelect: () => browse(data.parent!),
      })
    }

    // Subdirectories
    for (const dir of data.directories) {
      items.push({
        value: `dir:${dir}`,
        title: dir,
        category: "Navigate",
        onSelect: () => browse(`${data.current === "/" ? "" : data.current}/${dir}`),
      })
    }

    // Create directory
    items.push({
      value: "create",
      title: "Create directory...",
      description: "Create a new directory here",
      category: "Actions",
      onSelect: () => {
        dialog.replace(() => (
          <DialogPrompt
            title="Create directory"
            placeholder="directory-name"
            description={() => <text style={{ fg: "#808080" }}>Will be created at: {data.current}/</text>}
            onConfirm={(name) => {
              if (!name.trim()) return dialog.clear()
              const path = `${data.current === "/" ? "" : data.current}/${name.trim()}`
              setDirectory(path, true)
            }}
            onCancel={() => dialog.replace(() => <DialogRemoteBrowse host={props.host} port={props.port} />)}
          />
        ))
      },
    })

    // Type a path
    items.push({
      value: "type",
      title: "Type a path...",
      description: "Enter an absolute path",
      category: "Actions",
      onSelect: () => {
        dialog.replace(() => (
          <DialogPrompt
            title="Go to directory"
            placeholder="/home/user/project"
            value={data.current}
            onConfirm={(path) => {
              if (!path.trim()) return dialog.clear()
              browse(path.trim())
              dialog.replace(() => <DialogRemoteBrowse host={props.host} port={props.port} />)
            }}
            onCancel={() => dialog.replace(() => <DialogRemoteBrowse host={props.host} port={props.port} />)}
          />
        ))
      },
    })

    // Recent directories
    const recent = recentDirs().filter((d) => d !== data.current)
    for (const dir of recent) {
      items.push({
        value: `recent:${dir}`,
        title: dir,
        category: "Recent",
        onSelect: () => setDirectory(dir),
      })
    }

    return items
  }

  return <DialogSelect title={`Browse: ${current()?.current ?? "..."}`} options={options()} skipFilter={false} />
}
