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

const log = Log.create({ service: "server.remote" })

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
    ),
)
