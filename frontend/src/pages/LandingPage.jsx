import { features, marketingStats } from '../data/mockData'
import { Link } from 'react-router-dom'

function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero__glow hero__glow--right" aria-hidden="true" />
        <div className="hero__glow hero__glow--left" aria-hidden="true" />

        <div className="container hero__grid">
          <div className="hero__content">
            <p className="hero-badge">
              <span className="hero-badge__dot" />
              Nova versao 2.0 disponivel
            </p>

            <h1>
              Seu negocio de <span>motorista particular</span> em suas maos
            </h1>

            <p className="hero__description">
              Gerencie clientes, agendamentos e faturamento em uma plataforma profissional.
              Aumente seus lucros com uma operacao organizada e sem taxas abusivas.
            </p>

            <div className="hero__checks">
              <span>✓ Teste gratis de 14 dias</span>
              <span>✓ Sem necessidade de cartao</span>
            </div>
          </div>

          <div className="signup-card" aria-label="Formulario de cadastro">
            <div className="signup-card__header">
              <h2>Crie sua conta gratis</h2>
              <p>Comece a organizar suas corridas hoje.</p>
            </div>

            <form className="signup-form">
              <Link className="btn btn--primary btn--block" to="/cadastro/motorista">
                Criar Conta
              </Link>
            </form>
          </div>
        </div>
      </section>

      <section className="stats" aria-label="Metricas">
        <div className="container stats__grid">
          {marketingStats.map(([value, label]) => (
            <div className="stat" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="features" id="recursos">
        <div className="container">
          <div className="section-head">
            <h2>Por que usar nossa plataforma?</h2>
            <p>
              Ferramentas essenciais para motoristas independentes que querem crescer o negocio
              com mais organizacao e previsibilidade.
            </p>
          </div>

          <div className="features__grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <div className="feature-card__icon" aria-hidden="true">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="highlights" id="sobre">
        <div className="container highlights__stack">
          <div className="highlight-row">
            <div className="highlight-visual">
              <div className="mockup">
                <div className="mockup__top">
                  <span>Dashboard Financeiro</span>
                  <small>Hoje</small>
                </div>
                <div className="mockup__bars">
                  <i style={{ height: '40%' }} />
                  <i style={{ height: '75%' }} />
                  <i style={{ height: '55%' }} />
                  <i style={{ height: '92%' }} />
                  <i style={{ height: '68%' }} />
                </div>
                <div className="mockup__cards">
                  <div>
                    <span>Receita</span>
                    <strong>R$ 12.480</strong>
                  </div>
                  <div>
                    <span>Corridas</span>
                    <strong>186</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="highlight-copy">
              <p className="highlight-copy__tag">Financeiro</p>
              <h2>Controle financeiro na ponta do lapis</h2>
              <p>
                Tenha visao clara do fluxo de caixa diario, semanal e mensal. Saiba quais clientes
                geram mais retorno e planeje sua operacao com dados reais.
              </p>
              <ul>
                <li>Dashboard financeiro completo</li>
                <li>Resumo de lucro por periodo</li>
                <li>Alertas de despesas recorrentes</li>
              </ul>
            </div>
          </div>

          <div className="highlight-row highlight-row--reverse">
            <div className="highlight-visual">
              <div className="phone-mockup">
                <div className="phone-mockup__header">
                  <strong>Agenda de Corridas</strong>
                  <span>Quinta-feira</span>
                </div>
                <div className="phone-mockup__list">
                  <div>
                    <p>07:30 - Aeroporto</p>
                    <small>Cliente VIP • Confirmado</small>
                  </div>
                  <div>
                    <p>12:00 - Centro</p>
                    <small>Executivo • Ida e volta</small>
                  </div>
                  <div>
                    <p>18:40 - Rodoviaria</p>
                    <small>Particular • Pagamento PIX</small>
                  </div>
                </div>
                <button type="button">Abrir horarios livres</button>
              </div>
            </div>

            <div className="highlight-copy">
              <p className="highlight-copy__tag highlight-copy__tag--violet">Agendamento</p>
              <h2>Sua agenda organizada sem conflito de horario</h2>
              <p>
                Defina disponibilidade e receba reservas nos horarios livres. Menos conversas manuais,
                menos erros e mais previsibilidade no dia a dia.
              </p>
              <ul>
                <li>Link publico para agendamento</li>
                <li>Bloqueio automatico de horarios ocupados</li>
                <li>Lembretes para clientes</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="cta" id="planos">
        <div className="container">
          <div className="cta-card">
            <h2>Pronto para profissionalizar seu trabalho?</h2>
            <p>
              Junte-se a motoristas que retomaram o controle do proprio negocio com uma ferramenta simples e profissional.
            </p>
            <div className="cta-card__actions">
              <Link className="btn btn--light" to="/cadastro/motorista">Criar Conta Gratis</Link>
              <Link className="btn btn--outline" to="/demo/dashboard-motorista">Ver Demonstracao</Link>
            </div>
            <small>Nenhum cartao de credito necessario para comecar.</small>
          </div>
        </div>
      </section>
    </>
  )
}

export default LandingPage




