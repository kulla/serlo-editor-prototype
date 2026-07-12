import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { complete, getModel } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

type ChatContentBlock = {
  type?: string
  text?: string
  name?: string
  arguments?: Record<string, unknown>
}

const COMMIT_MODEL_PROVIDER = 'openai'
const COMMIT_MODEL_ID = 'gpt-4o-mini'
const COMMIT_MODEL = getModel(COMMIT_MODEL_PROVIDER, COMMIT_MODEL_ID)

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const part = block as ChatContentBlock
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text.trim())
    }
  }

  return parts.filter(Boolean).join('\n').trim()
}

function extractToolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return []
  }

  const lines: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const part = block as ChatContentBlock
    if (part.type === 'toolCall' && typeof part.name === 'string') {
      lines.push(
        `Tool call: ${part.name}${part.arguments ? ` ${JSON.stringify(part.arguments)}` : ''}`,
      )
    }
  }

  return lines
}

function entryTimestamp(entry: SessionEntry): number {
  const time = new Date(entry.timestamp).getTime()
  return Number.isFinite(time) ? time : 0
}

function renderEntry(entry: SessionEntry): string | null {
  if (entry.type !== 'message') {
    return null
  }

  const role = entry.message.role
  if (role !== 'user' && role !== 'assistant') {
    return null
  }

  const lines: string[] = []
  const text = extractText(entry.message.content)
  if (text) {
    lines.push(`${role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }

  if (role === 'assistant') {
    lines.push(...extractToolCalls(entry.message.content))
  }

  return lines.length > 0 ? lines.join('\n') : null
}

function buildTranscript(entries: SessionEntry[]): string {
  return entries
    .map(renderEntry)
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

function buildCommitAnalysisPrompt(contextText: string): string {
  return [
    'You determine whether the provided context is sufficient to infer a single conventional git commit subject.',
    'Reply with exactly YES or NO.',
    'Choose YES only if the context clearly identifies the change without needing git diff.',
    '',
    '<context>',
    contextText,
    '</context>',
  ].join('\n')
}

function buildCommitGenerationPrompt(
  contextText: string,
  sourceLabel: string,
): string {
  return [
    'You write concise conventional git commit subjects.',
    'Return exactly one line and nothing else.',
    'Format: type(scope): description or type: description.',
    'Keep it concise and reviewable as a commit template.',
    'Prefer a meaningful scope when one is obvious.',
    '',
    `Context source: ${sourceLabel}`,
    '<context>',
    contextText,
    '</context>',
  ].join('\n')
}

function normalizeCommitMessage(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'))

  const first =
    lines[0]
      ?.replace(/^commit message:\s*/i, '')
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '') ?? ''
  return first
}

async function runGit(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const result = await pi.exec('git', args, {
    cwd: ctx.cwd,
    signal: ctx.signal,
  })
  return result
}

async function getLastCommitTime(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<number> {
  const result = await runGit(pi, ctx, ['log', '-1', '--format=%ct'])
  if (result.code !== 0) {
    return 0
  }

  const parsed = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(parsed) ? parsed * 1000 : 0
}

function collectEntriesSince(
  branch: SessionEntry[],
  sinceMs: number,
): SessionEntry[] {
  return branch.filter((entry) => entryTimestamp(entry) > sinceMs)
}

async function evaluateContextSufficiency(
  ctx: ExtensionCommandContext,
  contextText: string,
): Promise<boolean> {
  if (!COMMIT_MODEL) {
    return false
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(COMMIT_MODEL)
  if (!auth.ok || !auth.apiKey) {
    return false
  }

  const response = await complete(
    COMMIT_MODEL,
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildCommitAnalysisPrompt(contextText) },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal: ctx.signal,
    },
  )

  const answer = normalizeCommitMessage(
    response.content
      .filter(
        (part): part is { type: 'text'; text: string } => part.type === 'text',
      )
      .map((part) => part.text)
      .join('\n'),
  ).toUpperCase()

  return answer.startsWith('YES')
}

async function getGitFallbackContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<string> {
  const [statusResult, stagedDiffResult, diffResult] = await Promise.all([
    runGit(pi, ctx, ['status', '--porcelain']),
    runGit(pi, ctx, ['diff', '--cached', '--no-ext-diff', '--no-color']),
    runGit(pi, ctx, ['diff', '--no-ext-diff', '--no-color']),
  ])

  const status = statusResult.code === 0 ? statusResult.stdout.trim() : ''
  const stagedDiff =
    stagedDiffResult.code === 0 ? stagedDiffResult.stdout.trim() : ''
  const diff = diffResult.code === 0 ? diffResult.stdout.trim() : ''

  const untrackedFiles = status
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const untrackedSummaries: string[] = []
  for (const file of untrackedFiles) {
    try {
      const path = join(ctx.cwd, file)
      const fileStat = await stat(path)
      let summary = ''

      if (fileStat.size <= 200_000) {
        const text = await readFile(path, 'utf8')
        const trimmed = text.trim()
        if (trimmed) {
          const snippet = trimmed.slice(0, 8_000)
          summary = snippet
          if (trimmed.length > snippet.length) {
            summary += '\n...[truncated]'
          }
        }
      }

      untrackedSummaries.push(
        [`File: ${file}`, summary ? summary : '[binary or empty file]'].join(
          '\n',
        ),
      )
    } catch {
      untrackedSummaries.push(`File: ${file}\n[unable to read file contents]`)
    }
  }

  return [
    'Git status:',
    status || '[clean]',
    '',
    'Git diff (staged):',
    stagedDiff || '[no staged diff]',
    '',
    'Git diff (working tree):',
    diff || '[no diff]',
    untrackedSummaries.length > 0 ? '' : undefined,
    ...(untrackedSummaries.length > 0
      ? [
          'Untracked file summaries:',
          ...untrackedSummaries.map((summary) => `---\n${summary}`),
        ]
      : []),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
}

async function generateCommitMessage(
  ctx: ExtensionCommandContext,
  contextText: string,
  sourceLabel: string,
): Promise<string | null> {
  if (!COMMIT_MODEL) {
    return null
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(COMMIT_MODEL)
  if (!auth.ok || !auth.apiKey) {
    return null
  }

  const response = await complete(
    COMMIT_MODEL,
    {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildCommitGenerationPrompt(contextText, sourceLabel),
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal: ctx.signal,
    },
  )

  const output = response.content
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n')

  const commitMessage = normalizeCommitMessage(output)
  return commitMessage.length > 0 ? commitMessage : null
}

async function stageAndCommit(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  commitMessage: string,
): Promise<number> {
  const tempDir = await mkdtemp(join(tmpdir(), 'pi-commit-'))
  const templatePath = join(tempDir, 'COMMIT_EDITMSG')
  try {
    await writeFile(templatePath, `${commitMessage}\n`, 'utf8')
    await runGit(pi, ctx, ['add', '-A'])
    const commitResult = await runGit(pi, ctx, [
      'commit',
      '--template',
      templatePath,
    ])
    return commitResult.code
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('commit', {
    description:
      'Generate a conventional commit template from session and repo context',
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify('Preparing commit template...', 'info')
      }

      const repoCheck = await runGit(pi, ctx, [
        'rev-parse',
        '--is-inside-work-tree',
      ])
      if (repoCheck.code !== 0 || repoCheck.stdout.trim() !== 'true') {
        if (ctx.hasUI) {
          ctx.ui.notify('Not inside a git repository.', 'error')
        }
        return
      }

      const workingTreeStatus = await runGit(pi, ctx, ['status', '--porcelain'])
      if (
        workingTreeStatus.code !== 0 ||
        workingTreeStatus.stdout.trim().length === 0
      ) {
        if (ctx.hasUI) {
          ctx.ui.notify('No changes to commit.', 'warning')
        }
        return
      }

      const lastCommitTime = await getLastCommitTime(pi, ctx)
      const branch = ctx.sessionManager.getBranch()
      const recentEntries = collectEntriesSince(branch, lastCommitTime)
      const recentResults = recentEntries.filter(
        (entry) =>
          entry.type === 'message' && entry.message.role === 'assistant',
      )
      const recentPrompts = recentEntries.filter(
        (entry) => entry.type === 'message' && entry.message.role === 'user',
      )

      let contextText = buildTranscript(recentResults)
      let sourceLabel = 'session result messages'

      if (contextText.trim()) {
        const sufficient = await evaluateContextSufficiency(ctx, contextText)
        if (!sufficient && recentPrompts.length > 0) {
          contextText = buildTranscript(recentEntries)
          sourceLabel = 'session result messages + user prompts'
          const promptedSufficient = await evaluateContextSufficiency(
            ctx,
            contextText,
          )
          if (!promptedSufficient) {
            contextText = await getGitFallbackContext(pi, ctx)
            sourceLabel = 'git diff + status + untracked files'
          }
        } else if (!sufficient) {
          contextText = await getGitFallbackContext(pi, ctx)
          sourceLabel = 'git diff + status + untracked files'
        }
      } else if (recentPrompts.length > 0) {
        contextText = buildTranscript(recentPrompts)
        sourceLabel = 'session user prompts'
        const sufficient = await evaluateContextSufficiency(ctx, contextText)
        if (!sufficient) {
          contextText = await getGitFallbackContext(pi, ctx)
          sourceLabel = 'git diff + status + untracked files'
        }
      } else {
        contextText = await getGitFallbackContext(pi, ctx)
        sourceLabel = 'git diff + status + untracked files'
      }

      const commitMessage = await generateCommitMessage(
        ctx,
        contextText,
        sourceLabel,
      )
      if (!commitMessage) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Unable to generate a commit message with ${COMMIT_MODEL_PROVIDER}/${COMMIT_MODEL_ID}.`,
            'error',
          )
        }
        return
      }

      const gitStatus = await runGit(pi, ctx, ['status', '--porcelain'])
      if (gitStatus.code !== 0 || gitStatus.stdout.trim().length === 0) {
        if (ctx.hasUI) {
          ctx.ui.notify('No changes to commit.', 'warning')
        }
        return
      }

      if (ctx.hasUI) {
        ctx.ui.notify(`Commit template ready: ${commitMessage}`, 'info')
      }

      const code = await stageAndCommit(pi, ctx, commitMessage)
      if (code === 0) {
        if (ctx.hasUI) {
          ctx.ui.notify('Git commit completed.', 'info')
        }
        return
      }

      if (ctx.hasUI) {
        ctx.ui.notify('Git commit was not completed.', 'warning')
      }
    },
  })
}
