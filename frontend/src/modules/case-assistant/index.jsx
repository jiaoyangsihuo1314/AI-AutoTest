import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  RotateCcw,
  Send,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import useCaseAssistant from '../../hooks/useCaseAssistant';

const QUICK_ACTIONS = ['检查遗漏', '补充边界用例', '优化测试步骤', '检查需求可追溯性'];
const FIELD_OPTIONS = [
  ['', '不限字段'],
  ['priority', '优先级'],
  ['title', '标题'],
  ['requirement', '覆盖需求'],
  ['preconditions', '前置条件/测试数据'],
  ['steps', '步骤'],
  ['expected', '期望结果'],
  ['automationNotes', '自动化说明'],
];
const FIELD_LABELS = Object.fromEntries(FIELD_OPTIONS.filter(([key]) => key));
const OPERATION_LABELS = { add: '新增', update: '修改', delete: '删除' };
const ADD_DETAIL_FIELDS = [
  ['externalId', '用例 ID'],
  ['priority', '优先级'],
  ['title', '标题'],
  ['requirement', '覆盖需求'],
  ['preconditions', '前置条件/测试数据'],
  ['steps', '步骤'],
  ['expected', '期望结果'],
  ['automationNotes', '自动化说明'],
];

function AddCaseDetail({ operation }) {
  const details = operation.after || {};
  const displayValue = (field) => details[field] || (field === 'externalId' ? operation.targetExternalId : '') || '暂无';

  return (
    <div className="case-ai-add-detail" data-testid={`case-ai-add-detail-${operation.id}`}>
      <dl>
        {ADD_DETAIL_FIELDS.map(([field, label]) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>{displayValue(field)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProposalCard({ proposal, draftMarkdown, onApply, onReject, appliedOperationIds, onUndo, disabled }) {
  const selectableOperations = proposal.operations || [];
  const [selectedIds, setSelectedIds] = useState(() => new Set(
    selectableOperations.filter((operation) => operation.type !== 'delete' && !appliedOperationIds.has(operation.id)).map((operation) => operation.id),
  ));
  const [busy, setBusy] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [expandedOperationIds, setExpandedOperationIds] = useState(() => new Set());

  useEffect(() => {
    setSelectedIds(new Set(selectableOperations.filter((operation) => operation.type !== 'delete' && !appliedOperationIds.has(operation.id)).map((operation) => operation.id)));
  }, [proposal.id, [...appliedOperationIds].sort().join(',')]);

  useEffect(() => {
    setExpandedOperationIds(new Set());
  }, [proposal.id]);

  const toggleOperationDetails = (operationId) => {
    setExpandedOperationIds((current) => {
      const next = new Set(current);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  };

  const toggleOperation = (operation) => {
    if (operation.type === 'delete' && !selectedIds.has(operation.id)) {
      const confirmed = window.confirm(`确认选择删除用例 ${operation.targetExternalId}？应用后仍需点击“保存修改”才会正式删除。`);
      if (!confirmed) return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(operation.id)) next.delete(operation.id);
      else next.add(operation.id);
      return next;
    });
  };

  const applySelected = async () => {
    if (!selectedIds.size) return;
    setBusy('apply');
    try {
      const result = await onApply(proposal, [...selectedIds], draftMarkdown);
      setConflicts(result.conflicts || []);
    } finally {
      setBusy('');
    }
  };

  const reject = async () => {
    setBusy('reject');
    try {
      await onReject(proposal.id);
    } finally {
      setBusy('');
    }
  };

  const terminal = ['committed', 'rejected'].includes(proposal.status);

  return (
    <section className="case-ai-proposal" aria-label={`AI 变更提案 ${proposal.summary}`}>
      <header>
        <div>
          <Sparkles size={16} />
          <strong>{proposal.summary}</strong>
        </div>
        <span className={`case-ai-status ${proposal.status}`}>{proposal.status === 'committed' ? '已保存' : proposal.status === 'rejected' ? '已拒绝' : proposal.status === 'partially_committed' ? '部分保存' : '待审阅'}</span>
      </header>
      <div className="case-ai-operation-list">
        {selectableOperations.map((operation) => (
          <div className={`case-ai-operation ${operation.type}`} key={operation.id}>
            <label className="case-ai-operation-select">
              <input
                type="checkbox"
                aria-label={`选择${OPERATION_LABELS[operation.type]}操作 ${operation.targetExternalId}`}
                checked={selectedIds.has(operation.id)}
                disabled={terminal || disabled || appliedOperationIds.has(operation.id)}
                onChange={() => toggleOperation(operation)}
              />
            </label>
            <div className="case-ai-operation-main">
              <div className="case-ai-operation-title">
                <span>{OPERATION_LABELS[operation.type]}</span>
                <strong>{operation.targetExternalId}</strong>
                {appliedOperationIds.has(operation.id) && <em>已应用到草稿</em>}
                {operation.type === 'add' && (
                  <button
                    type="button"
                    className="case-ai-detail-toggle"
                    aria-expanded={expandedOperationIds.has(operation.id)}
                    aria-controls={`case-ai-add-detail-${operation.id}`}
                    onClick={() => toggleOperationDetails(operation.id)}
                  >
                    {expandedOperationIds.has(operation.id) ? <ChevronUp size={13} /> : <Eye size={13} />}
                    {expandedOperationIds.has(operation.id) ? '收起详情' : '查看详情'}
                  </button>
                )}
              </div>
              {operation.type === 'update' && Object.keys(operation.after || {}).map((field) => (
                <div className="case-ai-diff" key={field}>
                  <b>{FIELD_LABELS[field] || field}</b>
                  <del>{operation.before?.[field] || '空'}</del>
                  <span>{operation.after?.[field] || '清空'}</span>
                </div>
              ))}
              {operation.type === 'add' && <p>{operation.after?.title || '新增测试用例'} · {operation.after?.priority || 'P1'}</p>}
              {operation.type === 'add' && expandedOperationIds.has(operation.id) && <AddCaseDetail operation={operation} />}
              {operation.type === 'delete' && <p>{operation.before?.title || '删除当前测试用例'}</p>}
              {operation.reason && <small>{operation.reason}</small>}
            </div>
          </div>
        ))}
      </div>
      {conflicts.length > 0 && (
        <div className="case-ai-conflicts" role="alert">
          <AlertTriangle size={15} />
          <span>{conflicts.map((item) => `${item.targetExternalId}：${item.message}`).join('；')}</span>
        </div>
      )}
      {!terminal && (
        <footer>
          {appliedOperationIds.size > 0 && (
            <button type="button" className="ghost-button" onClick={() => onUndo(proposal.id)}>
              <RotateCcw size={15} />
              撤销最近应用
            </button>
          )}
          <button type="button" className="ghost-button" disabled={Boolean(busy) || disabled || appliedOperationIds.size > 0} onClick={reject}>拒绝</button>
          <button type="button" className="primary-action" disabled={!selectedIds.size || Boolean(busy) || disabled} onClick={applySelected}>
            <Check size={15} />
            {busy === 'apply' ? '应用中...' : `应用选中（${selectedIds.size}）`}
          </button>
        </footer>
      )}
    </section>
  );
}

export default function CaseAssistantPanel({
  item,
  rows,
  draftMarkdown,
  open,
  onClose,
  canEdit,
  aiConfigured,
  initialTarget,
  onApplied,
  appliedProposalIds,
  onUndo,
}) {
  const { messages, loading, sending, error, setError, loadHistory, sendMessage, applyProposal, rejectProposal } = useCaseAssistant(item?.id || '');
  const [input, setInput] = useState('');
  const [targetCaseId, setTargetCaseId] = useState('');
  const [targetField, setTargetField] = useState('');
  const streamRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!initialTarget) return;
    setTargetCaseId(initialTarget);
    if (open) textareaRef.current?.focus();
  }, [initialTarget, open]);

  useEffect(() => {
    if (!open) return;
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [messages, open, sending]);

  useEffect(() => {
    if (open && item?.id) loadHistory();
  }, [item?.casesRevisionId]);

  const caseOptions = useMemo(() => rows.map((row) => ({ id: row.externalId, title: row.title })), [rows]);

  const submit = async (message = input) => {
    const normalized = message.trim();
    if (!normalized || sending || !canEdit || !aiConfigured) return;
    setInput('');
    try {
      await sendMessage({
        message: normalized,
        draft_markdown: draftMarkdown,
        base_cases_revision_id: item?.casesRevisionId ?? null,
        target: {
          case_ids: targetCaseId ? [targetCaseId] : [],
          fields: targetField ? [targetField] : [],
        },
      });
    } catch {
      setInput(normalized);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  if (!open) return null;

  return (
    <aside className="case-ai-panel" aria-label="用例设计 AI 助手" data-testid="case-ai-panel">
      <header className="case-ai-header">
        <div>
          <span className="case-ai-avatar"><Bot size={18} /></span>
          <div>
            <h3>AI 助手</h3>
            <p>{rows.length} 条用例 · {targetCaseId || '全部上下文'}</p>
          </div>
        </div>
        <button type="button" className="case-ai-close" title="关闭 AI 助手" aria-label="关闭 AI 助手" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="case-ai-context">
        <label>
          <span>目标用例</span>
          <div><select value={targetCaseId} onChange={(event) => setTargetCaseId(event.target.value)}>
            <option value="">全部当前用例</option>
            {caseOptions.map((caseItem) => <option value={caseItem.id} key={caseItem.id}>{caseItem.id} · {caseItem.title}</option>)}
          </select><ChevronDown size={14} /></div>
        </label>
        <label>
          <span>目标字段</span>
          <div><select value={targetField} onChange={(event) => setTargetField(event.target.value)}>
            {FIELD_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select><ChevronDown size={14} /></div>
        </label>
      </div>

      <div className="case-ai-quick-actions" aria-label="AI 快捷操作">
        {QUICK_ACTIONS.map((action) => <button type="button" key={action} disabled={sending || !canEdit || !aiConfigured} onClick={() => submit(action)}>{action}</button>)}
      </div>

      <div className="case-ai-stream" ref={streamRef} aria-live="polite">
        {loading && <div className="case-ai-empty"><Sparkles size={20} /><span>正在加载工单对话...</span></div>}
        {!loading && !messages.length && (
          <div className="case-ai-empty">
            <Bot size={24} />
            <strong>从当前用例开始协作</strong>
            <span>选择用例或字段后提出修改要求。</span>
          </div>
        )}
        {messages.map((message) => (
          <article className={`case-ai-message ${message.role}`} key={message.id}>
            <span className="case-ai-message-avatar">{message.role === 'user' ? <UserRound size={15} /> : <Bot size={15} />}</span>
            <div>
              <header><strong>{message.role === 'user' ? message.actorDisplayName || '工单成员' : 'AI 助手'}</strong></header>
              <div className="case-ai-message-content"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{message.content}</ReactMarkdown></div>
              {message.proposal && (
                <ProposalCard
                  proposal={message.proposal}
                  draftMarkdown={draftMarkdown}
                  onApply={async (proposal, operationIds, markdown) => {
                    const result = await applyProposal(proposal.id, { draft_markdown: markdown, operation_ids: operationIds });
                    if (result.appliedOperationIds?.length) onApplied(proposal, result);
                    return result;
                  }}
                  onReject={rejectProposal}
                  appliedOperationIds={appliedProposalIds.get(message.proposal.id) || new Set()}
                  onUndo={onUndo}
                  disabled={!canEdit}
                />
              )}
            </div>
          </article>
        ))}
        {sending && <div className="case-ai-thinking"><span /><span /><span /> AI 正在分析当前草稿</div>}
      </div>

      {error && <div className="case-ai-error" role="alert"><AlertTriangle size={15} /><span>{error}</span><button type="button" aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></button></div>}
      {!aiConfigured && <div className="case-ai-unavailable"><AlertTriangle size={16} /><span>AI 尚未配置，请联系管理员完成模型配置。</span></div>}
      {!canEdit && <div className="case-ai-unavailable"><AlertTriangle size={16} /><span>当前账号可以查看历史，但不能发送或应用变更。</span></div>}

      <div className="case-ai-composer">
        <textarea
          ref={textareaRef}
          value={input}
          maxLength={4000}
          disabled={sending || !canEdit || !aiConfigured}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例如：把 TC-001 的期望结果改得更可验证"
          aria-label="发送给 AI 助手的消息"
        />
        <button type="button" title="发送消息" aria-label="发送消息" disabled={!input.trim() || sending || !canEdit || !aiConfigured} onClick={() => submit()}><Send size={17} /></button>
      </div>
    </aside>
  );
}
