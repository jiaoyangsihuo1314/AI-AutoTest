import React, { useRef, useState } from 'react';
import {
  ClipboardList,
  Eye,
  EyeOff,
  FlaskConical,
  Lock,
  MonitorPlay,
  RefreshCw,
  Sparkles,
  UserCog,
  Wand2,
} from 'lucide-react';
import autoTestLogoMark from '../../assets/auto-test-logo-mark.png';

export function AuthBoundary({ children }) {
  return children ?? null;
}

export function AuthPlatformLogo() {
  return <img className="auth-platform-logo" src={autoTestLogoMark} alt="" aria-hidden="true" draggable="false" />;
}

export function AuthWorkspaceHero() {
  const highlights = [
    { icon: ClipboardList, title: '需求分析与项目预检', description: '自动抽取测试目标、角色、数据与验收标准，并检查 Playwright 配置和项目约定。', tone: 'teal' },
    { icon: FlaskConical, title: '用例设计与页面探索', description: '沉淀可追溯测试用例，调起实时浏览器采集页面结构、截图、日志和候选元素。', tone: 'blue' },
    { icon: MonitorPlay, title: '脚本生成与运行验证', description: 'AI 或人工编辑 Playwright 脚本，执行草稿 spec，展示实时日志、报告和历史结果。', tone: 'indigo' },
    { icon: Wand2, title: '自愈诊断与交付归档', description: '失败后记录修复尝试，验证通过后保存用例、spec、报告和运行证据。', tone: 'cyan' },
  ];
  const metrics = [
    { value: '8 步', label: '自动化流程' },
    { value: '实时', label: '浏览器探索画面' },
    { value: '可追溯', label: '验证产物归档' },
  ];

  return (
    <aside className="auth-hero" aria-label="平台品牌">
      <div className="auth-brand"><span className="auth-brand-mark"><AuthPlatformLogo /></span><strong>Web 智能测试平台</strong><span>AI-Powered Web Testing Platform</span></div>
      <div className="auth-hero-copy"><h2><span>从需求到交付</span><span>自动化测试闭环</span></h2><p>面向本地自动化测试场景，串联需求分析、项目预检、用例设计、页面探索、脚本实现、运行验证、自愈诊断和测试报告，让 Playwright 测试从草稿到已验证产物全程可追踪。</p></div>
      <div className="auth-feature-list" aria-label="平台能力">
        {highlights.map((item) => {
          const Icon = item.icon;
          return <div className="auth-feature-item" key={item.title}><span className={`auth-feature-icon ${item.tone}`}><Icon size={19} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span></div>;
        })}
      </div>
      <div className="auth-metric-strip" aria-label="平台指标">{metrics.map((item) => <div className="auth-metric" key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>
    </aside>
  );
}

export function AuthGate({ mode, setMode, clearAuthFeedback, submitLogin, submitRegister, submitting, error, message, themeId }) {
  const isRegister = mode === 'register';
  const [credentialRevealed, setCredentialRevealed] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const credentials = {
      username: String(data.get('username') || ''),
      password: String(data.get('password') || ''),
    };
    const succeeded = isRegister
      ? await submitRegister({ ...credentials, display_name: String(data.get('display_name') || '') })
      : await submitLogin(credentials);
    if (succeeded) form.reset();
  };

  const handleModeSwitch = () => {
    clearAuthFeedback();
    setCredentialRevealed(false);
    formRef.current?.reset();
    setMode(isRegister ? 'login' : 'register');
  };

  return (
    <main className="auth-shell" data-theme={themeId}>
      <section className="auth-panel auth-layout" aria-label={isRegister ? '注册账号' : '登录平台'} data-testid="auth-panel">
        <AuthWorkspaceHero />
        <div className="auth-card"><div className="auth-card-surface">
          <div className="auth-card-header"><span className="auth-card-logo"><AuthPlatformLogo /></span><h1>{isRegister ? '申请平台账号' : '欢迎回来'}</h1><p>{isRegister ? '提交账号后等待管理员审核启用' : '登录到 Web 智能测试平台，开始您的测试之旅'}</p></div>
          <form className="auth-form" onSubmit={handleSubmit} ref={formRef}>
            <label className="field wide"><span>登录名</span><div className="auth-input-wrap"><UserCog size={17} /><input name="username" aria-label="登录名" autoComplete="username" placeholder="请输入登录名" inputMode="text" /></div>{isRegister && <small className="auth-field-hint">3-32 位，可使用字母、数字、点、下划线或短横线。</small>}</label>
            {isRegister && <label className="field wide"><span>昵称</span><div className="auth-input-wrap"><Sparkles size={17} /><input name="display_name" aria-label="昵称" placeholder="请输入团队内显示名称" /></div></label>}
            <label className="field wide"><span>密码</span><div className="auth-input-wrap"><Lock size={17} /><input name="password" aria-label="密码" type={credentialRevealed ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder={isRegister ? '至少 8 位，包含字母和数字' : '请输入密码'} /><button type="button" className="auth-password-toggle" aria-label={credentialRevealed ? '隐藏密码' : '显示密码'} aria-pressed={credentialRevealed} onClick={() => setCredentialRevealed((value) => !value)}>{credentialRevealed ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{isRegister && <small className="auth-field-hint">至少 8 位，并包含字母和数字。</small>}</label>
            {error && <div className="auth-message danger" role="alert">{error}</div>}
            {message && <div className="auth-message success" role="status">{message}</div>}
            <button type="submit" className="primary-action auth-submit" disabled={submitting}>{submitting ? <RefreshCw className="auth-submit-spinner" size={17} /> : <Sparkles size={17} />}{submitting ? '处理中...' : isRegister ? '提交注册' : '登录'}</button>
          </form>
          <button type="button" className="auth-switch" onClick={handleModeSwitch}>{isRegister ? '已有账号，返回登录' : '还没有账号？ 立即注册'}</button>
          {!isRegister && <div className="auth-default-account" aria-label="默认管理员账号"><Sparkles size={14} /><span>默认管理员账号: <strong>admin</strong>，首次密码由部署环境配置</span></div>}
        </div></div>
      </section>
    </main>
  );
}
