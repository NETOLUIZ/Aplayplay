import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addPassengerDriver } from '../services/api'

const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function extractMotoristaId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/\/m\/([^/?#]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1])
  return raw
}

function PassengerAddDriverPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    setError('')

    const token = String(localStorage.getItem(PASSENGER_TOKEN_KEY) || '')
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    const motoristaId = extractMotoristaId(code)
    if (!motoristaId) {
      setError('Informe um codigo/link valido de motorista.')
      return
    }

    setLoading(true)
    try {
      await addPassengerDriver({ motoristaId })
      sessionStorage.setItem('Aplayplay_passenger_notice', 'Motorista adicionado na sua lista.')
      navigate('/passageiro/motoristas', { replace: true })
    } catch (err) {
      setError(err.message || 'Nao foi possivel adicionar motorista.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-2xl font-black text-slate-900">Adicionar motorista</h1>
          <p className="mt-2 text-sm text-slate-600">Cole o link/codigo do QR do motorista para vincular.</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Link ou codigo do motorista</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                placeholder="https://app.com/m/slug-do-motorista"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

            <button className="btn btn--primary btn--block" type="submit" disabled={loading}>
              {loading ? 'Vinculando...' : 'Adicionar motorista'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default PassengerAddDriverPage
