import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import { RemoteSession } from "../../../remote/session"
import * as prompts from "@clack/prompts"

export const RemoteStopCommand = cmd({
  command: "stop <target>",
  describe: "stop remote opencode session",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host",
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "session ID to stop",
        demandOption: true,
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      })
      .option("cleanup", {
        type: "boolean",
        describe: "remove workspace directory",
        default: false,
      }),
  handler: async (args) => {
    const { username, host, port } = SSH.parseTarget(args.target)
    const sshOpts: SSH.ConnectOptions = {
      host,
      username,
      port,
      identity: args.identity,
    }

    prompts.intro(`Stopping session ${args.id} on ${args.target}`)

    const spinner = prompts.spinner()

    spinner.start("Reading session metadata...")
    const metadataPath = RemoteSession.metadataPath(args.id)

    let metadata: RemoteSession.Metadata
    try {
      const content = await SSH.readFile(sshOpts, metadataPath)
      metadata = RemoteSession.parseMetadata(content)
      spinner.stop("Metadata loaded")
    } catch {
      spinner.stop("Session not found")
      prompts.log.error(`No session found with ID: ${args.id}`)
      process.exit(1)
    }

    spinner.start("Stopping server process...")
    const running = await SSH.isProcessRunning(sshOpts, metadata.pid)
    if (running) {
      await SSH.kill(sshOpts, metadata.pid)
      await new Promise((r) => setTimeout(r, 1000))

      const stillRunning = await SSH.isProcessRunning(sshOpts, metadata.pid)
      if (stillRunning) {
        await SSH.kill(sshOpts, metadata.pid, true)
      }
      spinner.stop("Server stopped")
    } else {
      spinner.stop("Server was not running")
    }

    spinner.start("Removing metadata file...")
    await SSH.rm(sshOpts, metadataPath)
    spinner.stop("Metadata removed")

    if (args.cleanup) {
      spinner.start("Removing workspace...")
      const workspacePath = RemoteSession.workspacePath(args.id)
      await SSH.rm(sshOpts, workspacePath, true)
      spinner.stop("Workspace removed")
    }

    prompts.log.success(`Session ${args.id} stopped`)
    prompts.outro("Done")
  },
})
