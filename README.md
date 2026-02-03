# opencode-remote

A fork of [OpenCode](https://github.com/anomalyco/opencode) with built-in remote SSH development and GitHub Copilot as the sole provider.

Develop on remote servers through SSH while running the TUI locally. All file operations, tool execution, bash sessions, and MCP servers work transparently over SSH.

---

## Install

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/t-rhex/opencode/dev/install.sh | bash

# Or with options
OPENCODE_REMOTE_VERSION=v0.1.0-remote.2 curl -fsSL https://raw.githubusercontent.com/t-rhex/opencode/dev/install.sh | bash

# Custom install directory
OPENCODE_REMOTE_INSTALL=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/t-rhex/opencode/dev/install.sh | bash
```

### Manual install

Download the binary for your platform from [releases](https://github.com/t-rhex/opencode/releases), extract, and place it in your PATH:

```bash
# macOS (Apple Silicon)
curl -fsSL https://github.com/t-rhex/opencode/releases/download/v0.1.0-remote.2/dist-opencode-darwin-arm64.zip -o opencode-remote.zip
unzip opencode-remote.zip
chmod +x opencode-remote
mv opencode-remote ~/.local/bin/

# macOS (Intel)
curl -fsSL https://github.com/t-rhex/opencode/releases/download/v0.1.0-remote.2/dist-opencode-darwin-x64.zip -o opencode-remote.zip
unzip opencode-remote.zip
chmod +x opencode-remote
mv opencode-remote ~/.local/bin/

# Linux (x64)
curl -fsSL https://github.com/t-rhex/opencode/releases/download/v0.1.0-remote.2/dist-opencode-linux-x64.tar.gz | tar xz
chmod +x opencode-remote
mv opencode-remote ~/.local/bin/

# Linux (arm64)
curl -fsSL https://github.com/t-rhex/opencode/releases/download/v0.1.0-remote.2/dist-opencode-linux-arm64.tar.gz | tar xz
chmod +x opencode-remote
mv opencode-remote ~/.local/bin/

# Linux (musl/Alpine)
curl -fsSL https://github.com/t-rhex/opencode/releases/download/v0.1.0-remote.2/dist-opencode-linux-x64-musl.tar.gz | tar xz
chmod +x opencode-remote
mv opencode-remote ~/.local/bin/
```

### Platforms

| Platform | Architecture  | Asset                                   |
| -------- | ------------- | --------------------------------------- |
| macOS    | Apple Silicon | `dist-opencode-darwin-arm64.zip`        |
| macOS    | Intel         | `dist-opencode-darwin-x64.zip`          |
| Linux    | x64 (glibc)   | `dist-opencode-linux-x64.tar.gz`        |
| Linux    | arm64 (glibc) | `dist-opencode-linux-arm64.tar.gz`      |
| Linux    | x64 (musl)    | `dist-opencode-linux-x64-musl.tar.gz`   |
| Linux    | arm64 (musl)  | `dist-opencode-linux-arm64-musl.tar.gz` |
| Windows  | x64           | `dist-opencode-windows-x64.zip`         |

Baseline variants (no AVX2) are also available for older CPUs.

---

## Quick Start

```bash
# Start locally
opencode-remote

# Connect to remote on startup
opencode-remote --remote user@host

# Connect with SSH key
opencode-remote --remote user@host -i ~/.ssh/id_ed25519

# Connect using a saved profile
opencode-remote --remote my-server

# Forward a port
opencode-remote --remote user@host -L 3000
```

### Connect from inside the TUI

```
/remote user@host           # quick-connect
/remote my-profile          # connect using a saved profile
/remote                     # open connection dialog
```

The `/remote` dialog shows saved profiles, lets you add servers, manage port forwards, and disconnect.

---

## Configuration

Config lives at `~/.config/opencode-remote/config.json` (project-level: `opencode-remote.json`).

### Connection Profiles

```json
{
  "remote": {
    "profiles": {
      "dev-box": {
        "host": "10.0.1.50",
        "username": "dev",
        "port": 22,
        "identity": "~/.ssh/id_ed25519",
        "remoteDir": "/home/dev/projects/myapp",
        "agentForward": true,
        "env": {
          "NODE_ENV": "development"
        },
        "setupCommand": "source ~/.nvm/nvm.sh",
        "keepaliveInterval": 30000,
        "keepaliveCountMax": 3,
        "hostKeyCheck": false
      },
      "staging": {
        "host": "staging.example.com",
        "username": "deploy",
        "remoteDir": "/opt/app",
        "agentForward": true
      }
    },
    "hostKeyCheck": true
  }
}
```

### Profile Options

| Field               | Type    | Default  | Description                                 |
| ------------------- | ------- | -------- | ------------------------------------------- |
| `host`              | string  | required | SSH hostname or IP                          |
| `username`          | string  | `$USER`  | SSH username                                |
| `port`              | number  | `22`     | SSH port                                    |
| `identity`          | string  |          | Path to SSH private key                     |
| `remoteDir`         | string  | `~`      | Working directory on remote                 |
| `agentForward`      | boolean | `false`  | Forward local SSH agent (for git on remote) |
| `env`               | object  |          | Environment variables to set on remote      |
| `setupCommand`      | string  |          | Shell command to run after connecting       |
| `keepaliveInterval` | number  | `30000`  | Keepalive interval (ms)                     |
| `keepaliveCountMax` | number  | `3`      | Max missed keepalives before reconnect      |
| `hostKeyCheck`      | boolean | `true`   | Verify SSH host keys                        |

SSH config (`~/.ssh/config`) is automatically read. ProxyJump is supported.

---

## CLI Flags

| Flag                    | Alias | Description                                                 |
| ----------------------- | ----- | ----------------------------------------------------------- |
| `--remote <target>`     |       | Connect to `user@host`, `user@host:port`, or a profile name |
| `--identity <path>`     | `-i`  | Path to SSH private key                                     |
| `--ssh-port <n>`        | `-p`  | SSH port                                                    |
| `--remote-dir <path>`   |       | Working directory on the remote                             |
| `--forward-port <spec>` | `-L`  | Forward port (`3000` or `3000:8080`)                        |
| `--model <id>`          | `-m`  | Model in `provider/model` format                            |
| `--agent <name>`        |       | Agent to use (`build` or `plan`)                            |
| `--continue`            | `-c`  | Resume last session                                         |
| `--prompt <text>`       |       | Start with a prompt                                         |

---

## Remote Features

### Filesystem Abstraction

All file operations go through an abstraction layer (`IFilesystem`). When connected to a remote, reads, writes, globs, and stats happen over SSH/SFTP transparently. Tools like `read`, `write`, `edit`, `glob`, `grep`, and `bash` all work on the remote filesystem.

### MCP over SSH

MCP servers defined in your config are launched on the remote host via SSH exec channels. No separate tunnel or port forwarding needed.

### Remote Diagnostics

The connection header shows latency, disk, memory, and load metrics from the remote host.

### Port Forwarding

Forward local ports to the remote via the CLI (`-L`) or the `/remote` dialog ("Forward port..."). Tunnels use SSH2 `forwardOut` — no external `ssh` binary needed when using the dialog.

### SSH Agent Forwarding

Enable `agentForward: true` in a profile to forward your local SSH agent. This lets git on the remote authenticate using your local SSH keys without copying them.

### Connection Persistence

The TUI remembers your last connected host. On next startup, it shows a toast with the target so you can quickly reconnect with `/remote <target>`.

### Auto-Reconnection

If the SSH connection drops, the client automatically attempts exponential-backoff reconnection (up to 10 attempts). The header shows reconnection status.

---

## Namespace

This fork uses `opencode-remote` as its namespace to coexist with upstream OpenCode:

|                | Upstream                   | This fork                         |
| -------------- | -------------------------- | --------------------------------- |
| Binary         | `opencode`                 | `opencode-remote`                 |
| Config dir     | `~/.config/opencode/`      | `~/.config/opencode-remote/`      |
| Data dir       | `~/.local/share/opencode/` | `~/.local/share/opencode-remote/` |
| Project config | `opencode.json`            | `opencode-remote.json`            |
| Project dir    | `.opencode/`               | `.opencode-remote/`               |

Environment variables (`OPENCODE_*`) are shared for compatibility.

---

## Provider

This fork is configured for **GitHub Copilot** only. It proxies Claude, GPT, and Gemini models through Copilot's API. No API keys needed — authenticate with your GitHub account:

```bash
opencode-remote
# On first run, /connect will open and guide you through GitHub Copilot auth
```

---

## Agents

Two built-in agents, switchable with `Tab`:

- **build** - Full access. Reads, writes, and runs commands.
- **plan** - Read-only. Explores code and plans changes without modifying anything.

Use `@general` in messages to invoke the general subagent for complex multi-step searches.

---

## Slash Commands

| Command            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `/remote [target]` | Connect to remote or open connection dialog             |
| `/remote`          | Open remote connection dialog (profiles, port forwards) |
| `/models`          | Switch model                                            |
| `/agents`          | Switch agent                                            |
| `/sessions`        | Switch session                                          |
| `/new`             | New session                                             |
| `/connect`         | Connect provider                                        |
| `/mcps`            | Toggle MCP servers                                      |
| `/status`          | View system status                                      |
| `/themes`          | Switch theme                                            |
| `/skills`          | Browse skills                                           |
| `/editor`          | Open prompt in `$EDITOR`                                |
| `/help`            | Show help                                               |
| `/exit`            | Exit                                                    |

---

## Building from Source

```bash
git clone https://github.com/t-rhex/opencode.git
cd opencode
bun install

# Build for current platform
cd packages/opencode
bun run build --single --skip-install

# Binary at:
./dist/opencode-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/bin/opencode-remote

# Build all platforms
bun run build --skip-install

# Typecheck
bun run typecheck
```

---

## Architecture

```
opencode-remote (TUI)
  |
  |-- Worker thread (server + tools + LLM)
  |     |
  |     |-- Hono HTTP server (/session, /remote, /provider, ...)
  |     |-- IFilesystem (LocalFilesystem | RemoteFilesystem)
  |     |-- SSH2 client (SFTP, exec, PTY, agent forwarding)
  |     |-- MCP servers (local stdio | SSH transport)
  |     |-- GitHub Copilot provider (via AI SDK)
  |     |-- Port forward tunnels (net.Server + SSH forwardOut)
  |
  |-- TUI thread (SolidJS + OpenTUI)
        |-- Prompt, dialogs, session views
        |-- /remote dialog (connect, disconnect, port forward)
        |-- Connection status header
```

---

## License

MIT - same as upstream [OpenCode](https://github.com/anomalyco/opencode).
