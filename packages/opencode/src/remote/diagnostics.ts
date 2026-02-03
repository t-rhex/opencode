import z from "zod"
import { CurrentFilesystem } from "@/fs"

export namespace Diagnostics {
  export const Info = z
    .object({
      disk: z
        .object({
          used: z.number(),
          total: z.number(),
          percent: z.number(),
        })
        .optional(),
      memory: z
        .object({
          used: z.number(),
          total: z.number(),
          percent: z.number(),
        })
        .optional(),
      load: z.number().optional(),
    })
    .meta({ ref: "Diagnostics" })
  export type Info = z.infer<typeof Info>

  function parseDiskOutput(stdout: string): Info["disk"] {
    // Parse df -P output: Filesystem 1024-blocks Used Available Capacity Mounted
    // Example: /dev/sda1 100000000 45000000 55000000 45% /
    const lines = stdout.trim().split("\n")
    const line = lines.find((l) => !l.startsWith("Filesystem"))
    if (!line) return undefined

    const parts = line.split(/\s+/)
    if (parts.length < 5) return undefined

    const used = parseInt(parts[2], 10) * 1024 // Convert to bytes
    const total = parseInt(parts[1], 10) * 1024
    const percentStr = parts[4].replace("%", "")
    const percent = parseInt(percentStr, 10)

    if (isNaN(used) || isNaN(total) || isNaN(percent)) return undefined
    return { used, total, percent }
  }

  function parseMemoryOutput(stdout: string): Info["memory"] {
    // Parse free -b output (bytes)
    // Example: Mem: 8000000000 4000000000 2000000000 ...
    const lines = stdout.trim().split("\n")
    const memLine = lines.find((l) => l.startsWith("Mem:"))
    if (!memLine) return undefined

    const parts = memLine.split(/\s+/)
    if (parts.length < 3) return undefined

    const total = parseInt(parts[1], 10)
    const used = parseInt(parts[2], 10)

    if (isNaN(total) || isNaN(used)) return undefined
    const percent = Math.round((used / total) * 100)
    return { used, total, percent }
  }

  function parseLoadOutput(stdout: string): number | undefined {
    // Parse /proc/loadavg: 0.50 0.75 1.00 1/100 12345
    // Or uptime output: ... load average: 0.50, 0.75, 1.00
    const loadMatch = stdout.match(/load average[:\s]+([0-9.]+)/i)
    if (loadMatch) {
      const load = parseFloat(loadMatch[1])
      return isNaN(load) ? undefined : load
    }

    // Try /proc/loadavg format
    const parts = stdout.trim().split(/\s+/)
    if (parts.length > 0) {
      const load = parseFloat(parts[0])
      return isNaN(load) ? undefined : load
    }

    return undefined
  }

  export async function get(): Promise<Info | null> {
    if (!CurrentFilesystem.isRemote()) return null

    const fs = CurrentFilesystem.get()

    const [diskResult, memResult, loadResult] = await Promise.all([
      fs.exec("df -P / 2>/dev/null | tail -1").catch(() => ({ stdout: "", stderr: "", exitCode: 1 })),
      fs.exec("free -b 2>/dev/null || vm_stat 2>/dev/null").catch(() => ({ stdout: "", stderr: "", exitCode: 1 })),
      fs.exec("cat /proc/loadavg 2>/dev/null || uptime").catch(() => ({ stdout: "", stderr: "", exitCode: 1 })),
    ])

    return {
      disk: diskResult.exitCode === 0 ? parseDiskOutput(diskResult.stdout) : undefined,
      memory: memResult.exitCode === 0 ? parseMemoryOutput(memResult.stdout) : undefined,
      load: loadResult.exitCode === 0 ? parseLoadOutput(loadResult.stdout) : undefined,
    }
  }
}
