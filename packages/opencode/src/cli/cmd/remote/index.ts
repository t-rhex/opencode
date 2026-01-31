import { cmd } from "../cmd"
import { RemoteConnectCommand } from "./connect"
import { RemoteInstallCommand } from "./install"
import { RemoteStartCommand } from "./start"
import { RemoteStatusCommand } from "./status"
import { RemoteStopCommand } from "./stop"

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
      .demandCommand(),
  async handler() {},
})
