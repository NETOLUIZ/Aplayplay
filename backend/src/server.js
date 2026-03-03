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
const passengerDriverLinks = []
const rides = []
const chatsByRide = new Map()
const verificationCodes = new Map()

const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS || 10 * 60 * 1000)
const WHATSAPP_PROVIDER = String(process.env.WHATSAPP_PROVIDER || 'demo').trim().toLowerCase()
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim()
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim()
const TWILIO_WHATSAPP_FROM = String(process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886').trim()

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

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function createToken() {
  return crypto.randomBytes(24).toString('hex')
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function maskPhone(phone) {
  const digits = normalizePhone(phone)
  if (digits.length < 4) return digits
  return `${digits.slice(0, 2)}*****${digits.slice(-2)}`
}

function verificationKey(role, phone) {
  return `${String(role || '').trim().toLowerCase()}:${normalizePhone(phone)}`
}

function consumeVerificationCode(role, phone, code) {
  const normalizedRole = String(role || '').trim().toLowerCase()
  const normalizedPhone = normalizePhone(phone)
  const normalizedCode = String(code || '').trim()
  const key = verificationKey(normalizedRole, normalizedPhone)
  const entry = verificationCodes.get(key)
  if (!entry) {
    return { ok: false, reason: 'not_found' }
  }
  if (Date.now() > Number(entry.expiresAt || 0)) {
    verificationCodes.delete(key)
    return { ok: false, reason: 'expired' }
  }
  if (String(entry.code || '') !== normalizedCode) {
    return { ok: false, reason: 'invalid' }
  }
  verificationCodes.delete(key)
  return { ok: true }
}

function verificationErrorMessage(reason) {
  if (reason === 'expired') return 'Codigo expirado. Solicite um novo codigo no WhatsApp.'
  if (reason === 'invalid') return 'Codigo de verificacao invalido.'
  return 'Solicite o codigo de verificacao antes de concluir o cadastro.'
}

async function sendVerificationCodeByTwilio({ phone, code, role }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    throw new Error('Twilio WhatsApp nao configurado no ambiente.')
  }

  const to = `whatsapp:+55${normalizePhone(phone)}`
  const body = [
    'Aplayplay - Codigo de verificacao',
    `Codigo: ${code}`,
    `Perfil: ${role === 'driver' ? 'Motorista' : 'Passageiro'}`,
    `Validade: ${Math.floor(VERIFICATION_CODE_TTL_MS / 60000)} min`,
    'Nao compartilhe este codigo.',
  ].join('\n')

  const payload = new URLSearchParams()
  payload.set('From', TWILIO_WHATSAPP_FROM)
  payload.set('To', to)
  payload.set('Body', body)

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || 'Falha ao enviar codigo no WhatsApp via Twilio.')
  }

  const result = await response.json()
  return {
    sid: result?.sid || null,
    status: result?.status || null,
  }
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

function passengerRequired(req, res, next) {
  if (req.session?.role !== 'passenger') {
    res.status(403).json({ error: 'Acesso restrito ao passageiro autenticado.' })
    return
  }
  next()
}

function findPassengerBySession(session) {
  const passengerId = String(session?.id || '')
  if (passengerId) {
    const byId = passengers.find((item) => String(item.id) === passengerId)
    if (byId) return byId
  }
  const email = String(session?.email || '').trim().toLowerCase()
  if (email) return passengers.find((item) => String(item.email || '').trim().toLowerCase() === email)
  return null
}

function findDriverByIdentifier(identifier) {
  const value = String(identifier || '').trim().toLowerCase()
  if (!value) return null
  return drivers.find((item) => (
    String(item.id || '').trim().toLowerCase() === value
    || String(item.slug || '').trim().toLowerCase() === value
  )) || null
}

