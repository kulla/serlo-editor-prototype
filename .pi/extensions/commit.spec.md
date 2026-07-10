# /commit extension specification

## Location
- **Implementation file:** `.pi/agent/extensions/commit.ts`

## Purpose
Provide a `/commit` command that prepares a conventional git commit message from the current pi session and repository state.

## Behavior
When `/commit` is invoked:

1. **Read the last git commit time**
   - Use git to get the timestamp of the most recent commit, e.g. `git log -1 --format=%ct`.

2. **Build context from the current session**
   - First collect all AI **result messages** produced since that timestamp.
   - Use only those result messages if they contain enough information to infer a commit message.
   - If the result messages are empty or insufficient, also include the related **user prompts** from the same time window.

3. **Fallback to git diff if needed**
   - If the session messages still do not provide enough context, use the repository diff as a second fallback.
   - Include `git diff` and any untracked/new files as needed.

4. **Generate a commit message with ChatGPT 4o mini**
   - Send the gathered context to **gpt-4o-mini** via pi sdk.
   - The model must return a **conventional commit** message.
   - Keep the output concise and suitable for use as a commit template.

5. **Prepare the commit without auto-committing**
   - Stage all new and changed files with `git add -A`.
   - Invoke `git commit` using the generated message as a **template**.
   - Do **not** bypass user review; the commit should remain editable/confirmable by the user.

## Output format
The generated message should follow conventional commits, for example:
- `feat(editor): improve cursor handling`
- `fix(toolbar): prevent duplicate actions`

## Notes
- Analyze only the current session and repository state.
- The command should be available as a pi extension command named `/commit`.
