# OpenCode Remote SSH - Implementation Plan

## Overview

| Aspect               | Details                     |
| -------------------- | --------------------------- |
| **Feature**          | Remote development over SSH |
| **Total Tasks**      | 10                          |
| **Parallel Waves**   | 4                           |
| **Estimated Effort** | Large (multi-day)           |
| **Dependencies**     | `ssh2`, `@types/ssh2`       |

## Execution Graph

```
Wave 1 (Parallel - No Dependencies)
├── Task 1: Add ssh2 dependency
└── Task 3: Session ID/metadata utilities

Wave 2 (Parallel - Depends on Wave 1)
├── Task 2: SSH connection utilities (depends on Task 1)
├── Task 4: remote install command (depends on Task 1, 2)
└── Task 5: remote status command (depends on Task 3)

Wave 3 (Parallel - Depends on Wave 2)
├── Task 6: remote start command (depends on Task 2, 3, 4)
├── Task 7: remote stop command (depends on Task 2, 3)
└── Task 8: remote connect command (depends on Task 6)

Wave 4 (Sequential - Depends on Wave 3)
├── Task 9: Register in CLI (depends on all commands)
└── Task 10: Integration testing (depends on Task 9)
```

---

## Task Details

### Task 1: Add ssh2 dependency

**Category**: `quick`  
**Skills**: `[]`  
**Wave**: 1  
**Dependencies**: None

**Actions**:

```bash
cd packages/opencode && bun add ssh2 && bun add -d @types/ssh2
```

**Verification**:

- [ ] `ssh2` in package.json dependencies
- [ ] `@types/ssh2` in package.json devDependencies
- [ ] `bun install` succeeds
- [ ] TypeScript can import: `import { Client } from 'ssh2'`

---

### Task 2: SSH connection utilities

**Category**: `ultrabrain`  
**Skills**: `[]`  
**Wave**: 2  
**Dependencies**: Task 1

**File**: `packages/opencode/src/cli/cmd/remote/ssh.ts`

**Interface**:

```typescript
export namespace SSH {
  interface ConnectOptions {
    host: string
    username: string
    identity?: string // path to private key
    password?: string
    agent?: string // SSH_AUTH_SOCK
  }

  // Execute command, return stdout
  function exec(opts: ConnectOptions, command: string): Promise<string>

  // Execute command in background, return pid
  function execBackground(opts: ConnectOptions, command: string, logFile: string): Promise<number>

  // Upload file via SFTP
  function upload(opts: ConnectOptions, localPath: string, remotePath: string): Promise<void>

  // Check if remote path exists
  function exists(opts: ConnectOptions, remotePath: string): Promise<boolean>

  // Read remote file
  function readFile(opts: ConnectOptions, remotePath: string): Promise<string>

  // Write remote file
  function writeFile(opts: ConnectOptions, remotePath: string, content: string): Promise<void>

  // Parse user@host string
  function parseTarget(target: string): { username: string; host: string }
}
```

**Verification**:

- [ ] Unit tests pass for `parseTarget`
- [ ] Can connect to localhost with agent auth (if available)
- [ ] `bun run typecheck` passes

---

### Task 3: Session ID/metadata utilities

**Category**: `quick`  
**Skills**: `[]`  
**Wave**: 1  
**Dependencies**: None

**File**: `packages/opencode/src/cli/cmd/remote/session.ts`

**Interface**:

```typescript
export namespace RemoteSession {
  interface Metadata {
    id: string
    pid: number
    port: number
    repo: string
    ref: string
    sha: string
    path: string
    startedAt: string // ISO 8601
  }

  // Generate session ID: yyyyMMddHHmm-xxxxxx
  function generateId(): string

  // Remote paths
  function binPath(): string // ~/.opencode-remote/bin/opencode
  function workspacePath(id: string): string // ~/.opencode-remote/workspaces/<id>
  function metadataPath(id: string): string // ~/.opencode-remote/run/<id>.json
  function logPath(id: string): string // ~/.opencode-remote/logs/<id>.log

  // Parse/serialize metadata
  function parseMetadata(json: string): Metadata
  function serializeMetadata(meta: Metadata): string
}
```

**Verification**:

- [ ] `generateId()` returns format `yyyyMMddHHmm-xxxxxx`
- [ ] All path functions return expected prefixes
- [ ] Metadata round-trips through parse/serialize
- [ ] Unit tests pass

---

### Task 4: `remote install` command

