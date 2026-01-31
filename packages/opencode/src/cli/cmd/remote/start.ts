import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import { RemoteSession } from "../../../remote/session"
import * as prompts from "@clack/prompts"

export const RemoteStartCommand = cmd({
  command: "start <target>",
  describe: "start opencode server on remote host",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to start on",
        demandOption: true,
      })
      .option("repo", {
        type: "string",
        describe: "git repository URL to clone",
        demandOption: true,
      })
      .option("ref", {
        type: "string",
        describe: "git ref (branch, tag, or SHA) to checkout",
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

    const sessionId = RemoteSession.generateId()
    prompts.intro(`Starting session ${sessionId} on ${args.target}`)

    const spinner = prompts.spinner()

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
      spinner.start("Creating workspace...")
      const workspacePath = RemoteSession.workspacePath(sessionId)
      await SSH.mkdir(sshOpts, workspacePath)
      spinner.stop("Workspace created")

      spinner.start("Cloning repository...")
      repoPath = RemoteSession.repoPath(sessionId)
      try {
        await SSH.exec(sshOpts, `git clone ${args.repo} ${repoPath}`)
        spinner.stop("Repository cloned")
      } catch (err) {
        spinner.stop("Clone failed")
        prompts.log.error(String(err))
        process.exit(1)
      }

      spinner.start(`Checking out ${args.ref}...`)
      try {
        await SSH.exec(sshOpts, `cd ${repoPath} && git fetch --all && git checkout ${args.ref}`)
        spinner.stop(`Checked out ${args.ref}`)
      } catch (err) {
        spinner.stop("Checkout failed")
        prompts.log.error(String(err))
        process.exit(1)
      }
    }

    spinner.start("Getting commit SHA...")
    const sha = (await SSH.exec(sshOpts, `cd ${repoPath} && git rev-parse HEAD`)).trim()
    spinner.stop(`SHA: ${sha.slice(0, 8)}`)

    spinner.start("Starting opencode server...")
    const binPath = RemoteSession.binPath()
    const logPath = RemoteSession.logPath(sessionId)

    const serverCmd = `cd ${repoPath} && ${binPath} serve --port 0 --hostname 127.0.0.1`
    const pid = await SSH.execBackground(sshOpts, serverCmd, logPath)
    spinner.stop(`Server started (PID: ${pid})`)

    spinner.start("Waiting for server to be ready...")
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
      spinner.stop("Failed to detect server port")
      prompts.log.error("Server may have failed to start. Check logs:")
      prompts.log.info(`ssh ${args.target} 'cat ${logPath}'`)
      process.exit(1)
    }
    spinner.stop(`Server listening on port ${remotePort}`)

    spinner.start("Writing session metadata...")
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
    spinner.stop("Metadata saved")

    prompts.log.success(`Session ${sessionId} started`)
    prompts.log.info(`Remote port: ${remotePort}`)
    prompts.log.info(`To connect: opencode remote connect ${args.target} --repo ${args.repo} --ref ${args.ref}`)
    prompts.outro("Done")
  },
})
