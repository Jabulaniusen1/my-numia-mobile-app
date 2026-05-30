import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { Beneficiary, LocalWallet, Session, TransferRecord } from '../types/app'
import type { ThemeMode } from '../theme/tokens'

const KEYS = {
  onboarding: 'numia_onboarding_seen_v1',
  walletMeta: 'numia_wallet_meta_v1',
  walletSecret: 'numia_wallet_secret_v1',
  walletMnemonic: 'numia_wallet_mnemonic_v1',
  session: 'numia_session_v1',
  activity: 'numia_activity_v1',
  beneficiaries: 'numia_beneficiaries_v1',
  themeMode: 'numia_theme_mode_v1',
}

type StoredWalletMeta = Omit<LocalWallet, 'secretKeyBase58' | 'mnemonic'>

export async function saveOnboardingSeen(seen: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.onboarding, seen ? '1' : '0')
}

export async function loadOnboardingSeen(): Promise<boolean> {
  const value = await AsyncStorage.getItem(KEYS.onboarding)
  return value === '1'
}

export async function saveWallet(wallet: LocalWallet): Promise<void> {
  const meta: StoredWalletMeta = {
    id: wallet.id,
    chain: wallet.chain,
    address: wallet.address,
    source: wallet.source,
    createdAt: wallet.createdAt,
  }

  await AsyncStorage.setItem(KEYS.walletMeta, JSON.stringify(meta))
  await SecureStore.setItemAsync(KEYS.walletSecret, wallet.secretKeyBase58)

  if (wallet.mnemonic) {
    await SecureStore.setItemAsync(KEYS.walletMnemonic, wallet.mnemonic)
  } else {
    await SecureStore.deleteItemAsync(KEYS.walletMnemonic)
  }
}

export async function loadWallet(): Promise<LocalWallet | null> {
  const rawMeta = await AsyncStorage.getItem(KEYS.walletMeta)
  if (!rawMeta) return null

  const meta = JSON.parse(rawMeta) as StoredWalletMeta
  const secretKeyBase58 = await SecureStore.getItemAsync(KEYS.walletSecret)

  if (!secretKeyBase58) {
    return null
  }

  const mnemonic = await SecureStore.getItemAsync(KEYS.walletMnemonic)

  return {
    ...meta,
    secretKeyBase58,
    mnemonic: mnemonic ?? undefined,
  }
}

export async function clearWallet(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.walletMeta)
  await SecureStore.deleteItemAsync(KEYS.walletSecret)
  await SecureStore.deleteItemAsync(KEYS.walletMnemonic)
}

export async function saveSession(session: Session | null): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(KEYS.session)
    return
  }

  await AsyncStorage.setItem(KEYS.session, JSON.stringify(session))
}

export async function loadSession(): Promise<Session | null> {
  const raw = await AsyncStorage.getItem(KEYS.session)
  if (!raw) return null

  return JSON.parse(raw) as Session
}

export async function saveActivity(items: TransferRecord[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.activity, JSON.stringify(items))
}

export async function loadActivity(): Promise<TransferRecord[]> {
  const raw = await AsyncStorage.getItem(KEYS.activity)
  if (!raw) return []

  return JSON.parse(raw) as TransferRecord[]
}

export async function clearSessionAndActivity(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.session, KEYS.activity])
}

export async function saveBeneficiaries(items: Beneficiary[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.beneficiaries, JSON.stringify(items))
}

export async function loadBeneficiaries(): Promise<Beneficiary[]> {
  const raw = await AsyncStorage.getItem(KEYS.beneficiaries)
  if (!raw) return []

  return JSON.parse(raw) as Beneficiary[]
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(KEYS.themeMode, mode)
}

export async function loadThemeMode(): Promise<ThemeMode> {
  const raw = await AsyncStorage.getItem(KEYS.themeMode)
  return raw === 'dark' ? 'dark' : 'light'
}
