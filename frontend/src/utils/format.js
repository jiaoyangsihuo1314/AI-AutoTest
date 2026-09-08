export function summarizeText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}
