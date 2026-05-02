const BASE_URL = 'https://tracker.sabeencs.com/api';

async function getToken() {
  return new Promise(resolve =>
    chrome.storage.local.get('auth_token', d => resolve(d.auth_token))
  );
}

async function request(method, path, body = null) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Clear storage and signal auth failure
    await chrome.storage.local.clear();
    throw { status: 401, message: 'Unauthenticated' };
  }

  if (!res.ok) {
    let errBody;
    try {
      errBody = await res.json();
    } catch {
      errBody = { message: `HTTP ${res.status}` };
    }
    throw errBody;
  }

  // Handle empty responses (e.g. logout 204)
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  login:         (email, password) => request('POST', '/login',    { email, password }),
  logout:        ()                => request('POST', '/logout'),
  getUser:       ()                => request('GET',  '/user'),
  getProjects:   ()                => request('GET',  '/projects'),
  storeTracking: (data)            => request('POST', '/tracking', data),
};
