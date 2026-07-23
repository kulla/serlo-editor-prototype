# Feature: End-to-end editor behavior

## Context
The app renders two collaborative editors, labeled `Editor 1` and `Editor 2`.
The test suite already has a `loadPrototype(page)` helper that opens `http://localhost:3000` and waits for `.ProseMirror`.

Use stable, user-visible selectors whenever possible:
- editor container labels: `Editor 1`, `Editor 2`
- toolbar button labels: `Toggle Bold`, `Italic`, `Gap`
- text content in the default document:
  - normal paragraph: `This is an example of educational content with various types of items.`
  - fill-in-the-blank prompt: `Fill in the Blank Exercise:`
  - fill-in text: `The capital of France is Paris.`
  - multiple-choice prompt: `Multiple Choice Exercise:`
  - multiple-choice question: `What is 2 + 2?`
  - options: `3`, `4`, `5`

## Goal
Add Playwright e2e coverage for:
- collaborative editing between both editors
- editing multiple-choice content and syncing the change
- bold/italic toolbar behavior for typed text and selected text
- gap button visibility and gap mark toggling

## Scenario: Typing into a normal text block syncs to the other editor
Given the prototype is loaded
And the cursor is inside the normal text block in `Editor 1`
When I type `Hello World`
Then `Hello World` is visible in `Editor 1`
And `Hello World` is visible in `Editor 2`

## Scenario: Editing multiple-choice content syncs to the other editor
Given the prototype is loaded
And a multiple-choice field is edited in `Editor 1`
When I change visible multiple-choice text
Then the updated text is visible in `Editor 1`
And the updated text is visible in `Editor 2`

## Scenario Outline: Bold and italic apply to newly typed text
Given the prototype is loaded
And the cursor is inside the normal text block in `Editor 1`
Then the `<button>` toolbar button is visible and enabled
When I click the `<button>` toolbar button
And I type `formatted text`
Then `formatted text` is rendered with `<mark>` formatting in `Editor 1`
And the formatting is applied to newly entered text after the toolbar action
Examples:
  | button | mark   |
  | Bold   | bold   |
  | Italic | italic |

## Scenario Outline: Bold and italic apply to selected text
Given the prototype is loaded
And existing text in the normal text block is selected in `Editor 1`
When I click the `<button>` toolbar button
Then the selected text is rendered with `<mark>` formatting in `Editor 1`
And the formatting change affects the selected content itself
Examples:
  | button | mark   |
  | Bold   | bold   |
  | Italic | italic |

## Scenario: Gap button is only available in the fill-in-the-blank exercise
Given the prototype is loaded
And the cursor is inside the normal text block in `Editor 1`
Then the `Gap` toolbar button is not visible
When I move the cursor into the fill-in-the-blank exercise in `Editor 1`
Then the `Gap` toolbar button is visible

## Scenario: Gap formatting can be toggled on selected text
Given the prototype is loaded
And text is selected in the fill-in-the-blank exercise in `Editor 1`
When I click the `Gap` toolbar button
Then the selected text is rendered as a gap mark in `Editor 1`
And the gap-marked content is visible in `Editor 2`
And the rendered gap uses the existing `.gap-mark` styling

## Implementation notes
- The tests should use the existing `tests/utils.ts` helper.
- Prefer clicks and keyboard input over direct DOM mutation.
- For selection-based formatting, the test should first create a text selection, then click the toolbar button.
- Keep the tests deterministic and avoid relying on timing beyond the existing editor load wait.

## Not to do
- do not test undo features (they are not implemented yet)
