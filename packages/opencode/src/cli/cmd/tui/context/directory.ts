import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory
    if (!directory) return ""
    const home = sync.data.path.remote ? sync.data.path.home : Global.Path.home
    const result = directory.replace(home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
