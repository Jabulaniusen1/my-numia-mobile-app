import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import bs58 from 'bs58'
import { HDKey } from 'micro-ed25519-hdkey'
import nacl from 'tweetnacl'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import type { LocalWallet, WalletSource } from '../types/app'

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'"

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

  return sendAndConfirmTransaction(connection, transaction, [fromKeypair], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  })
}

export function shortAddress(address: string, head = 4, tail = 4): string {
  if (!address) return ''
  if (address.length <= head + tail + 3) return address
  return `${address.slice(0, head)}...${address.slice(-tail)}`
}

export function getWalletSeedWords(wallet: LocalWallet): string[] {
  return wallet.mnemonic ? wallet.mnemonic.split(' ') : []
}
