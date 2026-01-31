# Draft: Remote SSH Feature for Desktop App

## Requirements (confirmed)

- Port CLI remote SSH feature to Tauri Desktop app
- Must work on macOS, Windows, Linux
- SSH key authentication only (no passwords in MVP)
- Handle connection failures gracefully
- Follow desktop app style guide (single-word variables, avoid let, prefer const)

## Technical Decisions

### SSH Implementation Approach

- **Decision**: Use system `ssh` binary via Tauri shell plugin (same as CLI)
- **Rationale**:
  - CLI already uses `ssh2` for commands + system `ssh` for tunneling
  - System `ssh` is cross-platform (macOS/Linux pre-installed, Windows 10+ has OpenSSH)
  - Leverages users' existing SSH config (~/.ssh/config)
  - Simpler than embedding russh crate
  - Battle-tested implementation

### Code Reuse Strategy

- **Decision**: Extract shared SSH/session logic to `packages/opencode/src/remote/`
- **Rationale**: CLI and Desktop can share core logic, avoid duplication

### Architecture Pattern

- **Decision**: Tauri commands for SSH operations, frontend for UI/state
- **Rationale**: Matches existing sidecar pattern in desktop app

## Research Findings

### CLI Implementation (packages/opencode/src/cli/cmd/remote/)

- `ssh.ts`: SSH primitives using `ssh2` library (exec, exists, readFile, writeFile, mkdir, kill)
- `session.ts`: Session ID generation, metadata types, paths (~/.opencode-remote/)
- `connect.ts`: Full orchestration - install, clone, start server, tunnel via system `ssh -L`, attach TUI
- Port forwarding uses `child_process.spawn("ssh", ["-N", "-L", ...])` not `ssh2` library
- Health check polls remote log for "listening on http://...:<port>"

### Desktop Architecture (packages/desktop/)

- Tauri v2 with SolidJS frontend
- Sidecar pattern: Rust spawns `opencode serve`, frontend connects via HTTP
- `lib.rs`: Server management, `spawn_sidecar()`, `ensure_server_ready` command
- `ServerGate` component waits for server before rendering app
- `Platform` interface abstracts native capabilities
- `Server` context manages active server URL and health checks
- Dialog pattern: `dialog-*.tsx` components with `useDialog()` hook

### Cross-Platform SSH

- macOS/Linux: `/usr/bin/ssh` pre-installed
- Windows: `C:\Windows\System32\OpenSSH\ssh.exe` (Windows 10 1809+)
- Detection: Use `which` crate in Rust

## Scope Boundaries

### INCLUDE

- Remote connection dialog UI (SSH target, repo URL, ref, SSH key path)
- SSH tunnel establishment via Tauri shell plugin
- Remote server health monitoring
- Switching app from local to remote server connection
- Session management UI (list, stop remote sessions)
- "Connect to Remote" menu item (macOS)
- Command palette integration
- Connection progress indicators
- Connection failure handling with user-friendly errors

### EXCLUDE

- Password authentication (MVP limitation)
- SSH agent forwarding
- Multiple simultaneous remote connections
- Remote file browsing before connection
- SSH config file parsing
- Custom remote install paths
- Session reconnection on disconnect

## Open Questions

- None remaining - requirements are clear from user context

## Test Strategy

- Manual verification via Playwright browser automation
- Test on macOS (primary), verify Windows/Linux patterns work
