import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { addPassengerDriver, authLoginPassenger } from '../services/api'

const PASSENGER_STORAGE_KEY = 'Aplayplay_passenger_account'
const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function PassengerLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const motoristaId = String(searchParams.get('motoristaId') || '').trim()
  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    setError('')
    if (!telefone.trim() || !senha.trim()) {
      setError('Informe telefone e senha.')
      return
    }
    setLoading(true)
    try {
      const result = await authLoginPassenger({
        telefone: telefone.trim(),
        senha,
      })
      if (result?.token) {
        localStorage.setItem(PASSENGER_TOKEN_KEY, result.token)
      }
      if (result?.passenger) {
        localStorage.setItem(PASSENGER_STORAGE_KEY, JSON.stringify(result.passenger))
      }

      if (motoristaId) {
        try {
          await addPassengerDriver({ motoristaId })
          sessionStorage.setItem('Aplayplay_passenger_notice', 'Motorista vinculado com sucesso.')
        } catch {
          // segue para painel mesmo com falha no vínculo extra
        }
      }

      if (motoristaId) {
        navigate(`/passageiro/solicitar/${encodeURIComponent(motoristaId)}`, { replace: true })
        return
      }

      const linkedDriver = String(result?.passenger?.driverSlug || '').trim()
      if (linkedDriver) {
        navigate(`/solicitar/${encodeURIComponent(linkedDriver)}`, { replace: true })
        return
      }

      navigate('/passageiro/solicitar', { replace: true })
    } catch (err) {
      setError(err.message || 'Falha no login do passageiro.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-2xl font-black text-slate-900">Login do Passageiro</h1>
          <p className="mt-2 text-sm text-slate-600">Entre com telefone e senha para acessar seus motoristas.</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Telefone</span>
              <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Senha</span>
              <div className="password-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </label>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

            <button className="btn btn--primary btn--block" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>

            {motoristaId ? (
              <Link className="btn btn--ghost btn--block" to={`/register?motoristaId=${encodeURIComponent(motoristaId)}`}>
                Primeiro acesso? Cadastrar passageiro
              </Link>
            ) : (
              <p className="text-xs text-slate-500">
                Primeiro acesso deve ser pelo QR/link do motorista.
              </p>
            )}
          </form>
        </div>
      </div>
    </section>
  )
}

export default PassengerLoginPage
