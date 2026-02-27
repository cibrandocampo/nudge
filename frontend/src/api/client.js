const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// Mutex: if a token refresh is already in progress, subsequent 401s wait
// for the same promise instead of firing duplicate refresh requests.
let refreshPromise = null

async function request(path, options = {}, retry = true) {
  const token = localStorage.getItem('access_token')

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401 && retry) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      return request(path, options, false)
    }
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    window.location.href = '/login'
    return res
  }

  return res
}

async function tryRefreshToken() {
  // If a refresh is already in flight, piggyback on it
  if (refreshPromise) return refreshPromise

  refreshPromise = doRefresh()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

async function doRefresh() {
  const refresh = localStorage.getItem('refresh_token')
  if (!refresh) return false

  const res = await fetch(`${BASE_URL}/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })

  if (!res.ok) return false

  const { access } = await res.json()
  localStorage.setItem('access_token', access)
  return true
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path, body) => request(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
}

export { BASE_URL }
