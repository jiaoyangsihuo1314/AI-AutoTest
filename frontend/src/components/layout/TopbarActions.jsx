import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, CircleDot, CircleHelp, Lock, LogOut, Palette, UserRound } from 'lucide-react';

export default function TopbarActions({
  health,
  error,
  notice,
  latestRun,
  automationStatus,
  automationStage,
  themes,
  themeId,
  setThemeId,
  user,
  flowStages,
  roleLabels,
  formatStatus,
  requestJson,
  onError,
  onNotice,
  logout,
}) {
  const [openPanel, setOpenPanel] = useState('');
  const [credentialPanelOpen, setCredentialPanelOpen] = useState(false);
  const actionsRef = useRef(null);
  const credentialFormRef = useRef(null);
  const notifications = useMemo(() => {
    const items = [];
    if (error) items.push({ tone: 'danger', title: '当前错误', detail: error });
    if (notice) items.push({ tone: 'success', title: '最新提示', detail: notice });
    if (health.status === 'checking') items.push({ tone: 'info', title: '后端检查中', detail: '正在连接本地服务。' });
    else if (health.status !== 'ok') items.push({ tone: 'danger', title: '后端离线', detail: '本地后端服务当前不可用。' });
    if (!health.ai?.configured) items.push({ tone: 'warning', title: 'AI 未配置', detail: 'AI 生成能力当前不可用。' });
    if (latestRun?.status === 'running') items.push({ tone: 'info', title: '最近执行运行中', detail: `${latestRun.stage?.label || '运行验证'} · ${formatStatus(latestRun.status)}` });
    else if (latestRun?.status === 'failed') items.push({ tone: 'danger', title: '最近执行失败', detail: latestRun.error || `退出码 ${latestRun.exitCode ?? latestRun.exit_code ?? '-'}` });
    if (automationStatus === 'running' || automationStatus === 'healing') items.push({ tone: 'info', title: '全流程运行中', detail: automationStage ? `当前阶段：${automationStage}` : formatStatus(automationStatus) });
    else if (automationStatus === 'failed' || automationStatus === 'blocked') items.push({ tone: 'danger', title: '全流程异常', detail: automationStage ? `${automationStage} · ${formatStatus(automationStatus)}` : formatStatus(automationStatus) });
    return items;
  }, [automationStage, automationStatus, error, formatStatus, health.ai?.configured, health.status, latestRun, notice]);

  useEffect(() => {
    if (!openPanel) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!actionsRef.current?.contains(event.target)) setOpenPanel('');
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenPanel('');
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPanel]);

  const togglePanel = (panel) => setOpenPanel((current) => (current === panel ? '' : panel));
  const submitCredentialUpdate = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await requestJson('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: String(data.get('current_password') || ''),
          new_password: String(data.get('new_password') || ''),
        }),
      });
      form.reset();
      setCredentialPanelOpen(false);
      onError('');
      onNotice('密码已修改');
    } catch (requestError) {
      onError(`修改密码失败：${requestError.message}`);
    }
  };

  const hasNotifications = notifications.length > 0;
  return (
    <div className="topbar-actions" aria-label="顶部工具区" data-testid="topbar-actions" ref={actionsRef}>
      <div className="topbar-action">
        <button type="button" className={openPanel === 'theme' ? 'topbar-icon-button active' : 'topbar-icon-button'} aria-label="界面主题" aria-expanded={openPanel === 'theme'} aria-haspopup="dialog" onClick={() => togglePanel('theme')}><Palette size={22} /></button>
        {openPanel === 'theme' && <section className="topbar-popover theme-popover" role="dialog" aria-label="界面主题面板" data-testid="topbar-theme-panel"><header><strong>界面主题</strong><span>{themes.find((theme) => theme.id === themeId)?.label || '默认'}</span></header><div className="theme-menu" aria-label="主题选择"><div className="theme-options">{themes.map((theme) => <button type="button" className={themeId === theme.id ? 'theme-option active' : 'theme-option'} key={theme.id} aria-pressed={themeId === theme.id} onClick={() => setThemeId(theme.id)}><span className="theme-swatches" aria-hidden="true">{theme.swatches.map((swatch) => <span key={swatch} style={{ background: swatch }} />)}</span><span><strong>{theme.label}</strong><small>{theme.description}</small></span></button>)}</div></div></section>}
      </div>
      <div className="topbar-action">
        <button type="button" className={openPanel === 'notifications' ? 'topbar-icon-button active' : 'topbar-icon-button'} aria-label="通知消息" aria-expanded={openPanel === 'notifications'} aria-haspopup="dialog" onClick={() => togglePanel('notifications')}><Bell size={22} />{hasNotifications && <span className="topbar-badge" aria-hidden="true" />}</button>
        {openPanel === 'notifications' && <section className="topbar-popover notification-popover" role="dialog" aria-label="通知消息面板" data-testid="topbar-notification-panel"><header><strong>平台消息</strong><span>{hasNotifications ? `${notifications.length} 条` : '暂无'}</span></header><div className="notification-list">{hasNotifications ? notifications.map((item, index) => <div className={`notification-item ${item.tone}`} key={`${item.title}-${index}`}><CircleDot size={10} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>) : <div className="notification-empty">暂无新的平台消息</div>}</div></section>}
      </div>
      <div className="topbar-action">
        <button type="button" className={openPanel === 'help' ? 'topbar-icon-button active' : 'topbar-icon-button'} aria-label="流程帮助" aria-expanded={openPanel === 'help'} aria-haspopup="dialog" onClick={() => togglePanel('help')}><CircleHelp size={22} /></button>
        {openPanel === 'help' && <section className="topbar-popover help-popover" role="dialog" aria-label="流程帮助面板" data-testid="topbar-help-panel"><header><strong>流程帮助</strong><span>QA Workflow</span></header><div className="topbar-flow-list">{flowStages.map((stage, index) => <div className="topbar-flow-step" key={stage}><span>{index + 1}</span><strong>{stage}</strong></div>)}</div></section>}
      </div>
      <div className="topbar-action">
        <button type="button" className={openPanel === 'user' ? 'topbar-icon-button qa-menu-button active' : 'topbar-icon-button qa-menu-button'} aria-label="QA 用户菜单" aria-expanded={openPanel === 'user'} aria-haspopup="dialog" onClick={() => togglePanel('user')}><span className="qa-avatar qa-avatar-icon" aria-hidden="true"><UserRound size={20} /></span><ChevronDown size={16} /></button>
        {openPanel === 'user' && <section className="topbar-popover user-popover" role="dialog" aria-label="QA 用户菜单" data-testid="topbar-user-panel">
          <div className="topbar-user-card"><span className="qa-avatar large">{(user?.displayName || user?.username || 'QA').slice(0, 2).toUpperCase()}</span><div><strong>{user?.displayName || user?.username || 'QA 用户'}</strong><span>{roleLabels[user?.role] || user?.role || '已登录'}</span></div></div>
          <button type="button" className="user-menu-action" onClick={() => setCredentialPanelOpen((value) => !value)}><Lock size={16} />修改密码</button>
          {credentialPanelOpen && <form className="password-panel" onSubmit={submitCredentialUpdate} ref={credentialFormRef}><input name="current_password" type="password" autoComplete="current-password" placeholder="当前密码" /><input name="new_password" type="password" autoComplete="new-password" placeholder="新密码" /><button type="submit" className="primary-action">保存密码</button></form>}
          <button type="button" className="user-menu-action" onClick={() => { setOpenPanel(''); logout(); }}><LogOut size={16} />退出</button>
        </section>}
      </div>
    </div>
  );
}
