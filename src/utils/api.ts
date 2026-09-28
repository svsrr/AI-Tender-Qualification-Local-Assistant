import { auth } from '../lib/firebase';

// In local dev the Express backend serves the frontend too, so relative paths work.
// On Firebase Hosting the frontend is static and the backend lives on Cloud Run, so
// VITE_API_BASE_URL points at that service. Calls go direct rather than through a
// Hosting rewrite because rewrites hard-timeout at 60s and extraction can exceed that.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const DEMO_USAGE_CHANGED_EVENT = 'demo-usage-changed';
const DEMO_METERED_PATHS = ['/api/extract-document', '/api/parse-work-order', '/api/extract-nit', '/api/generate-technical-query', '/api/locate-evidence', '/api/assess-similar-nature'];

// The backend rejects API calls without the signed-in user's Firebase ID token.
// getIdToken() transparently refreshes an expired token, so long sessions keep working.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user) {
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  // Guest (demo) sessions have a daily AI allowance; let the demo banner refresh its count.
  if (user?.isAnonymous && DEMO_METERED_PATHS.some((p) => path.startsWith(p))) {
    window.dispatchEvent(new Event(DEMO_USAGE_CHANGED_EVENT));
  }
  return res;
}
