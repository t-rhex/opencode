# Remote SSH Feature for Desktop App

## TL;DR

> **Quick Summary**: Port the CLI remote SSH feature to the Tauri Desktop app, enabling users to connect to remote machines via SSH tunnel and develop on remote filesystems - similar to VS Code Remote SSH.
>
> **Deliverables**:
>
> - Shared SSH/session module extracted from CLI for reuse
> - Tauri Rust commands for SSH operations (tunnel, exec, session management)
> - Remote connection dialog UI with multi-step flow
> - Menu item and command palette integration
> - Session management UI (list/stop remote sessions)
> - Platform capability extensions for remote connection
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (Extract Core) → Task 4 (Tauri Commands) → Task 7 (Connection Dialog) → Task 10 (Integration)

---

## Context

### Original Request

Port the remote SSH feature from CLI to Desktop App so users can connect to remote machines and develop there, similar to VS Code Remote SSH.

### Interview Summary

**Key Discussions**:

- CLI uses `ssh2` library for SSH commands + system `ssh` binary for port forwarding tunnels
- Desktop app uses Tauri v2 sidecar pattern - spawn server, connect via HTTP
- Cross-platform requirement: macOS, Windows (OpenSSH), Linux
- SSH key authentication only for MVP (no passwords)
- Need dialogs, menu items, command palette, session management

**Research Findings**:

- CLI `connect.ts` orchestrates: check install → clone repo → start server → tunnel → attach
- Desktop `lib.rs` manages sidecar lifecycle with `ServerState`, health checks
- `Server` context can switch active server URL - foundation for remote switching
- Existing dialog patterns (`dialog-select-server.tsx`) provide UI template
- System SSH binary available: macOS/Linux pre-installed, Windows 10+ has OpenSSH

### Gap Analysis (Self-Review)

**Identified Gaps** (addressed in plan):

- SSH binary detection needed for Windows compatibility → Task 4 includes cross-platform detection
- Tunnel process lifecycle management → Task 4 includes spawn/kill/monitor
- Remote server password handling → Reuse existing `ServerReadyData` pattern with password
- Connection state persistence across app restarts → Task 6 adds session persistence
- Error recovery UX → Task 7/8 include error states and retry logic

---

## Work Objectives

### Core Objective

Enable Desktop app users to connect to remote SSH hosts, run OpenCode server remotely, and work on remote codebases through an SSH tunnel - achieving feature parity with the CLI `remote connect` command.

### Concrete Deliverables

- `packages/opencode/src/remote/ssh.ts` - Extracted SSH primitives module
- `packages/opencode/src/remote/session.ts` - Extracted session management module
- `packages/desktop/src-tauri/src/remote.rs` - Tauri commands for SSH operations
- `packages/app/src/components/dialog-remote-connect.tsx` - Connection dialog
- `packages/app/src/components/dialog-remote-sessions.tsx` - Session list dialog
- `packages/app/src/context/remote.tsx` - Remote connection state management
- `packages/desktop/src/menu.ts` - Updated with "Connect to Remote" item
- `packages/app/src/context/platform.tsx` - Extended with remote capabilities
- i18n strings for all new UI text

### Definition of Done

- [ ] User can connect to remote via menu "Connect to Remote" or command palette
- [ ] Connection dialog collects: SSH target, repo URL, ref, SSH key path
- [ ] App installs OpenCode on remote if missing
- [ ] App clones repo and starts server on remote
- [ ] SSH tunnel established, app switches to remote server
- [ ] User can list and stop remote sessions
- [ ] Works on macOS, Windows 10+, and Linux
- [ ] Connection failures show user-friendly error messages

### Must Have

- SSH key authentication support
- Cross-platform SSH binary detection and usage
- Connection progress indicators
- Graceful error handling with retry option
- Session persistence (reconnect on app restart)

### Must NOT Have (Guardrails)

- Password authentication (MVP scope)
- SSH agent forwarding
- Multiple simultaneous remote connections
- Custom remote install directories
- SSH config file parsing (~/.ssh/config)
- Remote file browser before connection
- Auto-reconnect on network failure (manual retry only)
- Inline SSH key generation

---

## Verification Strategy (MANDATORY)

### Test Decision

- **Infrastructure exists**: YES (Playwright in packages/app)
- **User wants tests**: Manual verification (per user context - no explicit test request)
- **Framework**: Playwright for E2E, manual verification for SSH functionality
- **QA approach**: Automated Playwright tests for UI flows, manual SSH verification

