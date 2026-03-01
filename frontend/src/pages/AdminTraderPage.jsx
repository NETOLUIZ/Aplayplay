import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteAdminPassenger,
  getAdminDrivers,
  getAdminPassengers,
  isApiEnabled,
  loginAdmin,
  logoutAuth,
  patchAdminDriver,
  patchAdminPassengerStatus,
} from '../services/api'

const ADMIN_AUTH_KEY = 'Aplayplay_admin_auth'
const DRIVER_LIST_KEY = 'Aplayplay_driver_accounts'

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

function formatDate(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return '--/--/----'
  return date.toLocaleDateString('pt-BR')
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}

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

function mergeDrivers(apiDrivers, localDrivers) {
  const byKey = new Map()
  const safeApi = Array.isArray(apiDrivers) ? apiDrivers : []
  const safeLocal = Array.isArray(localDrivers) ? localDrivers : []

  const put = (driver) => {
    const id = String(driver?.id || '').trim()
    const email = String(driver?.email || '').trim().toLowerCase()
    const slug = String(driver?.slug || '').trim().toLowerCase()
    const key = id || email || slug
    if (!key) return
    const previous = byKey.get(key) || {}
    byKey.set(key, { ...previous, ...driver })
  }

  safeLocal.forEach(put)
  safeApi.forEach(put)
  return Array.from(byKey.values())
}

