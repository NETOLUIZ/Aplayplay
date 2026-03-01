import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDriverAccount } from '../context/DriverAccountContext'

function LoginPage() {
  const navigate = useNavigate()
  const { loginDriver } = useDriverAccount()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    try {
      await loginDriver(email)
      void password
      navigate('/app/motorista/dashboard')
    } catch (err) {
      setError(err.message || 'Nao foi possivel fazer login.')
    }
  }

  return (
    <section className="driver-signup">
      <div className="container driver-signup__grid">
        <div className="driver-signup__intro">
          <p className="hero-badge">
            <span className="hero-badge__dot" />
            Acesso do motorista
          </p>
          <h1>Entre para acessar seu painel de corridas</h1>
          <p>
            Use o e-mail cadastrado para abrir seu dashboard. Neste demo, o acesso valida
            o cadastro salvo no navegador.
          </p>
          <ul className="driver-signup__list">
            <li>Entrar com e-mail do motorista cadastrado</li>
            <li>Acesso rapido ao dashboard</li>
            <li>Cadastro novo em poucos passos</li>
          </ul>
        </div>

        <form className="driver-signup__card" onSubmit={handleSubmit}>
          <div className="driver-signup__section">
            <h2>Login</h2>

            <label>
              <span>E-mail</span>
              <input
                type="email"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label>
              <span>Senha</span>
              <input
                type="password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>

          {error && <p className="driver-signup__error">{error}</p>}

          <button className="btn btn--primary btn--block" type="submit">
            Entrar no painel
          </button>

          <Link className="btn btn--ghost btn--block" to="/cadastro/motorista">
            Ainda nao tenho cadastro
          </Link>
        </form>
      </div>
    </section>
  )
}

export default LoginPage
