import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc, type RemoteConfig } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import type { Event } from "@opencode-ai/sdk/v2"
import type { EventSource, RemoteStateSource } from "./context/sdk"
import { SSHConfig } from "../../../util/ssh-config"
import type { ConnectionState } from "@/fs"
import { Config } from "@/config/config"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

function defaultKey(): string | undefined {
  const home = homedir()
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    const p = join(home, ".ssh", name)
    if (existsSync(p)) return p
  }
  return undefined
}

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
  }
}

function createRemoteStateSource(client: RpcClient): RemoteStateSource {
  return {
    on: (handler) => client.on<ConnectionState>("remote.stateChanged", handler),
  }
}

interface ParsedRemoteConfig {
  host: string
  username?: string
  port?: number
  privateKeyPath?: string
  remoteDir?: string
}

function parseRemoteTarget(
  target: string,
  options: {
    port?: number
    identity?: string
    remoteDir?: string
  },
): ParsedRemoteConfig {
  // Try to parse as user@host:port
  const fullMatch = target.match(/^([^@]+)@([^:]+):(\d+)$/)
  if (fullMatch) {
    const [, username, host, portStr] = fullMatch
    return {
      host,
      username,
      port: options.port ?? parseInt(portStr, 10),
      privateKeyPath: options.identity,
      remoteDir: options.remoteDir,
    }
  }

  // Try to parse as user@host
  const userHostMatch = target.match(/^([^@]+)@([^:]+)$/)
  if (userHostMatch) {
    const [, username, host] = userHostMatch
    return {
      host,
      username,
      port: options.port,
      privateKeyPath: options.identity,
      remoteDir: options.remoteDir,
    }
  }

  // Just hostname/alias (user comes from SSH config)
  return {
    host: target,
    port: options.port,
    privateKeyPath: options.identity,
    remoteDir: options.remoteDir,
  }
}

