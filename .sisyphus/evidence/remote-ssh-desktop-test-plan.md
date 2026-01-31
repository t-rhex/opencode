# Remote SSH Desktop Feature - Test Plan

## Overview

This document outlines the test plan for the Remote SSH feature ported to the Desktop app.

## Implementation Summary

### Files Created/Modified

| File                                                     | Type      | Purpose                     |
| -------------------------------------------------------- | --------- | --------------------------- |
| `packages/opencode/src/remote/ssh.ts`                    | Extracted | SSH primitives (shared)     |
| `packages/opencode/src/remote/session.ts`                | Extracted | Session management (shared) |
| `packages/opencode/src/remote/index.ts`                  | New       | Module exports              |
| `packages/app/src/i18n/en.ts`                            | Modified  | i18n strings                |
| `packages/desktop/src/i18n/en.ts`                        | Modified  | Desktop i18n strings        |
| `packages/desktop/src-tauri/src/remote.rs`               | New       | Tauri SSH commands          |
| `packages/desktop/src-tauri/src/lib.rs`                  | Modified  | Command registration        |
| `packages/desktop/src-tauri/Cargo.toml`                  | Modified  | Added `rand` dependency     |
| `packages/app/src/context/remote.tsx`                    | New       | Remote state context        |
| `packages/app/src/context/platform.tsx`                  | Modified  | Platform capabilities       |
| `packages/desktop/src/index.tsx`                         | Modified  | Platform implementation     |
| `packages/app/src/components/dialog-remote-connect.tsx`  | New       | Connection dialog           |
| `packages/app/src/components/dialog-remote-sessions.tsx` | New       | Sessions dialog             |
| `packages/app/src/components/remote-commands.tsx`        | New       | Command registration        |
| `packages/desktop/src/menu.ts`                           | Modified  | Menu items                  |

## Verification Results

### Static Analysis

| Check                      | Status  | Notes                                            |
| -------------------------- | ------- | ------------------------------------------------ |
| TypeScript typecheck (app) | PASS    | No errors                                        |
| Rust cargo check           | PARTIAL | Code compiles, sidecar missing (expected in dev) |
| File existence             | PASS    | All files created                                |
| i18n keys                  | PASS    | All remote.\* keys present                       |

### CLI Remote Feature (Regression)

| Test             | Status | Notes                          |
| ---------------- | ------ | ------------------------------ |
| `remote install` | PASS   | Installs binary on remote      |
| `remote start`   | PASS   | Starts server, returns session |
| `remote status`  | PASS   | Lists running sessions         |
| `remote stop`    | PASS   | Stops session, cleans up       |
| `remote connect` | PASS   | Full flow works                |

### Desktop Integration (Manual Testing Required)

#### Prerequisites

- Tauri development environment set up
- SSH server accessible for testing
- Desktop app built with sidecar

#### Test Cases

**TC-1: Open Connection Dialog**

1. Launch desktop app
2. Press Cmd+Shift+P (command palette)
3. Type "Connect to Remote"
4. Expected: Dialog opens with SSH target input

**TC-2: Connection Flow**

1. Enter SSH target (user@host)
2. Enter SSH key path (optional)
3. Click Next
4. Enter repo URL and ref
5. Click Connect
6. Expected: Progress indicator, then connected

**TC-3: Remote Sessions Dialog**

1. Open command palette
2. Type "Remote Sessions"
3. Enter SSH target
4. Click Fetch
5. Expected: List of sessions on remote

**TC-4: Stop Session**

1. From sessions dialog, click stop on a session
2. Expected: Session removed from list

**TC-5: Menu Integration**

1. Click OpenCode menu (macOS)
2. Expected: "Connect to Remote..." and "Remote Sessions..." items visible

## Known Limitations

1. **SSH Key Only**: Password authentication not supported
2. **Single Connection**: Only one remote connection at a time
3. **No Auto-Reconnect**: Manual reconnection required after network issues
4. **Sidecar Required**: Desktop app needs the opencode CLI binary bundled

## Commits

```
ff72d8dfe feat(app): add remote connection and sessions dialogs
1a204f42a feat(desktop): add remote menu items and commands
d4fd7882c feat(desktop): add Tauri commands for remote SSH operations
7a43e2911 feat(app): add remote connection context
c7a35a9ee feat(platform): add remote connection capabilities
bed0eeefc refactor(remote): extract SSH module to shared location
b136a6c23 feat(i18n): add remote connection UI strings
```

## Conclusion

The Remote SSH feature has been successfully ported to the Desktop app. All code is in place and type-checked. Full integration testing requires the Tauri development environment with the sidecar binary.
