import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { CurrentFilesystem, RemoteFilesystem, LocalFilesystem, RemoteEvent } from "../../fs"
import { Instance } from "../../project/instance"
import { Bus } from "../../bus"
import { Log } from "../../util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { SSHConfig } from "../../util/ssh-config"
import { Config } from "../../config/config"
import { createServer, type Server } from "net"

const log = Log.create({ service: "server.remote" })

const tunnels = new Map<number, Server>()

function parseTarget(target: string, config: Config.Info) {
  const profile = config.remote?.profiles?.[target]
  if (profile) {
    const ssh = SSHConfig.resolve(profile.host)
    return {
      host: ssh.hostname ?? profile.host,
      username: profile.username ?? ssh.user ?? process.env.USER ?? "root",
      port: profile.port ?? ssh.port ?? 22,
      privateKeyPath: profile.identity ?? ssh.identityFile,
      remoteDir: profile.remoteDir,
      proxyJump: ssh.proxyJump,
      env: profile.env,
      setupCommand: profile.setupCommand,
      keepaliveInterval: profile.keepaliveInterval,
      keepaliveCountMax: profile.keepaliveCountMax,
      hostKeyCheck: profile.hostKeyCheck ?? config.remote?.hostKeyCheck,
      agentForward: profile.agentForward,
    }
  }

  let host = target
  let username: string | undefined
  let port: number | undefined

  const atIdx = target.indexOf("@")
  if (atIdx !== -1) {
    username = target.slice(0, atIdx)
    host = target.slice(atIdx + 1)
  }

  const colonIdx = host.lastIndexOf(":")
  if (colonIdx !== -1) {
    port = parseInt(host.slice(colonIdx + 1), 10)
    host = host.slice(0, colonIdx)
  }

  const ssh = SSHConfig.resolve(host)
  return {
    host: ssh.hostname ?? host,
    username: username ?? ssh.user ?? process.env.USER ?? "root",
    port: port ?? ssh.port ?? 22,
    privateKeyPath: ssh.identityFile,
    remoteDir: undefined as string | undefined,
    proxyJump: ssh.proxyJump,
    hostKeyCheck: config.remote?.hostKeyCheck,
  }
}

