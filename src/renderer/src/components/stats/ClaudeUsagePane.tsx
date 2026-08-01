import { useEffect, useState } from 'react'
import { RefreshCw, Server, SlidersHorizontal } from 'lucide-react'
import type {
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSummary
} from '../../../../shared/claude-usage-types'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { ClaudeUsageDetails } from './ClaudeUsageDetails'
import { ClaudeUsageLoadingState } from './ClaudeUsageLoadingState'
import { ClaudeUsageStatCards } from './ClaudeUsageStatCards'
import { ShareUsageButton } from './ShareUsageButton'
import { formatUpdatedAt } from './usage-formatters'
import { translate } from '@/i18n/i18n'

const RANGE_OPTIONS: ClaudeUsageRange[] = ['7d', '30d', '90d', 'all']
const SCOPE_OPTIONS: { value: ClaudeUsageScope; label: string }[] = [
  {
    value: 'orca',
    get label() {
      return translate('auto.components.stats.ClaudeUsagePane.4f8368c272', 'Orca worktrees only')
    }
  },
  {
    value: 'all',
    get label() {
      return translate('auto.components.stats.ClaudeUsagePane.5ce4842c2c', 'All local Claude usage')
    }
  }
]
const RANGE_LABELS: Record<ClaudeUsageRange, string> = {
  get '7d'() {
    return translate('auto.components.stats.ClaudeUsagePane.rangeLast7Days', 'Last 7 days')
  },
  get '30d'() {
    return translate('auto.components.stats.ClaudeUsagePane.rangeLast30Days', 'Last 30 days')
  },
  get '90d'() {
    return translate('auto.components.stats.ClaudeUsagePane.rangeLast90Days', 'Last 90 days')
  },
  get all() {
    return translate('auto.components.stats.ClaudeUsagePane.rangeAllTime', 'All time')
  }
}

type RemoteTarget = {
  id: string
  label: string
}