function linkPassengerToDriver(passengerId, driverId) {
  const pid = String(passengerId || '').trim()
  const did = String(driverId || '').trim()
  if (!pid || !did) return null
  const existing = passengerDriverLinks.find((link) => (
    String(link.passengerId) === pid && String(link.driverId) === did
  ))
  if (existing) return existing
  const created = {
    id: `PM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    passengerId: pid,
    driverId: did,
    createdAt: new Date().toISOString(),
  }
  passengerDriverLinks.unshift(created)
  return created
}

function listPassengerDrivers(passengerId) {
  const pid = String(passengerId || '').trim()
  if (!pid) return []
  const linkedIds = passengerDriverLinks
    .filter((link) => String(link.passengerId) === pid)
    .map((link) => String(link.driverId))
  return drivers.filter((driver) => linkedIds.includes(String(driver.id)))
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    now: new Date().toISOString(),
    version: '1.0.0',
  })
})

app.post('/api/verification/send', (req, res) => {
  const role = String(req.body?.role || '').trim().toLowerCase()
  const phone = normalizePhone(req.body?.phone)

  if (!['driver', 'passenger'].includes(role)) {
    res.status(400).json({ error: 'Tipo de verificacao invalido.' })
    return
  }
  if (!phone || phone.length < 10) {
    res.status(400).json({ error: 'Informe um WhatsApp valido para receber o codigo.' })
    return
  }

  const code = createVerificationCode()
  const key = verificationKey(role, phone)
  const expiresAt = Date.now() + VERIFICATION_CODE_TTL_MS
  verificationCodes.set(key, {
    role,
    phone,
    code,
    sentAt: new Date().toISOString(),
    expiresAt,
  })

  const respond = (providerMeta = null) => {
    res.json({
      ok: true,
      channel: 'whatsapp',
      provider: WHATSAPP_PROVIDER,
      phoneMasked: maskPhone(phone),
      expiresInSeconds: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
      demoCode: WHATSAPP_PROVIDER === 'demo' ? code : undefined,
      providerMeta,
      message: 'Codigo enviado para seu WhatsApp.',
    })
  }

  if (WHATSAPP_PROVIDER === 'demo') {
    console.log(`[verification-demo] role=${role} phone=${phone} code=${code}`)
    respond()
    return
  }

  if (WHATSAPP_PROVIDER === 'twilio') {
    sendVerificationCodeByTwilio({ phone, code, role })
      .then((providerMeta) => respond(providerMeta))
      .catch((error) => {
        console.error(error)
        res.status(500).json({ error: 'Falha ao enviar codigo via WhatsApp. Verifique configuracao do Twilio.' })
      })
    return
  }

  res.status(400).json({ error: 'Provedor de WhatsApp invalido. Use "demo" ou "twilio".' })
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
  if (typeof patch.password === 'string' && patch.password.trim()) {
    driver.password = patch.password.trim()
  }
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

app.delete('/api/admin/drivers/:id', authRequired, adminRequired, (req, res) => {
  const id = String(req.params.id || '')
  const index = drivers.findIndex((item) => String(item.id) === id)
  if (index < 0) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  drivers.splice(index, 1)
  res.json({ ok: true })
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
  const verificationCode = String(req.body?.verificationCode || req.body?.code || '').trim()

  if (!fullName || !email || !phone || !vehicleModel || !vehicleYear || !vehiclePlate) {
    res.status(400).json({ error: 'Campos obrigatorios faltando no cadastro do motorista.' })
    return
  }
  if (drivers.some((driver) => driver.email === email)) {
    res.status(409).json({ error: 'Ja existe motorista com esse e-mail.' })
    return
  }
  const verificationResult = consumeVerificationCode('driver', phone, verificationCode)
  if (!verificationResult.ok) {
    res.status(400).json({ error: verificationErrorMessage(verificationResult.reason) })
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
    phoneVerifiedAt: new Date().toISOString(),
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
      tariffsEnabled: driver.tariffsEnabled !== false,
      tariffs: {
        perKm: String(driver?.tariffs?.perKm || '3,80'),
        perMinute: String(driver?.tariffs?.perMinute || '0,55'),
        displacementFee: String(driver?.tariffs?.displacementFee || '5,00'),
      },
    },
  })
})

app.post('/api/passengers/signup', (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()
  const phone = normalizePhone(req.body?.phone)
  const address = String(req.body?.address || '').trim()
  const driverSlug = String(req.body?.driverSlug || '').trim().toLowerCase()
  const verificationCode = String(req.body?.verificationCode || req.body?.code || '').trim()

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
  if (phone && passengers.some((item) => normalizePhone(item.phone) === phone)) {
    res.status(409).json({ error: 'Ja existe passageiro com esse telefone.' })
    return
  }

  const driver = findDriverByIdentifier(driverSlug)
  if (!driver) {
    res.status(404).json({ error: 'Motorista do QR/link nao encontrado.' })
    return
  }
  const verificationResult = consumeVerificationCode('passenger', phone, verificationCode)
  if (!verificationResult.ok) {
    res.status(400).json({ error: verificationErrorMessage(verificationResult.reason) })
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
    phoneVerifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    driverSlug: driver.slug,
  }

  passengers.unshift(created)
  linkPassengerToDriver(created.id, driver.id)

  const token = createToken()
  const session = { role: 'passenger', email: created.email, id: created.id }
  sessions.set(token, session)
  res.status(201).json({ token, passenger: created, linkedDriver: { id: driver.id, slug: driver.slug, fullName: driver.fullName } })
})

app.post('/api/passengers/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = normalizePhone(req.body?.phone)
  const password = String(req.body?.password || '').trim()
  const passenger = passengers.find((item) => (
    item.password === password
    && (
      (email && String(item.email || '').trim().toLowerCase() === email)
      || (phone && normalizePhone(item.phone) === phone)
    )
  ))
  if (!passenger) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }
  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)
  const linkedDrivers = listPassengerDrivers(passenger.id).map((driver) => ({
    id: driver.id,
    slug: driver.slug,
    fullName: driver.fullName,
    whatsapp: driver.phone,
    city: driver.city,
    vehicleModel: driver.vehicleModel,
  }))
  res.json({ token, passenger, linkedDrivers })
})

app.post('/api/auth/register', (req, res) => {
  const fullName = String(req.body?.nome || req.body?.fullName || '').trim()
  const phone = normalizePhone(req.body?.telefone || req.body?.phone)
  const password = String(req.body?.senha || req.body?.password || '').trim()
  const address = String(req.body?.address || '').trim()
  const driverIdentifier = String(
    req.body?.motoristaId
    || req.body?.driverId
    || req.body?.driverSlug
    || '',
  ).trim().toLowerCase()
  const email = String(req.body?.email || `${String(phone).replace(/\D/g, '')}@passageiro.local`).trim().toLowerCase()
  const verificationCode = String(req.body?.verificationCode || req.body?.code || '').trim()

  if (!driverIdentifier) {
    res.status(400).json({ error: 'Primeiro cadastro do passageiro deve ser pelo QR/link do motorista.' })
    return
  }
  if (!fullName || !phone || !password) {
    res.status(400).json({ error: 'Informe nome, telefone e senha para cadastrar.' })
    return
  }
  let passenger = passengers.find((item) => String(item.phone || '').trim() === phone)
  if (!passenger) {
    passenger = {
      id: `PS-${Date.now()}`,
      fullName,
      email,
      password,
      phone,
      address,
      status: 'active',
      phoneVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      driverSlug: '',
    }
    passengers.unshift(passenger)
  }

  const driver = findDriverByIdentifier(driverIdentifier)
  if (!driver) {
    res.status(404).json({ error: 'Motorista do link nao encontrado.' })
    return
  }
  const verificationResult = consumeVerificationCode('passenger', phone, verificationCode)
  if (!verificationResult.ok) {
    res.status(400).json({ error: verificationErrorMessage(verificationResult.reason) })
    return
  }
  linkPassengerToDriver(passenger.id, driver.id)
  passenger.driverSlug = passenger.driverSlug || driver.slug

  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)

  res.status(201).json({
    token,
    passenger,
    linkedDriver: { id: driver.id, slug: driver.slug, fullName: driver.fullName },
  })
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = normalizePhone(req.body?.telefone || req.body?.phone)
  const password = String(req.body?.senha || req.body?.password || '').trim()

  if (!password || (!email && !phone)) {
    res.status(400).json({ error: 'Informe telefone (ou e-mail) e senha.' })
    return
  }

  const passenger = passengers.find((item) => (
    item.password === password
    && (
      (email && String(item.email || '').trim().toLowerCase() === email)
      || (phone && normalizePhone(item.phone) === phone)
    )
  ))
  if (!passenger) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }

  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)

  const linkedDrivers = listPassengerDrivers(passenger.id).map((driver) => ({
    id: driver.id,
    slug: driver.slug,
    fullName: driver.fullName,
    whatsapp: driver.phone,
    city: driver.city,
    vehicleModel: driver.vehicleModel,
    vehiclePlate: driver.vehiclePlate,
  }))
  res.json({ token, passenger, linkedDrivers })
})

app.get('/api/passengers/me/drivers', authRequired, passengerRequired, (req, res) => {
  const passenger = findPassengerBySession(req.session)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado na sessao.' })
    return
  }
  const linkedDrivers = listPassengerDrivers(passenger.id).map((driver) => ({
    id: driver.id,
    slug: driver.slug,
    fullName: driver.fullName,
    whatsapp: driver.phone,
    city: driver.city,
    vehicleModel: driver.vehicleModel,
    vehiclePlate: driver.vehiclePlate,
    tariffsEnabled: driver.tariffsEnabled !== false,
    tariffs: {
      perKm: String(driver?.tariffs?.perKm || '3,80'),
      perMinute: String(driver?.tariffs?.perMinute || '0,55'),
      displacementFee: String(driver?.tariffs?.displacementFee || '5,00'),
    },
  }))
  res.json({ drivers: linkedDrivers })
})

app.post('/api/passengers/me/drivers', authRequired, passengerRequired, (req, res) => {
  const passenger = findPassengerBySession(req.session)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado na sessao.' })
    return
  }
  const identifier = String(req.body?.motoristaId || req.body?.driverId || req.body?.driverSlug || '').trim()
  if (!identifier) {
    res.status(400).json({ error: 'Informe o identificador do motorista para vincular.' })
    return
  }
  const driver = findDriverByIdentifier(identifier)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  const link = linkPassengerToDriver(passenger.id, driver.id)
  passenger.driverSlug = passenger.driverSlug || driver.slug
  res.status(201).json({
    link,
    driver: {
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      whatsapp: driver.phone,
      city: driver.city,
    },
  })
})

app.post('/api/rides', (req, res) => {
  const passengerTokenRaw = String(req.headers.authorization || '')
  const passengerToken = passengerTokenRaw.startsWith('Bearer ') ? passengerTokenRaw.slice(7) : ''
  const passengerSession = passengerToken ? sessions.get(passengerToken) : null
  const requestedDriverSlug = String(req.body?.driverSlug || '').trim().toLowerCase()

  if (requestedDriverSlug && passengerSession?.role !== 'passenger') {
    res.status(401).json({ error: 'Login de passageiro obrigatorio para solicitar corrida.' })
    return
  }

  if (passengerSession?.role === 'passenger') {
    const passenger = findPassengerBySession(passengerSession)
    if (!passenger) {
      res.status(401).json({ error: 'Passageiro da sessao nao encontrado.' })
      return
    }
    const linkedDrivers = listPassengerDrivers(passenger.id)
    const hasAccess = linkedDrivers.some((driver) => (
      String(driver.slug || '').trim().toLowerCase() === requestedDriverSlug
      || String(driver.id || '').trim().toLowerCase() === requestedDriverSlug
    ))
    if (!hasAccess) {
      res.status(403).json({ error: 'Passageiro sem vinculo com este motorista.' })
      return
    }
  }

  const ride = {
    id: Date.now(),
    passengerName: String(req.body?.passengerName || 'Passageiro'),
    passengerEmail: String(req.body?.passengerEmail || ''),
    driverSlug: requestedDriverSlug || '',
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
