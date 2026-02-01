import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { type IFilesystem, CurrentFilesystem } from "@/fs"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
  fs: IFilesystem
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

export const Instance = {
  async provide<R>(input: { directory: string; fs?: IFilesystem; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    let existing = cache.get(input.directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory: input.directory })
      existing = iife(async () => {
        const isRemote = CurrentFilesystem.isRemote()

        let project: Project.Info
        let worktree: string

        if (isRemote) {
          worktree = input.directory
          project = {
            id: "remote",
            worktree: input.directory,
            sandboxes: [],
            time: { created: Date.now(), updated: Date.now() },
          }
        } else {
          const result = await Project.fromDirectory(input.directory)
          project = result.project
          worktree = result.sandbox
        }

        const ctx: Context = {
          directory: input.directory,
          worktree,
          project,
          fs: input.fs ?? CurrentFilesystem.get(),
        }
        await context.provide(ctx, async () => {
          await input.init?.()
        })
        return ctx
      })
      cache.set(input.directory, existing)
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    if (CurrentFilesystem.isRemote()) {
      const remoteDir = CurrentFilesystem.getRemoteDirectory()
      if (remoteDir) return remoteDir
    }
    return context.use().directory
  },
  get worktree() {
    const isRemote = CurrentFilesystem.isRemote()
    const remoteDir = CurrentFilesystem.getRemoteDirectory()
    if (isRemote && remoteDir) {
      return remoteDir
    }
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  get fs(): IFilesystem {
    return CurrentFilesystem.get()
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  clearCache() {
    cache.clear()
    Log.Default.info("instance cache cleared")
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
