import { Client, type ConnectConfig } from "ssh2"
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export namespace SSH {
  export interface ConnectOptions {
    host: string
    username: string
    port?: number
    identity?: string // path to private key
    password?: string
    agent?: string // SSH_AUTH_SOCK path
  }

  // Parse user@host string into components
  export function parseTarget(target: string): { username: string; host: string; port?: number } {
    const atIndex = target.lastIndexOf("@")
    if (atIndex === -1) {
      throw new Error(`Invalid target "${target}": expected user@host format`)
    }
    const username = target.slice(0, atIndex)
    let hostPart = target.slice(atIndex + 1)
    let port: number | undefined

    const colonIndex = hostPart.lastIndexOf(":")
    if (colonIndex !== -1) {
      const portStr = hostPart.slice(colonIndex + 1)
      port = parseInt(portStr, 10)
      if (isNaN(port)) {
        throw new Error(`Invalid port in target "${target}"`)
      }
      hostPart = hostPart.slice(0, colonIndex)
    }

    return { username, host: hostPart, port }
  }

  function buildConfig(opts: ConnectOptions): ConnectConfig {
    const config: ConnectConfig = {
      host: opts.host,
      username: opts.username,
      port: opts.port ?? 22,
    }

    if (opts.identity) {
      const keyPath = opts.identity.startsWith("~") ? join(homedir(), opts.identity.slice(1)) : opts.identity
      config.privateKey = readFileSync(keyPath)
    } else if (opts.password) {
      config.password = opts.password
    } else {
      config.agent = opts.agent ?? process.env.SSH_AUTH_SOCK
    }

    return config
  }

  function connect(opts: ConnectOptions): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      const config = buildConfig(opts)

      client.on("ready", () => resolve(client))
      client.on("error", (err) => reject(err))
      client.connect(config)
    })
  }

  export async function exec(opts: ConnectOptions, command: string): Promise<string> {
    const client = await connect(opts)

    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          client.end()
          return reject(err)
        }

        let stdout = ""
        let stderr = ""

        stream.on("data", (data: Buffer) => {
          stdout += data.toString()
        })

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString()
        })

        stream.on("close", (code: number) => {
          client.end()
          if (code !== 0) {
            reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`))
          } else {
            resolve(stdout)
          }
        })
      })
    })
  }

  export async function execBackground(opts: ConnectOptions, command: string, logFile: string): Promise<number> {
    const bgCommand = `nohup sh -c '${command}' > ${logFile} 2>&1 & echo $!`
    const result = await exec(opts, bgCommand)
    const pid = parseInt(result.trim(), 10)
    if (isNaN(pid)) {
      throw new Error(`Failed to get PID from background command: ${result}`)
    }
    return pid
  }

  export async function exists(opts: ConnectOptions, remotePath: string): Promise<boolean> {
    try {
      await exec(opts, `test -e ${remotePath}`)
      return true
    } catch {
      return false
    }
  }

  export async function isProcessRunning(opts: ConnectOptions, pid: number): Promise<boolean> {
    try {
      await exec(opts, `kill -0 ${pid}`)
      return true
    } catch {
      return false
    }
  }

  export async function readFile(opts: ConnectOptions, remotePath: string): Promise<string> {
    return exec(opts, `cat ${remotePath}`)
  }

  export async function writeFile(opts: ConnectOptions, remotePath: string, content: string): Promise<void> {
    const escaped = content.replace(/'/g, "'\\''")
    await exec(opts, `echo '${escaped}' > ${remotePath}`)
  }

  export async function mkdir(opts: ConnectOptions, remotePath: string): Promise<void> {
    await exec(opts, `mkdir -p ${remotePath}`)
  }

  export async function rm(opts: ConnectOptions, remotePath: string, recursive = false): Promise<void> {
    const flags = recursive ? "-rf" : "-f"
    await exec(opts, `rm ${flags} ${remotePath}`)
  }

  export async function kill(opts: ConnectOptions, pid: number, force = false): Promise<void> {
    const signal = force ? "-9" : "-15"
    await exec(opts, `kill ${signal} ${pid}`).catch(() => {})
  }

  export async function glob(opts: ConnectOptions, pattern: string): Promise<string[]> {
    try {
      const result = await exec(opts, `ls -1 ${pattern} 2>/dev/null || true`)
      return result.trim().split("\n").filter(Boolean)
    } catch {
      return []
    }
  }
}
