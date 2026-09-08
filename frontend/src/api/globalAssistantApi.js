import { fetchJson, streamNdjson } from './client';

export const getGlobalAssistantConversations = (page = 1, pageSize = 30) => fetchJson(
  `/api/global-assistant/conversations?page=${page}&page_size=${pageSize}`,
);

export const createGlobalAssistantConversation = (title = '') => fetchJson('/api/global-assistant/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title }),
});

export const renameGlobalAssistantConversation = (conversationId, title) => fetchJson(
  `/api/global-assistant/conversations/${encodeURIComponent(conversationId)}`,
  {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  },
);

export const deleteGlobalAssistantConversation = (conversationId) => fetchJson(
  `/api/global-assistant/conversations/${encodeURIComponent(conversationId)}`,
  { method: 'DELETE' },
);

export const getGlobalAssistantMessages = (conversationId, before = '', limit = 50) => fetchJson(
  `/api/global-assistant/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
);

export const streamGlobalAssistantMessage = (conversationId, payload, signal, onEvent) => streamNdjson(
  `/api/global-assistant/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  },
  onEvent,
);

export const cancelGlobalAssistantGeneration = (requestId) => fetchJson(
  `/api/global-assistant/generations/${encodeURIComponent(requestId)}/cancel`,
  { method: 'POST' },
);

export const approveGlobalAssistantAction = (actionId) => fetchJson(
  `/api/global-assistant/actions/${encodeURIComponent(actionId)}/approve`,
  { method: 'POST' },
);

export const rejectGlobalAssistantAction = (actionId) => fetchJson(
  `/api/global-assistant/actions/${encodeURIComponent(actionId)}/reject`,
  { method: 'POST' },
);
