export type ThemeMode = 'light' | 'dark'

export const lightColors = {
  bg: '#F5F2FF',
  bgSoft: '#FFFFFF',
  card: '#FFFFFF',
  cardAlt: '#F8F5FF',
  border: '#E6DEF8',
  text: '#12111A',
  textMuted: '#6F6887',
  textDim: '#9B93B5',
  neonBlue: '#6B3BFF',
  neonPurple: '#6B3BFF',
  cyan: '#6B3BFF',
  success: '#169B66',
  warning: '#B46B00',
  danger: '#CF2D66',
}

export const darkColors: typeof lightColors = {
  bg: '#090713',
  bgSoft: '#100D1C',
  card: '#171321',
  cardAlt: '#211A33',
  border: '#352A4E',
  text: '#F8F5FF',
  textMuted: '#B9AECF',
  textDim: '#827799',
  neonBlue: '#9B7CFF',
  neonPurple: '#9B7CFF',
  cyan: '#68DDD7',
  success: '#4FD69F',
  warning: '#F4B861',
  danger: '#FF6B9B',
}

export type ThemeColors = typeof lightColors

export const colors = lightColors

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
}

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  full: 999,
}

export const fonts = {
  regular: 'Satoshi',
}
