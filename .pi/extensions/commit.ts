import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { complete } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

const GIT_SOURCE = 'git status, diffs, and untracked files'
const INSUFFICIENT_CONTEXT_RESPONSE = 'CONTEXT_NOT_ENOUGH'
const GIT_CONTEXT_TOTAL_MAX_CHARS = 5_000
const UNTRACKED_FILE_LIMIT = 10
const UNTRACKED_FILE_SUMMARY_MAX_CHARS = 400

export default function (pi: ExtensionAPI) {
  pi.registerCommand('commit', {
    description: 'Generate an editable conventional commit template',
    handler: async (_args, ctx) => {
      notify(ctx, 'Preparing commit template...', 'info')

      if (!(await isGitRepo(pi, ctx))) {
        notify(ctx, 'Not inside a git repository.', 'error')
        return
      }

      if (!(await hasChanges(pi, ctx))) {
        notify(ctx, 'No changes to commit.', 'warning')
        return
      }

      const commitMessage = await generateCommitMessage(pi, ctx)
      if (!commitMessage) {
        notify(
          ctx,
          `Unable to generate a commit message with the active model.`,
          'error',
        )
        return
      }

      notify(ctx, `Commit template ready: ${commitMessage}`, 'info')

      const committed = await stageAndOpenCommitEditor(pi, ctx, commitMessage)
      notify(
        ctx,
        committed ? 'Git commit completed.' : 'Git commit was not completed.',
        committed ? 'info' : 'warning',
      )
    },
  })
}

