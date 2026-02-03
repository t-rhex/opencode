import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2"
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { IFilesystem, FileStat, ExecResult, ExecOptions } from "./interface"

export type ConnectionStatus = "connected" | "disconnected" | "connecting" | "reconnecting" | "error"

export interface ConnectionState {
  status: ConnectionStatus
  host: string
  port: number
  lastConnected?: Date
  lastError?: string
  reconnectAttempt: number
  nextRetryAt?: Date
}

export interface ConnectionCallbacks {
  onStateChange?: (state: ConnectionState) => void
}

export interface RemoteFilesystemOptions {
  host: string
  username: string
  port?: number
  privateKey?: string | Buffer
  privateKeyPath?: string
  password?: string
  agent?: string
  keepaliveInterval?: number
  keepaliveCountMax?: number
  readyTimeout?: number
  proxyJump?: string
  hostKeyCheck?: boolean
}

export class RemoteFilesystem implements IFilesystem {
  private client: Client | null = null
  private jumpClient: Client | null = null
  private sftp: SFTPWrapper | null = null
  private options: RemoteFilesystemOptions
  private config: ConnectConfig
  private connecting: Promise<void> | null = null
  private state: ConnectionState
  private callbacks: ConnectionCallbacks
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private reconnecting: Promise<void> | null = null

  constructor(options: RemoteFilesystemOptions, callbacks?: ConnectionCallbacks) {
    this.options = options
    this.config = this.buildConfig(options)
    this.callbacks = callbacks ?? {}
    this.state = {
      status: "disconnected",
      host: options.host,
      port: options.port ?? 22,
      reconnectAttempt: 0,
    }
  }

  private buildConfig(opts: RemoteFilesystemOptions): ConnectConfig {
    const config: ConnectConfig = {
      host: opts.host,
      username: opts.username,
      port: opts.port ?? 22,
      keepaliveInterval: opts.keepaliveInterval ?? 30000,
      keepaliveCountMax: opts.keepaliveCountMax ?? 3,
      readyTimeout: opts.readyTimeout ?? 20000,
    }

    if (opts.privateKey) {
      config.privateKey = opts.privateKey
    } else if (opts.privateKeyPath) {
      const keyPath = opts.privateKeyPath.startsWith("~")
        ? join(homedir(), opts.privateKeyPath.slice(1))
        : opts.privateKeyPath
      config.privateKey = readFileSync(keyPath)
    } else if (opts.password) {
      config.password = opts.password
    } else {
      config.agent = opts.agent ?? process.env.SSH_AUTH_SOCK
    }

    if (opts.hostKeyCheck === false) {
      // @ts-ignore - ssh2 supports this but types may not expose it
      config.hostVerifier = () => true
    }

    return config
  }

  private parseJumpHost(jump: string): ConnectConfig {
    const config: ConnectConfig = {}
    const idx = jump.lastIndexOf("@")
    if (idx !== -1) {
      config.username = jump.slice(0, idx)
      const rest = jump.slice(idx + 1)
      const colon = rest.lastIndexOf(":")
      if (colon !== -1) {
        config.host = rest.slice(0, colon)
        config.port = parseInt(rest.slice(colon + 1), 10)
      } else {
        config.host = rest
      }
    } else {
      config.host = jump
    }
    config.port = config.port || 22
    config.agent = process.env.SSH_AUTH_SOCK
    return config
  }

  private calculateRetryDelay(attempt: number): number {
    const base = 1000
    const max = 30000
    const factor = 2
    const exponential = Math.min(base * Math.pow(factor, attempt - 1), max)
    const jitter = exponential * 0.25 * Math.random()
    return Math.floor(exponential + jitter)
  }

  private updateState(partial: Partial<ConnectionState>) {
    this.state = { ...this.state, ...partial }
    this.callbacks.onStateChange?.(this.state)
  }

  getConnectionState(): ConnectionState {
    return { ...this.state }
  }

