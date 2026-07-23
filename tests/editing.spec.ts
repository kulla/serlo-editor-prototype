import { expect, test } from '@playwright/test'
import { EditorName } from '../src/cdrt/types'
import {
  clickText,
  clickTextAndMoveToEnd,
  clickToolbarButton,
  expectFormattedText,
  expectGapText,
  expectTextVisibleInBothEditors,
  loadPrototype,
  selectTextInEditor,
  toolbarButton,
} from './utils'

const normalParagraph =
  'This is an example of educational content with various types of items.'

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

  await selectTextInEditor(page, EditorName.Editor1, 'What is 2 + 2?')
  await page.keyboard.type('What is 2 + 3?')

  await expectTextVisibleInBothEditors(page, 'What is 2 + 3?')
})

for (const { button, tag } of [
  { button: 'Toggle Bold', tag: 'strong' },
  { button: 'Italic', tag: 'em' },
] as const) {
  test(`${button.toLowerCase()} applies to newly typed text`, async ({
    page,
  }) => {
    const typedText = 'formatted text'
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
