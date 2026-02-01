import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"
import { LocalFilesystem } from "@/fs"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const fs = Instance.fs
    const isLocal = fs instanceof LocalFilesystem

    let output = ""
    let exitCode = 0
    let hasErrors = false

    if (isLocal) {
      const rgPath = await Ripgrep.filepath()
      const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
      if (params.include) {
        args.push("--glob", params.include)
      }
      args.push(searchPath)

      const proc = Bun.spawn([rgPath, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        signal: ctx.abort,
      })

      output = await new Response(proc.stdout).text()
      const errorOutput = await new Response(proc.stderr).text()
      exitCode = await proc.exited
      hasErrors = exitCode === 2

      if (exitCode !== 0 && exitCode !== 2) {
        throw new Error(`ripgrep failed: ${errorOutput}`)
      }
    } else {
      const includeArg = params.include ? `--include='${params.include}'` : ""
      const cmd = `grep -rnH ${includeArg} -E '${params.pattern.replace(/'/g, "'\\''")}' "${searchPath}" 2>/dev/null || true`
      const result = await fs.exec(cmd)
      output = result.stdout
      exitCode = result.exitCode
    }

    if (exitCode === 1 || !output.trim()) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const lines = output.trim().split(/\r?\n/)
    const matches: { path: string; modTime: number; lineNum: number; lineText: string }[] = []

    for (const line of lines) {
      if (!line) continue

      const sepChar = isLocal ? "|" : ":"
      const parts = line.split(sepChar)
      if (parts.length < 3) continue

      const filePath = parts[0]
      const lineNumStr = parts[1]
      const lineText = parts.slice(2).join(sepChar)

      const lineNum = parseInt(lineNumStr, 10)
      if (isNaN(lineNum)) continue

      const stats = await fs.stat(filePath).catch(() => null)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
