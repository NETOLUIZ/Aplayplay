import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addPassengerDriver, isApiEnabled } from '../services/api'

const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function PassengerInviteEntryPage() {
  const { motoristaId } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState('Validando convite do motorista...')

  const driverId = String(motoristaId || '').trim()
  const loginUrl = useMemo(() => `/login?motoristaId=${encodeURIComponent(driverId)}`, [driverId])
  const registerUrl = useMemo(() => `/register?motoristaId=${encodeURIComponent(driverId)}`, [driverId])

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!driverId) {
        setStatus('invalid')
        setMessage('Link do motorista invalido. Volte para a Home e tente novamente.')
        return
      }

      const token = String(localStorage.getItem(PASSENGER_TOKEN_KEY) || '')

      if (!token || !isApiEnabled()) {
        setStatus('choose')
        setMessage('Para continuar com este motorista, escolha Login ou Cadastro.')
        return
      }

      try {
        await addPassengerDriver({ motoristaId: driverId })
        if (!cancelled) {
          sessionStorage.setItem('Aplayplay_passenger_notice', 'Motorista vinculado com sucesso.')
          navigate(`/passageiro/solicitar/${encodeURIComponent(driverId)}`, { replace: true })
        }
      } catch {
        if (!cancelled) {
          setStatus('choose')
          setMessage('Para vincular este motorista, faca Login ou Cadastro.')
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [driverId, navigate])

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black text-slate-900">Convite do motorista</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>

          {status === 'choose' && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link className="btn btn--ghost" to={loginUrl}>Login</Link>
              <Link className="btn btn--primary" to={registerUrl}>Cadastro</Link>
            </div>
          )}

          {status === 'invalid' && (
            <div className="mt-5">
              <Link className="btn btn--primary" to="/home">Ir para Home</Link>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default PassengerInviteEntryPage
