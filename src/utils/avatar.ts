import { createAvatar } from '@dicebear/core'
import * as dylan from '@dicebear/dylan'

const NUMIA_AVATAR_PREFIX = 'numia-avatar:'

export function dylanAvatarSvg(seed: string, size = 120): string {
  return createAvatar(dylan, {
    seed,
    size,
    radius: 50,
    backgroundType: ['solid'],
    backgroundColor: ['f1ebff', 'efe7ff', 'ffffff'],
    randomizeIds: true,
  }).toString()
}

export function avatarUrlFromSeed(seed: string): string {
  return `${NUMIA_AVATAR_PREFIX}${seed.trim()}`
}

export function avatarSeedFromProfileAvatarUrl(avatarUrl: string | null | undefined, fallbackSeed: string): string {
  const fallback = fallbackSeed.trim() || 'numia'
  const value = avatarUrl?.trim()

  if (!value) return fallback
  if (!value.startsWith(NUMIA_AVATAR_PREFIX)) return fallback

  const parsed = value.slice(NUMIA_AVATAR_PREFIX.length).trim()
  return parsed || fallback
}

export function isRemoteAvatarUrl(avatarUrl: string | null | undefined): boolean {
  const value = avatarUrl?.trim()
  if (!value) return false

  return /^https?:\/\//i.test(value)
}
