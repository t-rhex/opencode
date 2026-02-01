import { spawn } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import type { IFilesystem, FileStat, ExecResult, ExecOptions } from "./interface"
import { Shell } from "@/shell/shell"

export class LocalFilesystem implements IFilesystem {
  async read(filepath: string): Promise<string> {
    return Bun.file(filepath).text()
  }

  async readBytes(filepath: string): Promise<Uint8Array> {
    const buffer = await Bun.file(filepath).arrayBuffer()
    return new Uint8Array(buffer)
  }

  async write(filepath: string, content: string | Uint8Array): Promise<void> {
    await Bun.write(filepath, content)
  }

  async exists(filepath: string): Promise<boolean> {
    return Bun.file(filepath)
      .stat()
      .then(() => true)
      .catch(() => false)
  }

  async stat(filepath: string): Promise<FileStat> {
    const s = await Bun.file(filepath).stat()
    return {
      size: s.size,
      mtime: new Date(s.mtimeMs),
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
    }
  }

  async unlink(filepath: string): Promise<void> {
    await fs.unlink(filepath)
  }

  async mkdir(filepath: string, recursive = false): Promise<void> {
    await fs.mkdir(filepath, { recursive })
  }

  async readdir(dirpath: string): Promise<string[]> {
    return fs.readdir(dirpath)
  }

  async rmdir(dirpath: string, recursive = false): Promise<void> {
    if (recursive) {
      await fs.rm(dirpath, { recursive: true, force: true })
    } else {
      await fs.rmdir(dirpath)
    }
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const shell = Shell.acceptable()
    const cwd = options?.cwd || process.cwd()
    const timeout = options?.timeout || 120000

    return new Promise((resolve, reject) => {
      const proc = spawn(command, {
        shell,
        cwd,
        env: { ...process.env, ...options?.env },
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, timeout)

      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString()
      })

      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString()
      })

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (timedOut) {
          resolve({ stdout, stderr, exitCode: 124 }) // timeout exit code
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 0 })
        }
      })

      proc.on("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  async execStream(
    command: string,
    options: ExecOptions | undefined,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ): Promise<ExecResult> {
    const shell = Shell.acceptable()
    const cwd = options?.cwd || process.cwd()
    const timeout = options?.timeout || 120000

    return new Promise((resolve, reject) => {
      const proc = spawn(command, {
        shell,
        cwd,
        env: { ...process.env, ...options?.env },
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, timeout)

      proc.stdout?.on("data", (chunk) => {
        const str = chunk.toString()
        stdout += str
        onStdout(str)
      })

      proc.stderr?.on("data", (chunk) => {
        const str = chunk.toString()
        stderr += str
        onStderr(str)
      })

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (timedOut) {
          resolve({ stdout, stderr, exitCode: 124 })
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 0 })
        }
      })

      proc.on("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    const glob = new Bun.Glob(pattern)
    const results: string[] = []
    for await (const match of glob.scan({ cwd, absolute: true })) {
      results.push(match)
    }
    return results
  }

  async realpath(filepath: string): Promise<string> {
    return fs.realpath(filepath)
  }

  // LocalFilesystem is always connected
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isConnected(): boolean {
    return true
  }
}

export const localFilesystem = new LocalFilesystem()
