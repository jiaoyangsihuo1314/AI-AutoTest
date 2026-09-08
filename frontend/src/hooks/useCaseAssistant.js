import { useCallback, useEffect, useState } from 'react';
import {
  applyCaseAssistantProposal,
  getCaseAssistantHistory,
  rejectCaseAssistantProposal,
  sendCaseAssistantMessage,
} from '../api/caseAssistantApi';

export default function useCaseAssistant(workItemId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!workItemId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const payload = await getCaseAssistantHistory(workItemId);
      setMessages(payload.items || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => {
    setMessages([]);
    setError('');
    loadHistory();
  }, [loadHistory]);

  const sendMessage = useCallback(async (payload) => {
    if (!workItemId) return null;
    const optimisticId = `local-${Date.now()}`;
    setMessages((items) => [...items, {
      id: optimisticId,
      role: 'user',
      content: payload.message,
      actorDisplayName: '我',
      createdAt: new Date().toISOString(),
    }]);
    setSending(true);
    setError('');
    try {
      const result = await sendCaseAssistantMessage(workItemId, payload);
      setMessages((items) => [
        ...items.filter((item) => item.id !== optimisticId),
        {
          id: result.userMessageId,
          role: 'user',
          content: payload.message,
          actorDisplayName: '我',
          createdAt: new Date().toISOString(),
        },
        result.message,
      ]);
      return result;
    } catch (err) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId));
      setError(err.message);
      throw err;
    } finally {
      setSending(false);
    }
  }, [workItemId]);

  const applyProposal = useCallback(async (proposalId, payload) => {
    setError('');
    try {
      return await applyCaseAssistantProposal(workItemId, proposalId, payload);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [workItemId]);

  const rejectProposal = useCallback(async (proposalId) => {
    setError('');
    try {
      const proposal = await rejectCaseAssistantProposal(workItemId, proposalId);
      setMessages((items) => items.map((message) => (
        message.proposal?.id === proposalId ? { ...message, proposal } : message
      )));
      return proposal;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [workItemId]);

  return {
    messages,
    loading,
    sending,
    error,
    setError,
    loadHistory,
    sendMessage,
    applyProposal,
    rejectProposal,
  };
}
