import { useEffect, useState } from 'react'
import { Bell, CarFront, ChevronDown, CircleHelp, Menu } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import {
  dashboardMenu,
  initialDashboardStats,
  initialTariffs,
  initialUpcomingRides,
} from '../data/mockData'
import { useDriverAccount } from '../context/DriverAccountContext'
import {
  isApiEnabled,
  listChatMessages,
  listRides,
  postChatMessage,
  updateRideStatus as updateRideStatusApi,
} from '../services/api'

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function parseBrazilianCurrencyInput(value) {
  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatBrazilianDecimal(value) {
  return Number(value).toFixed(2).replace('.', ',')
}

function readDefaultTariffs() {
  return {
    perKm: parseBrazilianCurrencyInput(initialTariffs.perKm),
    perMinute: parseBrazilianCurrencyInput(initialTariffs.perMinute),
    displacementFee: parseBrazilianCurrencyInput(initialTariffs.displacementFee),
  }
}

function getInitials(name) {
  return (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'JS'
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getGreetingByHour(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

async function reverseGeocodeDriverCity(lat, lng) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('zoom', '10')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url.toString(), {
    headers: { 'Accept-Language': 'pt-BR' },
  })
  if (!response.ok) return null
  const data = await response.json()
  const address = data?.address || {}
  const city = address.city || address.town || address.village || address.municipality || address.county
  const stateCode = String(address.state_code || '').toUpperCase()
  const state = address.state
  if (city && stateCode) return `${city}, ${stateCode}`
  if (city && state) return `${city}, ${state}`
  return city || null
}

const RIDE_REQUESTS_KEY = 'Aplayplay_ride_requests'
const CHAT_THREADS_KEY = 'Aplayplay_chat_threads'
const DEMO_TARIFF_LOCK_MESSAGE = 'Essa funcao nao esta ativada no modo demo. Falar com suporte.'

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

function appendChatMessage(rideId, message) {
  const threads = readJson(CHAT_THREADS_KEY, {})
  const current = threads[String(rideId)] || []
  threads[String(rideId)] = [...current, message]
  writeJson(CHAT_THREADS_KEY, threads)
  window.dispatchEvent(new Event('Aplayplay:chat-updated'))
}

function mapRideRequestToRideCard(request) {
  return {
    id: request.id,
    initials: getInitials(request.passengerName || 'Passageiro'),
    passenger: request.passengerName || 'Passageiro',
    rating: '5.0',
    price: 'R$ 0,00',
    distanceKm: 2.2,
    pickupDistance: request.pickupDistance || '1.8km',
    pickup: request.origin || 'Origem nao informada',
    durationMin: 17,
    destinationTime: request.destinationTime || '17 min',
    destination: request.destination || 'Destino nao informado',
    accent: 'blue',
    status: request.status || 'pending',
  }
}

function rideStatusLabel(status) {
  if (status === 'accepted') return 'Corrida aceita'
  if (status === 'declined') return 'Corrida recusada'
  if (status === 'canceled') return 'Corrida cancelada pelo passageiro'
  return 'Aguardando resposta'
}

function DriverDashboardDemoPage({ requireRegistration = false }) {
  const { driverAccount, updateDriverAccount } = useDriverAccount()
  const [isOnline, setIsOnline] = useState(true)
  const [rides, setRides] = useState([])
  const [tariffs, setTariffs] = useState(initialTariffs)
  const [loading, setLoading] = useState(true)
  const [savedMessage, setSavedMessage] = useState('')
  const [activeMenu, setActiveMenu] = useState('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [incomingRideAlert, setIncomingRideAlert] = useState(null)
  const [chatRide, setChatRide] = useState(null)
  const [driverChatMessages, setDriverChatMessages] = useState([])
  const [driverMessage, setDriverMessage] = useState('')
  const [driverLiveCity, setDriverLiveCity] = useState('')
  const [supportMessages, setSupportMessages] = useState([
    { id: 'support-init', sender: 'support', text: 'Suporte online. Como podemos ajudar?' },
  ])
  const [supportDraft, setSupportDraft] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const apiEnabled = isApiEnabled()

  if (requireRegistration && !driverAccount) {
    return <Navigate to="/cadastro/motorista" replace />
  }

  if (requireRegistration && driverAccount?.isActive === false) {
    return (
      <section className="driver-signup">
        <div className="container">
          <div className="driver-signup__card">
            <div className="driver-signup__section">
              <h2>Conta de motorista desativada</h2>
              <p className="driver-signup__error">
                Seu acesso foi desativado. Regularize o pagamento para reativar o painel.
              </p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const driverName = driverAccount?.fullName || 'Joao Silva'
  const isTariffsEnabled = driverAccount?.tariffsEnabled !== false
  const firstName = driverName.split(' ')[0] || 'Joao'
  const driverCity = driverAccount?.city || 'Sao Paulo, SP'
  const driverDisplayCity = driverLiveCity || driverCity
  const greeting = getGreetingByHour()
  const driverInitials = getInitials(driverName)
  const driverPhoto = driverAccount?.photoDataUrl || ''
  const driverSlug = slugify(driverName) || 'motorista'
  const publicBookingPath = `/solicitar/${driverSlug}`
  const publicBookingLink = `${window.location.origin}${publicBookingPath}`
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(publicBookingLink)}`

  const menuTitle = activeMenu === 'Dashboard' ? 'Visao Geral' : activeMenu
  const showOverview = activeMenu === 'Dashboard'
  const showRides = activeMenu === 'Corridas' || showOverview
  const showMap = showOverview || activeMenu === 'Ganhos' || activeMenu === 'Corridas'
  const showTariffs = activeMenu === 'Tarifas' || showOverview
  const showLink = activeMenu === 'Link'
  const showRatings = activeMenu === 'Avaliacoes'
  const showHelp = activeMenu === 'Ajuda'

  useEffect(() => {
    if (driverAccount?.tariffs) {
      setTariffs((current) => ({ ...current, ...driverAccount.tariffs }))
    }
  }, [driverAccount?.tariffs])

  useEffect(() => {
    let cancelled = false
    if (!navigator?.geolocation) return undefined

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const city = await reverseGeocodeDriverCity(position.coords.latitude, position.coords.longitude)
          if (!cancelled && city) {
            setDriverLiveCity(city)
          }
        } catch {
          // Fallback silencioso para cidade do cadastro
        }
      },
      () => {
        // Fallback silencioso para cidade do cadastro
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 },
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setRides(initialUpcomingRides)
      setLoading(false)
    }, 450)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!savedMessage) return undefined
    const timer = setTimeout(() => setSavedMessage(''), 1800)
    return () => clearTimeout(timer)
  }, [savedMessage])

  useEffect(() => {
    if (!copyMessage) return undefined
    const timer = setTimeout(() => setCopyMessage(''), 1600)
    return () => clearTimeout(timer)
  }, [copyMessage])

  useEffect(() => {
    function syncIncomingRideRequests() {
      if (apiEnabled) {
        void (async () => {
          try {
            const result = await listRides()
            const requests = Array.isArray(result?.rides) ? result.rides : []
            if (requests.length === 0) return

            const newestPending = requests.find((request) => request?.status === 'pending')
            if (newestPending) {
              setIncomingRideAlert((current) => (current?.id === newestPending.id ? current : newestPending))
            }

            setRides((current) => {
              const existingIds = new Set(current.map((ride) => String(ride.id)))
              const mapped = requests
                .filter((request) => request?.id && !existingIds.has(String(request.id)))
                .map(mapRideRequestToRideCard)
              if (!mapped.length) return current
              return [...mapped, ...current]
            })
          } catch {
            // fallback local
          }
        })()
        return
      }

      const requests = readJson(RIDE_REQUESTS_KEY, [])
      if (!Array.isArray(requests) || requests.length === 0) return

      const newestPending = requests.find((request) => request?.status === 'pending')
      if (newestPending) {
        setIncomingRideAlert((current) => (current?.id === newestPending.id ? current : newestPending))
      }

      setRides((current) => {
        const existingIds = new Set(current.map((ride) => String(ride.id)))
        const mapped = requests
          .filter((request) => request?.id && !existingIds.has(String(request.id)))
          .map(mapRideRequestToRideCard)
        if (!mapped.length) return current
        return [...mapped, ...current]
      })
    }

    function onRideRequest() {
      syncIncomingRideRequests()
    }

    syncIncomingRideRequests()
    const timer = setInterval(syncIncomingRideRequests, 1500)
    window.addEventListener('storage', onRideRequest)
    window.addEventListener('Aplayplay:ride-request', onRideRequest)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', onRideRequest)
      window.removeEventListener('Aplayplay:ride-request', onRideRequest)
    }
  }, [apiEnabled])

  useEffect(() => {
    if (!chatRide) return undefined
    const rideId = String(chatRide.id)

    function loadChat() {
      if (apiEnabled) {
        void (async () => {
          try {
            const result = await listChatMessages(rideId)
            setDriverChatMessages(Array.isArray(result?.messages) ? result.messages : [])
            return
          } catch {
            // fallback local
          }
          const threads = readJson(CHAT_THREADS_KEY, {})
          setDriverChatMessages(threads[rideId] || [])
        })()
        return
      }
      const threads = readJson(CHAT_THREADS_KEY, {})
      setDriverChatMessages(threads[rideId] || [])
    }

    loadChat()
    const timer = setInterval(loadChat, 1200)
    window.addEventListener('storage', loadChat)
    window.addEventListener('Aplayplay:chat-updated', loadChat)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', loadChat)
      window.removeEventListener('Aplayplay:chat-updated', loadChat)
    }
  }, [chatRide, apiEnabled])

  const acceptedCount = rides.filter((ride) => ride.status === 'accepted').length
  const pendingCount = rides.filter((ride) => ride.status === 'pending').length
  const typedTariffs = {
    perKm: parseBrazilianCurrencyInput(tariffs.perKm),
    perMinute: parseBrazilianCurrencyInput(tariffs.perMinute),
    displacementFee: parseBrazilianCurrencyInput(tariffs.displacementFee),
  }
  const tariffNumbers = isTariffsEnabled ? typedTariffs : readDefaultTariffs()

  const ridesWithComputedPrice = rides.map((ride) => {
    const distanceKm = ride.distanceKm ?? Number(String(ride.pickupDistance || '0').replace(/[^\d.,]/g, '').replace(',', '.'))
    const durationMin = ride.durationMin ?? Number(String(ride.destinationTime || '0').replace(/[^\d.,]/g, '').replace(',', '.'))
    const total =
      tariffNumbers.displacementFee +
      distanceKm * tariffNumbers.perKm +
      durationMin * tariffNumbers.perMinute

    return {
      ...ride,
      computedPrice: formatCurrency(total),
    }
  })

  const parsedSum = ridesWithComputedPrice
    .filter((ride) => ride.status === 'accepted')
    .reduce((sum, ride) => sum + parseBrazilianCurrencyInput(ride.computedPrice), 0)

  const statCards = initialDashboardStats.map((card) => {
    if (card.key === 'earnings') {
      const total = parsedSum > 0 ? parsedSum : 250
      return {
        ...card,
        value: formatCurrency(total),
        badge: acceptedCount > 0 ? `+${acceptedCount} aceitas` : card.badge,
        hint: acceptedCount > 0 ? 'corridas confirmadas' : card.hint,
      }
    }

    if (card.key === 'rides') {
      const ridesDone = 12 + acceptedCount
      return {
        ...card,
        value: String(ridesDone),
        badge: pendingCount > 0 ? `+${pendingCount}` : '0',
        hint: pendingCount > 0 ? 'aguardando resposta' : 'sem novas corridas',
      }
    }

    return card
  })

  async function updateRideStatus(id, status) {
    setRides((current) => current.map((ride) => (ride.id === id ? { ...ride, status } : ride)))

    if (apiEnabled) {
      try {
        const result = await updateRideStatusApi(id, status)
        const updatedRide = result?.ride
        if (updatedRide) {
          setIncomingRideAlert((alert) => (String(alert?.id) === String(id) ? null : alert))
          await postChatMessage(id, {
            sender: 'system',
            text: status === 'accepted' ? 'Motorista aceitou a corrida.' : 'Motorista recusou a corrida.',
          })
          setChatRide(updatedRide)
          return
        }
      } catch {
        // fallback local
      }
    }

    const requests = readJson(RIDE_REQUESTS_KEY, [])
    if (Array.isArray(requests)) {
      const updated = requests.map((request) => (
        String(request.id) === String(id) ? { ...request, status } : request
      ))
      writeJson(RIDE_REQUESTS_KEY, updated)
      window.dispatchEvent(new Event('Aplayplay:ride-request'))
      const currentRequest = updated.find((request) => String(request.id) === String(id))
      if (currentRequest) {
        setIncomingRideAlert((alert) => (String(alert?.id) === String(id) ? null : alert))
        appendChatMessage(id, {
          id: `${id}-driver-status-${Date.now()}`,
          sender: 'system',
          text: status === 'accepted' ? 'Motorista aceitou a corrida.' : 'Motorista recusou a corrida.',
          createdAt: new Date().toISOString(),
        })
        setChatRide(currentRequest)
      }
    }
  }

  function addRide() {
    const nextId = rides.length ? Math.max(...rides.map((ride) => ride.id)) + 1 : 1
    const mockRide = {
      id: nextId,
      initials: 'NV',
      passenger: 'Nova Viagem',
      rating: '4.9',
      price: 'R$ 31,20',
      distanceKm: 2.1,
      pickupDistance: '2.1km',
      pickup: 'Rua Augusta, 900 - Consolacao',
      durationMin: 19,
      destinationTime: '19 min',
      destination: 'Vila Madalena - Sao Paulo',
      accent: 'blue',
      status: 'pending',
    }
    setRides((current) => [mockRide, ...current])
  }

  function handleTariffChange(key, value) {
    if (!isTariffsEnabled) {
      setSavedMessage(DEMO_TARIFF_LOCK_MESSAGE)
      return
    }
    setTariffs((current) => ({ ...current, [key]: value }))
  }

  function saveTariffs() {
    if (!isTariffsEnabled) {
      setSavedMessage(DEMO_TARIFF_LOCK_MESSAGE)
      return
    }
    updateDriverAccount({ tariffs })
    setSavedMessage('Tarifas salvas')
  }

  function handleMenuClick(label) {
    setActiveMenu(label)
    setSidebarOpen(false)
  }

  function openChatFromAlert() {
    if (!incomingRideAlert) return
    setChatRide(incomingRideAlert)
    setActiveMenu('Corridas')
  }

  async function sendDriverMessage(event) {
    event.preventDefault()
    if (!chatRide || !driverMessage.trim()) return

    if (apiEnabled) {
      try {
        await postChatMessage(chatRide.id, {
          sender: 'driver',
          text: driverMessage.trim(),
        })
        setDriverMessage('')
        return
      } catch {
        // fallback local
      }
    }

    appendChatMessage(chatRide.id, {
      id: `${chatRide.id}-driver-${Date.now()}`,
      sender: 'driver',
      text: driverMessage.trim(),
      createdAt: new Date().toISOString(),
    })
    setDriverMessage('')
  }

  function sendSupportMessage(event) {
    event.preventDefault()
    if (!supportDraft.trim()) return

    const userMessage = {
      id: `support-driver-${Date.now()}`,
      sender: 'driver',
      text: supportDraft.trim(),
    }

    setSupportMessages((current) => [...current, userMessage])
    setSupportDraft('')

    setTimeout(() => {
      setSupportMessages((current) => [
        ...current,
        {
          id: `support-reply-${Date.now()}`,
          sender: 'support',
          text: 'Recebemos sua mensagem. Nosso suporte vai responder em instantes.',
        },
      ])
    }, 500)
  }

  async function copyPassengerLink() {
    try {
      await navigator.clipboard.writeText(publicBookingLink)
      setCopyMessage('Link copiado!')
    } catch {
      setCopyMessage('Nao foi possivel copiar.')
    }
  }

  return (
    <section className="driver-dashboard-demo" aria-labelledby="driver-dashboard-demo">
      <div className="container">
        <div className="section-head section-head--center">
          <h2 id="driver-dashboard-demo">Dashboard do Motorista</h2>
          <p>
            Painel operacional com resumo de ganhos, corridas, mapa e tarifas
            no mesmo ecossistema visual do Aplayplay.
          </p>
        </div>

        <div className="driver-dashboard-shell">
          {sidebarOpen && (
            <button
              type="button"
              className="driver-sidebar__overlay"
              aria-label="Fechar menu"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside className={`driver-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Menu do motorista">
            <div className="driver-sidebar__brand">
              <div className="driver-sidebar__logo"><CarFront size={15} /></div>
              <strong>DriverPro</strong>
            </div>

            <div className="driver-sidebar__menu">
              {dashboardMenu.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`driver-sidebar__item${activeMenu === item.label ? ' is-active' : ''}`}
                  onClick={() => handleMenuClick(item.label)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="driver-sidebar__divider" />

            <div className="driver-sidebar__menu driver-sidebar__menu--secondary">
              <button
                type="button"
                className={`driver-sidebar__item${activeMenu === 'Ajuda' ? ' is-active' : ''}`}
                onClick={() => handleMenuClick('Ajuda')}
              >
                <span><CircleHelp size={14} /></span>
                <span>Ajuda</span>
              </button>
            </div>

              <button type="button" className="driver-sidebar__profile">
              <div className="driver-sidebar__avatar">
                {driverPhoto ? <img src={driverPhoto} alt={`Foto de ${driverName}`} /> : driverInitials}
              </div>
              <div>
                <strong>{driverName}</strong>
                <span>Link: {publicBookingPath}</span>
              </div>
              <i><ChevronDown size={14} /></i>
            </button>
          </aside>

          <div className="driver-main">
            <header className="driver-topbar">
              <div className="driver-topbar__title">
                <button type="button" className="driver-topbar__menu-btn" onClick={() => setSidebarOpen(true)}><Menu size={16} /></button>
                <h3>{menuTitle}</h3>
              </div>

              <div className="driver-topbar__actions">
                <button
                  type="button"
                  className={`driver-status-pill${isOnline ? '' : ' is-offline'}`}
                  onClick={() => setIsOnline((v) => !v)}
                  aria-pressed={isOnline}
                >
                  <div>
                    <small>Status</small>
                    <strong>{isOnline ? 'Online' : 'Offline'}</strong>
                  </div>
                  <span className="driver-status-pill__switch" aria-hidden="true">
                    <i />
                  </span>
                </button>
                <button type="button" className={`driver-bell${incomingRideAlert ? ' has-alert' : ''}`} aria-label="Notificacoes">
                  <Bell size={16} />
                  <em />
                </button>
              </div>
            </header>

            <div className="driver-content">
              <div className="driver-welcome">
                <div>
                  <h4>{greeting}, {firstName}!</h4>
                  <p>Aqui esta o resumo da sua atividade hoje em {driverDisplayCity}.</p>
                </div>
                <div className="driver-welcome__actions">
                  <button type="button" className="driver-btn driver-btn--primary" onClick={addRide}>
                    Nova Corrida
                  </button>
                </div>
              </div>

              {incomingRideAlert && (
                <section className="driver-alert" role="status" aria-live="polite">
                  <div>
                    <strong>Nova solicitacao de corrida</strong>
                    <p>
                      {incomingRideAlert.passengerName || 'Passageiro'}: {incomingRideAlert.origin || 'Origem'}
                      {' -> '}
                      {incomingRideAlert.destination || 'Destino'}
                    </p>
                    {(incomingRideAlert.tripDate || incomingRideAlert.tripTime) && (
                      <p>
                        Agendamento: {incomingRideAlert.tripDate || '--'} {incomingRideAlert.tripTime || ''}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={openChatFromAlert}>Abrir chat</button>
                </section>
              )}

              {showOverview && (
                <div className="driver-stats">
                  {statCards.map((stat) => (
                    <article className="driver-stat" key={stat.label}>
                      <div className={stat.iconClass} aria-hidden="true">{stat.icon}</div>
                      <p>{stat.label}</p>
                      <h5>{stat.value}</h5>
                      <div className="driver-stat__meta">
                        <span>{stat.badge}</span>
                        <small>{stat.hint}</small>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {showRides && (
                <>
                  <div className="driver-grid">
                    <section className="driver-panel driver-panel--list">
                    <div className="driver-panel__head">
                      <h5>Proximas Corridas</h5>
                      <button type="button">Ver todas</button>
                    </div>

                    <div className="driver-rides">
                      {loading && <p className="driver-rides__empty">Carregando corridas...</p>}
                      {!loading && rides.length === 0 && <p className="driver-rides__empty">Nenhuma corrida disponivel no momento.</p>}

                      {!loading && ridesWithComputedPrice.map((ride) => (
                        <article key={ride.id} className={`driver-ride-card${ride.status !== 'pending' ? ' is-muted' : ''}`}>
                          <div className="driver-ride-card__top">
                            <div className="driver-ride-card__passenger">
                              <div className={`driver-ride-card__avatar driver-ride-card__avatar--${ride.accent}`}>{ride.initials}</div>
                              <div>
                                <strong>{ride.passenger}</strong>
                                <small>* {ride.rating}</small>
                              </div>
                            </div>
                            <span className="driver-ride-card__price">{ride.computedPrice}</span>
                          </div>

                          <div className="driver-ride-card__route">
                            <div>
                              <p>Origem • {ride.pickupDistance}</p>
                              <span>{ride.pickup}</span>
                            </div>
                            <div>
                              <p>Destino • {ride.destinationTime}</p>
                              <span>{ride.destination}</span>
                            </div>
                          </div>

                          {ride.status === 'pending' ? (
                            <div className="driver-ride-card__actions">
                              <button type="button" className="driver-ride-card__accept" onClick={() => updateRideStatus(ride.id, 'accepted')}>Aceitar</button>
                              <button type="button" className="driver-ride-card__decline" onClick={() => updateRideStatus(ride.id, 'declined')}>Recusar</button>
                            </div>
                          ) : (
                            <div className="driver-ride-card__status">{rideStatusLabel(ride.status)}</div>
                          )}
                        </article>
                      ))}
                    </div>
                    </section>

                    {showMap && (
                      <section className="driver-panel driver-panel--map">
                      <div className="driver-map-badge">
                        <span className="driver-map-badge__dot" />
                        <div>
                          <strong>Localizacao em Tempo Real</strong>
                          <small>{isOnline ? driverDisplayCity : 'Status offline'}</small>
                        </div>
                      </div>

                      <div className="driver-map-controls">
                        <button type="button">L</button>
                        <button type="button">+</button>
                        <button type="button">-</button>
                      </div>

                      <div className={`driver-map${isOnline ? '' : ' is-offline'}`} aria-hidden="true">
                        <div className="driver-map__pin driver-map__pin--a" />
                        <div className="driver-map__pin driver-map__pin--b" />
                        <div className="driver-map__route" />
                      </div>
                      </section>
                    )}
                  </div>

                  {chatRide && (
                    <section className="driver-panel driver-chat-panel">
                      <div className="driver-panel__head">
                        <h5>Chat com {chatRide.passengerName || chatRide.passenger || 'Passageiro'}</h5>
                        <button type="button" onClick={() => setChatRide(null)}>Fechar</button>
                      </div>
                      <div className="driver-chat-panel__messages">
                        {driverChatMessages.length === 0 && <p className="driver-rides__empty">Sem mensagens ainda.</p>}
                        {driverChatMessages.map((message) => (
                          <p key={message.id} className={`driver-chat-panel__message driver-chat-panel__message--${message.sender}`}>
                            {message.text}
                          </p>
                        ))}
                      </div>
                      <form className="driver-chat-panel__form" onSubmit={sendDriverMessage}>
                        <input
                          type="text"
                          placeholder="Digite para o passageiro..."
                          value={driverMessage}
                          onChange={(e) => setDriverMessage(e.target.value)}
                        />
                        <button type="submit">Enviar</button>
                      </form>
                    </section>
                  )}
                </>
              )}

              {(showTariffs || showLink) && (
                <div className="driver-settings-grid">
                  {showTariffs && (
                    <section className="driver-panel">
                      <div className="driver-panel__head">
                        <h5>Configuracoes de Tarifas</h5>
                        <button type="button" className="driver-panel__save" onClick={saveTariffs}>
                          {savedMessage || 'Salvar Alteracoes'}
                        </button>
                      </div>
                      <div className="driver-tariffs">
                        {!isTariffsEnabled && (
                          <p className="driver-signup__error">
                            Funcao de tarifas desativada pelo Admin Trader. Edicao temporariamente bloqueada.
                          </p>
                        )}
                        <label>
                          <span>Valor por KM (R$)</span>
                          <div><b>R$</b><input type="text" value={tariffs.perKm} onChange={(e) => handleTariffChange('perKm', e.target.value)} onBlur={(e) => handleTariffChange('perKm', formatBrazilianDecimal(parseBrazilianCurrencyInput(e.target.value)))} /></div>
                        </label>
                        <label>
                          <span>Valor por Minuto (R$)</span>
                          <div><b>R$</b><input type="text" value={tariffs.perMinute} onChange={(e) => handleTariffChange('perMinute', e.target.value)} onBlur={(e) => handleTariffChange('perMinute', formatBrazilianDecimal(parseBrazilianCurrencyInput(e.target.value)))} /></div>
                        </label>
                        <label>
                          <span>Taxa de Deslocamento (R$)</span>
                          <div><b>R$</b><input type="text" value={tariffs.displacementFee} onChange={(e) => handleTariffChange('displacementFee', e.target.value)} onBlur={(e) => handleTariffChange('displacementFee', formatBrazilianDecimal(parseBrazilianCurrencyInput(e.target.value)))} /></div>
                        </label>
                      </div>
                    </section>
                  )}

                  <section className="driver-panel driver-share-panel">
                    <div className="driver-panel__head">
                      <h5>Link e QR Code</h5>
                    </div>
                    <div className="driver-share-panel__content">
                      <p>Compartilhe com passageiros para abrir solicitacao direta.</p>
                      <div className="driver-share-panel__row">
                        <input type="text" value={publicBookingLink} readOnly />
                        <button type="button" className="driver-panel__save" onClick={copyPassengerLink}>
                          {copyMessage || 'Copiar link'}
                        </button>
                      </div>
                      <div className="driver-share-panel__meta">
                        <a href={publicBookingPath} target="_blank" rel="noreferrer">
                          Abrir pagina publica
                        </a>
                        <small>{publicBookingPath}</small>
                      </div>
                      <div className="driver-share-panel__qr">
                        <img src={qrCodeUrl} alt="QR code do link de solicitacao" loading="lazy" />
                        <small>Escaneie para acessar direto.</small>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {activeMenu === 'Ganhos' && (
                <section className="driver-panel driver-panel--info">
                  <div className="driver-panel__head"><h5>Ganhos</h5></div>
                  <div className="driver-panel__body-text">Os valores das corridas sao recalculados a partir das tarifas configuradas. Ajuste as tarifas e salve para atualizar as estimativas.</div>
                </section>
              )}

              {showRatings && (
                <section className="driver-panel driver-panel--info">
                  <div className="driver-panel__head"><h5>Avaliacoes</h5></div>
                  <div className="driver-panel__body-text">Avaliacao media atual: <strong>4.95</strong>. Continue mantendo boa taxa de aceitacao e atendimento.</div>
                </section>
              )}

              {showHelp && (
                <section className="driver-panel driver-panel--info">
                  <div className="driver-panel__head"><h5>Ajuda</h5></div>
                  <div className="driver-support-chat">
                    <div className="driver-support-chat__messages">
                      {supportMessages.map((message) => (
                        <p key={message.id} className={`driver-support-chat__message driver-support-chat__message--${message.sender}`}>
                          {message.text}
                        </p>
                      ))}
                    </div>
                    <form className="driver-support-chat__form" onSubmit={sendSupportMessage}>
                      <textarea
                        rows={3}
                        placeholder="Escreva aqui para conversar com o suporte..."
                        value={supportDraft}
                        onChange={(e) => setSupportDraft(e.target.value)}
                      />
                      <button type="submit">Enviar para suporte</button>
                    </form>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default DriverDashboardDemoPage
