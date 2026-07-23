import { expect, type Page } from 'playwright/test'
import { EditorName } from '../src/cdrt/types'

export async function loadPrototype(page: Page) {
  await page.goto('http://localhost:3000')

  // Wait for the editor to load
  await page.waitForSelector('.ProseMirror')
}

export function editor(page: Page, editorName: EditorName) {
  return page.getByLabel(editorName)
}

export function toolbarButton(
  page: Page,
  editorName: EditorName,
  buttonName: string,
) {
  return editor(page, editorName).getByRole('button', { name: buttonName })
}

export async function clickToolbarButton(
  page: Page,
  editorName: EditorName,
  buttonName: string,
) {
  const button = toolbarButton(page, editorName, buttonName)

  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

export async function clickText(
  page: Page,
  editorName: EditorName,
  text: string | RegExp,
) {
  await editor(page, editorName).getByText(text).first().click()
}

export async function clickTextAndMoveToEnd(
  page: Page,
  editorName: EditorName,
  text: string,
) {
  await clickText(page, editorName, text)
  await page.keyboard.press('End')
}

export async function selectTextInEditor(
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

export async function expectTextVisibleInBothEditors(page: Page, text: string) {
  await expect(editor(page, EditorName.Editor1).getByText(text)).toBeVisible()
  await expect(editor(page, EditorName.Editor2).getByText(text)).toBeVisible()
}

export async function expectFormattedText(
  page: Page,
  editorName: EditorName,
  text: string,
  tag: 'strong' | 'em',
) {
  await expect(
    editor(page, editorName).locator(tag, { hasText: text }),
  ).toBeVisible()
}

export async function expectGapText(
  page: Page,
  editorName: EditorName,
  text: string,
) {
  await expect(
    editor(page, editorName).locator('.gap-mark', { hasText: text }),
  ).toBeVisible()
}

export async function expectCursorInEditor(page: Page, editorName: EditorName) {
  await expect(
    editor(page, editorName).locator('.ProseMirror-yjs-cursor'),
  ).toBeVisible()
}
