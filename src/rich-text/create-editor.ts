import {
  createEditor,
  defineBaseKeymap,
  defineCommands,
  defineKeymap,
  defineMarkSpec,
  defineNodeSpec,
  defineUpdateHandler,
  type Extension,
  type NodeJSON,
  toggleMark,
  union,
} from 'prosekit/core'
import { defineBold } from 'prosekit/extensions/bold'
import { defineHeading } from 'prosekit/extensions/heading'
import { defineItalic } from 'prosekit/extensions/italic'
import { defineList } from 'prosekit/extensions/list'
import { defineParagraph } from 'prosekit/extensions/paragraph'
import { defineText } from 'prosekit/extensions/text'
import { type Awareness, defineYjs } from 'prosekit/extensions/yjs'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import type { RichTextSchema } from '../schema'
import type { EditorStore } from '../store/editor-store'
import type { Key } from '../store/key'
import { createProxyWithChangedMethods } from '../utils/proxy'
import { isInline, RichTextFeature } from './types'

export function createRichTextEditor({
  key,
  schema,
  store,
  defaultContent,
}: {
  key: Key
  schema: RichTextSchema
  store: EditorStore
  defaultContent?: NodeJSON
}) {
  const { doc, awareness } = store.cdrt
  const editorAwareness = createEditorSpecificAwareness(key, awareness)
  const fragment = store.getEditorFragment(key)
  const extension = union(
    defineRichTextExtensions(schema.features),
    defineUpdateHandler((view) => {
      if (view.hasFocus() && store.selection?.key !== key) {
        store.update((tx) => tx.setSelection({ key }))
      } else if (!view.hasFocus() && store.selection?.key === key) {
        store.update((tx) => tx.setSelection(null))
      } else if (view.hasFocus()) {
        // If the document has changed, we need to update the store to reflect
        // the changes in the debug panel and the toolbar (to update the
        // update count)
        store.update(() => void 0)
      }
    }),
    defineYjs({ awareness: editorAwareness, doc, fragment }),
  )

  const editor = createEditor({ extension })

  if (defaultContent != null) {
    prosemirrorJSONToYXmlFragment(editor.schema, defaultContent, fragment)
  }

  return editor
}

function createEditorSpecificAwareness(
  editorId: Key,
  awareness: Awareness,
): Awareness {
  return createProxyWithChangedMethods(awareness, {
    getStates() {
      const result = new Map()

      for (const [peer, state] of awareness.getStates().entries()) {
        if (hasEditorId(state, editorId)) {
          result.set(peer, state)
        }
      }

      return result
    },

    getLocalState() {
      const state = awareness.getLocalState()

      return hasEditorId(state, editorId) ? state : null
    },

    setLocalStateField(field: string, value: unknown) {
      const state = awareness.getLocalState()

      if (value != null || hasEditorId(state, editorId)) {
        awareness.setLocalState({ ...state, editorId, [field]: value })
      }
    },
  })
}

function hasEditorId(
  state: object | null,
  editorId: Key,
): state is { editorId: Key } {
  return state != null && 'editorId' in state && state.editorId === editorId
}

function defineDoc(isInline: boolean): Extension {
  const content = isInline ? 'inlineBlock' : 'block+'

  return defineNodeSpec({ name: 'doc', content, topNode: true })
}

function defineGap(): Extension {
  return union(
    defineMarkSpec({
      name: 'gap',
      parseDOM: [{ tag: 'span[data-gap="true"]' }],
      toDOM() {
        return ['span', { class: 'gap-mark', 'data-gap': 'true' }, 0]
      },
    }),
    defineCommands({
      toggleGap: () => toggleMark({ type: 'gap' }),
    }),
    defineKeymap({
      'Mod-Alt-g': toggleMark({ type: 'gap' }),
    }),
  )
}

function defineInlineBlockNode() {
  return defineNodeSpec({
    name: 'inlineBlock',
    content: 'inline*',
    group: 'block',
    toDOM() {
      return ['span', { class: 'inline-rich-text' }, 0]
    },
  })
}

function defineRichTextExtensions(features: Array<RichTextFeature>): Extension {
  const editorIsInline = isInline(features)

  return union(
    defineBaseKeymap(),
    defineDoc(editorIsInline),
    defineText(),
    ...(editorIsInline ? [defineInlineBlockNode()] : []),
    ...features.map((feature) => createExtension(feature)),
  )
}

function createExtension(feature: RichTextFeature): Extension {
  switch (feature) {
    case RichTextFeature.Bold:
      return defineBold()
    case RichTextFeature.Italic:
      return defineItalic()
    case RichTextFeature.Blank:
      return defineGap()
    case RichTextFeature.Paragraph:
      return defineParagraph()
    case RichTextFeature.Heading:
      return defineHeading()
    case RichTextFeature.List:
      return defineList()
  }
}
