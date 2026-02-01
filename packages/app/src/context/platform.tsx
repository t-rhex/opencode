import { createSimpleContext } from "@opencode-ai/ui/context"
import { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type SavedConnection = {
  id: string
  name: string
  target: string
  port?: number
  keyPath?: string
  lastDirectory?: string
}

export type DirectoryEntry = {
  name: string
  isDir: boolean
  path: string
}

export type BrowseResult = {
  entries: DirectoryEntry[]
  path: string
}

export type RemoteConnectResult = {
  url: string
  password: string | null
  session: {
    id: string
    target: string
    repo: string
    git_ref: string
    port: number
    local_port: number
    started_at: string
  }
}

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop"

  /** Desktop OS (Tauri only) */
  os?: "macos" | "windows" | "linux"

  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog (native on Tauri, server-backed on web) */
  openDirectoryPickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Open native file picker dialog (Tauri only) */
  openFilePickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Save file picker dialog (Tauri only) */
  saveFilePickerDialog?(opts?: { title?: string; defaultPath?: string }): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Check for updates (Tauri only) */
  checkUpdate?(): Promise<{ updateAvailable: boolean; version?: string }>

  /** Install updates (Tauri only) */
  update?(): Promise<void>

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServerUrl?(): Promise<string | null> | string | null

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServerUrl?(url: string | null): Promise<void> | void

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Whether remote connections are supported */
  canRemote?: boolean

  /** Connect to remote SSH host with repo clone */
  remoteConnect?(opts: { target: string; repo: string; ref: string; keyPath?: string }): Promise<RemoteConnectResult>

  /** Connect to remote SSH host with existing directory */
  remoteConnectDirectory?(opts: { target: string; path: string; keyPath?: string }): Promise<RemoteConnectResult>
  remoteCreateDirectory?(target: string, path: string, keyPath?: string): Promise<string>

  /** Browse remote directory */
  remoteBrowseDirectory?(target: string, path: string, keyPath?: string): Promise<BrowseResult>

  /** Disconnect from remote host */
  remoteDisconnect?(): Promise<void>

  /** List sessions on a remote host */
  remoteListSessions?(
    target: string,
    keyPath?: string,
  ): Promise<
    Array<{
      id: string
      target: string
      repo: string
      git_ref: string
      port: number
      started_at: string
    }>
  >

  /** Stop a session on a remote host */
  remoteStopSession?(target: string, sessionId: string, keyPath?: string): Promise<void>
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
