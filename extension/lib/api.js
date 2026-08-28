// Talking to CollectCore.
//
// The panel is an extension page, so `host_permissions` grants it cross-origin
// access without CORS negotiation, and the Cloudflare Access cookie rides along
// from the browser's jar. No token to configure, no auth code in the app —
// Access validates at the edge as it does for every other request.
//
// The cookie does expire. CF answers an expired one with a redirect to Google
// that these requests cannot follow, which surfaces as a network failure rather
// than an HTTP status — so a thrown fetch is reported as a sign-in problem, not
// an outage.

export const API_BASE = 'https://api.collectcoreapp.com';

export const SIGNIN_HINT =
  'Sign-in expired — open collectcoreapp.com in a tab, then try again.';

/**
 * @returns {{ok: true, data: any} | {ok: false, reason: string}}
 *   reason 'signin' means the Access session needs renewing.
 */
export async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
  } catch {
    return { ok: false, reason: 'signin' };
  }

  if (!res.ok) return { ok: false, reason: `http ${res.status}` };

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    // A login page rendered where JSON was expected.
    return { ok: false, reason: 'signin' };
  }

  try {
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
