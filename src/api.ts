import type { SimulatorState, Snapshot } from '../shared/types'

const TOKEN_KEY = 'hermes-ofis-token'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage may be unavailable; the app still works for this session
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      (payload && typeof payload.error === 'string' && payload.error) || 'İstek başarısız oldu.',
      response.status,
    )
  }
  return payload as T
}

export function fetchState(): Promise<Snapshot> {
  return request<Snapshot>('/api/state')
}

export function assignTask(
  agentId: string,
  title: string,
  detail?: string,
): Promise<{ ok: boolean; queued?: boolean }> {
  return request('/api/agents/' + encodeURIComponent(agentId) + '/task', {
    method: 'POST',
    body: JSON.stringify({ title, detail, assignedBy: 'Panel' }),
  })
}

export function delegateWork(
  from: string,
  to: string,
  title: string,
  detail?: string,
): Promise<{ ok: boolean }> {
  return request('/api/delegations', {
    method: 'POST',
    body: JSON.stringify({ from, to, title, detail }),
  })
}

export function updateSimulator(patch: Partial<SimulatorState>): Promise<{
  ok: boolean
  simulator: SimulatorState
}> {
  return request('/api/simulator', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

export function updateAgentProfile(
  agentId: string,
  patch: { name?: string; role?: string; about?: string },
): Promise<{ ok: boolean }> {
  return request('/api/agents/' + encodeURIComponent(agentId) + '/profile', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

export function powerAgent(
  agentId: string,
  action: 'start' | 'stop' | 'restart',
): Promise<{ ok: boolean }> {
  return request('/api/agents/' + encodeURIComponent(agentId) + '/power', {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function dockerContainer(
  action: 'start' | 'stop' | 'restart',
): Promise<{ ok: boolean }> {
  return request('/api/docker/container', {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}
