export interface FileStat {
  size: number
  mtime: Date
  isDirectory: boolean
  isFile: boolean
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

export interface IFilesystem {
  // File operations
  read(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  write(path: string, content: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat>
  unlink(path: string): Promise<void>

  // Directory operations
  mkdir(path: string, recursive?: boolean): Promise<void>
  readdir(path: string): Promise<string[]>
  rmdir(path: string, recursive?: boolean): Promise<void>

  // Process operations
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  execStream(
    command: string,
    options: ExecOptions | undefined,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ): Promise<ExecResult>

  // Utility operations
  glob(pattern: string, cwd: string): Promise<string[]>
  realpath(path: string): Promise<string>

  // Connection management (for remote)
  connect?(): Promise<void>
  disconnect?(): Promise<void>
  isConnected?(): boolean
}
