import { invariant } from 'es-toolkit'
import * as S from '../schema'
import type { EditorStore } from '../store/editor-store'
import type { Key } from '../store/key'
import type { Guard } from '../utils/guard'

export type FlatNode<S extends S.Schema = S.Schema> = S extends unknown
  ? _FlatNode<S>
  : never

interface _FlatNode<S extends S.Schema> {
  schema: S
  key: Key
  parentKey: Key | null
  value: S.FlatValue<S>
}

export function getSingletonChild({
  store,
  node,
}: {
  store: EditorStore
  node: FlatNode<S.WrapperSchema | S.UnionSchema>
}): FlatNode {
  return store.get(node.value)
}

export function getVisibleChildren({
  store,
  node,
}: {
  store: EditorStore
  node: FlatNode<S.ArraySchema | S.ObjectSchema>
}): FlatNode[] {
  if (isArray(node)) {
    return node.value.toArray().map((itemKey) => store.get(itemKey))
  } else {
    return node.schema.keyOrder.map((propertyName) =>
      getProperty({ store, node, propertyName }),
    )
  }
}

export function getProperty<P extends Record<string, S.Schema>>({
  store,
  node,
  propertyName,
}: {
  store: EditorStore
  node: FlatNode<S.ObjectSchema<P>>
  propertyName: keyof P & string
}): FlatNode {
  const propertyKey = node.value.get(propertyName)

  invariant(
    propertyKey !== undefined,
    `Property ${propertyName} is missing in node ${node.key}`,
  )

  return store.get(propertyKey)
}

export const isTruthValue = createGuard(S.isTruthValue)
export const isRichText = createGuard(S.isRichText)
export const isLiteral = createGuard(S.isLiteral)
export const isWrapper = createGuard(S.isWrapper)
export const isUnion = createGuard(S.isUnion)
export const isArray = createGuard(S.isArray)
export const isObject = createGuard(S.isObject)
export const isPrimitive = createGuard(S.isPrimitive)
export const isLeaf = createGuard(S.isLeaf)
export const isSingleton = createGuard(S.isSingletonSchema)

function createGuard<S extends S.Schema>(schemaGuard: Guard<S>) {
  return (node: FlatNode): node is FlatNode<S> => schemaGuard(node.schema)
}
