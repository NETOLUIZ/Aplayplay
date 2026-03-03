import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  createRide,
  getPublicDriverBySlug,
  isApiEnabled,
  listChatMessages,
  listRides,
  loginPassenger,
  postChatMessage,
  sendWhatsAppVerificationCode,
  signupPassenger,
  updateRideStatus,
} from '../services/api'
import 'leaflet/dist/leaflet.css'

const PASSENGER_STORAGE_KEY = 'Aplayplay_passenger_account'
const PASSENGERS_ADMIN_LIST_KEY = 'Aplayplay_passenger_accounts'
const RIDE_REQUESTS_KEY = 'Aplayplay_ride_requests'
const CHAT_THREADS_KEY = 'Aplayplay_chat_threads'
const DRIVER_ACCOUNT_KEY = 'Aplayplay_driver_account'
const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/'
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving'
const CEARA_CENTER = [-5.2, -39.3]
const CEARA_BOUNDS = [[-8.0, -41.8], [-2.7, -37.0]]
const CEARA_VIEWBOX = '-41.8,-2.7,-37.0,-8.0'
const FORTALEZA_CENTER = [-3.7319, -38.5267]
const ROAD_FACTOR_TRIP = 1.28
const ROAD_FACTOR_PICKUP = 1.2
const DEFAULT_PASSENGER_POINT = [-3.7319, -38.5267]
const DEFAULT_DESTINATION_POINT = [-3.7172, -38.5433]
const DEFAULT_DRIVER_POINT = [-3.7423, -38.4986]
const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000
const AUTOCOMPLETE_CACHE = new Map()
const AUTOCOMPLETE_WARM_QUERIES = [
  'shopping',
  'hospital',
  'aeroporto',
  'rodoviaria',
  'beira mar',
  'aldeota',
  'meireles',
  'centro fortaleza',
  'clinicas',
  'academias',
]
const SMART_RANKING_WEIGHTS = {
  proximity: 4.8,
  intent: 2.4,
  relevance: 2.1,
  popularity: 1.05,
  context: 0.45,
}
const ROUTE_PROFILE = {
  rerouteGainThreshold: 0.06,
  congestionPenalty: 0.42,
  blockedPenalty: 1.25,
  turnPenalty: 0.025,
  distancePenalty: 0.03,
}