async function resolveRemoteConfig(
  target: string,
  options: {
    port?: number
    identity?: string
    remoteDir?: string
  },
): Promise<RemoteConfig> {
  // Check if target matches a profile name in config
  const config = await Config.global()
  const profile = config.remote?.profiles?.[target]

  if (profile) {
    // Use profile settings, CLI options override profile
    const sshConfig = SSHConfig.resolve(profile.host)
    return {
      host: sshConfig.hostname ?? profile.host,
      username: profile.username ?? sshConfig.user ?? process.env.USER ?? "root",
      port: options.port ?? profile.port ?? sshConfig.port ?? 22,
      privateKeyPath: options.identity ?? profile.identity ?? sshConfig.identityFile ?? defaultKey(),
      remoteDir: options.remoteDir ?? profile.remoteDir,
      proxyJump: sshConfig.proxyJump,
      env: profile.env,
      setupCommand: profile.setupCommand,
      keepaliveInterval: profile.keepaliveInterval,
      keepaliveCountMax: profile.keepaliveCountMax,
      hostKeyCheck: profile.hostKeyCheck ?? config.remote?.hostKeyCheck,
      agentForward: profile.agentForward,
    }
  }

  // Otherwise parse as user@host:port format
  const parsed = parseRemoteTarget(target, options)
  const sshConfig = SSHConfig.resolve(parsed.host)

  // Merge with priority: CLI flags > parsed target > SSH config > defaults
  return {
    host: sshConfig.hostname ?? parsed.host,
    username: parsed.username ?? sshConfig.user ?? process.env.USER ?? "root",
    port: options.port ?? parsed.port ?? sshConfig.port ?? 22,
    privateKeyPath: options.identity ?? parsed.privateKeyPath ?? sshConfig.identityFile ?? defaultKey(),
    remoteDir: options.remoteDir ?? parsed.remoteDir,
    proxyJump: sshConfig.proxyJump,
    hostKeyCheck: config.remote?.hostKeyCheck,
  }
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("remote", {
        type: "string",
        describe:
          "SSH target or profile name for remote development (e.g., user@host:port or a profile from config.json)",
      })
      .option("identity", {
        type: "string",
        alias: ["i"],
        describe: "path to SSH private key for remote connection",
      })
      .option("ssh-port", {
        type: "number",
        alias: ["p"],
        describe: "SSH port for remote connection (default: 22)",
      })
      .option("remote-dir", {
        type: "string",
        describe: "working directory on remote server (defaults to home directory)",
      })
      .option("forward-port", {
        type: "string",
        alias: ["L"],
        describe: "forward a remote port to local (e.g., 3000 or 3000:8080)",
      }),
  handler: async (args) => {
    const baseCwd = process.env.PWD ?? process.cwd()
    const localCwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
    const localWorker = new URL("./worker.ts", import.meta.url)
    const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
    const workerPath = await iife(async () => {
      if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
      if (await Bun.file(distWorker).exists()) return distWorker
      return localWorker
    })

    const isRemote = !!args.remote
    const remoteConfig = isRemote
      ? await resolveRemoteConfig(args.remote!, {
          port: args["ssh-port"],
          identity: args.identity,
          remoteDir: args["remote-dir"],
        })
      : undefined
    const cwd = isRemote ? (remoteConfig!.remoteDir ?? `/home/${remoteConfig!.username}`) : localCwd

    if (!isRemote) {
      try {
        process.chdir(localCwd)
      } catch (e) {
        UI.error("Failed to change directory to " + localCwd)
        return
      }
    }

    const worker = new Worker(workerPath, {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        ...(isRemote ? { OPENCODE_DIRECTORY: cwd } : {}),
      },
    })
    worker.onerror = (e) => {
      Log.Default.error(e)
    }
    const client = Rpc.client<typeof rpc>(worker)
    process.on("uncaughtException", (e) => {
      Log.Default.error(e)
    })
    process.on("unhandledRejection", (e) => {
      Log.Default.error(e)
    })
    process.on("SIGUSR2", async () => {
      await client.call("reload", undefined)
    })

    let remoteState: RemoteStateSource | undefined
    if (remoteConfig) {
      const config = { ...remoteConfig, remoteDir: cwd }
      UI.println(`Connecting to remote: ${config.username}@${config.host}:${config.port}...`)

      // Create remote state source for TUI
      remoteState = createRemoteStateSource(client)

      // Listen for connection state changes (for logging)
      client.on<ConnectionState>("remote.stateChanged", (state) => {
        if (state.status === "reconnecting") {
          Log.Default.info(`Reconnecting to ${state.host}... (attempt ${state.reconnectAttempt})`)
        } else if (state.status === "connected" && state.reconnectAttempt > 0) {
          Log.Default.info(`Reconnected to ${state.host}`)
        } else if (state.status === "error") {
          Log.Default.error(`Connection failed: ${state.lastError}`)
        }
      })

      try {
        await client.call("initRemote", config)
        UI.println("Connected to remote server")
      } catch (e) {
        UI.error(`Failed to connect to remote: ${e instanceof Error ? e.message : e}`)
        return
      }

      if (args.forwardPort) {
        const parts = String(args.forwardPort).split(":")
        const local = parseInt(parts[0], 10)
        const remote = parts.length > 1 ? parseInt(parts[1], 10) : local

        const sshArgs = [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-N",
          "-L",
          `${local}:127.0.0.1:${remote}`,
        ]
        if (remoteConfig!.privateKeyPath) sshArgs.push("-i", remoteConfig!.privateKeyPath)
        sshArgs.push("-p", String(remoteConfig!.port))
        sshArgs.push(`${remoteConfig!.username}@${remoteConfig!.host}`)

        const { spawn: spawnProcess } = await import("child_process")
        const tunnel = spawnProcess("ssh", sshArgs, { stdio: "ignore", detached: true })
        tunnel.unref()

        process.on("exit", () => tunnel.kill())
        UI.println(`Port forwarding: localhost:${local} -> remote:${remote}`)
      }
    }

    const prompt = await iife(async () => {
      const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })

    // Check if server should be started (port or hostname explicitly set in CLI or config)
    const networkOpts = await resolveNetworkOptions(args)
    const shouldStartServer =
      process.argv.includes("--port") ||
      process.argv.includes("--hostname") ||
      process.argv.includes("--mdns") ||
      networkOpts.mdns ||
      networkOpts.port !== 0 ||
      networkOpts.hostname !== "127.0.0.1"

    let url: string
    let customFetch: typeof fetch | undefined
    let events: EventSource | undefined

    if (shouldStartServer) {
      // Start HTTP server for external access
      const server = await client.call("server", networkOpts)
      url = server.url
    } else {
      // Use direct RPC communication (no HTTP)
      url = "http://opencode-remote.internal"
      customFetch = createWorkerFetch(client)
      events = createEventSource(client)
    }

    const tuiPromise = tui({
      url,
      fetch: customFetch,
      events,
      remoteState,
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        model: args.model,
        prompt,
        remote: remoteConfig
          ? { host: remoteConfig.host, username: remoteConfig.username, port: remoteConfig.port }
          : undefined,
      },
      onExit: async () => {
        await client.call("shutdown", undefined)
      },
    })

    setTimeout(() => {
      client.call("checkUpgrade", { directory: cwd }).catch(() => {})
    }, 1000)

    await tuiPromise
  },
})
