import { cmd } from "../cmd"
import { SSH } from "../../../remote/ssh"
import * as prompts from "@clack/prompts"
import { Client } from "ssh2"
import { createReadStream, statSync, readFileSync } from "fs"
import { basename, join } from "path"
import { homedir } from "os"

export const RemoteUploadCommand = cmd({
  command: "upload <target> <local> [remote]",
  describe: "upload a file to remote host",
  builder: (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "user@host to upload to",
        demandOption: true,
      })
      .positional("local", {
        type: "string",
        describe: "local file path",
        demandOption: true,
      })
      .positional("remote", {
        type: "string",
        describe: "remote destination path (defaults to home directory)",
      })
      .option("identity", {
        alias: "i",
        type: "string",
        describe: "path to SSH private key",
      }),
  handler: async (args) => {
    const parsed = SSH.parseTarget(args.target)
    const src = args.local
    const dest = args.remote || `~/${basename(src)}`

    const stat = statSync(src)
    prompts.intro(`Uploading ${basename(src)} (${formatSize(stat.size)})`)

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
        spinner.start("Uploading...")

        client.sftp((err, sftp) => {
          if (err) {
            client.end()
            return reject(err)
          }

          const reader = createReadStream(src)
          const writer = sftp.createWriteStream(dest)

          writer.on("close", () => {
            spinner.stop(`Uploaded to ${dest}`)
            client.end()
            resolve()
          })

          writer.on("error", (err: Error) => {
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
}
