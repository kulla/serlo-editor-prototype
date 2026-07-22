import { expect, type Page, test } from '@playwright/test'
import { EditorName } from '../src/cdrt/types'
import { loadPrototype } from './utils'

test('Cursor of first editor is visible in second editor', async ({ page }) => {
  await loadPrototype(page)

  await clickInEditor(page, EditorName.Editor1)

  await expectCursorInEditor(page, EditorName.Editor2)
})

test('Cursor changes when editor focus is changed', async ({ page }) => {
  await loadPrototype(page)

  await clickInEditor(page, EditorName.Editor2)
  await clickInEditor(page, EditorName.Editor1)

  await expectCursorInEditor(page, EditorName.Editor2)
})

function clickInEditor(page: Page, editorName: EditorName) {
  return page
    .getByLabel(editorName)
    .getByText(/This is an example/)
    .click()
}

function expectCursorInEditor(page: Page, editorName: EditorName) {
  return expect(
    page.getByLabel(editorName).locator('.ProseMirror-yjs-cursor'),
  ).toBeVisible()
}
