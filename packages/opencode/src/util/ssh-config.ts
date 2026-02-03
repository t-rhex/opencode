import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export interface SSHHostConfig {
  host: string // The Host pattern/alias
  hostname?: string // HostName (actual host to connect to)
  user?: string // User
  port?: number // Port
  identityFile?: string // IdentityFile path
  proxyJump?: string // ProxyJump
  proxyCommand?: string // ProxyCommand
}

export namespace SSHConfig {
  /**
   * Parse SSH config file and return all host configurations
   */
  export function parse(configPath?: string): Map<string, SSHHostConfig> {
    const path = configPath ?? join(homedir(), ".ssh", "config")
    if (!existsSync(path)) return new Map()

    const content = readFileSync(path, "utf-8")
    const hosts = new Map<string, SSHHostConfig>()
    let current: SSHHostConfig | null = null

    for (const line of content.split("\n")) {
      const trimmed = line.trim()

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue

      // Parse key-value (handles both "Key Value" and "Key=Value")
      const match = trimmed.match(/^(\S+)\s*[=\s]\s*(.+)$/)
      if (!match) continue

      const [, key, value] = match
      const keyLower = key.toLowerCase()

      if (keyLower === "host") {
        // Save previous host if exists
        if (current) hosts.set(current.host, current)
        // Start new host block
        current = { host: value }
      } else if (current) {
        switch (keyLower) {
          case "hostname":
            current.hostname = value
            break
          case "user":
            current.user = value
            break
          case "port":
            current.port = parseInt(value, 10)
            break
          case "identityfile":
            // Expand ~ to home directory
            current.identityFile = value.startsWith("~") ? join(homedir(), value.slice(1)) : value
            break
          case "proxyjump":
            current.proxyJump = value
            break
          case "proxycommand":
            current.proxyCommand = value
            break
        }
      }
    }

    // Save last host
    if (current) hosts.set(current.host, current)

    return hosts
  }

  /**
   * Get config for a specific host, with pattern matching support
   */
  export function getHost(hostOrAlias: string, configPath?: string): SSHHostConfig | undefined {
    const configs = parse(configPath)

    // Direct match first
    if (configs.has(hostOrAlias)) {
      return configs.get(hostOrAlias)
    }

    // Check wildcard patterns (e.g., "*.example.com", "192.168.*")
    for (const [pattern, config] of configs) {
      if (matchPattern(pattern, hostOrAlias)) {
        return config
      }
    }

    // Check for "*" (default) config
    if (configs.has("*")) {
      return configs.get("*")
    }

    return undefined
  }

  /**
   * Match SSH host pattern (supports * and ? wildcards)
   */
  function matchPattern(pattern: string, host: string): boolean {
    if (pattern === "*") return true
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return pattern === host
    }

    // Convert SSH pattern to regex
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
          .replace(/\*/g, ".*") // * matches anything
          .replace(/\?/g, ".") + // ? matches single char
        "$",
    )
    return regex.test(host)
  }

  /**
   * Resolve full connection config for a host, merging with defaults
   */
  export function resolve(hostOrAlias: string, configPath?: string): SSHHostConfig {
    const config = getHost(hostOrAlias, configPath)
    const defaults = getHost("*", configPath)

    return {
      host: hostOrAlias,
      hostname: config?.hostname ?? defaults?.hostname ?? hostOrAlias,
      user: config?.user ?? defaults?.user,
      port: config?.port ?? defaults?.port ?? 22,
      identityFile: config?.identityFile ?? defaults?.identityFile,
      proxyJump: config?.proxyJump ?? defaults?.proxyJump,
      proxyCommand: config?.proxyCommand ?? defaults?.proxyCommand,
    }
  }
}
