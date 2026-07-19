import './pill.css'

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  StatusPillAgentRow,
  StatusPillAnswerResult,
  StatusPillPreferences,
  StatusPillPreloadApi,
  StatusPillSummary
} from '../../shared/status-pill-preload-api'
import { EMPTY_STATUS_PILL_SUMMARY } from '../../shared/status-pill-preload-api'
import { AgentRowView } from './agent-row'
import { PendingQuestionCard } from './pending-question-card'
import { buildPanelTitle, pickTone, type Tone } from './status-pill-formatters'

// Why: mirror the main-side PILL_WINDOW_PADDING_* constants (placement.ts) so
// the renderer-side window size sent via statusPill:resize accounts for the
// shadow halo. They are duplicated (not imported) because the placement
// module imports Electron types that the renderer sandbox cannot see.
const PILL_RENDERER_PADDING_X = 18
const PILL_RENDERER_PADDING_TOP = 6
const PILL_RENDERER_PADDING_BOTTOM = 34

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    api: StatusPillPreloadApi | undefined
  }
}

const EMPTY_SUMMARY = EMPTY_STATUS_PILL_SUMMARY

/** Pill root: subscribes to main's snapshot/rows push channels, manages
 *  expand/collapse state, routes answer clicks to preload.answerQuestion. */