  private startHealthCheck() {
    this.stopHealthCheck()
    this.healthCheckTimer = setInterval(async () => {
      if (this.state.status !== "connected") return
      try {
        await this.exec("echo 1", { timeout: 5000 })
      } catch {
        this.handleDisconnection("Health check failed")
      }
    }, 30000)
  }

  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async handleDisconnection(reason: string) {
    if (this.state.status === "reconnecting" || this.reconnecting) return

    this.stopHealthCheck()
    this.client = null
    this.sftp = null

    this.updateState({
      status: "reconnecting",
      lastError: reason,
      reconnectAttempt: 0,
    })

    this.reconnecting = this.attemptReconnection()
    await this.reconnecting
    this.reconnecting = null
  }

  private async attemptReconnection() {
    const maxAttempts = 10

    while (this.state.reconnectAttempt < maxAttempts) {
      const attempt = this.state.reconnectAttempt + 1
      const delay = this.calculateRetryDelay(attempt)

      this.updateState({
        reconnectAttempt: attempt,
        nextRetryAt: new Date(Date.now() + delay),
      })

      await new Promise((resolve) => setTimeout(resolve, delay))

      try {
        this.updateState({ status: "connecting" })
        await this.connectInternal()
        this.updateState({
          status: "connected",
          reconnectAttempt: 0,
          lastConnected: new Date(),
          nextRetryAt: undefined,
        })
        this.startHealthCheck()
        return
      } catch (error) {
        this.updateState({
          status: "reconnecting",
          lastError: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.updateState({ status: "error" })
    throw new Error(`Failed to reconnect after ${maxAttempts} attempts`)
  }

  async connect(): Promise<void> {
    if (this.state.status === "connected") return
    if (this.connecting) return this.connecting

    this.updateState({ status: "connecting" })

    try {
      await this.connectInternal()
      this.updateState({
        status: "connected",
        lastConnected: new Date(),
        reconnectAttempt: 0,
      })
      this.startHealthCheck()
    } catch (error) {
      this.updateState({
        status: "error",
        lastError: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private connectInternal(): Promise<void> {
    const connectionTimeout = 30000

    this.connecting = new Promise(async (resolve, reject) => {
      const client = new Client()

      const timer = setTimeout(() => {
        client.end()
        this.connecting = null
        reject(new Error(`SSH connection timed out after ${connectionTimeout / 1000}s`))
      }, connectionTimeout)

      client.on("ready", () => {
        clearTimeout(timer)
        this.client = client
        this.connecting = null
        resolve()
      })

      client.on("error", (err) => {
        clearTimeout(timer)
        this.connecting = null
        reject(err)
      })

      client.on("close", () => {
        this.client = null
        this.sftp = null
      })

      if (this.options.proxyJump) {
        const jumpConfig = this.parseJumpHost(this.options.proxyJump)
        const jump = new Client()

        jump.on("ready", () => {
          this.jumpClient = jump
          jump.forwardOut("127.0.0.1", 0, this.config.host!, this.config.port!, (err, stream) => {
            if (err) {
              clearTimeout(timer)
              jump.end()
              reject(err)
              return
            }
            client.connect({ ...this.config, sock: stream })
          })
        })

        jump.on("error", (err) => {
          clearTimeout(timer)
          reject(err)
        })

        jump.connect(jumpConfig)
      } else {
        client.connect(this.config)
      }
    })

    return this.connecting
  }

  async disconnect(): Promise<void> {
    this.stopHealthCheck()
    if (this.sftp) {
      this.sftp.end()
      this.sftp = null
    }
    if (this.client) {
      this.client.end()
      this.client = null
    }
    if (this.jumpClient) {
      this.jumpClient.end()
      this.jumpClient = null
    }
    this.connecting = null
    this.reconnecting = null
    this.updateState({ status: "disconnected" })
  }

  isConnected(): boolean {
    return this.client !== null
  }

  /**
   * Get the underlying ssh2 Client for direct channel operations (e.g., MCP transport)
   */
  getSSHClient(): Client | null {
    return this.client
  }

  private async ensureConnected(): Promise<Client> {
    if (this.state.status === "reconnecting" && this.reconnecting) {
      await this.reconnecting
    }

    if (!this.client || !this.isConnected()) {
      if (this.state.status !== "reconnecting") {
        await this.handleDisconnection("Connection lost")
      }
      if (this.reconnecting) {
        await this.reconnecting
      }
    }

    if (!this.client) throw new Error("SSH connection failed")
    return this.client
  }

  private async getSFTP(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp

    const client = await this.ensureConnected()
    const sftpTimeout = 30000

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SFTP subsystem request timed out after ${sftpTimeout / 1000}s`))
      }, sftpTimeout)

      client.sftp((err, sftp) => {
        clearTimeout(timer)
        if (err) reject(err)
        else {
          this.sftp = sftp
          resolve(sftp)
        }
      })
    })
  }

  async read(remotePath: string): Promise<string> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(remotePath)
      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
      stream.on("error", reject)
    })
  }

  async readBytes(remotePath: string): Promise<Uint8Array> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(remotePath)
      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
      stream.on("error", reject)
    })
  }

  async write(remotePath: string, content: string | Uint8Array): Promise<void> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath)
      stream.on("close", () => resolve())
      stream.on("error", reject)
      const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content)
      stream.end(buffer)
    })
  }

  async exists(remotePath: string): Promise<boolean> {
    const sftp = await this.getSFTP()
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err) => {
        resolve(!err)
      })
    })
  }

  async stat(remotePath: string): Promise<FileStat> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) reject(err)
        else {
          resolve({
            size: stats.size,
            mtime: new Date(stats.mtime * 1000),
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
          })
        }
      })
    })
  }

  async unlink(remotePath: string): Promise<void> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async mkdir(remotePath: string, recursive = false): Promise<void> {
    if (recursive) {
      const client = await this.ensureConnected()
      return this.execCommand(client, `mkdir -p "${remotePath}"`).then(() => {})
    }

    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async readdir(remotePath: string): Promise<string[]> {
    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) reject(err)
        else resolve(list.map((item) => item.filename))
      })
    })
  }

  async rmdir(remotePath: string, recursive = false): Promise<void> {
    if (recursive) {
      const client = await this.ensureConnected()
      return this.execCommand(client, `rm -rf "${remotePath}"`).then(() => {})
    }

    const sftp = await this.getSFTP()
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private execCommand(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
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
          if (code !== 0) {
            reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`))
          } else {
            resolve(stdout)
          }
        })
      })
    })
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const client = await this.ensureConnected()
    const cwd = options?.cwd
    const timeout = options?.timeout || 120000

