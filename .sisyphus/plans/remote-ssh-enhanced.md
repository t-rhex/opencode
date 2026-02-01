# Enhanced Remote SSH Feature

## TL;DR

> **Quick Summary**: Add saved SSH connections with CRUD operations, remote filesystem browser, and connect-without-clone flow to the OpenCode desktop app. Users can save SSH configs, reconnect quickly, browse remote directories, and optionally clone repos.
>
> **Deliverables**:
>
> - Saved SSH connections context with persistence
> - Two new Rust commands: `remote_browse_directory`, `remote_connect_directory`
> - Redesigned `DialogRemoteConnect` with new multi-step flow
> - `RemoteFolderBrowser` component for directory listing
> - Updated Platform interface and desktop implementation
> - Complete i18n strings
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (types) -> Task 2 (Rust) -> Task 3 (Platform) -> Task 5 (context) -> Task 6 (dialog)

---

## Context

### Original Request

Implement enhanced Remote SSH feature with:

1. Saved SSH Connections - persist configurations for reuse
2. Connect without repo requirement - just SSH connect
3. Remote filesystem browser - browse remote folders to pick working directory
4. Optional clone flow - can still clone if user wants

### Interview Summary

**Key Discussions**:

- Connection naming: Auto-generate from host (user@server), with optional custom name
- Validation: No validation on save - fail fast on connect
- Browse start: User home directory (~)
- Directory memory: Remember last used directory per saved connection
- Post-connect: Same as clone flow - start opencode server, create tunnel

**Research Findings**:

- Current flow: SSH target -> repo URL -> clone -> start server -> tunnel
- Persistence: `persisted(Persist.global("key"), createStore({...}))` pattern
- Dialogs: `useDialog()` with `dialog.show()` for transitions, internal steps via `store.step`
- Platform: Optional methods with `?`, implement in desktop with `invoke()`
- Rust: Commands registered in `lib.rs`, SSH via `std::process::Command`

---

## Work Objectives

### Core Objective

Enable users to save SSH connections, reconnect to previous remotes quickly, and browse remote filesystems to choose working directories without requiring a git clone.

### Concrete Deliverables

- `packages/app/src/context/connections.tsx` - Saved connections context
- `packages/app/src/components/dialog-remote-connect.tsx` - Redesigned multi-step dialog
- `packages/app/src/components/remote-folder-browser.tsx` - Remote directory browser
- `packages/desktop/src-tauri/src/remote.rs` - Two new commands + modified existing
- `packages/desktop/src/index.tsx` - New platform methods
- `packages/app/src/context/platform.tsx` - Extended interface
- `packages/app/src/i18n/en.ts` - New translation strings

### Definition of Done

- [ ] User can save new SSH connection with name, host, port, key path
- [ ] User can edit/delete saved connections
- [ ] User can quick-connect from saved connection list
- [ ] User can browse remote directories after SSH connects
- [ ] User can connect to existing remote directory (no clone)
- [ ] Last used directory is remembered per connection
- [ ] Original clone flow still works as optional path
- [ ] All new UI has i18n strings

### Must Have

- Saved connections persist across app restarts
- Browse starts at home directory (~)
- Auto-generate connection name from target with optional custom override
- Same server behavior as clone flow (install opencode if needed, start server, tunnel)

### Must NOT Have (Guardrails)

- NO SSH key generation or management
- NO multiple keys per connection
- NO SSH agent forwarding config
- NO jump host / proxy support
- NO connection groups or folders
- NO import/export connections
- NO connection validation on save (fail fast on connect instead)
- NO new npm dependencies unless absolutely necessary

---

## Verification Strategy (MANDATORY)

### Test Decision

- **Infrastructure exists**: YES (Playwright E2E tests exist in packages/app)
- **User wants tests**: Manual verification focus (E2E via Playwright for UI, Rust unit tests optional)
- **Framework**: Playwright for E2E, manual verification for SSH functionality

