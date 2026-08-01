import {
  Activity,
  Coins,
  DatabaseZap,
  FolderKanban,
  Gauge,
  Sparkles,
  Waypoints
} from 'lucide-react'
import type { ClaudeUsageSummary } from '../../../../shared/claude-usage-types'
import { StatCard } from './StatCard'
import { formatCost, formatTokens } from './usage-formatters'
import { translate } from '@/i18n/i18n'

export function ClaudeUsageStatCards({
  summary
}: {
  summary: ClaudeUsageSummary | null
}): React.JSX.Element {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={translate('auto.components.stats.ClaudeUsagePane.ea71fae8fc', 'Input tokens')}
          value={formatTokens(summary?.inputTokens ?? 0)}
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label={translate('auto.components.stats.ClaudeUsagePane.2b8a2f14aa', 'Output tokens')}
          value={formatTokens(summary?.outputTokens ?? 0)}
          icon={<Activity className="size-4" />}
        />
        <StatCard
          label={translate('auto.components.stats.ClaudeUsagePane.268cf0af51', 'Cache read')}
          value={formatTokens(summary?.cacheReadTokens ?? 0)}
          icon={<DatabaseZap className="size-4" />}
        />
        <StatCard
          label={translate('auto.components.stats.ClaudeUsagePane.b786fb4a70', 'Cache write')}
          value={formatTokens(summary?.cacheWriteTokens ?? 0)}
          icon={<Waypoints className="size-4" />}
        />
        <StatCard
          label={translate(
            'auto.components.stats.ClaudeUsagePane.1634c4f404',
            'Cache reuse rate'
          )}
          value={
            summary?.cacheReuseRate !== null && summary?.cacheReuseRate !== undefined
              ? `${Math.round(summary.cacheReuseRate * 100)}%`
              : 'n/a'
          }
          icon={<Gauge className="size-4" />}
        />
        <StatCard
          label={translate(
            'auto.components.stats.ClaudeUsagePane.8cc23be4a3',
            'Zero-cache-read turns'
          )}
          value={
            summary && summary.turns > 0
              ? `${Math.round((summary.zeroCacheReadTurns / summary.turns) * 100)}%`
              : 'n/a'
          }
          icon={<DatabaseZap className="size-4" />}
        />
        <StatCard
          label={translate('auto.components.stats.ClaudeUsagePane.0f3e696ca9', 'Sessions / Turns')}
          value={`${(summary?.sessions ?? 0).toLocaleString()} / ${(summary?.turns ?? 0).toLocaleString()}`}
          icon={<FolderKanban className="size-4" />}
        />
        <StatCard
          label={translate(
            'auto.components.stats.ClaudeUsagePane.b26d4ddb58',
            'Est. API-equivalent cost'
          )}
          value={formatCost(summary?.estimatedCostUsd ?? null)}
          icon={<Coins className="size-4" />}
        />
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {translate(
          'auto.components.stats.ClaudeUsagePane.51ae85fa00',
          'Cache reuse rate is calculated as cache read tokens / (input tokens + cache read tokens).'
        )}
      </p>
    </>
  )
}
