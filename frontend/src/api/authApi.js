import { API_BASE, fetchJson } from './client';

export async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  return response.json();
}

export function login(payload) {
  return fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function register(payload) {
  return fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

export function changePassword(payload, onAuthExpired) {
  return fetchJson('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, onAuthExpired);
}
