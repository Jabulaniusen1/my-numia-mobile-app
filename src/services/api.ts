import type {
  ApiResponse,
  ClaimResult,
  HandleCheckData,
  Identity,
  IdentityChallenge,
  Profile,
  TransferRecord,
  WalletAccount,
  WalletChallenge,
} from '../types/app'

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com'
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL
const SOLANA_RPC_URLS = Array.from(new Set([SOLANA_RPC_URL, DEFAULT_SOLANA_RPC_URL]))
const SOLANA_MINT_ADDRESS = 'So11111111111111111111111111111111111111112'
const DEFAULT_SOLANA_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
const SOLANA_PRICE_URLS = Array.from(new Set([
  process.env.EXPO_PUBLIC_SOLANA_PRICE_API_URL,
  DEFAULT_SOLANA_PRICE_URL,
  'https://coins.llama.fi/prices/current/coingecko:solana',
  'https://api.coinpaprika.com/v1/tickers/sol-solana?quotes=USD',
  `https://lite-api.jup.ag/price/v3?ids=${SOLANA_MINT_ADDRESS}`,
].filter((url): url is string => Boolean(url))))
const SOLANA_PRICE_CACHE_MAX_AGE_MS = 5 * 60 * 1000

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1000) {
    return fallback
  }
  return Math.trunc(value)
}

const SOLANA_TIMEOUT_MS = parseTimeoutMs(process.env.EXPO_PUBLIC_SOLANA_TIMEOUT_MS, 10000)