### Automated Verification Approach

Each TODO includes EXECUTABLE verification procedures:

| Type                     | Verification Tool  | Procedure                            |
| ------------------------ | ------------------ | ------------------------------------ |
| **Frontend/UI**          | Playwright         | Navigate, interact, assert DOM state |
| **Rust Backend**         | Manual SSH test    | Use real SSH target for verification |
| **Platform Integration** | Desktop app manual | Launch desktop, test flows           |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Define types and interfaces
├── Task 4: Add i18n strings
└── (independent setup work)

Wave 2 (After Wave 1):
├── Task 2: Rust backend commands (depends: types from Task 1)
└── Task 3: Platform interface + desktop impl (depends: types from Task 1)

Wave 3 (After Wave 2):
├── Task 5: Saved connections context (depends: Platform from Task 3)
├── Task 6: Redesign dialog + folder browser (depends: context from Task 5)
└── Task 7: Integration testing (depends: all above)
```

### Dependency Matrix

| Task | Depends On | Blocks  | Can Parallelize With |
| ---- | ---------- | ------- | -------------------- |
| 1    | None       | 2, 3, 5 | 4                    |
| 2    | 1          | 3, 6    | 4                    |
| 3    | 1, 2       | 5, 6    | 4                    |
| 4    | None       | 6       | 1, 2, 3              |
| 5    | 3          | 6       | None                 |
| 6    | 4, 5       | 7       | None                 |
| 7    | 6          | None    | None                 |

### Agent Dispatch Summary

| Wave | Tasks   | Recommended Approach                  |
| ---- | ------- | ------------------------------------- |
| 1    | 1, 4    | Parallel: types + i18n                |
| 2    | 2, 3    | Sequential: Rust first, then Platform |
| 3    | 5, 6, 7 | Sequential: context -> dialog -> test |

---

## TODOs

- [ ] 1. Define Types and Interfaces

  **What to do**:
  - Create `SavedConnection` type: `{ id: string, name: string, target: string, port: number, keyPath?: string, lastDirectory?: string }`
  - Create `DirectoryEntry` type: `{ name: string, isDir: boolean, path: string }`
  - Create `BrowseResult` type: `{ entries: DirectoryEntry[], path: string }`
  - Add types to appropriate location (can be in platform.tsx or new types file)

  **Must NOT do**:
  - Don't add runtime code yet, just types
  - Don't create separate types package

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, focused task adding TypeScript types
  - **Skills**: None needed
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: Not UI work

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 4)
  - **Blocks**: Tasks 2, 3, 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/app/src/context/remote.tsx:7-17` - Existing RemoteSession type pattern
  - `packages/app/src/context/platform.tsx:63-75` - Existing remoteConnect return type

  **Type References**:
  - `packages/app/src/context/platform.tsx:4-97` - Platform type definition

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  bun tsc --noEmit -p packages/app/tsconfig.json
  # Assert: Exit code 0 (no type errors)
  ```

  **Evidence to Capture:**
  - [ ] TypeScript compilation passes

  **Commit**: YES
  - Message: `feat(remote): add types for saved connections and directory browsing`
  - Files: `packages/app/src/context/platform.tsx` (or new types file)
  - Pre-commit: `bun tsc --noEmit -p packages/app/tsconfig.json`

---

- [ ] 2. Implement Rust Backend Commands

  **What to do**:
  - Add `remote_browse_directory` command in `remote.rs`:
    - Takes: `target: String`, `path: String`, `key_path: Option<String>`
    - Runs: `ssh target 'ls -la path'` via existing `ssh_exec` function
    - Parses ls output into `Vec<DirectoryEntry>`
    - Returns: `BrowseResult { entries, path }`
  - Add `remote_connect_directory` command in `remote.rs`:
    - Similar to `remote_connect` but:
    - Takes `path` instead of `repo` and `git_ref`
    - Skips git clone step
    - Starts server in specified directory
    - Install opencode if needed (same as existing)
  - Register both commands in `lib.rs`

  **Must NOT do**:
  - Don't modify the existing `remote_connect` signature (add new command instead)
  - Don't add new Rust dependencies

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Rust backend work requires careful implementation
  - **Skills**: None specific
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not git operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: Tasks 3, 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/desktop/src-tauri/src/remote.rs:31-60` - `ssh_exec` function pattern for SSH commands
  - `packages/desktop/src-tauri/src/remote.rs:80-226` - `remote_connect` function structure

  **API/Type References**:
  - `packages/desktop/src-tauri/src/remote.rs:7-29` - Existing struct definitions
  - `packages/desktop/src-tauri/src/lib.rs:289-300` - Command registration pattern

  **Documentation References**:
  - `packages/desktop/src-tauri/src/remote.rs:130-134` - Server start command pattern

  **WHY Each Reference Matters**:
  - `ssh_exec`: Reuse this exact function for browsing directories
  - `remote_connect`: Copy most of the logic, but skip clone step
  - `lib.rs:289`: Add new commands to `generate_handler!` macro

  **Acceptance Criteria**:

  ```bash
  # Agent runs (from packages/desktop):
  cd packages/desktop && cargo check --manifest-path src-tauri/Cargo.toml
  # Assert: Exit code 0 (compiles without errors)
  ```

  ```bash
  # Agent runs:
  grep -n "remote_browse_directory\|remote_connect_directory" packages/desktop/src-tauri/src/lib.rs
  # Assert: Both commands appear in generate_handler! macro
  ```

  **Evidence to Capture:**
  - [ ] Cargo check passes
  - [ ] Both commands registered in lib.rs

  **Commit**: YES
  - Message: `feat(remote): add browse_directory and connect_directory Rust commands`
  - Files: `packages/desktop/src-tauri/src/remote.rs`, `packages/desktop/src-tauri/src/lib.rs`
  - Pre-commit: `cd packages/desktop && cargo check --manifest-path src-tauri/Cargo.toml`