function AdminTraderPage() {
  const navigate = useNavigate()
  const apiEnabled = isApiEnabled()

  const [menu, setMenu] = useState('motoristas')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [passengerStatusFilter, setPassengerStatusFilter] = useState('all')

  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminAuthError, setAdminAuthError] = useState('')
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [adminAuthLoading, setAdminAuthLoading] = useState(false)

  const [drivers, setDrivers] = useState([])
  const [passengers, setPassengers] = useState([])
  const [adminNotice, setAdminNotice] = useState('')
  const [adminTariffMessage, setAdminTariffMessage] = useState('')
  const [adminTariffs, setAdminTariffs] = useState({ perKm: '3,80', perMinute: '0,55', displacementFee: '5,00' })

  useEffect(() => {
    const auth = readJson(ADMIN_AUTH_KEY, null)
    if (auth?.isAuthenticated === true && auth?.token) {
      setIsAdminAuthenticated(true)
    }
  }, [])

  useEffect(() => {
    if (!apiEnabled || !isAdminAuthenticated) return

    let cancelled = false

    async function loadAdminData() {
      try {
        const [driversRes, passengersRes] = await Promise.all([
          getAdminDrivers(),
          getAdminPassengers(),
        ])
        if (cancelled) return

        const apiDrivers = Array.isArray(driversRes?.drivers) ? driversRes.drivers : []
        const apiPassengers = Array.isArray(passengersRes?.passengers) ? passengersRes.passengers : []
        const localDrivers = readJson(DRIVER_LIST_KEY, [])
        const mergedDrivers = mergeDrivers(apiDrivers, localDrivers)

        setDrivers(mergedDrivers)
        setPassengers(apiPassengers)
      } catch (error) {
        if (!cancelled) {
          setAdminNotice(error.message || 'Nao foi possivel carregar dados do admin na API.')
          const localDrivers = readJson(DRIVER_LIST_KEY, [])
          setDrivers(Array.isArray(localDrivers) ? localDrivers : [])
        }
      }
    }

    void loadAdminData()
    return () => {
      cancelled = true
    }
  }, [apiEnabled, isAdminAuthenticated])

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return drivers.filter((driver) => {
      const matchesText = !term || `${driver.fullName} ${driver.email} ${driver.vehicleModel} ${driver.vehiclePlate}`.toLowerCase().includes(term)
      const active = driver.isActive !== false
      const matchesFilter = filter === 'all' || (filter === 'active' && active) || (filter === 'blocked' && !active)
      return matchesText && matchesFilter
    })
  }, [drivers, search, filter])

  const filteredPassengers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return passengers.filter((passenger) => {
      const matchesSearch = !term || `${passenger.fullName} ${passenger.email} ${passenger.phone}`.toLowerCase().includes(term)
      const matchesStatus = passengerStatusFilter === 'all' || (passenger.status || 'active') === passengerStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [passengers, search, passengerStatusFilter])

  const statsSummary = useMemo(() => {
    const totalHours = drivers.reduce((sum, driver) => sum + Number(driver?.onlineHours || 0), 0)
    const totalTrips = drivers.reduce((sum, driver) => sum + Number(driver?.totalTrips || 0), 0)
    const totalGross = drivers.reduce((sum, driver) => sum + Number(driver?.totalGross || 0), 0)
    const ratings = drivers.map((driver) => Number(driver?.rating)).filter((value) => Number.isFinite(value) && value > 0)
    const avgRating = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length) : 0
    return { totalHours, totalTrips, totalGross, avgRating }
  }, [drivers])

  function handleTariffInputChange(field, value) {
    setAdminTariffs((current) => ({ ...current, [field]: value }))
  }

  function normalizeAdminTariffs() {
    return {
      perKm: formatBrazilianDecimal(parseBrazilianCurrencyInput(adminTariffs.perKm) || 3.8),
      perMinute: formatBrazilianDecimal(parseBrazilianCurrencyInput(adminTariffs.perMinute) || 0.55),
      displacementFee: formatBrazilianDecimal(parseBrazilianCurrencyInput(adminTariffs.displacementFee) || 5),
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault()
    setAdminAuthError('')
    setAdminAuthLoading(true)

    if (!apiEnabled) {
      setAdminAuthError('API nao configurada. Defina VITE_API_BASE_URL para usar o Admin.')
      setAdminAuthLoading(false)
      return
    }

    const normalizedEmail = adminEmail.trim().toLowerCase()
    if (!normalizedEmail || !adminPassword.trim()) {
      setAdminAuthError('Informe e-mail e senha para entrar no admin.')
      setAdminAuthLoading(false)
      return
    }

    try {
      const payload = await loginAdmin({ email: normalizedEmail, password: adminPassword })
      if (!payload?.token) {
        setAdminAuthError('Falha no login do admin.')
        setAdminAuthLoading(false)
        return
      }
      writeJson(ADMIN_AUTH_KEY, {
        isAuthenticated: true,
        email: normalizedEmail,
        token: payload.token,
        user: payload.user || null,
        loginAt: new Date().toISOString(),
      })
      setIsAdminAuthenticated(true)
      setAdminEmail('')
      setAdminPassword('')
      setAdminAuthLoading(false)
    } catch (error) {
      setAdminAuthError(error.message || 'Nao foi possivel conectar ao backend do admin.')
      setAdminAuthLoading(false)
    }
  }

  async function handleAdminLogout() {
    try {
      await logoutAuth()
    } catch {
      // ignora
    }
    localStorage.removeItem(ADMIN_AUTH_KEY)
    setIsAdminAuthenticated(false)
    setAdminAuthError('')
    setAdminPassword('')
  }

  async function updateDriverById(driverId, patch) {
    try {
      const result = await patchAdminDriver(driverId, patch)
      const updated = result?.driver
      if (!updated) return
      setDrivers((current) => current.map((driver) => (String(driver.id) === String(driverId) ? updated : driver)))
    } catch (error) {
      setAdminNotice(error.message || 'Nao foi possivel atualizar motorista na API.')
    }
  }

  async function toggleDriverStatus(driverId, active) {
    await updateDriverById(driverId, { isActive: active })
  }

  async function toggleTariffsFeature(driverId, tariffsEnabled) {
    await updateDriverById(driverId, { tariffsEnabled })
  }

  async function applyAdminTariffs(driverId) {
    const normalized = normalizeAdminTariffs()
    setAdminTariffs(normalized)
    await updateDriverById(driverId, { tariffs: normalized })
    setAdminTariffMessage('Tarifas padrao aplicadas para este motorista.')
  }

  async function cyclePassengerStatus(passenger) {
    const order = ['active', 'pending', 'inactive']
    const currentIdx = order.indexOf(passenger.status || 'active')
    const nextStatus = order[(currentIdx + 1) % order.length]

    try {
      const result = await patchAdminPassengerStatus(passenger.id, nextStatus)
      const updated = result?.passenger
      if (updated) {
        setPassengers((current) => current.map((item) => (item.id === passenger.id ? updated : item)))
      }
      setAdminNotice('Status do passageiro atualizado.')
    } catch (error) {
      setAdminNotice(error.message || 'Nao foi possivel atualizar passageiro na API.')
    }
  }

  async function removePassenger(passenger) {
    try {
      await deleteAdminPassenger(passenger.id)
      setPassengers((current) => current.filter((item) => item.id !== passenger.id))
      setAdminNotice('Passageiro removido do painel.')
    } catch (error) {
      setAdminNotice(error.message || 'Nao foi possivel remover passageiro na API.')
    }
  }

  function exportPassengersCsv() {
    const rows = [
      ['Nome', 'Email', 'Telefone', 'DataAdesao', 'Status'],
      ...filteredPassengers.map((p) => [p.fullName || '', p.email || '', p.phone || '', formatDate(p.joinedAt || p.createdAt), p.status || 'active']),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `passageiros_${new Date().toISOString().slice(0, 10)}`
    link.click()
    URL.revokeObjectURL(url)
    setAdminNotice('CSV de passageiros exportado.')
  }

  if (!isAdminAuthenticated) {
    return (
      <section className="adminx py-10 md:py-14">
        <div className="container">
          <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <p className="mb-3 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-700">Login Admin</p>
            <h1 className="text-2xl font-black text-slate-900">Acesso do administrador</h1>
            <p className="mt-2 text-sm text-slate-600">Entre para acessar o painel administrativo da Aplayplay.</p>
            {!apiEnabled && <p className="mt-2 text-xs text-rose-600">Defina VITE_API_BASE_URL para liberar o Admin.</p>}

            <form className="mt-6 space-y-4" onSubmit={handleAdminLogin}>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                <span>E-mail</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                <span>Senha</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              </label>

              {adminAuthError && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{adminAuthError}</p>}

              <button className="btn btn--primary btn--block" type="submit" disabled={adminAuthLoading || !apiEnabled}>
                {adminAuthLoading ? 'Entrando...' : 'Entrar no admin'}
              </button>
            </form>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="adminx">
      <div className="adminx__shell">
        <aside className="adminx__sidebar">
          <div className="adminx__brand">
            <div className="adminx__brand-icon">iD</div>
            <strong>AdminPanel</strong>
          </div>

          <p className="adminx__section-label">Main Menu</p>
          <button type="button" className={`adminx__nav-btn${menu === 'motoristas' ? ' is-active' : ''}`} onClick={() => setMenu('motoristas')}>Motoristas</button>
          <button type="button" className={`adminx__nav-btn${menu === 'passageiros' ? ' is-active' : ''}`} onClick={() => setMenu('passageiros')}>Passageiros</button>
          <button type="button" className={`adminx__nav-btn${menu === 'estatisticas' ? ' is-active' : ''}`} onClick={() => setMenu('estatisticas')}>Estatisticas</button>

          <p className="adminx__section-label">System</p>
          <button type="button" className={`adminx__nav-btn${menu === 'relatorios' ? ' is-active' : ''}`} onClick={() => setMenu('relatorios')}>Relatorios</button>
          <button type="button" className={`adminx__nav-btn${menu === 'configuracoes' ? ' is-active' : ''}`} onClick={() => setMenu('configuracoes')}>Configuracoes</button>
        </aside>

        <div className="adminx__main">
          <header className="adminx__header">
            <div>
              <h1>{menu === 'passageiros' ? 'Gestao de Passageiros' : menu === 'estatisticas' ? 'Estatisticas de Desempenho' : 'Gestao de Motoristas'}</h1>
              <p>{menu === 'passageiros' ? 'Gerencie e monitore os passageiros registrados no sistema.' : menu === 'estatisticas' ? 'Visao geral do desempenho da frota e motoristas em tempo real.' : 'Monitoramento e controle de condutores registrados.'}</p>
            </div>
            <div className="adminx__header-actions">
              {(menu === 'motoristas' || menu === 'passageiros' || menu === 'estatisticas') && (
                <input type="text" placeholder={menu === 'passageiros' ? 'Pesquisar por nome, e-mail ou telefone...' : 'Pesquisar motorista...'} value={search} onChange={(e) => setSearch(e.target.value)} />
              )}
              {menu === 'passageiros' && <button type="button" className="btn btn--ghost" onClick={exportPassengersCsv}>Exportar CSV</button>}
              {menu === 'motoristas' && <button type="button" className="btn btn--primary" onClick={() => navigate('/cadastro/motorista')}>Novo Motorista</button>}
              {menu === 'estatisticas' && <button type="button" className="btn btn--primary" onClick={() => setAdminNotice('Exportacao de PDF disponivel apos integrar dados reais.')}>Exportar PDF</button>}
              <button type="button" className="btn btn--ghost" onClick={() => { void handleAdminLogout() }}>Sair do Admin</button>
            </div>
          </header>

          {menu === 'passageiros' && (
            <div className="adminx__filters">
              <button type="button" className={`adminx__filter-pill${passengerStatusFilter === 'all' ? ' is-active' : ''}`} onClick={() => setPassengerStatusFilter('all')}>Status: Todos</button>
              <button type="button" className={`adminx__filter-pill${passengerStatusFilter === 'active' ? ' is-active' : ''}`} onClick={() => setPassengerStatusFilter('active')}>Ativo</button>
              <button type="button" className={`adminx__filter-pill${passengerStatusFilter === 'pending' ? ' is-active' : ''}`} onClick={() => setPassengerStatusFilter('pending')}>Pendente</button>
              <button type="button" className={`adminx__filter-pill${passengerStatusFilter === 'inactive' ? ' is-active' : ''}`} onClick={() => setPassengerStatusFilter('inactive')}>Inativo</button>
            </div>
          )}

          {menu === 'motoristas' && (
            <div className="adminx__filters">
              <button type="button" className={`adminx__filter-pill${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')}>Todos ({drivers.length})</button>
              <button type="button" className={`adminx__filter-pill${filter === 'active' ? ' is-active' : ''}`} onClick={() => setFilter('active')}>Ativos ({drivers.filter((driver) => driver.isActive !== false).length})</button>
              <button type="button" className={`adminx__filter-pill${filter === 'blocked' ? ' is-active' : ''}`} onClick={() => setFilter('blocked')}>Bloqueados ({drivers.filter((driver) => driver.isActive === false).length})</button>
            </div>
          )}

          {adminNotice && <p className="adminx__notice">{adminNotice}</p>}

          {menu === 'passageiros' && (
            <div className="adminx__table-wrap">
              <table className="adminx__table">
                <thead>
                  <tr>
                    <th>Passageiro</th>
                    <th>Contato</th>
                    <th>Data de Adesao</th>
                    <th>Status</th>
                    <th className="is-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPassengers.length === 0 && (
                    <tr>
                      <td colSpan={5}><p className="adminx__table-empty">Nenhum passageiro encontrado.</p></td>
                    </tr>
                  )}
                  {filteredPassengers.map((passenger) => (
                    <tr key={passenger.id}>
                      <td>
                        <div className="adminx__table-user">
                          <div className="adminx__table-avatar">{(passenger.fullName || '?').slice(0, 2).toUpperCase()}</div>
                          <div>
                            <strong>{passenger.fullName || 'Passageiro'}</strong>
                            <small>ID: {passenger.id || '--'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <p>{passenger.email || '--'}</p>
                        <small>{passenger.phone || '--'}</small>
                      </td>
                      <td>{formatDate(passenger.joinedAt || passenger.createdAt)}</td>
                      <td>
                        <span className={`adminx__status-pill is-${passenger.status || 'active'}`}>{passenger.status === 'inactive' ? 'Inativo' : passenger.status === 'pending' ? 'Pendente' : 'Ativo'}</span>
                      </td>
                      <td className="is-right">
                        <button type="button" className="adminx__icon-btn" onClick={() => { void cyclePassengerStatus(passenger) }}>Editar</button>
                        <button type="button" className="adminx__icon-btn is-danger" onClick={() => { void removePassenger(passenger) }}>Excluir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {menu === 'estatisticas' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-medium text-slate-500">Tempo Online Total</p><p className="mt-1 text-2xl font-black text-slate-900">{statsSummary.totalHours > 0 ? `${statsSummary.totalHours}h` : '--'}</p></article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-medium text-slate-500">Lucro Total</p><p className="mt-1 text-2xl font-black text-slate-900">{statsSummary.totalGross > 0 ? formatCurrency(statsSummary.totalGross) : '--'}</p></article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-medium text-slate-500">Numero de Viagens</p><p className="mt-1 text-2xl font-black text-slate-900">{statsSummary.totalTrips > 0 ? statsSummary.totalTrips : '--'}</p></article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-medium text-slate-500">Avaliacao Media</p><p className="mt-1 text-2xl font-black text-slate-900">{statsSummary.avgRating > 0 ? `${statsSummary.avgRating.toFixed(1)}/5` : '--'}</p></article>
              </div>
            </div>
          )}

          {menu === 'motoristas' && filteredDrivers.length === 0 && <div className="adminx__empty"><p>Nenhum motorista encontrado para esse filtro.</p></div>}

          {menu === 'motoristas' && filteredDrivers.length > 0 && filteredDrivers.map((driver) => {
            const active = driver.isActive !== false
            const tariffsOn = driver.tariffsEnabled !== false
            const currentTariffs = driver.tariffs || adminTariffs
            return (
              <article key={driver.id || driver.email || driver.fullName} className="adminx__driver-card">
                <div className="adminx__driver-top">
                  <div className="adminx__driver-identity">
                    <div className="adminx__driver-photo">{driver.photoDataUrl ? <img src={driver.photoDataUrl} alt={driver.fullName} /> : (driver.fullName || '?').slice(0, 2).toUpperCase()}</div>
                    <div>
                      <h3>{driver.fullName || 'Motorista'}</h3>
                      <p>{driver.email || 'sem e-mail'}</p>
                    </div>
                  </div>
                  <span className={`adminx__status${active ? ' is-active' : ' is-blocked'}`}>{active ? 'Ativo' : 'Desativado'}</span>
                </div>

                <div className="adminx__driver-meta">
                  <p><strong>Contato:</strong> {driver.phone || '-'}</p>
                  <p><strong>Cidade:</strong> {driver.city || '-'}</p>
                  <p><strong>Veiculo:</strong> {driver.vehicleModel || '-'} - {driver.vehiclePlate || '-'}</p>
                </div>

                <div className="adminx__toggles">
                  <label>
                    <input type="checkbox" checked={active} onChange={(e) => { void toggleDriverStatus(driver.id, e.target.checked) }} />
                    <span>Ativar motorista</span>
                  </label>
                  <label>
                    <input type="checkbox" checked={!tariffsOn} onChange={(e) => { void toggleTariffsFeature(driver.id, !e.target.checked) }} />
                    <span>Bloquear tarifa</span>
                  </label>
                </div>

                <div className="adminx__tariffs">
                  <h4>Tarifas padrao individuais</h4>
                  <div className="adminx__tariffs-grid">
                    <label>
                      <span>Valor por KM (R$)</span>
                      <input type="text" value={adminTariffs.perKm || currentTariffs.perKm} onChange={(e) => handleTariffInputChange('perKm', e.target.value)} />
                    </label>
                    <label>
                      <span>Valor por Minuto (R$)</span>
                      <input type="text" value={adminTariffs.perMinute || currentTariffs.perMinute} onChange={(e) => handleTariffInputChange('perMinute', e.target.value)} />
                    </label>
                    <label>
                      <span>Taxa de Deslocamento (R$)</span>
                      <input type="text" value={adminTariffs.displacementFee || currentTariffs.displacementFee} onChange={(e) => handleTariffInputChange('displacementFee', e.target.value)} />
                    </label>
                  </div>
                  <div className="adminx__tariffs-actions">
                    <button className="btn btn--primary btn--block" type="button" onClick={() => { void applyAdminTariffs(driver.id) }}>Aplicar Tarifas</button>
                  </div>
                  {adminTariffMessage && <p className="adminx__hint">{adminTariffMessage}</p>}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default AdminTraderPage