**Category**: `unspecified-high`  
**Skills**: `[]`  
**Wave**: 2  
**Dependencies**: Task 1, Task 2

**File**: `packages/opencode/src/cli/cmd/remote/install.ts`

**CLI**:

```
opencode remote install <user@host> [--identity <path>] [--force]
```

**Logic**:

1. Parse `user@host` using `SSH.parseTarget()`
2. Check if `~/.opencode-remote/bin/opencode` exists via `SSH.exists()`
3. If exists and not `--force`: get version, compare with local, skip if same
4. Run install script:
   ```bash
   curl -fsSL https://opencode.ai/install | OPENCODE_INSTALL_DIR=~/.opencode-remote/bin bash
   ```
5. Verify: `~/.opencode-remote/bin/opencode --version`

**Verification**:

- [ ] Command registered and shows in `opencode remote --help`
- [ ] Fails gracefully on SSH connection error
- [ ] Idempotent: running twice doesn't break anything
- [ ] `--force` reinstalls even if version matches

---

### Task 5: `remote status` command

**Category**: `unspecified-high`  
**Skills**: `[]`  
**Wave**: 2  
**Dependencies**: Task 2, Task 3

**File**: `packages/opencode/src/cli/cmd/remote/status.ts`

**CLI**:

```
opencode remote status <user@host> [--id <sessionId>]
```

**Logic**:

1. SSH: List `~/.opencode-remote/run/*.json`
2. For each (or specific `--id`):
   - Parse metadata
   - Check if pid is running: `kill -0 <pid>`
   - Display table: id | repo | ref | port | status | started

**Output Format**:

```
ID                  REPO                        REF      PORT   STATUS   STARTED
202601311930-a3f91c github.com/user/repo.git    main     42613  running  2026-01-31T19:30:00Z
202601311845-b2e82d github.com/user/other.git   dev      38721  stopped  2026-01-31T18:45:00Z
```

**Verification**:

- [ ] Shows "No sessions found" when empty
- [ ] Correctly identifies running vs stopped
- [ ] `--id` filters to single session

---

### Task 6: `remote start` command

**Category**: `ultrabrain`  
**Skills**: `[]`  
**Wave**: 3  
**Dependencies**: Task 2, Task 3, Task 4

**File**: `packages/opencode/src/cli/cmd/remote/start.ts`

**CLI**:

```
opencode remote start <user@host> --repo <url> --ref <branch|sha> [--workdir <path>] [--identity <path>]
```

**Logic**:

1. Generate session ID
2. SSH: Create dirs:
   ```bash
   mkdir -p ~/.opencode-remote/{workspaces/<id>,run,logs}
   ```
3. If `--workdir`: validate exists, use as repo path
4. Else: Clone repo:
   ```bash
   cd ~/.opencode-remote/workspaces/<id>
   git clone <repo> repo
   cd repo && git fetch --all && git checkout <ref>
   ```
5. Get SHA: `git rev-parse HEAD`
6. Start server (capture port from stdout):
   ```bash
   cd <repo_path>
   ~/.opencode-remote/bin/opencode serve --port 0 --hostname 127.0.0.1 2>&1 | tee ~/.opencode-remote/logs/<id>.log &
   echo $!
   ```
7. Parse port from log: `grep "listening on" ~/.opencode-remote/logs/<id>.log`
8. Write metadata to `~/.opencode-remote/run/<id>.json`
9. Output: session ID and port

**Verification**:

- [ ] Server starts and port is captured
- [ ] Metadata file is written correctly
- [ ] `remote status` shows the new session as running
- [ ] Clone works with HTTPS and SSH repo URLs

---

### Task 7: `remote stop` command

**Category**: `unspecified-high`  
**Skills**: `[]`  
**Wave**: 3  
**Dependencies**: Task 2, Task 3

**File**: `packages/opencode/src/cli/cmd/remote/stop.ts`

**CLI**:

```
opencode remote stop <user@host> --id <sessionId> [--cleanup]
```

**Logic**:

1. SSH: Read `~/.opencode-remote/run/<id>.json`
2. SSH: `kill <pid>`, wait 2s, then `kill -9 <pid>` if still running
3. SSH: Remove metadata file
4. If `--cleanup`: Remove workspace directory

**Verification**:

- [ ] Process is killed
- [ ] Metadata file removed
- [ ] `--cleanup` removes workspace
- [ ] Graceful error if session not found

---

### Task 8: `remote connect` command