### Automated Verification Approach

Each TODO includes executable verification procedures:

- **Frontend/UI**: Playwright browser automation
- **Tauri Commands**: Manual verification via dev tools invoke
- **SSH Operations**: Manual verification on test SSH host

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Extract SSH module from CLI to shared location
├── Task 2: Extract session module from CLI to shared location
└── Task 3: Add i18n strings for remote UI

Wave 2 (After Wave 1):
├── Task 4: Implement Tauri Rust commands for SSH operations
├── Task 5: Create remote context for frontend state management
└── Task 6: Add Platform capability extensions

Wave 3 (After Wave 2):
├── Task 7: Create remote connection dialog component
├── Task 8: Create remote sessions dialog component
└── Task 9: Add menu item and command palette entries

Wave 4 (After Wave 3):
└── Task 10: Integration testing and cross-platform verification

Critical Path: Task 1 → Task 4 → Task 7 → Task 10
Parallel Speedup: ~50% faster than sequential
```

### Dependency Matrix

| Task | Depends On | Blocks   | Can Parallelize With |
| ---- | ---------- | -------- | -------------------- |
| 1    | None       | 4, 5     | 2, 3                 |
| 2    | None       | 4, 5     | 1, 3                 |
| 3    | None       | 7, 8, 9  | 1, 2                 |
| 4    | 1, 2       | 7, 8, 10 | 5, 6                 |
| 5    | 1, 2       | 7, 8, 9  | 4, 6                 |
| 6    | None       | 7, 9     | 4, 5                 |
| 7    | 3, 4, 5, 6 | 10       | 8, 9                 |
| 8    | 3, 4, 5    | 10       | 7, 9                 |
| 9    | 3, 5, 6    | 10       | 7, 8                 |
| 10   | 7, 8, 9    | None     | None (final)         |

### Agent Dispatch Summary

| Wave | Tasks   | Recommended Agents                                                         |
| ---- | ------- | -------------------------------------------------------------------------- |
| 1    | 1, 2, 3 | 3x parallel: category="quick"                                              |
| 2    | 4, 5, 6 | 3x parallel: 4=category="ultrabrain", 5,6=category="quick"                 |
| 3    | 7, 8, 9 | 3x parallel: category="visual-engineering" for 7,8; category="quick" for 9 |
| 4    | 10      | 1x sequential: category="visual-engineering" with playwright skill         |

---

## TODOs

### Wave 1: Foundation

- [ ] 1. Extract SSH module from CLI to shared location

  **What to do**:
  - Move `packages/opencode/src/cli/cmd/remote/ssh.ts` to `packages/opencode/src/remote/ssh.ts`
  - Update the `SSH` namespace exports to be importable from both CLI and Desktop
  - Update CLI remote commands to import from new location
  - Ensure all SSH primitives are exported: `parseTarget`, `exec`, `execBackground`, `exists`, `isProcessRunning`, `readFile`, `writeFile`, `mkdir`, `rm`, `kill`, `glob`
  - Add JSDoc comments for public API

  **Must NOT do**:
  - Change SSH implementation logic
  - Add new SSH features
  - Modify the ssh2 dependency

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File reorganization task, straightforward refactoring
  - **Skills**: None required
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed for code moves, will commit at end

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:
  - `packages/opencode/src/cli/cmd/remote/ssh.ts` - Source file to extract (162 lines)
  - `packages/opencode/src/cli/cmd/remote/connect.ts:2` - Import to update
  - `packages/opencode/src/cli/cmd/remote/install.ts:2` - Import to update
  - `packages/opencode/src/cli/cmd/remote/start.ts:2` - Import to update
  - `packages/opencode/src/cli/cmd/remote/stop.ts:2` - Import to update
  - `packages/opencode/src/cli/cmd/remote/status.ts:2` - Import to update

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify file exists at new location
  test -f packages/opencode/src/remote/ssh.ts && echo "PASS: ssh.ts moved"

  # Verify old location still imports work (CLI should still function)
  bun run typecheck
  # Assert: Exit code 0, no type errors
  ```

  **Commit**: YES
  - Message: `refactor(remote): extract SSH module to shared location`
  - Files: `packages/opencode/src/remote/ssh.ts`, `packages/opencode/src/cli/cmd/remote/*.ts`
  - Pre-commit: `bun run typecheck`

