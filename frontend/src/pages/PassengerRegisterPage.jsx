import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { registerPassenger } from '../services/api'

const PASSENGER_STORAGE_KEY = 'Aplayplay_passenger_account'
const PASSENGER_TOKEN_KEY = 'Aplayplay_passenger_token'

function PassengerRegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const motoristaId = String(searchParams.get('motoristaId') || '').trim()
  const [form, setForm] = useState({
    nome: '',
    telefone: '',
    senha: '',
    address: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function onChange(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setError('')

    if (!motoristaId) {
      setError('Cadastro inicial do passageiro apenas via QR/link do motorista.')
      return
    }
    if (!form.nome.trim() || !form.telefone.trim() || !form.senha.trim()) {
      setError('Informe nome, telefone e senha.')
      return
    }

    setLoading(true)
    try {
      const result = await registerPassenger({
        nome: form.nome.trim(),
        telefone: form.telefone.trim(),
        senha: form.senha,
        address: form.address.trim(),
        motoristaId,
      })
      if (result?.token) {
        localStorage.setItem(PASSENGER_TOKEN_KEY, result.token)
      }
      if (result?.passenger) {
        localStorage.setItem(PASSENGER_STORAGE_KEY, JSON.stringify(result.passenger))
      }
      sessionStorage.setItem('Aplayplay_passenger_notice', 'Cadastro concluido e motorista vinculado.')
      navigate('/passageiro/motoristas', { replace: true })
    } catch (err) {
      setError(err.message || 'Nao foi possivel concluir cadastro.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-2xl font-black text-slate-900">Cadastro do Passageiro</h1>
          <p className="mt-2 text-sm text-slate-600">Primeiro acesso via QR/link do motorista.</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Nome completo</span>
              <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" value={form.nome} onChange={(e) => onChange('nome', e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Telefone</span>
              <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" value={form.telefone} onChange={(e) => onChange('telefone', e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Senha</span>
              <input type="password" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" value={form.senha} onChange={(e) => onChange('senha', e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              <span>Endereco (opcional)</span>
              <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" value={form.address} onChange={(e) => onChange('address', e.target.value)} />
            </label>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

            <button className="btn btn--primary btn--block" type="submit" disabled={loading}>
              {loading ? 'Cadastrando...' : 'Criar conta e vincular motorista'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default PassengerRegisterPage
