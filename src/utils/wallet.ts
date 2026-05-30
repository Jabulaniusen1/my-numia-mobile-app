import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import bs58 from 'bs58'
import { HDKey } from 'micro-ed25519-hdkey'
import nacl from 'tweetnacl'
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import type { LocalWallet, WalletSource } from '../types/app'

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'"
const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n
export const SOL_TRANSFER_FEE_FALLBACK_LAMPORTS = 5_000n

function buildWallet(
  keypair: nacl.SignKeyPair,
  source: WalletSource,
  mnemonic?: string,
): LocalWallet {
  return {
    id: `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    chain: 'SOL',
    address: bs58.encode(keypair.publicKey),
    secretKeyBase58: bs58.encode(keypair.secretKey),
    mnemonic,
    source,
    createdAt: new Date().toISOString(),
  }
}

function keypairFromMnemonic(mnemonic: string): nacl.SignKeyPair {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')

  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid seed phrase. Please check your words and order.')
  }

  const seed = mnemonicToSeedSync(normalized)
  const hdKey = HDKey.fromMasterSeed(seed)
  const derived = hdKey.derive(SOLANA_DERIVATION_PATH)

  if (!derived.privateKey) {
    throw new Error('Could not derive wallet from seed phrase.')
  }

  return nacl.sign.keyPair.fromSeed(derived.privateKey)
}

function parsePrivateKeyInput(input: string): Uint8Array {
  const trimmed = input.trim()

  if (!trimmed) {
    throw new Error('Private key is required.')
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const parsed = JSON.parse(trimmed) as number[]
    return Uint8Array.from(parsed)
  }

  if (trimmed.includes(',')) {
    const parsed = trimmed
      .split(',')
      .map((chunk) => Number(chunk.trim()))
      .filter((value) => !Number.isNaN(value))
    return Uint8Array.from(parsed)
  }

  return bs58.decode(trimmed)
}

function keypairFromPrivateKey(input: string): nacl.SignKeyPair {
  const keyBytes = parsePrivateKeyInput(input)

  if (keyBytes.length === 64) {
    return nacl.sign.keyPair.fromSecretKey(keyBytes)
  }

  if (keyBytes.length === 32) {
    return nacl.sign.keyPair.fromSeed(keyBytes)
  }

  throw new Error('Private key format not supported. Use base58 64-byte or 12/24-word seed.')
}

function keypairFromSecretKeyBase58(secretKeyBase58: string): nacl.SignKeyPair {
  const secretBytes = bs58.decode(secretKeyBase58)

  if (secretBytes.length === 64) {
    return nacl.sign.keyPair.fromSecretKey(secretBytes)
  }

  if (secretBytes.length === 32) {
    return nacl.sign.keyPair.fromSeed(secretBytes)
  }

  throw new Error('Stored wallet key is invalid.')
}

function solanaKeypairFromSecretKeyBase58(secretKeyBase58: string): Keypair {
  const secretBytes = bs58.decode(secretKeyBase58)

  if (secretBytes.length === 64) {
    return Keypair.fromSecretKey(secretBytes)
  }

  if (secretBytes.length === 32) {
    return Keypair.fromSeed(secretBytes)
  }

  throw new Error('Stored wallet key is invalid.')
}

function parseLamportsFromAmount(rawAmount: string): bigint {
  const normalized = rawAmount.trim()
  const match = normalized.match(/^(\d+)(?:\.(\d{1,9}))?$/)
  if (!match) {
    throw new Error('Amount must be a valid positive number (up to 9 decimals).')
  }

  const whole = BigInt(match[1] ?? '0')
  const fractionRaw = (match[2] ?? '').padEnd(9, '0')
  const fraction = BigInt(fractionRaw || '0')
  const lamports = (whole * 1_000_000_000n) + fraction

  if (lamports <= 0n) {
    throw new Error('Amount must be greater than zero.')
  }

  return lamports
}

function formatLamports(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL_BIGINT
  const fraction = lamports % LAMPORTS_PER_SOL_BIGINT
  if (fraction === 0n) return whole.toString()

  return `${whole}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`
}

export function parseSolAmountToLamports(rawAmount: string): bigint {
  return parseLamportsFromAmount(rawAmount)
}

export function formatLamportsAsSol(lamports: bigint): string {
  return formatLamports(lamports)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Transfer failed.'
}

async function getTransactionLogs(error: unknown, connection: Connection): Promise<string[]> {
  if (error instanceof SendTransactionError) {
    if (error.logs?.length) {
      return error.logs
    }

    try {
      return await error.getLogs(connection)
    } catch {
      return []
    }
  }

  const maybeLogs = (error as { logs?: unknown } | null)?.logs
  return Array.isArray(maybeLogs) ? maybeLogs.filter((entry): entry is string => typeof entry === 'string') : []
}

async function formatTransferError(error: unknown, connection: Connection, attemptedLamports: bigint): Promise<string> {
  const message = getErrorMessage(error)
  const logs = await getTransactionLogs(error, connection)
  const detail = [message, ...logs].join('\n')
  const insufficientMatch = detail.match(/insufficient lamports\s+(\d+),\s*need\s+(\d+)/i)

  if (insufficientMatch) {
    const availableLamports = BigInt(insufficientMatch[1] ?? '0')
    const requiredLamports = BigInt(insufficientMatch[2] ?? '0')
    const estimatedFeeLamports = requiredLamports > attemptedLamports
      ? requiredLamports - attemptedLamports
      : 0n
    const maxSendableLamports = availableLamports > estimatedFeeLamports
      ? availableLamports - estimatedFeeLamports
      : 0n

    return [
      'Not enough SOL to cover the network fee.',
      `You have ${formatLamports(availableLamports)} SOL, but this send needs ${formatLamports(requiredLamports)} SOL including fees.`,
      maxSendableLamports > 0n
        ? `Try sending ${formatLamports(maxSendableLamports)} SOL or less.`
        : 'Add a little SOL and try again.',
    ].join(' ')
  }

  if (/blockhash not found|block height exceeded|transaction expired/i.test(detail)) {
    return 'The Solana network took too long to confirm this transfer. Please try again.'
  }

  if (/failed to get recent blockhash|fetch failed|network request failed|timed out/i.test(detail)) {
    return 'Unable to reach the Solana network right now. Check your connection and try again.'
  }

  if (/invalid account|invalid public key|recipient/i.test(detail)) {
    return 'The recipient wallet address looks invalid. Please check it and try again.'
  }

  if (/simulation failed|custom program error/i.test(detail)) {
    return 'The Solana network rejected this transfer during a safety check. Review the amount and recipient, then try again.'
  }

  return 'Transfer could not be completed. Please try again in a moment.'
}

export function createWallet(): LocalWallet {
  const mnemonic = generateMnemonic(wordlist)
  const keypair = keypairFromMnemonic(mnemonic)
  return buildWallet(keypair, 'generated', mnemonic)
}

export function importWalletByMnemonic(mnemonic: string): LocalWallet {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const keypair = keypairFromMnemonic(normalized)
  return buildWallet(keypair, 'mnemonic', normalized)
}

export function importWalletByPrivateKey(privateKey: string): LocalWallet {
  const keypair = keypairFromPrivateKey(privateKey)
  return buildWallet(keypair, 'privateKey')
}

export function signMessageWithWallet(wallet: LocalWallet, message: string): string {
  const keypair = keypairFromSecretKeyBase58(wallet.secretKeyBase58)
  const encoded = new TextEncoder().encode(message)
  const signature = nacl.sign.detached(encoded, keypair.secretKey)
  return bs58.encode(signature)
}

export async function estimateSolTransferFeeLamports(params: {
  fromAddress: string
  toAddress: string
  amount: string
  rpcUrl: string
}): Promise<bigint> {
  const { fromAddress, toAddress, amount, rpcUrl } = params
  const lamports = parseLamportsFromAmount(amount)

  let fromPubkey: PublicKey
  let toPubkey: PublicKey

  try {
    fromPubkey = new PublicKey(fromAddress.trim())
    toPubkey = new PublicKey(toAddress.trim())
  } catch {
    return SOL_TRANSFER_FEE_FALLBACK_LAMPORTS
  }

  const connection = new Connection(rpcUrl, 'confirmed')
  const transaction = new Transaction({
    feePayer: fromPubkey,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    }),
  )

  const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')
  return typeof fee.value === 'number' && Number.isFinite(fee.value)
    ? BigInt(fee.value)
    : SOL_TRANSFER_FEE_FALLBACK_LAMPORTS
}

export async function sendSolTransfer(params: {
  wallet: LocalWallet
  toAddress: string
  amount: string
  rpcUrl: string
}): Promise<string> {
  const { wallet, toAddress, amount, rpcUrl } = params

  const fromKeypair = solanaKeypairFromSecretKeyBase58(wallet.secretKeyBase58)
  const destination = toAddress.trim()
  if (!destination) {
    throw new Error('Recipient wallet address is required.')
  }

  let toPubkey: PublicKey
  try {
    toPubkey = new PublicKey(destination)
  } catch {
    throw new Error('Recipient wallet address is invalid.')
  }

  const lamports = parseLamportsFromAmount(amount)

  const connection = new Connection(rpcUrl, 'confirmed')
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey,
      lamports,
    }),
  )

  try {
    return await sendAndConfirmTransaction(connection, transaction, [fromKeypair], {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    })
  } catch (error) {
    console.warn('[sendSolTransfer]', getErrorMessage(error))
    throw new Error(await formatTransferError(error, connection, lamports))
  }
}

export function shortAddress(address: string, head = 4, tail = 4): string {
  if (!address) return ''
  if (address.length <= head + tail + 3) return address
  return `${address.slice(0, head)}...${address.slice(-tail)}`
}

export function getWalletSeedWords(wallet: LocalWallet): string[] {
  return wallet.mnemonic ? wallet.mnemonic.split(' ') : []
}