export const RemoteRoutes = lazy(() =>
  new Hono()
    .post(
      "/connect",
      describeRoute({
        summary: "Connect to remote SSH host",
        description: "Connect to a remote SSH host using a target string or profile name.",
        operationId: "remote.connect",
        responses: {
          200: {
            description: "Successfully connected to remote host",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    connected: z.literal(true),
                    host: z.string(),
                    username: z.string(),
                    port: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          target: z.string().meta({ description: "Connection target: user@host, user@host:port, or a profile name" }),
        }),
      ),
      async (c) => {
        const target = c.req.valid("json").target
        const config = await Config.get()
        const parsed = parseTarget(target, config)

        log.info("connecting to remote", { host: parsed.host, port: parsed.port, username: parsed.username })

        const fs = new RemoteFilesystem(
          {
            host: parsed.host,
            username: parsed.username,
            port: parsed.port,
            privateKeyPath: parsed.privateKeyPath,
            proxyJump: parsed.proxyJump,
            keepaliveInterval: parsed.keepaliveInterval,
            keepaliveCountMax: parsed.keepaliveCountMax,
            hostKeyCheck: parsed.hostKeyCheck,
            agentForward: parsed.agentForward,
          },
          {
            onStateChange: (state) => {
              Bus.publish(RemoteEvent.StateChanged, state)
            },
          },
        )

        const err = await fs.connect().then(
          () => null,
          (e: unknown) => e,
        )
        if (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("ssh connection failed", { host: parsed.host, error: msg })
          return c.json({ error: `SSH connection failed: ${msg}` }, { status: 502 })
        }

        if (parsed.remoteDir) {
          const exists = await fs.exists(parsed.remoteDir)
          if (!exists) {
            await fs.disconnect()
            return c.json({ error: `Remote directory does not exist: ${parsed.remoteDir}` }, { status: 400 })
          }
          const stat = await fs.stat(parsed.remoteDir)
          if (!stat.isDirectory) {
            await fs.disconnect()
            return c.json({ error: `Remote path is not a directory: ${parsed.remoteDir}` }, { status: 400 })
          }
        }

        CurrentFilesystem.setRemoteMode(true, parsed.remoteDir)
        CurrentFilesystem.set(fs)
        Instance.clearCache()

        if (parsed.setupCommand) {
          log.info("running remote setup command", { command: parsed.setupCommand })
          await fs.exec(parsed.setupCommand).catch((e: unknown) => {
            log.warn("remote setup command failed", { error: e instanceof Error ? e.message : String(e) })
          })
        }

        log.info("remote filesystem connected", { host: parsed.host, port: parsed.port })

        return c.json({
          connected: true as const,
          host: parsed.host,
          username: parsed.username,
          port: parsed.port,
        })
      },
    )
    .post(
      "/disconnect",
      describeRoute({
        summary: "Disconnect from remote",
        description: "Disconnect from the current remote SSH connection and revert to local filesystem.",
        operationId: "remote.disconnect",
        responses: {
          200: {
            description: "Successfully disconnected",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    disconnected: z.literal(true),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const fs = CurrentFilesystem.get()
        if (fs instanceof RemoteFilesystem) await fs.disconnect()

        CurrentFilesystem.set(new LocalFilesystem())
        CurrentFilesystem.setRemoteMode(false)
        Instance.clearCache()

        log.info("remote filesystem disconnected")

        return c.json({ disconnected: true as const })
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get remote connection status",
        description: "Get the current remote SSH connection status.",
        operationId: "remote.status",
        responses: {
          200: {
            description: "Remote connection status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    connected: z.boolean(),
                    host: z.string().optional(),
                    port: z.number().optional(),
                    username: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        if (!CurrentFilesystem.isRemote()) return c.json({ connected: false })

        const fs = CurrentFilesystem.get()
        if (!(fs instanceof RemoteFilesystem)) return c.json({ connected: false })

        const state = fs.getConnectionState()
        return c.json({
          connected: state.status === "connected",
          host: state.host,
          port: state.port,
          username: undefined as string | undefined,
        })
      },
    )
    .get(
      "/profiles",
      describeRoute({
        summary: "List remote connection profiles",
        description: "List available remote SSH connection profiles from configuration.",
        operationId: "remote.profiles",
        responses: {
          200: {
            description: "List of remote profiles",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      name: z.string(),
                      host: z.string(),
                      username: z.string().optional(),
                      port: z.number().optional(),
                      remoteDir: z.string().optional(),
                    })
                    .array(),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const profiles = config.remote?.profiles
        if (!profiles) return c.json([])

        return c.json(
          Object.entries(profiles).map(([name, p]) => ({
            name,
            host: p.host,
            username: p.username,
            port: p.port,
            remoteDir: p.remoteDir,
          })),
        )
      },
    )
    .post(
      "/forward",
      describeRoute({
        summary: "Create port forward tunnel",
        description: "Forward a local port to a remote port over the active SSH connection.",
        operationId: "remote.forward",
        responses: {
          200: {
            description: "Tunnel created",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    localPort: z.number(),
                    remotePort: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          localPort: z.number().meta({ description: "Local port to listen on" }),
          remotePort: z.number().optional().meta({ description: "Remote port to forward to (defaults to localPort)" }),
        }),
      ),
      async (c) => {
        const { localPort, remotePort: rp } = c.req.valid("json")
        const remotePort = rp ?? localPort

        if (tunnels.has(localPort)) {
          return c.json({ error: `Port ${localPort} is already forwarded` }, { status: 400 })
        }

        const fs = CurrentFilesystem.get()
        if (!(fs instanceof RemoteFilesystem)) {
          return c.json({ error: "Not connected to a remote server" }, { status: 400 })
        }

        const client = fs.getSSHClient()
        if (!client) {
          return c.json({ error: "SSH client not available" }, { status: 400 })
        }

        const server = createServer((sock) => {
          client.forwardOut("127.0.0.1", localPort, "127.0.0.1", remotePort, (err, stream) => {
            if (err) {
              log.warn("tunnel forward failed", { localPort, remotePort, error: err.message })
              sock.end()
              return
            }
            sock.pipe(stream).pipe(sock)
            sock.on("error", () => stream.end())
            stream.on("error", () => sock.end())
          })
        })

        const result = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
          server.on("error", (err) => {
            resolve({ ok: false, error: `Failed to listen on port ${localPort}: ${err.message}` })
          })
          server.listen(localPort, "127.0.0.1", () => {
            tunnels.set(localPort, server)
            log.info("port forward created", { localPort, remotePort })
            resolve({ ok: true })
          })
        })

        if (!result.ok) return c.json({ error: result.error }, { status: 400 })
        return c.json({ localPort, remotePort })
      },
    )
    .post(
      "/forward/stop",
      describeRoute({
        summary: "Stop port forward tunnel",
        description: "Stop a previously created port forward tunnel.",
        operationId: "remote.forward.stop",
        responses: {
          200: {
            description: "Tunnel stopped",
            content: {
              "application/json": {
                schema: resolver(z.object({ stopped: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          localPort: z.number().meta({ description: "Local port of the tunnel to stop" }),
        }),
      ),
      async (c) => {
        const { localPort } = c.req.valid("json")
        const server = tunnels.get(localPort)
        if (!server) {
          return c.json({ error: `No tunnel on port ${localPort}` }, { status: 400 })
        }
        server.close()
        tunnels.delete(localPort)
        log.info("port forward stopped", { localPort })
        return c.json({ stopped: true as const })
      },
    )
    .get(
      "/forwards",
      describeRoute({
        summary: "List active port forwards",
        description: "List all active port forward tunnels.",
        operationId: "remote.forwards",
        responses: {
          200: {
            description: "Active tunnels",
            content: {
              "application/json": {
                schema: resolver(z.number().array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json([...tunnels.keys()])
      },
    )
    .get(
      "/ssh-hosts",
      describeRoute({
        summary: "List SSH config hosts",
        description: "List hosts from ~/.ssh/config that can be used as connection targets.",
        operationId: "remote.sshHosts",
        responses: {
          200: {
            description: "SSH config hosts",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      name: z.string(),
                      hostname: z.string().optional(),
                      user: z.string().optional(),
                      port: z.number().optional(),
                    })
                    .array(),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const hosts = SSHConfig.parse()
        const config = await Config.get()
        const profiles = config.remote?.profiles ?? {}

        const result = [...hosts.entries()]
          .filter(([name]) => {
            // Skip wildcard/glob patterns — not directly connectable
            if (name === "*" || name.includes("*") || name.includes("?")) return false
            // Skip if a profile with the same name already exists (profile takes priority)
            if (profiles[name]) return false
            return true
          })
          .map(([name, h]) => ({
            name,
            hostname: h.hostname,
            user: h.user,
            port: h.port,
          }))

        return c.json(result)
      },
    ),
)
