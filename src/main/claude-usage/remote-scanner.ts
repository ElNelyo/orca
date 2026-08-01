import type { IFilesystemProvider } from '../providers/types'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { buildClaudeUsageRemoteRoots, createSshUsageFilesystem } from './usage-filesystem'
import { scanClaudeUsageFiles, type ClaudeUsageWorktreeRef } from './scanner'
import type { ClaudeUsagePersistedFile } from './types'

export type ScanClaudeUsageFilesRemoteResult = Awaited<ReturnType<typeof scanClaudeUsageFiles>>

// Why: reuses the local scan pipeline over an SSH filesystem so Remote Server
// Claude transcripts are attributed with the same dedupe/ownership/cost logic
// as local ones, without any relay-side changes.
export async function scanClaudeUsageFilesRemote(args: {
  provider: IFilesystemProvider
  remoteHome: string
  hostPlatform: RemoteHostPlatform
  worktrees: ClaudeUsageWorktreeRef[]
  previousProcessedFiles?: ClaudeUsagePersistedFile[]
}): Promise<ScanClaudeUsageFilesRemoteResult> {
  const filesystem = createSshUsageFilesystem(args.provider)
  const roots = buildClaudeUsageRemoteRoots(args.remoteHome, args.hostPlatform)
  return scanClaudeUsageFiles(args.worktrees, args.previousProcessedFiles ?? [], {
    filesystem,
    roots
  })
}