---

- [ ] 3. Extend Platform Interface and Desktop Implementation

  **What to do**:
  - Add to Platform type in `platform.tsx`:
    - `remoteBrowseDirectory?(target: string, path: string, keyPath?: string): Promise<BrowseResult>`
    - `remoteConnectDirectory?(opts: { target: string; path: string; keyPath?: string }): Promise<RemoteConnectResult>`
  - Implement in desktop `createPlatform()` in `index.tsx`:
    - `remoteBrowseDirectory`: invoke("remote_browse_directory", {...})
    - `remoteConnectDirectory`: invoke("remote_connect_directory", {...})

  **Must NOT do**:
  - Don't implement for web platform (desktop only)
  - Don't change existing method signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward invoke wrapper implementation
  - **Skills**: None needed
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: Not UI work

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 2)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `packages/app/src/context/platform.tsx:59-96` - Existing remote methods pattern
  - `packages/desktop/src/index.tsx:365-398` - Existing remote invoke implementations

  **API/Type References**:
  - `packages/app/src/context/platform.tsx:4-97` - Full Platform interface

  **WHY Each Reference Matters**:
  - `platform.tsx:59-96`: Follow exact pattern for optional remote methods
  - `index.tsx:365-398`: Copy invoke pattern, just change command name and args

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  bun tsc --noEmit -p packages/app/tsconfig.json && bun tsc --noEmit -p packages/desktop/tsconfig.json
  # Assert: Exit code 0 (both compile)
  ```

  **Evidence to Capture:**
  - [ ] TypeScript compilation passes for both packages

  **Commit**: YES
  - Message: `feat(remote): add platform methods for browse and connect directory`
  - Files: `packages/app/src/context/platform.tsx`, `packages/desktop/src/index.tsx`
  - Pre-commit: `bun tsc --noEmit`

---

- [ ] 4. Add i18n Strings

  **What to do**:
  - Add to `packages/app/src/i18n/en.ts`:
    ```
    "remote.connections.title": "Saved Connections"
    "remote.connections.empty": "No saved connections"
    "remote.connections.add": "Add Connection"
    "remote.connections.edit": "Edit Connection"
    "remote.connections.delete": "Delete Connection"
    "remote.connections.name.label": "Connection Name (optional)"
    "remote.connections.name.placeholder": "My Server"
    "remote.connections.port.label": "Port"
    "remote.connections.port.placeholder": "22"
    "remote.connections.save": "Save Connection"
    "remote.connections.connect": "Connect"
    "remote.browse.title": "Choose Working Directory"
    "remote.browse.description": "Browse the remote filesystem or clone a repository"
    "remote.browse.current": "Current: {{path}}"
    "remote.browse.parent": "Parent Directory"
    "remote.browse.select": "Select This Directory"
    "remote.browse.clone": "Clone a Repository Instead"
    "remote.browse.loading": "Loading directory..."
    "remote.browse.error": "Failed to browse directory"
    "remote.browse.empty": "Directory is empty"
    "remote.connect.chooseMethod": "Choose how to connect"
    "remote.connect.method.browse": "Browse Remote Directory"
    "remote.connect.method.clone": "Clone Repository"
    "remote.connect.step.connection": "Connection"
    "remote.connect.step.directory": "Directory"
    "remote.connect.step.connecting": "Connecting"
    ```

  **Must NOT do**:
  - Don't add to other language files (en.ts only for now)
  - Don't modify existing keys

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple string additions
  - **Skills**: None needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/app/src/i18n/en.ts:736-761` - Existing remote.\* keys pattern

  **WHY Each Reference Matters**:
  - Follow exact naming convention: `remote.[feature].[element]`

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  grep -c "remote.connections\|remote.browse\|remote.connect.chooseMethod" packages/app/src/i18n/en.ts
  # Assert: Returns count > 20 (all new keys present)
  ```

  **Evidence to Capture:**
  - [ ] All i18n keys added

  **Commit**: YES
  - Message: `feat(i18n): add strings for enhanced remote SSH feature`
  - Files: `packages/app/src/i18n/en.ts`
  - Pre-commit: None needed

---

- [ ] 5. Implement Saved Connections Context

  **What to do**:
  - Create `packages/app/src/context/connections.tsx`:
    - Use `createSimpleContext` pattern
    - Store: `{ connections: SavedConnection[] }`
    - Persist with `persisted(Persist.global("connections"), createStore({...}))`
    - Methods: `add(conn)`, `update(id, conn)`, `remove(id)`, `get(id)`, `updateLastDirectory(id, path)`
    - Auto-generate name from target if not provided: `user@host` from target
  - Export: `useConnections`, `ConnectionsProvider`
  - Add provider to app tree (likely in AppBaseProviders or similar)

  **Must NOT do**:
  - Don't validate connections on save
  - Don't add complex logic - keep it simple CRUD

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: SolidJS context with persistence
  - **Skills**: [`vercel-react-best-practices`]
    - `vercel-react-best-practices`: SolidJS patterns similar to React

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential start)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `packages/app/src/context/remote.tsx:19-136` - createSimpleContext pattern with store
  - `packages/app/src/utils/persist.ts:284-298` - Persist.global usage
  - `packages/app/src/context/server.tsx` - Similar persisted context example (from research)

  **API/Type References**:
  - Types from Task 1

  **WHY Each Reference Matters**:
  - `remote.tsx`: Exact pattern to follow for context structure
  - `persist.ts`: Use `Persist.global("connections")` for global persistence

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  bun tsc --noEmit -p packages/app/tsconfig.json
  # Assert: Exit code 0
  ```

  ```bash
  # Agent runs:
  grep -n "persisted.*Persist.global.*connections" packages/app/src/context/connections.tsx
  # Assert: Line found (persistence configured)
  ```

  **Evidence to Capture:**
  - [ ] TypeScript compiles
  - [ ] Persistence configured correctly

  **Commit**: YES
  - Message: `feat(remote): add saved connections context with persistence`
  - Files: `packages/app/src/context/connections.tsx`, (provider integration file)
  - Pre-commit: `bun tsc --noEmit -p packages/app/tsconfig.json`

