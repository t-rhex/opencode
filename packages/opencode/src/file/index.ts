import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import type { BunFile } from "bun"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Ripgrep } from "./ripgrep"
import fuzzysort from "fuzzysort"
import { Global } from "../global"
import { LocalFilesystem } from "../fs"

export namespace File {
  const log = Log.create({ service: "file" })

  async function git(args: string, cwd: string): Promise<{ stdout: string; exitCode: number }> {
    const result = await Instance.fs.exec(`git ${args}`, { cwd })
    return { stdout: result.stdout, exitCode: result.exitCode }
  }

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      absolute: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Content = z
    .object({
      type: z.literal("text"),
      content: z.string(),
      diff: z.string().optional(),
      patch: z
        .object({
          oldFileName: z.string(),
          newFileName: z.string(),
          oldHeader: z.string().optional(),
          newHeader: z.string().optional(),
          hunks: z.array(
            z.object({
              oldStart: z.number(),
              oldLines: z.number(),
              newStart: z.number(),
              newLines: z.number(),
              lines: z.array(z.string()),
            }),
          ),
          index: z.string().optional(),
        })
        .optional(),
      encoding: z.literal("base64").optional(),
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  async function shouldEncode(file: BunFile): Promise<boolean> {
    const type = file.type?.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false

    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false

    const parts = type.split("/", 2)
    const top = parts[0]
    const rest = parts[1] ?? ""
    const sub = rest.split(";", 1)[0]

    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    const bins = [
      "zip",
      "gzip",
      "bzip",
      "compressed",
      "binary",
      "pdf",
      "msword",
      "powerpoint",
      "excel",
      "ogg",
      "exe",
      "dmg",
      "iso",
      "rar",
    ]
    if (bins.some((mark) => sub.includes(mark))) return true

    return false
  }

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    type Entry = { files: string[]; dirs: string[] }
    let cache: Entry = { files: [], dirs: [] }
    let fetching = false

    const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"

    const fn = async (result: Entry) => {
      // Disable scanning if in root of file system
      if (Instance.directory === path.parse(Instance.directory).root) return
      fetching = true

      if (isGlobalHome) {
        const dirs = new Set<string>()
        const ignore = new Set<string>()

        if (process.platform === "darwin") ignore.add("Library")
        if (process.platform === "win32") ignore.add("AppData")

        const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
        const shouldIgnore = (name: string) => name.startsWith(".") || ignore.has(name)
        const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)

        const top = await fs.promises
          .readdir(Instance.directory, { withFileTypes: true })
          .catch(() => [] as fs.Dirent[])

        for (const entry of top) {
          if (!entry.isDirectory()) continue
          if (shouldIgnore(entry.name)) continue
          dirs.add(entry.name + "/")

          const base = path.join(Instance.directory, entry.name)
          const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
          for (const child of children) {
            if (!child.isDirectory()) continue
            if (shouldIgnoreNested(child.name)) continue
            dirs.add(entry.name + "/" + child.name + "/")
          }
        }

        result.dirs = Array.from(dirs).toSorted()
        cache = result
        fetching = false
        return
      }

      const set = new Set<string>()
      for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
        result.files.push(file)
        let current = file
        while (true) {
          const dir = path.dirname(current)
          if (dir === ".") break
          if (dir === current) break
          current = dir
          if (set.has(dir)) continue
          set.add(dir)
          result.dirs.push(dir + "/")
        }
      }
      cache = result
      fetching = false
    }
    fn(cache)

