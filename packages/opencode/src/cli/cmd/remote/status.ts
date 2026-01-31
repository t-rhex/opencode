import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import { RemoteSession } from "../../../remote/session"
import * as prompts from "@clack/prompts"

export const RemoteStatusCommand = cmd({
  command: "status <target>",
  describe: "show remote session status",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to check",
        demandOption: true,
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      })
      .option("id", {
        type: "string",
        describe: "specific session ID to check",
      }),
  handler: async (args) => {
    const { username, host, port } = SSH.parseTarget(args.target)
    const sshOpts: SSH.ConnectOptions = {
      host,
      username,
      port,
      identity: args.identity,
    }

    prompts.intro(`Sessions on ${args.target}`)

    const spinner = prompts.spinner()
    spinner.start("Fetching sessions...")

    try {
      const runDir = RemoteSession.runDir()
      const pattern = args.id ? RemoteSession.metadataPath(args.id) : `${runDir}/*.json`

      const files = await SSH.glob(sshOpts, pattern)

      if (files.length === 0) {
        spinner.stop("No sessions found")
        prompts.outro("Done")
        return
      }

      const sessions: Array<RemoteSession.Metadata & { running: boolean }> = []

      for (const file of files) {
        try {
          const content = await SSH.readFile(sshOpts, file)
          const meta = RemoteSession.parseMetadata(content)
          const running = await SSH.isProcessRunning(sshOpts, meta.pid)
          sessions.push({ ...meta, running })
        } catch {}
      }

      spinner.stop(`Found ${sessions.length} session(s)`)

      console.log()
      console.log(
        padRight("ID", 20) +
          padRight("REPO", 35) +
          padRight("REF", 15) +
          padRight("PORT", 8) +
          padRight("STATUS", 10) +
          "STARTED",
      )
      console.log("-".repeat(100))

      for (const session of sessions) {
        const repoShort = session.repo.replace(/^https?:\/\//, "").replace(/\.git$/, "")
        const status = session.running ? "\x1b[32mrunning\x1b[0m" : "\x1b[31mstopped\x1b[0m"
        const started = new Date(session.startedAt).toLocaleString()

        console.log(
          padRight(session.id, 20) +
            padRight(truncate(repoShort, 33), 35) +
            padRight(truncate(session.ref, 13), 15) +
            padRight(String(session.port), 8) +
            padRight(status, 19) +
            started,
        )
      }

      console.log()
      prompts.outro("Done")
    } catch (err) {
      spinner.stop("Failed to fetch sessions")
      prompts.log.error(String(err))
      process.exit(1)
    }
  },
})

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length)
}

function truncate(str: string, len: number): string {
  return str.length <= len ? str : str.slice(0, len - 2) + ".."
}
