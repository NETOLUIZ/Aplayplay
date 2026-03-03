import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isApiEnabled, registerPassenger, sendWhatsAppVerificationCode } from '../services/api'

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
  const [verificationCode, setVerificationCode] = useState('')
  const [codeMessage, setCodeMessage] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const apiEnabled = isApiEnabled()

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
    if (apiEnabled && !verificationCode.trim()) {
      setError('Informe o codigo enviado no WhatsApp para concluir o cadastro.')
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
        verificationCode: verificationCode.trim(),
      })
      if (result?.token) {
        localStorage.setItem(PASSENGER_TOKEN_KEY, result.token)
      }
      if (result?.passenger) {
        localStorage.setItem(PASSENGER_STORAGE_KEY, JSON.stringify(result.passenger))
      }
      sessionStorage.setItem('Aplayplay_passenger_notice', 'Cadastro concluido e motorista vinculado.')
      navigate(`/passageiro/solicitar/${encodeURIComponent(motoristaId)}`, { replace: true })
    } catch (err) {
      setError(err.message || 'Nao foi possivel concluir cadastro.')
    } finally {
      setLoading(false)
    }
  }

  async function onSendCode() {
    setError('')
    setCodeMessage('')
    if (!apiEnabled) {
      setError('Configure a API para envio de codigo no WhatsApp.')
      return
    }
    if (!form.telefone.trim()) {
      setError('Informe o telefone antes de enviar o codigo.')
      return
    }

    setSendingCode(true)
    try {
      const result = await sendWhatsAppVerificationCode({
        role: 'passenger',
        phone: form.telefone.trim(),
      })
      const masked = result?.phoneMasked || 'seu numero'
      setCodeMessage(`Codigo enviado para ${masked}.`)
    } catch (err) {
      setError(err.message || 'Nao foi possivel enviar o codigo.')
    } finally {
      setSendingCode(false)
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
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-700">Verificacao por WhatsApp</span>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  placeholder="Codigo de 6 digitos"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(String(e.target.value || '').replace(/\D/g, '').slice(0, 6))}
                />
                <button className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" type="button" onClick={onSendCode} disabled={sendingCode}>
                  {sendingCode ? 'Enviando...' : 'Enviar codigo'}
                </button>
              </div>
              {codeMessage && <p className="text-xs font-semibold text-emerald-600">{codeMessage}</p>}
            </div>
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
