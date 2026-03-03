const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const ADMIN_AUTH_STORAGE_KEY = 'Aplayplay_admin_auth'
const PASSENGER_TOKEN_STORAGE_KEY = 'Aplayplay_passenger_token'

function getAdminToken() {
  try {
    const raw = localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    return String(parsed?.token || '')
  } catch {
    return ''
  }
}

function getPassengerToken() {
  try {
    return String(localStorage.getItem(PASSENGER_TOKEN_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

async function request(path, options = {}) {
  if (!API_BASE_URL) {
    throw new Error('API base URL nao configurada.')
  }
  const authHeaders = options.auth
    ? {
      Authorization: `Bearer ${options.auth === 'passenger' ? getPassengerToken() : getAdminToken()}`,
    }
    : {}
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers || {}),
    },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || 'Falha na requisicao da API.')
  }
  return payload
}

export function isApiEnabled() {
  return Boolean(API_BASE_URL)
}

export async function healthcheck() {
  return request('/api/health', { method: 'GET' })
}

export async function signupDriver(payload) {
  return request('/api/drivers/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function sendWhatsAppVerificationCode(payload) {
  return request('/api/verification/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginDriver(payload) {
  return request('/api/drivers/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function patchDriverTariffs(id, tariffs) {
  return request(`/api/drivers/${id}/tariffs`, {
    method: 'PATCH',
    body: JSON.stringify({ tariffs }),
  })
}

export async function getPublicDriverBySlug(slug) {
  const encoded = encodeURIComponent(String(slug || '').trim())
  return request(`/api/drivers/${encoded}/public`, { method: 'GET' })
}

export async function signupPassenger(payload) {
  return request('/api/passengers/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginPassenger(payload) {
  return request('/api/passengers/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function registerPassenger(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function authLoginPassenger(payload) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getPassengerDrivers() {
  return request('/api/passengers/me/drivers', {
    method: 'GET',
    auth: 'passenger',
  })
}

export async function addPassengerDriver(payload) {
  return request('/api/passengers/me/drivers', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: 'passenger',
  })
}

export async function createRide(payload) {
  return request('/api/rides', {
    method: 'POST',
    body: JSON.stringify(payload),
    auth: 'passenger',
  })
}

export async function listRides() {
  return request('/api/rides', { method: 'GET' })
}

export async function updateRideStatus(id, status) {
  return request(`/api/rides/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function listChatMessages(rideId) {
  return request(`/api/chat/${rideId}/messages`, { method: 'GET' })
}

export async function postChatMessage(rideId, payload) {
  return request(`/api/chat/${rideId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginAdmin(payload) {
  return request('/api/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function logoutAuth() {
  return request('/api/auth/logout', {
    method: 'POST',
    auth: true,
  })
}

export async function getAdminDrivers() {
  return request('/api/admin/drivers', { method: 'GET', auth: true })
}

export async function patchAdminDriver(id, patch) {
  return request(`/api/admin/drivers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    auth: true,
  })
}

export async function deleteAdminDriver(id) {
  return request(`/api/admin/drivers/${id}`, {
    method: 'DELETE',
    auth: true,
  })
}

export async function getAdminPassengers() {
  return request('/api/admin/passengers', { method: 'GET', auth: true })
}

export async function patchAdminPassengerStatus(id, status) {
  return request(`/api/admin/passengers/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    auth: true,
  })
}

export async function deleteAdminPassenger(id) {
  return request(`/api/admin/passengers/${id}`, {
    method: 'DELETE',
    auth: true,
  })
}
