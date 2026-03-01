import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getPassengerDrivers } from '../services/api'

const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function PassengerDriversPage() {
  const navigate = useNavigate()
  const [drivers, setDrivers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const token = String(localStorage.getItem(PASSENGER_TOKEN_KEY) || '')
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    const pendingNotice = sessionStorage.getItem('Aplayplay_passenger_notice')
    if (pendingNotice) {
      setNotice(pendingNotice)
      sessionStorage.removeItem('Aplayplay_passenger_notice')
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const result = await getPassengerDrivers()
        if (!cancelled) setDrivers(Array.isArray(result?.drivers) ? result.drivers : [])
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nao foi possivel carregar motoristas.')
          if (/401|sessao|token/i.test(String(err.message || ''))) {
            localStorage.removeItem(PASSENGER_TOKEN_KEY)
            navigate('/login', { replace: true })
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  function logout() {
    localStorage.removeItem(PASSENGER_TOKEN_KEY)
    navigate('/login', { replace: true })
  }

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-slate-900">Meus motoristas</h1>
              <p className="mt-1 text-sm text-slate-600">Escolha com quem deseja solicitar corrida.</p>
            </div>
            <div className="flex gap-2">
              <Link className="btn btn--ghost" to="/passageiro/add-motorista">Adicionar motorista</Link>
              <button className="btn btn--ghost" type="button" onClick={logout}>Sair</button>
            </div>
          </div>

          {notice && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{notice}</p>}
          {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

          {loading && <p className="mt-6 text-sm text-slate-600">Carregando motoristas...</p>}

          {!loading && drivers.length === 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Nenhum motorista vinculado ainda.
            </div>
          )}

          {!loading && drivers.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {drivers.map((driver) => (
                <article key={driver.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-base font-black text-slate-900">{driver.fullName}</h3>
                  <p className="mt-1 text-sm text-slate-600">{driver.vehicleModel || 'Veiculo nao informado'} • {driver.city || '--'}</p>
                  <div className="mt-4">
                    <Link className="btn btn--primary btn--block" to={`/passageiro/solicitar/${encodeURIComponent(driver.slug || driver.id)}`}>
                      Solicitar corrida
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default PassengerDriversPage