function StatusPill(): React.JSX.Element {
  const api = window.api
  const [summary, setSummary] = useState<StatusPillSummary>(EMPTY_SUMMARY)
  const [rows, setRows] = useState<StatusPillAgentRow[]>([])
  const [preferences, setPreferences] = useState<StatusPillPreferences | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [entered, setEntered] = useState(false)
  const [answeringPaneKey, setAnsweringPaneKey] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)

  // Why: keep a stable ref to the pill-stack so the ResizeObserver can
  // re-attach without re-creating the observer on every render.
  const stackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!api) {
      return
    }
    let mounted = true
    const unsubSummary = api.onSnapshot((next) => {
      if (mounted) {
        setSummary(next)
      }
    })
    const unsubRows = api.onAgentRows((next) => {
      if (mounted) {
        setRows(next)
      }
    })
    void api.getSnapshot().then((snapshot) => {
      if (mounted) {
        setSummary(snapshot)
      }
    })
    void api.getAgentRows().then((snapshotRows) => {
      if (mounted) {
        setRows(snapshotRows)
      }
    })
    void api.getInitialPreferences().then((prefs) => {
      if (mounted) {
        setPreferences(prefs)
      }
    })
    const enterRaf = window.requestAnimationFrame(() => {
      if (mounted) {
        setEntered(true)
      }
    })
    return () => {
      mounted = false
      unsubSummary()
      unsubRows()
      window.cancelAnimationFrame(enterRaf)
    }
  }, [api])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const apply = (): void => {
        setPreferences((prev) => ({
          shouldUseDarkColors: prev?.shouldUseDarkColors ?? false,
          prefersReducedMotion: mq.matches
        }))
      }
      apply()
      try {
        mq.addEventListener('change', apply)
      } catch {
        mq.addListener(apply)
      }
      return () => {
        try {
          mq.removeEventListener('change', apply)
        } catch {
          mq.removeListener(apply)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      (window as Window & { __orcaPillDebugExpand?: boolean }).__orcaPillDebugExpand === true
    ) {
      setExpanded(true)
    }
  }, [])

  // Why: auto-expand the panel when a pending question lands, so the user
  // notices the prompt without having to hover. Stay expanded until the
  // pending question clears. Depends on paneKey + interactivePrompt string
  // rather than the object reference so identical content doesn't loop.
  const pendingKey = summary.pendingQuestion?.paneKey
  const pendingPayload = summary.pendingQuestion?.interactivePrompt
  useEffect(() => {
    if (pendingKey && pendingPayload) {
      setExpanded(true)
    }
  }, [pendingKey, pendingPayload])

  useEffect(() => {
    setAnswerError(null)
  }, [pendingKey])

  useEffect(() => {
    const isDark = preferences?.shouldUseDarkColors ?? false
    document.documentElement.classList.toggle('dark', isDark)
  }, [preferences?.shouldUseDarkColors])

  // Why: measure the live .pill-stack size and ask main to resize the
  // BrowserWindow so the capsule + expanded panel always have room to render
  // without clipping. Grow immediately, shrink on a 250 ms delay so the CSS
  // collapse animation has time to finish before the window shrinks (avoids
  // one-frame flicker where the panel content gets cut mid-animation).
  useEffect(() => {
    if (!api || !stackRef.current) {
      return
    }
    const element = stackRef.current
    let lastWidth = 0
    let lastHeight = 0
    let shrinkTimer: ReturnType<typeof setTimeout> | null = null
    const flush = (width: number, height: number): void => {
      if (width === lastWidth && height === lastHeight) {
        return
      }
      lastWidth = width
      lastHeight = height
      api.resize(width, height)
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      // Why: include the content rect + the renderer-side padding (CSS pixels
      // matching the main-side PILL_WINDOW_PADDING_* constants) so the
      // shadow halo still has room when the window grows.
      const nextWidth = Math.ceil(entry.contentRect.width + PILL_RENDERER_PADDING_X * 2)
      const nextHeight = Math.ceil(
        entry.contentRect.height + PILL_RENDERER_PADDING_TOP + PILL_RENDERER_PADDING_BOTTOM
      )
      const growing = nextWidth > lastWidth || nextHeight > lastHeight
      if (shrinkTimer !== null) {
        clearTimeout(shrinkTimer)
        shrinkTimer = null
      }
      if (growing) {
        flush(nextWidth, nextHeight)
      } else {
        // Why: delay the shrink so the panel's CSS collapse animation
        // completes before the window clips its bounds.
        shrinkTimer = setTimeout(() => {
          shrinkTimer = null
          flush(nextWidth, nextHeight)
        }, 260)
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (shrinkTimer !== null) {
        clearTimeout(shrinkTimer)
        shrinkTimer = null
      }
    }
  }, [api])

  // Why: default window state is click-through (setIgnoreMouseEvents true on
  // transparent pixels). When the cursor enters the interactive region, tell
  // main to disable click-through so the capsule/buttons receive mouse
  // events normally. On leave, re-enable click-through.
  const onStackMouseEnter = (): void => {
    api?.setInteractive(true)
  }
  const onStackMouseLeave = (): void => {
    api?.setInteractive(false)
  }

  const tone = pickTone(summary)
  const pulse =
    preferences?.prefersReducedMotion !== true &&
    (summary.working > 0 || summary.blocked > 0 || summary.waiting > 0)

  const handleAnswer = async (paneKey: string, raw: string): Promise<void> => {
    if (!api) {
      return
    }
    setAnsweringPaneKey(paneKey)
    setAnswerError(null)
    try {
      const result: StatusPillAnswerResult = await api.answerQuestion(paneKey, raw)
      if (!result.accepted) {
        setAnswerError(result.error ?? 'send_failed')
      }
    } catch {
      setAnswerError('send_failed')
    } finally {
      setAnsweringPaneKey(null)
    }
  }

  return (
    <div
      ref={stackRef}
      className={`pill-stack ${entered ? 'pill-enter' : ''}`}
      onMouseEnter={() => {
        setExpanded(true)
        onStackMouseEnter()
      }}
      onMouseLeave={() => {
        setExpanded(false)
        onStackMouseLeave()
      }}
    >
      <PillBody
        tone={tone}
        pulse={pulse}
        summary={summary}
        onClick={() => window.api?.fireClick()}
        onContextMenu={(event) => {
          event.preventDefault()
          window.api?.fireContextMenu()
        }}
      />
      {expanded && (summary.pendingQuestion || rows.length > 0) ? (
        <AgentPanel
          summary={summary}
          rows={rows}
          tone={tone}
          pulse={pulse}
          onAnswer={handleAnswer}
          answeringPaneKey={answeringPaneKey}
          answerError={answerError}
        />
      ) : null}
      <StyleBaseline />
    </div>
  )
}

