import { fetchJson } from './client';

export const listRuns = (onAuthExpired) => fetchJson('/api/runs', undefined, onAuthExpired);
export const getRun = (runId, onAuthExpired) => fetchJson(`/api/runs/${encodeURIComponent(runId)}`, undefined, onAuthExpired);
