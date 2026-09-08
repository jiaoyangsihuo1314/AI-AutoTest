import { API_BASE } from './client';

export function playwrightReportUrl({ runId = '', suiteRunId = '' } = {}) {
  if (runId) return `${API_BASE}/reports/playwright/runs/${encodeURIComponent(runId)}`;
  if (suiteRunId) return `${API_BASE}/reports/playwright/suite-runs/${encodeURIComponent(suiteRunId)}`;
  return `${API_BASE}/reports/playwright/`;
}
