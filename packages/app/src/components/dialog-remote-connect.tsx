import { createMemo, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useRemote } from "@/context/remote"
import { useConnections } from "@/context/connections"
import { usePlatform } from "@/context/platform"
import { RemoteFolderBrowser } from "./remote-folder-browser"
import { base64Encode } from "@opencode-ai/util/encode"

type Step = "connections" | "method" | "browse" | "clone" | "connecting"

export function DialogRemoteConnect() {
  const dialog = useDialog()
  const remote = useRemote()
  const connections = useConnections()
  const platform = usePlatform()
  const language = useLanguage()
  const navigate = useNavigate()

  const [store, setStore] = createStore({
    step: "connections" as Step,
    target: "",
    port: "",
    keyPath: "",
    connectionName: "",
    saveConnection: false,
    selectedConnectionId: null as string | null,
    repo: "",
    ref: "main",
    error: null as string | null,
  })

  const targetValid = createMemo(() => {
    const t = store.target.trim()
    return t.includes("@") && t.split("@")[1].length > 0
  })

  const repoValid = createMemo(() => {
    const r = store.repo.trim()
    return r.startsWith("http") || r.startsWith("git@")
  })

  function getFullTarget() {
    const t = store.target.trim()
    const p = store.port.trim()
    if (p && p !== "22") {
      return `${t}:${p}`
    }
    return t
  }

  function selectConnection(id: string) {
    const conn = connections.get(id)
    if (!conn) return

    setStore({
      selectedConnectionId: id,
      target: conn.target,
      port: conn.port?.toString() || "",
      keyPath: conn.keyPath || "",
      connectionName: conn.name,
    })
    setStore("step", "method")
  }

  function startNewConnection() {
    setStore({
      selectedConnectionId: null,
      target: "",
      port: "",
      keyPath: "",
      connectionName: "",
      saveConnection: true,
    })
  }

  function proceedToMethod() {
    if (!targetValid()) return

    if (store.saveConnection && !store.selectedConnectionId) {
      const conn = connections.add({
        target: store.target.trim(),
        port: store.port ? parseInt(store.port) : undefined,
        keyPath: store.keyPath.trim() || undefined,
        name: store.connectionName.trim() || undefined,
      })
      setStore("selectedConnectionId", conn.id)
    }

    setStore("step", "method")
  }

  function deleteConnection(id: string, e: Event) {
    e.stopPropagation()
    connections.remove(id)
  }

  async function connectWithDirectory(path: string) {
    console.log("[DialogRemoteConnect] connectWithDirectory called with path:", path)
    setStore("step", "connecting")
    setStore("error", null)

    try {
      if (store.selectedConnectionId) {
        connections.updateLastDirectory(store.selectedConnectionId, path)
      }

      console.log("[DialogRemoteConnect] Calling remote.connectDirectory with:", {
        target: getFullTarget(),
        path,
        keyPath: store.keyPath.trim() || undefined,
      })

      const result = await remote.connectDirectory({
        target: getFullTarget(),
        path,
        keyPath: store.keyPath.trim() || undefined,
      })
      console.log("[DialogRemoteConnect] Connection successful")
      dialog.close()

      // GlobalSDKProvider is keyed by server.url - wait for re-render before navigation
      await new Promise((resolve) => setTimeout(resolve, 200))

      console.log("[DialogRemoteConnect] Navigating to:", path)
      navigate(`/${base64Encode(path)}/session`)
    } catch (e) {
      console.error("[DialogRemoteConnect] Connection failed:", e)
      setStore("error", e instanceof Error ? e.message : String(e))
      setStore("step", "browse")
    }
  }

  async function connectWithClone() {
    if (!repoValid()) return

    setStore("step", "connecting")
    setStore("error", null)

    try {
      await remote.connect({
        target: getFullTarget(),
        repo: store.repo.trim(),
        ref: store.ref.trim() || "main",
        keyPath: store.keyPath.trim() || undefined,
      })
      dialog.close()
    } catch (e) {
      setStore("error", e instanceof Error ? e.message : String(e))
      setStore("step", "clone")
    }
  }

  function goBack() {
    switch (store.step) {
      case "method":
        setStore("step", "connections")
        break
      case "browse":
      case "clone":
        setStore("step", "method")
        break
    }
  }

  const savedConnections = createMemo(() => connections.connections)

  return (
    <Dialog title={language.t("remote.connect.title")}>
      <div class="flex flex-col gap-4 p-5 min-w-[400px]">
        <Switch>
          <Match when={store.step === "connections"}>
            <div class="flex flex-col gap-3">
              <p class="text-text-weak text-14-regular">{language.t("remote.connect.description")}</p>

              <Show when={savedConnections().length > 0}>
                <div class="flex flex-col gap-1">
                  <label class="text-12-medium text-text-weak">{language.t("remote.connections.title")}</label>
                  <div class="border border-border rounded max-h-48 overflow-y-auto">
                    <For each={savedConnections()}>
                      {(conn) => (
                        <div
                          class="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-hover text-left group cursor-pointer"
                          onClick={() => selectConnection(conn.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && selectConnection(conn.id)}
                        >
                          <div class="flex flex-col">
                            <span class="text-14-regular">{conn.name}</span>
                            <span class="text-12-regular text-text-weak">{conn.target}</span>
                            <Show when={conn.lastDirectory}>
                              <span class="text-11-regular text-text-weaker">
                                {language.t("remote.connections.lastDir", { path: conn.lastDirectory! })}
                              </span>
                            </Show>
                          </div>
                          <button
                            class="p-1 opacity-0 group-hover:opacity-100 hover:bg-surface-hover rounded"
                            onClick={(e) => deleteConnection(conn.id, e)}
                          >
                            <Icon name="trash" class="w-4 h-4 text-text-weak" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <div class="border-t border-border pt-3">
                <label class="text-12-medium text-text-weak mb-2 block">
                  {language.t("remote.connect.newConnection")}
                </label>
                <div class="flex flex-col gap-2">
                  <TextField
                    label={language.t("remote.connect.target.label")}
                    placeholder={language.t("remote.connect.target.placeholder")}
                    value={store.target}
                    onChange={(v) => setStore("target", v)}
                    onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && proceedToMethod()}
                    autofocus={savedConnections().length === 0}
                  />
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <TextField
                        label={language.t("remote.connect.key.label")}
                        placeholder={language.t("remote.connect.key.placeholder")}
                        value={store.keyPath}
                        onChange={(v) => setStore("keyPath", v)}
                      />
                    </div>
                    <div class="w-24">
                      <TextField
                        label={language.t("remote.connections.port.label")}
                        placeholder={language.t("remote.connections.port.placeholder")}
                        value={store.port}
                        onChange={(v) => setStore("port", v)}
                      />
                    </div>
                  </div>
                  <TextField
                    label={language.t("remote.connections.name.label")}
                    placeholder={language.t("remote.connections.name.placeholder")}
                    value={store.connectionName}
                    onChange={(v) => setStore("connectionName", v)}
                  />
                  <Checkbox checked={store.saveConnection} onChange={(v) => setStore("saveConnection", v)}>
                    {language.t("remote.connect.saveConnection")}
                  </Checkbox>
                </div>
              </div>

              <div class="flex justify-end pt-2">
                <Button onClick={proceedToMethod} disabled={!targetValid()}>
                  Next
                </Button>
              </div>
            </div>
          </Match>

          <Match when={store.step === "method"}>
            <div class="flex flex-col gap-3">
              <p class="text-text-weak text-14-regular">{language.t("remote.connect.chooseMethod")}</p>
              <p class="text-12-regular text-text-weaker">Connecting to: {getFullTarget()}</p>

              <div class="flex flex-col gap-2">
                <button
                  class="flex items-start gap-3 p-4 border border-border rounded hover:bg-surface-hover text-left"
                  onClick={() => setStore("step", "browse")}
                >
                  <Icon name="folder" class="w-5 h-5 text-text-weak mt-0.5" />
                  <div>
                    <div class="text-14-medium">{language.t("remote.connect.method.browse")}</div>
                    <div class="text-12-regular text-text-weak">{language.t("remote.connect.method.browseDesc")}</div>
                  </div>
                </button>

                <button
                  class="flex items-start gap-3 p-4 border border-border rounded hover:bg-surface-hover text-left"
                  onClick={() => setStore("step", "clone")}
                >
                  <Icon name="branch" class="w-5 h-5 text-text-weak mt-0.5" />
                  <div>
                    <div class="text-14-medium">{language.t("remote.connect.method.clone")}</div>
                    <div class="text-12-regular text-text-weak">{language.t("remote.connect.method.cloneDesc")}</div>
                  </div>
                </button>
              </div>

              <div class="flex justify-start pt-2">
                <Button variant="secondary" onClick={goBack}>
                  Back
                </Button>
              </div>
            </div>
          </Match>

          <Match when={store.step === "browse"}>
            <div class="flex flex-col gap-3">
              <p class="text-text-weak text-14-regular">{language.t("remote.browse.title")}</p>

              <Show when={store.error}>
                <div class="text-text-critical text-14-regular p-3 bg-surface-critical-weak rounded">{store.error}</div>
              </Show>

              <RemoteFolderBrowser
                target={getFullTarget()}
                keyPath={store.keyPath.trim() || undefined}
                initialPath={
                  store.selectedConnectionId ? connections.get(store.selectedConnectionId)?.lastDirectory : undefined
                }
                onSelect={connectWithDirectory}
                onCancel={() => setStore("step", "clone")}
              />

              <div class="flex justify-start">
                <Button variant="secondary" onClick={goBack}>
                  Back
                </Button>
              </div>
            </div>
          </Match>

          <Match when={store.step === "clone"}>
            <div class="flex flex-col gap-3">
              <TextField
                label={language.t("remote.connect.repo.label")}
                placeholder={language.t("remote.connect.repo.placeholder")}
                value={store.repo}
                onChange={(v) => setStore("repo", v)}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && connectWithClone()}
                autofocus
              />
              <TextField
                label={language.t("remote.connect.ref.label")}
                placeholder={language.t("remote.connect.ref.placeholder")}
                value={store.ref}
                onChange={(v) => setStore("ref", v)}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && connectWithClone()}
              />

              <Show when={store.error}>
                <div class="text-text-critical text-14-regular p-3 bg-surface-critical-weak rounded">{store.error}</div>
              </Show>

              <div class="flex justify-between gap-3 pt-2">
                <Button variant="secondary" onClick={goBack}>
                  Back
                </Button>
                <Button onClick={connectWithClone} disabled={!repoValid()}>
                  {language.t("remote.connect.button")}
                </Button>
              </div>
            </div>
          </Match>

          <Match when={store.step === "connecting"}>
            <div class="flex flex-col items-center justify-center gap-4 py-8">
              <Spinner />
              <p class="text-text-weak text-14-regular">{language.t("remote.connect.status.tunneling")}</p>
              <p class="text-text-weaker text-12-regular">This may take 30-60 seconds...</p>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
