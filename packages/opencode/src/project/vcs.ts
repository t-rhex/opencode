import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { CurrentFilesystem } from "@/fs"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    Updated: BusEvent.define(
      "vcs.updated",
      z.object({
        branch: z.string().optional(),
        staged: z.number(),
        unstaged: z.number(),
      }),
    ),
    // Keep for backwards compatibility
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string().optional(),
      staged: z.number(),
      unstaged: z.number(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  async function currentBranch(): Promise<string | undefined> {
    const result = await Instance.fs.exec("git rev-parse --abbrev-ref HEAD", {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return undefined
    return result.stdout.trim() || undefined
  }

  async function fileStatus(): Promise<{ staged: number; unstaged: number }> {
    const result = await Instance.fs.exec("git status --porcelain", {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return { staged: 0, unstaged: 0 }

    let staged = 0
    let unstaged = 0

    for (const line of result.stdout.split("\n")) {
      if (!line || line.length < 2) continue
      const index = line[0]
      const worktree = line[1]

      // Staged changes (index has modification)
      if (index !== " " && index !== "?") staged++
      // Unstaged changes (worktree has modification, excluding untracked)
      if (worktree !== " " && worktree !== "?") unstaged++
    }

    return { staged, unstaged }
  }

  export async function info(): Promise<Info> {
    const [branch, status] = await Promise.all([currentBranch(), fileStatus()])
    return { branch, ...status }
  }

  const state = Instance.state(
    async () => {
      const isRemote = CurrentFilesystem.isRemote()
      let current = await info()
      log.info("initialized", current)

      let pollInterval: ReturnType<typeof setInterval> | undefined
      let unsubscribe: (() => void) | undefined

      if (isRemote) {
        // Remote mode: poll every 30s
        pollInterval = setInterval(async () => {
          const next = await info()
          if (next.branch !== current.branch || next.staged !== current.staged || next.unstaged !== current.unstaged) {
            log.info("status changed", { from: current, to: next })
            current = next
            Bus.publish(Event.Updated, next)
            Bus.publish(Event.BranchUpdated, { branch: next.branch })
          }
        }, 30000)
      } else {
        // Local mode: watch for file changes
        unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
          if (!evt.properties.file.includes(".git")) return
          const next = await info()
          if (next.branch !== current.branch || next.staged !== current.staged || next.unstaged !== current.unstaged) {
            log.info("status changed", { from: current, to: next })
            current = next
            Bus.publish(Event.Updated, next)
            Bus.publish(Event.BranchUpdated, { branch: next.branch })
          }
        })
      }

      return {
        info: async () => current,
        branch: async () => current.branch,
        cleanup: () => {
          if (pollInterval) clearInterval(pollInterval)
          unsubscribe?.()
        },
      }
    },
    async (state) => {
      state.cleanup()
    },
  )

  export async function init() {
    return state()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function get(): Promise<Info> {
    return await state().then((s) => s.info())
  }
}
