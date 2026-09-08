import { fetchJson } from './client';

export const listProjects = (onAuthExpired) => fetchJson('/api/projects', undefined, onAuthExpired);
export const getProject = (projectId, onAuthExpired) => fetchJson(`/api/projects/${encodeURIComponent(projectId)}`, undefined, onAuthExpired);
