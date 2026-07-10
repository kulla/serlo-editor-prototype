import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as F from '../nodes/flat'
import type { JSONValue, Schema } from '../schema'
import type { EditorStore } from '../store/editor-store'

export function load<S extends Schema>({
  store,
  node,
}: {
  store: EditorStore
  node: F.FlatNode<S>
}): JSONValue<S> {
  if (F.isPrimitive(node)) {
    return node.value
  } else if (F.isRichText(node)) {
    return yXmlFragmentToProseMirrorRootNode(
      store.getEditorFragment(node.key),
      store.getEditor(node).schema,
    )
  } else if (F.isWrapper(node)) {
    return node.schema.wrap(load({ store, node: store.get(node.value) }))
  } else if (F.isUnion(node)) {
    return load({ store, node: store.get(node.value) })
  } else if (F.isArray(node)) {
    return node.value
      .toArray()
      .map((childKey) => load({ store, node: store.get(childKey) }))
  } else if (F.isObject(node)) {
    return Object.fromEntries(
      [...node.value.entries()].map(([key, childKey]) => [
        key,
        load({ store, node: store.get(childKey) }),
      ]),
    )
  } else {
    throw new Error(`Unsupported node kind: ${node.schema.kind}`)
  }
}
