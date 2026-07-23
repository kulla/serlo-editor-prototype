# Discovery: Add e2e tests for collaborative editing and formatting

## Relevant implementation facts

### Test harness
- Existing e2e tests live in `tests/` and use Playwright.
- `tests/utils.ts` exports `loadPrototype(page)`.
- `loadPrototype(page)` opens `http://localhost:3000` and waits for `.ProseMirror`.
- Current tests already import `EditorName` from `src/cdrt/types` and use `page.getByLabel(EditorName.Editor1)` / `Editor 2`.

### Editor structure
- Each editor is wrapped in a form with `aria-label` equal to the editor name.
- The main editable area is rendered inside `.ProseMirror`.
- The toolbar is rendered above the editor content and uses accessible labels on buttons.

### Toolbar behavior
- Button labels are:
  - `Toggle Bold`
  - `Italic`
  - `Gap`
- `Gap` is conditional: it only appears when the focused editor can execute `toggleGap`.
- Toolbar buttons use `aria-label` and `aria-pressed`.
- Buttons prevent default on mouse down, so tests should click them normally rather than using lower-level DOM events.

### Content available in the prototype
- Normal text block contains: `This is an example of educational content with various types of items.`
- Fill-in-the-blank exercise contains: `The capital of France is Paris.`
- Multiple-choice exercise contains:
  - question: `What is 2 + 2?`
  - options: `3`, `4`, `5`

### Collaboration expectations
- There are two editors backed by the same collaborative document state.
- Changes made in one editor should appear in the other editor.
- The tests should assert mirrored updates when editing shared content.

## Implementation guidance for the tests

### 1) Shared text editing
- Focus the normal paragraph in `Editor 1`.
- Type a new token such as `Hell Vault`.
- Assert the text appears in both editors.
- Use the visible text content as the main assertion.

### 2) Multiple-choice edit + undo
- Interact with the multiple-choice question or an option text.
- Make a visible content change that is easy to assert.
- Trigger undo using the editor/browser undo shortcut.
- Assert the original text returns in both editors.

### 3) Bold / italic
- These features are available in the normal text block because `ContentRichText` includes bold and italic.
- The tests should cover both:
  - typing after clicking the toolbar button
  - formatting already selected text
- For assertions, inspect the resulting rendered markup or use the editor text/DOM structure that Playwright can observe.

### 4) Gap button and gap mark
- The `Gap` button should not be visible when focus is in the normal text block.
- It should become visible when focus is moved into the fill-in-the-blank exercise.
- The fill-in-the-blank content already contains the word `Paris` with a gap mark in initial content.
- Toggling gap should produce the existing `.gap-mark` rendering.

## Suggested test organization
- Keep the existing smoke/cursor tests.
- Add focused specs rather than one large file, for example:
  - `tests/editing.spec.ts`
  - `tests/toolbar.spec.ts`
  - `tests/exercises.spec.ts`

## Notes / risks
- Some editor interactions may require clicking precise text nodes rather than container elements.
- Selection-based formatting can be brittle if the selection is not established clearly before toolbar clicks.
- Because the toolbar state depends on editor focus, tests should verify focus/selection before asserting button visibility.
- No new unit tests should be added for this prototype; keep changes in e2e only.
