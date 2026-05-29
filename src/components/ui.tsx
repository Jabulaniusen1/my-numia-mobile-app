import React, { useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native'
import { colors, fonts, radius, spacing } from '../theme/tokens'

export function Screen({
  children,
  scroll = false,
  style,
  flushBottom = false,
}: {
  children: React.ReactNode
  scroll?: boolean
  style?: StyleProp<ViewStyle>
  flushBottom?: boolean
}) {
  const safeEdges = flushBottom
    ? (['top', 'right', 'left'] as const)
    : (['top', 'right', 'bottom', 'left'] as const)

  return (
    <View style={styles.root}>
      <SafeAreaView edges={safeEdges} style={styles.safeArea}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[
              styles.scrollContainer,
              flushBottom && styles.flushBottom,
              style,
            ]}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.body, flushBottom && styles.flushBottom, style]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  )
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>
}

export function Subtitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.subtitle, style]}>{children}</Text>
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 10,
  style,
}: {
  width?: number | `${number}%`
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  const opacity = useRef(new Animated.Value(0.56)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.98,
          duration: 860,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.56,
          duration: 860,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )

    pulse.start()
    return () => pulse.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius,
          opacity,
        },
        style,
      ]}
    />
  )
}

export function SkeletonText({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  lastLineWidth = '70%',
}: {
  lines?: number
  lineHeight?: number
  gap?: number
  lastLineWidth?: number | `${number}%`
}) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          // eslint-disable-next-line react/no-array-index-key
          key={`skeleton_line_${index}`}
          height={lineHeight}
          width={index === lines - 1 ? lastLineWidth : '100%'}
          radius={8}
        />
      ))}
    </View>
  )
}

export function IconBubble({ icon, color = colors.neonBlue, size = 20 }: { icon: IconSvgElement; color?: string; size?: number }) {
  return (
    <View style={styles.iconBubble}>
      <HugeiconsIcon icon={icon} size={size} color={color} strokeWidth={1.8} />
    </View>
  )
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  loading?: boolean
}) {
  const isPrimary = variant === 'primary'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.buttonWrap, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      {isPrimary ? (
        <View style={styles.buttonPrimary}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonPrimaryText}>{label}</Text>}
        </View>
      ) : (
        <View style={[styles.buttonSecondary, variant === 'ghost' && styles.buttonGhost]}>
          {loading ? (
            <ActivityIndicator color={colors.neonPurple} />
          ) : (
            <Text style={[styles.buttonSecondaryText, variant === 'ghost' && styles.buttonGhostText]}>{label}</Text>
          )}
        </View>
      )}
    </Pressable>
  )
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoCapitalize = 'none',
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  autoCapitalize?: TextInputProps['autoCapitalize']
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  )
}

export function Divider() {
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safeArea: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  flushBottom: {
    paddingBottom: 0,
  },
  title: {
    color: colors.text,
    fontSize: 29,
    lineHeight: 34,
    fontFamily: fonts.regular,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.regular,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeleton: {
    backgroundColor: '#E8E0FA',
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1EBFF',
    borderWidth: 1,
    borderColor: '#E2D6FF',
  },
  buttonWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPrimary: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neonPurple,
  },
  buttonPrimaryText: {
    color: '#FFFFFF',
    fontFamily: fonts.regular,
    fontSize: 16,
    letterSpacing: 0.15,
  },
  buttonSecondary: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#DCCFFF',
  },
  buttonGhost: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.border,
  },
  buttonSecondaryText: {
    color: colors.neonPurple,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  buttonGhostText: {
    color: colors.textMuted,
  },
  inputGroup: {
    gap: spacing.sm,
  },
  inputLabel: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.regular,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  divider: {
    height: 1,
    backgroundColor: '#EEE7FF',
  },
})