---

- [ ] 6. Redesign Dialog and Implement Folder Browser

  **What to do**:

  **Part A: RemoteFolderBrowser component** (`packages/app/src/components/remote-folder-browser.tsx`):
  - Props: `target`, `keyPath`, `onSelect(path)`, `initialPath?`
  - State: `currentPath`, `entries`, `loading`, `error`
  - Fetch entries via `platform.remoteBrowseDirectory`
  - Display: current path, parent directory link, list of folders
  - Click folder -> navigate into it
  - Select button -> call `onSelect(currentPath)`

  **Part B: Redesign DialogRemoteConnect** (`packages/app/src/components/dialog-remote-connect.tsx`):
  - Step 0: Choose/add connection
    - List saved connections with "Connect" buttons
    - "New Connection" form (target, port, keyPath, optional name)
    - Checkbox: "Save this connection"
  - Step 1: Choose method (after SSH target known)
    - "Browse Remote Directory" button
    - "Clone Repository" button (existing flow)
  - Step 2a: Browse remote (if browse selected)
    - Show RemoteFolderBrowser
    - "Select This Directory" button
  - Step 2b: Clone repo (if clone selected)
    - Existing repo URL + ref fields
  - Step 3: Connecting
    - Show spinner with status messages

  **Must NOT do**:
  - Don't remove existing clone functionality
  - Don't add new UI dependencies
  - Don't create overly complex nested components

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: SolidJS component development with UI
  - **Skills**: [`frontend-ui-ux`, `vercel-react-best-practices`]
    - `frontend-ui-ux`: Dialog and list UI patterns
    - `vercel-react-best-practices`: Component patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 5)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - `packages/app/src/components/dialog-remote-connect.tsx:1-155` - Current dialog to redesign
  - `packages/app/src/components/file-tree.tsx` - Recursive folder listing pattern
  - `packages/app/src/components/dialog-custom-provider.tsx` - Complex multi-step dialog

  **API/Type References**:
  - `packages/app/src/context/platform.tsx` - Platform methods
  - `packages/app/src/context/connections.tsx` - Connections context (from Task 5)
  - `packages/app/src/context/remote.tsx` - Remote context for connect

  **UI Component References**:
  - `@opencode-ai/ui/dialog` - Dialog component
  - `@opencode-ai/ui/button` - Button component
  - `@opencode-ai/ui/text-field` - TextField component
  - `@opencode-ai/ui/spinner` - Spinner component

  **WHY Each Reference Matters**:
  - Current dialog: Understand what exists, preserve compatible structure
  - `file-tree.tsx`: Pattern for folder listing UI
  - `dialog-custom-provider.tsx`: Complex dialog state management example

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  bun tsc --noEmit -p packages/app/tsconfig.json
  # Assert: Exit code 0
  ```

  **For UI Verification (using playwright skill):**

  ```
  # Manual verification steps for agent:
  1. Build desktop app: cd packages/desktop && bun run tauri dev
  2. Open app, go to Server menu -> Connect to Remote
  3. Verify: Dialog shows with saved connections list (empty initially)
  4. Verify: Can enter new connection details
  5. Verify: After entering target, can choose Browse or Clone
  6. Screenshot: .sisyphus/evidence/task-6-dialog-flow.png
  ```

  **Evidence to Capture:**
  - [ ] TypeScript compiles
  - [ ] Dialog renders with new multi-step flow
  - [ ] RemoteFolderBrowser component exists

  **Commit**: YES
  - Message: `feat(remote): redesign dialog with saved connections and folder browser`
  - Files: `packages/app/src/components/dialog-remote-connect.tsx`, `packages/app/src/components/remote-folder-browser.tsx`
  - Pre-commit: `bun tsc --noEmit -p packages/app/tsconfig.json`

---

- [ ] 7. Integration Testing and Polish

  **What to do**:
  - Test full flow with real SSH target:
    1. Add new connection
    2. Verify it appears in saved list
    3. Edit connection name
    4. Delete and re-add connection
    5. Connect via "Browse Remote Directory"
    6. Navigate folders, select directory
    7. Verify opencode server starts
    8. Verify tunnel works
    9. Disconnect
    10. Reconnect - verify last directory remembered
    11. Test clone flow still works
  - Fix any issues found
  - Ensure error handling displays meaningful messages

  **Must NOT do**:
  - Don't skip any flow testing
  - Don't leave console errors

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: End-to-end testing and bug fixing
  - **Skills**: [`playwright`]
    - `playwright`: For automated UI verification where possible

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 6

  **References**:

  **All previous task deliverables**

  **Acceptance Criteria**:

  ```bash
  # Agent runs:
  bun tsc --noEmit
  # Assert: Exit code 0 (full project compiles)
  ```

  ```bash
  # Agent runs:
  bun run --cwd packages/desktop tauri build --debug 2>&1 | tail -20
  # Assert: Build succeeds
  ```

  **Manual Integration Test (agent executes in desktop app):**

  ```
  1. Launch: bun run --cwd packages/desktop tauri dev
  2. Navigate to Server menu -> Connect to Remote
  3. Add new connection with test SSH target
  4. Verify connection saved
  5. Select connection -> Choose "Browse Remote Directory"
  6. Navigate to a directory
  7. Click "Select This Directory"
  8. Verify connection completes
  9. Disconnect
  10. Reconnect -> verify last directory pre-selected
  ```

  **Evidence to Capture:**
  - [ ] Full project compiles
  - [ ] Desktop app builds
  - [ ] Integration test passes

  **Commit**: YES
  - Message: `test(remote): verify enhanced SSH feature integration`
  - Files: Any bug fixes from testing
  - Pre-commit: `bun tsc --noEmit`

---

## Commit Strategy

| After Task | Message                                                                   | Files                                                | Verification |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| 1          | `feat(remote): add types for saved connections and directory browsing`    | platform.tsx                                         | tsc          |
| 2          | `feat(remote): add browse_directory and connect_directory Rust commands`  | remote.rs, lib.rs                                    | cargo check  |
| 3          | `feat(remote): add platform methods for browse and connect directory`     | platform.tsx, index.tsx                              | tsc          |
| 4          | `feat(i18n): add strings for enhanced remote SSH feature`                 | en.ts                                                | grep         |
| 5          | `feat(remote): add saved connections context with persistence`            | connections.tsx                                      | tsc          |
| 6          | `feat(remote): redesign dialog with saved connections and folder browser` | dialog-remote-connect.tsx, remote-folder-browser.tsx | tsc          |
| 7          | `test(remote): verify enhanced SSH feature integration`                   | fixes                                                | tsc + build  |

---

## Success Criteria

### Verification Commands

```bash
# Full type check
bun tsc --noEmit

# Rust compilation
cd packages/desktop && cargo check --manifest-path src-tauri/Cargo.toml

# Desktop build (debug)
bun run --cwd packages/desktop tauri build --debug
```

### Final Checklist

- [ ] All "Must Have" features present
- [ ] All "Must NOT Have" guardrails respected
- [ ] No TypeScript errors
- [ ] No Rust compilation errors
- [ ] Desktop app builds and runs
- [ ] Full connect flow works (save connection -> browse -> select -> connect)
- [ ] Clone flow still works
- [ ] Last directory remembered per connection
