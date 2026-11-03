import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
loader.config({ monaco })

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
  readOnly?: boolean
}

export function JsonEditor({
  value,
  onChange,
  height = '400px',
  readOnly = false,
}: JsonEditorProps): React.ReactElement {
  return (
    // `.card` supplies the border and radius so the editor frame matches every
    // other surface in the app; `overflow: hidden` keeps Monaco's corners square
    // against the rounded frame.
    <div className="card" style={{ overflow: 'hidden' }}>
      <Editor
        height={height}
        language="json"
        value={value}
        onChange={(val) => onChange(val || '')}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          lineNumbers: 'on',
          readOnly,
          padding: { top: 12 },
          formatOnPaste: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
