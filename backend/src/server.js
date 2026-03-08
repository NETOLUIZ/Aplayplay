import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { Pool } from 'pg'

const app = express()
const PORT = Number(process.env.PORT) || 3001
const SERVICE_NAME = 'Aplayplay-backend'

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@aplayplay.com').toLowerCase()
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '123456')
const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS || 10 * 60 * 1000)
const WHATSAPP_PROVIDER = String(process.env.WHATSAPP_PROVIDER || 'demo').trim().toLowerCase()
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim()
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim()
const TWILIO_WHATSAPP_FROM = String(process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886').trim()

const sessions = new Map()
const verificationCodes = new Map()
const chatsByRide = new Map()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente. Configure o Postgres antes de iniciar.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
})

const ensureSchemaSQL = `
  create table if not exists drivers (
    id text primary key,
    full_name text not null,
    email text unique not null,
    phone text,
    city text,
    vehicle_model text,
    vehicle_year text,
    vehicle_plate text,
    vehicle_category text,
    slug text unique,
    is_active boolean default true,
    tariffs_enabled boolean default true,
    tariffs jsonb default '{"perKm":"3,80","perMinute":"0,55","displacementFee":"5,00"}',
    password text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create table if not exists passengers (
    id text primary key,
    full_name text not null,
    email text unique not null,
    password text not null,
    phone text unique,
    address text,
    status text default 'active',
    driver_slug text,
    phone_verified_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create table if not exists passenger_driver_links (
    id text primary key,
    passenger_id text references passengers(id) on delete cascade,
    driver_id text references drivers(id) on delete cascade,
    created_at timestamptz default now(),
    unique(passenger_id, driver_id)
  );

  create table if not exists rides (
    id text primary key,
    passenger_email text,
    passenger_name text,
    driver_id text references drivers(id),
    driver_slug text,
    origin text,
    destination text,
    pickup_distance text,
    destination_time text,
    distance_km numeric,
    duration_min numeric,
    trip_date text,
    trip_time text,
    estimated_fare numeric,
    estimated_price text,
    status text default 'pending',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create index if not exists idx_drivers_slug on drivers(slug);
  create index if not exists idx_passengers_driver_slug on passengers(driver_slug);
  create index if not exists idx_rides_driver on rides(driver_id);
`

await pool.query(ensureSchemaSQL).then(() => {
  console.log('Database schema ready')
}).catch((error) => {
  console.error('Failed to init database', error)
  process.exit(1)
})

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

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2)
  }
  if (digits.length > 11) {
    digits = digits.slice(-11)
  }
  if (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.slice(1)
  }
  return digits
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

