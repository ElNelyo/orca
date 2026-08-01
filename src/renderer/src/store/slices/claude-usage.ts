import type { StateCreator } from 'zustand'
import type {
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageRemoteScanResult,
  ClaudeUsageScanState,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary
} from '../../../../shared/claude-usage-types'
import type { AppState } from '../types'

export type ClaudeUsageSlice = {
  claudeUsageScope: ClaudeUsageScope
  claudeUsageRange: ClaudeUsageRange
  claudeUsageScanState: ClaudeUsageScanState | null
  claudeUsageSummary: ClaudeUsageSummary | null
  claudeUsageDaily: ClaudeUsageDailyPoint[]
  claudeUsageModelBreakdown: ClaudeUsageBreakdownRow[]
  claudeUsageProjectBreakdown: ClaudeUsageBreakdownRow[]
  claudeUsageRecentSessions: ClaudeUsageSessionRow[]
  claudeUsageRemoteConnectionId: string | null
  claudeUsageRemoteSnapshot: ClaudeUsageSnapshot | null
  claudeUsageRemoteError: string | null
  claudeUsageRemoteScanning: boolean
  setClaudeUsageEnabled: (enabled: boolean) => Promise<void>
  setClaudeUsageScope: (scope: ClaudeUsageScope) => Promise<void>
  setClaudeUsageRange: (range: ClaudeUsageRange) => Promise<void>
  fetchClaudeUsage: (opts?: { forceRefresh?: boolean }) => Promise<void>
  fetchClaudeUsageRemote: (connectionId: string) => Promise<void>
  clearClaudeUsageRemote: () => void
  enableClaudeUsage: () => Promise<void>
  refreshClaudeUsage: () => Promise<void>
}

