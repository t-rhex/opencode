import { createSignal, createEffect, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform, type DirectoryEntry } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"

type Props = {
  target: string
  keyPath?: string
  initialPath?: string
  onSelect: (path: string) => void
  onCancel?: () => void
}

export function RemoteFolderBrowser(props: Props) {
  const platform = usePlatform()
  const language = useLanguage()

  const [store, setStore] = createStore({
    path: props.initialPath || "~",
    entries: [] as DirectoryEntry[],
    loading: true,
    error: null as string | null,
    showNewFolder: false,
    newFolderName: "",
    creating: false,
  })

  async function browse(path: string) {
    if (!platform.remoteBrowseDirectory) return

    setStore({ loading: true, error: null })

    try {
      const result = await platform.remoteBrowseDirectory(props.target, path, props.keyPath)
      console.log("[RemoteFolderBrowser] Browse result:", JSON.stringify(result, null, 2))
      setStore({
        path: result.path,
        entries: result.entries,
        loading: false,
      })
    } catch (e) {
      setStore({
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      })
    }
  }

  createEffect(() => {
    browse(props.initialPath || "~")
  })

  function navigateUp() {
    const parts = store.path.split("/").filter(Boolean)
    if (parts.length <= 1) {
      browse("/")
    } else {
      parts.pop()
      browse("/" + parts.join("/"))
    }
  }

  function navigateTo(entry: DirectoryEntry) {
    console.log("[RemoteFolderBrowser] navigateTo:", entry.name, "isDir:", entry.isDir)
    if (entry.isDir) {
      browse(entry.path)
    }
  }

  async function createFolder() {
    if (!store.newFolderName.trim() || !platform.remoteCreateDirectory) return

    setStore("creating", true)
    try {
      const newPath =
        store.path === "/" ? "/" + store.newFolderName.trim() : store.path + "/" + store.newFolderName.trim()

      await platform.remoteCreateDirectory(props.target, newPath, props.keyPath)
      setStore({ showNewFolder: false, newFolderName: "", creating: false })
      browse(store.path) // Refresh
    } catch (e) {
      setStore({
        error: e instanceof Error ? e.message : String(e),
        creating: false,
      })
    }
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-14-regular text-text-weak">
          <Icon name="folder" class="w-4 h-4" />
          <span class="font-medium">{store.path}</span>
        </div>
        <Button variant="secondary" size="small" onClick={() => setStore("showNewFolder", !store.showNewFolder)}>
          <Icon name="plus" class="w-4 h-4" />
          New Folder
        </Button>
      </div>

      <Show when={store.showNewFolder}>
        <div class="flex gap-2 p-3 bg-surface-secondary rounded">
          <TextField
            placeholder="Folder name"
            value={store.newFolderName}
            onChange={(v) => setStore("newFolderName", v)}
            onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && createFolder()}
            autofocus
            class="flex-1"
          />
          <Button onClick={createFolder} disabled={!store.newFolderName.trim() || store.creating}>
            {store.creating ? "Creating..." : "Create"}
          </Button>
          <Button variant="secondary" onClick={() => setStore({ showNewFolder: false, newFolderName: "" })}>
            Cancel
          </Button>
        </div>
      </Show>

      <Show when={store.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner />
          <span class="ml-2 text-text-weak">{language.t("remote.browse.loading")}</span>
        </div>
      </Show>

      <Show when={store.error}>
        <div class="text-text-critical text-14-regular p-3 bg-surface-critical-weak rounded">{store.error}</div>
      </Show>

      <Show when={!store.loading && !store.error}>
        <div class="border border-border rounded max-h-64 overflow-y-auto">
          <Show when={store.path !== "/" && store.path !== "~"}>
            <button
              class="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover text-left border-b border-border"
              onClick={navigateUp}
            >
              <Icon name="arrow-left" class="w-4 h-4 text-text-weak" />
              <span class="text-14-regular">..</span>
            </button>
          </Show>

          <Show
            when={store.entries.length > 0}
            fallback={
              <div class="px-3 py-4 text-center text-text-weak text-14-regular">
                {language.t("remote.browse.empty")}
              </div>
            }
          >
            <For each={store.entries}>
              {(entry) => (
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover text-left"
                  classList={{ "opacity-50": !entry.isDir }}
                  onClick={() => navigateTo(entry)}
                  disabled={!entry.isDir}
                >
                  <Icon name="folder" class="w-4 h-4 text-text-weak" />
                  <span class="text-14-regular truncate">{entry.name}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <div class="flex justify-between gap-3 pt-2 border-t border-border">
        <Show when={props.onCancel}>
          <Button variant="secondary" onClick={props.onCancel}>
            Clone Instead
          </Button>
        </Show>
        <div class="flex-1" />
        <Button
          onClick={() => {
            console.log("[RemoteFolderBrowser] Select clicked, path:", store.path)
            props.onSelect(store.path)
          }}
          disabled={store.loading}
        >
          Use This Directory
        </Button>
      </div>
    </div>
  )
}
