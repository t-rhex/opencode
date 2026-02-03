import { BunProc } from "../bun"
import { CurrentFilesystem } from "../fs"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Flag } from "@/flag/flag"

async function whichBinary(binary: string): Promise<boolean> {
  if (CurrentFilesystem.isRemote()) {
    const result = await Instance.fs.exec(`which ${binary}`)
    return result.exitCode === 0
  }
  return Bun.which(binary) !== null
}

async function readFile(path: string): Promise<string> {
  if (CurrentFilesystem.isRemote()) {
    return Instance.fs.read(path)
  }
  return Bun.file(path).text()
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path)
  return JSON.parse(content)
}

export interface Info {
  name: string
  command: string[]
  environment?: Record<string, string>
  extensions: string[]
  enabled(): Promise<boolean>
}

export const gofmt: Info = {
  name: "gofmt",
  command: ["gofmt", "-w", "$FILE"],
  extensions: [".go"],
  async enabled() {
    return whichBinary("gofmt")
  },
}

export const mix: Info = {
  name: "mix",
  command: ["mix", "format", "$FILE"],
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    return whichBinary("mix")
  },
}

export const prettier: Info = {
  name: "prettier",
  command: [BunProc.which(), "x", "prettier", "--write", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".md",
    ".mdx",
    ".graphql",
    ".gql",
  ],
  async enabled() {
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree, Instance.fs)
    for (const item of items) {
      const json = (await readJson(item)) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      if (json.dependencies?.prettier) return true
      if (json.devDependencies?.prettier) return true
    }
    return false
  },
}

export const oxfmt: Info = {
  name: "oxfmt",
  command: [BunProc.which(), "x", "oxfmt", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
  async enabled() {
    if (!Flag.OPENCODE_EXPERIMENTAL_OXFMT) return false
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree, Instance.fs)
    for (const item of items) {
      const json = (await readJson(item)) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      if (json.dependencies?.oxfmt) return true
      if (json.devDependencies?.oxfmt) return true
    }
    return false
  },
}

export const biome: Info = {
  name: "biome",
  command: [BunProc.which(), "x", "@biomejs/biome", "check", "--write", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".md",
    ".mdx",
    ".graphql",
    ".gql",
  ],
  async enabled() {
    const configs = ["biome.json", "biome.jsonc"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree, Instance.fs)
      if (found.length > 0) {
        return true
      }
    }
    return false
  },
}

export const zig: Info = {
  name: "zig",
  command: ["zig", "fmt", "$FILE"],
  extensions: [".zig", ".zon"],
  async enabled() {
    return whichBinary("zig")
  },
}

export const clang: Info = {
  name: "clang-format",
  command: ["clang-format", "-i", "$FILE"],
  extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
  async enabled() {
    const items = await Filesystem.findUp(".clang-format", Instance.directory, Instance.worktree, Instance.fs)
    return items.length > 0
  },
}

export const ktlint: Info = {
  name: "ktlint",
  command: ["ktlint", "-F", "$FILE"],
  extensions: [".kt", ".kts"],
  async enabled() {
    return whichBinary("ktlint")
  },
}

export const ruff: Info = {
  name: "ruff",
  command: ["ruff", "format", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    if (!(await whichBinary("ruff"))) return false
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree, Instance.fs)
      if (found.length > 0) {
        if (config === "pyproject.toml") {
          const content = await readFile(found[0])
          if (content.includes("[tool.ruff]")) return true
        } else {
          return true
        }
      }
    }
    const deps = ["requirements.txt", "pyproject.toml", "Pipfile"]
    for (const dep of deps) {
      const found = await Filesystem.findUp(dep, Instance.directory, Instance.worktree, Instance.fs)
      if (found.length > 0) {
        const content = await readFile(found[0])
        if (content.includes("ruff")) return true
      }
    }
    return false
  },
}

