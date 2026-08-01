import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type { IFilesystemProvider } from '../providers/types'
import { joinRemotePath, type RemoteHostPlatform } from '../ssh/ssh-remote-platform'

export type UsageFsDirEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
}

export type UsageFsStat = {
  mtimeMs: number
  size: number
}

export type UsageFilesystem = {
  readDir(path: string): Promise<UsageFsDirEntry[]>
  stat(path: string): Promise<UsageFsStat>
  readLines(path: string): Promise<AsyncIterable<string>>
  realpath(path: string): Promise<string>
}

export const localUsageFilesystem: UsageFilesystem = {
  async readDir(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile()
    }))
  },
  async stat(filePath) {
    const fileStat = await stat(filePath)
    return { mtimeMs: fileStat.mtimeMs, size: fileStat.size }
  },
  async readLines(filePath) {
    return createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity
    }) as unknown as AsyncIterable<string>
  },
  async realpath(filePath) {
    return realpath(filePath)
  }
}

export function createSshUsageFilesystem(provider: IFilesystemProvider): UsageFilesystem {
  return {
    async readDir(dirPath) {
      const entries = await provider.readDir(dirPath)
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        // Why: mirror local Dirent semantics — a symlink entry is neither a
        // followed directory nor a parseable file, so symlinked transcripts are
        // skipped just like the local walk skips them.
        isFile: !entry.isDirectory && !entry.isSymlink
      }))
    },
    async stat(filePath) {
      const fileStat = await provider.stat(filePath)
      return { mtimeMs: fileStat.mtimeMs ?? fileStat.mtime, size: fileStat.size }
    },
    async readLines(filePath) {
      const read = await provider.readFile(filePath)
      return readLinesFromString(read.isBinary ? '' : read.content)
    },
    async realpath(filePath) {
      return provider.realpath(filePath)
    }
  }
}

// Why: node readline does not emit a trailing empty line for a file that ends
// with a newline; splitting raw content would, inflating remote line counts and
// diverging from the local parser. Drop a single trailing newline before split.
async function* readLinesFromString(content: string): AsyncIterable<string> {
  if (content === '') {
    return
  }
  const trimmed = content.replace(/\r?\n$/, '')
  for (const line of trimmed.split(/\r?\n/)) {
    yield line
  }
}

export function buildClaudeUsageRemoteRoots(
  remoteHome: string,
  hostPlatform: RemoteHostPlatform
): string[] {
  return [
    joinRemotePath(hostPlatform, remoteHome, '.claude', 'projects'),
    joinRemotePath(hostPlatform, remoteHome, '.claude', 'transcripts')
  ]
}
