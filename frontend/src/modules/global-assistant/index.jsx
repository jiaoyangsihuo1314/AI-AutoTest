import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  Check,
  ChevronLeft,
  Clock3,
  Copy,
  History,
  Maximize2,
  Menu,
  MessageSquarePlus,
  Minimize2,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  LoaderCircle,
  Trash2,
  X,
} from 'lucide-react';
import useGlobalAssistant from '../../hooks/useGlobalAssistant';

const WIDTH_KEY = 'qa-global-assistant-width';
const QUICK_PROMPTS = ['分析一个测试报错', '给出问题排查步骤', '解释一个测试概念'];

function readWidth() {
  const stored = window.localStorage.getItem(WIDTH_KEY);
  if (!stored) return 420;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.min(560, Math.max(360, value)) : 420;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function MarkdownMessage({ content }) {
  const [copiedCode, setCopiedCode] = useState('');
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
        pre: ({ children }) => {
          const code = String(children?.props?.children || '').replace(/\n$/, '');
          return (
            <div className="global-ai-code-wrap">
              <button
                type="button"
                className="global-ai-code-copy"
                title="复制代码"
                aria-label="复制代码"
                onClick={async () => {
                  await copyText(code);
                  setCopiedCode(code);
                  window.setTimeout(() => setCopiedCode(''), 1500);
                }}
              >
                {copiedCode === code ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <pre>{children}</pre>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function ActionCard({ action, canOperate, onApprove, onReject }) {
  const [busy, setBusy] = useState('');
  const statusLabels = {
    proposed: '待确认', running: '执行中', completed: '已完成', failed: '失败', rejected: '已拒绝', expired: '已过期',
  };
  const decide = async (decision) => {
    setBusy(decision);
    try {
      await (decision === 'approve' ? onApprove(action.id) : onReject(action.id));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className={`global-ai-action-card ${action.status}`}>
      <div className="global-ai-action-heading">
        <strong>{action.summary}</strong>
        <span>{statusLabels[action.status] || action.status}</span>
      </div>
      <p>{action.effect}</p>
      {action.arguments?.case && <small>用例：{action.arguments.case.externalId} {action.arguments.case.title}</small>}
      {action.arguments?.debugSessionId && <small>调试会话：{action.arguments.debugSessionId}</small>}
      {action.error && <div className="global-ai-action-error">{action.error}</div>}
      {action.status === 'completed' && action.result?.debugSessionId && (
        <div className="global-ai-action-result">调试会话 {action.result.debugSessionId} 已更新</div>
      )}
      {action.status === 'proposed' && (
        <div className="global-ai-action-buttons">
          <button type="button" onClick={() => decide('reject')} disabled={Boolean(busy)}>拒绝</button>
          <button type="button" className="primary-action" onClick={() => decide('approve')} disabled={!canOperate || Boolean(busy)}>
            {busy === 'approve' ? <LoaderCircle size={14} className="global-ai-stop-spinner" /> : <Check size={14} />}
            {canOperate ? '确认执行' : '当前角色仅可查询'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function GlobalAssistant({ ai, userRole, onOpenAIConfig }) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [drawerWidth, setDrawerWidth] = useState(readWidth);
  const [maximized, setMaximized] = useState(false);
  const [unread, setUnread] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const initializedRef = useRef(false);
  const messagesRef = useRef(null);
  const textareaRef = useRef(null);
  const assistant = useGlobalAssistant();

  const activeConversation = useMemo(
    () => assistant.conversations.find((item) => item.id === assistant.activeConversationId) || null,
    [assistant.activeConversationId, assistant.conversations],
  );

  useEffect(() => {
    if (!open || initializedRef.current) return;
    initializedRef.current = true;
    assistant.loadConversations();
  }, [open, assistant.loadConversations]);

  useEffect(() => {
    if (!open && assistant.completionRevision) setUnread(true);
  }, [assistant.completionRevision, open]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  useEffect(() => {
    const target = messagesRef.current;
    if (target) target.scrollTop = target.scrollHeight;
  }, [assistant.messages, assistant.sending]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (maximized) setMaximized(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maximized, open]);

  const send = async (value = draft) => {
    if (!ai?.configured || !value.trim() || assistant.sending) return;
    setDraft('');
    await assistant.sendMessage(value);
    textareaRef.current?.focus();
  };

  const retryMessage = (index) => {
    const previous = [...assistant.messages.slice(0, index)].reverse().find((item) => item.role === 'user');
    if (previous) send(previous.content);
  };

  const beginResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const move = (moveEvent) => setDrawerWidth(Math.min(560, Math.max(360, startWidth + startX - moveEvent.clientX)));
    const finish = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', finish);
      setDrawerWidth((value) => {
        window.localStorage.setItem(WIDTH_KEY, String(value));
        return value;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
  };

  const renameConversation = async (conversation) => {
    const title = window.prompt('输入新的会话名称', conversation.title);
    if (title?.trim() && title.trim() !== conversation.title) await assistant.renameConversation(conversation.id, title.trim());
  };

  const deleteConversation = async (conversation) => {
    if (!window.confirm(`确认删除会话“${conversation.title}”？此操作无法撤销。`)) return;
    await assistant.removeConversation(conversation.id);
  };

  return (
    <>
      <button
        type="button"
        className={`global-ai-launcher ${assistant.sending ? 'generating' : ''} ${open ? 'open' : ''}`}
        aria-label="全局 AI 助手"
        title="全局 AI 助手"
        onClick={() => setOpen((value) => !value)}
      >
        <Bot size={21} />
        {unread && <span className="global-ai-unread" aria-label="有新的 AI 回复" />}
      </button>

      {open && (
        <aside className={maximized ? 'global-ai-drawer maximized' : 'global-ai-drawer'} style={{ '--global-ai-width': `${drawerWidth}px` }} aria-label="全局 AI 助手" role="dialog">
          <div className="global-ai-resize-handle" onMouseDown={beginResize} aria-hidden="true" />
          <header className="global-ai-header">
            {historyOpen && (
              <button type="button" className="icon-button global-ai-mobile-back" title="返回对话" aria-label="返回对话" onClick={() => setHistoryOpen(false)}>
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="global-ai-title">
              <span className="global-ai-avatar"><Sparkles size={18} /></span>
              <div>
                <strong>全局 AI 助手</strong>
                <span>{ai?.configured ? ai.model || '已配置模型' : 'AI 尚未配置'}</span>
              </div>
            </div>
            <div className="global-ai-header-actions">
              <button type="button" className="icon-button" title="新建会话" aria-label="新建会话" onClick={() => { assistant.newConversation(); setHistoryOpen(false); }}>
                <MessageSquarePlus size={18} />
              </button>
              <button type="button" className={historyOpen ? 'icon-button active' : 'icon-button'} title="历史会话" aria-label="历史会话" onClick={() => setHistoryOpen((value) => !value)}>
                <History size={18} />
              </button>
              <button
                type="button"
                className="icon-button global-ai-maximize-button"
                title={maximized ? '还原窗口' : '放大窗口'}
                aria-label={maximized ? '还原全局 AI 助手' : '放大全局 AI 助手'}
                aria-pressed={maximized}
                onClick={() => setMaximized((value) => !value)}
              >
                {maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
              <button type="button" className="icon-button" title="关闭" aria-label="关闭全局 AI 助手" onClick={() => { setOpen(false); setMaximized(false); }}>
                <X size={19} />
              </button>
            </div>
          </header>

          {historyOpen ? (
            <section className="global-ai-history">
              <div className="global-ai-history-heading">
                <div><Menu size={17} /><strong>历史会话</strong></div>
                <span>{assistant.conversations.length} 条</span>
              </div>
              <div className="global-ai-history-list">
                {assistant.conversations.map((conversation) => (
                  <div className={conversation.id === assistant.activeConversationId ? 'global-ai-history-item active' : 'global-ai-history-item'} key={conversation.id}>
                    <button type="button" onClick={() => { assistant.selectConversation(conversation.id); setHistoryOpen(false); }}>
                      <strong>{conversation.title}</strong>
                      <span><Clock3 size={12} />{new Date(conversation.lastMessageAt).toLocaleString()}</span>
                    </button>
                    <div>
                      <button type="button" title="重命名" aria-label="重命名会话" onClick={() => renameConversation(conversation)}><Pencil size={14} /></button>
                      <button type="button" title="删除" aria-label="删除会话" onClick={() => deleteConversation(conversation)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className="global-ai-conversation-bar">
                <strong>{activeConversation?.title || '新对话'}</strong>
              </div>
              <section className="global-ai-messages" ref={messagesRef} aria-live="polite">
                {!ai?.configured ? (
                  <div className="global-ai-unavailable">
                    <Bot size={30} />
                    <strong>AI 尚未配置</strong>
                    <p>{userRole === 'admin' ? '请先启用一个可用的 AI 配置。' : '请联系管理员配置并启用 AI 模型。'}</p>
                    {userRole === 'admin' && <button type="button" className="primary-action" onClick={() => { setOpen(false); onOpenAIConfig?.(); }}>前往 AI 配置</button>}
                  </div>
                ) : !assistant.messages.length && !assistant.loading ? (
                  <div className="global-ai-empty">
                    <span className="global-ai-empty-icon"><Sparkles size={23} /></span>
                    <strong>今天想一起解决什么问题？</strong>
                    <div>
                      {QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}
                    </div>
                  </div>
                ) : (
                  assistant.messages.map((message, index) => (
                    <article className={`global-ai-message ${message.role}`} key={message.id}>
                      <div className="global-ai-message-avatar">{message.role === 'assistant' ? <Bot size={16} /> : '我'}</div>
                      <div className="global-ai-message-body">
                        <div className="global-ai-message-bubble">
                          {message.content ? <MarkdownMessage content={message.content} /> : message.status === 'streaming' ? <span className="global-ai-thinking">正在思考<span>...</span></span> : '未生成内容'}
                        </div>
                        {(message.actions || []).map((action) => (
                          <ActionCard
                            key={action.id}
                            action={action}
                            canOperate={['admin', 'lead', 'executor'].includes(userRole)}
                            onApprove={assistant.approveAction}
                            onReject={assistant.rejectAction}
                          />
                        ))}
                        {message.role === 'assistant' && message.status !== 'streaming' && (
                          <div className="global-ai-message-actions">
                            {message.content && (
                              <button type="button" onClick={async () => { await copyText(message.content); setCopiedMessageId(message.id); window.setTimeout(() => setCopiedMessageId(''), 1500); }}>
                                {copiedMessageId === message.id ? <Check size={13} /> : <Copy size={13} />}{copiedMessageId === message.id ? '已复制' : '复制'}
                              </button>
                            )}
                            <button type="button" onClick={() => retryMessage(index)} disabled={assistant.sending}><RotateCcw size={13} />重新生成</button>
                            {message.status === 'failed' && <span>生成失败</span>}
                            {message.status === 'cancelled' && <span>已停止</span>}
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </section>
              {assistant.error && <div className="global-ai-error" role="alert">{assistant.error}<button type="button" aria-label="关闭错误" onClick={() => assistant.setError('')}><X size={14} /></button></div>}
              <footer className="global-ai-composer">
                <div className="global-ai-input-wrap">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    rows={3}
                    placeholder={ai?.configured ? '请描述所在页面、操作步骤、实际现象和预期结果' : 'AI 配置完成后即可提问'}
                    disabled={!ai?.configured || assistant.sending}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  {assistant.sending ? (
                    <button type="button" className="global-ai-send stop" title={assistant.stopping ? '正在停止' : '停止生成'} aria-label={assistant.stopping ? '正在停止 AI 回复' : '停止生成'} disabled={assistant.stopping} onClick={assistant.stop}>
                      {assistant.stopping ? <LoaderCircle size={17} className="global-ai-stop-spinner" /> : <Square size={16} />}
                    </button>
                  ) : (
                    <button type="button" className="global-ai-send" title="发送" aria-label="发送" disabled={!draft.trim() || !ai?.configured} onClick={() => send()}><Send size={17} /></button>
                  )}
                </div>
              </footer>
            </>
          )}
        </aside>
      )}
    </>
  );
}
