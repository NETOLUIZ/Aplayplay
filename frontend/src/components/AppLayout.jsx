import { NavLink, Outlet, useLocation } from 'react-router-dom'

function AppLayout() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const isQrPassengerFlow = location.pathname.startsWith('/m/') || params.has('motoristaId')
  const hideHeader = location.pathname === '/demo/cliente-solicitar' || location.pathname.startsWith('/solicitar/')
  const hideFooter = (
    location.pathname === '/demo/cliente-solicitar'
    || location.pathname.startsWith('/solicitar/')
    || location.pathname === '/demo/dashboard-motorista'
    || location.pathname.startsWith('/app/motorista/')
  )

  return (
    <div className="aplayplay-app">
      {!hideHeader && (
        <header className="site-header">
          <div className="site-header__top">
            <div className="brand">
              <span className="brand__name">Aplayplay</span>
            </div>

            <nav className="site-nav site-nav--main" aria-label="Modulos do sistema">
              <NavLink to="/home">Home</NavLink>
              {!isQrPassengerFlow && (
                <>
                  <NavLink to="/login">Login Passageiro</NavLink>
                  <NavLink to="/motorista/login">Motorista</NavLink>
                  <NavLink to="/admin/trader">Admin</NavLink>
                </>
              )}
            </nav>

            <div className="header-actions" />
          </div>
        </header>
      )}

      <main>
        <Outlet />
      </main>

      {!hideFooter && (
        <footer className="site-footer">
          <div className="container site-footer__top">
            <div>
              <div className="brand">
                <span className="brand__name">Aplayplay</span>
              </div>
              <p className="site-footer__about">
                Plataforma para gestao de motoristas particulares, taxi e transporte executivo.
              </p>
            </div>

            <div className="site-footer__links">
              <div>
                <h4>Produto</h4>
                <NavLink to="/">Recursos</NavLink>
                <NavLink to="/">Precos</NavLink>
                <a href="#">Atualizacoes</a>
              </div>
              <div>
                <h4>Empresa</h4>
                <a href="#">Sobre Nos</a>
                <a href="#">Blog</a>
                <a href="#">Contato</a>
              </div>
              <div>
                <h4>Legal</h4>
                <a href="#">Termos</a>
                <a href="#">Privacidade</a>
                <a href="#">Cookies</a>
              </div>
            </div>
          </div>

          <div className="container site-footer__bottom">
            <p>© 2026 Aplayplay. Todos os direitos reservados.</p>
            <span className="site-footer__status"><i /> Sistema operacional</span>
          </div>
        </footer>
      )}
    </div>
  )
}

export default AppLayout

