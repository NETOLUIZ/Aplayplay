import { createContext, useContext, useEffect, useState } from 'react'
import { isApiEnabled, loginDriver as loginDriverApi, signupDriver } from '../services/api'

const STORAGE_KEY = 'Aplayplay_driver_account'
const DRIVER_LIST_KEY = 'Aplayplay_driver_accounts'

const DriverAccountContext = createContext(null)

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function upsertDriverInList(driver) {
  if (!driver) return
  const list = readJson(DRIVER_LIST_KEY, [])
  const safeList = Array.isArray(list) ? list : []
  const email = String(driver?.email || '').trim().toLowerCase()
  const id = String(driver?.id || '').trim()
  const slug = String(driver?.slug || '').trim().toLowerCase()
  const index = safeList.findIndex((item) => (
    (id && String(item?.id || '').trim() === id)
    || (email && String(item?.email || '').trim().toLowerCase() === email)
    || (slug && String(item?.slug || '').trim().toLowerCase() === slug)
  ))
  const nextList = [...safeList]
  if (index >= 0) {
    nextList[index] = { ...nextList[index], ...driver }
  } else {
    nextList.unshift(driver)
  }
  localStorage.setItem(DRIVER_LIST_KEY, JSON.stringify(nextList))
}

function DriverAccountProvider({ children }) {
  const [driverAccount, setDriverAccount] = useState(null)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        setDriverAccount(JSON.parse(raw))
      }
    } catch {
      setDriverAccount(null)
    } finally {
      setIsHydrated(true)
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
      upsertDriverInList(accountFromApi)
      return accountFromApi
    }

    const account = {
      ...payload,
      id: `DRV-LOCAL-${Date.now()}`,
      slug: slugify(payload?.fullName) || `motorista-local-${Date.now()}`,
      isActive: true,
      tariffsEnabled: true,
      tariffs: payload?.tariffs || { perKm: '3,80', perMinute: '0,55', displacementFee: '5,00' },
      createdAt: new Date().toISOString(),
    }
    setDriverAccount(account)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
    upsertDriverInList(account)
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
      upsertDriverInList(accountFromApi)
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
      upsertDriverInList(next)
      return next
    })
  }

  function clearDriverAccount() {
    setDriverAccount(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <DriverAccountContext.Provider
      value={{
        driverAccount,
        isHydrated,
        registerDriver,
        loginDriver,
        updateDriverAccount,
        clearDriverAccount,
      }}
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
