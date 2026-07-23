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

  await expectTextVisibleInBothEditors(page, 'Hello World')
})

test('editing multiple-choice question text syncs to the other editor', async ({
  page,
}) => {
  await loadPrototype(page)

  await selectTextInEditor(page, EditorName.Editor1, multipleChoiceQuestion)
  await page.keyboard.type('What is 2 + 3?')

  await expectTextVisibleInBothEditors(page, 'What is 2 + 3?')
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
  const text = editor(page, editorName).getByText(selectedText).first()
  await text.click()

  await text.evaluate((node, selected) => {
    const root = node.closest('[contenteditable="true"]')

    if (root == null) {
      throw new Error('Expected an editable root element')
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let current = walker.nextNode()

    while (current != null) {
      const textNode = current as Text
      const value = textNode.nodeValue ?? ''
      const index = value.indexOf(selected)

      if (index >= 0) {
        const range = document.createRange()
        range.setStart(textNode, index)
        range.setEnd(textNode, index + selected.length)

        const selection = root.ownerDocument?.getSelection()

        if (selection == null) {
          throw new Error('Expected an active selection')
        }

        selection.removeAllRanges()
        selection.addRange(range)

        return
      }

      current = walker.nextNode()
    }

    throw new Error(`Could not find text: ${selected}`)
  }, selectedText)
}

async function expectTextVisibleInBothEditors(page: Page, text: string) {
  await expect(editor(page, EditorName.Editor1).getByText(text)).toBeVisible()
  await expect(editor(page, EditorName.Editor2).getByText(text)).toBeVisible()
}

async function expectFormattedText(
  page: Page,
  editorName: EditorName,
  text: string,
  tag: 'strong' | 'em',
) {
  await expect(
    editor(page, editorName).locator(tag, { hasText: text }),
  ).toBeVisible()
}

async function expectGapText(page: Page, editorName: EditorName, text: string) {
  await expect(
    editor(page, editorName).locator('.gap-mark', { hasText: text }),
  ).toBeVisible()
}