---

- [ ] 2. Extract session module from CLI to shared location

  **What to do**:
  - Move `packages/opencode/src/cli/cmd/remote/session.ts` to `packages/opencode/src/remote/session.ts`
  - Update the `RemoteSession` namespace exports
  - Update CLI remote commands to import from new location
  - Ensure all session utilities are exported: `Metadata`, `generateId`, `binPath`, `workspacePath`, `repoPath`, `metadataPath`, `logPath`, `runDir`, `parseMetadata`, `serializeMetadata`

  **Must NOT do**:
  - Change session ID generation logic
  - Modify remote paths structure
  - Add new session features

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File reorganization task, straightforward refactoring
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:
  - `packages/opencode/src/cli/cmd/remote/session.ts` - Source file to extract (67 lines)
  - `packages/opencode/src/cli/cmd/remote/connect.ts:3` - Import to update
  - `packages/opencode/src/cli/cmd/remote/install.ts:3` - Import to update
  - `packages/opencode/src/cli/cmd/remote/start.ts:3` - Import to update
  - `packages/opencode/src/cli/cmd/remote/stop.ts:3` - Import to update
  - `packages/opencode/src/cli/cmd/remote/status.ts:3` - Import to update

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify file exists at new location
  test -f packages/opencode/src/remote/session.ts && echo "PASS: session.ts moved"

  # Verify typecheck passes
  bun run typecheck
  # Assert: Exit code 0
  ```

  **Commit**: YES
  - Message: `refactor(remote): extract session module to shared location`
  - Files: `packages/opencode/src/remote/session.ts`, `packages/opencode/src/cli/cmd/remote/*.ts`
  - Pre-commit: `bun run typecheck`

---

- [ ] 3. Add i18n strings for remote UI

  **What to do**:
  - Add English translations to `packages/app/src/i18n/en.ts` for:
    - `remote.connect.title`: "Connect to Remote"
    - `remote.connect.description`: "Connect to a remote machine via SSH"
    - `remote.connect.target.label`: "SSH Target"
    - `remote.connect.target.placeholder`: "user@hostname"
    - `remote.connect.repo.label`: "Repository URL"
    - `remote.connect.repo.placeholder`: "https://github.com/org/repo"
    - `remote.connect.ref.label`: "Branch or Tag"
    - `remote.connect.ref.placeholder`: "main"
    - `remote.connect.key.label`: "SSH Key Path (optional)"
    - `remote.connect.key.placeholder`: "~/.ssh/id_rsa"
    - `remote.connect.button`: "Connect"
    - `remote.connect.status.installing`: "Installing OpenCode on remote..."
    - `remote.connect.status.cloning`: "Cloning repository..."
    - `remote.connect.status.starting`: "Starting remote server..."
    - `remote.connect.status.tunneling`: "Establishing SSH tunnel..."
    - `remote.connect.status.connected`: "Connected to remote"
    - `remote.connect.error.connection`: "Failed to connect: {error}"
    - `remote.connect.error.install`: "Failed to install OpenCode on remote"
    - `remote.connect.error.tunnel`: "Failed to establish SSH tunnel"
    - `remote.sessions.title`: "Remote Sessions"
    - `remote.sessions.empty`: "No active remote sessions"
    - `remote.sessions.stop`: "Stop Session"
    - `remote.sessions.reconnect`: "Reconnect"
    - `remote.menu.connect`: "Connect to Remote..."
    - `remote.menu.sessions`: "Remote Sessions..."
  - Add corresponding keys to `packages/desktop/src/i18n/en.ts` for desktop-specific strings

  **Must NOT do**:
  - Add translations for other languages (follow-up task)
  - Change existing i18n structure
  - Add emoji or special characters

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple string additions to existing i18n files
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 7, 8, 9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `packages/app/src/i18n/en.ts` - App i18n file to extend
  - `packages/desktop/src/i18n/en.ts` - Desktop i18n file to extend
  - `packages/app/src/context/language.tsx` - How translations are accessed via `useLanguage().t()`

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify i18n keys exist
  grep -q "remote.connect.title" packages/app/src/i18n/en.ts && echo "PASS: remote keys added"

  # Verify typecheck passes
  bun run typecheck
  # Assert: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(i18n): add remote connection UI strings`
  - Files: `packages/app/src/i18n/en.ts`, `packages/desktop/src/i18n/en.ts`
  - Pre-commit: `bun run typecheck`

---

### Wave 2: Core Implementation

- [ ] 4. Implement Tauri Rust commands for SSH operations

  **What to do**:
  - Create `packages/desktop/src-tauri/src/remote.rs` module with:
    - `RemoteState` struct to track active tunnel process and session metadata
    - `#[tauri::command] async fn remote_connect(target, repo, ref, key_path)` - Full connection flow
    - `#[tauri::command] async fn remote_disconnect()` - Stop tunnel, cleanup
    - `#[tauri::command] async fn remote_list_sessions(target)` - List sessions on host
    - `#[tauri::command] async fn remote_stop_session(target, id)` - Stop specific session
    - Helper functions for SSH binary detection (cross-platform)
    - SSH tunnel spawn using `tauri_plugin_shell` with `-N -L` flags
    - Tunnel health monitoring
  - Register module in `lib.rs` and add commands to `invoke_handler`
  - Add shell plugin permissions for `ssh` binary in `capabilities/default.json`
  - Return `ServerReadyData` compatible struct for frontend consumption

  **Must NOT do**:
  - Implement password authentication
  - Parse SSH config files
  - Add SSH agent forwarding
  - Embed Rust SSH library (use system binary)

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Complex Rust implementation with async, process management, cross-platform considerations
  - **Skills**: None (Rust/Tauri expertise needed, no specific skill available)
  - **Skills Evaluated but Omitted**:
    - None applicable for Rust/Tauri

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Tasks 7, 8, 10
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `packages/desktop/src-tauri/src/lib.rs:157-207` - `spawn_sidecar` pattern for process management
  - `packages/desktop/src-tauri/src/lib.rs:39-59` - `ServerState` struct pattern
  - `packages/desktop/src-tauri/src/lib.rs:288-295` - Command registration pattern
  - `packages/opencode/src/cli/cmd/remote/connect.ts:147-174` - SSH tunnel spawn logic to port
  - `packages/desktop/src-tauri/capabilities/default.json` - Permissions configuration
  - `packages/opencode/src/remote/ssh.ts` - SSH primitives (from Task 1)
  - `packages/opencode/src/remote/session.ts` - Session types (from Task 2)

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify Rust compiles
  cd packages/desktop && cargo check
  # Assert: Exit code 0

  # Verify commands are registered (grep lib.rs)
  grep -q "remote_connect" packages/desktop/src-tauri/src/lib.rs && echo "PASS: command registered"
  ```

  **Manual Verification (requires SSH host):**

  ```
  1. Run desktop app in dev mode: bun run --cwd packages/desktop tauri dev
  2. Open DevTools console
  3. Execute: await window.__TAURI__.core.invoke('remote_connect', {target: 'user@host', repo: 'https://github.com/test/repo', ref: 'main'})
  4. Assert: Returns ServerReadyData with url and password
  ```

  **Commit**: YES
  - Message: `feat(desktop): add Tauri commands for remote SSH operations`
  - Files: `packages/desktop/src-tauri/src/remote.rs`, `packages/desktop/src-tauri/src/lib.rs`, `packages/desktop/src-tauri/capabilities/default.json`
  - Pre-commit: `cd packages/desktop && cargo check`

---

- [ ] 5. Create remote context for frontend state management

  **What to do**:
  - Create `packages/app/src/context/remote.tsx` with:
    - `RemoteState` type: `{ status, session, error, tunnel }`
    - `useRemote()` hook providing:
      - `status`: 'disconnected' | 'connecting' | 'connected' | 'error'
      - `session`: Current session metadata (id, target, repo, ref)
      - `error`: Error message if connection failed
      - `connect(opts)`: Initiate connection (calls Tauri command)
      - `disconnect()`: Terminate connection
      - `isRemote`: Boolean indicating remote connection active
    - Persist session info for reconnection on app restart
    - Integrate with `Server` context to switch active URL on connect
  - Export `RemoteProvider` to wrap app

  **Must NOT do**:
  - Implement SSH logic in frontend (Tauri handles it)
  - Store SSH keys or sensitive data
  - Auto-reconnect on failure

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: SolidJS context following established patterns
  - **Skills**: None required (follows existing context patterns)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: Tasks 7, 8, 9
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `packages/app/src/context/server.tsx` - Server context pattern to follow
  - `packages/app/src/context/platform.tsx` - Platform context pattern
  - `packages/opencode/src/remote/session.ts` - Session types to match
  - `packages/app/src/utils/persist.ts` - Persistence utilities

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify file created
  test -f packages/app/src/context/remote.tsx && echo "PASS: remote context created"

  # Verify typecheck passes
  bun run typecheck
  # Assert: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(app): add remote connection context`
  - Files: `packages/app/src/context/remote.tsx`
  - Pre-commit: `bun run typecheck`

---

- [ ] 6. Add Platform capability extensions for remote

  **What to do**:
  - Extend `Platform` interface in `packages/app/src/context/platform.tsx` with:
    - `remoteConnect?(opts: RemoteConnectOptions): Promise<ServerReadyData>`
    - `remoteDisconnect?(): Promise<void>`
    - `remoteListSessions?(target: string): Promise<RemoteSession[]>`
    - `remoteStopSession?(target: string, id: string): Promise<void>`
    - `canRemote?: boolean` - Feature flag for remote capability
  - Implement these in `packages/desktop/src/index.tsx` using Tauri invoke
  - Leave as undefined for web platform (feature not available)

  **Must NOT do**:
  - Implement actual SSH logic in Platform (delegates to Tauri)
  - Add web fallback for remote features
  - Change existing Platform methods

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Interface extension and Tauri invoke wrappers
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Tasks 7, 9
  - **Blocked By**: None (can start immediately, but needs Task 4 for runtime)

  **References**:
  - `packages/app/src/context/platform.tsx:4-58` - Platform interface to extend
  - `packages/desktop/src/index.tsx:62-349` - Desktop platform implementation
  - `packages/desktop/src/index.tsx:337-344` - Example of Tauri invoke pattern

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify interface extended
  grep -q "remoteConnect" packages/app/src/context/platform.tsx && echo "PASS: Platform extended"

  # Verify desktop implementation
  grep -q "remoteConnect" packages/desktop/src/index.tsx && echo "PASS: Desktop implements remote"

  # Verify typecheck passes
  bun run typecheck
  # Assert: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(platform): add remote connection capabilities`
  - Files: `packages/app/src/context/platform.tsx`, `packages/desktop/src/index.tsx`
  - Pre-commit: `bun run typecheck`

---

### Wave 3: UI Components

- [ ] 7. Create remote connection dialog component

  **What to do**:
  - Create `packages/app/src/components/dialog-remote-connect.tsx` with:
    - Multi-step wizard UI:
      1. Step 1: SSH target input (user@host:port format)
      2. Step 2: Repository URL and ref (branch/tag)
      3. Step 3: Optional SSH key path selection (use file picker)
      4. Step 4: Connection progress with status updates
    - Use `Dialog` component from `@opencode-ai/ui/dialog`
    - Use `TextField` for inputs with validation
    - Use `Button` for actions
    - Show `Spinner` during connection
    - Display errors with retry option
    - Call `platform.remoteConnect()` on submit
    - On success, close dialog (server context auto-switches)
  - Follow existing dialog patterns (see `dialog-connect-provider.tsx`)
  - Use `useLanguage().t()` for all text

  **Must NOT do**:
  - Implement SSH logic in component (use Platform)
  - Store credentials
  - Auto-fill from SSH config
  - Add password field

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex UI component with multi-step flow, state management
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Dialog wizard pattern, form validation, loading states

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 3, 4, 5, 6

  **References**:
  - `packages/app/src/components/dialog-connect-provider.tsx` - Multi-step dialog pattern
  - `packages/app/src/components/dialog-select-server.tsx` - Server connection dialog pattern
  - `packages/app/src/context/platform.tsx` - Platform hook usage
  - `@opencode-ai/ui/dialog` - Dialog component
  - `@opencode-ai/ui/text-field` - TextField component
  - `@opencode-ai/ui/button` - Button component
  - `@opencode-ai/ui/spinner` - Spinner component

  **Acceptance Criteria**:

  **Automated Verification (Playwright):**

  ```
  # Agent executes via playwright browser automation:
  1. Navigate to: http://localhost:3000
  2. Open command palette (Cmd+Shift+P)
  3. Search for "Connect to Remote"
  4. Click the result
  5. Assert: Dialog opens with title "Connect to Remote"
  6. Fill: input[name="target"] with "test@example.com"
  7. Click: "Next" button
  8. Assert: Step 2 visible with repository fields
  9. Screenshot: .sisyphus/evidence/task-7-dialog-flow.png
  ```

  **Commit**: YES
  - Message: `feat(app): add remote connection dialog`
  - Files: `packages/app/src/components/dialog-remote-connect.tsx`
  - Pre-commit: `bun run typecheck`

---

- [ ] 8. Create remote sessions dialog component

  **What to do**:
  - Create `packages/app/src/components/dialog-remote-sessions.tsx` with:
    - List of active remote sessions (fetched from remote host)
    - Each session shows: ID, repo, ref, port, status (running/stopped), started time
    - "Reconnect" button for running sessions
    - "Stop" button with confirmation
    - Empty state when no sessions
    - Use `List` component from `@opencode-ai/ui/list`
  - Integrate with remote context for session data
  - Follow existing dialog patterns

  **Must NOT do**:
  - Implement session management logic (use Platform)
  - Auto-refresh (manual refresh button only)
  - Support multiple hosts simultaneously

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: List UI with actions, similar complexity to dialog-select-server
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: List patterns, action buttons, status indicators

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 3, 4, 5

  **References**:
  - `packages/app/src/components/dialog-select-server.tsx` - List dialog pattern
  - `packages/opencode/src/cli/cmd/remote/status.ts` - Session display format
  - `@opencode-ai/ui/list` - List component
  - `@opencode-ai/ui/icon-button` - Action buttons

  **Acceptance Criteria**:

  **Automated Verification (Playwright):**

  ```
  # Agent executes via playwright browser automation:
  1. Navigate to: http://localhost:3000
  2. Open command palette
  3. Search for "Remote Sessions"
  4. Click the result
  5. Assert: Dialog opens with title "Remote Sessions"
  6. Assert: Empty state message visible OR session list visible
  7. Screenshot: .sisyphus/evidence/task-8-sessions-dialog.png
  ```

  **Commit**: YES
  - Message: `feat(app): add remote sessions dialog`
  - Files: `packages/app/src/components/dialog-remote-sessions.tsx`
  - Pre-commit: `bun run typecheck`

---

- [ ] 9. Add menu item and command palette entries

  **What to do**:
  - Update `packages/desktop/src/menu.ts`:
    - Add "Connect to Remote..." menu item under OpenCode menu (after "Install CLI")
    - Add "Remote Sessions..." menu item
    - Items should call `window.dispatchEvent(new CustomEvent('opencode:remote-connect'))` etc.
  - Register commands in a component that uses `useCommand().register()`:
    - ID: `remote.connect`, title: "Connect to Remote", keybind: `mod+shift+r`
    - ID: `remote.sessions`, title: "Remote Sessions"
  - Wire up commands to open respective dialogs via `useDialog().show()`
  - Only show commands when `platform.canRemote` is true

  **Must NOT do**:
  - Add Windows/Linux specific menu code (menu only on macOS)
  - Add keybinds that conflict with existing ones
  - Show remote commands in web version

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple menu and command registration
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 3, 5, 6

  **References**:
  - `packages/desktop/src/menu.ts` - Menu structure to extend
  - `packages/app/src/context/command.tsx:162-337` - Command registration pattern
  - `packages/app/src/pages/session.tsx` - Example of command registration with `useCommand().register()`
  - `@opencode-ai/ui/context/dialog` - Dialog show/close API

  **Acceptance Criteria**:

  **Automated Verification:**

  ```bash
  # Verify menu items added
  grep -q "Connect to Remote" packages/desktop/src/menu.ts && echo "PASS: Menu item added"

  # Verify typecheck passes
  bun run typecheck
  # Assert: Exit code 0
  ```

  **Playwright Verification:**

  ```
  # Agent executes:
  1. Navigate to: http://localhost:3000
  2. Press: Cmd+Shift+P (command palette)
  3. Type: "remote"
  4. Assert: "Connect to Remote" appears in results
  5. Assert: "Remote Sessions" appears in results
  6. Screenshot: .sisyphus/evidence/task-9-command-palette.png
  ```

  **Commit**: YES
  - Message: `feat(desktop): add remote menu items and commands`
  - Files: `packages/desktop/src/menu.ts`, command registration component
  - Pre-commit: `bun run typecheck`

---

### Wave 4: Integration

- [ ] 10. Integration testing and cross-platform verification

  **What to do**:
  - Create integration test plan document at `.sisyphus/evidence/remote-ssh-test-plan.md`
  - Test full connection flow on macOS:
    1. Launch app
    2. Open "Connect to Remote" dialog
    3. Enter test SSH target, repo, ref
    4. Verify connection progress indicators
    5. Verify server switches to remote URL
    6. Verify can interact with remote codebase
    7. Test "Remote Sessions" shows active session
    8. Test "Stop Session" terminates cleanly
    9. Test error handling (invalid host, bad credentials, network failure)
  - Verify Windows SSH binary detection (if Windows available)
  - Verify Linux compatibility (if Linux available)
  - Document any issues found
  - Fix critical bugs discovered during testing

  **Must NOT do**:
  - Skip error scenario testing
  - Leave untested edge cases
  - Merge without at least macOS verification

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Requires browser automation and interactive testing
  - **Skills**: [`playwright`]
    - `playwright`: Browser automation for UI flow verification

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (final task)
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 7, 8, 9

  **References**:
  - All previous task outputs
  - `packages/app/playwright.config.ts` - Playwright configuration
  - `packages/app/script/e2e-local.ts` - E2E test runner

  **Acceptance Criteria**:

  **Playwright Verification (Full Flow):**

  ```
  # Agent executes full integration test:
  1. Navigate to: http://localhost:3000 (with backend running)
  2. Press: Cmd+Shift+R (Connect to Remote shortcut)
  3. Assert: Connection dialog opens
  4. Fill SSH target, repo URL, ref
  5. Click Connect
  6. Assert: Progress indicators show (installing, cloning, starting, tunneling)
  7. Assert: Dialog closes on success
  8. Assert: App shows remote codebase content
  9. Open Remote Sessions dialog
  10. Assert: Session appears in list
  11. Click Stop
  12. Assert: Session removed from list
  13. Screenshot each step to .sisyphus/evidence/task-10-*.png
  ```

  **Evidence to Capture:**
  - [ ] Screenshots of each dialog step
  - [ ] Test plan document with results
  - [ ] Any bug fixes made during testing

  **Commit**: YES
  - Message: `test(desktop): verify remote SSH integration`
  - Files: `.sisyphus/evidence/remote-ssh-test-plan.md`, any bug fixes
  - Pre-commit: `bun run typecheck`

---

## Commit Strategy

| After Task | Message                                                       | Files                                                  | Verification        |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------- |
| 1          | `refactor(remote): extract SSH module to shared location`     | `packages/opencode/src/remote/ssh.ts`, CLI imports     | `bun run typecheck` |
| 2          | `refactor(remote): extract session module to shared location` | `packages/opencode/src/remote/session.ts`, CLI imports | `bun run typecheck` |
| 3          | `feat(i18n): add remote connection UI strings`                | i18n files                                             | `bun run typecheck` |
| 4          | `feat(desktop): add Tauri commands for remote SSH operations` | Rust files                                             | `cargo check`       |
| 5          | `feat(app): add remote connection context`                    | context file                                           | `bun run typecheck` |
| 6          | `feat(platform): add remote connection capabilities`          | platform files                                         | `bun run typecheck` |
| 7          | `feat(app): add remote connection dialog`                     | dialog component                                       | `bun run typecheck` |
| 8          | `feat(app): add remote sessions dialog`                       | dialog component                                       | `bun run typecheck` |
| 9          | `feat(desktop): add remote menu items and commands`           | menu, commands                                         | `bun run typecheck` |
| 10         | `test(desktop): verify remote SSH integration`                | evidence, fixes                                        | `bun run typecheck` |

---

## Success Criteria

### Verification Commands

```bash
# Build verification
bun run typecheck  # Expected: Exit 0
cd packages/desktop && cargo check  # Expected: Exit 0

# App runs
bun run --cwd packages/desktop tauri dev  # Expected: App launches

# Feature verification (manual with SSH host)
# 1. Open app
# 2. Cmd+Shift+R opens connection dialog
# 3. Connect to remote host
# 4. App switches to remote server
# 5. Remote Sessions shows session
# 6. Stop session works
```

### Final Checklist

- [ ] All "Must Have" features present and working
- [ ] All "Must NOT Have" items absent
- [ ] Cross-platform: macOS verified, Windows/Linux patterns implemented
- [ ] User-friendly error messages for common failures
- [ ] Menu and command palette integration complete
- [ ] Session persistence works across app restarts
