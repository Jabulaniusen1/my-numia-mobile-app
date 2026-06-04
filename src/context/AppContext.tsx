import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import { registerForPushNotificationsAsync } from '../services/notifications'
import {
  clearSessionAndActivity,
  clearWallet,
  loadActivity,
  loadOnboardingSeen,
  loadSession,
  loadThemeMode,
  loadWallet,
  saveActivity,
  saveOnboardingSeen,
  saveSession,
  saveThemeMode,
  saveWallet,
} from '../services/storage'
import type { Identity, LocalWallet, Session, TransferQuote, TransferRecord, WalletAccount } from '../types/app'
import { darkColors, lightColors, type ThemeColors, type ThemeMode } from '../theme/tokens'
import {
  createWallet,
  importWalletByMnemonic,
  importWalletByPrivateKey,
  signMessageWithWallet,
} from '../utils/wallet'

type ProfileUpdates = {
  bio?: string
  avatarUrl?: string
  twitterHandle?: string
  farcasterHandle?: string
  websiteUrl?: string
}

interface ResolveResult {
  address: string
  resolvedHandle?: string
  resolvedDisplayName?: string
  resolvedAvatarUrl?: string | null
}

interface AppContextValue {
  booting: boolean
  busy: boolean
  onboardingSeen: boolean
  wallet: LocalWallet | null
  session: Session | null
  activity: TransferRecord[]
  linkedWallets: WalletAccount[]
  backendUrl: string
  themeMode: ThemeMode
  themeColors: ThemeColors
  isDarkMode: boolean
  setThemeMode: (mode: ThemeMode) => Promise<void>
  toggleDarkMode: () => Promise<void>
  completeOnboarding: () => Promise<void>
  createLocalWallet: () => Promise<LocalWallet>
  importLocalWalletWithMnemonic: (mnemonic: string) => Promise<LocalWallet>
  importLocalWalletWithPrivateKey: (privateKey: string) => Promise<LocalWallet>
  clearLocalWallet: () => Promise<void>
  claimIdentity: (displayName: string) => Promise<Identity>
  signInWithWallet: () => Promise<Identity>
  refreshIdentity: () => Promise<Identity | null>
  refreshLinkedWallets: () => Promise<WalletAccount[]>
  refreshTransferHistory: (limit?: number) => Promise<TransferRecord[]>
  updateProfile: (updates: ProfileUpdates) => Promise<Identity>
  updateCustomHandle: (customHandle: string) => Promise<Identity>
  resolveRecipient: (raw: string) => Promise<ResolveResult>
  quoteTransfer: (payload: {
    recipient: string
    amount: string
    note?: string
    chain?: string
  }) => Promise<TransferQuote>
  sendTransferIntent: (payload: {
    recipient: string
    amount: string
    note?: string
    chain?: string
    txSignature?: string
    status?: string
  }) => Promise<TransferRecord>
  settleServiceFeePayment: (transferIntentId: string, txSignature: string, chain?: string) => Promise<TransferRecord | null>
  logout: () => Promise<void>
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

function normalizeHandleKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeAddressKey(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function syncIdentityAvatarInActivity(records: TransferRecord[], identity: Identity): TransferRecord[] {
  const avatarUrl = identity.profile?.avatarUrl ?? null
  const handles = new Set(
    [identity.handle, identity.customHandle]
      .map((handle) => normalizeHandleKey(handle))
      .filter(Boolean),
  )
  const addresses = new Set(
    [
      identity.walletAddress,
      identity.primaryWallet?.address,
      ...(identity.wallets ?? []).map((walletAccount) => walletAccount.address),
    ]
      .map((address) => normalizeAddressKey(address))
      .filter(Boolean),
  )

  if (handles.size === 0 && addresses.size === 0) {
    return records
  }

  let changed = false
  const next = records.map((record) => {
    const recipientHandleMatches = handles.has(normalizeHandleKey(record.recipientHandle))
    const counterpartyHandleMatches = handles.has(normalizeHandleKey(record.counterpartyHandle))
    const recipientAddressMatches = addresses.has(normalizeAddressKey(record.toAddress))
    const counterpartyAddressMatches =
      record.direction === 'RECEIVED'
        ? addresses.has(normalizeAddressKey(record.fromAddress))
        : addresses.has(normalizeAddressKey(record.toAddress))

    const nextRecord = { ...record }

    if ((recipientHandleMatches || recipientAddressMatches) && nextRecord.recipientAvatarUrl !== avatarUrl) {
      nextRecord.recipientAvatarUrl = avatarUrl
      changed = true
    }

    if ((counterpartyHandleMatches || counterpartyAddressMatches) && nextRecord.counterpartyAvatarUrl !== avatarUrl) {
      nextRecord.counterpartyAvatarUrl = avatarUrl
      changed = true
    }

    return nextRecord
  })

  return changed ? next : records
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [onboardingSeen, setOnboardingSeen] = useState(false)
  const [wallet, setWallet] = useState<LocalWallet | null>(null)
  const [session, setSessionState] = useState<Session | null>(null)
  const [activity, setActivity] = useState<TransferRecord[]>([])
  const [linkedWallets, setLinkedWallets] = useState<WalletAccount[]>([])
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light')
  const registeredPushTokenRef = useRef<string | null>(null)
  const isDarkMode = themeMode === 'dark'
  const themeColors = isDarkMode ? darkColors : lightColors

  const bootstrap = useCallback(async () => {
    setBooting(true)

    const [seen, storedWallet, storedSession, storedActivity, storedThemeMode] = await Promise.all([
      loadOnboardingSeen(),
      loadWallet(),
      loadSession(),
      loadActivity(),
      loadThemeMode(),
    ])

    setOnboardingSeen(seen)
    setWallet(storedWallet)
    setActivity(storedActivity)
    setThemeModeState(storedThemeMode)

    if (storedSession?.token) {
      const me = await api.me(storedSession.token)
      if (me.success && me.data) {
        const refreshed = {
          ...storedSession,
          identity: me.data,
        }
        setSessionState(refreshed)
        await saveSession(refreshed)

        const walletsResult = await api.wallets(storedSession.token)
        if (walletsResult.success && walletsResult.data) {
          setLinkedWallets(walletsResult.data)
        }

        const transferHistoryResult = await api.transferHistory(storedSession.token, 25)
        if (transferHistoryResult.success && transferHistoryResult.data) {
          setActivity(transferHistoryResult.data)
          await saveActivity(transferHistoryResult.data)
        }
      } else {
        setSessionState(null)
        await saveSession(null)
      }
    } else {
      setSessionState(null)
    }

    setBooting(false)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    let cancelled = false

    async function registerDevicePushToken() {
      if (!session?.token || !session.identity?.id) {
        registeredPushTokenRef.current = null
        return
      }

      const registration = await registerForPushNotificationsAsync()
      if (!registration || cancelled) {
        return
      }

      const registrationKey = `${session.identity.id}:${registration.token}`
      if (registeredPushTokenRef.current === registrationKey) {
        return
      }

      const result = await api.registerPushToken(session.token, registration)
      if (cancelled) {
        return
      }

      if (result.success) {
        registeredPushTokenRef.current = registrationKey
      } else {
        console.warn('[notifications] Push token registration failed', result.error)
      }
    }

    void registerDevicePushToken()

    return () => {
      cancelled = true
    }
  }, [session?.identity?.id, session?.token])

  const completeOnboarding = useCallback(async () => {
    setOnboardingSeen(true)
    await saveOnboardingSeen(true)
  }, [])

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode)
    await saveThemeMode(mode)
  }, [])

  const toggleDarkMode = useCallback(async () => {
    await setThemeMode(themeMode === 'dark' ? 'light' : 'dark')
  }, [setThemeMode, themeMode])

  const setWalletAndResetAuth = useCallback(async (nextWallet: LocalWallet) => {
    await saveWallet(nextWallet)
    setWallet(nextWallet)
    setSessionState(null)
    registeredPushTokenRef.current = null
    setLinkedWallets([])
    setActivity([])
    await clearSessionAndActivity()
  }, [])

  const createLocalWallet = useCallback(async () => {
    setBusy(true)
    try {
      const nextWallet = createWallet()
      await setWalletAndResetAuth(nextWallet)
      return nextWallet
    } finally {
      setBusy(false)
    }
  }, [setWalletAndResetAuth])

  const importLocalWalletWithMnemonic = useCallback(async (mnemonic: string) => {
    setBusy(true)
    try {
      const nextWallet = importWalletByMnemonic(mnemonic)
      await setWalletAndResetAuth(nextWallet)
      return nextWallet
    } finally {
      setBusy(false)
    }
  }, [setWalletAndResetAuth])

  const importLocalWalletWithPrivateKey = useCallback(async (privateKey: string) => {
    setBusy(true)
    try {
      const nextWallet = importWalletByPrivateKey(privateKey)
      await setWalletAndResetAuth(nextWallet)
      return nextWallet
    } finally {
      setBusy(false)
    }
  }, [setWalletAndResetAuth])

  const clearLocalWallet = useCallback(async () => {
    setBusy(true)
    try {
      await clearWallet()
      await clearSessionAndActivity()
      setWallet(null)
      setSessionState(null)
      registeredPushTokenRef.current = null
      setLinkedWallets([])
      setActivity([])
    } finally {
      setBusy(false)
    }
  }, [])

  const claimIdentity = useCallback(async (displayName: string) => {
    if (!wallet) {
      throw new Error('Create or import a wallet first.')
    }

    setBusy(true)

    try {
      const challenge = await api.getIdentityChallenge(wallet.address, displayName, wallet.chain)
      if (!challenge.success || !challenge.data) {
        throw new Error(challenge.error ?? 'Unable to request identity challenge.')
      }

      const signature = signMessageWithWallet(wallet, challenge.data.message)

      const registration = await api.registerIdentity({
        displayName,
        walletAddress: wallet.address,
        signature,
        message: challenge.data.message,
        chain: wallet.chain,
      })

      if (!registration.success || !registration.data) {
        throw new Error(registration.error ?? 'Identity registration failed.')
      }

      const nextSession: Session = {
        token: registration.data.token,
        tokenType: registration.data.tokenType,
        identity: registration.data.identity,
      }

      setSessionState(nextSession)
      await saveSession(nextSession)

      const walletsResult = await api.wallets(nextSession.token)
      if (walletsResult.success && walletsResult.data) {
        setLinkedWallets(walletsResult.data)
      }

      const transferHistoryResult = await api.transferHistory(nextSession.token, 25)
      if (transferHistoryResult.success && transferHistoryResult.data) {
        setActivity(transferHistoryResult.data)
        await saveActivity(transferHistoryResult.data)
      }

      return nextSession.identity
    } finally {
      setBusy(false)
    }
  }, [wallet])

  const signInWithWallet = useCallback(async () => {
    if (!wallet) {
      throw new Error('Create or import a wallet first.')
    }

    setBusy(true)

    try {
      const challenge = await api.getAuthChallenge(wallet.address, wallet.chain)
      if (!challenge.success || !challenge.data) {
        throw new Error(challenge.error ?? 'Unable to request auth challenge.')
      }

      const signature = signMessageWithWallet(wallet, challenge.data.message)

      const login = await api.loginWallet({
        walletAddress: wallet.address,
        signature,
        message: challenge.data.message,
        chain: wallet.chain,
      })

      if (!login.success || !login.data) {
        throw new Error(login.error ?? 'Sign in failed.')
      }

      const nextSession: Session = {
        token: login.data.token,
        tokenType: login.data.tokenType,
        identity: login.data.identity,
      }

      setSessionState(nextSession)
      await saveSession(nextSession)

      const walletsResult = await api.wallets(nextSession.token)
      if (walletsResult.success && walletsResult.data) {
        setLinkedWallets(walletsResult.data)
      }

      const transferHistoryResult = await api.transferHistory(nextSession.token, 25)
      if (transferHistoryResult.success && transferHistoryResult.data) {
        setActivity(transferHistoryResult.data)
        await saveActivity(transferHistoryResult.data)
      }

      return nextSession.identity
    } finally {
      setBusy(false)
    }
  }, [wallet])

  const refreshIdentity = useCallback(async () => {
    if (!session?.token) return null

    const me = await api.me(session.token)
    if (!me.success || !me.data) return null
    const identity = me.data

    const nextSession: Session = {
      ...session,
      identity,
    }

    setSessionState(nextSession)
    await saveSession(nextSession)
    setActivity((current) => {
      const synced = syncIdentityAvatarInActivity(current, identity)
      if (synced !== current) {
        void saveActivity(synced)
      }
      return synced
    })
    return nextSession.identity
  }, [session])

  const refreshLinkedWallets = useCallback(async () => {
    if (!session?.token) return []

    const walletsResult = await api.wallets(session.token)
    if (!walletsResult.success || !walletsResult.data) {
      return linkedWallets
    }

    setLinkedWallets(walletsResult.data)
    return walletsResult.data
  }, [linkedWallets, session])

  const refreshTransferHistory = useCallback(async (limit = 25) => {
    if (!session?.token) return []

    const historyResult = await api.transferHistory(session.token, limit)
    if (!historyResult.success || !historyResult.data) {
      return activity
    }

    setActivity(historyResult.data)
    await saveActivity(historyResult.data)
    return historyResult.data
  }, [activity, session])

  const updateProfile = useCallback(async (updates: ProfileUpdates) => {
    if (!session?.token || !session.identity) {
      throw new Error('You need to be signed in to update your profile.')
    }

    setBusy(true)

    try {
      const targetHandle = session.identity.handle
      const result = await api.updateProfile(session.token, targetHandle, updates)

      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Profile update failed.')
      }
      const identity = result.data

      const nextSession: Session = {
        ...session,
        identity,
      }

      setSessionState(nextSession)
      await saveSession(nextSession)
      setActivity((current) => {
        const synced = syncIdentityAvatarInActivity(current, identity)
        if (synced !== current) {
          void saveActivity(synced)
        }
        return synced
      })
      return identity
    } finally {
      setBusy(false)
    }
  }, [session])

  const updateCustomHandle = useCallback(async (customHandle: string) => {
    if (!session?.token || !session.identity) {
      throw new Error('You need to be signed in to update your custom handle.')
    }

    const value = customHandle.trim().toLowerCase()
    if (!value) {
      throw new Error('Custom handle is required.')
    }

    setBusy(true)

    try {
      const result = await api.setCustomHandle(session.token, value)
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Custom handle update failed.')
      }

      const nextSession: Session = {
        ...session,
        identity: result.data,
      }

      setSessionState(nextSession)
      await saveSession(nextSession)
      return result.data
    } finally {
      setBusy(false)
    }
  }, [session])

  const resolveRecipient = useCallback(async (raw: string): Promise<ResolveResult> => {
    const input = raw.trim()

    if (!input) {
      throw new Error('Recipient is required.')
    }

    if (input.includes('@')) {
      const resolved = await api.resolveHandle(input.toLowerCase())
      if (!resolved.success || !resolved.data) {
        throw new Error(resolved.error ?? 'Identity not found.')
      }

      const primary = resolved.data.primaryWallet?.address ?? resolved.data.walletAddress
      return {
        address: primary,
        resolvedHandle: resolved.data.handle,
        resolvedDisplayName: resolved.data.displayName,
        resolvedAvatarUrl: resolved.data.profile?.avatarUrl ?? null,
      }
    }

    const lookup = await api.lookupWallet(input, 'SOL')
    if (lookup.success && lookup.data) {
      return {
        address: lookup.data.primaryWallet?.address ?? lookup.data.walletAddress,
        resolvedHandle: lookup.data.handle,
        resolvedDisplayName: lookup.data.displayName,
        resolvedAvatarUrl: lookup.data.profile?.avatarUrl ?? null,
      }
    }

    return { address: input }
  }, [])

  const sendTransferIntent = useCallback(async (payload: {
    recipient: string
    amount: string
    note?: string
    chain?: string
    txSignature?: string
    status?: string
  }) => {
    if (!session?.token) {
      throw new Error('You need to be signed in to send.')
    }

    const response = await api.sendIntent(session.token, payload)
    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Transfer failed.')
    }

    const transfer = response.data
    const next = [transfer, ...activity.filter((item) => item.id !== transfer.id)].slice(0, 50)
    setActivity(next)
    await saveActivity(next)
    return transfer
  }, [activity, session])

  const quoteTransfer = useCallback(async (payload: {
    recipient: string
    amount: string
    note?: string
    chain?: string
  }) => {
    if (!session?.token) {
      throw new Error('You need to be signed in to quote a transfer.')
    }

    const response = await api.quoteTransfer(session.token, payload)
    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Transfer quote failed.')
    }

    return response.data
  }, [session])

  const settleServiceFeePayment = useCallback(async (
    transferIntentId: string,
    txSignature: string,
    chain = 'SOL',
  ) => {
    if (!session?.token) {
      throw new Error('You need to be signed in to settle a service fee.')
    }

    const response = await api.settleServiceFeePayment(session.token, transferIntentId, txSignature, chain)
    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Service fee verification failed.')
    }

    const transfer = response.data.transfer ?? null
    if (transfer) {
      const next = [transfer, ...activity.filter((item) => item.id !== transfer.id)].slice(0, 50)
      setActivity(next)
      await saveActivity(next)
    }

    return transfer
  }, [activity, session])

  const logout = useCallback(async () => {
    await clearSessionAndActivity()
    setSessionState(null)
    registeredPushTokenRef.current = null
    setLinkedWallets([])
    setActivity([])
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    booting,
    busy,
    onboardingSeen,
    wallet,
    session,
    activity,
    linkedWallets,
    backendUrl: api.baseUrl,
    themeMode,
    themeColors,
    isDarkMode,
    setThemeMode,
    toggleDarkMode,
    completeOnboarding,
    createLocalWallet,
    importLocalWalletWithMnemonic,
    importLocalWalletWithPrivateKey,
    clearLocalWallet,
    claimIdentity,
    signInWithWallet,
    refreshIdentity,
    refreshLinkedWallets,
    refreshTransferHistory,
    updateProfile,
    updateCustomHandle,
    resolveRecipient,
    quoteTransfer,
    sendTransferIntent,
    settleServiceFeePayment,
    logout,
  }), [
    activity,
    booting,
    busy,
    claimIdentity,
    clearLocalWallet,
    completeOnboarding,
    createLocalWallet,
    importLocalWalletWithMnemonic,
    importLocalWalletWithPrivateKey,
    isDarkMode,
    linkedWallets,
    logout,
    onboardingSeen,
    refreshIdentity,
    refreshLinkedWallets,
    refreshTransferHistory,
    quoteTransfer,
    resolveRecipient,
    session,
    sendTransferIntent,
    settleServiceFeePayment,
    setThemeMode,
    signInWithWallet,
    themeColors,
    themeMode,
    toggleDarkMode,
    updateCustomHandle,
    updateProfile,
    wallet,
  ])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used inside AppProvider')
  }
  return context
}
