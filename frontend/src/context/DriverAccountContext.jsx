import { createContext, useContext, useEffect, useState } from 'react'
import { isApiEnabled, loginDriver as loginDriverApi, signupDriver } from '../services/api'

const STORAGE_KEY = 'Aplayplay_driver_account'

const DriverAccountContext = createContext(null)

function DriverAccountProvider({ children }) {
  const [driverAccount, setDriverAccount] = useState(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        setDriverAccount(JSON.parse(raw))
      }
    } catch {
      setDriverAccount(null)
    }
  }, [])

  async function registerDriver(payload) {
    if (isApiEnabled()) {
      const result = await signupDriver(payload)
      const accountFromApi = result?.driver
      if (!accountFromApi) {
        throw new Error('Falha ao cadastrar motorista na API.')
      }
      setDriverAccount(accountFromApi)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accountFromApi))
      return accountFromApi
    }

    const account = {
      ...payload,
      createdAt: new Date().toISOString(),
    }
    setDriverAccount(account)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
    return account
  }

  async function loginDriver(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail) {
      throw new Error('Informe seu e-mail para entrar.')
    }

    if (isApiEnabled()) {
      const result = await loginDriverApi({ email: normalizedEmail })
      const accountFromApi = result?.driver
      if (!accountFromApi) {
        throw new Error('Falha ao autenticar motorista na API.')
      }
      setDriverAccount(accountFromApi)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accountFromApi))
      return accountFromApi
    }

    if (!driverAccount) {
      throw new Error('Nenhum cadastro encontrado. Cadastre um motorista primeiro.')
    }

    if (driverAccount.email?.trim().toLowerCase() !== normalizedEmail) {
      throw new Error('E-mail nao encontrado. Use o e-mail cadastrado do motorista.')
    }

    return driverAccount
  }

  function updateDriverAccount(patch) {
    setDriverAccount((current) => {
      const next = { ...(current ?? {}), ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function clearDriverAccount() {
    setDriverAccount(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <DriverAccountContext.Provider
      value={{ driverAccount, registerDriver, loginDriver, updateDriverAccount, clearDriverAccount }}
    >
      {children}
    </DriverAccountContext.Provider>
  )
}

function useDriverAccount() {
  const context = useContext(DriverAccountContext)
  if (!context) {
    throw new Error('useDriverAccount must be used within DriverAccountProvider')
  }
  return context
}

export { DriverAccountProvider, useDriverAccount }
