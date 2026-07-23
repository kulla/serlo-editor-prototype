import { test } from '@playwright/test'
import { EditorName } from '../src/cdrt/types'
import { clickText, expectCursorInEditor, loadPrototype } from './utils'

test('Cursor of first editor is visible in second editor', async ({ page }) => {
  await loadPrototype(page)

  await clickText(page, EditorName.Editor1, /This is an example/)

  await expectCursorInEditor(page, EditorName.Editor2)
})

test('Cursor changes when editor focus is changed', async ({ page }) => {
  await loadPrototype(page)

  await clickText(page, EditorName.Editor2, /This is an example/)
  await clickText(page, EditorName.Editor1, /This is an example/)

  await expectCursorInEditor(page, EditorName.Editor2)
})
