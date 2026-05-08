import { useEffect } from 'react'
import { syncCDRTs } from './cdrt/sync'
import { EditorName } from './cdrt/types'
import { useCDRT } from './cdrt/use-cdrt'
import { initialContent } from './content/initial-content'
import { Editor, EditorDebugPanel } from './editor'

export default function App() {
  const cdrt1 = useCDRT(EditorName.Editor1, '#2563eb')
  const cdrt2 = useCDRT(EditorName.Editor2, '#b45309')

  useEffect(() => syncCDRTs(cdrt1, cdrt2), [cdrt1, cdrt2])

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">Prototype: Collaborative editing</h1>
      </header>

      <section className="app__editors">
        <Editor key={cdrt1.name} cdrt={cdrt1} initialContent={initialContent} />
        <Editor key={cdrt2.name} cdrt={cdrt2} />
      </section>

      <section className="app__debug panel">
        <EditorDebugPanel cdrt={cdrt1} />
      </section>
    </main>
  )
}
