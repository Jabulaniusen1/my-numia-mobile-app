import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  Animated,
  ActivityIndicator,
  Alert,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { NavigationContainer, DefaultTheme, type Theme, useFocusEffect } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useFonts } from 'expo-font'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native'
import {
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowUpRight01Icon,
  Copy01Icon,
  DashboardSquare01Icon,
  IdentityCardIcon,
  Moon02Icon,
  QrCode01Icon,
  UserSquareIcon,
  ViewIcon,
  ViewOffIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons'
import { SvgXml } from 'react-native-svg'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import { AppProvider, useApp } from './src/context/AppContext'
import {
  AppButton,
  Card,
  IconBubble,
  Input,
  Screen,
  Skeleton,
  SkeletonText,
  Subtitle,
  Title,
} from './src/components/ui'
import { colors as lightColors, fonts, radius, spacing, type ThemeColors } from './src/theme/tokens'
import { api } from './src/services/api'
import { loadBeneficiaries, saveBeneficiaries } from './src/services/storage'
import type { Beneficiary, Identity, LocalWallet, TransferRecord } from './src/types/app'
import {
  avatarSeedFromProfileAvatarUrl,
  avatarUrlFromSeed,
  dylanAvatarSvg,
  isRemoteAvatarUrl,
} from './src/utils/avatar'
import {
  SOL_TRANSFER_FEE_FALLBACK_LAMPORTS,
  createWallet,
  estimateSolTransferFeeLamports,
  formatLamportsAsSol,
  getWalletSeedWords,
  parseSolAmountToLamports,
  sendSolTransfer,
  shortAddress,
} from './src/utils/wallet'

const Tab = createBottomTabNavigator()
let colors: ThemeColors = lightColors

type MainTabsParamList = {
  Home: undefined
  Send: undefined
  Receive: undefined
  Profile: undefined
  Transactions: undefined
}

type TransactionFilterKey = 'ALL' | 'SENT' | 'RECEIVED' | 'CONFIRMED' | 'PENDING' | 'FAILED'

const onboardingIdentityPreview = [
  { seed: 'alexia', handle: '@1l2x31@numia' },
  { seed: 'mika', handle: '@m3k1@numia' },
  { seed: 'zuri', handle: '@z5r3@numia' },
]

const launchIdentityPreview = [
  {
    seed: 'amara-route',
    handle: '@amara@numia',
    wallet: '7Uv...9kQ',
    status: 'Verified',
    accent: '#0EA5A4',
  },
  {
    seed: 'kai-ledger',
    handle: '@kai@numia',
    wallet: '3Ns...R8p',
    status: 'Linked',
    accent: '#F59E0B',
  },
  {
    seed: 'zola-secure',
    handle: '@zola@numia',
    wallet: '8Ta...2Lm',
    status: 'Ready',
    accent: '#DB2777',
  },
  {
    seed: 'ren-wallet',
    handle: '@ren@numia',
    wallet: '6Pc...4Ae',
    status: 'Synced',
    accent: '#2563EB',
  },
]

function createNavTheme(themeColors: ThemeColors): Theme {
  return {
    ...DefaultTheme,
    dark: themeColors.bg !== lightColors.bg,
    colors: {
      ...DefaultTheme.colors,
      background: themeColors.bg,
      card: themeColors.card,
      border: themeColors.border,
      text: themeColors.text,
      primary: themeColors.neonPurple,
    },
  }
}

function formatSolBalance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00'
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSolForInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toFixed(9).replace(/\.?0+$/, '')
}

function toCapitalizedName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z]/g, '').trim()
  if (!cleaned) return ''
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1).toLowerCase()}`
}

function formatDisplayName(value: string | null | undefined, fallback: string): string {
  const raw = value?.trim() ?? ''
  if (!raw) return fallback
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`
}

const SOL_AMOUNT_REGEX = /^(0|[1-9]\d*)(\.\d{1,9})?$/
const NUMIA_HANDLE_SUFFIX = '@numia'
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const HOME_FALLBACK_REFRESH_MS = 45_000

const TRANSACTION_FILTERS: Array<{ key: TransactionFilterKey; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'SENT', label: 'Sent' },
  { key: 'RECEIVED', label: 'Received' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'FAILED', label: 'Failed' },
]

function shouldAutoResolveRecipient(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.endsWith(NUMIA_HANDLE_SUFFIX)) {
    const handleName = normalized.slice(0, -NUMIA_HANDLE_SUFFIX.length)
    return handleName.length > 0
  }

  return SOLANA_ADDRESS_REGEX.test(normalized)
}

function beneficiaryListsMatch(left: Beneficiary[], right: Beneficiary[]): boolean {
  if (left.length !== right.length) return false

  return left.every((item, index) => {
    const other = right[index]
    return Boolean(
      other &&
        item.id === other.id &&
        item.handle === other.handle &&
        item.displayName === other.displayName &&
        (item.avatarUrl ?? null) === (other.avatarUrl ?? null) &&
        item.savedAt === other.savedAt,
    )
  })
}

async function refreshBeneficiaryAvatars(items: Beneficiary[]): Promise<Beneficiary[]> {
  if (items.length === 0) return items

  const refreshed = await Promise.all(
    items.map(async (entry) => {
      const handle = entry.handle.trim().toLowerCase()
      if (!handle) return entry

      const result = await api.resolveHandle(handle)
      if (!result.success || !result.data) {
        return entry
      }

      const nextHandle = result.data.handle
      const nextId = nextHandle.trim().toLowerCase()

      return {
        ...entry,
        id: nextId || entry.id,
        handle: nextHandle || entry.handle,
        displayName: formatDisplayName(result.data.displayName, entry.displayName),
        avatarUrl: result.data.profile?.avatarUrl ?? null,
      }
    }),
  )

  return refreshed.filter((entry, index, list) => (
    list.findIndex((candidate) => candidate.id === entry.id) === index
  ))
}

async function loadFreshBeneficiaries(): Promise<Beneficiary[]> {
  const stored = await loadBeneficiaries()
  const refreshed = await refreshBeneficiaryAvatars(stored)

  if (!beneficiaryListsMatch(stored, refreshed)) {
    await saveBeneficiaries(refreshed)
  }

  return refreshed
}

function pickVerificationPair(totalWords: number): [number, number] {
  if (totalWords < 2) return [0, 1]

  const first = Math.floor(Math.random() * totalWords)
  let second = Math.floor(Math.random() * totalWords)

  while (second === first) {
    second = Math.floor(Math.random() * totalWords)
  }

  return first < second ? [first, second] : [second, first]
}

function transactionDirectionLabel(record: TransferRecord): string {
  return record.direction === 'RECEIVED' ? 'Received' : 'Sent'
}

function transactionCounterpartyLabel(record: TransferRecord): string {
  if (record.direction === 'RECEIVED') {
    return decodeNumiaIdentity(record.counterpartyHandle) ?? shortAddress(record.fromAddress, 6, 6)
  }

  return (
    decodeNumiaIdentity(record.recipientHandle) ??
    decodeNumiaIdentity(record.counterpartyHandle) ??
    shortAddress(record.toAddress, 6, 6)
  )
}

function transactionCounterpartyHandle(record: TransferRecord): string | null {
  return (
    record.direction === 'RECEIVED'
      ? record.counterpartyHandle
      : record.recipientHandle ?? record.counterpartyHandle
  )?.trim() || null
}

function transactionAmountLabel(record: TransferRecord): string {
  const sign = record.direction === 'RECEIVED' ? '+' : '-'
  return `${sign}${record.amount} ${record.chain}`
}

const NUMIA_DECODE_MAP: Record<string, string> = {
  '1': 'a',
  '2': 'e',
  '3': 'i',
  '4': 'o',
  '5': 'u',
}

function decodeNumiaIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null

  const atIndex = normalized.indexOf('@')
  const hasDomain = atIndex > 0
  const local = hasDomain ? normalized.slice(0, atIndex).trim() : normalized
  const domain = hasDomain ? normalized.slice(atIndex + 1).trim().toLowerCase() : 'numia'
  if (!local || domain !== 'numia') return null

  const decodedLocal = local.replace(/[1-5]/g, (digit) => NUMIA_DECODE_MAP[digit] ?? digit)
  return `${decodedLocal.toLowerCase()}@numia`
}

function normalizeNumiaHandleForCompare(value: string | null | undefined): string {
  const decoded = decodeNumiaIdentity(value)
  if (decoded) return decoded.toLowerCase()

  const normalized = value?.trim().toLowerCase()
  if (!normalized) return ''
  return normalized.includes('@') ? normalized : `${normalized}@numia`
}

function transactionFromIdentity(record: TransferRecord, ownHandle: string): string {
  if (record.direction === 'RECEIVED') {
    return decodeNumiaIdentity(record.counterpartyHandle) ?? 'unknown@numia'
  }

  return decodeNumiaIdentity(ownHandle) ?? 'unknown@numia'
}

function transactionToIdentity(record: TransferRecord, ownHandle: string): string {
  if (record.direction === 'RECEIVED') {
    return decodeNumiaIdentity(ownHandle) ?? 'unknown@numia'
  }

  return (
    decodeNumiaIdentity(record.recipientHandle) ??
    decodeNumiaIdentity(record.counterpartyHandle) ??
    'unknown@numia'
  )
}

function transactionStatusTone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  const normalized = status.trim().toUpperCase()
  if (!normalized) return 'muted'
  if (normalized.includes('CONFIRMED') || normalized.includes('SUCCESS')) return 'success'
  if (normalized.includes('FAILED') || normalized.includes('ERROR')) return 'danger'
  if (normalized.includes('PENDING')) return 'warning'
  return 'muted'
}

function formatTransactionStatus(status: string): string {
  const normalized = status.trim()
  if (!normalized) return 'Unknown'
  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function toCalendarStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function transactionDateSectionLabel(isoDate: string): string {
  const created = new Date(isoDate)
  if (Number.isNaN(created.getTime())) {
    return 'Unknown Date'
  }

  const now = new Date()
  const createdStart = toCalendarStart(created)
  const todayStart = toCalendarStart(now)
  const diffDays = Math.round((todayStart.getTime() - createdStart.getTime()) / 86_400_000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays < 7) {
    return created.toLocaleDateString('en-US', { weekday: 'long' })
  }

  return created.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: created.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Satoshi: require('./assets/fonts/Satoshi-Variable.ttf'),
  })

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.neonBlue} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </SafeAreaProvider>
  )
}

function AppShell() {
  const { themeColors, isDarkMode } = useApp()
  const activeStyles = useMemo(() => createAppStyles(themeColors), [themeColors])
  const navTheme = useMemo(() => createNavTheme(themeColors), [themeColors])

  colors = themeColors
  styles = activeStyles

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <RootSwitch />
    </NavigationContainer>
  )
}

function RootSwitch() {
  const { booting, onboardingSeen, wallet, session } = useApp()

  if (booting) {
    return <BootSplash />
  }

  if (!onboardingSeen) {
    return <OnboardingScreen />
  }

  if (!wallet) {
    return <WalletProvisionFlow />
  }

  if (!session) {
    return <IdentityAuthFlow />
  }

  return <MainTabs />
}

