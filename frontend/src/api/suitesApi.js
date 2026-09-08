import { fetchJson } from './client';

export const listSuites = (projectId = '', onAuthExpired) => fetchJson(`/api/test-suites?project_id=${encodeURIComponent(projectId)}`, undefined, onAuthExpired);
export const listSuiteRuns = (projectId = '', onAuthExpired) => fetchJson(`/api/suite-runs?project_id=${encodeURIComponent(projectId)}`, undefined, onAuthExpired);
