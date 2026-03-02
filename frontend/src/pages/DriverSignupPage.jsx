import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDriverAccount } from '../context/DriverAccountContext'

const initialForm = {
  fullName: '',
  email: '',
  phone: '',
  city: 'Fortaleza, CE',
  photoDataUrl: '',
  vehicleModel: '',
  vehicleYear: '',
  vehiclePlate: '',
  vehicleCategory: 'Particular',
}

function maskBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function maskVehiclePlate(value) {
  const cleaned = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
  if (cleaned.length <= 3) return cleaned
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`
}

function DriverSignupPage() {
  const navigate = useNavigate()
  const { registerDriver } = useDriverAccount()
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem valido para a foto do motorista.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('A foto deve ter no maximo 2MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      updateField('photoDataUrl', String(reader.result || ''))
      setError('')
    }
    reader.onerror = () => {
      setError('Nao foi possivel ler a foto selecionada.')
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const requiredFields = ['fullName', 'email', 'phone', 'vehicleModel', 'vehicleYear', 'vehiclePlate']
    const hasMissing = requiredFields.some((field) => !form[field].trim())
    if (hasMissing) {
      setError('Preencha todos os campos obrigatorios para continuar.')
      return
    }

    try {
      await registerDriver(form)
      navigate('/app/motorista/dashboard')
    } catch (err) {
      setError(err.message || 'Nao foi possivel cadastrar motorista.')
    }
  }

  return (
    <section className="driver-signup py-10 md:py-14">
      <div className="container">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <aside className="min-w-0 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm md:p-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-yellow-300/50 bg-yellow-100/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              Cadastro do Motorista
            </p>

            <h1 className="mt-4 text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">
              Perfil moderno para comecar a operar no painel
            </h1>

            <p className="mt-4 text-sm leading-6 text-slate-600 md:text-base">
              Preencha os dados pessoais e do veiculo. Quando finalizar, voce entra direto no dashboard.
            </p>

            <div className="mt-6 grid gap-3">
              <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Etapa 1</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Dados do motorista</p>
                <p className="text-xs text-slate-600">Foto, nome, contato e cidade base.</p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Etapa 2</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Dados do veiculo</p>
                <p className="text-xs text-slate-600">Modelo, ano, placa e categoria.</p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Etapa 3</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Acesso liberado</p>
                <p className="text-xs text-slate-600">Entrada automatica no dashboard do motorista.</p>
              </article>
            </div>
          </aside>

          <form className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-8" onSubmit={handleSubmit}>
            <div className="space-y-8">
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Dados do motorista</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Obrigatorio *
                  </span>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Foto do motorista</span>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 file:mr-4 file:rounded-lg file:border-0 file:bg-yellow-300 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-900"
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange}
                    />
                  </label>

                  {form.photoDataUrl && (
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <img
                        className="h-14 w-14 rounded-xl object-cover"
                        src={form.photoDataUrl}
                        alt="Preview da foto do motorista"
                      />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Foto carregada</p>
                        <p className="text-xs text-slate-500">Imagem pronta para o perfil do app.</p>
                      </div>
                    </div>
                  )}

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Nome completo *</span>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                      value={form.fullName}
                      onChange={(e) => updateField('fullName', e.target.value)}
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      <span>E-mail *</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                        type="email"
                        value={form.email}
                        onChange={(e) => updateField('email', e.target.value)}
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      <span>WhatsApp *</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                        value={form.phone}
                        onChange={(e) => updateField('phone', maskBrazilPhone(e.target.value))}
                      />
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Cidade base</span>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                      value={form.city}
                      onChange={(e) => updateField('city', e.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section>
                <h2 className="mb-4 text-xl font-black text-slate-900">Dados do veiculo</h2>
                <div className="grid gap-4">
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Modelo do veiculo *</span>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                      placeholder="Ex.: Fiat Argo"
                      value={form.vehicleModel}
                      onChange={(e) => updateField('vehicleModel', e.target.value)}
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      <span>Ano *</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                        placeholder="2023"
                        value={form.vehicleYear}
                        onChange={(e) => updateField('vehicleYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
                      <span>Placa *</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm uppercase text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                        placeholder="ABC-1234"
                        value={form.vehiclePlate}
                        onChange={(e) => updateField('vehiclePlate', maskVehiclePlate(e.target.value))}
                      />
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Categoria</span>
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-yellow-400 focus:bg-white"
                      value={form.vehicleCategory}
                      onChange={(e) => updateField('vehicleCategory', e.target.value)}
                    >
                      <option>Particular</option>
                      <option>Executivo</option>
                      <option>Taxi</option>
                      <option>SUV</option>
                    </select>
                  </label>
                </div>
              </section>
            </div>

            {error && (
              <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}

            <button className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-yellow-400 px-4 py-3 text-sm font-black text-slate-900 shadow-sm transition hover:bg-yellow-300" type="submit">
              Finalizar cadastro e entrar no painel
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default DriverSignupPage
