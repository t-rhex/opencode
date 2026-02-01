import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2"
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { IFilesystem, FileStat, ExecResult, ExecOptions } from "./interface"

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
}

export class RemoteFilesystem implements IFilesystem {
  private client: Client | null = null
  private sftp: SFTPWrapper | null = null
  private options: RemoteFilesystemOptions
  private config: ConnectConfig
  private connecting: Promise<void> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5

  constructor(options: RemoteFilesystemOptions) {
    this.options = options
    this.config = this.buildConfig(options)
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

    return config
  }

  async connect(): Promise<void> {
    if (this.client && this.isConnected()) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise((resolve, reject) => {
      const client = new Client()

      client.on("ready", () => {
        this.client = client
        this.reconnectAttempts = 0
        this.connecting = null
        resolve()
      })

      client.on("error", (err) => {
        this.connecting = null
        reject(err)
      })

      client.on("close", () => {
        this.client = null
        this.sftp = null
      })

      client.connect(this.config)
    })

    return this.connecting
  }

  async disconnect(): Promise<void> {
    if (this.sftp) {
      this.sftp.end()
      this.sftp = null
    }
    if (this.client) {
      this.client.end()
      this.client = null
    }
    this.connecting = null
  }

  isConnected(): boolean {
    return this.client !== null
  }

  private async ensureConnected(): Promise<Client> {
    if (!this.client || !this.isConnected()) {
      await this.connect()
    }
    if (!this.client) throw new Error("SSH connection failed")
    return this.client
  }

  private async getSFTP(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp

    const client = await this.ensureConnected()
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
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

    const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command

    return new Promise((resolve, reject) => {
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
      }, timeout)

      client.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timer)
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

    const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command

    return new Promise((resolve, reject) => {
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
      }, timeout)

      client.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }

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

  async glob(pattern: string, cwd: string): Promise<string[]> {
    const result = await this.exec(`ls -1 ${pattern} 2>/dev/null || true`, { cwd })
    return result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
  }

  async realpath(remotePath: string): Promise<string> {
    const result = await this.exec(`realpath "${remotePath}"`)
    return result.stdout.trim()
  }
}