**Category**: `ultrabrain`  
**Skills**: `[]`  
**Wave**: 3  
**Dependencies**: Task 4, Task 6

**File**: `packages/opencode/src/cli/cmd/remote/connect.ts`

**CLI**:

```
opencode remote connect <user@host> --repo <url> --ref <branch|sha> [--workdir <path>] [--identity <path>]
```

**Logic**:

1. Run `install` (idempotent)
2. Run `start` to get session ID and remote port
3. Find free local port: try 4096, then random
4. Spawn SSH tunnel:
   ```bash
   ssh -N -L <localPort>:127.0.0.1:<remotePort> user@host
   ```
5. Poll TCP connect to `127.0.0.1:<localPort>` until ready (timeout 10s)
6. Run `opencode attach http://127.0.0.1:<localPort> --dir <repo_path>`
7. On TUI exit:
   - Kill tunnel process
   - Optionally: ask to stop remote session or leave running

**Verification**:

- [ ] Full flow works: install -> start -> tunnel -> attach
- [ ] Tunnel dies when TUI exits
- [ ] Tunnel failure shows clear error
- [ ] Ctrl+C cleanly kills tunnel

---

### Task 9: Register in CLI

**Category**: `quick`  
**Skills**: `[]`  
**Wave**: 4  
**Dependencies**: Tasks 4, 5, 6, 7, 8

**File**: `packages/opencode/src/cli/cmd/remote/index.ts` (create)  
**Modify**: `packages/opencode/src/index.ts`

**Logic**:

```typescript
// remote/index.ts
import { cmd } from "../cmd"
import { RemoteInstallCommand } from "./install"
import { RemoteStartCommand } from "./start"
import { RemoteConnectCommand } from "./connect"
import { RemoteStopCommand } from "./stop"
import { RemoteStatusCommand } from "./status"

export const RemoteCommand = cmd({
  command: "remote",
  describe: "manage remote development sessions",
  builder: (yargs) =>
    yargs
      .command(RemoteInstallCommand)
      .command(RemoteStartCommand)
      .command(RemoteConnectCommand)
      .command(RemoteStopCommand)
      .command(RemoteStatusCommand)
      .demandCommand(),
  handler: async () => {},
})
```

```typescript
// index.ts - add import and .command(RemoteCommand)
```

**Verification**:

- [ ] `opencode remote --help` shows all subcommands
- [ ] `opencode --help` shows `remote` command
- [ ] Each subcommand `--help` works

---

### Task 10: Integration testing

**Category**: `unspecified-high`  
**Skills**: `[]`  
**Wave**: 4  
**Dependencies**: Task 9

**Manual Testing Checklist** (requires SSH access to a test host):

- [ ] `opencode remote install user@testhost` - installs binary
- [ ] `opencode remote install user@testhost` - skips (already installed)
- [ ] `opencode remote install user@testhost --force` - reinstalls
- [ ] `opencode remote start user@testhost --repo https://github.com/octocat/Hello-World --ref master` - starts session
- [ ] `opencode remote status user@testhost` - shows running session
- [ ] `opencode remote connect user@testhost --repo https://github.com/octocat/Hello-World --ref master` - full flow
- [ ] Exit TUI with `q` - tunnel dies
- [ ] `opencode remote stop user@testhost --id <id>` - stops session
- [ ] `opencode remote status user@testhost` - shows stopped/no sessions

---

## File Structure

```
packages/opencode/src/cli/cmd/remote/
├── index.ts          # RemoteCommand aggregator
├── ssh.ts            # SSH utilities (ssh2 wrapper)
├── session.ts        # Session ID, paths, metadata
├── install.ts        # remote install
├── start.ts          # remote start
├── connect.ts        # remote connect
├── stop.ts           # remote stop
└── status.ts         # remote status

packages/opencode/test/cli/remote/
├── ssh.test.ts       # SSH utility unit tests
└── session.test.ts   # Session utility unit tests
```

---

## Risk Mitigation

| Risk                  | Mitigation                                 |
| --------------------- | ------------------------------------------ |
| SSH auth complexity   | Default to SSH agent, clear error messages |
| Port discovery race   | Retry loop with timeout when parsing log   |
| Tunnel process orphan | Register SIGINT/SIGTERM handlers           |
| Remote disk full      | Check disk space before clone              |
| Network interruption  | Tunnel auto-reconnect (future)             |

---

## Start Execution

Ready to begin implementation. Run `/start-work` or tell me to start with Wave 1.
