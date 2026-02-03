import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import type { ConnectionState } from "@/fs"
import type { RemoteStateSource } from "./sdk"

export const { use: useRemote, provider: RemoteProvider } = createSimpleContext({
  name: "Remote",
  init: (props: { source?: RemoteStateSource }) => {
    const [state, setState] = createSignal<ConnectionState | undefined>(undefined)

    onMount(() => {
      if (!props.source) return
      const unsub = props.source.on((newState) => {
        setState(newState)
      })
      onCleanup(unsub)
    })

    return {
      get state() {
        return state()
      },
    }
  },
})
