import { fetchJson } from './client';

export const getAIConfig = (onAuthExpired) => fetchJson('/api/ai-config', undefined, onAuthExpired);
