import { expect, type Page, test } from '@playwright/test'
import { EditorName } from '../src/cdrt/types'
import { loadPrototype } from './utils'

const normalParagraph =
  'This is an example of educational content with various types of items.'
const multipleChoiceQuestion = 'What is 2 + 2?'
const typedText = 'formatted text'

const formattingCases = [
  { button: 'Toggle Bold', tag: 'strong' },
  { button: 'Italic', tag: 'em' },
] as const

test('typing in a normal text block syncs to the other editor', async ({
  page,
}) => {
  await loadPrototype(page)

  await clickTextAndMoveToEnd(page, EditorName.Editor1, normalParagraph)
  await page.keyboard.type(' Hello World')

  await expect(
    page.getByLabel(EditorName.Editor1).getByText('Hello World'),
  ).toBeVisible()
  await expect(
    page.getByLabel(EditorName.Editor2).getByText('Hello World'),
  ).toBeVisible()
})

test('editing multiple-choice question text syncs to the other editor', async ({
  page,
}) => {
  await loadPrototype(page)

  await selectTextInEditor(page, EditorName.Editor1, multipleChoiceQuestion)
  await page.keyboard.type('What is 2 + 3?')

  await expect(
    page.getByLabel(EditorName.Editor1).getByText('What is 2 + 3?'),
  ).toBeVisible()
  await expect(
    page.getByLabel(EditorName.Editor2).getByText('What is 2 + 3?'),
  ).toBeVisible()
})

for (const { button, tag } of formattingCases) {
  test(`${button.toLowerCase()} applies to newly typed text`, async ({
    page,
  }) => {
    await loadPrototype(page)

    await clickTextAndMoveToEnd(page, EditorName.Editor1, normalParagraph)
    await clickToolbarButton(page, EditorName.Editor1, button)
    await page.keyboard.type(typedText)

    await expectFormattedText(page, EditorName.Editor1, typedText, tag)
    await expectFormattedText(page, EditorName.Editor2, typedText, tag)
  })

  test(`${button.toLowerCase()} applies to selected text`, async ({ page }) => {
    await loadPrototype(page)

    await selectTextInEditor(page, EditorName.Editor1, normalParagraph)
    await expect(toolbarButton(page, EditorName.Editor1, button)).toBeEnabled()
    await clickToolbarButton(page, EditorName.Editor1, button)

    await expectFormattedText(page, EditorName.Editor1, normalParagraph, tag)
    await expectFormattedText(page, EditorName.Editor2, normalParagraph, tag)
  })
}

test('gap button is only available in the fill-in-the-blank exercise', async ({
  page,
}) => {
  await loadPrototype(page)

  await clickText(page, EditorName.Editor1, normalParagraph)
  await expect(toolbarButton(page, EditorName.Editor1, 'Gap')).not.toBeVisible()

  await clickText(page, EditorName.Editor1, 'France')
  await expect(toolbarButton(page, EditorName.Editor1, 'Gap')).toBeVisible()
})

test('gap formatting can be toggled on selected text', async ({ page }) => {
  await loadPrototype(page)

  await selectTextInEditor(page, EditorName.Editor1, 'France')
  await clickToolbarButton(page, EditorName.Editor1, 'Gap')

  await expectGapText(page, EditorName.Editor1, 'France')
  await expectGapText(page, EditorName.Editor2, 'France')
})

function editor(page: Page, editorName: EditorName) {
  return page.getByLabel(editorName)
}

function editorContent(page: Page, editorName: EditorName) {
  return editor(page, editorName).locator('.ProseMirror')
}

function toolbarButton(page: Page, editorName: EditorName, buttonName: string) {
  return editor(page, editorName).getByRole('button', { name: buttonName })
}

async function clickToolbarButton(
  page: Page,
  editorName: EditorName,
  buttonName: string,
) {
  const button = toolbarButton(page, editorName, buttonName)

  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

async function clickText(page: Page, editorName: EditorName, text: string) {
  await editor(page, editorName).getByText(text).first().click()
}

async function clickTextAndMoveToEnd(
  page: Page,
  editorName: EditorName,
  text: string,
) {
  await clickText(page, editorName, text)
  await page.keyboard.press('End')
}

async function selectTextInEditor(
  page: Page,
  editorName: EditorName,
  selectedText: string,
) {
  await clickText(page, editorName, selectedText)

  await editorContent(page, editorName).evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()

    while (node != null) {
      const textNode = node as Text
      const value = textNode.nodeValue ?? ''
      const index = value.indexOf(text)

      if (index >= 0) {
        const range = document.createRange()
        range.setStart(textNode, index)
        range.setEnd(textNode, index + text.length)

        const selection = root.ownerDocument?.getSelection()

        if (selection == null) {
          throw new Error('Expected an active selection')
        }

        selection.removeAllRanges()
        selection.addRange(range)

        return
      }

      node = walker.nextNode()
    }

    throw new Error(`Could not find text: ${text}`)
  }, selectedText)
}

async function expectFormattedText(
  page: Page,
  editorName: EditorName,
  text: string,
  tag: 'strong' | 'em',
) {
  await expect(
    editorContent(page, editorName).locator(tag, { hasText: text }),
  ).toBeVisible()
}

async function expectGapText(page: Page, editorName: EditorName, text: string) {
  await expect(
    editorContent(page, editorName).locator('.gap-mark', { hasText: text }),
  ).toBeVisible()
}
