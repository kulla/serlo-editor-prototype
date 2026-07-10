# /commit extension specification

## Location
- **Implementation file:** `.pi/agent/extensions/commit.ts`
- **Spec file:** `.pi/extensions/commit.spec.md`

## Purpose
Provide a `/commit` command that prepares a conventional git commit message from the current pi session and the repo state.

## Behavior
When `/commit` is invoked:

1. **Read the last git commit time**
   - Use git to get the timestamp of the most recent commit, e.g. `git log -1 --format=%ct`.

2. **Inspect the current session history**
   - First collect all AI **result messages** produced since that timestamp and use them to generate the commit message (step 4).
   - Prefer this session content as the source of truth for what changed and why.

2. Fallback 1 to user messages:
   - If those result messages are empty, or if the AI cannot reliably infer a commit message from them, also include the related **user prompts** in the same time window.

3. **Fallback 2 to git diff when session history is insufficient**
   - If the result messages and user prompts still do not contain enough useful information to infer the change, use the repository diff (`git diff`, and include untracked/new files as needed) as a second fallback supporting context.

4. **Generate a commit message with ChatGPT 4o mini**
   - Send the gathered context to **gpt-4o-mini**.
   - The model must return a **conventional commit** message.
   - Keep the output concise and ready for use as a commit template.

5. **Prepare a git commit, but do not auto-commit**
   - Stage all new and changed files (`git add -A`).
   - Invoke `git commit` using the generated message as the **template**.
   - Do **not** bypass user review; the final commit should still be editable/confirmable by the user.

## Output format
The generated message should follow conventional commits, for example:
- `feat(editor): improve cursor handling`
- `fix(toolbar): prevent duplicate actions`

## Notes
- The command should analyze only the current session and repository state.
- If no meaningful AI result messages exist, rely primarily on git diff.
- The command should be usable as a pi extension command named `/commit`.