function mapDriver(row) {
  if (!row) return null
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehiclePlate: row.vehicle_plate,
    vehicleCategory: row.vehicle_category,
    slug: row.slug,
    isActive: row.is_active,
    tariffsEnabled: row.tariffs_enabled,
    tariffs: row.tariffs,
    password: row.password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPassenger(row) {
  if (!row) return null
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    password: row.password,
    phone: row.phone,
    address: row.address,
    status: row.status,
    driverSlug: row.driver_slug,
    phoneVerifiedAt: row.phone_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRide(row) {
  if (!row) return null
  return {
    id: row.id,
    passengerEmail: row.passenger_email,
    passengerName: row.passenger_name,
    driverId: row.driver_id,
    driverSlug: row.driver_slug,
    origin: row.origin,
    destination: row.destination,
    pickupDistance: row.pickup_distance,
    destinationTime: row.destination_time,
    distanceKm: Number(row.distance_km || 0),
    durationMin: Number(row.duration_min || 0),
    tripDate: row.trip_date,
    tripTime: row.trip_time,
    estimatedFare: row.estimated_fare ? Number(row.estimated_fare) : 0,
    estimatedPrice: row.estimated_price,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function driverSlugExists(slug) {
  const { rowCount } = await pool.query('select 1 from drivers where slug = $1 limit 1', [slug])
  return rowCount > 0
}

async function buildDriverSlug(fullName) {
  const base = slugify(fullName) || `motorista-${Date.now()}`
  let candidate = base
  let attempt = 1
  while (await driverSlugExists(candidate)) {
    candidate = `${base}-${attempt}`
    attempt += 1
  }
  return candidate
}

async function createDriver(data) {
  const slug = await buildDriverSlug(data.fullName)
  const id = `DRV-${Date.now()}`
  const tariffs = data.tariffs || { perKm: '3,80', perMinute: '0,55', displacementFee: '5,00' }
  const { rows } = await pool.query(
    `insert into drivers (
      id, full_name, email, phone, city, vehicle_model, vehicle_year, vehicle_plate,
      vehicle_category, slug, is_active, tariffs_enabled, tariffs, created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,$11,now(),now()
    ) returning *`,
    [
      id,
      data.fullName,
      data.email.toLowerCase(),
      normalizePhone(data.phone),
      data.city || '',
      data.vehicleModel || '',
      data.vehicleYear || '',
      data.vehiclePlate || '',
      data.vehicleCategory || '',
      slug,
      tariffs,
    ],
  )
  return mapDriver(rows[0])
}

async function getDriverByIdentifier(identifier) {
  const value = String(identifier || '').trim().toLowerCase()
  if (!value) return null
  const { rows } = await pool.query(
    `select * from drivers where lower(id) = $1 or lower(slug) = $1 or lower(email) = $1 limit 1`,
    [value],
  )
  return mapDriver(rows[0])
}

async function listDrivers() {
  const { rows } = await pool.query('select * from drivers order by created_at desc')
  return rows.map(mapDriver)
}

async function updateDriver(id, patch) {
  const fields = []
  const values = []
  let idx = 1
  if (typeof patch.isActive === 'boolean') {
    fields.push(`is_active = $${idx++}`)
    values.push(patch.isActive)
  }
  if (typeof patch.tariffsEnabled === 'boolean') {
    fields.push(`tariffs_enabled = $${idx++}`)
    values.push(patch.tariffsEnabled)
  }
  if (patch.password) {
    fields.push(`password = $${idx++}`)
    values.push(patch.password.trim())
  }
  if (patch.tariffs) {
    fields.push(`tariffs = $${idx++}`)
    values.push(patch.tariffs)
  }
  if (fields.length === 0) return await getDriverByIdentifier(id)
  fields.push(`updated_at = now()`)
  values.push(id)
  const { rows } = await pool.query(
    `update drivers set ${fields.join(', ')} where id = $${idx} returning *`,
    values,
  )
  return mapDriver(rows[0])
}

async function deleteDriver(id) {
  const { rowCount } = await pool.query('delete from drivers where id = $1', [id])
  return rowCount > 0
}

async function createPassenger(data) {
  const id = `PS-${Date.now()}`
  const { rows } = await pool.query(
    `insert into passengers (
      id, full_name, email, password, phone, address, status, driver_slug, phone_verified_at, created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,'active',$7,now(),now(),now()
    ) returning *`,
    [
      id,
      data.fullName,
      data.email.toLowerCase(),
      data.password,
      normalizePhone(data.phone),
      data.address || '',
      data.driverSlug || '',
    ],
  )
  return mapPassenger(rows[0])
}

async function getPassengerById(id) {
  const { rows } = await pool.query('select * from passengers where id = $1 limit 1', [id])
  return mapPassenger(rows[0])
}

async function getPassengerByEmail(email) {
  const { rows } = await pool.query('select * from passengers where lower(email) = $1 limit 1', [email.toLowerCase()])
  return mapPassenger(rows[0])
}

async function passengerExistsByPhone(phone) {
  const { rowCount } = await pool.query('select 1 from passengers where phone = $1 limit 1', [normalizePhone(phone)])
  return rowCount > 0
}

async function findPassengerByCredentials({ email, phone, password }) {
  const where = []
  const params = []
  let idx = 1
  if (email) {
    where.push(`lower(email) = $${idx++}`)
    params.push(email.toLowerCase())
  }
  if (phone) {
    where.push(`phone = $${idx++}`)
    params.push(normalizePhone(phone))
  }
  if (where.length === 0) return null
  params.push(password)
  const { rows } = await pool.query(
    `select * from passengers where (${where.join(' or ')}) and password = $${idx} limit 1`,
    params,
  )
  return mapPassenger(rows[0])
}

async function listPassengers() {
  const { rows } = await pool.query('select * from passengers order by created_at desc')
  return rows.map(mapPassenger)
}

async function updatePassengerStatus(id, status) {
  const { rows } = await pool.query(
    'update passengers set status = $1, updated_at = now() where id = $2 returning *',
    [status, id],
  )
  return mapPassenger(rows[0])
}

async function deletePassenger(id) {
  const { rowCount } = await pool.query('delete from passengers where id = $1', [id])
  return rowCount > 0
}

async function linkPassengerToDriver(passengerId, driverId) {
  const linkId = `PM-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  await pool.query(
    `insert into passenger_driver_links (id, passenger_id, driver_id)
     values ($1,$2,$3) on conflict do nothing`,
    [linkId, passengerId, driverId],
  )
}

async function listPassengerDrivers(passengerId) {
  const { rows } = await pool.query(
    `select d.* from passenger_driver_links l
     join drivers d on d.id = l.driver_id
     where l.passenger_id = $1
     order by l.created_at desc`,
    [passengerId],
  )
  return rows.map(mapDriver)
}

async function createRide(data, driver) {
  const id = `RIDE-${Date.now()}`
  const { rows } = await pool.query(
    `insert into rides (
      id, passenger_email, passenger_name, driver_id, driver_slug, origin, destination, pickup_distance,
      destination_time, distance_km, duration_min, trip_date, trip_time, estimated_fare, estimated_price,
      status, created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',now(),now()
    ) returning *`,
    [
      id,
      data.passengerEmail || '',
      data.passengerName || 'Passageiro',
      driver?.id || null,
      driver?.slug || null,
      data.origin || '',
      data.destination || '',
      data.pickupDistance || '',
      data.destinationTime || '',
      Number(data.distanceKm || 0),
      Number(data.durationMin || 0),
      data.tripDate || '',
      data.tripTime || '',
      Number(data.estimatedFare || 0),
      data.estimatedPrice || '',
    ],
  )
  return mapRide(rows[0])
}

async function listRides() {
  const { rows } = await pool.query('select * from rides order by created_at desc')
  return rows.map(mapRide)
}

async function updateRideStatus(id, status) {
  const { rows } = await pool.query(
    'update rides set status = $1, updated_at = now() where id = $2 returning *',
    [status, id],
  )
  return mapRide(rows[0])
}

async function findPassengerBySession(session) {
  if (!session) return null
  if (session.id) {
    const byId = await getPassengerById(session.id)
    if (byId) return byId
  }
  if (session.email) {
    return await getPassengerByEmail(session.email)
  }
  return null
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('select 1 as ok')
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    now: new Date().toISOString(),
    version: '1.1.0',
    db: rows[0]?.ok === 1 ? 'connected' : 'unknown',
  })
}))

app.post('/api/verification/send', asyncHandler((req, res) => {
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
}))

app.post('/api/auth/admin/login', asyncHandler((req, res) => {
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
}))

app.post('/api/auth/logout', asyncHandler((req, res) => {
  const raw = req.headers.authorization || ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : ''
  if (token) sessions.delete(token)
  res.json({ ok: true })
}))

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

app.get('/api/admin/me', authRequired, adminRequired, asyncHandler((req, res) => {
  res.json({ user: req.session })
}))

app.get('/api/admin/drivers', authRequired, adminRequired, asyncHandler(async (_req, res) => {
  res.json({ drivers: await listDrivers() })
}))

app.patch('/api/admin/drivers/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = decodeURIComponent(String(req.params.id || ''))
  const driver = await getDriverByIdentifier(id)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  const patch = req.body || {}
  const updated = await updateDriver(driver.id, patch)
  res.json({ driver: updated })
}))

app.delete('/api/admin/drivers/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = decodeURIComponent(String(req.params.id || ''))
  const ok = await deleteDriver(id)
  if (!ok) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  res.json({ ok: true })
}))

app.get('/api/admin/passengers', authRequired, adminRequired, asyncHandler(async (_req, res) => {
  res.json({ passengers: await listPassengers() })
}))

app.patch('/api/admin/passengers/:id/status', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  const nextStatus = String(req.body?.status || '').trim()
  const accepted = ['active', 'pending', 'inactive']
  if (!accepted.includes(nextStatus)) {
    res.status(400).json({ error: 'Status invalido.' })
    return
  }
  const passenger = await updatePassengerStatus(id, nextStatus)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado.' })
    return
  }
  res.json({ passenger })
}))

app.delete('/api/admin/passengers/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  const ok = await deletePassenger(id)
  if (!ok) {
    res.status(404).json({ error: 'Passageiro nao encontrado.' })
    return
  }
  res.json({ ok: true })
}))

app.post('/api/drivers/signup', asyncHandler(async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = String(req.body?.phone || '').trim()
  const vehicleModel = String(req.body?.vehicleModel || '').trim()
  const vehicleYear = String(req.body?.vehicleYear || '').trim()
  const vehiclePlate = String(req.body?.vehiclePlate || '').trim().toUpperCase()
  const vehicleCategory = String(req.body?.vehicleCategory || '').trim()
  const city = String(req.body?.city || '').trim()

  if (!fullName || !email || !phone || !vehicleModel || !vehicleYear || !vehiclePlate) {
    res.status(400).json({ error: 'Campos obrigatorios faltando no cadastro do motorista.' })
    return
  }
  const existing = await getDriverByIdentifier(email)
  if (existing) {
    res.status(409).json({ error: 'Ja existe motorista com esse e-mail.' })
    return
  }
  const created = await createDriver({
    fullName,
    email,
    phone,
    vehicleModel,
    vehicleYear,
    vehiclePlate,
    vehicleCategory,
    city,
  })
  res.status(201).json({ driver: created })
}))

app.post('/api/drivers/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email) {
    res.status(400).json({ error: 'Informe o e-mail do motorista.' })
    return
  }
  const driver = await getDriverByIdentifier(email)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  if (driver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }
  res.json({ driver })
}))

app.patch('/api/drivers/:id/tariffs', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim()
  const driver = await getDriverByIdentifier(id)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  if (driver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }
  const patchTariffs = req.body?.tariffs || req.body || {}
  const updated = await updateDriver(driver.id, {
    tariffs: {
      perKm: String(patchTariffs.perKm || driver?.tariffs?.perKm || '3,80'),
      perMinute: String(patchTariffs.perMinute || driver?.tariffs?.perMinute || '0,55'),
      displacementFee: String(patchTariffs.displacementFee || driver?.tariffs?.displacementFee || '5,00'),
    },
  })
  res.json({ driver: updated })
}))

app.get('/api/drivers/:slug/public', asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase()
  const driver = await getDriverByIdentifier(slug)
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
      isActive: driver.isActive !== false,
      tariffsEnabled: driver.tariffsEnabled !== false,
      tariffs: {
        perKm: String(driver?.tariffs?.perKm || '3,80'),
        perMinute: String(driver?.tariffs?.perMinute || '0,55'),
        displacementFee: String(driver?.tariffs?.displacementFee || '5,00'),
      },
    },
  })
}))

app.post('/api/passengers/signup', asyncHandler(async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()
  const phone = normalizePhone(req.body?.phone)
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
  if (await getPassengerByEmail(email)) {
    res.status(409).json({ error: 'Ja existe passageiro com esse e-mail.' })
    return
  }
  if (await passengerExistsByPhone(phone)) {
    res.status(409).json({ error: 'Ja existe passageiro com esse telefone.' })
    return
  }

  const driver = await getDriverByIdentifier(driverSlug)
  if (!driver) {
    res.status(404).json({ error: 'Motorista do QR/link nao encontrado.' })
    return
  }
  if (driver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }
  const created = await createPassenger({
    fullName,
    email,
    password,
    phone,
    address,
    driverSlug: driver.slug,
  })
  await linkPassengerToDriver(created.id, driver.id)
  const token = createToken()
  const session = { role: 'passenger', email: created.email, id: created.id }
  sessions.set(token, session)
  res.status(201).json({
    token,
    passenger: created,
    linkedDriver: { id: driver.id, slug: driver.slug, fullName: driver.fullName },
  })
}))

app.post('/api/passengers/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = normalizePhone(req.body?.phone)
  const password = String(req.body?.password || '').trim()
  const passenger = await findPassengerByCredentials({ email, phone, password })
  if (!passenger) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }
  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)
  const linkedDrivers = await listPassengerDrivers(passenger.id)
  res.json({
    token,
    passenger,
    linkedDrivers: linkedDrivers.map((driver) => ({
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      isActive: driver.isActive !== false,
      whatsapp: driver.phone,
      city: driver.city,
      vehicleModel: driver.vehicleModel,
    })),
  })
}))

app.post('/api/auth/register', asyncHandler(async (req, res) => {
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

  if (!driverIdentifier) {
    res.status(400).json({ error: 'Primeiro cadastro do passageiro deve ser pelo QR/link do motorista.' })
    return
  }
  if (!fullName || !phone || !password) {
    res.status(400).json({ error: 'Informe nome, telefone e senha para cadastrar.' })
    return
  }

  let passenger = await getPassengerByEmail(email)
  if (!passenger && (await passengerExistsByPhone(phone))) {
    res.status(409).json({ error: 'Ja existe passageiro com esse telefone.' })
    return
  }
  if (!passenger) {
    passenger = await createPassenger({
      fullName,
      email,
      password,
      phone,
      address,
      driverSlug: '',
    })
  }

  const driver = await getDriverByIdentifier(driverIdentifier)
  if (!driver) {
    res.status(404).json({ error: 'Motorista do link nao encontrado.' })
    return
  }
  if (driver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }
  await linkPassengerToDriver(passenger.id, driver.id)
  passenger.driverSlug = passenger.driverSlug || driver.slug

  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)

  res.status(201).json({
    token,
    passenger,
    linkedDriver: { id: driver.id, slug: driver.slug, fullName: driver.fullName },
  })
}))

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = normalizePhone(req.body?.telefone || req.body?.phone)
  const password = String(req.body?.senha || req.body?.password || '').trim()

  if (!password || (!email && !phone)) {
    res.status(400).json({ error: 'Informe telefone (ou e-mail) e senha.' })
    return
  }

  const passenger = await findPassengerByCredentials({ email, phone, password })
  if (!passenger) {
    res.status(401).json({ error: 'Credenciais invalidas.' })
    return
  }

  const token = createToken()
  const session = { role: 'passenger', email: passenger.email, id: passenger.id }
  sessions.set(token, session)

  const linkedDrivers = await listPassengerDrivers(passenger.id)
  res.json({
    token,
    passenger,
    linkedDrivers: linkedDrivers.map((driver) => ({
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      isActive: driver.isActive !== false,
      whatsapp: driver.phone,
      city: driver.city,
      vehicleModel: driver.vehicleModel,
      vehiclePlate: driver.vehiclePlate,
    })),
  })
}))

app.get('/api/passengers/me/drivers', authRequired, passengerRequired, asyncHandler(async (req, res) => {
  const passenger = await findPassengerBySession(req.session)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado na sessao.' })
    return
  }
  const linkedDrivers = await listPassengerDrivers(passenger.id)
  res.json({
    drivers: linkedDrivers.map((driver) => ({
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      isActive: driver.isActive !== false,
      whatsapp: driver.phone,
      city: driver.city,
      vehicleModel: driver.vehicleModel,
      vehiclePlate: driver.vehiclePlate,
      tariffsEnabled: driver.tariffsEnabled !== false,
      tariffs: driver.tariffs,
    })),
  })
}))

app.post('/api/passengers/me/drivers', authRequired, passengerRequired, asyncHandler(async (req, res) => {
  const passenger = await findPassengerBySession(req.session)
  if (!passenger) {
    res.status(404).json({ error: 'Passageiro nao encontrado na sessao.' })
    return
  }
  const identifier = String(req.body?.motoristaId || req.body?.driverId || req.body?.driverSlug || '').trim()
  if (!identifier) {
    res.status(400).json({ error: 'Informe o identificador do motorista para vincular.' })
    return
  }
  const driver = await getDriverByIdentifier(identifier)
  if (!driver) {
    res.status(404).json({ error: 'Motorista nao encontrado.' })
    return
  }
  if (driver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }
  await linkPassengerToDriver(passenger.id, driver.id)
  passenger.driverSlug = passenger.driverSlug || driver.slug
  res.status(201).json({
    driver: {
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      isActive: driver.isActive !== false,
      whatsapp: driver.phone,
      city: driver.city,
    },
  })
}))

app.post('/api/rides', asyncHandler(async (req, res) => {
  const passengerTokenRaw = String(req.headers.authorization || '')
  const passengerToken = passengerTokenRaw.startsWith('Bearer ') ? passengerTokenRaw.slice(7) : ''
  const passengerSession = passengerToken ? sessions.get(passengerToken) : null
  const requestedDriverSlug = String(req.body?.driverSlug || '').trim().toLowerCase()

  if (requestedDriverSlug && passengerSession?.role !== 'passenger') {
    res.status(401).json({ error: 'Login de passageiro obrigatorio para solicitar corrida.' })
    return
  }

  if (passengerSession?.role === 'passenger') {
    const passenger = await findPassengerBySession(passengerSession)
    if (!passenger) {
      res.status(401).json({ error: 'Passageiro da sessao nao encontrado.' })
      return
    }
    const linkedDrivers = await listPassengerDrivers(passenger.id)
    const hasAccess = linkedDrivers.some((driver) => (
      String(driver.slug || '').trim().toLowerCase() === requestedDriverSlug
      || String(driver.id || '').trim().toLowerCase() === requestedDriverSlug
    ))
    if (!hasAccess) {
      res.status(403).json({ error: 'Passageiro sem vinculo com este motorista.' })
      return
    }
  }

  const requestedDriver = await getDriverByIdentifier(requestedDriverSlug)
  if (!requestedDriver) {
    res.status(404).json({ error: 'Motorista nao encontrado para essa solicitacao.' })
    return
  }
  if (requestedDriver.isActive === false) {
    res.status(403).json({ error: 'Motorista desativado pelo admin.' })
    return
  }

  const ride = await createRide(req.body || {}, requestedDriver)
  res.status(201).json({ ride })
}))

app.get('/api/rides', asyncHandler(async (_req, res) => {
  res.json({ rides: await listRides() })
}))

app.patch('/api/rides/:id/status', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  const nextStatus = String(req.body?.status || '').trim()
  const accepted = ['pending', 'accepted', 'declined', 'canceled']
  if (!accepted.includes(nextStatus)) {
    res.status(400).json({ error: 'Status invalido.' })
    return
  }
  const ride = await updateRideStatus(id, nextStatus)
  if (!ride) {
    res.status(404).json({ error: 'Corrida nao encontrada.' })
    return
  }
  res.json({ ride })
}))

app.get('/api/chat/:rideId/messages', asyncHandler((req, res) => {
  const rideId = String(req.params.rideId)
  res.json({ messages: chatsByRide.get(rideId) || [] })
}))

app.post('/api/chat/:rideId/messages', asyncHandler((req, res) => {
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
}))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno no servidor.' })
})

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} running on http://localhost:${PORT}`)
})
