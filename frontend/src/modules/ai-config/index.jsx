import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Plus,
  RadioTower,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import { writeClipboardText } from '../../utils/clipboard';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gpt', label: 'GPT 网关' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: '自定义' },
];

function emptyConfig() {
  return {
    id: '',
    name: '',
    provider: 'openai',
    model: DEFAULT_MODEL,
    base_url: DEFAULT_BASE_URL,
    api_protocol: '',
    structured_output_mode: '',
    capability_verified_at: '',
  };
}

function profileToConfig(profile) {
  if (!profile) return emptyConfig();
  return {
    id: profile.id || '',
    name: profile.name || '',
    provider: profile.provider || 'openai',
    model: profile.model || DEFAULT_MODEL,
    base_url: profile.baseUrl || DEFAULT_BASE_URL,
    api_protocol: profile.apiProtocol || '',
    structured_output_mode: profile.structuredOutputMode || '',
    capability_verified_at: profile.capabilityVerifiedAt || '',
  };
}

function resetCapability(config, changes) {
  return {
    ...config,
    ...changes,
    api_protocol: '',
    structured_output_mode: '',
    capability_verified_at: '',
  };
}

function providerLabel(provider) {
  return PROVIDERS.find((item) => item.value === provider)?.label || '自定义';
}

export default function AiConfigModule({ health, setHealth, requestJson, onError, onNotice }) {
  const profiles = health.ai?.profiles || [];
  const activeProfileId = health.ai?.activeProfileId || health.ai?.profileId || '';
  const [config, setConfig] = useState(() => profileToConfig(health.ai?.activeProfile));
  const [testing, setTesting] = useState(false);
  const [credentialValue, setCredentialValue] = useState('');
  const [credentialVisible, setCredentialVisible] = useState(false);
  const [credentialSource, setCredentialSource] = useState('');
  const editingSavedProfile = profiles.find((profile) => profile.id === config.id);
  const isEditingActive = Boolean(config.id && config.id === activeProfileId);

  const clearCredential = () => {
    setCredentialValue('');
    setCredentialVisible(false);
    setCredentialSource('');
  };

  const payload = () => ({ ...config, api_key: credentialValue });

  const save = async () => {
    try {
      const response = await requestJson('/api/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      setHealth((value) => ({ ...value, ai: response }));
      setConfig(profileToConfig(response.activeProfile));
      clearCredential();
      onError('');
      onNotice('AI 配置档案已保存');
    } catch (error) {
      onError(`保存 AI 配置失败：${error.message}`);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await requestJson('/api/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      setHealth((value) => ({
        ...value,
        ai: {
          ...(value.ai || {}),
          configured: true,
          provider: response.provider || value.ai?.provider,
          model: response.model,
          baseUrl: response.baseUrl,
          connectionStatus: 'connected',
        },
      }));
      setConfig((value) => ({
        ...value,
        api_protocol: response.apiProtocol || '',
        structured_output_mode: response.structuredOutputMode || '',
        capability_verified_at: response.capabilityVerifiedAt || '',
      }));
      onError('');
      onNotice(response.message || 'AI 连接测试成功');
    } catch (error) {
      onNotice('');
      onError(`测试 AI 连接失败：${error.message}`);
    } finally {
      setTesting(false);
    }
  };

  const selectProfile = (profile) => {
    clearCredential();
    setConfig(profileToConfig(profile));
    onError('');
  };

  const activateProfile = async () => {
    if (!config.id) {
      onError('请先选择已保存的 AI 配置档案');
      return;
    }
    try {
      const response = await requestJson('/api/ai-config/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: config.id }),
      });
      setHealth((value) => ({ ...value, ai: response }));
      setConfig(profileToConfig(response.activeProfile));
      clearCredential();
      onError('');
      onNotice('已切换当前 AI 配置');
    } catch (error) {
      onError(`切换 AI 配置失败：${error.message}`);
    }
  };

  const clearAll = async () => {
    try {
      const response = await requestJson('/api/ai-config', { method: 'DELETE' });
      setHealth((value) => ({ ...value, ai: response }));
      setConfig(profileToConfig(response.activeProfile));
      clearCredential();
      onError('');
      onNotice('本地 AI 配置已清除');
    } catch (error) {
      onError(`清除 AI 配置失败：${error.message}`);
    }
  };

  const deleteProfile = async () => {
    if (!config.id) return;
    try {
      const response = await requestJson(`/api/ai-config?profile_id=${encodeURIComponent(config.id)}`, { method: 'DELETE' });
      setHealth((value) => ({ ...value, ai: response }));
      setConfig(profileToConfig(response.activeProfile));
      clearCredential();
      onError('');
      onNotice('AI 配置档案已删除');
    } catch (error) {
      onError(`删除 AI 配置失败：${error.message}`);
    }
  };

  const revealCredential = async () => {
    if (health.ai?.envLocked) {
      onError('API Key 已由环境变量配置，页面无法读取服务进程的环境变量明文。');
      return;
    }
    if (credentialVisible) {
      setCredentialVisible(false);
      if (credentialSource === 'revealed') clearCredential();
      return;
    }
    if (credentialValue || !config.id) {
      setCredentialVisible(true);
      onError('');
      return;
    }
    try {
      const response = await requestJson(`/api/ai-config/${encodeURIComponent(config.id)}/secret`);
      setCredentialValue(response.apiKey || '');
      setCredentialSource('revealed');
      setCredentialVisible(true);
      onError('');
    } catch (error) {
      onError(`读取 AI 密钥失败：${error.message}`);
    }
  };

  const copyCredential = async () => {
    if (health.ai?.envLocked) {
      onError('API Key 已由环境变量配置，页面无法复制环境变量明文。');
      return;
    }
    let value = credentialValue;
    if (!value && config.id) {
      try {
        const response = await requestJson(`/api/ai-config/${encodeURIComponent(config.id)}/secret`);
        value = response.apiKey || '';
      } catch (error) {
        onError(`复制 AI 密钥失败：${error.message}`);
        return;
      }
    }
    if (!value) {
      onError('当前没有可复制的 API Key');
      return;
    }
    try {
      if (!(await writeClipboardText(value))) throw new Error('浏览器拒绝写入剪贴板');
      onError('');
      onNotice('API Key 已复制');
    } catch (error) {
      onError(`复制 AI 密钥失败：${error.message}`);
    }
  };

  return (
    <section className="module-section" aria-label="AI 配置">
      <div className="section-header">
        <div><h2>AI 多厂商配置</h2><p>保存多个AI配置，在生成测试用例、脚本和自愈时切换当前模型。</p></div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={() => { clearCredential(); setConfig(emptyConfig()); onError(''); }}><Plus size={17} />新建配置</button>
          <button type="button" className="ghost-button danger-action" onClick={deleteProfile} disabled={!config.id}><Trash2 size={17} />删除配置</button>
          <button type="button" className="ghost-button" onClick={clearAll} disabled={health.ai?.envLocked && health.ai?.baseUrlLocked}><XCircle size={17} />清除本地全部</button>
          <button type="button" className="primary-action" onClick={save}><Save size={17} />保存配置</button>
        </div>
      </div>
      <div className="ai-config-layout">
        <aside className="data-panel ai-profile-list" aria-label="AI 配置列表">
          <div className="panel-heading"><h3>配置列表</h3><span className="source-chip">{profiles.length} 个</span></div>
          {profiles.length ? <div className="ai-profile-items">{profiles.map((profile) => (
            <button type="button" className={`ai-profile-card ${profile.id === config.id ? 'selected' : ''}`} onClick={() => selectProfile(profile)} key={profile.id}>
              <span><strong>{profile.name}</strong><small>{providerLabel(profile.provider)} · {profile.model}</small></span>
              {profile.id === activeProfileId && <b>当前</b>}
            </button>
          ))}</div> : <p className="muted">暂无本地配置。</p>}
        </aside>
        <div className="data-panel">
          <h3>配置表单</h3>
          <div className="form-grid compact">
            <label className="field wide"><span>配置名称</span><input value={config.name} placeholder="例如：DeepSeek 生产网关" onChange={(event) => setConfig({ ...config, name: event.target.value })} /></label>
            <label className="field wide"><span>厂商</span><select value={config.provider} onChange={(event) => setConfig(resetCapability(config, { provider: event.target.value }))}>{PROVIDERS.map((provider) => <option value={provider.value} key={provider.value}>{provider.label}</option>)}</select></label>
            <label className="field wide">
              <span>API Key</span>
              <div className="secret-input-row">
                <input type={credentialVisible ? 'text' : 'password'} value={credentialValue} placeholder={health.ai?.envLocked ? '已由环境变量配置，前端不可覆盖' : editingSavedProfile?.maskedKey || 'sk-...'} disabled={health.ai?.envLocked} onChange={(event) => { setCredentialValue(event.target.value); setCredentialSource('draft'); }} />
                <button type="button" className="icon-button" title={credentialVisible ? '隐藏密钥' : '显示密钥'} onClick={revealCredential} disabled={health.ai?.envLocked}>{credentialVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button type="button" className="icon-button" title="复制密钥" onClick={copyCredential} disabled={health.ai?.envLocked}><Copy size={16} /></button>
              </div>
            </label>
            <label className="field wide"><span>模型</span><input value={config.model} onChange={(event) => setConfig(resetCapability(config, { model: event.target.value }))} /></label>
            <label className="field wide"><span>Base URL</span><input value={config.base_url} placeholder={DEFAULT_BASE_URL} disabled={health.ai?.baseUrlLocked} onChange={(event) => setConfig(resetCapability(config, { base_url: event.target.value }))} /></label>
            {config.api_protocol && config.structured_output_mode && <div className="field wide"><span>已验证能力</span><p className="muted">{config.api_protocol === 'responses' ? 'Responses API' : 'Chat Completions'} · {config.structured_output_mode === 'json_schema' ? 'JSON Schema' : 'JSON Object'}</p></div>}
          </div>
          <div className="action-row ai-form-actions">
            <button type="button" className="ghost-button" onClick={activateProfile} disabled={!config.id || isEditingActive}><CheckCircle2 size={17} />设为当前</button>
            <button type="button" className="ghost-button" onClick={testConnection} disabled={testing}><RadioTower size={17} />{testing ? '测试中...' : '测试连接'}</button>
            <button type="button" className="primary-action" onClick={save}><Save size={17} />保存并启用</button>
          </div>
        </div>
      </div>
    </section>
  );
}