const driverCarIcon = L.divIcon({
  className: 'map-pin map-pin--driver',
  html: '<span>&#128663;</span>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

const passengerPinIcon = L.divIcon({
  className: 'map-pin map-pin--passenger',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
})

const destinationFlagIcon = L.divIcon({
  className: 'map-pin map-pin--destination',
  html: '<span>&#127937;</span>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function parseBrazilianCurrencyInput(value) {
  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrencyBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatDistanceLabel(distanceKm) {
  if (!isNumber(distanceKm)) return ''
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`
  return `${distanceKm.toFixed(1)} km`
}

function haversineDistanceKm(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return 0
  const [lat1, lon1] = from
  const [lat2, lon2] = to
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return 6371 * c
}

function toRoadDistanceKm(from, to, roadFactor) {
  return haversineDistanceKm(from, to) * roadFactor
}

function tokenize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function calculateIntentScore(queryTokens, item) {
  const itemText = `${item?.display_name || ''} ${item?.class || ''} ${item?.type || ''}`.toLowerCase()
  const intentGroups = [
    { tokens: ['shopping', 'shop', 'loja', 'centro', 'mall', 'iguatemi', 'riomar'], boost: 1.35 },
    { tokens: ['hospital', 'clinica', 'upa', 'saude', 'laboratorio'], boost: 1.55 },
    { tokens: ['mercado', 'supermercado', 'farmacia', 'atacadao'], boost: 1.18 },
    { tokens: ['aeroporto', 'rodoviaria', 'terminal', 'estacao'], boost: 1.45 },
    { tokens: ['restaurante', 'lanchonete', 'bar', 'padaria'], boost: 1.08 },
  ]
  let score = 0
  intentGroups.forEach((group) => {
    if (queryTokens.some((token) => group.tokens.includes(token)) && group.tokens.some((token) => itemText.includes(token))) {
      score += group.boost
    }
  })
  return score
}

function computeSuggestionScore(item, query, referencePoint) {
  const queryTokens = tokenize(query)
  const label = `${item?.display_name || ''} ${item?.name || ''}`.toLowerCase()
  const labelTokens = tokenize(label)

  const relevanceHits = queryTokens.filter((token) => labelTokens.includes(token)).length
  const prefixHits = queryTokens.filter((token) => labelTokens.some((labelToken) => labelToken.startsWith(token))).length
  const relevanceScore = queryTokens.length > 0 ? (relevanceHits * 0.7 + prefixHits * 0.3) / queryTokens.length : 0

  const lat = Number(item?.lat)
  const lng = Number(item?.lon)
  const distKm = Array.isArray(referencePoint) ? haversineDistanceKm(referencePoint, [lat, lng]) : 8
  const nearBias = distKm <= 1.5 ? 1.15 : 1
  const proximityScore = (1 / (1 + Math.max(0, distKm * 0.9))) * nearBias

  const popularityScore = (
    (item?.importance || 0)
    + (item?.class === 'amenity' ? 0.4 : 0)
    + (item?.class === 'shop' ? 0.35 : 0)
    + (item?.class === 'healthcare' ? 0.45 : 0)
    + (item?.type === 'hospital' ? 0.5 : 0)
    + (item?.class === 'tourism' ? 0.25 : 0)
    + (item?.name ? 0.2 : 0)
  )

  const contextScore = /fortaleza|ceara|ce\b|aldeota|meireles|papicu|benfica|messejana/i.test(item?.display_name || '') ? 0.35 : 0
  const intentScore = calculateIntentScore(queryTokens, item)

  const score = (
    proximityScore * SMART_RANKING_WEIGHTS.proximity
    + intentScore * SMART_RANKING_WEIGHTS.intent
    + relevanceScore * SMART_RANKING_WEIGHTS.relevance
    + popularityScore * SMART_RANKING_WEIGHTS.popularity
    + contextScore * SMART_RANKING_WEIGHTS.context
  )

  return { score, distKm }
}

function toOsrmCoord([lat, lng]) {
  return `${lng},${lat}`
}

function decodeOsrmGeometry(route) {
  const coordinates = route?.geometry?.coordinates
  if (!Array.isArray(coordinates)) return []
  return coordinates
    .map((coord) => [Number(coord[1]), Number(coord[0])])
    .filter((point) => isNumber(point[0]) && isNumber(point[1]))
}

function hashPoint(lat, lng) {
  const a = Math.sin((lat + 1.73) * 12.9898 + (lng - 0.66) * 78.233) * 43758.5453
  return a - Math.floor(a)
}

function computeTrafficMultiplier(pointA, pointB, tick) {
  const now = new Date()
  const hour = now.getHours()
  const weekday = now.getDay()
  const midLat = (pointA[0] + pointB[0]) / 2
  const midLng = (pointA[1] + pointB[1]) / 2

  const centerDist = haversineDistanceKm([midLat, midLng], FORTALEZA_CENTER)
  const urbanDensity = Math.max(0, 1.1 - Math.min(centerDist / 14, 1))
  const rushBase = (hour >= 6 && hour <= 10) || (hour >= 16 && hour <= 20) ? 0.34 : 0.05
  const lunchRush = hour >= 11 && hour <= 14 ? 0.11 : 0
  const nightRelief = hour >= 22 || hour <= 4 ? -0.08 : 0
  const weekendRelief = weekday === 0 || weekday === 6 ? -0.08 : 0
  const localNoise = hashPoint(midLat, midLng) * 0.25
  const dynamicNoise = ((Math.sin((tick + midLat * 40 + midLng * 35) * 0.7) + 1) / 2) * 0.2

  return 1 + rushBase + lunchRush + urbanDensity * 0.27 + localNoise + dynamicNoise + weekendRelief + nightRelief
}

function classifyTraffic(multiplier) {
  if (multiplier >= 1.85) return 'bloqueado'
  if (multiplier >= 1.48) return 'congestionado'
  if (multiplier >= 1.2) return 'moderado'
  return 'livre'
}

function trafficColorByState(state) {
  if (state === 'bloqueado') return '#7f1d1d'
  if (state === 'congestionado') return '#dc2626'
  if (state === 'moderado') return '#f59e0b'
  return '#22c55e'
}

function buildRouteTraffic(routePoints, routeDistanceKm, baseDurationMin, tick) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return {
      segments: [],
      adjustedDurationMin: baseDurationMin,
      states: { livre: 0, moderado: 0, congestionado: 0, bloqueado: 0 },
      score: baseDurationMin,
    }
  }

  const segments = []
  let weightedMultiplier = 0
  let weightedDistance = 0
  let turnsPenalty = 0
  const states = { livre: 0, moderado: 0, congestionado: 0, bloqueado: 0 }

  for (let index = 1; index < routePoints.length; index += 1) {
    const from = routePoints[index - 1]
    const to = routePoints[index]
    const segmentDistanceKm = haversineDistanceKm(from, to)
    const trafficMultiplier = computeTrafficMultiplier(from, to, tick)
    const trafficState = classifyTraffic(trafficMultiplier)
    states[trafficState] += 1

    weightedMultiplier += trafficMultiplier * segmentDistanceKm
    weightedDistance += segmentDistanceKm

    if (index > 1) {
      const prev = routePoints[index - 2]
      const anglePenalty = Math.abs((to[1] - from[1]) - (from[1] - prev[1])) + Math.abs((to[0] - from[0]) - (from[0] - prev[0]))
      if (anglePenalty > 0.008) turnsPenalty += ROUTE_PROFILE.turnPenalty
    }

    segments.push({
      from,
      to,
      state: trafficState,
      color: trafficColorByState(trafficState),
      weight: trafficState === 'bloqueado' ? 8 : 6,
    })
  }

  const meanMultiplier = weightedDistance > 0 ? weightedMultiplier / weightedDistance : 1
  const adjustedDurationMin = Math.max(1, baseDurationMin * meanMultiplier)
  const stabilityPenalty = (
    states.congestionado * ROUTE_PROFILE.congestionPenalty
    + states.bloqueado * ROUTE_PROFILE.blockedPenalty
    + turnsPenalty
  )
  const score = adjustedDurationMin + stabilityPenalty + routeDistanceKm * ROUTE_PROFILE.distancePenalty

  return { segments, adjustedDurationMin, states, score }
}

async function fetchOsrmRoutes(fromPoint, toPoint, allowAlternatives) {
  const endpoint = `${OSRM_ROUTE_URL}/${toOsrmCoord(fromPoint)};${toOsrmCoord(toPoint)}`
  const url = new URL(endpoint)
  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('steps', 'true')
  url.searchParams.set('alternatives', allowAlternatives ? 'true' : 'false')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept-Language': 'pt-BR' },
    })
    if (!response.ok) {
      throw new Error('Falha ao consultar rotas.')
    }

    const payload = await response.json()
    if (payload?.code !== 'Ok' || !Array.isArray(payload.routes)) {
      throw new Error('Sem rotas disponiveis para este trajeto.')
    }
    return payload.routes
  } finally {
    clearTimeout(timeout)
  }
}

function readTariffsFromDriverProfile(driverProfile) {
  if (driverProfile?.tariffs) {
    return {
      perKm: parseBrazilianCurrencyInput(driverProfile.tariffs?.perKm) || 3.8,
      perMinute: parseBrazilianCurrencyInput(driverProfile.tariffs?.perMinute) || 0.55,
      displacementFee: parseBrazilianCurrencyInput(driverProfile.tariffs?.displacementFee) || 5,
    }
  }

  try {
    const account = JSON.parse(localStorage.getItem(DRIVER_ACCOUNT_KEY) || 'null')
    const tariffs = account?.tariffs
    return {
      perKm: parseBrazilianCurrencyInput(tariffs?.perKm) || 3.8,
      perMinute: parseBrazilianCurrencyInput(tariffs?.perMinute) || 0.55,
      displacementFee: parseBrazilianCurrencyInput(tariffs?.displacementFee) || 5,
    }
  } catch {
    return { perKm: 3.8, perMinute: 0.55, displacementFee: 5 }
  }
}

function getNearbyDriverPoint([lat, lng]) {
  // Aproxima o motorista para ~1.2km do passageiro (nordeste)
  const latOffset = 0.008
  const lngOffset = 0.008 / Math.max(0.3, Math.cos((lat * Math.PI) / 180))
  return [lat + latOffset, lng + lngOffset]
}

function appendChatMessage(rideId, message) {
  const threads = readJson(CHAT_THREADS_KEY, {})
  const current = threads[String(rideId)] || []
  threads[String(rideId)] = [...current, message]
  writeJson(CHAT_THREADS_KEY, threads)
  window.dispatchEvent(new Event('Aplayplay:chat-updated'))
}

function isNumber(value) {
  return Number.isFinite(value) && !Number.isNaN(value)
}

function isInsideCeara(lat, lng) {
  return lat >= CEARA_BOUNDS[0][0] && lat <= CEARA_BOUNDS[1][0]
    && lng >= CEARA_BOUNDS[0][1] && lng <= CEARA_BOUNDS[1][1]
}

function formatCoords(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function maskBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function readCoordsFromQuery(searchParams, latKey, lngKey) {
  const lat = Number(searchParams.get(latKey))
  const lng = Number(searchParams.get(lngKey))
  if (!isNumber(lat) || !isNumber(lng)) {
    return null
  }
  if (!isInsideCeara(lat, lng)) {
    return null
  }
  return [lat, lng]
}

function getBrowserLocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalizacao indisponivel neste navegador.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve([position.coords.latitude, position.coords.longitude]),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
        ...options,
      },
    )
  })
}

function getAutocompleteCacheKey(query) {
  return String(query || '').trim().toLowerCase()
}

async function fetchCearaSuggestions(query, referencePoint = null, options = {}) {
  const trimmed = String(query || '').trim()
  if (trimmed.length < 3) return []
  const signal = options?.signal
  const cacheKey = getAutocompleteCacheKey(trimmed)
  const cacheEntry = AUTOCOMPLETE_CACHE.get(cacheKey)
  if (cacheEntry && Date.now() - cacheEntry.timestamp < AUTOCOMPLETE_CACHE_TTL_MS) {
    return cacheEntry.items
      .map((item) => {
        const metrics = computeSuggestionScore(item, trimmed, referencePoint)
        return { ...item, __score: metrics.score, __distKm: metrics.distKm }
      })
      .sort((a, b) => b.__score - a.__score)
      .slice(0, 6)
  }

  const attempts = [trimmed]
  const hasRegionalTerm = /fortaleza|ceara|ce\b/i.test(trimmed)
  if (!hasRegionalTerm) {
    attempts.push(`${trimmed}, Fortaleza, Ceara, Brasil`)
  }
  const uniqueByPlaceId = new Map()
  let nominatimOk = false

  for (const attempt of attempts) {
    try {
      const url = new URL(NOMINATIM_SEARCH_URL)
      url.searchParams.set('q', attempt)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('countrycodes', 'br')
      url.searchParams.set('viewbox', CEARA_VIEWBOX)
      url.searchParams.set('limit', '8')
      url.searchParams.set('dedupe', '1')

      const response = await fetch(url.toString(), { signal })
      if (!response.ok) {
        continue
      }

      nominatimOk = true
      const raw = await response.json()
      if (!Array.isArray(raw)) continue

      raw.forEach((item) => {
        const lat = Number(item.lat)
        const lng = Number(item.lon)
        if (!isInsideCeara(lat, lng)) return
        uniqueByPlaceId.set(String(item.place_id), item)
      })

      if (uniqueByPlaceId.size >= 6) break
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      // Se CORS/rede bloquear Nominatim no browser, tentamos o fallback abaixo.
      continue
    }
  }

  if (!nominatimOk || uniqueByPlaceId.size === 0) {
    for (const attempt of attempts) {
      try {
        const photonUrl = new URL(PHOTON_SEARCH_URL)
        photonUrl.searchParams.set('q', attempt)
        photonUrl.searchParams.set('lang', 'pt')
        photonUrl.searchParams.set('limit', '8')
        photonUrl.searchParams.set('lat', String(referencePoint?.[0] ?? FORTALEZA_CENTER[0]))
        photonUrl.searchParams.set('lon', String(referencePoint?.[1] ?? FORTALEZA_CENTER[1]))

        const response = await fetch(photonUrl.toString(), { signal })
        if (!response.ok) continue
        const payload = await response.json()
        const features = Array.isArray(payload?.features) ? payload.features : []

        features.forEach((feature, idx) => {
          const coords = feature?.geometry?.coordinates
          if (!Array.isArray(coords) || coords.length < 2) return
          const lng = Number(coords[0])
          const lat = Number(coords[1])
          if (!isInsideCeara(lat, lng)) return

          const props = feature?.properties || {}
          const name = props.name || props.street || props.city || 'Endereco'
          const suburb = props.suburb ? `, ${props.suburb}` : ''
          const city = props.city || 'Fortaleza'
          const state = props.state || 'Ceara'
          const displayName = `${name}${suburb}, ${city}, ${state}, Brasil`

          uniqueByPlaceId.set(`photon-${attempt}-${idx}`, {
            place_id: `photon-${attempt}-${idx}`,
            lat: String(lat),
            lon: String(lng),
            display_name: displayName,
            name,
            class: props.osm_key || 'place',
            type: props.osm_value || 'poi',
            importance: Number(props.importance || 0.2),
            address: {
              road: props.street || props.name || name,
              house_number: props.housenumber || '',
              neighbourhood: props.suburb || '',
              suburb: props.district || props.county || '',
            },
          })
        })

        if (uniqueByPlaceId.size >= 6) break
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        continue
      }
    }
  }

  const rawItems = Array.from(uniqueByPlaceId.values())
  AUTOCOMPLETE_CACHE.set(cacheKey, { timestamp: Date.now(), items: rawItems })

  const ranked = rawItems
    .map((item) => {
      const metrics = computeSuggestionScore(item, trimmed, referencePoint)
      return { ...item, __score: metrics.score, __distKm: metrics.distKm }
    })
    .sort((a, b) => b.__score - a.__score)

  return ranked.slice(0, 6)
}

async function warmAutocompleteCache(referencePoint) {
  const seedList = AUTOCOMPLETE_WARM_QUERIES.slice(0, 6)
  await Promise.allSettled(seedList.map((seed) => fetchCearaSuggestions(seed, referencePoint)))
}

function splitDisplayName(item) {
  const full = String(item?.display_name || '').trim()
  const parts = full
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/regiao geografica/i.test(p))
  const title = parts[0] || item?.name || 'Endereco'
  const subtitle = parts.slice(1, 4).join(', ')
  return { title, subtitle }
}

function formatShortFortalezaAddress(item) {
  const address = item?.address || {}
  const streetBase = address.road
    || address.pedestrian
    || address.neighbourhood
    || address.suburb
    || splitDisplayName(item).title
    || 'Endereco'
  const number = address.house_number ? `, ${address.house_number}` : ''
  return `${streetBase}${number}, Fortaleza - CE`
}

function BookingRequestDemoPage() {
  const routeParams = useParams()
  const slug = String(routeParams.slug || routeParams.motoristaId || '').trim()
  const [searchParams] = useSearchParams()
  const mapRef = useRef(null)
  const originDebounceRef = useRef(null)
  const destinationDebounceRef = useRef(null)
  const originAbortRef = useRef(null)
  const destinationAbortRef = useRef(null)
  const destinationInputRef = useRef(null)
  const warmCacheRef = useRef(false)

  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [originSuggestions, setOriginSuggestions] = useState([])
  const [destinationSuggestions, setDestinationSuggestions] = useState([])
  const [loadingOriginSuggestions, setLoadingOriginSuggestions] = useState(false)
  const [loadingDestinationSuggestions, setLoadingDestinationSuggestions] = useState(false)
  const [isOriginFocused, setIsOriginFocused] = useState(false)
  const [isDestinationFocused, setIsDestinationFocused] = useState(false)
  const [tripDate, setTripDate] = useState('')
  const [tripTime, setTripTime] = useState('')
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showClientLogin, setShowClientLogin] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPassword, setClientPassword] = useState('')
  const [signupFullName, setSignupFullName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupAddress, setSignupAddress] = useState('')
  const [signupPhotoDataUrl, setSignupPhotoDataUrl] = useState('')
  const [signupVerificationCode, setSignupVerificationCode] = useState('')
  const [signupSendingCode, setSignupSendingCode] = useState(false)
  const [signupCodeMessage, setSignupCodeMessage] = useState('')
  const [rideFeedback, setRideFeedback] = useState('')
  const [passengerMessage, setPassengerMessage] = useState('')
  const [activeRideId, setActiveRideId] = useState(null)
  const [activeRideStatus, setActiveRideStatus] = useState(null)
  const [chatMessages, setChatMessages] = useState([])

  const [geoFeedback, setGeoFeedback] = useState('')
  const [isLocatingDriver, setIsLocatingDriver] = useState(false)

  const [passengerPoint, setPassengerPoint] = useState(DEFAULT_PASSENGER_POINT)
  const [destinationPoint, setDestinationPoint] = useState(DEFAULT_DESTINATION_POINT)
  const [driverPoint, setDriverPoint] = useState(DEFAULT_DRIVER_POINT)
  const [isDriverPointLocked, setIsDriverPointLocked] = useState(false)

  const [passengerAccount, setPassengerAccount] = useState(null)
  const [isPassengerLoggedIn, setIsPassengerLoggedIn] = useState(false)
  const [isRouting, setIsRouting] = useState(false)
  const [routingError, setRoutingError] = useState('')
  const [routingFeedback, setRoutingFeedback] = useState('')
  const [tripRoutes, setTripRoutes] = useState([])
  const [pickupRoute, setPickupRoute] = useState(null)
  const [selectedTripIndex, setSelectedTripIndex] = useState(0)
  const [trafficTick, setTrafficTick] = useState(0)
  const [trafficNotice, setTrafficNotice] = useState('')
  const allowPassengerSignup = Boolean(slug)
  const apiEnabled = isApiEnabled()
  const linkedDriverSlug = String(passengerAccount?.driverSlug || '').trim().toLowerCase()
  const activeDriverSlug = String(slug || linkedDriverSlug || '').trim().toLowerCase()
  const hasDriverLink = Boolean(activeDriverSlug)
  const fallbackDriverProfile = useMemo(
    () => ({
      fullName: searchParams.get('driver') || 'Motorista parceiro',
      vehicleModel: searchParams.get('vehicle') || 'Veiculo nao informado',
      vehiclePlate: searchParams.get('plate') || '---',
      vehicleCategory: searchParams.get('category') || 'Motorista Parceiro',
      city: searchParams.get('city') || '',
      isActive: true,
      tariffsEnabled: true,
      tariffs: null,
    }),
    [searchParams],
  )
  const [driverProfile, setDriverProfile] = useState(fallbackDriverProfile)

  const driverName = driverProfile.fullName || 'Motorista parceiro'
  const vehicle = driverProfile.vehicleModel || 'Veiculo nao informado'
  const plate = driverProfile.vehiclePlate || '---'
  const category = driverProfile.vehicleCategory || 'Motorista Parceiro'
  const city = driverProfile.city || ''
  const cityLabel = city || 'sua cidade'
  const driverInitials = driverName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'CS'
  const fallbackRoutePositions = [passengerPoint, driverPoint, destinationPoint]
  const tariffs = useMemo(() => readTariffsFromDriverProfile(driverProfile), [driverProfile])
  const isDriverActive = driverProfile?.isActive !== false
  const routeCandidates = useMemo(
    () => tripRoutes.map((route, index) => {
      const traffic = buildRouteTraffic(route.points, route.distanceKm, route.baseDurationMin, trafficTick)
      return {
        ...route,
        index,
        adjustedDurationMin: traffic.adjustedDurationMin,
        score: traffic.score,
        trafficStates: traffic.states,
        trafficSegments: traffic.segments,
      }
    }).sort((a, b) => a.score - b.score),
    [tripRoutes, trafficTick],
  )
  const selectedTripRoute = useMemo(() => {
    if (routeCandidates.length === 0) return null
    const exact = routeCandidates.find((route) => route.index === selectedTripIndex)
    return exact || routeCandidates[0]
  }, [routeCandidates, selectedTripIndex])
  const pickupDistanceKm = useMemo(
    () => pickupRoute?.distanceKm ?? toRoadDistanceKm(driverPoint, passengerPoint, ROAD_FACTOR_PICKUP),
    [pickupRoute, driverPoint, passengerPoint],
  )
  const tripDistanceKm = useMemo(
    () => selectedTripRoute?.distanceKm ?? toRoadDistanceKm(passengerPoint, destinationPoint, ROAD_FACTOR_TRIP),
    [selectedTripRoute, passengerPoint, destinationPoint],
  )
  const estimatedDurationMin = Math.max(6, Math.round(
    selectedTripRoute?.adjustedDurationMin ?? ((tripDistanceKm / 26) * 60),
  ))
  const liveTrafficState = useMemo(() => {
    const states = selectedTripRoute?.trafficStates
    if (!states) return 'livre'
    if (states.bloqueado > 0) return 'bloqueado'
    if (states.congestionado > 3) return 'congestionado'
    if (states.moderado > 0) return 'moderado'
    return 'livre'
  }, [selectedTripRoute])
  const estimatedFare = useMemo(
    () => (hasDriverLink && isDriverActive ? (
      tariffs.displacementFee
      + tripDistanceKm * tariffs.perKm
      + estimatedDurationMin * tariffs.perMinute
    ) : 0),
    [hasDriverLink, isDriverActive, tariffs, tripDistanceKm, estimatedDurationMin],
  )
  const estimatedFareLabel = formatCurrencyBRL(estimatedFare)

  useEffect(() => {
    setDriverProfile(fallbackDriverProfile)
  }, [fallbackDriverProfile])

  useEffect(() => {
    let cancelled = false

    async function loadDriverBySlug() {
      if (!activeDriverSlug) return

      if (apiEnabled) {
        try {
          const result = await getPublicDriverBySlug(activeDriverSlug)
          const driver = result?.driver
          if (!cancelled && driver) {
            setDriverProfile((current) => ({
              ...current,
              fullName: String(driver.fullName || current.fullName || 'Motorista parceiro'),
              vehicleModel: String(driver.vehicleModel || current.vehicleModel || 'Veiculo nao informado'),
              vehiclePlate: String(driver.vehiclePlate || current.vehiclePlate || '---'),
              vehicleCategory: String(driver.vehicleCategory || current.vehicleCategory || 'Motorista Parceiro'),
              city: String(driver.city || current.city || ''),
              isActive: driver.isActive !== false,
              tariffsEnabled: driver.tariffsEnabled !== false,
              tariffs: driver.tariffs || current.tariffs || null,
            }))
            return
          }
        } catch {
          // fallback local quando API falha
        }
      }

      const localDriver = readJson(DRIVER_ACCOUNT_KEY, null)
      const localSlug = String(localDriver?.slug || '').trim().toLowerCase()
      const targetSlug = String(activeDriverSlug || '').trim().toLowerCase()
      if (!cancelled && localDriver && localSlug && localSlug === targetSlug) {
        setDriverProfile((current) => ({
          ...current,
          fullName: String(localDriver.fullName || current.fullName || 'Motorista parceiro'),
          vehicleModel: String(localDriver.vehicleModel || current.vehicleModel || 'Veiculo nao informado'),
            vehiclePlate: String(localDriver.vehiclePlate || current.vehiclePlate || '---'),
            vehicleCategory: String(localDriver.vehicleCategory || current.vehicleCategory || 'Motorista Parceiro'),
            city: String(localDriver.city || current.city || ''),
            isActive: localDriver.isActive !== false,
            tariffsEnabled: localDriver.tariffsEnabled !== false,
            tariffs: localDriver.tariffs || current.tariffs || null,
          }))
      }
    }

    void loadDriverBySlug()

    return () => {
      cancelled = true
    }
  }, [activeDriverSlug, apiEnabled])

  async function syncPassengerLocationAfterLogin() {
    setGeoFeedback('Obtendo sua localizacao...')
    try {
      let point
      try {
        point = await getBrowserLocation({ enableHighAccuracy: true, timeout: 12000 })
      } catch {
        point = await getBrowserLocation({ enableHighAccuracy: false, timeout: 18000, maximumAge: 120000 })
      }

      const [lat, lng] = point
      if (!isInsideCeara(lat, lng)) {
        setGeoFeedback('Seu local atual esta fora do Ceara. Mantivemos o ponto manual.')
        return
      }

      setPassengerPoint([lat, lng])
      setOrigin('Minha localizacao')
      mapRef.current?.setView([lat, lng], 14)
      setGeoFeedback('Localizacao do passageiro atualizada automaticamente.')
    } catch (error) {
      if (error?.code === 1) {
        setGeoFeedback('Permita o acesso a localizacao no navegador para usar seu local atual.')
        return
      }
      setGeoFeedback('Nao foi possivel obter sua localizacao agora. Tente novamente.')
    }
  }

  useEffect(() => {
    const parsed = readJson(PASSENGER_STORAGE_KEY, null)
    const hasPassengerIdentity = Boolean(parsed?.email || parsed?.telefone || parsed?.phone || parsed?.id)
    if (hasPassengerIdentity) {
      setPassengerAccount(parsed)
    }
    const token = String(localStorage.getItem(PASSENGER_TOKEN_KEY) || '')
    if (token) {
      setIsPassengerLoggedIn(true)
      setShowClientLogin(false)
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('flow') !== 'login') return
    setShowClientLogin(true)
    setAuthError('')
    setAuthMode('login')
  }, [searchParams, passengerAccount])

  useEffect(() => {
    if (allowPassengerSignup) return
    if (authMode === 'signup') {
      setAuthMode('login')
      setAuthError('Cadastro do passageiro liberado apenas pelo QR code/link do motorista.')
    }
  }, [allowPassengerSignup, authMode])

  useEffect(() => {
    const queryDriver = readCoordsFromQuery(searchParams, 'driverLat', 'driverLng')
    if (queryDriver) {
      setDriverPoint(queryDriver)
      setIsDriverPointLocked(true)
    }

    const queryPassenger = readCoordsFromQuery(searchParams, 'passengerLat', 'passengerLng')
    if (queryPassenger) {
      setPassengerPoint(queryPassenger)
      setOrigin('Minha localizacao')
    }
  }, [searchParams])

  useEffect(() => () => {
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current)
    if (destinationDebounceRef.current) clearTimeout(destinationDebounceRef.current)
    if (originAbortRef.current) originAbortRef.current.abort()
    if (destinationAbortRef.current) destinationAbortRef.current.abort()
  }, [])

  useEffect(() => {
    if (isDriverPointLocked) return
    setDriverPoint(getNearbyDriverPoint(passengerPoint))
  }, [passengerPoint, isDriverPointLocked])

  useEffect(() => {
    let cancelled = false

    async function loadSmartRoutes() {
      setIsRouting(true)
      setRoutingError('')
      try {
        const [pickupRoutesRaw, tripRoutesRaw] = await Promise.all([
          fetchOsrmRoutes(driverPoint, passengerPoint, false),
          fetchOsrmRoutes(passengerPoint, destinationPoint, true),
        ])
        if (cancelled) return

        const pickupMain = pickupRoutesRaw[0]
        const pickupParsed = pickupMain
          ? {
            points: decodeOsrmGeometry(pickupMain),
            distanceKm: (pickupMain.distance || 0) / 1000,
            baseDurationMin: (pickupMain.duration || 0) / 60,
          }
          : null

        const parsedTrips = tripRoutesRaw.map((route, index) => ({
          id: `${Date.now()}-${index}`,
          points: decodeOsrmGeometry(route),
          distanceKm: (route.distance || 0) / 1000,
          baseDurationMin: (route.duration || 0) / 60,
          turns: Array.isArray(route.legs)
            ? route.legs.reduce((sum, leg) => sum + (Array.isArray(leg.steps) ? leg.steps.length : 0), 0)
            : 0,
        })).filter((route) => route.points.length >= 2)

        if (pickupParsed?.points?.length >= 2) {
          setPickupRoute(pickupParsed)
        } else {
          setPickupRoute(null)
        }

        setTripRoutes(parsedTrips)
        setSelectedTripIndex(0)

        const alternatives = Math.max(0, parsedTrips.length - 1)
        setRoutingFeedback(alternatives > 0
          ? `${alternatives + 1} rotas encontradas. Modo inteligente ativo.`
          : 'Rota otimizada carregada.')
      } catch (error) {
        if (cancelled) return
        setPickupRoute(null)
        setTripRoutes([])
        setRoutingError(error?.name === 'AbortError'
          ? 'Tempo de resposta do roteamento excedido. Tentando novamente...'
          : 'Nao foi possivel atualizar rota em tempo real. Mantendo estimativa local.')
      } finally {
        if (!cancelled) setIsRouting(false)
      }
    }

    void loadSmartRoutes()
    return () => {
      cancelled = true
    }
  }, [driverPoint, passengerPoint, destinationPoint])

  useEffect(() => {
    const timer = setInterval(() => {
      setTrafficTick((value) => value + 1)
    }, 25000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (routeCandidates.length < 2 || !selectedTripRoute) return
    const best = routeCandidates[0]
    if (best.index === selectedTripRoute.index) return

    if (selectedTripRoute.score > best.score * (1 + ROUTE_PROFILE.rerouteGainThreshold)) {
      setSelectedTripIndex(best.index)
      setTrafficNotice(`Reroteamento automatico: trafego ${liveTrafficState}. Nova rota com melhor tempo.`)
    }
  }, [routeCandidates, selectedTripRoute, liveTrafficState])

  useEffect(() => {
    if (!trafficNotice) return undefined
    const timer = setTimeout(() => setTrafficNotice(''), 6200)
    return () => clearTimeout(timer)
  }, [trafficNotice])

  useEffect(() => {
    if (!activeRideId) return undefined
    const loadThread = async () => {
      if (apiEnabled) {
        try {
          const result = await listChatMessages(activeRideId)
          setChatMessages(Array.isArray(result?.messages) ? result.messages : [])
          return
        } catch {
          // fallback local
        }
      }
      const threads = readJson(CHAT_THREADS_KEY, {})
      setChatMessages(threads[String(activeRideId)] || [])
    }
    void loadThread()
    const timer = setInterval(() => { void loadThread() }, 1200)
    const onChat = () => { void loadThread() }
    window.addEventListener('Aplayplay:chat-updated', onChat)
    return () => {
      clearInterval(timer)
      window.removeEventListener('Aplayplay:chat-updated', onChat)
    }
  }, [activeRideId, apiEnabled])

  useEffect(() => {
    if (!isPassengerLoggedIn) return undefined
    async function updatePassengerFromBrowserLocation() {
      await syncPassengerLocationAfterLogin()
    }

    void updatePassengerFromBrowserLocation()
    return undefined
  }, [isPassengerLoggedIn])

  useEffect(() => {
    if (!isPassengerLoggedIn) return
    if (warmCacheRef.current) return
    warmCacheRef.current = true
    void warmAutocompleteCache(passengerPoint)
  }, [isPassengerLoggedIn, passengerPoint])

  useEffect(() => {
    if (!activeRideId) return undefined

    async function syncRideStatus() {
      if (apiEnabled) {
        try {
          const result = await listRides()
          const apiRides = Array.isArray(result?.rides) ? result.rides : []
          const currentApi = apiRides.find((ride) => String(ride?.id) === String(activeRideId))
          setActiveRideStatus(currentApi?.status || 'pending')
          return
        } catch {
          // fallback local
        }
      }

      const requests = readJson(RIDE_REQUESTS_KEY, [])
      const current = Array.isArray(requests)
        ? requests.find((request) => String(request?.id) === String(activeRideId))
        : null
      setActiveRideStatus(current?.status || 'pending')
    }

    void syncRideStatus()
    const timer = setInterval(() => { void syncRideStatus() }, 1200)
    window.addEventListener('storage', syncRideStatus)
    window.addEventListener('Aplayplay:ride-request', syncRideStatus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', syncRideStatus)
      window.removeEventListener('Aplayplay:ride-request', syncRideStatus)
    }
  }, [activeRideId, apiEnabled])

  function zoomIn() {
    mapRef.current?.zoomIn()
  }

  function zoomOut() {
    mapRef.current?.zoomOut()
  }

  function locateRoute() {
    const referencePoints = [
      ...(pickupRoute?.points || []),
      ...(selectedTripRoute?.points || []),
    ]
    const points = referencePoints.length >= 2 ? referencePoints : [passengerPoint, driverPoint, destinationPoint]
    const bounds = L.latLngBounds(points)
    const authRideMode = isPassengerLoggedIn && !showClientLogin
    mapRef.current?.fitBounds(bounds, authRideMode
      ? {
        paddingTopLeft: [42, 126],
        paddingBottomRight: [42, 338],
        maxZoom: 14,
      }
      : { padding: [36, 36] })
  }

  function handleOriginChange(value) {
    setOrigin(value)
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current)
    if (originAbortRef.current) originAbortRef.current.abort()

    if (value.trim().length < 3) {
      setOriginSuggestions([])
      setLoadingOriginSuggestions(false)
      return
    }

    setLoadingOriginSuggestions(true)
    originDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      originAbortRef.current = controller
      try {
        const list = await fetchCearaSuggestions(value, passengerPoint, { signal: controller.signal })
        setOriginSuggestions(list)
      } catch (error) {
        if (error?.name === 'AbortError') return
        setOriginSuggestions([])
      } finally {
        if (originAbortRef.current === controller) {
          originAbortRef.current = null
          setLoadingOriginSuggestions(false)
        }
      }
    }, 220)
  }

  function handleDestinationChange(value) {
    setDestination(value)
    if (destinationDebounceRef.current) clearTimeout(destinationDebounceRef.current)
    if (destinationAbortRef.current) destinationAbortRef.current.abort()

    if (value.trim().length < 3) {
      setDestinationSuggestions([])
      setLoadingDestinationSuggestions(false)
      return
    }

    setLoadingDestinationSuggestions(true)
    destinationDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      destinationAbortRef.current = controller
      try {
        const list = await fetchCearaSuggestions(value, passengerPoint, { signal: controller.signal })
        setDestinationSuggestions(list)
      } catch (error) {
        if (error?.name === 'AbortError') return
        setDestinationSuggestions([])
      } finally {
        if (destinationAbortRef.current === controller) {
          destinationAbortRef.current = null
          setLoadingDestinationSuggestions(false)
        }
      }
    }, 220)
  }

  function selectOriginSuggestion(item) {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    if (!isInsideCeara(lat, lng)) return
    setOrigin(formatShortFortalezaAddress(item))
    setPassengerPoint([lat, lng])
    setOriginSuggestions([])
    setIsOriginFocused(false)
    mapRef.current?.setView([lat, lng], 14)
  }

  function selectDestinationSuggestion(item) {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    if (!isInsideCeara(lat, lng)) return
    setDestination(formatShortFortalezaAddress(item))
    setDestinationPoint([lat, lng])
    setDestinationSuggestions([])
    setIsDestinationFocused(false)
    const bounds = L.latLngBounds([passengerPoint, [lat, lng]])
    const authRideMode = isPassengerLoggedIn && !showClientLogin
    mapRef.current?.fitBounds(bounds, authRideMode
      ? {
        paddingTopLeft: [42, 126],
        paddingBottomRight: [42, 338],
        maxZoom: 14,
      }
      : { padding: [48, 48] })
  }

  function focusDestinationFromHeader() {
    setIsDestinationFocused(true)
    const input = destinationInputRef.current
    if (!input) return

    const card = input.closest('.booking-card')
    if (card) {
      const inputTop = input.getBoundingClientRect().top - card.getBoundingClientRect().top
      card.scrollTo({ top: Math.max(0, inputTop - 110), behavior: 'smooth' })
    }

    setTimeout(() => {
      input.focus()
      input.select()
    }, 120)
  }

  async function handleLocateDriver() {
    setIsLocatingDriver(true)
    setGeoFeedback('')
    try {
      const [lat, lng] = await getBrowserLocation()
      if (!isInsideCeara(lat, lng)) {
        setGeoFeedback('Local do motorista fora do Ceara. Mantenha o ponto manual.')
        return
      }
      setDriverPoint([lat, lng])
      setIsDriverPointLocked(true)
      mapRef.current?.setView([lat, lng], 13)
      setGeoFeedback('Localizacao do motorista atualizada.')
    } catch (error) {
      setGeoFeedback(error.message)
    } finally {
      setIsLocatingDriver(false)
    }
  }

  async function handleSignup(event) {
    event.preventDefault()
    setAuthError('')

    if (!allowPassengerSignup) {
      setAuthMode('login')
      setAuthError('Cadastro do passageiro liberado apenas pelo QR code/link do motorista.')
      return
    }

    const normalizedEmail = clientEmail.trim().toLowerCase()
    if (!signupFullName.trim() || !normalizedEmail || !clientPassword.trim() || !signupPhone.trim() || !signupAddress.trim()) {
      setAuthError('Preencha nome, e-mail, senha, telefone e endereco.')
      return
    }
    if (apiEnabled && !signupVerificationCode.trim()) {
      setAuthError('Informe o codigo enviado no WhatsApp para concluir o cadastro.')
      return
    }

    const newPassenger = {
      id: `PS-${Date.now()}`,
      fullName: signupFullName.trim(),
      email: normalizedEmail,
      password: clientPassword,
      phone: signupPhone.trim(),
      address: signupAddress.trim(),
      photoDataUrl: signupPhotoDataUrl || '',
      status: 'active',
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      driverSlug: slug,
    }

    if (apiEnabled) {
      try {
        const result = await signupPassenger({
          ...newPassenger,
          driverSlug: slug,
          verificationCode: signupVerificationCode.trim(),
        })
        const createdPassenger = result?.passenger || newPassenger
        writeJson(PASSENGER_STORAGE_KEY, createdPassenger)
        const adminPassengers = readJson(PASSENGERS_ADMIN_LIST_KEY, [])
        const safeList = Array.isArray(adminPassengers) ? adminPassengers : []
        const withoutSameEmail = safeList.filter((item) => item?.email !== normalizedEmail)
        writeJson(PASSENGERS_ADMIN_LIST_KEY, [createdPassenger, ...withoutSameEmail])
        setPassengerAccount(createdPassenger)
        setAuthMode('login')
        setAuthError('Cadastro realizado. Agora entre com e-mail e senha.')
        return
      } catch (error) {
        setAuthError(error.message || 'Nao foi possivel cadastrar passageiro.')
        return
      }
    }

    writeJson(PASSENGER_STORAGE_KEY, newPassenger)
    const adminPassengers = readJson(PASSENGERS_ADMIN_LIST_KEY, [])
    const safeList = Array.isArray(adminPassengers) ? adminPassengers : []
    const withoutSameEmail = safeList.filter((item) => item?.email !== normalizedEmail)
    writeJson(PASSENGERS_ADMIN_LIST_KEY, [newPassenger, ...withoutSameEmail])

    setPassengerAccount(newPassenger)
    setAuthMode('login')
    setAuthError('Cadastro realizado. Agora entre com e-mail e senha.')
  }

  async function handleSendPassengerSignupCode() {
    setAuthError('')
    setSignupCodeMessage('')
    if (!apiEnabled) {
      setAuthError('Configure a API para enviar codigo por WhatsApp.')
      return
    }
    if (!signupPhone.trim()) {
      setAuthError('Informe o telefone antes de enviar o codigo.')
      return
    }

    setSignupSendingCode(true)
    try {
      const result = await sendWhatsAppVerificationCode({
        role: 'passenger',
        phone: signupPhone.trim(),
      })
      const masked = result?.phoneMasked || 'seu numero'
      setSignupCodeMessage(`Codigo enviado para ${masked}.`)
    } catch (error) {
      setAuthError(error.message || 'Nao foi possivel enviar o codigo.')
    } finally {
      setSignupSendingCode(false)
    }
  }

  function handlePassengerPhotoChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAuthError('Selecione um arquivo de imagem valido.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setAuthError('A foto deve ter no maximo 2MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setSignupPhotoDataUrl(String(reader.result || ''))
      setAuthError('')
    }
    reader.onerror = () => {
      setAuthError('Nao foi possivel ler a foto selecionada.')
    }
    reader.readAsDataURL(file)
  }

  async function handleLogin(event) {
    event.preventDefault()
    setAuthError('')
    if (!apiEnabled && !passengerAccount) {
      setAuthError('No momento, cadastro do passageiro so pelo QR code do motorista.')
      setAuthMode('login')
      return
    }
    if (!clientEmail.trim() || !clientPassword.trim()) {
      setAuthError('Informe e-mail e senha para entrar.')
      return
    }
    if (apiEnabled) {
      try {
        const result = await loginPassenger({
          email: clientEmail.trim().toLowerCase(),
          password: clientPassword,
        })
        const loggedPassenger = result?.passenger || passengerAccount
        const linkedSlug = String(loggedPassenger?.driverSlug || slug || '').trim().toLowerCase()
        if (!linkedSlug) {
          setAuthError('Conta sem motorista vinculado. Faca o primeiro cadastro pelo QR code do motorista.')
          setShowClientLogin(true)
          return
        }
        if (result?.token) {
          localStorage.setItem(PASSENGER_TOKEN_KEY, result.token)
        }
        if (loggedPassenger) {
          const normalizedPassenger = { ...loggedPassenger, driverSlug: linkedSlug }
          writeJson(PASSENGER_STORAGE_KEY, normalizedPassenger)
          setPassengerAccount(normalizedPassenger)
        }
        setIsPassengerLoggedIn(true)
        setShowClientLogin(false)
        setRideFeedback(`Bem-vindo, ${loggedPassenger?.fullName ?? 'passageiro'}. Voce ja pode solicitar sua corrida.`)
        setGeoFeedback('')
        void syncPassengerLocationAfterLogin()
        return
      } catch (error) {
        setAuthError(error.message || 'Credenciais invalidas.')
        return
      }
    }

    const emailMatch = passengerAccount.email === clientEmail.trim().toLowerCase()
    const passwordMatch = passengerAccount.password === clientPassword
    if (!emailMatch || !passwordMatch) {
      setAuthError('Credenciais invalidas.')
      return
    }
    const linkedSlug = String(passengerAccount?.driverSlug || slug || '').trim().toLowerCase()
    if (!linkedSlug) {
      setAuthError('Conta sem motorista vinculado. Faca o primeiro cadastro pelo QR code do motorista.')
      return
    }
    const normalizedPassenger = { ...passengerAccount, driverSlug: linkedSlug }
    writeJson(PASSENGER_STORAGE_KEY, normalizedPassenger)
    setPassengerAccount(normalizedPassenger)
    setIsPassengerLoggedIn(true)
    setShowClientLogin(false)
    setRideFeedback(`Bem-vindo, ${passengerAccount.fullName}. Voce ja pode solicitar sua corrida.`)
    setGeoFeedback('')
    void syncPassengerLocationAfterLogin()
  }

  async function handleRequestRide() {
    if (!isPassengerLoggedIn) {
      setAuthMode('login')
      setShowClientLogin(true)
      setRideFeedback('')
      setAuthError('Para solicitar corrida, faca login. Cadastro so pelo QR code do motorista.')
      return
    }
    if (!hasDriverLink) {
      setRideFeedback('Conta sem motorista vinculado. Use o QR code do motorista para vincular e solicitar.')
      return
    }
    if (!isDriverActive) {
      setRideFeedback('Este motorista esta desativado no momento. Escolha outro motorista ou tente mais tarde.')
      return
    }
    if (!origin.trim()) {
      setRideFeedback('Informe a origem da viagem para continuar.')
      return
    }
    if (!destination.trim()) {
      setRideFeedback('Informe o destino da viagem para continuar.')
      return
    }

    const requestId = Date.now()
    const request = {
      id: requestId,
      passengerName: passengerAccount?.fullName || 'Passageiro',
      passengerEmail: passengerAccount?.email || '',
      driverSlug: activeDriverSlug,
      driverName,
      origin,
      destination,
      pickupDistance: `${pickupDistanceKm.toFixed(1)}km`,
      destinationTime: tripTime ? `Agendada ${tripTime}` : `${estimatedDurationMin} min`,
      distanceKm: Number(tripDistanceKm.toFixed(2)),
      durationMin: estimatedDurationMin,
      estimatedPrice: estimatedFareLabel,
      tripDate: tripDate || null,
      tripTime: tripTime || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    if (apiEnabled) {
      try {
        const result = await createRide(request)
        const createdRide = result?.ride || request
        await postChatMessage(createdRide.id, {
          sender: 'system',
          text: 'Solicitacao enviada para o motorista.',
        })
        setActiveRideId(createdRide.id)
        setActiveRideStatus('pending')
        setRideFeedback(`Corrida enviada (${estimatedFareLabel}). Aguarde o motorista aceitar para liberar o chat.`)
        return
      } catch (error) {
        setRideFeedback(error.message || 'Nao foi possivel enviar a solicitacao agora.')
        return
      }
    }

    const existing = readJson(RIDE_REQUESTS_KEY, [])
    writeJson(RIDE_REQUESTS_KEY, [request, ...existing])
    window.dispatchEvent(new Event('Aplayplay:ride-request'))

    appendChatMessage(requestId, {
      id: `${requestId}-system`,
      sender: 'system',
      text: 'Solicitacao enviada para o motorista.',
      createdAt: new Date().toISOString(),
    })

    setActiveRideId(requestId)
    setActiveRideStatus('pending')
    setRideFeedback(`Corrida enviada (${estimatedFareLabel}). Aguarde o motorista aceitar para liberar o chat.`)
  }

  async function handlePassengerSendMessage(event) {
    event.preventDefault()
    if (activeRideStatus !== 'accepted') return
    if (!activeRideId || !passengerMessage.trim()) return

    if (apiEnabled) {
      try {
        await postChatMessage(activeRideId, {
          sender: 'passenger',
          text: passengerMessage.trim(),
        })
        setPassengerMessage('')
        return
      } catch {
        // fallback local
      }
    }

    appendChatMessage(activeRideId, {
      id: `${activeRideId}-p-${Date.now()}`,
      sender: 'passenger',
      text: passengerMessage.trim(),
      createdAt: new Date().toISOString(),
    })
    setPassengerMessage('')
  }

  async function handleCancelRide() {
    if (!activeRideId) return

    if (apiEnabled) {
      try {
        await updateRideStatus(activeRideId, 'canceled')
        await postChatMessage(activeRideId, {
          sender: 'system',
          text: 'Passageiro cancelou a solicitacao.',
        })
        setActiveRideStatus('canceled')
        setActiveRideId(null)
        setChatMessages([])
        setPassengerMessage('')
        setRideFeedback('Solicitacao cancelada.')
        return
      } catch {
        // fallback local
      }
    }

    const requests = readJson(RIDE_REQUESTS_KEY, [])
    if (Array.isArray(requests)) {
      const updated = requests.map((request) => (
        String(request?.id) === String(activeRideId)
          ? { ...request, status: 'canceled' }
          : request
      ))
      writeJson(RIDE_REQUESTS_KEY, updated)
      window.dispatchEvent(new Event('Aplayplay:ride-request'))
    }

    appendChatMessage(activeRideId, {
      id: `${activeRideId}-passenger-cancel-${Date.now()}`,
      sender: 'system',
      text: 'Passageiro cancelou a solicitacao.',
      createdAt: new Date().toISOString(),
    })

    setActiveRideStatus('canceled')
    setActiveRideId(null)
    setChatMessages([])
    setPassengerMessage('')
    setRideFeedback('Solicitacao cancelada.')
  }

  function handleLogoutPassenger() {
    setIsPassengerLoggedIn(false)
    localStorage.removeItem(PASSENGER_TOKEN_KEY)
    setRideFeedback('Sessao encerrada. Entre novamente para solicitar outra corrida.')
  }

  const isRideLayout = isPassengerLoggedIn && !showClientLogin
  const hasSchedule = Boolean(tripDate || tripTime)
  const scheduleSummary = hasSchedule
    ? `${tripDate || '--/--/----'} ${tripTime || '--:--'}`
    : 'Partida imediata'

  return (
    <section className={`booking-request-demo${showClientLogin ? ' booking-request-demo--auth' : ''}${isRideLayout ? ' booking-request-demo--ride' : ''}`} aria-labelledby="booking-demo">
      <div className="container">
        <div className="section-head section-head--center">
          <h2 id="booking-demo">Tela de cliente para solicitar corrida</h2>
          <p>
            Seja bem-vindo.
          </p>
          <p>
            Se voce chegou ate aqui foi porque escaneou o codigo do motorista. Agora voce pode
            solicitar corrida particular com ele, com preco bem mais em conta, conforto e seguranca
            de viajar com o motorista que voce escolheu.
          </p>
        </div>

        <div className={`booking-stage${showClientLogin ? ' booking-stage--auth-only' : ''}${isRideLayout ? ' booking-stage--ride' : ''}`}>
          {!showClientLogin && (
          <div className="booking-stage__map">
            <MapContainer
              center={CEARA_CENTER}
              zoom={7}
              zoomControl={false}
              minZoom={7}
              maxBounds={CEARA_BOUNDS}
              maxBoundsViscosity={1}
              scrollWheelZoom
              className="booking-stage__leaflet"
              whenReady={(event) => {
                mapRef.current = event.target
              }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={driverPoint} icon={driverCarIcon}>
                <Popup>Motorista: {driverName}</Popup>
              </Marker>
              <Marker position={passengerPoint} icon={passengerPinIcon}>
                <Popup>Minha localizacao: ponto de embarque</Popup>
              </Marker>
              <Marker position={destinationPoint} icon={destinationFlagIcon}>
                <Popup>Destino final: {destination || 'Nao informado'}</Popup>
              </Marker>
              {routeCandidates.length > 0 && routeCandidates
                .filter((route) => route.index !== selectedTripRoute?.index)
                .map((route) => (
                  <Polyline
                    key={`alt-${route.index}`}
                    positions={route.points}
                    pathOptions={{
                      color: '#94a3b8',
                      weight: 4,
                      opacity: 0.35,
                      dashArray: '8 8',
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                ))}
              {pickupRoute?.points?.length >= 2 && (
                <Polyline
                  positions={pickupRoute.points}
                  pathOptions={{
                    color: '#0A1A3A',
                    weight: 4,
                    opacity: 0.75,
                    dashArray: '10 6',
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              )}
              {selectedTripRoute?.trafficSegments?.length > 0 && selectedTripRoute.trafficSegments.map((segment, index) => (
                <Polyline
                  key={`seg-${selectedTripRoute.index}-${index}`}
                  positions={[segment.from, segment.to]}
                  pathOptions={{
                    color: segment.color,
                    weight: segment.weight,
                    opacity: 0.92,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              ))}
              {!selectedTripRoute && (
                <>
                  <Polyline
                    positions={fallbackRoutePositions}
                    pathOptions={{
                      color: '#0A1A3A',
                      weight: 10,
                      opacity: 0.15,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                  <Polyline
                    positions={fallbackRoutePositions}
                    pathOptions={{
                      color: '#FFD400',
                      weight: 6,
                      opacity: 0.95,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </>
              )}
            </MapContainer>

            <div className="booking-stage__controls">
              <button type="button" onClick={zoomIn}>+</button>
              <button type="button" onClick={zoomOut}>-</button>
              <button type="button" className="booking-stage__locate" onClick={locateRoute}>L</button>
            </div>

            {isRideLayout && (
              <div className="booking-stage__ride-header">
                <p className="booking-stage__ride-city">Atendimento em {cityLabel}</p>
                <button type="button" className="booking-stage__ride-search" onClick={focusDestinationFromHeader}>
                  Para onde vamos?
                </button>
              </div>
            )}

            {!activeRideId && !isRideLayout && (
              <div className="booking-stage__fare-tag">
                <strong>{estimatedFareLabel}</strong>
                <small>{tripDistanceKm.toFixed(1)} km • {estimatedDurationMin} min</small>
              </div>
            )}

            {!isRideLayout && (
              <div className={`booking-stage__traffic booking-stage__traffic--${liveTrafficState}`}>
                <strong>Transito: {liveTrafficState}</strong>
                <small>{isRouting ? 'Atualizando rotas...' : 'Atualizacao continua ativa'}</small>
              </div>
            )}
          </div>
          )}

          {!activeRideId && (
          <article className={`booking-card${showClientLogin ? ' booking-card--auth' : ''}${isRideLayout ? ' booking-card--sheet' : ''}`} aria-label="Area do cliente">
            {isRideLayout && <div className="booking-card__sheet-handle" aria-hidden="true" />}
            {showClientLogin ? (
              <>
                <header className="booking-card__head">
                  <h3>{authMode === 'signup' ? 'Cadastro do passageiro' : 'Login do passageiro'}</h3>
                  <p>
                    {authMode === 'signup'
                      ? 'Crie sua conta para poder solicitar corridas.'
                      : 'Entre com e-mail e senha para liberar a solicitacao.'}
                  </p>
                  <p className="booking-card__driver-badge">Atendimento em {cityLabel}</p>
                  {!allowPassengerSignup && (
                    <p className="booking-auth-help">
                      Cadastro liberado somente via QR code/link oficial do motorista.
                    </p>
                  )}
                </header>

                <div className="booking-auth-switch">
                  <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>Login</button>
                  {allowPassengerSignup && (
                    <button type="button" className={authMode === 'signup' ? 'is-active' : ''} onClick={() => setAuthMode('signup')}>Cadastro</button>
                  )}
                </div>

                {authMode === 'signup' ? (
                  <form className="booking-card__fields booking-card__fields--auth" onSubmit={handleSignup}>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cadastro rapido</p>
                      <p className="mt-1 text-sm text-slate-700">Complete os dados para liberar solicitacao de corrida.</p>
                    </div>

                    <div className="grid gap-3">
                      <label className="booking-field">
                        <span>Nome completo</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--origin">N</i>
                          <input
                            type="text"
                            placeholder="Nome do passageiro"
                            value={signupFullName}
                            onChange={(e) => setSignupFullName(e.target.value)}
                          />
                        </div>
                      </label>

                      <label className="booking-field">
                        <span>E-mail</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--origin">@</i>
                          <input
                            type="email"
                            placeholder="seuemail@exemplo.com"
                            value={clientEmail}
                            onChange={(e) => setClientEmail(e.target.value)}
                          />
                        </div>
                      </label>

                      <label className="booking-field">
                        <span>Senha</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--destination">*</i>
                          <input
                            type="password"
                            placeholder="Crie uma senha"
                            value={clientPassword}
                            onChange={(e) => setClientPassword(e.target.value)}
                          />
                        </div>
                      </label>

                      <label className="booking-field">
                        <span>Telefone</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--origin">T</i>
                          <input
                            type="text"
                            placeholder="(85) 99999-9999"
                            value={signupPhone}
                            onChange={(e) => setSignupPhone(maskBrazilPhone(e.target.value))}
                          />
                        </div>
                      </label>

                      <label className="booking-field">
                        <span>Codigo WhatsApp</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--origin">#</i>
                          <input
                            type="text"
                            placeholder="Codigo de 6 digitos"
                            value={signupVerificationCode}
                            onChange={(e) => setSignupVerificationCode(String(e.target.value || '').replace(/\D/g, '').slice(0, 6))}
                          />
                          <button
                            type="button"
                            onClick={handleSendPassengerSignupCode}
                            disabled={signupSendingCode}
                          >
                            {signupSendingCode ? '...' : 'Enviar'}
                          </button>
                        </div>
                      </label>
                      {signupCodeMessage && <p className="booking-auth-help">{signupCodeMessage}</p>}

                      <label className="booking-field">
                        <span>Endereco</span>
                        <div>
                          <i className="booking-field__icon booking-field__icon--destination">E</i>
                          <input
                            type="text"
                            placeholder="Rua, numero e bairro"
                            value={signupAddress}
                            onChange={(e) => setSignupAddress(e.target.value)}
                          />
                        </div>
                      </label>

                      <label className="booking-field">
                        <span>Foto</span>
                        <div>
                          <input type="file" accept="image/*" onChange={handlePassengerPhotoChange} />
                        </div>
                      </label>
                    </div>

                    {signupPhotoDataUrl && (
                      <div className="booking-passenger-photo-preview">
                        <img src={signupPhotoDataUrl} alt="Foto do passageiro" />
                      </div>
                    )}
                    {authError && <p className="booking-auth-error">{authError}</p>}
                    <button className="booking-card__submit" type="submit">
                      <span>Cadastrar passageiro</span>
                      <span>{'>'}</span>
                    </button>
                    <p className="booking-auth-footer">
                      Ja tem conta?{' '}
                      <button type="button" className="booking-auth-inline-link" onClick={() => setAuthMode('login')}>
                        Entrar
                      </button>
                    </p>
                  </form>
                ) : (
                  <form className="booking-card__fields booking-card__fields--auth" onSubmit={handleLogin}>
                    <label className="booking-field">
                      <span>E-mail</span>
                      <div>
                        <i className="booking-field__icon booking-field__icon--origin">@</i>
                        <input type="email" placeholder="cliente@exemplo.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
                      </div>
                    </label>
                    <label className="booking-field">
                      <span>Senha</span>
                      <div>
                        <i className="booking-field__icon booking-field__icon--destination">*</i>
                        <input type="password" placeholder="Digite sua senha" value={clientPassword} onChange={(e) => setClientPassword(e.target.value)} />
                      </div>
                    </label>
                    <p className="booking-auth-help">Esqueceu a senha?</p>
                    {authError && <p className="booking-auth-error">{authError}</p>}
                    <button className="booking-card__submit" type="submit">
                      <span>Entrar e liberar corrida</span>
                      <span>{'>'}</span>
                    </button>
                    <p className="booking-auth-footer">
                      {allowPassengerSignup ? (
                        <>
                          Novo por aqui?{' '}
                          <button type="button" className="booking-auth-inline-link" onClick={() => setAuthMode('signup')}>
                            Criar Cadastro
                          </button>
                        </>
                      ) : (
                        <>Cadastro disponivel somente pelo QR code do motorista.</>
                      )}
                    </p>
                  </form>
                )}
              </>
            ) : (
              <>
                <header className="booking-card__head">
                  <h3>Para onde vamos?</h3>
                  <p>Reserve sua viagem com segurança e preço justo.</p>
                  <p className="booking-card__passenger-note">
                    Seja bem-vindo! O Aplayplay é uma ferramenta para você, passageiro, economizar com suas viagens.
                    Caso ache tarifas altas, converse com o motorista, pois cada um pode ajustar os valores da corrida.
                    Sempre negocie pela plataforma e viaje com pessoas de sua confiança, pois aqui você escolhe com quem viaja.
                  </p>
                  <p className="booking-card__driver-badge">Atendimento em {cityLabel}</p>
                  <p className="booking-card__status">
                    {isPassengerLoggedIn
                      ? `Passageiro autenticado: ${passengerAccount?.fullName ?? 'Conta ativa'}`
                      : 'Passageiro nao autenticado. Faca cadastro/login para solicitar.'}
                  </p>
                  {isPassengerLoggedIn && !hasDriverLink && (
                    <p className="booking-card__status">Conta sem motorista vinculado. Primeiro acesso deve ser pelo QR code.</p>
                  )}
                </header>

                <div className="booking-card__fields">
                  <label className="booking-field booking-field--origin">
                    <span>Origem</span>
                    <div>
                      <i className="booking-field__icon booking-field__icon--origin">O</i>
                      <input
                        type="text"
                        value={origin}
                        onChange={(e) => handleOriginChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && originSuggestions.length > 0) {
                            e.preventDefault()
                            selectOriginSuggestion(originSuggestions[0])
                          }
                        }}
                        onFocus={() => setIsOriginFocused(true)}
                        onBlur={() => setTimeout(() => setIsOriginFocused(false), 110)}
                        autoComplete="off"
                      />
                      <button type="button" aria-label="Limpar origem" onClick={() => setOrigin('')}>X</button>
                    </div>
                    {(origin.trim().length >= 3 && (isOriginFocused || loadingOriginSuggestions || originSuggestions.length > 0)) && (
                      <div className="booking-suggestions">
                        {loadingOriginSuggestions && <p className="booking-suggestions__empty">Buscando no Ceara...</p>}
                        {!loadingOriginSuggestions && originSuggestions.length === 0 && (
                          <p className="booking-suggestions__empty">Nenhum endereco no Ceara encontrado.</p>
                        )}
                        {!loadingOriginSuggestions && originSuggestions.map((item, index) => (
                          <button
                            key={item.place_id}
                            type="button"
                            className="booking-suggestions__item"
                            style={{ '--stagger': `${index * 32}ms` }}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              selectOriginSuggestion(item)
                            }}
                          >
                            <span className="booking-suggestions__left">
                              <i className="booking-suggestions__pin" aria-hidden="true">◎</i>
                              <small>{isNumber(item.__distKm) ? formatDistanceLabel(item.__distKm) : '-'}</small>
                            </span>
                            <span className="booking-suggestions__content">
                              <strong>{formatShortFortalezaAddress(item)}</strong>
                              <small>{splitDisplayName(item).subtitle}</small>
                            </span>
                            <span className="booking-suggestions__go" aria-hidden="true">↗</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <label className="booking-field">
                    <span>Destino</span>
                    <div>
                      <i className="booking-field__icon booking-field__icon--destination">D</i>
                      <input
                        ref={destinationInputRef}
                        type="text"
                        placeholder="Digite o destino da viagem"
                        value={destination}
                        onChange={(e) => handleDestinationChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && destinationSuggestions.length > 0) {
                            e.preventDefault()
                            selectDestinationSuggestion(destinationSuggestions[0])
                          }
                        }}
                        onFocus={() => setIsDestinationFocused(true)}
                        onBlur={() => setTimeout(() => setIsDestinationFocused(false), 110)}
                        autoComplete="off"
                      />
                    </div>
                    {(destination.trim().length >= 3 && (isDestinationFocused || loadingDestinationSuggestions || destinationSuggestions.length > 0)) && (
                      <div className="booking-suggestions">
                        {loadingDestinationSuggestions && <p className="booking-suggestions__empty">Buscando no Ceara...</p>}
                        {!loadingDestinationSuggestions && destinationSuggestions.length === 0 && (
                          <p className="booking-suggestions__empty">Nenhum endereco no Ceara encontrado.</p>
                        )}
                        {!loadingDestinationSuggestions && destinationSuggestions.map((item, index) => (
                          <button
                            key={item.place_id}
                            type="button"
                            className="booking-suggestions__item"
                            style={{ '--stagger': `${index * 32}ms` }}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              selectDestinationSuggestion(item)
                            }}
                          >
                            <span className="booking-suggestions__left">
                              <i className="booking-suggestions__pin" aria-hidden="true">◎</i>
                              <small>{isNumber(item.__distKm) ? formatDistanceLabel(item.__distKm) : '-'}</small>
                            </span>
                            <span className="booking-suggestions__content">
                              <strong>{formatShortFortalezaAddress(item)}</strong>
                              <small>{splitDisplayName(item).subtitle}</small>
                            </span>
                            <span className="booking-suggestions__go" aria-hidden="true">↗</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                </div>

                <div className="booking-card__schedule-trigger">
                  <button type="button" onClick={() => setShowScheduleModal(true)}>
                    Agendar viagem
                  </button>
                  <small>{scheduleSummary}</small>
                  {hasSchedule && (
                    <button
                      type="button"
                      className="booking-card__schedule-clear"
                      onClick={() => {
                        setTripDate('')
                        setTripTime('')
                      }}
                    >
                      Limpar agendamento
                    </button>
                  )}
                </div>

                <div className="booking-card__fare-preview">
                  <small>Estimativa da corrida</small>
                  <strong>{estimatedFareLabel}</strong>
                  <span>{tripDistanceKm.toFixed(1)} km de trajeto • {estimatedDurationMin} min</span>
                  <span>Motorista ate voce: {pickupDistanceKm.toFixed(1)} km</span>
                  {routeCandidates.length > 0 && (
                    <div className="booking-smart-routes" role="tablist" aria-label="Rotas alternativas">
                      {routeCandidates.slice(0, 3).map((route, idx) => (
                        <button
                          key={`smart-route-${route.index}`}
                          type="button"
                          role="tab"
                          aria-selected={selectedTripRoute?.index === route.index}
                          className={selectedTripRoute?.index === route.index ? 'is-active' : ''}
                          onClick={() => setSelectedTripIndex(route.index)}
                        >
                          <strong>{idx === 0 ? 'Melhor' : `Alt ${idx + 1}`}</strong>
                          <small>{Math.round(route.adjustedDurationMin)} min</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {routingFeedback && <span className="booking-smart-feedback">{routingFeedback}</span>}
                  {trafficNotice && <span className="booking-smart-feedback booking-smart-feedback--warn">{trafficNotice}</span>}
                  {routingError && <span className="booking-smart-feedback booking-smart-feedback--error">{routingError}</span>}
                </div>

                <div className="booking-card__geo-actions">
                  <button type="button" onClick={handleLocateDriver} disabled={isLocatingDriver}>
                    {isLocatingDriver ? 'Lendo local do motorista...' : 'Ler local do motorista'}
                  </button>
                </div>

                {geoFeedback && <p className="booking-card__geo-feedback">{geoFeedback}</p>}
                {rideFeedback && <p className="booking-card__ride-feedback">{rideFeedback}</p>}

                <div className="booking-card__divider" />

                <div className="booking-driver">
                  <div className="booking-driver__avatar">
                    <span>{driverInitials}</span>
                    <i>V</i>
                  </div>
                  <div className="booking-driver__info">
                    <strong>{driverName}</strong>
                    <p>4.9 * {vehicle} * {plate}</p>
                    <small>{category}</small>
                  </div>
                </div>

                <button className="booking-card__submit" type="button" onClick={handleRequestRide}>
                  <span>{isPassengerLoggedIn ? (hasDriverLink ? `Solicitar Corrida (${estimatedFareLabel})` : 'Vincule com QR para Solicitar') : 'Cadastro/Login para Solicitar'}</span>
                  <span>{'>'}</span>
                </button>

                {isPassengerLoggedIn && (
                  <button className="booking-card__secondary-btn" type="button" onClick={handleLogoutPassenger}>
                    Sair da conta do passageiro
                  </button>
                )}
              </>
            )}

            <p className="booking-card__terms">
              Ao continuar, voce concorda com nossos <a href="#">Termos de Uso</a>.
            </p>
          </article>
          )}

          {activeRideId && (
            <aside className="booking-chat-float" aria-live="polite" aria-label="Chat da corrida">
              <div className="booking-chat-float__head">
                <strong>Chat com motorista</strong>
                <small>
                  {activeRideStatus === 'accepted' && 'Corrida aceita: chat liberado'}
                  {activeRideStatus === 'declined' && 'Corrida recusada pelo motorista'}
                  {activeRideStatus === 'canceled' && 'Solicitacao cancelada'}
                  {activeRideStatus !== 'accepted' && activeRideStatus !== 'declined' && activeRideStatus !== 'canceled' && 'Aguardando motorista aceitar'}
                </small>
              </div>

              <div className="booking-chat-box__messages">
                {chatMessages.length === 0 && <p>Aguardando atualizacoes...</p>}
                {chatMessages.map((message) => (
                  <p key={message.id} className={`booking-chat-box__message booking-chat-box__message--${message.sender}`}>
                    {message.text}
                  </p>
                ))}
              </div>

              <form className="booking-chat-box__form" onSubmit={handlePassengerSendMessage}>
                <input
                  type="text"
                  placeholder={
                    activeRideStatus === 'accepted'
                      ? 'Digite para o motorista...'
                      : 'Chat liberado quando motorista aceitar'
                  }
                  value={passengerMessage}
                  onChange={(e) => setPassengerMessage(e.target.value)}
                  disabled={activeRideStatus !== 'accepted'}
                />
                <button type="submit" disabled={activeRideStatus !== 'accepted'}>Enviar</button>
              </form>

              <button
                type="button"
                className="booking-chat-float__cancel"
                onClick={handleCancelRide}
              >
                Cancelar solicitacao
              </button>
            </aside>
          )}

          {showScheduleModal && (
            <div className="booking-schedule-modal" role="dialog" aria-modal="true" aria-label="Agendar viagem" onClick={() => setShowScheduleModal(false)}>
              <div className="booking-schedule-modal__content" onClick={(event) => event.stopPropagation()}>
                <h4>Agendar viagem</h4>
                <p>Escolha data e hora. Se nao preencher, a corrida sai agora.</p>

                <div className="booking-card__schedule">
                  <label className="booking-field">
                    <span>Data da viagem</span>
                    <div>
                      <input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
                    </div>
                  </label>
                  <label className="booking-field">
                    <span>Horario da viagem</span>
                    <div>
                      <input type="time" value={tripTime} onChange={(e) => setTripTime(e.target.value)} />
                    </div>
                  </label>
                </div>

                <div className="booking-schedule-modal__actions">
                  <button type="button" className="booking-schedule-modal__ghost" onClick={() => setShowScheduleModal(false)}>Cancelar</button>
                  <button type="button" className="booking-schedule-modal__save" onClick={() => setShowScheduleModal(false)}>Salvar agendamento</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default BookingRequestDemoPage
