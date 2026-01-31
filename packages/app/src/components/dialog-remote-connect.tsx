import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useRemote } from "@/context/remote"

export function DialogRemoteConnect() {
  const dialog = useDialog()
  const remote = useRemote()
  const language = useLanguage()

  const [store, setStore] = createStore({
    step: 0,
    target: "",
    repo: "",
    ref: "main",
    keyPath: "",
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

  async function handleConnect() {
    setStore("step", 2)
    setStore("error", null)

    try {
      await remote.connect({
        target: store.target.trim(),
        repo: store.repo.trim(),
        ref: store.ref.trim() || "main",
        keyPath: store.keyPath.trim() || undefined,
      })
      dialog.close()
    } catch (e) {
      setStore("error", e instanceof Error ? e.message : String(e))
      setStore("step", 1)
    }
  }

  function nextStep() {
    if (store.step === 0 && targetValid()) {
      setStore("step", 1)
    } else if (store.step === 1 && repoValid()) {
      handleConnect()
    }
  }

  function prevStep() {
    if (store.step > 0 && store.step < 2) {
      setStore("step", store.step - 1)
    }
  }

  return (
    <Dialog title={language.t("remote.connect.title")}>
      <div class="flex flex-col gap-4 p-5">
        <Switch>
          <Match when={store.step === 0}>
            <div class="flex flex-col gap-3">
              <p class="text-text-weak text-14-regular">{language.t("remote.connect.description")}</p>
              <TextField
                label={language.t("remote.connect.target.label")}
                placeholder={language.t("remote.connect.target.placeholder")}
                value={store.target}
                onChange={(v) => setStore("target", v)}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && nextStep()}
                autofocus
              />
              <TextField
                label={language.t("remote.connect.key.label")}
                placeholder={language.t("remote.connect.key.placeholder")}
                value={store.keyPath}
                onChange={(v) => setStore("keyPath", v)}
              />
            </div>
          </Match>

          <Match when={store.step === 1}>
            <div class="flex flex-col gap-3">
              <TextField
                label={language.t("remote.connect.repo.label")}
                placeholder={language.t("remote.connect.repo.placeholder")}
                value={store.repo}
                onChange={(v) => setStore("repo", v)}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && nextStep()}
                autofocus
              />
              <TextField
                label={language.t("remote.connect.ref.label")}
                placeholder={language.t("remote.connect.ref.placeholder")}
                value={store.ref}
                onChange={(v) => setStore("ref", v)}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && nextStep()}
              />
              <Show when={store.error}>
                <div class="text-text-critical text-14-regular p-3 bg-surface-critical-weak rounded">{store.error}</div>
              </Show>
            </div>
          </Match>

          <Match when={store.step === 2}>
            <div class="flex flex-col items-center justify-center gap-4 py-8">
              <Spinner />
              <p class="text-text-weak text-14-regular">{language.t("remote.connect.status.tunneling")}</p>
            </div>
          </Match>
        </Switch>

        <Show when={store.step < 2}>
          <div class="flex justify-between gap-3 pt-2">
            <Show when={store.step > 0}>
              <Button variant="secondary" onClick={prevStep}>
                Back
              </Button>
            </Show>
            <div class="flex-1" />
            <Button onClick={nextStep} disabled={store.step === 0 ? !targetValid() : !repoValid()}>
              {store.step === 1 ? language.t("remote.connect.button") : "Next"}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