function BootSplash() {
  const drift = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current
  const scan = useRef(new Animated.Value(0)).current
  const identities = useMemo(
    () => launchIdentityPreview.map((item) => ({ ...item, avatar: dylanAvatarSvg(item.seed, 92) })),
    [],
  )

  useEffect(() => {
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    const scanLoop = Animated.loop(
      Animated.timing(scan, {
        toValue: 1,
        duration: 1700,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )

    driftLoop.start()
    pulseLoop.start()
    scanLoop.start()

    return () => {
      driftLoop.stop()
      pulseLoop.stop()
      scanLoop.stop()
    }
  }, [drift, pulse, scan])

  const routeScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.08],
  })

  const routeOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.36, 0.72],
  })

  const scanTranslateX = scan.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 120],
  })

  const scanOpacity = scan.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 1, 0],
  })

  const dotOneOpacity = scan.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.42, 0.42],
  })

  const dotTwoOpacity = scan.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.42, 1, 0.42],
  })

  const dotThreeOpacity = scan.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.42, 0.42, 1],
  })

  const firstLift = drift.interpolate({ inputRange: [0, 1], outputRange: [-8, 7] })
  const secondLift = drift.interpolate({ inputRange: [0, 1], outputRange: [5, -9] })
  const thirdLift = drift.interpolate({ inputRange: [0, 1], outputRange: [-3, 10] })
  const fourthLift = drift.interpolate({ inputRange: [0, 1], outputRange: [9, -5] })
  const lifts = [firstLift, secondLift, thirdLift, fourthLift]
  const identityPositions = [
    styles.launchIdentityNorthWest,
    styles.launchIdentityNorthEast,
    styles.launchIdentitySouthWest,
    styles.launchIdentitySouthEast,
  ]

  return (
    <Screen style={styles.launchScreen}>
      <View style={styles.launchHeader}>
        <Text style={styles.launchWordmark}>NUMIA</Text>
      </View>

      <View style={styles.launchStage}>
        <View style={styles.launchRouteLine} />
        <View style={[styles.launchRouteLine, styles.launchRouteLineReverse]} />
        <Animated.View
          style={[
            styles.launchRouteNode,
            {
              opacity: routeOpacity,
              transform: [{ scale: routeScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.launchScanBeam,
            {
              opacity: scanOpacity,
              transform: [{ translateX: scanTranslateX }],
            },
          ]}
        />
        <View style={styles.launchWalletNode}>
          <View style={styles.launchWalletIcon}>
            <HugeiconsIcon icon={Wallet01Icon} color="#FFFFFF" size={22} strokeWidth={1.9} />
          </View>
          <Text style={styles.launchWalletTitle}>Route</Text>
          <Text style={styles.launchWalletSub}>SOL ready</Text>
        </View>

        {identities.map((item, index) => (
          <Animated.View
            key={item.handle}
            style={[
              styles.launchIdentityCard,
              identityPositions[index],
              { transform: [{ translateY: lifts[index] }] },
            ]}
          >
            <View style={[styles.launchIdentityAccent, { backgroundColor: item.accent }]} />
            <View style={styles.launchIdentityTop}>
              <View style={[styles.launchAvatarShell, { borderColor: item.accent }]}>
                <SvgXml xml={item.avatar} width={42} height={42} />
              </View>
              <View style={styles.launchIdentityCopy}>
                <Text style={styles.launchIdentityHandle} numberOfLines={1} ellipsizeMode="tail">
                  {item.handle}
                </Text>
                <Text style={styles.launchIdentityWallet} numberOfLines={1}>
                  {item.wallet}
                </Text>
              </View>
            </View>
            <View style={styles.launchIdentityMeta}>
              <View style={[styles.launchIdentityDot, { backgroundColor: item.accent }]} />
              <Text style={styles.launchIdentityStatus}>{item.status}</Text>
            </View>
          </Animated.View>
        ))}
      </View>

      <View style={styles.launchFooter}>
        <Text style={styles.launchHeadline}>Resolving identities</Text>
        <Text style={styles.launchFooterLabel}>Matching handles to on-chain destinations</Text>
        <View style={styles.launchDots}>
          <Animated.View style={[styles.launchDot, styles.launchDotTeal, { opacity: dotOneOpacity }]} />
          <Animated.View style={[styles.launchDot, styles.launchDotPurple, { opacity: dotTwoOpacity }]} />
          <Animated.View style={[styles.launchDot, styles.launchDotGold, { opacity: dotThreeOpacity }]} />
        </View>
      </View>
    </Screen>
  )
}

function OnboardingScreen() {
  const { completeOnboarding } = useApp()
  const float = useRef(new Animated.Value(0)).current
  const glow = useRef(new Animated.Value(0)).current
  const identities = useMemo(
    () => onboardingIdentityPreview.map((item) => ({ ...item, avatar: dylanAvatarSvg(item.seed, 112) })),
    [],
  )

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    floatLoop.start()
    glowLoop.start()

    return () => {
      floatLoop.stop()
      glowLoop.stop()
    }
  }, [float, glow])

  const centerLift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 10],
  })

  const leftLift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [8, -8],
  })

  const rightLift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 12],
  })

  const ringScale = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  })

  const ringOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.42],
  })

  const lifts = [leftLift, centerLift, rightLift]

  return (
    <Screen style={styles.onboardingScreen}>
      <Text style={styles.onboardingWordmark}>Numia</Text>

      <View style={styles.onboardingHero}>
        <View style={styles.identityStage}>
          <Animated.View
            style={[
              styles.identityPulseRing,
              {
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />

          {identities.map((item, index) => (
            <Animated.View
              key={item.handle}
              style={[
                styles.onboardingIdentityPreview,
                index === 0 && styles.onboardingIdentityPreviewLeft,
                index === 1 && styles.onboardingIdentityPreviewCenter,
                index === 2 && styles.onboardingIdentityPreviewRight,
                { transform: [{ translateY: lifts[index] }] },
              ]}
            >
              <View style={styles.identityAvatarShell}>
                <SvgXml xml={item.avatar} width={78} height={78} />
              </View>
              <View style={styles.identityHandlePill}>
                <Text style={styles.identityHandleText} numberOfLines={1}>
                  {item.handle}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <Text style={styles.onboardingShortLine}>Claim handles like @1l2x31@numia and resolve instantly.</Text>
      </View>

      <View style={styles.onboardingAction}>
        <AppButton label="Enter NUMIA" onPress={() => void completeOnboarding()} />
      </View>
    </Screen>
  )
}

function WalletProvisionFlow() {
  const [mode, setMode] = useState<'entry' | 'create' | 'import'>('entry')

  if (mode === 'create') {
    return <CreateWalletScreen onBack={() => setMode('entry')} />
  }

  if (mode === 'import') {
    return <ImportWalletScreen onBack={() => setMode('entry')} />
  }

  return <WalletEntryScreen onCreate={() => setMode('create')} onImport={() => setMode('import')} />
}

function WalletEntryScreen({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const float = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current
  const avatar = useMemo(() => dylanAvatarSvg('alexia-wallet', 112), [])

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    floatLoop.start()
    pulseLoop.start()

    return () => {
      floatLoop.stop()
      pulseLoop.stop()
    }
  }, [float, pulse])

  const identityLift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 8],
  })

  const walletLift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [8, -8],
  })

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  })

  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.42],
  })

  const connectorOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.36, 0.9],
  })

  return (
    <Screen style={styles.walletEntryScreen}>
      <Text style={styles.onboardingWordmark}>Numia</Text>

      <View style={styles.walletEntryHero}>
        <View style={styles.walletEntryStage}>
          <Animated.View
            style={[
              styles.walletEntryPulseRing,
              {
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />

          <Animated.View style={[styles.walletEntryIdentityCard, { transform: [{ translateY: identityLift }] }]}>
            <View style={styles.walletEntryAvatarShell}>
              <SvgXml xml={avatar} width={74} height={74} />
            </View>
            <View style={styles.walletEntryHandlePill}>
              <Text style={styles.walletEntryHandleText} numberOfLines={1}>
                @1l2x31@numia
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.walletEntryConnector, { opacity: connectorOpacity }]} />

          <Animated.View style={[styles.walletEntryWalletBubble, { transform: [{ translateY: walletLift }] }]}>
            <HugeiconsIcon icon={Wallet01Icon} color={colors.neonPurple} size={38} strokeWidth={1.7} />
          </Animated.View>
        </View>

        <View style={styles.walletEntryCopy}>
          <Text style={styles.walletEntryTitle}>Start Your Wallet Layer</Text>
          <Text style={styles.walletEntryLine}>Create or import your wallet.</Text>
        </View>
      </View>

      <View style={styles.walletEntryActions}>
        <AppButton label="Create Wallet" onPress={onCreate} />
        <AppButton label="Import Wallet" onPress={onImport} variant="secondary" />
      </View>
    </Screen>
  )
}