    const envPrefix = options?.env
      ? Object.entries(options.env)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ") + " "
      : ""
    const fullCommand = cwd ? `cd "${cwd}" && ${envPrefix}${command}` : `${envPrefix}${command}`

    return new Promise((resolve, reject) => {
      let timedOut = false
      let stream: ReturnType<Client["exec"]> extends void
        ? never
        : Parameters<Parameters<Client["exec"]>[1]>[1] | null = null
      const timer = setTimeout(() => {
        timedOut = true
        if (stream) {
          stream.signal("KILL")
          stream.close()
        }
      }, timeout)

      client.exec(fullCommand, (err, s) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }

        stream = s
        let stdout = ""
        let stderr = ""

        stream.on("data", (data: Buffer) => {
          stdout += data.toString()
        })

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString()
        })

        stream.on("close", (code: number) => {
          clearTimeout(timer)
          if (timedOut) {
            resolve({ stdout, stderr, exitCode: 124 })
          } else {
            resolve({ stdout, stderr, exitCode: code ?? 0 })
          }
        })
      })
    })
  }

  async execStream(
    command: string,
    options: ExecOptions | undefined,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ): Promise<ExecResult> {
    const client = await this.ensureConnected()
    const cwd = options?.cwd
    const timeout = options?.timeout || 120000

    const envPrefix = options?.env
      ? Object.entries(options.env)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ") + " "
      : ""
    const fullCommand = cwd ? `cd "${cwd}" && ${envPrefix}${command}` : `${envPrefix}${command}`

    return new Promise((resolve, reject) => {
      let timedOut = false
      let stream: ReturnType<Client["exec"]> extends void
        ? never
        : Parameters<Parameters<Client["exec"]>[1]>[1] | null = null
      const timer = setTimeout(() => {
        timedOut = true
        if (stream) {
          stream.signal("KILL")
          stream.close()
        }
      }, timeout)

      client.exec(fullCommand, (err, s) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }

        stream = s
        let stdout = ""
        let stderr = ""

        stream.on("data", (data: Buffer) => {
          const str = data.toString()
          stdout += str
          onStdout(str)
        })

        stream.stderr.on("data", (data: Buffer) => {
          const str = data.toString()
          stderr += str
          onStderr(str)
        })

        stream.on("close", (code: number) => {
          clearTimeout(timer)
          if (timedOut) {
            resolve({ stdout, stderr, exitCode: 124 })
          } else {
            resolve({ stdout, stderr, exitCode: code ?? 0 })
          }
        })
      })
    })
  }

  execStreamAbortable(
    command: string,
    options: ExecOptions | undefined,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ): { result: Promise<ExecResult>; kill: () => void } {
    let stream: any = null
    const client = this.ensureConnected()
    const cwd = options?.cwd
    const timeout = options?.timeout || 120000
    const envPrefix = options?.env
      ? Object.entries(options.env)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ") + " "
      : ""
    const fullCommand = cwd ? `cd "${cwd}" && ${envPrefix}${command}` : `${envPrefix}${command}`

    const kill = () => {
      if (stream) {
        stream.signal("KILL")
        stream.close()
      }
    }

    const result = client.then(
      (c) =>
        new Promise<ExecResult>((resolve, reject) => {
          let timedOut = false
          const timer = setTimeout(() => {
            timedOut = true
            kill()
          }, timeout)

          c.exec(fullCommand, (err, s) => {
            if (err) {
              clearTimeout(timer)
              reject(err)
              return
            }

            stream = s
            let stdout = ""
            let stderr = ""

            stream.on("data", (data: Buffer) => {
              const str = data.toString()
              stdout += str
              onStdout(str)
            })

            stream.stderr.on("data", (data: Buffer) => {
              const str = data.toString()
              stderr += str
              onStderr(str)
            })

            stream.on("close", (code: number) => {
              clearTimeout(timer)
              if (timedOut) {
                resolve({ stdout, stderr, exitCode: 124 })
              } else {
                resolve({ stdout, stderr, exitCode: code ?? 0 })
              }
            })
          })
        }),
    )

    return { result, kill }
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    const escaped = pattern.replace(/'/g, "'\\''")
    const result = await this.exec(
      `bash -c 'shopt -s globstar nullglob; for f in ${escaped}; do [ -f "$f" ] && echo "$f"; done'`,
      { cwd },
    )
    return result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
  }

  async realpath(remotePath: string): Promise<string> {
    const result = await this.exec(`realpath "${remotePath}"`)
    return result.stdout.trim()
  }

  /**
   * Create a PTY session on the remote server
   */
  async createPty(options?: {
    rows?: number
    cols?: number
    cwd?: string
    env?: Record<string, string>
  }): Promise<import("../pty/remote-pty").IRemotePty> {
    const { RemotePty } = await import("../pty/remote-pty")
    const client = await this.ensureConnected()
    return RemotePty.create(client, options)
  }
}
