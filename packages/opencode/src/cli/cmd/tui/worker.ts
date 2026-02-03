import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import type { BunWebSocketData } from "hono/bun"
import { Flag } from "@/flag/flag"
import { CurrentFilesystem, RemoteFilesystem, RemoteEvent } from "@/fs"
import { Bus } from "@/bus"

export interface RemoteConfig {
  host: string
  username: string
  port: number
  privateKeyPath?: string
  remoteDir?: string
  proxyJump?: string
  env?: Record<string, string>
  setupCommand?: string
  keepaliveInterval?: number
  keepaliveCountMax?: number
  hostKeyCheck?: boolean
}

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

if (process.env.OPENCODE_DIRECTORY) {
  CurrentFilesystem.setRemoteMode(true, process.env.OPENCODE_DIRECTORY)
  Log.Default.info("remote mode detected from OPENCODE_DIRECTORY", { directory: process.env.OPENCODE_DIRECTORY })
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Bun.Server<BunWebSocketData> | undefined
let remoteConfig: RemoteConfig | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (directory: string) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.App().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe(
          {},
          {
            signal,
          },
        ),
      ).catch(() => undefined)

      if (!events) {
        await Bun.sleep(250)
        continue
      }

      for await (const event of events.stream) {
        Rpc.emit("event", event as Event)
      }

      if (!signal.aborted) {
        await Bun.sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream(process.env.OPENCODE_DIRECTORY || process.cwd())

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.App().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async initRemote(config: RemoteConfig) {
    remoteConfig = config

    CurrentFilesystem.setRemoteMode(true, config.remoteDir)
    Instance.clearCache()

    const fs = new RemoteFilesystem(
      {
        host: config.host,
        username: config.username,
        port: config.port,
        privateKeyPath: config.privateKeyPath,
        proxyJump: config.proxyJump,
        keepaliveInterval: config.keepaliveInterval,
        keepaliveCountMax: config.keepaliveCountMax,
        hostKeyCheck: config.hostKeyCheck,
      },
      {
        onStateChange: (state) => {
          Bus.publish(RemoteEvent.StateChanged, state)
          Rpc.emit("remote.stateChanged", state)
        },
      },
    )

    await fs.connect()

    if (config.remoteDir) {
      const exists = await fs.exists(config.remoteDir)
      if (!exists) {
        CurrentFilesystem.setRemoteMode(false)
        await fs.disconnect()
        throw new Error(`Remote directory does not exist: ${config.remoteDir}`)
      }
      const stat = await fs.stat(config.remoteDir)
      if (!stat.isDirectory) {
        CurrentFilesystem.setRemoteMode(false)
        await fs.disconnect()
        throw new Error(`Remote path is not a directory: ${config.remoteDir}`)
      }
    }

    CurrentFilesystem.set(fs)

    // Check for required tools on remote
    const tools = ["git", "bash", "find", "grep"]
    const missing: string[] = []
    for (const tool of tools) {
      const check = await fs
        .exec(`command -v ${tool} 2>/dev/null`)
        .catch(() => ({ exitCode: 1, stdout: "", stderr: "" }))
      if (check.exitCode !== 0) missing.push(tool)
    }
    if (missing.length > 0) {
      Log.Default.warn("remote missing tools", { missing })
    }

    if (config.setupCommand) {
      Log.Default.info("running remote setup command", { command: config.setupCommand })
      await fs.exec(config.setupCommand).catch((err) => {
        Log.Default.warn("remote setup command failed", { error: err instanceof Error ? err.message : String(err) })
      })
    }

    Log.Default.info("remote filesystem connected", { host: config.host, port: config.port })
    return { connected: true }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      fs: CurrentFilesystem.get(),
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  getConnectionState() {
    if (!CurrentFilesystem.isRemote()) return null
    const fs = CurrentFilesystem.get() as RemoteFilesystem
    return fs.getConnectionState()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Instance.disposeAll()
    if (server) server.stop(true)
    const fs = CurrentFilesystem.get()
    if (fs.disconnect) await fs.disconnect()
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
