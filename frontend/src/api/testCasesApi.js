import { fetchJson } from './client';

export const listTestCases = (projectId = 'all', onAuthExpired) => fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`, undefined, onAuthExpired);
