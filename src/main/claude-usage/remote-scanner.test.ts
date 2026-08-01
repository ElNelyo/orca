import { describe, expect, it } from 'vitest'
import type { FileReadResult, FileStat, IFilesystemProvider } from '../providers/types'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { UsageFilesystem } from './usage-filesystem'
import { buildClaudeUsageRemoteRoots, createSshUsageFilesystem } from './usage-filesystem'
import { scanClaudeUsageFiles, type ClaudeUsageWorktreeRef } from './scanner'
import { scanClaudeUsageFilesRemote } from './remote-scanner'
import { buildClaudeUsageSnapshotFromScan } from './store'
import type { ClaudeUsageDailyAggregate, ClaudeUsageSession } from './types'

type FakeFile = { content: string; mtimeMs: number; size: number }

function createFakeUsageFilesystem(files: Record<string, FakeFile>): UsageFilesystem {
  const paths = Object.keys(files)
  return {
    async readDir(dirPath) {
      const normalized = dirPath.replace(/\/+$/, '')
      const children = new Map<string, { name: string; isDirectory: boolean; isFile: boolean }>()
      for (const p of paths) {
        if (!p.startsWith(`${normalized}/`)) {
          continue
        }
        const rest = p.slice(normalized.length + 1)
        const firstSeg = rest.split('/')[0]
        if (!firstSeg || children.has(firstSeg)) {
          continue
        }
        const isDir = rest.includes('/')
        children.set(firstSeg, { name: firstSeg, isDirectory: isDir, isFile: !isDir })
      }
      return [...children.values()]
    },
    async stat(filePath) {
      const file = files[filePath]
      if (!file) {
        throw new Error(`ENOENT ${filePath}`)
      }
      return { mtimeMs: file.mtimeMs, size: file.size }
    },
    async readLines(filePath) {
      const file = files[filePath]
      const content = file ? file.content : ''
      return (async function* () {
        if (content === '') {
          return
        }
        const trimmed = content.replace(/\r?\n$/, '')
        for (const line of trimmed.split(/\r?\n/)) {
          yield line
        }
      })()
    },
    async realpath(pathValue) {
      return pathValue
    }
  }
}

function assistantTurn(
  sessionId: string,
  inputTokens: number,
  cwd: string,
  model = 'claude-sonnet-4-6'
): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp: '2026-04-09T10:00:00.000Z',
    cwd,
    message: {
      id: `msg_${sessionId}`,
      model,
      usage: { input_tokens: inputTokens, output_tokens: 20 }
    }
  })
}

const REMOTE_WORKTREES: ClaudeUsageWorktreeRef[] = [
  {
    repoId: 'r1',
    worktreeId: 'r1::/home/remote/work/repo-a',
    path: '/home/remote/work/repo-a',
    displayName: 'Repo A'
  }
]

describe('scanClaudeUsageFiles with an injected (remote) filesystem', () => {
  it('parses and attributes transcripts read through the abstract filesystem', async () => {
    const fs = createFakeUsageFilesystem({
      '/home/remote/.claude/projects/proj-a/sess-1.jsonl': {
        content: assistantTurn('sess-1', 100, '/home/remote/work/repo-a'),
        mtimeMs: 1000,
        size: 10
      }
    })

    const result = await scanClaudeUsageFiles(REMOTE_WORKTREES, [], {
      filesystem: fs,
      roots: ['/home/remote/.claude/projects']
    })

    expect(result.sessions.map((session) => session.sessionId)).toEqual(['sess-1'])
    expect(result.dailyAggregates).toHaveLength(1)
    expect(result.dailyAggregates[0]?.inputTokens).toBe(100)
    expect(result.dailyAggregates[0]?.worktreeId).toBe('r1::/home/remote/work/repo-a')
    expect(result.processedFiles[0]?.lineCount).toBe(1)
  })

  it('reuses unchanged transcript projections across remote scans', async () => {
    const fs = createFakeUsageFilesystem({
      '/home/remote/.claude/projects/proj-a/sess-1.jsonl': {
        content: assistantTurn('sess-1', 100, '/home/remote/work/repo-a'),
        mtimeMs: 1000,
        size: 10
      }
    })

    const first = await scanClaudeUsageFiles(REMOTE_WORKTREES, [], {
      filesystem: fs,
      roots: ['/home/remote/.claude/projects']
    })
    const cached = structuredClone(first.processedFiles[0]!)
    cached.sessions[0]!.totalInputTokens = 999
    cached.dailyAggregates[0]!.inputTokens = 999

    const second = await scanClaudeUsageFiles(REMOTE_WORKTREES, [cached], {
      filesystem: fs,
      roots: ['/home/remote/.claude/projects']
    })

    expect(second.processedFiles[0]).toBe(cached)
    expect(second.dailyAggregates[0]?.inputTokens).toBe(999)
  })
})

