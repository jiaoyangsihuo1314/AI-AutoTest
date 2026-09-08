import { fetchJson } from './client';

export const listDeliverables = (query = 'include_content=false', onAuthExpired) => fetchJson(`/api/deliverables?${query}`, undefined, onAuthExpired);
