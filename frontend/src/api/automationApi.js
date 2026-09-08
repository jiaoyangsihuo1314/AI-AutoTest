import { fetchJson } from './client';

export const listAutomationFlows = (onAuthExpired) => fetchJson('/api/automation-flows', undefined, onAuthExpired);
export const getAutomationFlow = (flowRunId, onAuthExpired) => fetchJson(`/api/automation-flows/${encodeURIComponent(flowRunId)}`, undefined, onAuthExpired);
