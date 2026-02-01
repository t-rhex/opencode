import { type IFilesystem, LocalFilesystem } from "./index"

let filesystem: IFilesystem = new LocalFilesystem()
let remoteMode = false
let remoteDirectory: string | undefined

export const CurrentFilesystem = {
  get(): IFilesystem {
    return filesystem
  },
  set(fs: IFilesystem) {
    filesystem = fs
  },
  isRemote(): boolean {
    return remoteMode
  },
  setRemoteMode(enabled: boolean, directory?: string) {
    remoteMode = enabled
    remoteDirectory = directory
  },
  getRemoteDirectory(): string | undefined {
    return remoteDirectory
  },
}