async function generateCommitMessage(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<string | null> {
  const contexts = await getCommitContexts(pi, ctx)

  for (const context of contexts) {
    const message = await askModel(
      ctx,
      buildCommitPrompt(context.text, context.source),
    )
    const commitMessage = normalizeOneLine(message ?? '')
    if (!commitMessage) continue
    if (isContextNotEnough(commitMessage)) {
      continue
    }

    return commitMessage
  }

  return null
}

async function getCommitContexts(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<{ text: string; source: string }[]> {
  const lastCommitTime = await getLastCommitTime(pi, ctx)
  const entries = ctx.sessionManager
    .getBranch()
    .filter((entry) => getEntryTime(entry) > lastCommitTime)

  const results = entries.filter(isAssistantMessage)
  const prompts = entries.filter(isUserMessage)
  const contexts: { text: string; source: string }[] = []

  const resultText = renderTranscript(results)
  if (resultText) {
    contexts.push({ text: resultText, source: 'session result messages' })
  }

  if (prompts.length > 0) {
    const sessionText = renderTranscript([...results, ...prompts].sort(byTime))
    if (sessionText && sessionText !== resultText) {
      contexts.push({
        text: sessionText,
        source: 'session result messages and user prompts',
      })
    }
  }

  contexts.push({ text: await getGitContext(pi, ctx), source: GIT_SOURCE })
  return contexts
}

function isContextNotEnough(text: string): boolean {
  const normalized = text.toUpperCase().replace(/[^A-Z]+/g, '')
  return (
    normalized === 'CONTEXTNOTENOUGH' ||
    normalized === 'CONTEXTISNOTENOUGH' ||
    normalized === 'NOTENOUGHCONTEXT' ||
    normalized === 'NEEDMORECONTEXT' ||
    normalized === 'MORECONTEXTNEEDED'
  )
}

async function askModel(
  ctx: ExtensionCommandContext,
  prompt: string,
): Promise<string | null> {
  const model = ctx.model
  if (!model) {
    notify(ctx, 'No active model is available.', 'error')
    return null
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok || !auth.apiKey) {
    notify(ctx, 'Unable to authenticate the active model.', 'error')
    return null
  }

  const response = await complete(
    model,
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
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

  return response.content
    .filter(isTextBlock)
    .map((part) => part.text)
    .join('\n')
}

async function stageAndOpenCommitEditor(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  commitMessage: string,
): Promise<boolean> {
  const tempDir = await mkdtemp(join(tmpdir(), 'pi-commit-'))
  const templatePath = join(tempDir, 'COMMIT_EDITMSG')

  try {
    await writeFile(templatePath, `${commitMessage}\n`, 'utf8')

    const add = await git(pi, ctx, ['add', '-A'])
    if (add.code !== 0) {
      notify(
        ctx,
        `Failed to stage changes for commit: ${add.stderr.trim() || add.stdout.trim() || 'unknown error'}`,
        'error',
      )
      return false
    }

    const commit = await git(pi, ctx, ['commit', '--template', templatePath])
    return commit.code === 0
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function getGitContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<string> {
  const [status, stagedDiff, diff] = await Promise.all([
    gitText(pi, ctx, ['status', '--porcelain']),
    gitText(pi, ctx, ['diff', '--cached', '--no-ext-diff', '--no-color']),
    gitText(pi, ctx, ['diff', '--no-ext-diff', '--no-color']),
  ])
  const untracked = await summarizeUntrackedFiles(ctx, status)

  const gitContext = [
    section('Git status', status || '[clean]'),
    section('Staged diff', stagedDiff || '[no staged diff]'),
    section('Working tree diff', diff || '[no diff]'),
    untracked.length > 0
      ? section('Untracked files', untracked.join('\n---\n'))
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return truncateText(gitContext, GIT_CONTEXT_TOTAL_MAX_CHARS)
}

async function summarizeUntrackedFiles(
  ctx: ExtensionCommandContext,
  status: string,
): Promise<string[]> {
  const files = status
    .split(/\r?\n/)
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const summaries: string[] = []
  for (const file of files.slice(0, UNTRACKED_FILE_LIMIT)) {
    summaries.push(
      truncateText(
        await summarizeFile(ctx, file),
        UNTRACKED_FILE_SUMMARY_MAX_CHARS,
      ),
    )
  }

  if (files.length > UNTRACKED_FILE_LIMIT) {
    summaries.push(
      `[${files.length - UNTRACKED_FILE_LIMIT} more untracked file(s) omitted]`,
    )
  }

  return summaries
}

async function summarizeFile(
  ctx: ExtensionCommandContext,
  file: string,
): Promise<string> {
  try {
    const path = join(ctx.cwd, file)
    const fileStat = await stat(path)
    if (fileStat.size > 200_000) return `File: ${file}\n[too large to include]`

    const text = (await readFile(path, 'utf8')).trim()
    if (!text) return `File: ${file}\n[empty or binary file]`

    const snippet = truncateText(text, UNTRACKED_FILE_SUMMARY_MAX_CHARS)
    return `File: ${file}\n${snippet}`
  } catch {
    return `File: ${file}\n[unable to read file contents]`
  }
}

async function isGitRepo(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const result = await git(pi, ctx, ['rev-parse', '--is-inside-work-tree'])
  return result.code === 0 && result.stdout.trim() === 'true'
}

async function hasChanges(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const status = await gitText(pi, ctx, ['status', '--porcelain'])
  return status.trim().length > 0
}

async function getLastCommitTime(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<number> {
  const output = await gitText(pi, ctx, ['log', '-1', '--format=%ct'])
  const seconds = Number.parseInt(output.trim(), 10)
  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

async function gitText(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<string> {
  const result = await git(pi, ctx, args)
  return result.code === 0 ? result.stdout.trim() : ''
}

function git(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]) {
  return pi.exec('git', args, { cwd: ctx.cwd, signal: ctx.signal })
}

function renderTranscript(entries: SessionEntry[]): string {
  return entries.map(renderEntry).filter(Boolean).join('\n\n')
}

function renderEntry(entry: SessionEntry): string {
  if (!isUserMessage(entry) && !isAssistantMessage(entry)) return ''

  const label = isUserMessage(entry) ? 'User' : 'Assistant'
  const text = extractText(entry.message.content)
  return text ? `${label}: ${text}` : ''
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .filter(isTextBlock)
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
}

function normalizeOneLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('```'))

  return (line ?? '')
    .replace(/^commit message:\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
}

function buildCommitPrompt(contextText: string, source: string): string {
  return [
    'Write one concise conventional commit subject.',
    `If the context is not enough to infer one, reply exactly ${INSUFFICIENT_CONTEXT_RESPONSE} or "context is not enough".`,
    'Otherwise return exactly one line and nothing else.',
    'Use format: type(scope): description or type: description.',
    'Prefer a meaningful scope when obvious.',
    '',
    `Context source: ${source}`,
    '<context>',
    contextText,
    '</context>',
  ].join('\n')
}

function section(title: string, body: string): string {
  return `${title}:\n${body}`
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  level: 'info' | 'warning' | 'error',
) {
  if (ctx.hasUI) ctx.ui.notify(message, level)
}

function byTime(a: SessionEntry, b: SessionEntry): number {
  return getEntryTime(a) - getEntryTime(b)
}

function getEntryTime(entry: SessionEntry): number {
  const time = new Date(entry.timestamp).getTime()
  return Number.isFinite(time) ? time : 0
}

type UserOrAssistantEntry = SessionEntry & {
  type: 'message'
  message: { role: 'user' | 'assistant'; content: unknown }
}

function isAssistantMessage(
  entry: SessionEntry,
): entry is UserOrAssistantEntry & {
  message: { role: 'assistant'; content: unknown }
} {
  return entry.type === 'message' && entry.message.role === 'assistant'
}

function isUserMessage(entry: SessionEntry): entry is UserOrAssistantEntry & {
  message: { role: 'user'; content: unknown }
} {
  return entry.type === 'message' && entry.message.role === 'user'
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type?: unknown }).type === 'text' &&
    'text' in block &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}
