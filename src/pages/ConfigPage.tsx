import { useEffect, useState } from 'react'
import type { ConfigFileInfo } from '../types'

export default function ConfigPage() {
  const [files, setFiles] = useState<ConfigFileInfo[]>([])
  const [activeScope, setActiveScope] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'form' | 'source'>('source')
  const [sourceContent, setSourceContent] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // TODO: Load from backend
    setFiles([
      { name: '用户全局配置', scope: 'user', path: '%USERPROFILE%\\.claude\\settings.json', exists: true, last_modified: null, is_valid: null, has_sensitive_fields: true },
      { name: '项目共享配置', scope: 'project', path: '.claude\\settings.json', exists: false, last_modified: null, is_valid: null, has_sensitive_fields: false },
      { name: '项目本地配置', scope: 'local', path: '.claude\\settings.local.json', exists: false, last_modified: null, is_valid: null, has_sensitive_fields: true },
      { name: '企业托管配置', scope: 'managed', path: 'C:\\ProgramData\\ClaudeCode\\managed-settings.json', exists: false, last_modified: null, is_valid: null, has_sensitive_fields: false },
    ])
  }, [])

  const handleFileSelect = async (scope: string) => {
    setActiveScope(scope)
    setLoading(true)
    // TODO: Read from backend
    setSourceContent('{\n  // 配置文件内容\n}')
    setLoading(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>配置文件</h1>
      </div>

      <div className="config-layout">
        <div className="config-sidebar">
          <h3>配置文件列表</h3>
          <div className="file-list">
            {files.map((f) => (
              <button
                key={f.scope}
                className={`file-item ${activeScope === f.scope ? 'active' : ''}`}
                onClick={() => handleFileSelect(f.scope)}
              >
                <span className="file-name">{f.name}</span>
                <span className="file-path">{f.path}</span>
                <span className={`file-status ${f.exists ? 'exists' : 'missing'}`}>
                  {f.exists ? '存在' : '不存在'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="config-editor">
          {activeScope ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-tabs">
                  <button className={`editor-tab ${editorMode === 'source' ? 'active' : ''}`} onClick={() => setEditorMode('source')}>源码</button>
                  <button className={`editor-tab ${editorMode === 'form' ? 'active' : ''}`} onClick={() => setEditorMode('form')}>表单</button>
                </div>
                <div className="editor-actions">
                  <button className="btn btn-small btn-ghost">格式化</button>
                  <button className="btn btn-small btn-ghost">备份</button>
                  <button className="btn btn-small btn-primary">保存</button>
                </div>
              </div>
              <div className="editor-body">
                <textarea
                  className="editor-textarea"
                  value={sourceContent}
                  onChange={(e) => setSourceContent(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="editor-footer">
                <span className="text-secondary">JSON 格式 · 保存前自动备份</span>
              </div>
            </>
          ) : (
            <div className="editor-empty">
              <p className="text-secondary">选择左侧配置文件进行编辑</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