export function ClaudeUsagePane(): React.JSX.Element {
  const localScanState = useAppStore((state) => state.claudeUsageScanState)
  const localSummary = useAppStore((state) => state.claudeUsageSummary)
  const localDaily = useAppStore((state) => state.claudeUsageDaily)
  const localModelBreakdown = useAppStore((state) => state.claudeUsageModelBreakdown)
  const localProjectBreakdown = useAppStore((state) => state.claudeUsageProjectBreakdown)
  const localRecentSessions = useAppStore((state) => state.claudeUsageRecentSessions)
  const scope = useAppStore((state) => state.claudeUsageScope)
  const range = useAppStore((state) => state.claudeUsageRange)
  const fetchClaudeUsage = useAppStore((state) => state.fetchClaudeUsage)
  const setClaudeUsageEnabled = useAppStore((state) => state.setClaudeUsageEnabled)
  const refreshClaudeUsage = useAppStore((state) => state.refreshClaudeUsage)
  const setClaudeUsageScope = useAppStore((state) => state.setClaudeUsageScope)
  const setClaudeUsageRange = useAppStore((state) => state.setClaudeUsageRange)
  const recordFeatureInteraction = useAppStore((state) => state.recordFeatureInteraction)
  const remoteConnectionId = useAppStore((state) => state.claudeUsageRemoteConnectionId)
  const remoteSnapshot = useAppStore((state) => state.claudeUsageRemoteSnapshot)
  const remoteError = useAppStore((state) => state.claudeUsageRemoteError)
  const remoteScanning = useAppStore((state) => state.claudeUsageRemoteScanning)
  const fetchClaudeUsageRemote = useAppStore((state) => state.fetchClaudeUsageRemote)
  const clearClaudeUsageRemote = useAppStore((state) => state.clearClaudeUsageRemote)

  const [remoteTargets, setRemoteTargets] = useState<RemoteTarget[]>([])

  useEffect(() => {
    void fetchClaudeUsage()
  }, [fetchClaudeUsage])

  // Why: only connected SSH targets can be scanned remotely, so resolve their
  // live connection status on mount rather than offering stale/disconnected hosts.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const targets = await window.api.ssh.listTargets()
        const resolved = await Promise.all(
          targets
            .filter((target) => !target.owner)
            .map(async (target) => {
              const connectionState = await window.api.ssh.getState({ targetId: target.id })
              return {
                id: target.id,
                label: target.label || target.host,
                connected: connectionState?.status === 'connected'
              }
            })
        )
        if (cancelled) {
          return
        }
        setRemoteTargets(resolved.filter((target) => target.connected))
      } catch {
        if (!cancelled) {
          setRemoteTargets([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const isRemote = remoteConnectionId !== null
  const summary: ClaudeUsageSummary | null = isRemote ? (remoteSnapshot?.summary ?? null) : localSummary
  const daily: ClaudeUsageDailyPoint[] = isRemote ? (remoteSnapshot?.daily ?? []) : localDaily
  const modelBreakdown: ClaudeUsageBreakdownRow[] = isRemote
    ? (remoteSnapshot?.modelBreakdown ?? [])
    : localModelBreakdown
  const projectBreakdown: ClaudeUsageBreakdownRow[] = isRemote
    ? (remoteSnapshot?.projectBreakdown ?? [])
    : localProjectBreakdown
  const recentSessions: ClaudeUsageSessionRow[] = isRemote
    ? (remoteSnapshot?.recentSessions ?? [])
    : localRecentSessions
  const isScanning = isRemote ? remoteScanning : (localScanState?.isScanning ?? false)
  const lastScanError = isRemote ? remoteError : (localScanState?.lastScanError ?? null)
  const lastScanCompletedAt = isRemote
    ? (remoteSnapshot?.scanState.lastScanCompletedAt ?? null)
    : (localScanState?.lastScanCompletedAt ?? null)

  const handleSetEnabled = (enabled: boolean): void => {
    recordFeatureInteraction('usage-tracking')
    void setClaudeUsageEnabled(enabled)
  }

  const handleRemoteTargetChange = (nextConnectionId: string): void => {
    recordFeatureInteraction('usage-tracking')
    if (nextConnectionId === '') {
      clearClaudeUsageRemote()
      return
    }
    void fetchClaudeUsageRemote(nextConnectionId)
  }

  if (!localScanState?.enabled) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {translate(
                'auto.components.stats.ClaudeUsagePane.6afacbee37',
                'Claude Usage Tracking'
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {translate(
                'auto.components.stats.ClaudeUsagePane.0cb1a36d7d',
                'Reads local Claude usage logs to show token, model, and session stats.'
              )}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={false}
            aria-label={translate(
              'auto.components.stats.ClaudeUsagePane.424cd50412',
              'Enable Claude usage analytics'
            )}
            onClick={() => handleSetEnabled(true)}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-muted-foreground/30 transition-colors"
          >
            <span className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform" />
          </button>
        </div>
      </div>
    )
  }

  if (
    !isRemote &&
    !localSummary &&
    (localScanState.isScanning || localScanState.lastScanCompletedAt === null)
  ) {
    return <ClaudeUsageLoadingState />
  }

  if (isRemote && remoteScanning && !remoteSnapshot) {
    return <ClaudeUsageLoadingState />
  }

  const hasAnyData = summary?.hasAnyClaudeData ?? false

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.ClaudeUsagePane.6afacbee37', 'Claude Usage Tracking')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isRemote
              ? translate('auto.components.stats.ClaudeUsagePane.remoteServerPrefix', 'Remote server')
              : formatUpdatedAt(lastScanCompletedAt)}
            {lastScanError
              ? translate(
                  'auto.components.stats.ClaudeUsagePane.2d41fd45c6',
                  ' • Last scan error: {{value0}}',
                  { value0: lastScanError }
                )
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          {summary && daily.length > 0 && (
            <ShareUsageButton provider="claude" summary={summary} daily={daily} range={range} />
          )}
          <DropdownMenu>
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={translate(
                        'auto.components.stats.ClaudeUsagePane.e9bf9fce0e',
                        'Claude usage options'
                      )}
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate('auto.components.stats.ClaudeUsagePane.dd29209b21', 'Filters')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                {translate('auto.components.stats.ClaudeUsagePane.f61cffb9c8', 'Scope')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={scope}
                onValueChange={(value) => void setClaudeUsageScope(value as ClaudeUsageScope)}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {translate('auto.components.stats.ClaudeUsagePane.505be9aac4', 'Range')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={range}
                onValueChange={(value) => void setClaudeUsageRange(value as ClaudeUsageRange)}
              >
                {RANGE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {RANGE_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    if (isRemote && remoteConnectionId) {
                      void fetchClaudeUsageRemote(remoteConnectionId)
                    } else {
                      void refreshClaudeUsage()
                    }
                  }}
                  disabled={isScanning}
                  aria-label={translate(
                    'auto.components.stats.ClaudeUsagePane.c5b9b344d0',
                    'Refresh Claude usage'
                  )}
                >
                  <RefreshCw className={`size-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate('auto.components.stats.ClaudeUsagePane.8d18bbb771', 'Refresh')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            type="button"
            role="switch"
            aria-checked={true}
            aria-label={translate(
              'auto.components.stats.ClaudeUsagePane.424cd50412',
              'Enable Claude usage analytics'
            )}
            onClick={() => handleSetEnabled(false)}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-foreground transition-colors"
          >
            <span className="pointer-events-none block size-3.5 translate-x-4 rounded-full bg-background shadow-sm transition-transform" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Server className="size-3.5 text-muted-foreground" />
          <select
            value={remoteConnectionId ?? ''}
            onChange={(event) => handleRemoteTargetChange(event.target.value)}
            className="h-7 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground"
            aria-label={translate(
              'auto.components.stats.ClaudeUsagePane.remoteSourceLabel',
              'Usage source'
            )}
          >
            <option value="">
              {translate('auto.components.stats.ClaudeUsagePane.thisMachine', 'This machine')}
            </option>
            {remoteTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          {SCOPE_OPTIONS.find((option) => option.value === scope)?.label} • {RANGE_LABELS[range]}
        </p>
      </div>

      {!hasAnyData ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-6 text-sm text-muted-foreground">
          {remoteTargets.length === 0 && isRemote
            ? translate(
                'auto.components.stats.ClaudeUsagePane.noConnectedServers',
                'No connected remote server. Connect an SSH target to scan its usage.'
              )
            : translate(
                'auto.components.stats.ClaudeUsagePane.7dde9331fd',
                'No local Claude usage found yet for this scope.'
              )}
        </div>
      ) : (
        <>
          <ClaudeUsageStatCards summary={summary} />

          <ClaudeUsageDetails
            daily={daily}
            modelBreakdown={modelBreakdown}
            projectBreakdown={projectBreakdown}
            recentSessions={recentSessions}
            summary={summary}
          />
        </>
      )}
    </div>
  )
}