export const rlang: Info = {
  name: "air",
  command: ["air", "format", "$FILE"],
  extensions: [".R"],
  async enabled() {
    if (!(await whichBinary("air"))) return false

    try {
      const result = await Instance.fs.exec("air --help")
      if (result.exitCode !== 0) return false
      const output = result.stdout

      // Check for "Air: An R language server and formatter"
      const firstLine = output.split("\n")[0]
      const hasR = firstLine.includes("R language")
      const hasFormatter = firstLine.includes("formatter")
      return hasR && hasFormatter
    } catch {
      return false
    }
  },
}

export const uvformat: Info = {
  name: "uv",
  command: ["uv", "format", "--", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    if (await ruff.enabled()) return false
    if (await whichBinary("uv")) {
      const result = await Instance.fs.exec("uv format --help")
      return result.exitCode === 0
    }
    return false
  },
}

export const rubocop: Info = {
  name: "rubocop",
  command: ["rubocop", "--autocorrect", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return whichBinary("rubocop")
  },
}

export const standardrb: Info = {
  name: "standardrb",
  command: ["standardrb", "--fix", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return whichBinary("standardrb")
  },
}

export const htmlbeautifier: Info = {
  name: "htmlbeautifier",
  command: ["htmlbeautifier", "$FILE"],
  extensions: [".erb", ".html.erb"],
  async enabled() {
    return whichBinary("htmlbeautifier")
  },
}

export const dart: Info = {
  name: "dart",
  command: ["dart", "format", "$FILE"],
  extensions: [".dart"],
  async enabled() {
    return whichBinary("dart")
  },
}

export const ocamlformat: Info = {
  name: "ocamlformat",
  command: ["ocamlformat", "-i", "$FILE"],
  extensions: [".ml", ".mli"],
  async enabled() {
    if (!(await whichBinary("ocamlformat"))) return false
    const items = await Filesystem.findUp(".ocamlformat", Instance.directory, Instance.worktree, Instance.fs)
    return items.length > 0
  },
}

export const terraform: Info = {
  name: "terraform",
  command: ["terraform", "fmt", "$FILE"],
  extensions: [".tf", ".tfvars"],
  async enabled() {
    return whichBinary("terraform")
  },
}

export const latexindent: Info = {
  name: "latexindent",
  command: ["latexindent", "-w", "-s", "$FILE"],
  extensions: [".tex"],
  async enabled() {
    return whichBinary("latexindent")
  },
}

export const gleam: Info = {
  name: "gleam",
  command: ["gleam", "format", "$FILE"],
  extensions: [".gleam"],
  async enabled() {
    return whichBinary("gleam")
  },
}

export const shfmt: Info = {
  name: "shfmt",
  command: ["shfmt", "-w", "$FILE"],
  extensions: [".sh", ".bash"],
  async enabled() {
    return whichBinary("shfmt")
  },
}

export const nixfmt: Info = {
  name: "nixfmt",
  command: ["nixfmt", "$FILE"],
  extensions: [".nix"],
  async enabled() {
    return whichBinary("nixfmt")
  },
}

export const rustfmt: Info = {
  name: "rustfmt",
  command: ["rustfmt", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    return whichBinary("rustfmt")
  },
}

export const pint: Info = {
  name: "pint",
  command: ["./vendor/bin/pint", "$FILE"],
  extensions: [".php"],
  async enabled() {
    const items = await Filesystem.findUp("composer.json", Instance.directory, Instance.worktree, Instance.fs)
    for (const item of items) {
      const json = (await readJson(item)) as {
        require?: Record<string, string>
        "require-dev"?: Record<string, string>
      }
      if (json.require?.["laravel/pint"]) return true
      if (json["require-dev"]?.["laravel/pint"]) return true
    }
    return false
  },
}

export const ormolu: Info = {
  name: "ormolu",
  command: ["ormolu", "-i", "$FILE"],
  extensions: [".hs"],
  async enabled() {
    return Bun.which("ormolu") !== null
  },
}