/** Resting capsule: indicator dot + counts + activity label. Keyboard-
 *  operable (Enter / Space) per the WAI-ARIA button pattern. */
function PillBody({
  tone,
  pulse,
  summary,
  onClick,
  onContextMenu
}: {
  tone: Tone
  pulse: boolean
  summary: StatusPillSummary
  onClick: () => void
  onContextMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  // Why: keyboard activation (Enter / Space) so screen-reader and keyboard
  // users can focus the pill via Tab and trigger the click handler. The pill
  // div is `role="button"` so this matches the WAI-ARIA button pattern.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Orca agent status"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className={`pill pill-${tone} ${pulse ? 'pill-pulse' : ''}`}
    >
      <span className="indicator" aria-hidden="true">
        <span className="indicator-ring" />
        <span className="indicator-dot" />
      </span>
      {summary.hasAnyActivity ? (
        <span className="counts">
          {summary.working > 0 ? <CountGroup kind="working" value={summary.working} /> : null}
          {summary.blocked > 0 ? <CountGroup kind="blocked" value={summary.blocked} /> : null}
          {summary.waiting > 0 ? <CountGroup kind="waiting" value={summary.waiting} /> : null}
          {summary.recentDone > 0 ? <CountGroup kind="done" value={summary.recentDone} /> : null}
        </span>
      ) : null}
      {summary.activityLabel ? (
        <>
          <span className="divider" />
          <span className="label" title={summary.activityLabel}>
            {summary.activityLabel}
          </span>
        </>
      ) : (
        <span className="label label-idle">No recent activity</span>
      )}
    </div>
  )
}

function CountGroup({
  kind,
  value
}: {
  kind: 'working' | 'blocked' | 'waiting' | 'done'
  value: number
}): React.JSX.Element {
  return (
    <span className="count-group">
      <span className={`count-dot count-dot-${kind}`} />
      <span className="count-value">{value}</span>
    </span>
  )
}

/** Expanded glass panel rendered below the pill on hover or pending question.
 *  Hosts the question/approval card (when present) + the multi-agent list. */
function AgentPanel({
  summary,
  rows,
  tone,
  pulse,
  onAnswer,
  answeringPaneKey,
  answerError
}: {
  summary: StatusPillSummary
  rows: StatusPillAgentRow[]
  tone: Tone
  pulse: boolean
  onAnswer: (paneKey: string, raw: string) => Promise<void>
  answeringPaneKey: string | null
  answerError: string | null
}): React.JSX.Element {
  const total = summary.working + summary.blocked + summary.waiting + summary.recentDone
  const title = summary.pendingQuestion ? 'Agent needs you' : buildPanelTitle(summary)
  return (
    <div className="panel" role="dialog" aria-label="Orca agents">
      <div className="panel-head">
        <span className={`indicator pill-${tone} ${pulse ? 'pill-pulse' : ''}`} aria-hidden="true">
          <span className="indicator-ring" />
          <span className="indicator-dot" />
        </span>
        <span className="panel-title">{title}</span>
        <span className="panel-meta">
          {total} session{total === 1 ? '' : 's'}
        </span>
      </div>
      {summary.pendingQuestion ? (
        <PendingQuestionCard
          pending={summary.pendingQuestion}
          onAnswer={onAnswer}
          submitting={answeringPaneKey === summary.pendingQuestion.paneKey}
          error={answerError}
        />
      ) : null}
      <div className="agent-list">
        {rows.map((row, index) => (
          <AgentRowView key={`${row.paneKey}-${row.receivedAt}`} row={row} index={index} />
        ))}
      </div>
    </div>
  )
}

function StyleBaseline(): React.JSX.Element {
  return (
    <style>{`
      .pill-stack {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        width: max-content;
        max-width: 460px;
      }
    `}</style>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Status pill root element not found.')
}
createRoot(rootElement).render(<StatusPill />)