function CreateWalletScreen({ onBack }: { onBack: () => void }) {
  const { busy, importLocalWalletWithMnemonic } = useApp()
  const [draftWallet, setDraftWallet] = useState<LocalWallet | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copyPhraseFeedback, setCopyPhraseFeedback] = useState(false)
  const [isPhraseVerified, setIsPhraseVerified] = useState(false)
  const [verifyWordA, setVerifyWordA] = useState('')
  const [verifyWordB, setVerifyWordB] = useState('')
  const [verificationPair, setVerificationPair] = useState<[number, number]>([1, 5])
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const toastOpacity = useRef(new Animated.Value(0)).current
  const toastOffset = useRef(new Animated.Value(-10)).current
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const seedWords = draftWallet ? getWalletSeedWords(draftWallet) : []
  const [firstIndex, secondIndex] = verificationPair

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  const showInlineToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }

    setToastMessage(message)
    toastOpacity.setValue(0)
    toastOffset.setValue(-10)

    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(toastOffset, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start()

    toastTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(toastOffset, {
          toValue: -10,
          duration: 180,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToastMessage('')
      })
    }, 2200)
  }

  const handleGenerate = async () => {
    setError('')
    setToastMessage('')
    setCopyPhraseFeedback(false)
    setIsPhraseVerified(false)
    setVerifyWordA('')
    setVerifyWordB('')
    setIsGenerating(true)

    try {
      await new Promise((resolve) => setTimeout(resolve, 650))
      const generated = createWallet()
      const words = getWalletSeedWords(generated)
      setVerificationPair(pickVerificationPair(words.length))
      setDraftWallet(generated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate wallet.')
    } finally {
      setIsGenerating(false)
    }
  }

  const copyRecoveryPhrase = async () => {
    if (!draftWallet?.mnemonic) return
    await Clipboard.setStringAsync(draftWallet.mnemonic)
    setCopyPhraseFeedback(true)
  }

  const verifyRecoveryPhrase = () => {
    if (seedWords.length < 2) {
      setError('Recovery phrase is unavailable for verification.')
      return
    }

    const expectedA = seedWords[firstIndex]?.trim().toLowerCase() ?? ''
    const expectedB = seedWords[secondIndex]?.trim().toLowerCase() ?? ''
    const actualA = verifyWordA.trim().toLowerCase()
    const actualB = verifyWordB.trim().toLowerCase()

    if (!actualA || !actualB) {
      setError('Enter both words to verify your phrase.')
      setIsPhraseVerified(false)
      return
    }

    if (actualA !== expectedA || actualB !== expectedB) {
      setError('')
      showInlineToast('Wrong words. Check your recovery phrase and try again.')
      setIsPhraseVerified(false)
      return
    }

    setError('')
    setIsPhraseVerified(true)
  }

  const secureAndContinue = async () => {
    if (!draftWallet?.mnemonic) {
      setError('Generate a wallet first.')
      return
    }

    if (!isPhraseVerified) {
      setError('Verify your recovery phrase before continuing.')
      return
    }

    try {
      setError('')
      await importLocalWalletWithMnemonic(draftWallet.mnemonic)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to secure wallet.')
    }
  }

  return (
    <Screen scroll>
      {toastMessage ? (
        <Animated.View
          style={[
            styles.inlineToast,
            {
              opacity: toastOpacity,
              transform: [{ translateY: toastOffset }],
            },
          ]}
        >
          <Text style={styles.inlineToastText}>{toastMessage}</Text>
        </Animated.View>
      ) : null}

      <Pressable style={styles.backRow} onPress={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} color={colors.textMuted} size={20} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Title>Create Wallet</Title>
      <Subtitle>
        Generate your wallet, secure your recovery phrase, and verify it before you continue.
      </Subtitle>

      {!draftWallet && (
        <>
          {isGenerating ? (
            <Card style={styles.walletFlowLoaderCard}>
              <ActivityIndicator color={colors.neonPurple} />
              <Text style={styles.walletFlowLoaderTitle}>Generating your wallet...</Text>
              <Text style={styles.walletFlowLoaderBody}>Preparing keys and recovery phrase securely.</Text>
            </Card>
          ) : (
            <Card style={styles.walletFlowCard}>
              <Text style={styles.cardTitle}>Wallet Setup</Text>
              <Text style={styles.rowBody}>1. Create your wallet on this device.</Text>
              <Text style={styles.rowBody}>2. Copy and save your recovery phrase offline.</Text>
              <Text style={styles.rowBody}>3. Verify phrase ownership to secure access.</Text>
            </Card>
          )}
          <AppButton label="Generate Wallet" onPress={() => void handleGenerate()} loading={isGenerating || busy} />
        </>
      )}

      {draftWallet && (
        <>
          <Card>
            <Text style={styles.cardTitle}>Primary Address</Text>
            <Text style={styles.monoValue}>{draftWallet.address}</Text>
          </Card>

          {seedWords.length > 0 && (
            <Card>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Recovery Phrase</Text>
                <Pressable style={styles.secretCopyButton} onPress={() => void copyRecoveryPhrase()}>
                  <HugeiconsIcon icon={Copy01Icon} color={colors.neonPurple} size={16} />
                  <Text style={styles.secretCopyText}>{copyPhraseFeedback ? 'Copied' : 'Copy Phrase'}</Text>
                </Pressable>
              </View>
              <View style={styles.seedGrid}>
                {seedWords.map((word, index) => (
                  <View key={`${word}_${index}`} style={styles.seedWordPill}>
                    <Text style={styles.seedWordText}>{`${index + 1}. ${word}`}</Text>
                  </View>
                ))}
              </View>
              <Subtitle>Save these words in the correct order. Anyone with this phrase can access your wallet.</Subtitle>
            </Card>
          )}

          {seedWords.length > 1 ? (
            <Card style={styles.walletFlowCard}>
              <Text style={styles.cardTitle}>Verify Recovery Phrase</Text>
              <Input
                label={`Word #${firstIndex + 1}`}
                value={verifyWordA}
                onChangeText={(value) => {
                  setVerifyWordA(value)
                  setIsPhraseVerified(false)
                  setError('')
                }}
                placeholder="Enter word"
              />
              <Input
                label={`Word #${secondIndex + 1}`}
                value={verifyWordB}
                onChangeText={(value) => {
                  setVerifyWordB(value)
                  setIsPhraseVerified(false)
                  setError('')
                }}
                placeholder="Enter word"
              />
              <AppButton label="Verify Phrase" onPress={() => void verifyRecoveryPhrase()} variant="secondary" />
              {isPhraseVerified ? (
                <Text style={styles.successText}>Phrase verified. Your wallet is secured.</Text>
              ) : null}
            </Card>
          ) : null}

          <AppButton
            label="Continue"
            onPress={() => void secureAndContinue()}
            loading={busy}
            disabled={!isPhraseVerified}
          />
        </>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </Screen>
  )
}

function ImportWalletScreen({ onBack }: { onBack: () => void }) {
  const { busy, importLocalWalletWithMnemonic, importLocalWalletWithPrivateKey } = useApp()
  const [method, setMethod] = useState<'mnemonic' | 'private'>('mnemonic')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const handleImport = async () => {
    setError('')

    try {
      if (method === 'mnemonic') {
        await importLocalWalletWithMnemonic(value)
      } else {
        await importLocalWalletWithPrivateKey(value)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <Screen scroll>
      <Pressable style={styles.backRow} onPress={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} color={colors.textMuted} size={20} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Title>Import Wallet</Title>
      <Subtitle>
        Use your seed phrase or private key to continue with an existing wallet.
      </Subtitle>

      <View style={styles.methodRow}>
        <Pressable
          onPress={() => setMethod('mnemonic')}
          style={[styles.methodTab, method === 'mnemonic' && styles.methodTabActive]}
        >
          <Text style={[styles.methodText, method === 'mnemonic' && styles.methodTextActive]}>Seed Phrase</Text>
        </Pressable>
        <Pressable
          onPress={() => setMethod('private')}
          style={[styles.methodTab, method === 'private' && styles.methodTabActive]}
        >
          <Text style={[styles.methodText, method === 'private' && styles.methodTextActive]}>Private Key</Text>
        </Pressable>
      </View>

      <Input
        label={method === 'mnemonic' ? 'Seed Phrase' : 'Private Key'}
        value={value}
        onChangeText={setValue}
        placeholder={method === 'mnemonic' ? 'twelve words here...' : 'base58 or [1,2,...]'}
        multiline
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <AppButton label="Import Wallet" onPress={() => void handleImport()} loading={busy} disabled={!value.trim()} />
    </Screen>
  )
}

function IdentityAuthFlow() {
  const [mode, setMode] = useState<'entry' | 'claim'>('entry')

  if (mode === 'claim') {
    return <ClaimIdentityScreen onBack={() => setMode('entry')} />
  }

  return <AuthGatewayScreen onClaim={() => setMode('claim')} />
}

function AuthGatewayScreen({ onClaim }: { onClaim: () => void }) {
  const { wallet, signInWithWallet, busy } = useApp()
  const [lookupState, setLookupState] = useState<'checking' | 'found' | 'missing' | 'error'>('checking')
  const [foundIdentity, setFoundIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState('')

  const lookupWalletIdentity = useCallback(async () => {
    if (!wallet) return

    setError('')
    setLookupState('checking')
    setFoundIdentity(null)

    const result = await api.lookupWallet(wallet.address, wallet.chain)
    if (result.success && result.data) {
      setFoundIdentity(result.data)
      setLookupState('found')
      return
    }

    const message = result.error ?? ''
    const normalizedMessage = message.toLowerCase()
    if (normalizedMessage.includes('no numia identity') || normalizedMessage.includes('not found')) {
      setLookupState('missing')
      return
    }

    setError(message || 'Unable to check this wallet.')
    setLookupState('error')
  }, [wallet])

  useEffect(() => {
    void lookupWalletIdentity()
  }, [lookupWalletIdentity])

  const handleSignIn = async () => {
    setError('')
    try {
      await signInWithWallet()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    }
  }

  const avatarSeed = avatarSeedFromProfileAvatarUrl(
    foundIdentity?.profile?.avatarUrl,
    foundIdentity?.handle ?? wallet?.address ?? 'numia',
  )
  const avatar = dylanAvatarSvg(avatarSeed, 120)
  const displayName = foundIdentity ? formatDisplayName(foundIdentity.displayName, 'NUMIA user') : ''
  const displayHandle = foundIdentity?.handle ?? ''

  return (
    <Screen style={styles.authGatewayScreen}>
      <Text style={styles.onboardingWordmark}>Numia</Text>

      <View style={styles.authGatewayHero}>
        {lookupState === 'checking' ? (
          <View style={styles.authLookupLoader}>
            <ActivityIndicator color={colors.neonPurple} />
            <Text style={styles.authGatewayTitle}>Checking wallet identity</Text>
          </View>
        ) : null}

        {lookupState === 'found' && foundIdentity ? (
          <>
            <View style={styles.authFoundVisual}>
              <View style={styles.authFoundRing} />
              <View style={styles.authFoundAvatarShell}>
                <SvgXml xml={avatar} width={84} height={84} />
              </View>
            </View>

            <View style={styles.authGatewayCopy}>
              <Text style={styles.authGatewayEyebrow}>Identity found for this wallet</Text>
              <Text style={styles.authGatewayTitle}>{displayName}</Text>
              <View style={styles.authFoundHandlePill}>
                <Text style={styles.authFoundHandleText} numberOfLines={1}>
                  {displayHandle}
                </Text>
              </View>
            </View>
          </>
        ) : null}

        {lookupState === 'missing' ? (
          <>
            <View style={styles.authFoundVisual}>
              <View style={styles.authFoundRing} />
              <View style={styles.authFoundAvatarShell}>
                <HugeiconsIcon icon={IdentityCardIcon} color={colors.neonPurple} size={42} strokeWidth={1.7} />
              </View>
            </View>

            <View style={styles.authGatewayCopy}>
              <Text style={styles.authGatewayEyebrow}>No identity found for this wallet</Text>
              <Text style={styles.authGatewayTitle}>Claim your @numia handle.</Text>
            </View>
          </>
        ) : null}

        {lookupState === 'error' ? (
          <View style={styles.authGatewayCopy}>
            <Text style={styles.authGatewayEyebrow}>Could not check this wallet</Text>
            {error ? <Text style={styles.authGatewayError}>{error}</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.authGatewayActions}>
        {lookupState === 'found' ? (
          <AppButton label="Continue" onPress={() => void handleSignIn()} loading={busy} />
        ) : null}

        {lookupState === 'missing' ? (
          <AppButton label="Claim Identity" onPress={onClaim} />
        ) : null}

        {lookupState === 'error' ? (
          <>
            <AppButton label="Try Again" onPress={() => void lookupWalletIdentity()} variant="secondary" />
            <AppButton label="Claim Identity" onPress={onClaim} variant="ghost" />
          </>
        ) : null}

        {lookupState === 'found' && error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </Screen>
  )
}

function ClaimIdentityScreen({ onBack }: { onBack: () => void }) {
  const { busy, claimIdentity } = useApp()
  const [name, setName] = useState('')
  const [checkResult, setCheckResult] = useState<{ handle: string; available: boolean; reason?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const handleCheck = async () => {
    setError('')
    setChecking(true)

    const normalizedName = toCapitalizedName(name)
    const result = await api.checkHandle(normalizedName.toLowerCase())
    if (!result.success || !result.data) {
      setError(result.error ?? 'Unable to check availability.')
      setCheckResult(null)
      setChecking(false)
      return
    }

    setCheckResult({
      handle: result.data.handle,
      available: result.data.available,
      reason: result.data.reason,
    })

    setChecking(false)
  }

  const handleClaim = async () => {
    setError('')
    try {
      await claimIdentity(toCapitalizedName(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed.')
    }
  }

  return (
    <Screen scroll>
      <Pressable style={styles.backRow} onPress={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} color={colors.textMuted} size={20} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Title>Claim @numia Identity</Title>
      <Subtitle>
        Pick a clean username and mint your readable identity on NUMIA.
      </Subtitle>

      <Input
        label="Username"
        value={name}
        onChangeText={(value) => setName(toCapitalizedName(value))}
        placeholder="alex"
      />

      <AppButton label="Check Availability" onPress={() => void handleCheck()} loading={checking} disabled={!name} variant="secondary" />

      {checking ? (
        <Card>
          <Text style={styles.cardTitle}>Checking handle...</Text>
          <Skeleton height={28} width="72%" radius={10} />
          <Skeleton height={14} width="42%" radius={8} />
        </Card>
      ) : null}

      {checkResult && (
        <Card>
          <Text style={styles.cardTitle}>Preview</Text>
          <Text style={styles.identityPreview}>{checkResult.handle}</Text>
          <Text style={checkResult.available ? styles.successText : styles.errorText}>
            {checkResult.available ? 'Available' : checkResult.reason ?? 'Unavailable'}
          </Text>
        </Card>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <AppButton
        label="Claim Identity"
        onPress={() => void handleClaim()}
        loading={busy}
        disabled={!name || !!checkResult?.available === false}
      />
    </Screen>
  )
}

function MainTabs() {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 8)

  return (
    <Tab.Navigator
      id="main-tabs"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 64 + bottomInset,
          paddingBottom: bottomInset + 6,
          paddingTop: 6,
        },
        tabBarLabelPosition: 'below-icon',
        tabBarItemStyle: {
          height: 52,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 0,
        },
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: -2,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.regular,
          fontSize: 11,
          lineHeight: 14,
          marginTop: 2,
        },
        tabBarActiveTintColor: colors.neonPurple,
        tabBarInactiveTintColor: colors.textDim,
        tabBarIcon: ({ color, size }) => {
          const icon =
            route.name === 'Home'
              ? DashboardSquare01Icon
              : route.name === 'Send'
                ? ArrowUpRight01Icon
                : route.name === 'Receive'
                  ? ArrowDown02Icon
                  : route.name === 'Profile'
                    ? UserSquareIcon
                    : DashboardSquare01Icon

          return <HugeiconsIcon icon={icon} color={color} size={size + 1} strokeWidth={1.8} />
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Send" component={SendScreen} />
      <Tab.Screen name="Receive" component={ReceiveScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
  )
}

function HomeScreen({ navigation }: { navigation: { navigate: (name: keyof MainTabsParamList) => void } }) {
  const { session, wallet, activity, linkedWallets, refreshIdentity, refreshLinkedWallets, refreshTransferHistory } = useApp()
  const [balanceSol, setBalanceSol] = useState('0.00')
  const [balanceUsd, setBalanceUsd] = useState('$0.00')
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null)
  const [refreshingHome, setRefreshingHome] = useState(true)
  const [balanceError, setBalanceError] = useState('')
  const [showBalance, setShowBalance] = useState(true)
  const [handleCopied, setHandleCopied] = useState(false)
  const refreshInFlight = useRef(false)
  const solUsdPriceRef = useRef<number | null>(null)

  const displayHandle = session?.identity.handle ?? 'unknown@numia'
  const profileAvatarUrl = session?.identity.profile?.avatarUrl ?? null
  const avatarSeed = useMemo(
    () => avatarSeedFromProfileAvatarUrl(profileAvatarUrl, displayHandle),
    [displayHandle, profileAvatarUrl],
  )
  const avatar = useMemo(() => dylanAvatarSvg(avatarSeed, 96), [avatarSeed])
  const hasRemoteAvatar = isRemoteAvatarUrl(profileAvatarUrl)
  const totalWallets = linkedWallets.length > 0 ? linkedWallets.length : session?.identity.wallets?.length ?? 1
  const primaryAddress = wallet?.address ?? session?.identity.walletAddress ?? ''
  const displayName = formatDisplayName(session?.identity.displayName, 'NUMIA user')

  useEffect(() => {
    solUsdPriceRef.current = solUsdPrice
  }, [solUsdPrice])

  const loadBalance = useCallback(async () => {
    if (!primaryAddress) {
      setBalanceSol('0.00')
      setBalanceUsd('$0.00')
      setBalanceError('')
      return
    }

    setBalanceError('')

    const [balanceResult, priceResult] = await Promise.all([
      api.solBalance(primaryAddress),
      api.solUsdPrice(),
    ])

    if (balanceResult.success && balanceResult.data) {
      const sol = balanceResult.data.sol
      setBalanceSol(formatSolBalance(sol))
      setBalanceError('')

      if (priceResult.success && priceResult.data) {
        setSolUsdPrice(priceResult.data.usd)
        setBalanceUsd(formatUsd(sol * priceResult.data.usd))
      } else if (solUsdPriceRef.current) {
        setBalanceUsd(formatUsd(sol * solUsdPriceRef.current))
      } else {
        setBalanceUsd('$0.00')
      }
    } else {
      setBalanceError(balanceResult.error ?? 'Unable to load wallet balance.')
    }
  }, [primaryAddress])

  const refreshHome = useCallback(async (showLoader: boolean = false) => {
    if (refreshInFlight.current) {
      return
    }

    refreshInFlight.current = true
    if (showLoader) {
      setRefreshingHome(true)
    }

    try {
      const refreshes: Promise<unknown>[] = [refreshTransferHistory(), loadBalance()]

      if (showLoader) {
        refreshes.unshift(refreshIdentity(), refreshLinkedWallets())
      }

      await Promise.all(refreshes)
    } finally {
      if (showLoader) {
        setRefreshingHome(false)
      }
      refreshInFlight.current = false
    }
  }, [loadBalance, refreshIdentity, refreshLinkedWallets, refreshTransferHistory])

  const refreshHomeRef = useRef(refreshHome)

  useEffect(() => {
    refreshHomeRef.current = refreshHome
  }, [refreshHome])

  useFocusEffect(
    useCallback(() => {
      void refreshHomeRef.current(true)

      const fallbackInterval = setInterval(() => {
        void refreshHomeRef.current()
      }, HOME_FALLBACK_REFRESH_MS)

      return () => {
        clearInterval(fallbackInterval)
      }
    }, []),
  )

  const copyHandle = async () => {
    await Clipboard.setStringAsync(displayHandle)
    setHandleCopied(true)
    setTimeout(() => setHandleCopied(false), 1400)
  }

  return (
    <Screen scroll flushBottom>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tag}>WELCOME BACK</Text>
          <Pressable onPress={() => void copyHandle()} style={styles.handlePress}>
            <Text style={styles.homeHandle} numberOfLines={1} ellipsizeMode="tail">
              {displayHandle}
            </Text>
          </Pressable>
          <Text style={styles.homeSubText}>{handleCopied ? 'Copied handle' : displayName}</Text>
        </View>
        {hasRemoteAvatar && profileAvatarUrl ? (
          <Image source={{ uri: profileAvatarUrl }} style={styles.homeAvatarImage} />
        ) : (
          <SvgXml xml={avatar} width={58} height={58} />
        )}
      </View>

      <Card style={styles.balanceCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.balanceLabel}>Wallet Balance</Text>
          <View style={styles.balanceHeaderActions}>
            <Pressable onPress={() => setShowBalance((current) => !current)} style={styles.balanceEyeButton}>
              <HugeiconsIcon
                icon={showBalance ? ViewIcon : ViewOffIcon}
                color="#FFFFFF"
                size={16}
                strokeWidth={1.9}
              />
            </Pressable>
            <Pressable onPress={() => void refreshHome(true)}>
              <Text style={styles.balanceLink}>Refresh</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.balanceValue}>
          {showBalance ? balanceUsd : '••••••'}
        </Text>
        <Text style={styles.balanceSub}>{showBalance ? `${balanceSol} SOL` : '•••••• SOL'}</Text>
        <View style={styles.balanceButtonsRow}>
          <Pressable style={styles.balanceButton} onPress={() => navigation.navigate('Send')}>
            <HugeiconsIcon icon={ArrowUpRight01Icon} color="#FFFFFF" size={18} />
            <Text style={styles.balanceButtonText}>Send</Text>
          </Pressable>
          <Pressable style={styles.balanceButton} onPress={() => navigation.navigate('Receive')}>
            <HugeiconsIcon icon={ArrowDown02Icon} color="#FFFFFF" size={18} />
            <Text style={styles.balanceButtonText}>Receive</Text>
          </Pressable>
        </View>
        {balanceError ? <Text style={styles.errorTextSmall}>{balanceError}</Text> : null}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Recent Activity</Text>
          <Pressable onPress={() => navigation.navigate('Transactions')} style={styles.inlineLinkButton}>
            <Text style={styles.inlineLinkText}>View all</Text>
          </Pressable>
        </View>
        {refreshingHome && activity.length === 0 ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={14} width="74%" radius={8} />
            <SkeletonText lines={3} lineHeight={12} lastLineWidth="52%" />
          </View>
        ) : activity.length === 0 ? (
          <Subtitle>No transfer activity yet. Send to a handle or address to create your first transaction.</Subtitle>
        ) : (
          activity.slice(0, 4).map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={styles.activityTitle} numberOfLines={1} ellipsizeMode="tail">
                  {item.direction === 'SENT'
                    ? (item.recipientHandle ?? item.counterpartyHandle ?? shortAddress(item.toAddress, 6, 6))
                    : (item.counterpartyHandle ?? shortAddress(item.fromAddress, 6, 6))}
                </Text>
                <Text style={styles.activityMeta}>
                  {item.direction === 'SENT' ? 'Sent' : 'Received'} · {item.amount} {item.chain}
                </Text>
              </View>
              <Text style={styles.activityMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Identity</Text>
        {refreshingHome ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={12} width="48%" radius={8} />
            <Skeleton height={12} width="78%" radius={8} />
            <Skeleton height={12} width="36%" radius={8} />
          </View>
        ) : (
          <>
            <InfoRow label="Display name" value={displayName} />
            <InfoRow label="Handle" value={displayHandle} />
            <InfoRow label="Linked wallets" value={`${totalWallets}`} />
          </>
        )}
      </Card>
    </Screen>
  )
}

function TransactionsScreen({ navigation }: { navigation: { navigate: (name: keyof MainTabsParamList) => void } }) {
  const { activity, refreshTransferHistory, busy, session } = useApp()
  const [activeFilter, setActiveFilter] = useState<TransactionFilterKey>('ALL')
  const [loadingTransactions, setLoadingTransactions] = useState(true)
  const [selectedTransaction, setSelectedTransaction] = useState<TransferRecord | null>(null)
  const [viewedIdentity, setViewedIdentity] = useState<Identity | null>(null)
  const [identityProfileOpen, setIdentityProfileOpen] = useState(false)
  const [loadingIdentityProfile, setLoadingIdentityProfile] = useState(false)
  const [identityProfileError, setIdentityProfileError] = useState('')
  const [referenceCopied, setReferenceCopied] = useState(false)
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const ownHandle = session?.identity.handle ?? 'unknown@numia'
  const ownHandleCanonical = normalizeNumiaHandleForCompare(ownHandle)
  const ownAvatarUrl = session?.identity.profile?.avatarUrl ?? null

  const loadTransactions = useCallback(async (showLoader: boolean = false) => {
    if (showLoader) {
      setLoadingTransactions(true)
    }

    try {
      await refreshTransferHistory(100)
    } finally {
      if (showLoader) {
        setLoadingTransactions(false)
      }
    }
  }, [refreshTransferHistory])

  useFocusEffect(
    useCallback(() => {
      void loadTransactions(true)
    }, [loadTransactions]),
  )

  useEffect(() => {
    setReferenceCopied(false)
  }, [selectedTransaction?.id])

  useFocusEffect(
    useCallback(() => {
      let active = true

      const refreshBeneficiaries = async () => {
        const stored = await loadFreshBeneficiaries()
        if (active) {
          setBeneficiaries(stored)
        }
      }

      void refreshBeneficiaries()

      return () => {
        active = false
      }
    }, []),
  )

  const beneficiaryAvatarByHandle = useMemo(() => {
    const map = new Map<string, string | null>()

    beneficiaries.forEach((entry) => {
      const key = entry.handle.trim().toLowerCase()
      if (!key) return
      map.set(key, entry.avatarUrl ?? null)
    })

    return map
  }, [beneficiaries])

  const getTransactionAvatarMeta = useCallback((record: TransferRecord) => {
    const handleValue = (
      record.direction === 'RECEIVED'
        ? record.counterpartyHandle
        : record.recipientHandle ?? record.counterpartyHandle
    )?.trim()
    const handleCanonical = normalizeNumiaHandleForCompare(handleValue)
    const isOwnHandle = Boolean(handleCanonical && ownHandleCanonical && handleCanonical === ownHandleCanonical)

    const handleKey = handleValue?.toLowerCase() ?? ''
    const inlineAvatarUrl =
      record.direction === 'RECEIVED'
        ? (record.counterpartyAvatarUrl ?? null)
        : (record.recipientAvatarUrl ?? record.counterpartyAvatarUrl ?? null)

    const savedAvatarUrl = handleKey ? (beneficiaryAvatarByHandle.get(handleKey) ?? null) : null
    const resolvedAvatarUrl = isOwnHandle ? ownAvatarUrl : (inlineAvatarUrl ?? savedAvatarUrl)
    const fallbackSeed =
      handleValue ||
      handleCanonical ||
      (record.direction === 'RECEIVED' ? record.fromAddress : record.toAddress) ||
      'numia'

    return {
      hasRemoteAvatar: isRemoteAvatarUrl(resolvedAvatarUrl),
      avatarUrl: resolvedAvatarUrl,
      avatarSeed: avatarSeedFromProfileAvatarUrl(resolvedAvatarUrl, fallbackSeed),
    }
  }, [beneficiaryAvatarByHandle, ownAvatarUrl, ownHandleCanonical])

  const filteredTransactions = useMemo(() => {
    const sorted = [...activity].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    return sorted.filter((item) => {
      const normalizedStatus = item.status.trim().toUpperCase()

      if (activeFilter === 'ALL') return true
      if (activeFilter === 'SENT') return item.direction === 'SENT'
      if (activeFilter === 'RECEIVED') return item.direction === 'RECEIVED'
      if (activeFilter === 'CONFIRMED') {
        return normalizedStatus.includes('CONFIRMED') || normalizedStatus.includes('SUCCESS')
      }
      if (activeFilter === 'PENDING') return normalizedStatus.includes('PENDING')
      if (activeFilter === 'FAILED') {
        return normalizedStatus.includes('FAILED') || normalizedStatus.includes('ERROR')
      }

      return true
    })
  }, [activity, activeFilter])

  const groupedTransactions = useMemo(() => {
    const groups: Array<{ section: string; rows: TransferRecord[] }> = []

    filteredTransactions.forEach((item) => {
      const section = transactionDateSectionLabel(item.createdAt)
      const current = groups[groups.length - 1]

      if (current && current.section === section) {
        current.rows.push(item)
      } else {
        groups.push({ section, rows: [item] })
      }
    })

    return groups
  }, [filteredTransactions])

  const selectedTransactionAvatar = useMemo(() => {
    if (!selectedTransaction) return null
    return getTransactionAvatarMeta(selectedTransaction)
  }, [getTransactionAvatarMeta, selectedTransaction])

  const selectedStatusTone = transactionStatusTone(selectedTransaction?.status ?? '')
  const selectedCounterpartyHandle = selectedTransaction
    ? transactionCounterpartyHandle(selectedTransaction)
    : null
  const viewedIdentityHandle = viewedIdentity?.handle ?? ''
  const viewedIdentityAvatarUrl = viewedIdentity?.profile?.avatarUrl ?? null
  const viewedIdentityAvatarSeed = avatarSeedFromProfileAvatarUrl(
    viewedIdentityAvatarUrl,
    viewedIdentityHandle || 'numia',
  )
  const viewedIdentityAvatar = dylanAvatarSvg(viewedIdentityAvatarSeed, 120)
  const viewedIdentityHasRemoteAvatar = isRemoteAvatarUrl(viewedIdentityAvatarUrl)

  const copyReference = async () => {
    if (!selectedTransaction?.txSignature) return
    await Clipboard.setStringAsync(selectedTransaction.txSignature)
    setReferenceCopied(true)
    setTimeout(() => setReferenceCopied(false), 1400)
  }

  const openIdentityProfile = async () => {
    const handle = selectedCounterpartyHandle?.trim()
    if (!handle) {
      setIdentityProfileError('This transaction does not have a Numia identity attached.')
      return
    }

    setIdentityProfileOpen(true)
    setLoadingIdentityProfile(true)
    setIdentityProfileError('')
    setViewedIdentity(null)

    const result = await api.resolveHandle(handle.toLowerCase())
    if (!result.success || !result.data) {
      setIdentityProfileError(result.error ?? 'Unable to load this profile.')
      setLoadingIdentityProfile(false)
      return
    }

    setViewedIdentity(result.data)
    setLoadingIdentityProfile(false)
  }

  const closeIdentityProfile = () => {
    setIdentityProfileOpen(false)
    setViewedIdentity(null)
    setIdentityProfileError('')
    setLoadingIdentityProfile(false)
  }

  const closeTransactionDetails = () => {
    closeIdentityProfile()
    setSelectedTransaction(null)
  }

  return (
    <>
      <Screen scroll flushBottom>
        <Pressable style={styles.backRow} onPress={() => navigation.navigate('Home')}>
          <HugeiconsIcon icon={ArrowLeft01Icon} color={colors.textMuted} size={20} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Title>Transactions</Title>
        <Subtitle>
          Review your full transaction history grouped by date, and tap any row for full details.
        </Subtitle>

        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Filters</Text>
            <Pressable onPress={() => void loadTransactions(true)} style={styles.inlineLinkButton}>
              <Text style={styles.inlineLinkText}>{busy || loadingTransactions ? 'Refreshing...' : 'Refresh'}</Text>
            </Pressable>
          </View>
          <View style={styles.txFilterWrap}>
            {TRANSACTION_FILTERS.map((filter) => {
              const selected = filter.key === activeFilter
              return (
                <Pressable
                  key={filter.key}
                  onPress={() => setActiveFilter(filter.key)}
                  style={[
                    styles.txFilterChip,
                    selected && styles.txFilterChipActive,
                  ]}
                >
                  <Text style={[styles.txFilterChipText, selected && styles.txFilterChipTextActive]}>
                    {filter.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </Card>

        {loadingTransactions && activity.length === 0 ? (
          <>
            <Card>
              <Skeleton height={15} width="30%" radius={8} />
              <SkeletonText lines={3} lineHeight={13} lastLineWidth="54%" />
            </Card>
            <Card>
              <Skeleton height={15} width="24%" radius={8} />
              <SkeletonText lines={3} lineHeight={13} lastLineWidth="50%" />
            </Card>
          </>
        ) : groupedTransactions.length === 0 ? (
          <Card>
            <Text style={styles.cardTitle}>No Transactions</Text>
            <Subtitle>No transactions match this filter yet.</Subtitle>
          </Card>
        ) : (
          groupedTransactions.map((group) => (
            <View key={group.section} style={styles.txSectionWrap}>
              <Text style={styles.txSectionTitle}>{group.section}</Text>
              <Card style={styles.txListCard}>
                {group.rows.map((item, index) => {
                  const tone = transactionStatusTone(item.status)
                  const avatarMeta = getTransactionAvatarMeta(item)
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        closeIdentityProfile()
                        setSelectedTransaction(item)
                      }}
                      style={({ pressed }) => [
                        styles.txRow,
                        index < group.rows.length - 1 && styles.txRowBorder,
                        pressed && styles.txRowPressed,
                      ]}
                    >
                      {avatarMeta.hasRemoteAvatar && avatarMeta.avatarUrl ? (
                        <Image source={{ uri: avatarMeta.avatarUrl }} style={styles.txRowAvatarImage} />
                      ) : (
                        <SvgXml xml={dylanAvatarSvg(avatarMeta.avatarSeed, 64)} width={38} height={38} />
                      )}
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.txRowTitle} numberOfLines={1} ellipsizeMode="tail">
                          {transactionCounterpartyLabel(item)}
                        </Text>
                        <Text style={styles.txRowMeta}>
                          {transactionDirectionLabel(item)} ·{' '}
                          {new Date(item.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </Text>
                      </View>
                      <View style={styles.txRowRight}>
                        <Text
                          style={[
                            styles.txRowAmount,
                            item.direction === 'RECEIVED' ? styles.txRowAmountPositive : styles.txRowAmountNegative,
                          ]}
                        >
                          {transactionAmountLabel(item)}
                        </Text>
                        <Text
                          style={[
                            styles.txRowStatus,
                            tone === 'success'
                              ? styles.txRowStatusSuccess
                              : tone === 'warning'
                                ? styles.txRowStatusWarning
                                : tone === 'danger'
                                  ? styles.txRowStatusDanger
                                  : styles.txRowStatusMuted,
                          ]}
                        >
                          {formatTransactionStatus(item.status)}
                        </Text>
                      </View>
                    </Pressable>
                  )
                })}
              </Card>
            </View>
          ))
        )}
      </Screen>

      <Modal
        visible={Boolean(selectedTransaction)}
        transparent
        animationType="fade"
        onRequestClose={identityProfileOpen ? closeIdentityProfile : closeTransactionDetails}
      >
        <View style={styles.txDetailBackdrop}>
          {selectedTransaction && identityProfileOpen ? (
            <View style={styles.identityProfileCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.identityProfileTitle}>Profile</Text>
                <Pressable style={styles.identityProfileCloseButton} onPress={closeIdentityProfile}>
                  <Text style={styles.identityProfileCloseText}>Back</Text>
                </Pressable>
              </View>

              {loadingIdentityProfile ? (
                <View style={styles.identityProfileLoading}>
                  <ActivityIndicator color={colors.neonPurple} />
                  <Text style={styles.txDetailRecipientMeta}>Loading profile</Text>
                </View>
              ) : identityProfileError ? (
                <Text style={styles.errorText}>{identityProfileError}</Text>
              ) : viewedIdentity ? (
                <>
                  <View style={styles.identityProfileHeader}>
                    {viewedIdentityHasRemoteAvatar && viewedIdentityAvatarUrl ? (
                      <Image source={{ uri: viewedIdentityAvatarUrl }} style={styles.identityProfileAvatarImage} />
                    ) : (
                      <SvgXml xml={viewedIdentityAvatar} width={68} height={68} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.identityProfileName} numberOfLines={1} ellipsizeMode="tail">
                        {formatDisplayName(viewedIdentity.displayName, 'Numia user')}
                      </Text>
                      <Text style={styles.identityProfileHandle} numberOfLines={1} ellipsizeMode="tail">
                        {viewedIdentity.handle}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.profileDetailsWrap}>
                    <ProfileDetailRow
                      label="Display name"
                      value={formatDisplayName(viewedIdentity.displayName, 'Numia user')}
                    />
                    <ProfileDetailRow label="Numia handle" value={viewedIdentity.handle} />
                    <ProfileDetailRow label="Bio" value={viewedIdentity.profile?.bio || 'Not set'} multiLine />
                    <ProfileDetailRow label="X(Twitter)" value={viewedIdentity.profile?.twitterHandle || 'Not set'} />
                    <ProfileDetailRow label="Website" value={viewedIdentity.profile?.websiteUrl || 'Not set'} last />
                  </View>
                </>
              ) : null}
            </View>
          ) : selectedTransaction ? (
            <View style={styles.txDetailCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.txDetailTitle}>Transaction Details</Text>
                <View
                  style={[
                    styles.txDetailStatusPill,
                    selectedStatusTone === 'warning' && styles.txDetailStatusPillWarning,
                    selectedStatusTone === 'danger' && styles.txDetailStatusPillDanger,
                  ]}
                >
                  <Text
                    style={[
                      styles.txDetailStatusText,
                      selectedStatusTone === 'warning' && styles.txDetailStatusTextWarning,
                      selectedStatusTone === 'danger' && styles.txDetailStatusTextDanger,
                    ]}
                  >
                    {formatTransactionStatus(selectedTransaction.status)}
                  </Text>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.txDetailRecipientRow,
                  selectedCounterpartyHandle && pressed && styles.txDetailRecipientRowPressed,
                ]}
                onPress={() => void openIdentityProfile()}
                disabled={!selectedCounterpartyHandle || loadingIdentityProfile}
              >
                {selectedTransactionAvatar?.hasRemoteAvatar && selectedTransactionAvatar.avatarUrl ? (
                  <Image source={{ uri: selectedTransactionAvatar.avatarUrl }} style={styles.txDetailRecipientImage} />
                ) : (
                  <SvgXml
                    xml={dylanAvatarSvg(selectedTransactionAvatar?.avatarSeed ?? 'numia', 72)}
                    width={42}
                    height={42}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.txDetailRecipientName} numberOfLines={1} ellipsizeMode="tail">
                    {transactionCounterpartyLabel(selectedTransaction)}
                  </Text>
                  <Text style={styles.txDetailRecipientMeta}>
                    {selectedCounterpartyHandle ? 'Tap to view profile' : `${transactionDirectionLabel(selectedTransaction)} transaction`}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.txDetailBlock}>
                <InfoRow label="Direction" value={transactionDirectionLabel(selectedTransaction)} />
                <InfoRow label="Amount" value={transactionAmountLabel(selectedTransaction)} />
                <InfoRow label="Recipient" value={transactionCounterpartyLabel(selectedTransaction)} />
                <InfoRow label="Date" value={new Date(selectedTransaction.createdAt).toLocaleString()} />
                <InfoRow label="From" value={transactionFromIdentity(selectedTransaction, ownHandle)} />
                <InfoRow label="To" value={transactionToIdentity(selectedTransaction, ownHandle)} />
              </View>

              <View style={styles.txDetailBlock}>
                <Text style={styles.txDetailLabel}>Reference</Text>
                <Text style={styles.txDetailReference} numberOfLines={2}>
                  {selectedTransaction.txSignature}
                </Text>
                {selectedTransaction.note ? (
                  <>
                    <Text style={styles.txDetailLabel}>Memo</Text>
                    <Text style={styles.txDetailMemo}>{selectedTransaction.note}</Text>
                  </>
                ) : null}
              </View>

              {referenceCopied ? <Text style={styles.successText}>Reference copied</Text> : null}

              <View style={styles.txDetailActions}>
                {selectedCounterpartyHandle ? (
                  <Pressable
                    style={styles.txDetailProfileButton}
                    onPress={() => void openIdentityProfile()}
                    disabled={loadingIdentityProfile}
                  >
                    {loadingIdentityProfile ? (
                      <ActivityIndicator color={colors.neonPurple} />
                    ) : (
                      <Text style={styles.txDetailProfileText}>View Profile</Text>
                    )}
                  </Pressable>
                ) : null}
                <Pressable style={styles.txDetailCopyButton} onPress={() => void copyReference()}>
                  <HugeiconsIcon icon={Copy01Icon} color={colors.neonPurple} size={16} />
                  <Text style={styles.txDetailCopyText}>Copy Reference</Text>
                </Pressable>
                <Pressable style={styles.txDetailDoneButton} onPress={closeTransactionDetails}>
                  <Text style={styles.txDetailDoneText}>Close</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  )
}

function SendScreen() {
  const { wallet, resolveRecipient, sendTransferIntent, busy } = useApp()
  const [amountMode, setAmountMode] = useState<'SOL' | 'USD'>('SOL')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [beneficiariesExpanded, setBeneficiariesExpanded] = useState(false)
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null)
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [priceError, setPriceError] = useState('')
  const [walletBalanceSol, setWalletBalanceSol] = useState<number | null>(null)
  const [walletBalanceLamports, setWalletBalanceLamports] = useState<bigint | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [balanceError, setBalanceError] = useState('')
  const [networkFeeLamports, setNetworkFeeLamports] = useState<bigint>(SOL_TRANSFER_FEE_FALLBACK_LAMPORTS)
  const [loadingFee, setLoadingFee] = useState(false)
  const [feeError, setFeeError] = useState('')
  const [resolvedAddress, setResolvedAddress] = useState('')
  const [resolvedHandle, setResolvedHandle] = useState('')
  const [resolvedDisplayName, setResolvedDisplayName] = useState('')
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(null)
  const [beneficiaryPromptDismissedFor, setBeneficiaryPromptDismissedFor] = useState('')
  const [beneficiaryFeedback, setBeneficiaryFeedback] = useState('')
  const [recipientResolveError, setRecipientResolveError] = useState('')
  const [error, setError] = useState('')
  const [transferModal, setTransferModal] = useState<{
    status: 'success' | 'warning'
    title: string
    subtitle: string
    recipientLabel: string
    recipientAvatarUrl?: string | null
    signature: string
    detail?: string
  } | null>(null)
  const [referenceCopied, setReferenceCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const resolveRequestId = useRef(0)
  const balanceRequestId = useRef(0)
  const feeRequestId = useRef(0)

  const walletAddress = wallet?.address ?? ''
  const recipientPreviewSeed = resolvedHandle || resolvedAddress || recipient
  const resolvedAvatarSeed = useMemo(
    () => avatarSeedFromProfileAvatarUrl(resolvedAvatarUrl, recipientPreviewSeed || 'numia'),
    [recipientPreviewSeed, resolvedAvatarUrl],
  )
  const recipientAvatar = useMemo(() => dylanAvatarSvg(resolvedAvatarSeed, 96), [resolvedAvatarSeed])
  const resolvedHasRemoteAvatar = isRemoteAvatarUrl(resolvedAvatarUrl)
  const isSelfRecipient = Boolean(wallet?.address && resolvedAddress && wallet.address === resolvedAddress)
  const resolvedHandleKey = resolvedHandle.trim().toLowerCase()
  const isSavedBeneficiary = useMemo(() => {
    if (!resolvedHandleKey) return false
    return beneficiaries.some((item) => item.id === resolvedHandleKey)
  }, [beneficiaries, resolvedHandleKey])
  const showBeneficiaryPrompt = Boolean(
    resolvedAddress && resolvedHandleKey && !resolving && !isSavedBeneficiary && beneficiaryPromptDismissedFor !== resolvedHandleKey,
  )

  const loadWalletBalance = useCallback(async () => {
    const requestId = balanceRequestId.current + 1
    balanceRequestId.current = requestId

    if (!walletAddress) {
      setWalletBalanceSol(null)
      setWalletBalanceLamports(null)
      setBalanceError('')
      setLoadingBalance(false)
      return null
    }

    setLoadingBalance(true)
    setBalanceError('')

    try {
      const result = await api.solBalance(walletAddress)
      if (balanceRequestId.current !== requestId) return null

      if (result.success && result.data) {
        setWalletBalanceSol(result.data.sol)
        setWalletBalanceLamports(BigInt(result.data.lamports))
        setBalanceError('')
        return {
          sol: result.data.sol,
          lamports: BigInt(result.data.lamports),
        }
      }

      setWalletBalanceSol(null)
      setWalletBalanceLamports(null)
      setBalanceError(result.error ?? 'Unable to load wallet balance.')
      return null
    } catch {
      if (balanceRequestId.current === requestId) {
        setWalletBalanceSol(null)
        setWalletBalanceLamports(null)
        setBalanceError('Unable to load wallet balance.')
      }
      return null
    } finally {
      if (balanceRequestId.current === requestId) {
        setLoadingBalance(false)
      }
    }
  }, [walletAddress])

  useFocusEffect(
    useCallback(() => {
      let active = true

      const hydrateBeneficiaries = async () => {
        const stored = await loadFreshBeneficiaries()
        if (active) {
          setBeneficiaries(stored)
        }
      }

      void hydrateBeneficiaries()

      return () => {
        active = false
      }
    }, []),
  )

  useFocusEffect(
    useCallback(() => {
      void loadWalletBalance()

      return () => {
        balanceRequestId.current += 1
      }
    }, [loadWalletBalance]),
  )

  useEffect(() => {
    setBeneficiaryFeedback('')
  }, [resolvedHandleKey])

  useEffect(() => {
    let active = true

    const hydrateSolUsdPrice = async () => {
      setLoadingPrice(true)
      setPriceError('')
      const result = await api.solUsdPrice()
      if (!active) return

      if (result.success && result.data) {
        setSolUsdPrice(result.data.usd)
      } else {
        setSolUsdPrice(null)
        setPriceError(result.error ?? 'Unable to fetch SOL/USD price.')
      }
      setLoadingPrice(false)
    }

    void hydrateSolUsdPrice()

    return () => {
      active = false
    }
  }, [])

  const clearResolvedPreview = useCallback(() => {
    setResolvedAddress('')
    setResolvedHandle('')
    setResolvedDisplayName('')
    setResolvedAvatarUrl(null)
  }, [])

  const performResolve = useCallback(async (rawRecipient: string) => {
    const resolved = await resolveRecipient(rawRecipient)
    setResolvedAddress(resolved.address)
    setResolvedHandle(resolved.resolvedHandle ?? '')
    setResolvedDisplayName(resolved.resolvedDisplayName ?? '')
    setResolvedAvatarUrl(resolved.resolvedAvatarUrl ?? null)
    return resolved
  }, [resolveRecipient])

  useEffect(() => {
    const input = recipient.trim()
    const requestId = resolveRequestId.current + 1
    resolveRequestId.current = requestId

    setError('')
    setRecipientResolveError('')

    if (!input) {
      setResolving(false)
      clearResolvedPreview()
      return
    }

    if (!shouldAutoResolveRecipient(input)) {
      setResolving(false)
      clearResolvedPreview()
      return
    }

    setResolving(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await performResolve(input)
          if (resolveRequestId.current !== requestId) return
          setRecipientResolveError('')
        } catch (err) {
          if (resolveRequestId.current !== requestId) return
          clearResolvedPreview()
          setRecipientResolveError(err instanceof Error ? err.message : 'Recipient resolution failed.')
        } finally {
          if (resolveRequestId.current === requestId) {
            setResolving(false)
          }
        }
      })()
    }, 180)

    return () => {
      clearTimeout(timer)
    }
  }, [clearResolvedPreview, performResolve, recipient])

  const onRecipientChange = (value: string) => {
    setRecipient(value)
    setError('')
  }

  const onAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '')
    const normalized = cleaned.startsWith('.') ? `0${cleaned}` : cleaned

    const firstDot = normalized.indexOf('.')
    const clampedDot = firstDot >= 0
      ? `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`
      : normalized

    setAmount(clampedDot)
    setError('')
  }

  const handleUseMaxAmount = async () => {
    setError('')

    if (!walletAddress) {
      setError('Create or import a wallet first.')
      return
    }

    const balance = await loadWalletBalance()
    if (!balance) {
      return
    }

    const maxSendableLamports = balance.lamports > networkFeeLamports
      ? balance.lamports - networkFeeLamports
      : 0n

    setAmountMode('SOL')
    setAmount(formatLamportsAsSol(maxSendableLamports))

    if (maxSendableLamports <= 0n) {
      setError('Your SOL balance is too low to cover the network fee.')
    }
  }

  const parsedAmount = Number(amount.trim())
  const isNumericAmountValid = SOL_AMOUNT_REGEX.test(amount.trim()) && Number.isFinite(parsedAmount) && parsedAmount > 0
  const derivedSolAmount = useMemo(() => {
    if (!isNumericAmountValid) return ''
    if (amountMode === 'SOL') return amount.trim()
    if (!solUsdPrice || solUsdPrice <= 0) return ''

    const inSol = parsedAmount / solUsdPrice
    return formatSolForInput(inSol)
  }, [amount, amountMode, isNumericAmountValid, parsedAmount, solUsdPrice])

  const amountPreview = useMemo(() => {
    if (!isNumericAmountValid) return ''
    if (amountMode === 'SOL') {
      if (!solUsdPrice || solUsdPrice <= 0) return ''
      return `≈ ${formatUsd(parsedAmount * solUsdPrice)}`
    }

    if (!derivedSolAmount) return ''
    return `≈ ${derivedSolAmount} SOL`
  }, [amountMode, derivedSolAmount, isNumericAmountValid, parsedAmount, solUsdPrice])

  const isAmountReadyToSend = Boolean(derivedSolAmount && SOL_AMOUNT_REGEX.test(derivedSolAmount) && Number(derivedSolAmount) > 0)
  const amountLamports = useMemo(() => {
    if (!isAmountReadyToSend) return null

    try {
      return parseSolAmountToLamports(derivedSolAmount)
    } catch {
      return null
    }
  }, [derivedSolAmount, isAmountReadyToSend])
  const requiredLamports = amountLamports !== null ? amountLamports + networkFeeLamports : null
  const maxSendableLamports = walletBalanceLamports !== null
    ? walletBalanceLamports > networkFeeLamports
      ? walletBalanceLamports - networkFeeLamports
      : 0n
    : null
  const hasInsufficientFunds = Boolean(
    walletBalanceLamports !== null &&
      requiredLamports !== null &&
      requiredLamports > walletBalanceLamports,
  )
  const balanceSummary = walletBalanceLamports !== null
    ? `${formatLamportsAsSol(walletBalanceLamports)} SOL`
    : walletBalanceSol !== null
      ? `${formatSolBalance(walletBalanceSol)} SOL`
      : 'Unavailable'
  const feeSummary = `${formatLamportsAsSol(networkFeeLamports)} SOL`
  const requiredSummary = requiredLamports !== null ? `${formatLamportsAsSol(requiredLamports)} SOL` : ''
  const amountSummary = amountLamports !== null ? `${formatLamportsAsSol(amountLamports)} SOL` : ''
  const maxSendableSummary = maxSendableLamports !== null ? `${formatLamportsAsSol(maxSendableLamports)} SOL` : ''

  useEffect(() => {
    const requestId = feeRequestId.current + 1
    feeRequestId.current = requestId
    setFeeError('')

    if (!walletAddress || !resolvedAddress || !derivedSolAmount || amountLamports === null || isSelfRecipient) {
      setNetworkFeeLamports(SOL_TRANSFER_FEE_FALLBACK_LAMPORTS)
      setLoadingFee(false)
      return
    }

    setLoadingFee(true)
    const timer = setTimeout(() => {
      void estimateSolTransferFeeLamports({
        fromAddress: walletAddress,
        toAddress: resolvedAddress,
        amount: derivedSolAmount,
        rpcUrl: api.solanaRpcUrl,
      })
        .then((feeLamports) => {
          if (feeRequestId.current !== requestId) return
          setNetworkFeeLamports(feeLamports)
        })
        .catch(() => {
          if (feeRequestId.current !== requestId) return
          setNetworkFeeLamports(SOL_TRANSFER_FEE_FALLBACK_LAMPORTS)
          setFeeError('Using estimated network fee.')
        })
        .finally(() => {
          if (feeRequestId.current === requestId) {
            setLoadingFee(false)
          }
        })
    }, 220)

    return () => {
      clearTimeout(timer)
    }
  }, [amountLamports, derivedSolAmount, isSelfRecipient, resolvedAddress, walletAddress])

  const useBeneficiary = (entry: Beneficiary) => {
    setRecipient(entry.handle)
    setBeneficiariesExpanded(false)
    setError('')
    setRecipientResolveError('')
    setBeneficiaryFeedback('')
  }

  const saveCurrentBeneficiary = async () => {
    if (!resolvedHandleKey) return

    try {
      const nextEntry: Beneficiary = {
        id: resolvedHandleKey,
        handle: resolvedHandle,
        displayName: formatDisplayName(
          resolvedDisplayName || resolvedHandle.split('@')[0],
          'NUMIA contact',
        ),
        avatarUrl: resolvedAvatarUrl ?? null,
        savedAt: new Date().toISOString(),
      }

      const nextList = [nextEntry, ...beneficiaries.filter((item) => item.id !== resolvedHandleKey)].slice(0, 24)
      setBeneficiaries(nextList)
      setBeneficiariesExpanded(true)
      setBeneficiaryPromptDismissedFor(resolvedHandleKey)
      setBeneficiaryFeedback(`${resolvedHandle} saved to beneficiaries.`)
      await saveBeneficiaries(nextList)
    } catch {
      setError('Could not save beneficiary. Please try again.')
    }
  }

  const dismissBeneficiaryPrompt = () => {
    if (!resolvedHandleKey) return
    setBeneficiaryPromptDismissedFor(resolvedHandleKey)
    setBeneficiaryFeedback('')
  }

  const openTransferModal = useCallback((payload: {
    status: 'success' | 'warning'
    title: string
    subtitle: string
    recipientLabel: string
    recipientAvatarUrl?: string | null
    signature: string
    detail?: string
  }) => {
    setTransferModal(payload)
    setReferenceCopied(false)
  }, [])

  const closeTransferModal = () => {
    setTransferModal(null)
  }

  const copyTransferReference = async () => {
    if (!transferModal?.signature) return
    await Clipboard.setStringAsync(transferModal.signature)
    setReferenceCopied(true)
    setTimeout(() => setReferenceCopied(false), 1400)
  }

  const transferReferencePreview = transferModal?.signature
    ? shortAddress(transferModal.signature, 12, 12)
    : ''
  const transferModalAvatarSeed = useMemo(
    () =>
      avatarSeedFromProfileAvatarUrl(
        transferModal?.recipientAvatarUrl,
        transferModal?.recipientLabel ?? 'numia',
      ),
    [transferModal?.recipientAvatarUrl, transferModal?.recipientLabel],
  )
  const transferModalAvatar = useMemo(() => dylanAvatarSvg(transferModalAvatarSeed, 72), [transferModalAvatarSeed])
  const transferModalHasRemoteAvatar = isRemoteAvatarUrl(transferModal?.recipientAvatarUrl)

  const handleSend = async () => {
    setError('')
    const normalizedAmount = derivedSolAmount
    const numeric = Number(normalizedAmount)
    const normalizedRecipient = recipient.trim()
    const normalizedNote = note.trim()

    if (!recipient.trim()) {
      setError('Enter a recipient handle or wallet address.')
      return
    }
    if (!isAmountReadyToSend || !SOL_AMOUNT_REGEX.test(normalizedAmount) || Number.isNaN(numeric) || numeric <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (amountMode === 'USD' && (!solUsdPrice || solUsdPrice <= 0)) {
      setError('SOL/USD price is unavailable right now. Try again in a moment.')
      return
    }
    if (!wallet) {
      setError('Create or import a wallet first.')
      return
    }
    if (hasInsufficientFunds) {
      setError(
        maxSendableSummary
          ? `Not enough SOL to cover the amount plus network fee. Try sending ${maxSendableSummary} or less.`
          : 'Not enough SOL to cover the amount plus network fee.',
      )
      return
    }

    setSending(true)

    try {
      const resolved = await performResolve(normalizedRecipient)
      if (wallet.address === resolved.address) {
        setError('You cannot send crypto to your own wallet.')
        return
      }

      const txSignature = await sendSolTransfer({
        wallet,
        toAddress: resolved.address,
        amount: normalizedAmount,
        rpcUrl: api.solanaRpcUrl,
      })

      try {
        await sendTransferIntent({
          recipient: normalizedRecipient,
          amount: normalizedAmount,
          note: normalizedNote || undefined,
          chain: 'SOL',
          txSignature,
          status: 'CONFIRMED',
        })
      } catch (recordError) {
        const backendError = recordError instanceof Error
          ? recordError.message
          : 'Unable to sync transfer history.'

        openTransferModal({
          status: 'warning',
          title: 'Sent On-Chain, Sync Pending',
          subtitle: 'Account sent',
          recipientLabel: resolved.resolvedHandle ?? shortAddress(resolved.address, 6, 6),
          recipientAvatarUrl: resolved.resolvedAvatarUrl ?? null,
          signature: txSignature,
          detail: backendError,
        })

        setRecipient('')
        setAmount('')
        setNote('')
        clearResolvedPreview()
        setRecipientResolveError('')
        return
      }

      openTransferModal({
        status: 'success',
        title: 'Transfer Confirmed',
        subtitle: 'Account sent',
        recipientLabel: resolved.resolvedHandle ?? shortAddress(resolved.address, 6, 6),
        recipientAvatarUrl: resolved.resolvedAvatarUrl ?? null,
        signature: txSignature,
      })

      setRecipient('')
      setAmount('')
      setNote('')
      clearResolvedPreview()
      setRecipientResolveError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
    <Screen scroll flushBottom>
      <Title>Send</Title>
      <Subtitle>
        Identity-first send flow: type a NUMIA handle or wallet address. NUMIA resolves it and sends on-chain.
      </Subtitle>

      <Input label="Recipient" value={recipient} onChangeText={onRecipientChange} placeholder="alex@numia or 7Uvxx..." />

      {resolving ? (
        <Card>
          <Text style={styles.cardTitle}>Resolving recipient...</Text>
          <View style={styles.recipientPreviewHeader}>
            <Skeleton height={44} width={44} radius={22} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton height={16} width="52%" radius={8} />
              <Skeleton height={12} width="68%" radius={8} />
            </View>
          </View>
          <Skeleton height={12} width="100%" radius={8} />
        </Card>
      ) : null}

      {resolvedAddress && !resolving ? (
        <Card>
          <Text style={styles.cardTitle}>Resolved Target</Text>
          <View style={styles.recipientPreviewHeader}>
            {resolvedHasRemoteAvatar && resolvedAvatarUrl ? (
              <Image source={{ uri: resolvedAvatarUrl }} style={styles.recipientAvatarImage} />
            ) : (
              <SvgXml xml={recipientAvatar} width={44} height={44} />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.recipientPreviewTitle} numberOfLines={1} ellipsizeMode="tail">
                {formatDisplayName(
                  resolvedDisplayName,
                  resolvedHandle || shortAddress(resolvedAddress, 6, 6),
                )}
              </Text>
              <Text style={styles.recipientPreviewSub} numberOfLines={1} ellipsizeMode="tail">
                {resolvedHandle || shortAddress(resolvedAddress, 6, 6)}
              </Text>
            </View>
          </View>
          {isSelfRecipient ? <Text style={styles.errorTextSmall}>You cannot send crypto to yourself.</Text> : null}
        </Card>
      ) : null}

      {beneficiaries.length > 0 ? (
        <Card>
          <Pressable
            style={styles.beneficiaryHeaderButton}
            onPress={() => setBeneficiariesExpanded((current) => !current)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Beneficiaries</Text>
              <Text style={styles.beneficiaryHeaderMeta}>
                {beneficiaries.length} saved · {beneficiariesExpanded ? 'Tap to collapse' : 'Tap to expand'}
              </Text>
            </View>
            <HugeiconsIcon
              icon={ArrowDown02Icon}
              color={colors.textMuted}
              size={18}
              style={[
                styles.beneficiaryChevron,
                beneficiariesExpanded && styles.beneficiaryChevronExpanded,
              ]}
              strokeWidth={1.8}
            />
          </Pressable>

          {beneficiariesExpanded ? (
            <View style={styles.beneficiaryList}>
              {beneficiaries.slice(0, 8).map((entry) => (
                <Pressable
                  key={entry.id}
                  style={styles.beneficiaryChip}
                  onPress={() => useBeneficiary(entry)}
                >
                  {entry.avatarUrl && isRemoteAvatarUrl(entry.avatarUrl) ? (
                    <Image source={{ uri: entry.avatarUrl }} style={styles.beneficiaryAvatarImage} />
                  ) : (
                    <SvgXml
                      xml={dylanAvatarSvg(avatarSeedFromProfileAvatarUrl(entry.avatarUrl, entry.handle), 56)}
                      width={28}
                      height={28}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.beneficiaryName} numberOfLines={1} ellipsizeMode="tail">
                      {formatDisplayName(entry.displayName, 'NUMIA contact')}
                    </Text>
                    <Text style={styles.beneficiaryHandle} numberOfLines={1} ellipsizeMode="tail">
                      {entry.handle}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.amountModeRow}>
        <Pressable
          style={[styles.amountModeButton, amountMode === 'SOL' && styles.amountModeButtonActive]}
          onPress={() => {
            setAmountMode('SOL')
            setError('')
          }}
        >
          <Text style={[styles.amountModeButtonText, amountMode === 'SOL' && styles.amountModeButtonTextActive]}>SOL</Text>
        </Pressable>
        <Pressable
          style={[styles.amountModeButton, amountMode === 'USD' && styles.amountModeButtonActive]}
          onPress={() => {
            setAmountMode('USD')
            setError('')
          }}
        >
          <Text style={[styles.amountModeButtonText, amountMode === 'USD' && styles.amountModeButtonTextActive]}>USD</Text>
        </Pressable>
      </View>
      <Input
        label={amountMode === 'SOL' ? 'Amount (SOL)' : 'Amount (USD)'}
        value={amount}
        onChangeText={onAmountChange}
        placeholder={amountMode === 'SOL' ? '0.25' : '15.00'}
        keyboardType="decimal-pad"
        rightAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use maximum balance"
            disabled={!walletAddress || loadingBalance}
            onPress={() => void handleUseMaxAmount()}
            style={({ pressed }) => [
              styles.amountMaxButton,
              pressed && styles.amountMaxButtonPressed,
              (!walletAddress || loadingBalance) && styles.amountMaxButtonDisabled,
            ]}
          >
            <Text style={[styles.amountMaxButtonText, (!walletAddress || loadingBalance) && styles.amountMaxButtonTextDisabled]}>
              Max
            </Text>
          </Pressable>
        }
      />
      {walletAddress && !balanceError && walletBalanceSol !== null ? (
        <Text style={styles.infoText}>
          Balance: {formatSolBalance(walletBalanceSol)} SOL
        </Text>
      ) : null}
      {balanceError ? <Text style={styles.errorTextSmall}>{balanceError}</Text> : null}
      {amountMode === 'USD' && loadingPrice ? <Text style={styles.infoText}>Loading SOL/USD price...</Text> : null}
      {amountPreview ? <Text style={styles.infoText}>{amountPreview}</Text> : null}
      {amountMode === 'USD' && !loadingPrice && priceError ? <Text style={styles.errorTextSmall}>{priceError}</Text> : null}
      {amountLamports !== null ? (
        <View style={[styles.feeSummaryPanel, hasInsufficientFunds && styles.feeSummaryPanelWarning]}>
          <View style={styles.feeSummaryRow}>
            <Text style={styles.feeSummaryLabel}>Amount</Text>
            <Text style={styles.feeSummaryValue}>{amountSummary}</Text>
          </View>
          <View style={styles.feeSummaryRow}>
            <Text style={styles.feeSummaryLabel}>Network fee</Text>
            <Text style={styles.feeSummaryValue}>
              {loadingFee ? `Calculating... ${feeSummary}` : feeSummary}
            </Text>
          </View>
          <View style={styles.feeSummaryRow}>
            <Text style={styles.feeSummaryLabel}>Total needed</Text>
            <Text style={[styles.feeSummaryValue, hasInsufficientFunds && styles.feeSummaryValueWarning]}>
              {requiredSummary}
            </Text>
          </View>
          <View style={styles.feeSummaryRow}>
            <Text style={styles.feeSummaryLabel}>Balance</Text>
            <Text style={[styles.feeSummaryValue, hasInsufficientFunds && styles.feeSummaryValueWarning]}>
              {balanceSummary}
            </Text>
          </View>
          {hasInsufficientFunds ? (
            <Text style={styles.feeSummaryWarning}>
              Insufficient funds. {maxSendableSummary ? `Try ${maxSendableSummary} or less.` : 'Reduce the amount and try again.'}
            </Text>
          ) : null}
          {feeError ? <Text style={styles.feeSummaryMeta}>{feeError}</Text> : null}
        </View>
      ) : null}
      <Input label="Memo (optional)" value={note} onChangeText={setNote} placeholder="Dinner split" />

      {showBeneficiaryPrompt && !isSelfRecipient ? (
        <Card>
          <Text style={styles.cardTitle}>Save Beneficiary?</Text>
          <Subtitle>Do you want to save this identity for faster future sends?</Subtitle>
          <View style={styles.beneficiaryPromptActions}>
            <Pressable style={styles.beneficiaryPromptButton} onPress={dismissBeneficiaryPrompt}>
              <Text style={styles.beneficiaryPromptButtonText}>Not now</Text>
            </Pressable>
            <Pressable style={styles.beneficiaryPromptButtonPrimary} onPress={() => void saveCurrentBeneficiary()}>
              <Text style={styles.beneficiaryPromptButtonPrimaryText}>Save</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {beneficiaryFeedback ? <Text style={styles.successText}>{beneficiaryFeedback}</Text> : null}
      {recipientResolveError ? <Text style={styles.errorTextSmall}>{recipientResolveError}</Text> : null}
      {error ? (
        <View style={styles.sendErrorPanel}>
          <Text style={styles.sendErrorTitle}>Transfer not sent</Text>
          <Text style={styles.sendErrorBody}>{error}</Text>
        </View>
      ) : null}

      <AppButton
        label="Send"
        onPress={() => void handleSend()}
        loading={sending || busy}
        disabled={!recipient.trim() || !amount.trim() || !isAmountReadyToSend || isSelfRecipient || hasInsufficientFunds}
      />
    </Screen>
    <Modal
      visible={Boolean(transferModal)}
      transparent
      animationType="fade"
      onRequestClose={closeTransferModal}
    >
      <View style={styles.txModalBackdrop}>
        <View style={styles.txModalCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.txModalTitle}>{transferModal?.title}</Text>
            <View
              style={[
                styles.txModalStatusPill,
                transferModal?.status === 'warning' && styles.txModalStatusPillWarning,
              ]}
            >
              <Text
                style={[
                  styles.txModalStatusText,
                  transferModal?.status === 'warning' && styles.txModalStatusTextWarning,
                ]}
              >
                {transferModal?.status === 'warning' ? 'Pending' : 'Success'}
              </Text>
            </View>
          </View>

          <Text style={styles.txModalSubtitle}>{transferModal?.subtitle}</Text>

          <View style={styles.txModalMetaCard}>
            <Text style={styles.txModalMetaLabel}>Recipient</Text>
            <View style={styles.txRecipientRow}>
              {transferModalHasRemoteAvatar && transferModal?.recipientAvatarUrl ? (
                <Image source={{ uri: transferModal.recipientAvatarUrl }} style={styles.txRecipientImage} />
              ) : (
                <SvgXml xml={transferModalAvatar} width={36} height={36} />
              )}
              <Text style={styles.txModalMetaValue}>{transferModal?.recipientLabel}</Text>
            </View>

            <Text style={styles.txModalMetaLabel}>Reference</Text>
            <Text style={styles.txModalReference} numberOfLines={1} ellipsizeMode="middle">
              {transferReferencePreview}
            </Text>
          </View>

          {transferModal?.detail ? (
            <Text style={styles.txModalDetail} numberOfLines={3}>
              Sync detail: {transferModal.detail}
            </Text>
          ) : null}

          {referenceCopied ? <Text style={styles.successText}>Reference copied</Text> : null}

          <View style={styles.txModalActions}>
            <Pressable style={styles.txModalCopyButton} onPress={() => void copyTransferReference()}>
              <HugeiconsIcon icon={Copy01Icon} color={colors.neonPurple} size={16} />
              <Text style={styles.txModalCopyText}>Copy Reference</Text>
            </Pressable>
            <Pressable style={styles.txModalDoneButton} onPress={closeTransferModal}>
              <Text style={styles.txModalDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  )
}

function ReceiveScreen() {
  const { session, wallet } = useApp()
  const [copied, setCopied] = useState(false)

  const displayHandle = session?.identity.handle ?? 'unknown@numia'
  const address = wallet?.address ?? session?.identity.walletAddress ?? ''
  const showReceiveSkeleton = !session?.identity || !address

  const copy = async (value: string) => {
    await Clipboard.setStringAsync(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <Screen scroll flushBottom>
      <Title>Receive</Title>
      <Subtitle>Share your NUMIA identity or raw wallet address and receive funds faster.</Subtitle>

      <Card style={{ alignItems: 'center' }}>
        {showReceiveSkeleton ? (
          <View style={{ width: '100%', alignItems: 'center', gap: spacing.md }}>
            <Skeleton height={14} width="54%" radius={8} />
            <Skeleton height={30} width="72%" radius={10} />
            <Skeleton height={218} width={218} radius={22} />
            <Skeleton height={12} width="88%" radius={8} />
            <View style={{ flexDirection: 'row', width: '100%', gap: spacing.md }}>
              <Skeleton height={42} width="48%" radius={12} />
              <Skeleton height={42} width="48%" radius={12} />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.cardTitle}>Primary Receive Handle</Text>
            <Text style={styles.identityPreview}>{displayHandle}</Text>

            <View style={styles.qrWrap}>
              <QRCode value={displayHandle} size={190} color="#0A1122" backgroundColor="#FFFFFF" />
            </View>

            <Text style={styles.monoSoft}>{address}</Text>

            <View style={styles.copyRow}>
              <Pressable style={styles.copyButton} onPress={() => void copy(displayHandle)}>
                <HugeiconsIcon icon={Copy01Icon} color={colors.neonBlue} size={18} />
                <Text style={styles.copyText}>Copy Handle</Text>
              </Pressable>

              <Pressable style={styles.copyButton} onPress={() => void copy(address)}>
                <HugeiconsIcon icon={QrCode01Icon} color={colors.neonBlue} size={18} />
                <Text style={styles.copyText}>Copy Address</Text>
              </Pressable>
            </View>
          </>
        )}

        {copied && !showReceiveSkeleton ? <Text style={styles.successText}>Copied</Text> : null}
      </Card>

      {showReceiveSkeleton ? (
        <Card>
          <Skeleton height={14} width="36%" radius={8} />
          <SkeletonText lines={2} lineHeight={12} lastLineWidth="68%" />
        </Card>
      ) : (
        <Card>
          <FeatureRow
            title="Identity-first receiving"
            description="Tell people your handle first. NUMIA resolves the wallet underneath."
            icon={IdentityCardIcon}
          />
        </Card>
      )}
    </Screen>
  )
}

function ProfileScreen() {
  const {
    session,
    wallet,
    linkedWallets,
    logout,
    clearLocalWallet,
    updateProfile,
    busy,
    isDarkMode,
    setThemeMode,
  } = useApp()
  const [bio, setBio] = useState(session?.identity.profile?.bio ?? '')
  const [twitterHandle, setTwitterHandle] = useState(session?.identity.profile?.twitterHandle ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(session?.identity.profile?.websiteUrl ?? '')
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'profile' | 'settings'>('profile')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [showSecrets, setShowSecrets] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [removingWallet, setRemovingWallet] = useState(false)
  const [accountActionError, setAccountActionError] = useState('')
  const [copiedSecret, setCopiedSecret] = useState<'phrase' | 'key' | null>(null)

  const displayHandle = session?.identity.handle ?? 'unknown@numia'
  const displayName = formatDisplayName(session?.identity.displayName, 'NUMIA user')
  const profileAvatarUrl = session?.identity.profile?.avatarUrl ?? null
  const avatarSeed = useMemo(
    () => avatarSeedFromProfileAvatarUrl(profileAvatarUrl, displayHandle),
    [displayHandle, profileAvatarUrl],
  )
  const hasRemoteProfileAvatar = isRemoteAvatarUrl(profileAvatarUrl)
  const avatar = useMemo(() => dylanAvatarSvg(avatarSeed, 120), [avatarSeed])
  const [selectedAvatarSeed, setSelectedAvatarSeed] = useState(avatarSeed)
  const selectedAvatar = useMemo(() => dylanAvatarSvg(selectedAvatarSeed, 120), [selectedAvatarSeed])
  const avatarOptions = useMemo(() => {
    const baseRaw = (session?.identity.displayName ?? displayHandle).toLowerCase()
    const base = baseRaw.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'numia'

    const list = [
      avatarSeed,
      `${base}`,
      `${base}-1`,
      `${base}-2`,
      `${base}-3`,
      `${base}-4`,
      `${base}-5`,
      `${base}-6`,
      `${base}-7`,
      `${base}-8`,
      `${base}-9`,
    ]

    return Array.from(new Set(list))
  }, [avatarSeed, displayHandle, session?.identity.displayName])
  const avatarOptionSvgs = useMemo(
    () => avatarOptions.map((seed) => ({ seed, xml: dylanAvatarSvg(seed, 72) })),
    [avatarOptions],
  )
  const recoveryPhrase = wallet?.mnemonic ?? ''
  const privateKey = wallet?.secretKeyBase58 ?? ''
  const loadingProfileSection = busy && activeSection === 'profile'
  const loadingSettingsSection = busy && activeSection === 'settings'

  const originalBio = session?.identity.profile?.bio ?? ''
  const originalTwitter = session?.identity.profile?.twitterHandle ?? ''
  const originalWebsite = session?.identity.profile?.websiteUrl ?? ''

  useEffect(() => {
    setBio(originalBio)
    setTwitterHandle(originalTwitter)
    setWebsiteUrl(originalWebsite)
    setSelectedAvatarSeed(avatarSeed)
  }, [avatarSeed, originalBio, originalTwitter, originalWebsite])

  if (!session?.identity) {
    return (
      <Screen scroll flushBottom>
        <View style={styles.profileHeader}>
          <Skeleton height={74} width={74} radius={37} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton height={28} width="52%" radius={10} />
            <Skeleton height={16} width="74%" radius={8} />
          </View>
        </View>
        <Card>
          <Skeleton height={14} width="38%" radius={8} />
          <SkeletonText lines={5} lineHeight={14} />
        </Card>
      </Screen>
    )
  }

  const save = async () => {
    setError('')

    try {
      await updateProfile({
        bio,
        twitterHandle,
        websiteUrl,
        avatarUrl: avatarUrlFromSeed(selectedAvatarSeed),
      })
      setIsEditingProfile(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.')
    }
  }

  const startEditProfile = () => {
    setError('')
    setBio(originalBio)
    setTwitterHandle(originalTwitter)
    setWebsiteUrl(originalWebsite)
    setSelectedAvatarSeed(avatarSeed)
    setIsEditingProfile(true)
  }

  const cancelEditProfile = () => {
    setError('')
    setBio(originalBio)
    setTwitterHandle(originalTwitter)
    setWebsiteUrl(originalWebsite)
    setSelectedAvatarSeed(avatarSeed)
    setIsEditingProfile(false)
  }

  const copySecret = async (value: string, kind: 'phrase' | 'key') => {
    if (!value) return
    await Clipboard.setStringAsync(value)
    setCopiedSecret(kind)
    setTimeout(() => setCopiedSecret(null), 1400)
  }

  const handleLogout = async () => {
    setAccountActionError('')
    setLoggingOut(true)

    try {
      await logout()
    } catch (err) {
      setLoggingOut(false)
      setAccountActionError(err instanceof Error ? err.message : 'Could not sign out.')
    }
  }

  const confirmLogout = () => {
    setAccountActionError('')
    Alert.alert(
      'Sign out?',
      'Your wallet stays on this device. You can sign in again with the same wallet.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => void handleLogout() },
      ],
    )
  }

  const handleRemoveWallet = async () => {
    setAccountActionError('')
    setRemovingWallet(true)

    try {
      await clearLocalWallet()
    } catch (err) {
      setRemovingWallet(false)
      setAccountActionError(err instanceof Error ? err.message : 'Could not remove local wallet.')
    }
  }

  const confirmRemoveWallet = () => {
    setAccountActionError('')
    Alert.alert(
      'Remove local wallet?',
      'This signs you out and removes the wallet stored on this device. Keep your recovery phrase before continuing.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove Wallet', style: 'destructive', onPress: () => void handleRemoveWallet() },
      ],
    )
  }

  return (
    <Screen scroll flushBottom>
      <View style={styles.profileHeader}>
        {isEditingProfile ? (
          <SvgXml xml={selectedAvatar} width={74} height={74} />
        ) : hasRemoteProfileAvatar && profileAvatarUrl ? (
          <Image source={{ uri: profileAvatarUrl }} style={styles.profileAvatarImage} />
        ) : (
          <SvgXml xml={avatar} width={74} height={74} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName} numberOfLines={1} ellipsizeMode="tail">
            {displayName}
          </Text>
          <Text style={styles.profileIdentity} numberOfLines={1} ellipsizeMode="tail">
            {displayHandle}
          </Text>
        </View>
        <Pressable
          onPress={confirmLogout}
          disabled={loggingOut || busy}
          style={({ pressed }) => [
            styles.profileLogoutButton,
            pressed && styles.profileLogoutButtonPressed,
            (loggingOut || busy) && styles.profileLogoutButtonDisabled,
          ]}
        >
          <Text style={styles.profileLogoutButtonText}>
            {loggingOut ? 'Signing out' : 'Sign out'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.sectionTabs}>
        <Pressable
          onPress={() => setActiveSection('profile')}
          style={[styles.sectionTab, activeSection === 'profile' && styles.sectionTabActive]}
        >
          <Text style={[styles.sectionTabText, activeSection === 'profile' && styles.sectionTabTextActive]}>
            Profile
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (isEditingProfile) {
              cancelEditProfile()
            }
            setActiveSection('settings')
          }}
          style={[styles.sectionTab, activeSection === 'settings' && styles.sectionTabActive]}
        >
          <Text style={[styles.sectionTabText, activeSection === 'settings' && styles.sectionTabTextActive]}>
            Settings
          </Text>
        </Pressable>
      </View>

      {accountActionError ? <Text style={styles.errorText}>{accountActionError}</Text> : null}

      {activeSection === 'profile' ? (
        <>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Profile</Text>
              {!loadingProfileSection ? (
                <Pressable
                  onPress={isEditingProfile ? () => void cancelEditProfile() : () => void startEditProfile()}
                  style={({ pressed }) => [styles.inlineActionButton, pressed && styles.inlineActionButtonPressed]}
                >
                  <Text style={styles.inlineActionButtonText}>
                    {isEditingProfile ? 'Cancel' : 'Edit Profile'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {loadingProfileSection ? (
              <View style={{ gap: spacing.md }}>
                <Skeleton height={12} width="42%" radius={8} />
                <Skeleton height={52} width="100%" radius={12} />
                <Skeleton height={12} width="34%" radius={8} />
                <Skeleton height={112} width="100%" radius={12} />
                <Skeleton height={52} width="100%" radius={12} />
              </View>
            ) : !isEditingProfile ? (
              <>
                <View style={styles.profileShowcaseCard}>
                  <Text style={styles.profileShowcaseTitle}>NUMIA Identity</Text>
                  <Text style={styles.profileShowcaseHandle} numberOfLines={1} ellipsizeMode="tail">
                    {displayHandle}
                  </Text>
                </View>

                <View style={styles.profileDetailsWrap}>
                  <ProfileDetailRow label="Display name" value={displayName} />
                  <ProfileDetailRow label="Numia handle" value={displayHandle} />
                  <ProfileDetailRow label="Bio" value={originalBio || 'Not set'} multiLine />
                  <ProfileDetailRow label="X(Twitter)" value={originalTwitter || 'Not set'} />
                  <ProfileDetailRow label="Website" value={originalWebsite || 'Not set'} last />
                </View>
              </>
            ) : (
              <>
                <View style={styles.avatarPickerSection}>
                  <Text style={styles.avatarPickerLabel}>Avatar</Text>
                  <View style={styles.avatarPickerGrid}>
                    {avatarOptionSvgs.map((item) => {
                      const selected = item.seed === selectedAvatarSeed
                      return (
                        <Pressable
                          key={item.seed}
                          onPress={() => setSelectedAvatarSeed(item.seed)}
                          style={({ pressed }) => [
                            styles.avatarOption,
                            selected && styles.avatarOptionSelected,
                            pressed && styles.avatarOptionPressed,
                          ]}
                        >
                          <SvgXml xml={item.xml} width={40} height={40} />
                        </Pressable>
                      )
                    })}
                  </View>
                </View>

                <Input label="Bio" value={bio} onChangeText={setBio} multiline />
                <Input label="X(Twitter)" value={twitterHandle} onChangeText={setTwitterHandle} placeholder="@username" />
                <Input label="Website" value={websiteUrl} onChangeText={setWebsiteUrl} placeholder="https://" />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <AppButton label="Save Profile" onPress={() => void save()} loading={busy} />
              </>
            )}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Linked Wallets</Text>
            {loadingProfileSection ? (
              <View style={{ gap: spacing.md }}>
                <Skeleton height={14} width="32%" radius={8} />
                <Skeleton height={12} width="62%" radius={8} />
              </View>
            ) : (
              (linkedWallets.length > 0 ? linkedWallets : session?.identity.wallets ?? []).map((item) => (
                <View key={item.id} style={styles.walletRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.chain}</Text>
                    <Text style={styles.monoSoft}>{shortAddress(item.address, 6, 6)}</Text>
                  </View>
                  {item.isPrimary ? <Text style={styles.primaryTag}>PRIMARY</Text> : null}
                </View>
              ))
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <View style={styles.settingToggleRow}>
              <View style={styles.settingIconBubble}>
                <HugeiconsIcon icon={Moon02Icon} color={colors.neonPurple} size={20} strokeWidth={1.9} />
              </View>
              <View style={styles.settingTextBlock}>
                <Text style={styles.settingTitle}>Dark Mode</Text>
                <Text style={styles.settingDescription}>
                  Switch NUMIA into a deeper, lower-glare interface.
                </Text>
              </View>
              <Switch
                value={isDarkMode}
                onValueChange={(enabled) => void setThemeMode(enabled ? 'dark' : 'light')}
                trackColor={{ false: colors.border, true: '#5B41D8' }}
                thumbColor={isDarkMode ? '#F7F2FF' : '#FFFFFF'}
                ios_backgroundColor={colors.border}
              />
            </View>
          </Card>

          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Recovery & Private Key</Text>
              <Pressable onPress={() => setShowSecrets((current) => !current)} style={styles.secretEyeButton}>
                <HugeiconsIcon
                  icon={showSecrets ? ViewIcon : ViewOffIcon}
                  color={colors.neonPurple}
                  size={16}
                  strokeWidth={1.9}
                />
              </Pressable>
            </View>
            <Subtitle>
              Never share these details. Anyone who has them can control your wallet.
            </Subtitle>
            {loadingSettingsSection ? (
              <View style={{ gap: spacing.md }}>
                <Skeleton height={112} width="100%" radius={14} />
                <Skeleton height={112} width="100%" radius={14} />
              </View>
            ) : (
              <>
                <View style={styles.secretBlock}>
                  <Text style={styles.secretLabel}>Recovery Phrase</Text>
                  <Text style={styles.secretValue}>
                    {showSecrets
                      ? (recoveryPhrase || 'No recovery phrase available for this wallet.')
                      : '•••• •••• •••• •••• •••• •••• •••• ••••'}
                  </Text>
                  <Pressable
                    style={styles.secretCopyButton}
                    onPress={() => void copySecret(recoveryPhrase, 'phrase')}
                    disabled={!recoveryPhrase}
                  >
                    <HugeiconsIcon icon={Copy01Icon} color={recoveryPhrase ? colors.neonPurple : colors.textDim} size={16} />
                    <Text style={[styles.secretCopyText, !recoveryPhrase && styles.secretCopyTextDisabled]}>
                      {copiedSecret === 'phrase' ? 'Copied' : 'Copy Phrase'}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.secretBlock}>
                  <Text style={styles.secretLabel}>Private Key (Base58)</Text>
                  <Text style={styles.secretValue} numberOfLines={showSecrets ? 0 : 1} ellipsizeMode="tail">
                    {showSecrets
                      ? (privateKey || 'Private key unavailable.')
                      : '••••••••••••••••••••••••••••••••••••••••••'}
                  </Text>
                  <Pressable
                    style={styles.secretCopyButton}
                    onPress={() => void copySecret(privateKey, 'key')}
                    disabled={!privateKey}
                  >
                    <HugeiconsIcon icon={Copy01Icon} color={privateKey ? colors.neonPurple : colors.textDim} size={16} />
                    <Text style={[styles.secretCopyText, !privateKey && styles.secretCopyTextDisabled]}>
                      {copiedSecret === 'key' ? 'Copied' : 'Copy Private Key'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </Card>

          <AppButton label="Sign Out" onPress={confirmLogout} loading={loggingOut} variant="secondary" />
          <AppButton label="Remove Local Wallet" onPress={confirmRemoveWallet} loading={removingWallet} variant="ghost" />
        </>
      )}
    </Screen>
  )
}

function FeatureRow({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: IconSvgElement
}) {
  return (
    <View style={styles.featureRow}>
      <IconBubble icon={icon} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{description}</Text>
      </View>
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.rowBody}>{label}</Text>
      <Text style={styles.rowTitleValue} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  )
}

function ProfileDetailRow({
  label,
  value,
  multiLine = false,
  last = false,
}: {
  label: string
  value: string
  multiLine?: boolean
  last?: boolean
}) {
  return (
    <View style={[styles.profileDetailRow, last && styles.profileDetailRowLast]}>
      <Text style={styles.profileDetailLabel}>{label}</Text>
      <Text
        style={styles.profileDetailValue}
        numberOfLines={multiLine ? 0 : 2}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
    </View>
  )
}

let styles = createAppStyles(colors)

function createAppStyles(colors: ThemeColors) {
  const isDark = colors.bg !== lightColors.bg
  const surface = colors.card
  const softSurface = colors.cardAlt
  const accentSoft = isDark ? '#2B2148' : '#EEE6FF'
  const accentBorder = isDark ? '#4A3A72' : '#DCCFFF'
  const successSoft = isDark ? 'rgba(79, 214, 159, 0.16)' : '#EBFFF4'
  const warningSoft = isDark ? 'rgba(244, 184, 97, 0.16)' : '#FFF7EE'
  const dangerSoft = isDark ? 'rgba(255, 107, 155, 0.14)' : '#FFF0F6'
  const dangerPanel = isDark ? 'rgba(255, 107, 155, 0.12)' : '#FFF0F2'

  return StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    gap: spacing.lg,
  },
  launchScreen: {
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  launchHeader: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchWordmark: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 2.6,
    fontWeight: '800',
    textAlign: 'center',
  },
  launchStage: {
    width: '100%',
    height: 430,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchRouteLine: {
    position: 'absolute',
    width: 260,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.border,
    transform: [{ rotate: '27deg' }],
  },
  launchRouteLineReverse: {
    transform: [{ rotate: '-29deg' }],
  },
  launchScanBeam: {
    position: 'absolute',
    top: '50%',
    width: 74,
    height: 3,
    marginTop: -1,
    borderRadius: 3,
    backgroundColor: colors.neonPurple,
  },
  launchRouteNode: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 110,
    backgroundColor: softSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  launchWalletNode: {
    width: 102,
    minHeight: 108,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    padding: spacing.sm,
    shadowColor: '#25184D',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.11,
    shadowRadius: 20,
    elevation: 4,
  },
  launchWalletIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    marginBottom: spacing.sm,
  },
  launchWalletTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  launchWalletSub: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  launchIdentityCard: {
    position: 'absolute',
    width: 132,
    minHeight: 92,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    padding: 8,
    opacity: 0.94,
    shadowColor: '#24144E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  launchIdentityNorthWest: {
    left: 0,
    top: 12,
  },
  launchIdentityNorthEast: {
    right: 0,
    top: 86,
  },
  launchIdentitySouthWest: {
    left: 4,
    top: 256,
  },
  launchIdentitySouthEast: {
    right: 2,
    top: 318,
  },
  launchIdentityAccent: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  launchIdentityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  launchAvatarShell: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: 1,
  },
  launchIdentityCopy: {
    flex: 1,
    minWidth: 0,
  },
  launchIdentityHandle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  launchIdentityWallet: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  launchIdentityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#F0EAFB',
  },
  launchIdentityDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
  },
  launchIdentityStatus: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  launchFooter: {
    alignItems: 'center',
    gap: 6,
  },
  launchHeadline: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
    fontWeight: '800',
  },
  launchFooterLabel: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '700',
  },
  launchDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  launchDot: {
    width: 9,
    height: 9,
    borderRadius: 9,
  },
  launchDotTeal: {
    backgroundColor: '#0EA5A4',
  },
  launchDotPurple: {
    backgroundColor: colors.neonPurple,
  },
  launchDotGold: {
    backgroundColor: '#F59E0B',
  },
  brandMark: {
    width: 74,
    height: 74,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: softSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandMarkSmall: {
    width: 58,
    height: 58,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: softSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tag: {
    color: colors.cyan,
    letterSpacing: 1.8,
    fontSize: 11,
    fontFamily: fonts.regular,
  },
  onboardingHeader: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  onboardingHeaderText: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  onboardingScreen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  onboardingWordmark: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  onboardingHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  identityStage: {
    width: '100%',
    height: 330,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityPulseRing: {
    position: 'absolute',
    width: 214,
    height: 214,
    borderRadius: 214,
    backgroundColor: accentSoft,
    borderWidth: 1,
    borderColor: accentBorder,
  },
  onboardingIdentityPreview: {
    position: 'absolute',
    width: 136,
    alignItems: 'center',
  },
  onboardingIdentityPreviewLeft: {
    left: 8,
    top: 128,
  },
  onboardingIdentityPreviewCenter: {
    left: '50%',
    marginLeft: -68,
    top: 34,
  },
  onboardingIdentityPreviewRight: {
    right: 8,
    top: 146,
  },
  identityAvatarShell: {
    width: 96,
    height: 96,
    borderRadius: 96,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#6B3BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  identityHandlePill: {
    marginTop: spacing.sm,
    minWidth: 112,
    maxWidth: 136,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  identityHandleText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  onboardingShortLine: {
    maxWidth: 300,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  onboardingAction: {
    paddingBottom: spacing.sm,
  },
  walletEntryScreen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  walletEntryHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  walletEntryStage: {
    width: '100%',
    height: 330,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletEntryPulseRing: {
    position: 'absolute',
    width: 218,
    height: 218,
    borderRadius: 218,
    backgroundColor: accentSoft,
    borderWidth: 1,
    borderColor: accentBorder,
  },
  walletEntryIdentityCard: {
    position: 'absolute',
    left: 12,
    top: 92,
    width: 142,
    alignItems: 'center',
  },
  walletEntryAvatarShell: {
    width: 92,
    height: 92,
    borderRadius: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#6B3BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  walletEntryHandlePill: {
    marginTop: spacing.sm,
    width: 136,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accentBorder,
    backgroundColor: surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  walletEntryHandleText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  walletEntryConnector: {
    width: 86,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.neonPurple,
  },
  walletEntryWalletBubble: {
    position: 'absolute',
    right: 22,
    top: 128,
    width: 104,
    height: 104,
    borderRadius: 104,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#6B3BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  walletEntryCopy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  walletEntryTitle: {
    maxWidth: 310,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  walletEntryLine: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  walletEntryActions: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  authGatewayScreen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  authGatewayHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  authLookupLoader: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  authFoundVisual: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authFoundRing: {
    position: 'absolute',
    width: 208,
    height: 208,
    borderRadius: 208,
    backgroundColor: accentSoft,
    borderWidth: 1,
    borderColor: accentBorder,
    opacity: 0.38,
  },
  authFoundAvatarShell: {
    width: 112,
    height: 112,
    borderRadius: 112,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#6B3BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  authGatewayCopy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  authGatewayEyebrow: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  authGatewayTitle: {
    maxWidth: 310,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  authFoundHandlePill: {
    maxWidth: 220,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accentBorder,
    backgroundColor: surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  authFoundHandleText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  authGatewayError: {
    maxWidth: 310,
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  authGatewayActions: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  walletFlowCard: {
    backgroundColor: softSurface,
    borderColor: colors.border,
  },
  walletFlowLoaderCard: {
    backgroundColor: softSurface,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  walletFlowLoaderTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  walletFlowLoaderBody: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  inlineToast: {
    borderWidth: 1,
    borderColor: accentBorder,
    backgroundColor: '#3A1C8D',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  inlineToastText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  homeHandle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  homeSubText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  cardTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  monoValue: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  monoSoft: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  backText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  methodTab: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
    paddingVertical: 12,
    alignItems: 'center',
  },
  methodTabActive: {
    borderColor: colors.neonPurple,
    backgroundColor: accentSoft,
  },
  methodText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  methodTextActive: {
    color: colors.text,
  },
  seedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  seedWordPill: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  seedWordText: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  successText: {
    color: colors.success,
    fontFamily: fonts.regular,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  errorTextSmall: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  identityPreview: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  handlePress: {
    alignSelf: 'flex-start',
  },
  homeAvatarImage: {
    width: 58,
    height: 58,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  balanceCard: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.neonPurple,
    backgroundColor: colors.neonPurple,
    gap: spacing.md,
  },
  balanceLabel: {
    color: '#E7DAFF',
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  balanceHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  balanceEyeButton: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValue: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '700',
  },
  balanceSub: {
    color: '#E7DAFF',
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  balanceButtonsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  balanceButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  balanceButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLink: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  settingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingIconBubble: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingTextBlock: {
    flex: 1,
    gap: 3,
  },
  settingTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  settingDescription: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  secretEyeButton: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secretBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  secretLabel: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  secretValue: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  secretCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: surface,
  },
  secretCopyText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  secretCopyTextDisabled: {
    color: colors.textDim,
  },
  featureRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  rowTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  rowTitleValue: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    maxWidth: '62%',
    textAlign: 'right',
  },
  rowBody: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  activityTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  activityMeta: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  recipientPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recipientAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  recipientPreviewTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
  },
  recipientPreviewSub: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  beneficiaryList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  beneficiaryHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  beneficiaryHeaderMeta: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  beneficiaryChevron: {
    transform: [{ rotate: '0deg' }],
  },
  beneficiaryChevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  beneficiaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: surface,
  },
  beneficiaryAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  beneficiaryName: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 17,
  },
  beneficiaryHandle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  beneficiaryPromptActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  beneficiaryPromptButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: surface,
  },
  beneficiaryPromptButtonText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  beneficiaryPromptButtonPrimary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.neonPurple,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: colors.neonPurple,
  },
  beneficiaryPromptButtonPrimaryText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  amountModeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  amountModeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  amountModeButtonActive: {
    borderColor: colors.neonPurple,
    backgroundColor: accentSoft,
  },
  amountModeButtonText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  amountModeButtonTextActive: {
    color: colors.neonPurple,
  },
  amountMaxButton: {
    borderWidth: 1,
    borderColor: accentBorder,
    borderRadius: radius.sm,
    backgroundColor: softSurface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountMaxButtonPressed: {
    opacity: 0.85,
  },
  amountMaxButtonDisabled: {
    opacity: 0.55,
  },
  amountMaxButtonText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  amountMaxButtonTextDisabled: {
    color: colors.textDim,
  },
  feeSummaryPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 7,
  },
  feeSummaryPanelWarning: {
    borderColor: colors.danger,
    borderWidth: 1.5,
    backgroundColor: dangerPanel,
  },
  feeSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  feeSummaryLabel: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  feeSummaryValue: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
    flexShrink: 1,
  },
  feeSummaryValueWarning: {
    color: colors.danger,
    fontWeight: '700',
  },
  feeSummaryWarning: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  feeSummaryMeta: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
  },
  sendErrorPanel: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    backgroundColor: dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 3,
  },
  sendErrorTitle: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  sendErrorBody: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  infoText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  inlineLinkButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  inlineLinkText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  txFilterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  txFilterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  txFilterChipActive: {
    borderColor: colors.neonPurple,
    backgroundColor: accentSoft,
  },
  txFilterChipText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  txFilterChipTextActive: {
    color: colors.neonPurple,
  },
  txSectionWrap: {
    gap: spacing.sm,
  },
  txSectionTitle: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: 0.25,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  txListCard: {
    paddingVertical: 4,
    gap: 0,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  txRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EFE8FF',
  },
  txRowPressed: {
    opacity: 0.78,
  },
  txRowAvatarImage: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  txRowTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  txRowMeta: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  txRowRight: {
    alignItems: 'flex-end',
    gap: 3,
    maxWidth: '45%',
  },
  txRowAmount: {
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  txRowAmountPositive: {
    color: colors.success,
  },
  txRowAmountNegative: {
    color: colors.text,
  },
  txRowStatus: {
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  txRowStatusSuccess: {
    color: colors.success,
  },
  txRowStatusWarning: {
    color: colors.warning,
  },
  txRowStatusDanger: {
    color: colors.danger,
  },
  txRowStatusMuted: {
    color: colors.textDim,
  },
  txDetailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 10, 30, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  txDetailCard: {
    width: '100%',
    backgroundColor: surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  txDetailTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    flex: 1,
    paddingRight: spacing.sm,
  },
  txDetailStatusPill: {
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: successSoft,
  },
  txDetailStatusPillWarning: {
    borderColor: colors.warning,
    backgroundColor: warningSoft,
  },
  txDetailStatusPillDanger: {
    borderColor: colors.danger,
    backgroundColor: dangerSoft,
  },
  txDetailStatusText: {
    color: colors.success,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  txDetailStatusTextWarning: {
    color: colors.warning,
  },
  txDetailStatusTextDanger: {
    color: colors.danger,
  },
  txDetailRecipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  txDetailRecipientRowPressed: {
    opacity: 0.78,
  },
  txDetailRecipientImage: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  txDetailRecipientName: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
  },
  txDetailRecipientMeta: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  txDetailBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: softSurface,
    padding: spacing.md,
    gap: 8,
  },
  txDetailLabel: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  txDetailReference: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  txDetailMemo: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  txDetailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  txDetailProfileButton: {
    flex: 1,
    minWidth: 96,
    borderWidth: 1,
    borderColor: accentBorder,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: accentSoft,
  },
  txDetailProfileText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  txDetailCopyButton: {
    flex: 1,
    minWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 11,
    backgroundColor: surface,
  },
  txDetailCopyText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  txDetailDoneButton: {
    flex: 1,
    minWidth: 96,
    borderWidth: 1,
    borderColor: colors.neonPurple,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: colors.neonPurple,
  },
  txDetailDoneText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  identityProfileBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 10, 30, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  identityProfileCard: {
    width: '100%',
    backgroundColor: surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  identityProfileTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
  },
  identityProfileCloseButton: {
    borderWidth: 1,
    borderColor: accentBorder,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: accentSoft,
  },
  identityProfileCloseText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  identityProfileLoading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  identityProfileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityProfileAvatarImage: {
    width: 68,
    height: 68,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  identityProfileName: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
  },
  identityProfileHandle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  txModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 10, 30, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  txModalCard: {
    width: '100%',
    backgroundColor: surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  txModalTitle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    flex: 1,
    paddingRight: spacing.sm,
  },
  txModalSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  txModalStatusPill: {
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: successSoft,
  },
  txModalStatusPillWarning: {
    borderColor: colors.warning,
    backgroundColor: warningSoft,
  },
  txModalStatusText: {
    color: colors.success,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  txModalStatusTextWarning: {
    color: colors.warning,
  },
  txModalMetaCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: softSurface,
    padding: spacing.md,
    gap: 6,
  },
  txModalMetaLabel: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  txModalMetaValue: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
  },
  txRecipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  txRecipientImage: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  txModalReference: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  txModalDetail: {
    color: colors.warning,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  txModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  txModalCopyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 11,
    backgroundColor: surface,
  },
  txModalCopyText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  txModalDoneButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.neonPurple,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: colors.neonPurple,
  },
  txModalDoneText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  qrWrap: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: surface,
    marginTop: spacing.md,
  },
  copyRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copyText: {
    color: colors.neonBlue,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  inlineActionButton: {
    borderWidth: 1,
    borderColor: accentBorder,
    backgroundColor: accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inlineActionButtonPressed: {
    opacity: 0.82,
  },
  inlineActionButtonText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileAvatarImage: {
    width: 74,
    height: 74,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
  },
  profileLogoutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 82,
    alignItems: 'center',
  },
  profileLogoutButtonPressed: {
    opacity: 0.82,
  },
  profileLogoutButtonDisabled: {
    opacity: 0.55,
  },
  profileLogoutButtonText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 12,
    fontWeight: '700',
  },
  avatarPickerSection: {
    gap: spacing.sm,
  },
  avatarPickerLabel: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  avatarPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  avatarOption: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOptionSelected: {
    borderColor: colors.neonPurple,
    backgroundColor: accentSoft,
  },
  avatarOptionPressed: {
    opacity: 0.85,
  },
  sectionTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionTab: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: surface,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sectionTabActive: {
    borderColor: colors.neonPurple,
    backgroundColor: accentSoft,
  },
  sectionTabText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  sectionTabTextActive: {
    color: colors.neonPurple,
  },
  profileName: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
  },
  profileIdentity: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 2,
  },
  profileShowcaseCard: {
    borderWidth: 1,
    borderColor: accentBorder,
    backgroundColor: softSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  profileShowcaseTitle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  profileShowcaseHandle: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  profileDetailsWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: surface,
    overflow: 'hidden',
  },
  profileDetailRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE8FF',
    gap: 6,
  },
  profileDetailRowLast: {
    borderBottomWidth: 0,
  },
  profileDetailLabel: {
    color: colors.textDim,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  profileDetailValue: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
  },
  primaryTag: {
    color: colors.success,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  })
}
