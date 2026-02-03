import crypto from "crypto"
import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import { CurrentFilesystem } from "../fs"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"

  function isDisabled() {
    return false
  }

  function gitdir() {
    if (CurrentFilesystem.isRemote()) {
      const remoteDir = CurrentFilesystem.getRemoteDirectory() ?? Instance.directory
      const id = crypto.createHash("sha256").update(remoteDir).digest("hex").slice(0, 12)
      return `~/.local/share/opencode/snapshot/${id}`
    }
    return path.join(Global.Path.data, "snapshot", Instance.project.id)
  }

  async function git(args: string): Promise<{ stdout: string; exitCode: number }> {
    const dir = gitdir()
    const worktree = Instance.worktree
    const cmd = `git --git-dir "${dir}" --work-tree "${worktree}" ${args}`
    const result = await Instance.fs.exec(cmd, { cwd: Instance.directory })
    return { stdout: result.stdout, exitCode: result.exitCode }
  }

  async function ensureInitialized() {
    const dir = gitdir()
    const exists = await Instance.fs.exists(dir)
    if (!exists) {
      await Instance.fs.mkdir(dir, true)
      await git("init")
      await git("config core.autocrlf false")
    }
  }

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (isDisabled()) return
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const dir = gitdir()
    const exists = await Instance.fs.exists(dir)
    if (!exists) return
    const result = await git(`gc --prune=${prune}`)
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stdout: result.stdout,
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (isDisabled()) return
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    await ensureInitialized()
    await git("add .")
    const result = await git("write-tree")
    const hash = result.stdout.trim()
    log.info("tracking", { hash, cwd: Instance.directory, git: gitdir() })
    return hash
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    if (isDisabled()) return { hash, files: [] }
    await git("add .")
    const result = await git(
      `-c core.autocrlf=false -c core.quotepath=false diff --no-ext-diff --name-only ${hash} -- .`,
    )

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    return {
      hash,
      files: result.stdout
        .trim()
        .split("\n")
        .map((x: string) => x.trim())
        .filter(Boolean)
        .map((x: string) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    if (isDisabled()) return
    log.info("restore", { commit: snapshot })
    const readTree = await git(`read-tree ${snapshot}`)
    if (readTree.exitCode !== 0) {
      log.error("failed to restore snapshot (read-tree)", {
        snapshot,
        exitCode: readTree.exitCode,
        stdout: readTree.stdout,
      })
      return
    }
    const checkout = await git("checkout-index -a -f")
    if (checkout.exitCode !== 0) {
      log.error("failed to restore snapshot (checkout-index)", {
        snapshot,
        exitCode: checkout.exitCode,
        stdout: checkout.stdout,
      })
    }
  }

  export async function revert(patches: Patch[]) {
    if (isDisabled()) return
    const seen = new Set<string>()
    for (const item of patches) {
      for (const file of item.files) {
        if (seen.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await git(`checkout ${item.hash} -- "${file}"`)
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree = await git(`ls-tree ${item.hash} -- "${relativePath}"`)
          if (checkTree.exitCode === 0 && checkTree.stdout.trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await Instance.fs.unlink(file).catch(() => {})
          }
        }
        seen.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    if (isDisabled()) return ""
    await git("add .")
    const result = await git(`-c core.autocrlf=false -c core.quotepath=false diff --no-ext-diff ${hash} -- .`)

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stdout: result.stdout,
      })
      return ""
    }

    return result.stdout.trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    if (isDisabled()) return []
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    // Get file statuses (added/deleted/modified)
    const statusResult = await git(
      `-c core.autocrlf=false -c core.quotepath=false diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`,
    )
    if (statusResult.exitCode === 0) {
      for (const line of statusResult.stdout.trim().split("\n")) {
        if (!line) continue
        const [code, file] = line.split("\t")
        if (!code || !file) continue
        const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
        status.set(file, kind)
      }
    }

    // Get numstat for additions/deletions counts
    const numstat = await git(
      `-c core.autocrlf=false -c core.quotepath=false diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`,
    )
    if (numstat.exitCode !== 0) return []

    const lines = numstat.stdout.trim().split("\n").filter(Boolean)
    for (const line of lines) {
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      let before = ""
      let after = ""
      if (!isBinaryFile) {
        const beforeResult = await git(`-c core.autocrlf=false show ${from}:${file}`)
        before = beforeResult.exitCode === 0 ? beforeResult.stdout : ""
        const afterResult = await git(`-c core.autocrlf=false show ${to}:${file}`)
        after = afterResult.exitCode === 0 ? afterResult.stdout : ""
      }
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file) ?? "modified",
      })
    }
    return result
  }
}
