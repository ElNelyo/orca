import { ipcMain } from 'electron'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { ClaudeUsageWorktreeRef } from '../claude-usage/scanner'
import type { IFilesystemProvider } from '../providers/types'
import {
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageRange,
  ClaudeUsageScope
} from '../../shared/claude-usage-types'

export type ClaudeUsageRemoteScanContext = {
  executionHostId: string
  provider: IFilesystemProvider
  remoteHome: string
  hostPlatform: RemoteHostPlatform
  worktrees: ClaudeUsageWorktreeRef[]
}

export type ClaudeUsageRemoteScanResolver = (
  connectionId: string
) => ClaudeUsageRemoteScanContext | null

export type ClaudeUsageHandlerOptions = {
  resolveRemoteScanContext?: ClaudeUsageRemoteScanResolver
}

export function registerClaudeUsageHandlers(
  claudeUsage: ClaudeUsageStore,
  options: ClaudeUsageHandlerOptions = {}
): void {
  ipcMain.handle('claudeUsage:getScanState', () => claudeUsage.getScanState())
  ipcMain.handle('claudeUsage:setEnabled', (_event, args: { enabled: boolean }) =>
    claudeUsage.setEnabled(args.enabled)
  )
  ipcMain.handle('claudeUsage:refresh', (_event, args?: { force?: boolean }) =>
    claudeUsage.refresh(args?.force ?? false)
  )
  ipcMain.handle(
    'claudeUsage:getSnapshot',
    (_event, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; limit?: number }) =>
      claudeUsage.getSnapshot(args.scope, args.range, args.limit)
  )
  ipcMain.handle(
    'claudeUsage:getSummary',
    (_event, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange }) =>
      claudeUsage.getSummary(args.scope, args.range)
  )
  ipcMain.handle(
    'claudeUsage:getDaily',
    (_event, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange }) =>
      claudeUsage.getDaily(args.scope, args.range)
  )
  ipcMain.handle(
    'claudeUsage:getBreakdown',
    (
      _event,
      args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; kind: ClaudeUsageBreakdownKind }
    ) => claudeUsage.getBreakdown(args.scope, args.range, args.kind)
  )
  ipcMain.handle(
    'claudeUsage:getRecentSessions',
    (_event, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; limit?: number }) =>
      claudeUsage.getRecentSessions(args.scope, args.range, args.limit)
  )
  ipcMain.handle(
    'claudeUsage:scanRemote',
    async (
      _event,
      args: { connectionId: string; scope: ClaudeUsageScope; range: ClaudeUsageRange }
    ) => {
      if (!options.resolveRemoteScanContext) {
        return { ok: false, error: 'Remote usage scanning is not available.' } as const
      }
      const context = options.resolveRemoteScanContext(args.connectionId)
      if (!context) {
        return { ok: false, error: SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE } as const
      }
      try {
        const snapshot = await claudeUsage.scanRemote({
          ...context,
          scope: args.scope,
          range: args.range
        })
        return { ok: true, snapshot } as const
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } as const
      }
    }
  )
}
