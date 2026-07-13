# /commit extension specification

## Location
- **Implementation file:** `.pi/extensions/commit.ts`
- This is a project-local extension.

## Purpose
Provide a `/commit` command that prepares a conventional git commit message from the current pi session and repository state.

## Behavior
When `/commit` is invoked:

1. **Read the last git commit time**
   - Use git to get the timestamp of the most recent commit, e.g. `git log -1 --format=%ct`.

2. **Build context from the current session**
   - First collect all AI **result messages** produced since that timestamp.
   - Ask **gpt-4o-mini** to generate a conventional commit subject from that context.
   - If the model replies that the context is not enough, include the related **user prompts** from the same time window and try again.
   - If the session context is still insufficient, continue to the git-diff fallback.

3. **Fallback to git diff if needed**
   - Use the repository diff as a second fallback.
   - Include `git diff`, `git status --porcelain`, and the contents/summaries of any untracked/new files as needed.
   - Trucanate the diff so that it is not too much.

4. **Generate a commit message with ChatGPT 4o mini**
   - Send each gathered context candidate to **gpt-4o-mini** via the pi SDK.
   - The model must either return a **conventional commit** message or reply that the context is not enough.
   - Keep the output concise and suitable for use as a commit template.

5. **Prepare the commit without auto-committing**
   - Stage all new and changed files with `git add -A`.
   - Invoke `git commit` using the generated message as a **template**.
   - Do **not** bypass user review; the commit should remain editable/confirmable by the user.

## Pseudo code
```text
on /commit:
  if not git repo: stop
  if no changes: stop

  lastCommitTime = get latest commit timestamp
  session = pi session entries newer than lastCommitTime

  contexts = [
    assistant result messages from session,
    assistant result messages + user prompts from session,
    trucanated git status / diff / untracked file summaries,
  ]

  for context in contexts:
    response = ask gpt-4o-mini to generate a conventional commit
    if response means "context is not enough":
      continue
    if response is a valid one-line commit subject:
      git add -A
      git commit --template <response>
      stop

  notify user that context was insufficient
```

## Output format
The generated message should follow conventional commits, for example:
- `feat(editor): improve cursor handling`
- `fix(toolbar): prevent duplicate actions`

## Notes
- Analyze only the current session and repository state.
- The command should be available as a pi extension command named `/commit`.