let cachedSolUsdPrice: { usd: number; updatedAt: number } | null = null

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT'
  body?: Record<string, unknown>
  token?: string
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token } = options

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null

    if (!response.ok) {
      return {
        success: false,
        error:
          payload?.error ??
          payload?.message ??
          `Request failed (${response.status}). Check your backend URL and server status.`,
      }
    }

    if (!payload) {
      return { success: false, error: 'Invalid server response.' }
    }

    return payload
  } catch {
    return {
      success: false,
      error:
        'Unable to reach NUMIA backend. Ensure API is running and EXPO_PUBLIC_API_BASE_URL is set correctly.',
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseSolUsdPricePayload(payload: unknown): number | null {
  const root = asRecord(payload)
  if (!root) return null

  const solana = asRecord(root.solana)
  const coingeckoPrice = parsePositiveNumber(solana?.usd)
  if (coingeckoPrice) return coingeckoPrice

  const coins = asRecord(root.coins)
  const llamaSolana = asRecord(coins?.['coingecko:solana'])
  const llamaPrice = parsePositiveNumber(llamaSolana?.price)
  if (llamaPrice) return llamaPrice

  const quotes = asRecord(root.quotes)
  const usdQuote = asRecord(quotes?.USD)
  const coinPaprikaPrice = parsePositiveNumber(usdQuote?.price)
  if (coinPaprikaPrice) return coinPaprikaPrice

  const jupiterSolana = asRecord(root[SOLANA_MINT_ADDRESS])
  const jupiterPrice = parsePositiveNumber(jupiterSolana?.usdPrice) ?? parsePositiveNumber(jupiterSolana?.price)
  if (jupiterPrice) return jupiterPrice

  const data = asRecord(root.data)
  const coinbasePrice = parsePositiveNumber(data?.amount)
  if (coinbasePrice) return coinbasePrice

  const tickerPrice = parsePositiveNumber(root.price)
  if (tickerPrice) return tickerPrice

  return null
}

function getCachedSolUsdPrice(): ApiResponse<{ usd: number }> | null {
  if (!cachedSolUsdPrice) return null

  const ageMs = Date.now() - cachedSolUsdPrice.updatedAt
  if (ageMs > SOLANA_PRICE_CACHE_MAX_AGE_MS) {
    return null
  }

  return {
    success: true,
    data: { usd: cachedSolUsdPrice.usd },
  }
}

export const api = {
  baseUrl: API_BASE_URL,
  solanaRpcUrl: SOLANA_RPC_URL,

  checkHandle(name: string) {
    return request<HandleCheckData>(`/api/identity/check?name=${encodeURIComponent(name)}`)
  },

  getIdentityChallenge(walletAddress: string, displayName: string, chain: string = 'SOL') {
    return request<IdentityChallenge>('/api/identity/challenge', {
      method: 'POST',
      body: { walletAddress, displayName, chain },
    })
  },

  registerIdentity(payload: {
    displayName: string
    walletAddress: string
    signature: string
    message: string
    chain?: string
  }) {
    return request<ClaimResult>('/api/identity/register', {
      method: 'POST',
      body: payload,
    })
  },

  getAuthChallenge(walletAddress: string, chain: string = 'SOL') {
    return request<WalletChallenge>('/api/auth/challenge', {
      method: 'POST',
      body: { walletAddress, chain },
    })
  },

  loginWallet(payload: {
    walletAddress: string
    signature: string
    message: string
    chain?: string
  }) {
    return request<ClaimResult>('/api/auth/login', {
      method: 'POST',
      body: payload,
    })
  },

  me(token: string) {
    return request<Identity>('/api/identity/me', { token })
  },

  resolveHandle(handle: string) {
    return request<Identity>(`/api/identity/resolve/${encodeURIComponent(handle)}`)
  },

  lookupWallet(walletAddress: string, chain: string = 'SOL') {
    return request<Identity>(
      `/api/identity/lookup/${encodeURIComponent(walletAddress)}?chain=${encodeURIComponent(chain)}`,
    )
  },

  wallets(token: string) {
    return request<WalletAccount[]>('/api/identity/wallets', { token })
  },

  updateProfile(token: string, handle: string, updates: Partial<Profile>) {
    return request<Identity>(`/api/profile/${encodeURIComponent(handle)}`, {
      method: 'PUT',
      token,
      body: updates,
    })
  },

  sendIntent(
    token: string,
    payload: {
      recipient: string
      amount: string
      note?: string
      chain?: string
      txSignature?: string
      status?: string
    },
  ) {
    return request<TransferRecord>('/api/transactions/send', {
      method: 'POST',
      token,
      body: payload,
    })
  },

  registerPushToken(
    authToken: string,
    payload: {
      token: string
      platform?: string
      deviceName?: string
    },
  ) {
    return request<{ registered: boolean }>('/api/notifications/push-token', {
      method: 'POST',
      token: authToken,
      body: payload,
    })
  },

  setCustomHandle(token: string, customHandle: string) {
    return request<Identity>('/api/identity/custom-handle', {
      method: 'PUT',
      token,
      body: { customHandle },
    })
  },

  transferHistory(token: string, limit: number = 20) {
    return request<TransferRecord[]>(
      `/api/transactions/history?limit=${encodeURIComponent(String(limit))}`,
      { token },
    )
  },

  async solBalance(address: string): Promise<ApiResponse<{ lamports: number; sol: number }>> {
    const wallet = address.trim()
    if (!wallet) {
      return { success: false, error: 'Wallet address is required for balance lookup.' }
    }

    let lastError = 'Unable to fetch wallet balance right now.'

    for (const rpcUrl of SOLANA_RPC_URLS) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), SOLANA_TIMEOUT_MS)

      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [wallet],
          }),
        })

        const payload = await response.json().catch(() => null) as {
          error?: { code?: number; message?: string }
          result?: { value?: number }
        } | null

        if (!response.ok || !payload) {
          lastError = response.status === 429
            ? 'Solana RPC is rate limited. Please retry shortly.'
            : 'Unable to fetch wallet balance right now.'
          continue
        }

        if (payload.error) {
          lastError = payload.error.code === 429
            ? 'Solana RPC is rate limited. Please retry shortly.'
            : payload.error.message ?? 'Wallet balance lookup failed.'
          continue
        }

        const lamports = payload.result?.value
        if (typeof lamports !== 'number') {
          lastError = 'Invalid balance response from Solana RPC.'
          continue
        }

        return {
          success: true,
          data: {
            lamports,
            sol: lamports / 1_000_000_000,
          },
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = 'Solana RPC request timed out. Please retry.'
        } else {
          lastError = 'Unable to reach Solana RPC for wallet balance.'
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    return { success: false, error: lastError }
  },

  async solUsdPrice(): Promise<ApiResponse<{ usd: number }>> {
    let lastError = 'Unable to fetch SOL/USD price right now.'

    for (const priceUrl of SOLANA_PRICE_URLS) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), SOLANA_TIMEOUT_MS)

      try {
        const response = await fetch(priceUrl, { method: 'GET', signal: controller.signal })
        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload) {
          lastError = response.status === 429
            ? 'SOL/USD price API is rate limited. Please retry shortly.'
            : 'Unable to fetch SOL/USD price right now.'
          continue
        }

        const usd = parseSolUsdPricePayload(payload)
        if (!usd) {
          lastError = 'Invalid SOL/USD price response.'
          continue
        }

        cachedSolUsdPrice = { usd, updatedAt: Date.now() }
        return {
          success: true,
          data: { usd },
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = 'Price request timed out. Please retry.'
        } else {
          lastError = 'Unable to reach price API for SOL/USD.'
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    return getCachedSolUsdPrice() ?? { success: false, error: lastError }
  },
}
