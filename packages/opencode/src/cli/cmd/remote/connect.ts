import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import { RemoteSession } from "../../../remote/session"
import * as prompts from "@clack/prompts"
import { spawn } from "child_process"
import { createConnection, createServer } from "net"

export const RemoteConnectCommand = cmd({
  command: "connect <target>",
  describe: "connect to remote opencode session",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to connect to",
        demandOption: true,
      })
      .option("repo", {
        type: "string",
        describe: "git repository URL",
        demandOption: true,
      })
      .option("ref", {
        type: "string",
        describe: "git ref (branch, tag, or SHA)",
        demandOption: true,
      })
      .option("workdir", {
        type: "string",
        describe: "use existing directory instead of cloning",
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      }),
  handler: async (args) => {
    const { username, host, port } = SSH.parseTarget(args.target)
    const sshOpts: SSH.ConnectOptions = {
      host,
      username,
      port,
      identity: args.identity,
    }

    prompts.intro(`Connecting to ${args.target}`)

    const spinner = prompts.spinner()

    spinner.start("Checking remote installation...")
    const binPath = RemoteSession.binPath()
    const installed = await SSH.exists(sshOpts, binPath)
    if (!installed) {
      spinner.stop("OpenCode not installed")
      prompts.log.info("Installing opencode on remote...")

      await SSH.mkdir(sshOpts, "~/.opencode-remote/bin")
      await SSH.mkdir(sshOpts, "~/.opencode-remote/run")
      await SSH.mkdir(sshOpts, "~/.opencode-remote/logs")
      await SSH.mkdir(sshOpts, "~/.opencode-remote/workspaces")

      try {
        await SSH.exec(
          sshOpts,
          `curl -fsSL https://opencode.ai/install | OPENCODE_INSTALL_DIR=~/.opencode-remote/bin bash`,
        )
        prompts.log.success("Installation complete")
      } catch (err) {
        prompts.log.error("Installation failed: " + String(err))
        process.exit(1)
      }
    } else {
      spinner.stop("OpenCode installed")
    }

    const sessionId = RemoteSession.generateId()
    let repoPath: string

    if (args.workdir) {
      spinner.start("Validating workdir...")
      const exists = await SSH.exists(sshOpts, args.workdir)
      if (!exists) {
        spinner.stop("Workdir not found")
        prompts.log.error(`Directory does not exist: ${args.workdir}`)
        process.exit(1)
      }
      repoPath = args.workdir
      spinner.stop(`Using workdir: ${repoPath}`)
    } else {
      spinner.start("Setting up workspace...")
      const workspacePath = RemoteSession.workspacePath(sessionId)
      await SSH.mkdir(sshOpts, workspacePath)

      repoPath = RemoteSession.repoPath(sessionId)
      try {
        await SSH.exec(sshOpts, `git clone ${args.repo} ${repoPath}`)
        await SSH.exec(sshOpts, `cd ${repoPath} && git fetch --all && git checkout ${args.ref}`)
        spinner.stop("Workspace ready")
      } catch (err) {
        spinner.stop("Setup failed")
        prompts.log.error(String(err))
        process.exit(1)
      }
    }

    const sha = (await SSH.exec(sshOpts, `cd ${repoPath} && git rev-parse HEAD`)).trim()

    spinner.start("Starting remote server...")
    const logPath = RemoteSession.logPath(sessionId)
    const serverCmd = `cd ${repoPath} && ${binPath} serve --port 0 --hostname 127.0.0.1`
    const pid = await SSH.execBackground(sshOpts, serverCmd, logPath)

    let remotePort: number | undefined
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        const logContent = await SSH.readFile(sshOpts, logPath)
        const match = logContent.match(/listening on http:\/\/[^:]+:(\d+)/)
        if (match) {
          remotePort = parseInt(match[1], 10)
          break
        }
      } catch {
        continue
      }
    }

    if (!remotePort) {
      spinner.stop("Failed to start server")
      await SSH.kill(sshOpts, pid, true).catch(() => {})
      process.exit(1)
    }
    spinner.stop(`Server running on port ${remotePort}`)

    const metadata: RemoteSession.Metadata = {
      id: sessionId,
      pid,
      port: remotePort,
      repo: args.repo,
      ref: args.ref,
      sha,
      path: repoPath,
      startedAt: new Date().toISOString(),
    }
    await SSH.writeFile(sshOpts, RemoteSession.metadataPath(sessionId), RemoteSession.serializeMetadata(metadata))

    spinner.start("Establishing SSH tunnel...")
    const localPort = await findFreePort()

    const sshArgs = [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-N",
      "-L",
      `${localPort}:127.0.0.1:${remotePort}`,
    ]
    if (args.identity) sshArgs.push("-i", args.identity)
    if (port) sshArgs.push("-p", String(port))
    sshArgs.push(`${username}@${host}`)

    const tunnel = spawn("ssh", sshArgs, { stdio: "ignore" })

    let tunnelReady = false
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250))
      try {
        await checkPort(localPort)
        tunnelReady = true
        break
      } catch {
        continue
      }
    }

    if (!tunnelReady) {
      spinner.stop("Tunnel failed to establish")
      tunnel.kill()
      process.exit(1)
    }
    spinner.stop(`Tunnel established (localhost:${localPort})`)

    prompts.log.info(`Session: ${sessionId}`)
    prompts.log.info(`Attaching to http://127.0.0.1:${localPort}`)
    prompts.outro("Starting TUI...")

    const cleanup = () => {
      tunnel.kill()
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)

    const attach = spawn(
      process.execPath,
      [process.argv[1], "attach", `http://127.0.0.1:${localPort}`, "--dir", repoPath],
      {
        stdio: "inherit",
      },
    )

    attach.on("close", () => {
      cleanup()
      prompts.intro("Session ended")
      prompts.log.info(`Remote session ${sessionId} is still running`)
      prompts.log.info(`To stop: opencode-remote remote stop ${args.target} --id ${sessionId}`)
      prompts.outro("Done")
    })
  },
})

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

function checkPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: "127.0.0.1" })
    socket.on("connect", () => {
      socket.destroy()
      resolve()
    })
    socket.on("error", reject)
  })
}
