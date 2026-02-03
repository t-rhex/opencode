import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import * as prompts from "@clack/prompts"
import { Client } from "ssh2"
import { createWriteStream, readFileSync } from "fs"
import { basename, join } from "path"
import { homedir } from "os"

export const RemoteDownloadCommand = cmd({
  command: "download <target> <remote> [local]",
  describe: "download a file from remote host",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to download from",
        demandOption: true,
      })
      .positional("remote", {
        type: "string",
        describe: "remote file path",
        demandOption: true,
      })
      .positional("local", {
        type: "string",
        describe: "local destination path (defaults to current directory)",
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      }),
  handler: async (args) => {
    const parsed = SSH.parseTarget(args.target)
    const src = args.remote
    const dest = args.local || join(process.cwd(), basename(src))

    prompts.intro(`Downloading ${basename(src)}`)

    const spinner = prompts.spinner()
    spinner.start("Connecting...")

    const client = new Client()
    const config: Record<string, unknown> = {
      host: parsed.host,
      username: parsed.username,
      port: parsed.port ?? 22,
    }

    if (args.identity) {
      const path = args.identity.startsWith("~") ? join(homedir(), args.identity.slice(1)) : args.identity
      config.privateKey = readFileSync(path)
    } else {
      config.agent = process.env.SSH_AUTH_SOCK
    }

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => {
        spinner.stop("Connected")
        spinner.start("Downloading...")

        client.sftp((err, sftp) => {
          if (err) {
            client.end()
            return reject(err)
          }

          const reader = sftp.createReadStream(src)
          const writer = createWriteStream(dest)

          writer.on("close", () => {
            spinner.stop(`Downloaded to ${dest}`)
            client.end()
            resolve()
          })

          reader.on("error", (err: Error) => {
            client.end()
            reject(err)
          })

          writer.on("error", (err) => {
            client.end()
            reject(err)
          })

          reader.pipe(writer)
        })
      })

      client.on("error", reject)
      client.connect(config)
    })

    prompts.outro("Done")
  },
})
