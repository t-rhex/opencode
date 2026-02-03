import { randomBytes } from "crypto"

export namespace RemoteSession {
  export interface Metadata {
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
  export function generateId(): string {
    const now = new Date()
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join("")
    const random = randomBytes(3).toString("hex")
    return `${timestamp}-${random}`
  }

  // Base directory for all remote data
  const BASE_DIR = "~/.opencode-remote"

  // Remote paths
  export function binPath(): string {
    return `${BASE_DIR}/bin/opencode-remote`
  }

  export function workspacePath(id: string): string {
    return `${BASE_DIR}/workspaces/${id}`
  }

  export function repoPath(id: string): string {
    return `${BASE_DIR}/workspaces/${id}/repo`
  }

  export function metadataPath(id: string): string {
    return `${BASE_DIR}/run/${id}.json`
  }

  export function logPath(id: string): string {
    return `${BASE_DIR}/logs/${id}.log`
  }

  export function runDir(): string {
    return `${BASE_DIR}/run`
  }

  // Parse metadata from JSON string
  export function parseMetadata(json: string): Metadata {
    return JSON.parse(json) as Metadata
  }

  // Serialize metadata to JSON string
  export function serializeMetadata(meta: Metadata): string {
    return JSON.stringify(meta, null, 2)
  }
}