describe('createSshUsageFilesystem', () => {
  function createFakeProvider(files: Record<string, FakeFile>): IFilesystemProvider {
    return {
      async readDir(dirPath) {
        const fs = createFakeUsageFilesystem(files)
        const entries = await fs.readDir(dirPath)
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: false
        }))
      },
      async readFile(filePath): Promise<FileReadResult> {
        const file = files[filePath]
        return { content: file ? file.content : '', isBinary: false }
      },
      async stat(filePath): Promise<FileStat> {
        const file = files[filePath]
        if (!file) {
          throw new Error(`ENOENT ${filePath}`)
        }
        return { type: 'file', size: file.size, mtime: file.mtimeMs, mtimeMs: file.mtimeMs }
      },
      async realpath(pathValue) {
        return pathValue
      }
    } as IFilesystemProvider
  }

  it('adapts an SSH filesystem provider into a UsageFilesystem', async () => {
    const provider = createFakeProvider({
      '/home/remote/.claude/projects/p/s.jsonl': {
        content: `${assistantTurn('s', 50, '/home/remote/work/repo-a')}\n`,
        mtimeMs: 2000,
        size: 12
      }
    })
    const fs = createSshUsageFilesystem(provider)

    const entries = await fs.readDir('/home/remote/.claude/projects/p')
    expect(entries).toEqual([{ name: 's.jsonl', isDirectory: false, isFile: true }])

    const stat = await fs.stat('/home/remote/.claude/projects/p/s.jsonl')
    expect(stat).toEqual({ mtimeMs: 2000, size: 12 })

    // Why: a single trailing newline must not become an extra blank line, so
    // remote line counts match the local readline-based parser.
    const lines: string[] = []
    for await (const line of await fs.readLines('/home/remote/.claude/projects/p/s.jsonl')) {
      lines.push(line)
    }
    expect(lines).toHaveLength(1)
  })
})

describe('buildClaudeUsageRemoteRoots', () => {
  it('joins posix remote home paths', () => {
    const roots = buildClaudeUsageRemoteRoots('/home/user', getRemoteHostPlatform('linux-x64'))
    expect(roots).toEqual(['/home/user/.claude/projects', '/home/user/.claude/transcripts'])
  })

  it('normalizes windows remote home paths', () => {
    const roots = buildClaudeUsageRemoteRoots('C:\\Users\\user', getRemoteHostPlatform('win32-x64'))
    expect(roots).toEqual(['C:/Users/user/.claude/projects', 'C:/Users/user/.claude/transcripts'])
  })
})

describe('scanClaudeUsageFilesRemote', () => {
  it('runs the scan pipeline over an SSH provider', async () => {
    const provider = {
      async readDir(dirPath: string) {
        const fs = createFakeUsageFilesystem({
          '/home/remote/.claude/projects/proj-a/sess-1.jsonl': {
            content: assistantTurn('sess-1', 80, '/home/remote/work/repo-a'),
            mtimeMs: 1500,
            size: 11
          }
        })
        return (await fs.readDir(dirPath)).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: false
        }))
      },
      async readFile(_filePath: string): Promise<FileReadResult> {
        return {
          content: assistantTurn('sess-1', 80, '/home/remote/work/repo-a'),
          isBinary: false
        }
      },
      async stat(_filePath: string): Promise<FileStat> {
        return { type: 'file', size: 11, mtime: 1500, mtimeMs: 1500 }
      },
      async realpath(pathValue: string) {
        return pathValue
      }
    } as unknown as IFilesystemProvider

    const result = await scanClaudeUsageFilesRemote({
      provider,
      remoteHome: '/home/remote',
      hostPlatform: getRemoteHostPlatform('linux-x64'),
      worktrees: REMOTE_WORKTREES
    })

    expect(result.sessions.map((session) => session.sessionId)).toEqual(['sess-1'])
    expect(result.dailyAggregates[0]?.inputTokens).toBe(80)
  })
})

describe('buildClaudeUsageSnapshotFromScan', () => {
  it('builds a snapshot with summary, breakdowns, and recent sessions', () => {
    const sessions: ClaudeUsageSession[] = [
      {
        sessionId: 'sess-1',
        firstTimestamp: '2026-04-09T10:00:00.000Z',
        lastTimestamp: '2026-04-09T10:30:00.000Z',
        model: 'claude-sonnet-4-6',
        lastCwd: '/home/remote/work/repo-a',
        lastGitBranch: 'main',
        primaryWorktreeId: 'r1::/home/remote/work/repo-a',
        primaryRepoId: 'r1',
        turnCount: 2,
        totalInputTokens: 200,
        totalOutputTokens: 40,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        locationBreakdown: [
          {
            locationKey: 'worktree:r1::/home/remote/work/repo-a',
            projectLabel: 'Repo A',
            repoId: 'r1',
            worktreeId: 'r1::/home/remote/work/repo-a',
            turnCount: 2,
            inputTokens: 200,
            outputTokens: 40,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          }
        ]
      }
    ]
    const dailyAggregates: ClaudeUsageDailyAggregate[] = [
      {
        day: '2026-04-09',
        model: 'claude-sonnet-4-6',
        projectKey: 'worktree:r1::/home/remote/work/repo-a',
        projectLabel: 'Repo A',
        repoId: 'r1',
        worktreeId: 'r1::/home/remote/work/repo-a',
        turnCount: 2,
        zeroCacheReadTurnCount: 2,
        inputTokens: 200,
        outputTokens: 40,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      }
    ]

    const snapshot = buildClaudeUsageSnapshotFromScan({ sessions, dailyAggregates }, 'all', 'all')

    expect(snapshot.summary.sessions).toBe(1)
    expect(snapshot.summary.turns).toBe(2)
    expect(snapshot.summary.inputTokens).toBe(200)
    expect(snapshot.summary.estimatedCostUsd).not.toBeNull()
    expect(snapshot.scanState.hasAnyClaudeData).toBe(true)
    expect(snapshot.modelBreakdown[0]?.key).toBe('claude-sonnet-4-6')
    expect(snapshot.recentSessions[0]?.sessionId).toBe('sess-1')
  })

  it('reports an empty scan state when there is no remote data', () => {
    const snapshot = buildClaudeUsageSnapshotFromScan(
      { sessions: [], dailyAggregates: [] },
      'all',
      '7d'
    )
    expect(snapshot.summary.inputTokens).toBe(0)
    expect(snapshot.scanState.hasAnyClaudeData).toBe(false)
  })
})
