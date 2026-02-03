import type { Client as SSHClient, ClientChannel } from "ssh2"
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js"
import { PassThrough } from "node:stream"

export class SshStdioTransport implements Transport {
  private stream: ClientChannel | null = null
  private buffer = ""
  private stderrStream = new PassThrough()

  sessionId?: string
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private client: SSHClient,
    private command: string[],
    private cwd?: string,
    private env?: Record<string, string>,
  ) {}

  get stderr() {
    return this.stderrStream
  }

  async start(): Promise<void> {
    const parts: string[] = []

    if (this.cwd) parts.push(`cd "${this.cwd}" &&`)

    if (this.env) {
      for (const key of Object.keys(this.env)) {
        parts.push(`${key}="${this.env[key]}"`)
      }
    }

    parts.push(this.command.join(" "))
    const full = parts.join(" ")

    return new Promise<void>((resolve, reject) => {
      this.client.exec(full, (err, stream) => {
        if (err) return reject(err)

        this.stream = stream

        stream.on("data", (chunk: Buffer) => {
          this.buffer += chunk.toString()
          const lines = this.buffer.split("\n")
          this.buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.trim()) continue
            const parsed = JSON.parse(line)
            const message = JSONRPCMessageSchema.parse(parsed)
            this.onmessage?.(message)
          }
        })

        stream.stderr.on("data", (chunk: Buffer) => {
          this.stderrStream.write(chunk)
        })

        stream.on("close", () => {
          this.stream = null
          this.onclose?.()
        })

        stream.on("error", (error: Error) => {
          this.onerror?.(error)
        })

        resolve()
      })
    })
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.stream) throw new Error("transport not started")

    const serialized = JSON.stringify(message) + "\n"
    const ok = this.stream.write(serialized)
    if (ok) return

    return new Promise<void>((resolve) => {
      this.stream!.once("drain", resolve)
    })
  }

  async close(): Promise<void> {
    if (!this.stream) return

    this.stream.signal("KILL")
    this.stream.close()
    this.stream = null
    this.onclose?.()
  }
}
