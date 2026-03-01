import express from 'express'
import cors from 'cors'
import crypto from 'crypto'

const app = express()
const PORT = Number(process.env.PORT) || 3001
const SERVICE_NAME = 'Aplayplay-backend'

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@aplayplay.com').toLowerCase()
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '123456')
const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const sessions = new Map()
const drivers = []
const passengers = []
const rides = []
const chatsByRide = new Map()

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true)
      return
    }
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin not allowed by CORS'))
  },
}))
app.use(express.json())

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createToken() {
  return crypto.randomBytes(24).toString('hex')
}

function authRequired(req, res, next) {
  const raw = req.headers.authorization || ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'Token ausente.' })
    return
  }
  const session = sessions.get(token)
  if (!session) {
    res.status(401).json({ error: 'Sessao invalida.' })
    return
  }
  req.session = session
  req.token = token
  next()
}

function adminRequired(req, res, next) {
  if (req.session?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito ao admin.' })
    return
  }
  next()
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    now: new Date().toISOString(),
    version: '1.0.0',
  })
})

app.post('/api/auth/admin/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()
  if (!email || !password) {
    res.status(400).json({ error: 'Informe e-mail e senha.' })
    return
  }
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }
  const token = createToken()
  const session = { role: 'admin', email, loginAt: new Date().toISOString() }
  sessions.set(token, session)
  res.json({ token, user: session })
})

app.post('/api/auth/logout', authRequired, (req, res) => {
  sessions.delete(req.token)
  res.json({ ok: true })
})

app.get('/api/admin/me', authRequired, adminRequired, (req, res) => {
  res.json({ user: req.session })
})

app.get('/api/admin/drivers', authRequired, adminRequired, (_req, res) => {
  res.json({ drivers })
})

app.patch('/api/admin/drivers/:id', authRequired, adminRequired, (req, res) => {
  const id = String(req.params.id || '')
  const driver = drivers.find((item) => String(item.id) === id)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }

  const patch = req.body || {}
  if (typeof patch.isActive === 'boolean') driver.isActive = patch.isActive
  if (typeof patch.tariffsEnabled === 'boolean') driver.tariffsEnabled = patch.tariffsEnabled
  if (patch.tariffs && typeof patch.tariffs === 'object') {
    driver.tariffs = {
      perKm: String(patch.tariffs.perKm || driver.tariffs?.perKm || '3,80'),
      perMinute: String(patch.tariffs.perMinute || driver.tariffs?.perMinute || '0,55'),
      displacementFee: String(patch.tariffs.displacementFee || driver.tariffs?.displacementFee || '5,00'),
    }
  }
  driver.updatedAt = new Date().toISOString()
  res.json({ driver })
})

app.get('/api/admin/passengers', authRequired, adminRequired, (_req, res) => {
  res.json({ passengers })
})

app.patch('/api/admin/passengers/:id/status', authRequired, adminRequired, (req, res) => {
  const id = String(req.params.id || '')
  const nextStatus = String(req.body?.status || '').trim()
  const accepted = ['active', 'pending', 'inactive']
  if (!accepted.includes(nextStatus)) {
    res.status(400).json({ error: 'Status invalido.' })
    return
  }
  const passenger = passengers.find((item) => String(item.id) === id)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado.' })
    return
  }
  passenger.status = nextStatus
  passenger.updatedAt = new Date().toISOString()
  res.json({ passenger })
})

app.delete('/api/admin/passengers/:id', authRequired, adminRequired, (req, res) => {
  const id = String(req.params.id || '')
  const index = passengers.findIndex((item) => String(item.id) === id)
  if (index < 0) {
    res.status(404).json({ error: 'Passageiro nao encontrado.' })
    return
  }
  passengers.splice(index, 1)
  res.json({ ok: true })
})

app.post('/api/drivers/signup', (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = String(req.body?.phone || '').trim()
  const vehicleModel = String(req.body?.vehicleModel || '').trim()
  const vehicleYear = String(req.body?.vehicleYear || '').trim()
  const vehiclePlate = String(req.body?.vehiclePlate || '').trim().toUpperCase()
  const vehicleCategory = String(req.body?.vehicleCategory || 'Particular').trim()
  const city = String(req.body?.city || 'Fortaleza, CE').trim()

  if (!fullName || !email || !phone || !vehicleModel || !vehicleYear || !vehiclePlate) {
    res.status(400).json({ error: 'Campos obrigatorios faltando no cadastro do motorista.' })
    return
  }
  if (drivers.some((driver) => driver.email === email)) {
    res.status(409).json({ error: 'Ja existe motorista com esse e-mail.' })
    return
  }

  const created = {
    id: `DRV-${Date.now()}`,
    fullName,
    email,
    phone,
    city,
    vehicleModel,
    vehicleYear,
    vehiclePlate,
    vehicleCategory,
    slug: slugify(fullName) || `motorista-${Date.now()}`,
    isActive: true,
    tariffsEnabled: true,
    tariffs: { perKm: '3,80', perMinute: '0,55', displacementFee: '5,00' },
    createdAt: new Date().toISOString(),
  }

  drivers.unshift(created)
  res.status(201).json({ driver: created })
})

