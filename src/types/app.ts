export type Chain = 'SOL' | 'ETH' | 'BTC' | 'BASE' | 'BNB'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface WalletAccount {
  id: string
  chain: string
  address: string
  isPrimary: boolean
  isVerified: boolean
  createdAt: string
  updatedAt: string
}

export interface Profile {
  bio?: string | null
  avatarUrl?: string | null
  twitterHandle?: string | null
  farcasterHandle?: string | null
  websiteUrl?: string | null
  unlockedLevel: number
}

export interface Identity {
  id: string
  handle: string
  encodedName: string
  displayName: string
  walletAddress: string
  chain: string
  isVerified: boolean
  customHandle?: string | null
  createdAt: string
  primaryWallet?: WalletAccount | null
  wallets?: WalletAccount[]
  profile?: Profile | null
}

export interface Session {
  token: string
  tokenType?: string
  identity: Identity
}

export type WalletSource = 'generated' | 'mnemonic' | 'privateKey'

export interface LocalWallet {
  id: string
  chain: 'SOL'
  address: string
  secretKeyBase58: string
  mnemonic?: string
  source: WalletSource
  createdAt: string
}

export interface TransferRecord {
  id: string
  chain: string
  fromAddress: string
  toAddress: string
  recipientInput: string
  recipientHandle?: string | null
  recipientAvatarUrl?: string | null
  amount: string
  note?: string | null
  createdAt: string
  status: string
  txSignature: string
  direction: 'SENT' | 'RECEIVED'
  counterpartyHandle?: string | null
  counterpartyAvatarUrl?: string | null
}

export interface Beneficiary {
  id: string
  handle: string
  displayName: string
  avatarUrl?: string | null
  savedAt: string
}

export interface ClaimResult {
  token: string
  tokenType: string
  identity: Identity
}

export interface WalletChallenge {
  message: string
  expiresAt: string
  walletAddress: string
  chain: string
}

export interface IdentityChallenge {
  message: string
  expiresAt: string
  chain: string
  handle: string
  encodedName: string
}

export interface HandleCheckData {
  available: boolean
  handle: string
  encodedName: string
  reason?: string
}
