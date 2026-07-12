import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { complete } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

const MODEL_PROVIDER = 'openai'
const MODEL_ID = 'gpt-4o-mini'
const GIT_SOURCE = 'git status, diffs, and untracked files'

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

      const context = await getBestContext(pi, ctx)
      const message = await askModel(
        ctx,
        buildCommitPrompt(context.text, context.source),
      )

      const commitMessage = message ? normalizeOneLine(message) : ''
      if (!commitMessage) {
        notify(
          ctx,
          `Unable to generate a commit message with ${MODEL_ID}.`,
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

async function getBestContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<{ text: string; source: string }> {
  const lastCommitTime = await getLastCommitTime(pi, ctx)
  const entries = ctx.sessionManager
    .getBranch()
    .filter((entry) => getEntryTime(entry) > lastCommitTime)

  const results = entries.filter(isAssistantMessage)
  const prompts = entries.filter(isUserMessage)

  const resultText = renderTranscript(results)
  if (resultText && (await isEnoughContext(ctx, resultText))) {
    return { text: resultText, source: 'session result messages' }
  }

  if (prompts.length > 0) {
    const sessionText = renderTranscript([...results, ...prompts].sort(byTime))
    if (sessionText && (await isEnoughContext(ctx, sessionText))) {
      return {
        text: sessionText,
        source: 'session result messages and user prompts',
      }
    }
  }

  return { text: await getGitContext(pi, ctx), source: GIT_SOURCE }
}

async function isEnoughContext(
  ctx: ExtensionCommandContext,
  text: string,
): Promise<boolean> {
  const answer = await askModel(ctx, buildSufficiencyPrompt(text))
  return normalizeOneLine(answer ?? '')
    .toUpperCase()
    .startsWith('YES')
}

async function askModel(
  ctx: ExtensionCommandContext,
  prompt: string,
): Promise<string | null> {
  const model = ctx.modelRegistry.find(MODEL_PROVIDER, MODEL_ID)
  if (!model) return null

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok || !auth.apiKey) return null

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
    if (add.code !== 0) return false

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

  return [
    section('Git status', status || '[clean]'),
    section('Staged diff', stagedDiff || '[no staged diff]'),
    section('Working tree diff', diff || '[no diff]'),
    untracked.length > 0
      ? section('Untracked files', untracked.join('\n---\n'))
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
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
  for (const file of files) {
    summaries.push(await summarizeFile(ctx, file))
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

    const snippet = text.slice(0, 8_000)
    return `File: ${file}\n${snippet}${text.length > snippet.length ? '\n...[truncated]' : ''}`
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
    'Return exactly one line and nothing else.',
    'Use format: type(scope): description or type: description.',
    'Prefer a meaningful scope when obvious.',
    '',
    `Context source: ${source}`,
    '<context>',
    contextText,
    '</context>',
  ].join('\n')
}

function buildSufficiencyPrompt(contextText: string): string {
  return [
    'Is this context sufficient to infer one conventional commit subject?',
    'Reply with exactly YES or NO.',
    'Choose YES only if the change is clear without reading git diff.',
    '',
    '<context>',
    contextText,
    '</context>',
  ].join('\n')
}

function section(title: string, body: string): string {
  return `${title}:\n${body}`
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
