import { fetchJson } from './client';

export const listFeatures = (projectId, onAuthExpired) => fetchJson(`/api/features?project_id=${encodeURIComponent(projectId || '')}`, undefined, onAuthExpired);
