import { useCallback, useRef, useState } from 'react';
import {
  approveGlobalAssistantAction,
  cancelGlobalAssistantGeneration,
  createGlobalAssistantConversation,
  deleteGlobalAssistantConversation,
  getGlobalAssistantConversations,
  getGlobalAssistantMessages,
  rejectGlobalAssistantAction,
  renameGlobalAssistantConversation,
  streamGlobalAssistantMessage,
} from '../api/globalAssistantApi';

export default function useGlobalAssistant() {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [completionRevision, setCompletionRevision] = useState(0);
  const abortRef = useRef(null);
  const activeGenerationRef = useRef(null);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const payload = await getGlobalAssistantMessages(conversationId);
      setMessages(payload.items || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectConversation = useCallback(async (conversationId) => {
    if (!conversationId || conversationId === activeConversationId) return;
    setActiveConversationId(conversationId);
    await loadMessages(conversationId);
  }, [activeConversationId, loadMessages]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getGlobalAssistantConversations();
      let items = payload.items || [];
      if (!items.length) {
        const created = await createGlobalAssistantConversation();
        items = [created];
      }
      setConversations(items);
      const nextId = items.some((item) => item.id === activeConversationId) ? activeConversationId : items[0].id;
      setActiveConversationId(nextId);
      await loadMessages(nextId);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeConversationId, loadMessages]);

  const newConversation = useCallback(async () => {
    if (messages.length === 0 && activeConversationId) return activeConversationId;
    const created = await createGlobalAssistantConversation();
    setConversations((items) => [created, ...items]);
    setActiveConversationId(created.id);
    setMessages([]);
    setError('');
    return created.id;
  }, [activeConversationId, messages.length]);

  const renameConversation = useCallback(async (conversationId, title) => {
    const updated = await renameGlobalAssistantConversation(conversationId, title);
    setConversations((items) => items.map((item) => (item.id === conversationId ? updated : item)));
    return updated;
  }, []);

  const removeConversation = useCallback(async (conversationId) => {
    await deleteGlobalAssistantConversation(conversationId);
    const remaining = conversations.filter((item) => item.id !== conversationId);
    setConversations(remaining);
    if (conversationId !== activeConversationId) return;
    if (remaining.length) {
      setActiveConversationId(remaining[0].id);
      await loadMessages(remaining[0].id);
      return;
    }
    const created = await createGlobalAssistantConversation();
    setConversations([created]);
    setActiveConversationId(created.id);
    setMessages([]);
  }, [activeConversationId, conversations, loadMessages]);

  const stop = useCallback(async () => {
    const active = activeGenerationRef.current;
    if (!active || stopping) return;
    setStopping(true);
    try {
      const result = await cancelGlobalAssistantGeneration(active.requestId);
      if (result.status === 'cancelled') {
        setMessages((items) => items.map((item) => (
          item.id === active.assistantId ? { ...item, status: 'cancelled' } : item
        )));
      }
    } catch (err) {
      setError(`服务端取消未确认：${err.message}`);
    } finally {
      active.controller.abort();
      setStopping(false);
    }
  }, [stopping]);

  const sendMessage = useCallback(async (content) => {
    const message = content.trim();
    if (!message || sending) return;
    let conversationId = activeConversationId;
    if (!conversationId) conversationId = await newConversation();
    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;
    setMessages((items) => [...items, {
      id: localUserId,
      role: 'user',
      content: message,
      status: 'completed',
      createdAt: new Date().toISOString(),
    }, {
      id: localAssistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    }]);
    setSending(true);
    setStopping(false);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = window.crypto?.randomUUID?.().replaceAll('-', '')
      || `request_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    activeGenerationRef.current = { requestId, assistantId: localAssistantId, controller };
    let assistantId = localAssistantId;
    try {
      await streamGlobalAssistantMessage(conversationId, { message, request_id: requestId }, controller.signal, async (event) => {
        if (event.type === 'started') {
          assistantId = event.assistantMessageId;
          if (activeGenerationRef.current?.requestId === requestId) {
            activeGenerationRef.current.assistantId = assistantId;
          }
          setMessages((items) => items.map((item) => {
            if (item.id === localUserId) return { ...item, id: event.userMessageId };
            if (item.id === localAssistantId) return { ...item, id: assistantId, model: event.model };
            return item;
          }));
        } else if (event.type === 'delta') {
          setMessages((items) => items.map((item) => (
            item.id === assistantId ? { ...item, content: `${item.content || ''}${event.delta || ''}` } : item
          )));
        } else if (event.type === 'completed') {
          setMessages((items) => items.map((item) => (
            item.id === assistantId ? { ...item, content: event.content || item.content, status: 'completed' } : item
          )));
          setCompletionRevision((value) => value + 1);
        } else if (event.type === 'action_proposed') {
          setMessages((items) => items.map((item) => (
            item.id === assistantId ? { ...item, actions: [...(item.actions || []), event.action] } : item
          )));
        } else if (event.type === 'cancelled') {
          setMessages((items) => items.map((item) => (
            item.id === assistantId ? { ...item, content: event.content || item.content, status: 'cancelled' } : item
          )));
        } else if (event.type === 'error') {
          setMessages((items) => items.map((item) => (
            item.id === assistantId ? { ...item, status: 'failed', errorCode: event.code || 'provider_error' } : item
          )));
          setError(event.message || 'AI 回复生成失败');
        }
      });
    } catch (err) {
      const cancelled = err.name === 'AbortError';
      setMessages((items) => items.map((item) => (
        item.id === assistantId ? { ...item, status: cancelled ? 'cancelled' : 'failed' } : item
      )));
      if (!cancelled) setError(err.message);
    } finally {
      abortRef.current = null;
      if (activeGenerationRef.current?.requestId === requestId) activeGenerationRef.current = null;
      setSending(false);
      getGlobalAssistantConversations().then((payload) => setConversations(payload.items || [])).catch(() => {});
    }
  }, [activeConversationId, newConversation, sending]);

  const updateAction = useCallback(async (actionId, decision) => {
    setError('');
    try {
      const updated = decision === 'approve'
        ? await approveGlobalAssistantAction(actionId)
        : await rejectGlobalAssistantAction(actionId);
      setMessages((items) => items.map((message) => ({
        ...message,
        actions: (message.actions || []).map((action) => (action.id === actionId ? updated : action)),
      })));
      return updated;
    } catch (err) {
      setError(err.message);
      await loadMessages(activeConversationId);
      return null;
    }
  }, [activeConversationId, loadMessages]);

  return {
    conversations,
    activeConversationId,
    messages,
    loading,
    sending,
    stopping,
    error,
    completionRevision,
    setError,
    loadConversations,
    selectConversation,
    newConversation,
    renameConversation,
    removeConversation,
    sendMessage,
    stop,
    approveAction: (actionId) => updateAction(actionId, 'approve'),
    rejectAction: (actionId) => updateAction(actionId, 'reject'),
  };
}