export const createClaudeUsageSlice: StateCreator<AppState, [], [], ClaudeUsageSlice> = (
  set,
  get
) => ({
  claudeUsageScope: 'orca',
  claudeUsageRange: '30d',
  claudeUsageScanState: null,
  claudeUsageSummary: null,
  claudeUsageDaily: [],
  claudeUsageModelBreakdown: [],
  claudeUsageProjectBreakdown: [],
  claudeUsageRecentSessions: [],
  claudeUsageRemoteConnectionId: null,
  claudeUsageRemoteSnapshot: null,
  claudeUsageRemoteError: null,
  claudeUsageRemoteScanning: false,

  setClaudeUsageEnabled: async (enabled) => {
    try {
      const nextScanState = (await window.api.claudeUsage.setEnabled({
        enabled
      })) as ClaudeUsageScanState
      set({
        // Why: every enable should look like a fresh scan cycle in the UI.
        // Reusing the last completed timestamp makes repeated toggles skip the
        // loading skeleton and briefly render an empty analytics pane.
        claudeUsageScanState: enabled
          ? {
              ...nextScanState,
              isScanning: true,
              lastScanCompletedAt: null,
              lastScanError: null
            }
          : nextScanState,
        claudeUsageSummary: null,
        claudeUsageDaily: [],
        claudeUsageModelBreakdown: [],
        claudeUsageProjectBreakdown: [],
        claudeUsageRecentSessions: []
      })
      if (enabled) {
        await get().fetchClaudeUsage({ forceRefresh: true })
      }
    } catch (error) {
      console.error('Failed to update Claude usage setting:', error)
    }
  },

  setClaudeUsageScope: async (scope) => {
    set({ claudeUsageScope: scope })
    await get().fetchClaudeUsage()
    if (get().claudeUsageRemoteConnectionId) {
      await get().fetchClaudeUsageRemote(get().claudeUsageRemoteConnectionId as string)
    }
  },

  setClaudeUsageRange: async (range) => {
    set({ claudeUsageRange: range })
    await get().fetchClaudeUsage()
    if (get().claudeUsageRemoteConnectionId) {
      await get().fetchClaudeUsageRemote(get().claudeUsageRemoteConnectionId as string)
    }
  },

  fetchClaudeUsage: async (opts) => {
    try {
      const scanState = (await window.api.claudeUsage.getScanState()) as ClaudeUsageScanState
      const currentScanState = get().claudeUsageScanState
      const shouldPreserveLoadingState =
        opts?.forceRefresh === true &&
        currentScanState?.enabled === true &&
        get().claudeUsageSummary === null
      set({
        claudeUsageScanState: shouldPreserveLoadingState
          ? {
              ...scanState,
              isScanning: true,
              lastScanCompletedAt: null,
              lastScanError: null
            }
          : scanState
      })
      if (!scanState.enabled) {
        return
      }

      const { claudeUsageScope, claudeUsageRange } = get()
      const snapshot = (await window.api.claudeUsage.getSnapshot({
        scope: claudeUsageScope,
        range: claudeUsageRange,
        limit: 10
      })) as ClaudeUsageSnapshot
      const hasCachedSnapshot =
        snapshot.scanState.lastScanCompletedAt !== null || snapshot.scanState.hasAnyClaudeData

      if (hasCachedSnapshot) {
        set({
          claudeUsageScanState:
            opts?.forceRefresh === true
              ? { ...snapshot.scanState, isScanning: true }
              : snapshot.scanState,
          claudeUsageSummary: snapshot.summary,
          claudeUsageDaily: snapshot.daily,
          claudeUsageModelBreakdown: snapshot.modelBreakdown,
          claudeUsageProjectBreakdown: snapshot.projectBreakdown,
          claudeUsageRecentSessions: snapshot.recentSessions
        })
      } else {
        set({
          claudeUsageScanState: {
            ...scanState,
            isScanning: true,
            lastScanError: null
          }
        })
      }

      await window.api.claudeUsage.refresh({
        force: opts?.forceRefresh ?? false
      })
      const { claudeUsageScope: refreshedScope, claudeUsageRange: refreshedRange } = get()
      const refreshedSnapshot = (await window.api.claudeUsage.getSnapshot({
        scope: refreshedScope,
        range: refreshedRange,
        limit: 10
      })) as ClaudeUsageSnapshot

      set({
        claudeUsageScanState: refreshedSnapshot.scanState,
        claudeUsageSummary: refreshedSnapshot.summary,
        claudeUsageDaily: refreshedSnapshot.daily,
        claudeUsageModelBreakdown: refreshedSnapshot.modelBreakdown,
        claudeUsageProjectBreakdown: refreshedSnapshot.projectBreakdown,
        claudeUsageRecentSessions: refreshedSnapshot.recentSessions
      })
    } catch (error) {
      console.error('Failed to fetch Claude usage:', error)
    }
  },

  enableClaudeUsage: async () => {
    await get().setClaudeUsageEnabled(true)
  },

  refreshClaudeUsage: async () => {
    await get().fetchClaudeUsage({ forceRefresh: true })
  },

  fetchClaudeUsageRemote: async (connectionId) => {
    set({
      claudeUsageRemoteConnectionId: connectionId,
      claudeUsageRemoteScanning: true,
      claudeUsageRemoteError: null,
      claudeUsageRemoteSnapshot: null
    })
    try {
      const { claudeUsageScope, claudeUsageRange } = get()
      const result = (await window.api.claudeUsage.scanRemote({
        connectionId,
        scope: claudeUsageScope,
        range: claudeUsageRange
      })) as ClaudeUsageRemoteScanResult
      if (result.ok) {
        set({
          claudeUsageRemoteSnapshot: result.snapshot,
          claudeUsageRemoteScanning: false
        })
      } else {
        set({ claudeUsageRemoteError: result.error, claudeUsageRemoteScanning: false })
      }
    } catch (error) {
      set({
        claudeUsageRemoteError: error instanceof Error ? error.message : String(error),
        claudeUsageRemoteScanning: false
      })
    }
  },

  clearClaudeUsageRemote: () => {
    set({
      claudeUsageRemoteConnectionId: null,
      claudeUsageRemoteSnapshot: null,
      claudeUsageRemoteError: null,
      claudeUsageRemoteScanning: false
    })
  }
})
