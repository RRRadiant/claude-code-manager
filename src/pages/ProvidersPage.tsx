import { useState } from 'react'

type ProviderTab = 'anthropic' | 'deepseek' | 'custom'

export default function ProvidersPage() {
  const [activeTab, setActiveTab] = useState<ProviderTab>('anthropic')

  return (
    <div className="page">
      <div className="page-header">
        <h1>API 与模型</h1>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'anthropic' ? 'active' : ''}`} onClick={() => setActiveTab('anthropic')}>Anthropic</button>
        <button className={`tab ${activeTab === 'deepseek' ? 'active' : ''}`} onClick={() => setActiveTab('deepseek')}>DeepSeek</button>
        <button className={`tab ${activeTab === 'custom' ? 'active' : ''}`} onClick={() => setActiveTab('custom')}>自定义</button>
      </div>

      <div className="section">
        {activeTab === 'anthropic' && <AnthropicForm />}
        {activeTab === 'deepseek' && <DeepSeekForm />}
        {activeTab === 'custom' && <CustomForm />}
      </div>

      <div className="section">
        <h2>模型列表</h2>
        <p className="text-secondary">配置并测试连接后，可检测可用模型。</p>
        <div className="model-placeholder glass">
          <span>暂无模型数据</span>
          <button className="btn btn-secondary" disabled>检测模型</button>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      {hint && <span className="form-hint">{hint}</span>}
      {children}
    </div>
  )
}

function AnthropicForm() {
  return (
    <div className="provider-form">
      <h3>Anthropic 官方配置</h3>
      <FormField label="API Key" hint="将以加密方式存储在 Windows Credential Manager 中">
        <input type="password" className="input" placeholder="sk-ant-..." />
      </FormField>
      <FormField label="Base URL" hint="默认为 Anthropic 官方地址">
        <input type="text" className="input" defaultValue="https://api.anthropic.com" />
      </FormField>
      <FormField label="默认模型">
        <input type="text" className="input" defaultValue="claude-sonnet-4-20250514" />
      </FormField>
      <FormField label="快速模型">
        <input type="text" className="input" defaultValue="claude-haiku-4-20250514" />
      </FormField>
      <FormField label="高能力模型">
        <input type="text" className="input" defaultValue="claude-opus-4-6-20260217" />
      </FormField>
      <FormField label="请求超时（秒）">
        <input type="number" className="input" defaultValue={60} />
      </FormField>
      <div className="form-actions">
        <button className="btn btn-primary">测试连接</button>
        <button className="btn btn-secondary">检测模型</button>
        <button className="btn btn-primary">保存并应用</button>
      </div>
    </div>
  )
}

function DeepSeekForm() {
  return (
    <div className="provider-form">
      <h3>DeepSeek 官方配置</h3>
      <p className="text-secondary">使用 DeepSeek 的 Anthropic 兼容接口</p>
      <FormField label="API Key">
        <input type="password" className="input" placeholder="sk-..." />
      </FormField>
      <FormField label="Anthropic 兼容 Base URL">
        <input type="text" className="input" defaultValue="https://api.deepseek.com/anthropic" />
      </FormField>
      <FormField label="默认模型">
        <input type="text" className="input" defaultValue="deepseek-v4-pro" />
      </FormField>
      <FormField label="请求超时（秒）">
        <input type="number" className="input" defaultValue={120} />
      </FormField>
      <div className="form-actions">
        <button className="btn btn-primary">测试连接</button>
        <button className="btn btn-secondary">检测模型</button>
        <button className="btn btn-primary">保存并应用</button>
      </div>
    </div>
  )
}

function CustomForm() {
  return (
    <div className="provider-form">
      <h3>自定义接口配置</h3>
      <FormField label="配置名称">
        <input type="text" className="input" placeholder="我的服务商" />
      </FormField>
      <FormField label="API 类型">
        <select className="input">
          <option>Anthropic 兼容模式</option>
          <option>OpenAI 兼容模式</option>
        </select>
      </FormField>
      <FormField label="Base URL">
        <input type="text" className="input" placeholder="https://your-api.com" />
      </FormField>
      <FormField label="API Key">
        <input type="password" className="input" placeholder="..." />
      </FormField>
      <FormField label="自定义 Headers（JSON）">
        <textarea className="input textarea" rows={3} placeholder='{"Authorization": "Bearer ..."}' />
      </FormField>
      <FormField label="默认模型">
        <input type="text" className="input" placeholder="model-name" />
      </FormField>
      <div className="form-actions">
        <button className="btn btn-primary">测试连接</button>
        <button className="btn btn-secondary">检测模型</button>
        <button className="btn btn-primary">保存并应用</button>
      </div>
    </div>
  )
}
