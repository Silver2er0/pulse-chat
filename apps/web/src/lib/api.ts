import { useAuth, type Session } from './auth'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let refreshing: Promise<boolean> | null = null

/** Exchanges the refresh token for a new session; concurrent callers share one request. */
export function refreshSession() {
  refreshing ??= (async () => {
    const { refreshToken, setSession, logout } = useAuth.getState()
    const res = refreshToken
      ? await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => null)
      : null
    if (res?.ok) setSession((await res.json()) as Session)
    else if (res) logout()
    return !!res?.ok
  })().finally(() => (refreshing = null))
  return refreshing
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { accessToken } = useAuth.getState()
  const res = await fetch(API_URL + path, {
    ...init,
    headers: {
      ...(init.body && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
  })
  if (res.status === 401 && accessToken && retry && (await refreshSession())) {
    return request<T>(path, init, false)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message
    throw new ApiError(res.status, message ?? res.statusText)
  }
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
}
