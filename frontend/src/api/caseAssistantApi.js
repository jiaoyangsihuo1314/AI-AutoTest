import { fetchJson } from './client';

export const getCaseAssistantHistory = (workItemId, before = '') => fetchJson(
  `/api/work-items/${encodeURIComponent(workItemId)}/case-assistant${before ? `?before=${encodeURIComponent(before)}` : ''}`,
);

export const sendCaseAssistantMessage = (workItemId, payload) => fetchJson(
  `/api/work-items/${encodeURIComponent(workItemId)}/case-assistant/messages`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  },
);

export const applyCaseAssistantProposal = (workItemId, proposalId, payload) => fetchJson(
  `/api/work-items/${encodeURIComponent(workItemId)}/case-assistant/proposals/${encodeURIComponent(proposalId)}/apply`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  },
);

export const rejectCaseAssistantProposal = (workItemId, proposalId, reason = '') => fetchJson(
  `/api/work-items/${encodeURIComponent(workItemId)}/case-assistant/proposals/${encodeURIComponent(proposalId)}/reject`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  },
);
