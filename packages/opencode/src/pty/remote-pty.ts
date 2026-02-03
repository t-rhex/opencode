import type { Client, ClientChannel } from "ssh2"

/**
 * Interface compatible with bun-pty's IPty for remote PTY sessions
 */
export interface IRemotePty {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (result: { exitCode: number }) => void): void
}

export interface RemotePtyOptions {
  rows?: number
  cols?: number
  cwd?: string
  env?: Record<string, string>
}

/**
 * RemotePty wraps an SSH shell channel to provide PTY functionality over SSH
 */
export class RemotePty implements IRemotePty {
  private stream: ClientChannel
  private _pid: number
  private dataCallbacks: Array<(data: string) => void> = []
  private exitCallbacks: Array<(result: { exitCode: number }) => void> = []
  private closed = false

  // Use a fake PID since we don't have access to remote PID
  get pid(): number {
    return this._pid
  }

  private constructor(stream: ClientChannel) {
    this.stream = stream
    // Generate a pseudo-PID for tracking (negative to distinguish from local)
    this._pid = -Math.floor(Math.random() * 1000000)

    stream.on("data", (data: Buffer) => {
      const str = data.toString()
      for (const cb of this.dataCallbacks) {
        cb(str)
      }
    })

    stream.stderr?.on("data", (data: Buffer) => {
      const str = data.toString()
      for (const cb of this.dataCallbacks) {
        cb(str)
      }
    })

    stream.on("close", () => {
      if (this.closed) return
      this.closed = true
      for (const cb of this.exitCallbacks) {
        cb({ exitCode: 0 })
      }
    })

    stream.on("exit", (code: number | null) => {
      if (this.closed) return
      this.closed = true
      for (const cb of this.exitCallbacks) {
        cb({ exitCode: code ?? 0 })
      }
    })
  }

  /**
   * Create a new RemotePty from an SSH client
   */
  static async create(client: Client, options?: RemotePtyOptions): Promise<RemotePty> {
    const rows = options?.rows ?? 24
    const cols = options?.cols ?? 80

    return new Promise((resolve, reject) => {
      const shellOptions = {
        term: "xterm-256color",
        rows,
        cols,
        env: {
          TERM: "xterm-256color",
          OPENCODE_TERMINAL: "1",
          ...options?.env,
        },
      }

      client.shell(shellOptions, (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        const pty = new RemotePty(stream)

        // If cwd is specified, change to that directory
        if (options?.cwd) {
          stream.write(`cd "${options.cwd}" && clear\n`)
        }

        resolve(pty)
      })
    })
  }

  write(data: string): void {
    if (!this.closed) {
      this.stream.write(data)
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.closed) {
      this.stream.setWindow(rows, cols, 0, 0)
    }
  }

  kill(): void {
    if (!this.closed) {
      this.closed = true
      this.stream.close()
    }
  }

  onData(callback: (data: string) => void): void {
    this.dataCallbacks.push(callback)
  }

  onExit(callback: (result: { exitCode: number }) => void): void {
    this.exitCallbacks.push(callback)
  }
}