app.post('/api/drivers/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email) {
    res.status(400).json({ error: 'Informe o e-mail do motorista.' })
    return
  }
  const driver = drivers.find((item) => item.email === email)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  res.json({ driver })
})

app.get('/api/drivers/:slug/public', (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase()
  const driver = drivers.find((item) => item.slug === slug)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  res.json({
    driver: {
      fullName: driver.fullName,
      vehicleModel: driver.vehicleModel,
      vehiclePlate: driver.vehiclePlate,
      vehicleCategory: driver.vehicleCategory,
      city: driver.city,
      slug: driver.slug,
    },
  })
})

app.post('/api/passengers/signup', (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()
  const phone = String(req.body?.phone || '').trim()
  const address = String(req.body?.address || '').trim()
  const driverSlug = String(req.body?.driverSlug || '').trim().toLowerCase()

  if (!driverSlug) {
    res.status(400).json({ error: 'Cadastro de passageiro permitido apenas via link/QR do motorista.' })
    return
  }
  if (!fullName || !email || !password || !phone || !address) {
    res.status(400).json({ error: 'Campos obrigatorios faltando no cadastro do passageiro.' })
    return
  }
  if (passengers.some((item) => item.email === email)) {
    res.status(409).json({ error: 'Ja existe passageiro com esse e-mail.' })
    return
  }

  const created = {
    id: `PS-${Date.now()}`,
    fullName,
    email,
    password,
    phone,
    address,
    status: 'active',
    createdAt: new Date().toISOString(),
    driverSlug,
  }

  passengers.unshift(created)
  res.status(201).json({ passenger: created })
})

app.post('/api/passengers/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()
  const passenger = passengers.find((item) => item.email === email && item.password === password)
  if (!passenger) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }
  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)
  res.json({ token, passenger })
})

app.post('/api/rides', (req, res) => {
  const ride = {
    id: Date.now(),
    passengerName: String(req.body?.passengerName || 'Passageiro'),
    passengerEmail: String(req.body?.passengerEmail || ''),
    driverName: String(req.body?.driverName || 'Motorista'),
    origin: String(req.body?.origin || ''),
    destination: String(req.body?.destination || ''),
    pickupDistance: String(req.body?.pickupDistance || ''),
    destinationTime: String(req.body?.destinationTime || ''),
    tripDate: String(req.body?.tripDate || ''),
    tripTime: String(req.body?.tripTime || ''),
    estimatedFare: Number(req.body?.estimatedFare || 0),
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  rides.unshift(ride)
  res.status(201).json({ ride })
})

app.get('/api/rides', (_req, res) => {
  res.json({ rides })
})

app.patch('/api/rides/:id/status', (req, res) => {
  const id = Number(req.params.id)
  const nextStatus = String(req.body?.status || '').trim()
  const accepted = ['pending', 'accepted', 'declined', 'canceled']
  if (!accepted.includes(nextStatus)) {
    res.status(400).json({ error: 'Status invalido.' })
    return
  }
  const ride = rides.find((item) => Number(item.id) === id)
  if (!ride) {
    res.status(404).json({ error: 'Corrida nao encontrada.' })
    return
  }
  ride.status = nextStatus
  ride.updatedAt = new Date().toISOString()
  res.json({ ride })
})

app.get('/api/chat/:rideId/messages', (req, res) => {
  const rideId = String(req.params.rideId)
  res.json({ messages: chatsByRide.get(rideId) || [] })
})

app.post('/api/chat/:rideId/messages', (req, res) => {
  const rideId = String(req.params.rideId)
  const sender = String(req.body?.sender || '').trim()
  const text = String(req.body?.text || '').trim()
  if (!sender || !text) {
    res.status(400).json({ error: 'Mensagem invalida.' })
    return
  }
  const current = chatsByRide.get(rideId) || []
  const message = {
    id: `${rideId}-${Date.now()}`,
    sender,
    text,
    createdAt: new Date().toISOString(),
  }
  chatsByRide.set(rideId, [...current, message])
  res.status(201).json({ message })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno no servidor.' })
})

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} running on http://localhost:${PORT}`)
})
