import Constants from 'expo-constants'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

export type PushRegistration = {
  token: string
  platform: string
  deviceName?: string
}

type ExpoNotifications = typeof import('expo-notifications')

let notificationHandlerConfigured = false

async function loadNotifications(): Promise<ExpoNotifications | null> {
  if (Platform.OS === 'web') {
    return null
  }

  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    console.warn('[notifications] Android remote push needs a development build, not Expo Go.')
    return null
  }

  try {
    return await import('expo-notifications')
  } catch (error) {
    console.warn('[notifications] expo-notifications is unavailable', error)
    return null
  }
}

function configureNotificationHandler(Notifications: ExpoNotifications) {
  if (notificationHandlerConfigured) {
    return
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })

  notificationHandlerConfigured = true
}

function getProjectId(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  )
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistration | null> {
  const Notifications = await loadNotifications()
  if (!Notifications) {
    return null
  }

  configureNotificationHandler(Notifications)

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('money', {
      name: 'Money transfers',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6D3BFF',
    })
  }

  const existingPermission = await Notifications.getPermissionsAsync()
  let finalStatus = existingPermission.status

  if (finalStatus !== 'granted') {
    const requestedPermission = await Notifications.requestPermissionsAsync()
    finalStatus = requestedPermission.status
  }

  if (finalStatus !== 'granted') {
    return null
  }

  try {
    const projectId = getProjectId()
    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync()

    return {
      token: tokenResult.data,
      platform: Platform.OS,
      deviceName: Device.deviceName ?? Device.modelName ?? undefined,
    }
  } catch (error) {
    console.warn('[notifications] Unable to get Expo push token', error)
    return null
  }
}
