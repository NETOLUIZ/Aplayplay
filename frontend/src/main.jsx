import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { DriverAccountProvider } from './context/DriverAccountContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DriverAccountProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DriverAccountProvider>
  </StrictMode>,
)
