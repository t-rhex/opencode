import { cmd } from "../cmd"
import { RemoteConnectCommand } from "./connect"
import { RemoteDownloadCommand } from "./download"
import { RemoteInstallCommand } from "./install"
import { RemoteStartCommand } from "./start"
import { RemoteStatusCommand } from "./status"
import { RemoteStopCommand } from "./stop"
import { RemoteUploadCommand } from "./upload"

export const RemoteCommand = cmd({
  command: "remote",
  describe: "manage remote opencode sessions via SSH",
  builder: (yargs) =>
    yargs
      .command(RemoteInstallCommand)
      .command(RemoteStartCommand)
      .command(RemoteConnectCommand)
      .command(RemoteStopCommand)
      .command(RemoteStatusCommand)
      .command(RemoteUploadCommand)
      .command(RemoteDownloadCommand)
      .demandCommand()
      .epilog(
        `Connection profiles can be configured in ~/.config/opencode-remote/config.json:

  {
    "remote": {
      "default": "myserver",
      "profiles": {
        "myserver": {
          "host": "10.0.0.1",
          "username": "deploy",
          "port": 22,
          "identity": "~/.ssh/id_ed25519",
          "remoteDir": "/home/deploy/project"
        }
      }
    }
  }

Then use: opencode --remote myserver`,
      ),
  async handler() {},
})