    return {
      async files() {
        if (!fetching) {
          fn({
            files: [],
            dirs: [],
          })
        }
        return cache
      },
    }
  })

  export function init() {
    state()
  }

  export async function status() {
    const project = Instance.project
    if (project.vcs !== "git") return []

    const diffResult = await git("-c core.quotepath=false diff --numstat HEAD", Instance.directory)
    const diffOutput = diffResult.exitCode === 0 ? diffResult.stdout : ""

    const changedFiles: Info[] = []

    if (diffOutput.trim()) {
      const lines = diffOutput.trim().split("\n")
      for (const line of lines) {
        const [added, removed, filepath] = line.split("\t")
        changedFiles.push({
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified",
        })
      }
    }

    const untrackedResult = await git(
      "-c core.quotepath=false ls-files --others --exclude-standard",
      Instance.directory,
    )
    const untrackedOutput = untrackedResult.exitCode === 0 ? untrackedResult.stdout : ""

    if (untrackedOutput.trim()) {
      const untrackedFiles = untrackedOutput.trim().split("\n")
      const filesystem = Instance.fs
      for (const filepath of untrackedFiles) {
        try {
          const content = await filesystem.read(path.join(Instance.directory, filepath))
          const lines = content.split("\n").length
          changedFiles.push({
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
      }
    }

    // Get deleted files
    const deletedResult = await git("-c core.quotepath=false diff --name-only --diff-filter=D HEAD", Instance.directory)
    const deletedOutput = deletedResult.exitCode === 0 ? deletedResult.stdout : ""

    if (deletedOutput.trim()) {
      const deletedFiles = deletedOutput.trim().split("\n")
      for (const filepath of deletedFiles) {
        changedFiles.push({
          path: filepath,
          added: 0,
          removed: 0, // Could get original line count but would require another git command
          status: "deleted",
        })
      }
    }

    return changedFiles.map((x) => ({
      ...x,
      path: path.relative(Instance.directory, x.path),
    }))
  }

  export async function read(file: string): Promise<Content> {
    using _ = log.time("read", { file })
    const project = Instance.project
    const full = path.join(Instance.directory, file)

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(full)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const filesystem = Instance.fs
    const isLocal = filesystem instanceof LocalFilesystem

    if (!(await filesystem.exists(full))) {
      return { type: "text", content: "" }
    }

    // For binary file detection, we use Bun.file locally, otherwise assume text
    if (isLocal) {
      const bunFile = Bun.file(full)
      const encode = await shouldEncode(bunFile)

      if (encode) {
        const buffer = await bunFile.arrayBuffer().catch(() => new ArrayBuffer(0))
        const content = Buffer.from(buffer).toString("base64")
        const mimeType = bunFile.type || "application/octet-stream"
        return { type: "text", content, mimeType, encoding: "base64" }
      }
    } else {
      // For remote, check file extension for binary types
      const ext = path.extname(file).toLowerCase()
      const binaryExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".ico",
        ".webp",
        ".mp3",
        ".mp4",
        ".wav",
        ".ogg",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".rar",
        ".7z",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".woff",
        ".woff2",
        ".ttf",
        ".eot",
      ]
      if (binaryExtensions.includes(ext)) {
        const bytes = await filesystem.readBytes(full)
        const content = Buffer.from(bytes).toString("base64")
        return { type: "text", content, mimeType: "application/octet-stream", encoding: "base64" }
      }
    }

    const content = await filesystem
      .read(full)
      .catch(() => "")
      .then((x) => x.trim())

    if (project.vcs === "git") {
      const diffResult = await git(`diff ${file}`, Instance.directory)
      let diff = diffResult.exitCode === 0 ? diffResult.stdout : ""
      if (!diff.trim()) {
        const stagedResult = await git(`diff --staged ${file}`, Instance.directory)
        diff = stagedResult.exitCode === 0 ? stagedResult.stdout : ""
      }
      if (diff.trim()) {
        const originalResult = await git(`show HEAD:${file}`, Instance.directory)
        const original = originalResult.exitCode === 0 ? originalResult.stdout : ""
        const patch = structuredPatch(file, file, original, content, "old", "new", {
          context: Infinity,
          ignoreWhitespace: true,
        })
        const diff = formatPatch(patch)
        return { type: "text", content, patch, diff }
      }
    }
    return { type: "text", content }
  }

  export async function list(dir?: string) {
    const exclude = [".git", ".DS_Store"]
    const project = Instance.project
    const filesystem = Instance.fs
    let ignored = (_: string) => false
    if (project.vcs === "git") {
      const ig = ignore()
      const gitignorePath = path.join(Instance.worktree, ".gitignore")
      if (await filesystem.exists(gitignorePath)) {
        ig.add(await filesystem.read(gitignorePath))
      }
      const ignorePath = path.join(Instance.worktree, ".ignore")
      if (await filesystem.exists(ignorePath)) {
        ig.add(await filesystem.read(ignorePath))
      }
      ignored = ig.ignores.bind(ig)
    }
    const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const nodes: Node[] = []
    const entries = await filesystem.readdir(resolved).catch(() => [] as string[])
    for (const name of entries) {
      if (exclude.includes(name)) continue
      const fullPath = path.join(resolved, name)
      const relativePath = path.relative(Instance.directory, fullPath)
      const stat = await filesystem.stat(fullPath).catch(() => null)
      if (!stat) continue
      const type = stat.isDirectory ? "directory" : "file"
      nodes.push({
        name,
        path: relativePath,
        absolute: fullPath,
        type,
        ignored: ignored(type === "directory" ? relativePath + "/" : relativePath),
      })
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const result = await state().then((x) => x.files())

    const hidden = (item: string) => {
      const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
      return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
    }
    const preferHidden = query.startsWith(".") || query.includes("/.")
    const sortHiddenLast = (items: string[]) => {
      if (preferHidden) return items
      const visible: string[] = []
      const hiddenItems: string[] = []
      for (const item of items) {
        const isHidden = hidden(item)
        if (isHidden) hiddenItems.push(item)
        if (!isHidden) visible.push(item)
      }
      return [...visible, ...hiddenItems]
    }
    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortHiddenLast(result.dirs.toSorted()).slice(0, limit)
    }

    const items =
      kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    const output = kind === "directory" ? sortHiddenLast(sorted).slice(0, limit) : sorted

    log.info("search", { query, kind, results: output.length })
    return output
  }
}
