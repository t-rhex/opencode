import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import { RemoteSession } from "../../../remote/session"
import * as prompts from "@clack/prompts"

export const RemoteInstallCommand = cmd({
  command: "install <target>",
  describe: "install opencode on remote host",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to install on",
        demandOption: true,
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "reinstall even if already installed",
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

    prompts.intro(`Installing opencode on ${args.target}`)

    const spinner = prompts.spinner()
    spinner.start("Checking for existing installation...")
    const binPath = RemoteSession.binPath()
    const installed = await SSH.exists(sshOpts, binPath)

    if (installed && !args.force) {
      try {
        const version = await SSH.exec(sshOpts, `${binPath} --version`)
        spinner.stop(`Already installed: v${version.trim()}`)
        prompts.log.info("Use --force to reinstall")
        prompts.outro("Done")
        return
      } catch {
        // Version check failed, proceed with install
      }
    }

    spinner.start("Creating directories...")
    await SSH.mkdir(sshOpts, "~/.opencode-remote/bin")
    await SSH.mkdir(sshOpts, "~/.opencode-remote/run")
    await SSH.mkdir(sshOpts, "~/.opencode-remote/logs")
    await SSH.mkdir(sshOpts, "~/.opencode-remote/workspaces")
    spinner.stop("Directories created")

    spinner.start("Downloading and installing opencode...")
    try {
      // The install script installs to ~/.opencode/bin by default
      // Run install, then copy to our location
      await SSH.exec(sshOpts, `curl -fsSL https://opencode.ai/install | bash`)
      // Copy to our remote bin directory
      await SSH.exec(sshOpts, `cp ~/.opencode/bin/opencode ~/.opencode-remote/bin/opencode`)
      await SSH.exec(sshOpts, `chmod 755 ~/.opencode-remote/bin/opencode`)
      spinner.stop("Installation complete")
    } catch (err) {
      spinner.stop("Installation failed")
      prompts.log.error(String(err))
      process.exit(1)
    }

    spinner.start("Verifying installation...")
    try {
      const version = await SSH.exec(sshOpts, `${binPath} --version`)
      spinner.stop(`Installed: v${version.trim()}`)
    } catch (err) {
      spinner.stop("Verification failed")
      prompts.log.error(String(err))
      process.exit(1)
    }

    prompts.outro("Done")
  },
})
