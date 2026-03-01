import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addPassengerDriver, isApiEnabled } from '../services/api'

const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function PassengerInviteEntryPage() {
  const { motoristaId } = useParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Validando convite do motorista...')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const token = String(localStorage.getItem(PASSENGER_TOKEN_KEY) || '')
      const id = String(motoristaId || '').trim()
      if (!id) {
        navigate('/login', { replace: true })
        return
      }

      if (!token || !isApiEnabled()) {
        navigate(`/register?motoristaId=${encodeURIComponent(id)}`, { replace: true })
        return
      }

      try {
        await addPassengerDriver({ motoristaId: id })
        if (!cancelled) {
          sessionStorage.setItem('Aplayplay_passenger_notice', 'Motorista vinculado com sucesso.')
          navigate('/passageiro/motoristas', { replace: true })
        }
      } catch {
        if (!cancelled) {
          navigate(`/login?motoristaId=${encodeURIComponent(id)}`, { replace: true })
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [motoristaId, navigate])

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black text-slate-900">Convite do motorista</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
        </div>
      </div>
    </section>
  )
}

export default PassengerInviteEntryPage
