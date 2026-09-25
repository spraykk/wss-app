// 로컬 알림 래퍼 (expo-notifications)
//
// 고위험 zone 에 진입한 상태에서 휴대폰을 사용 중이면 로컬 알림으로 경고한다.
// 또한 보행 세션이 진행 중인 동안 상단에 "측정 중" 지속 알림을 유지한다.
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// 진행 중 세션을 나타내는 지속 알림의 고정 식별자. 이 식별자로 표시/해제를 정확히 제어한다.
const TRACKING_NOTIFICATION_ID = 'wss-tracking';
// Android 지속 알림 채널 식별자.
const TRACKING_CHANNEL_ID = 'wss-tracking';

// 포그라운드에서도 알림 배너/사운드를 표시하도록 핸들러를 설정한다.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 알림 권한을 요청한다. 이미 허용되어 있으면 그대로 true 를 반환한다.
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// 고위험 zone 진입 + 휴대폰 사용 중일 때 즉시 로컬 알림을 표시한다.
export async function presentHighRiskAlert(zoneName: string): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '보행 안전 경고',
      body: `${zoneName} 사고다발지역입니다. 휴대폰 사용을 멈추고 주변을 살펴 주세요.`,
      sound: true,
    },
    trigger: null, // 즉시 표시
  });
}

// WSS 원점수가 위험 구간(임계점 60점 미만, belowCriticalThreshold)으로 떨어졌을 때
// 표시하는 추가 위험 알림. 고위험 zone 진입 경고(presentHighRiskAlert)와 별개로,
// "점수 자체가 위험 구간"임을 알린다. 권한이 없으면 조용히 no-op 한다.
export async function presentCriticalScoreAlert(): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '보행 안전 경고',
      body: '현재 점수가 위험 구간(60점 미만)입니다. 스마트폰 사용을 멈추고 주변을 살펴 주세요.',
      sound: true,
    },
    trigger: null, // 즉시 표시
  });
}

// Android 전용: 지속 알림용 저중요도 채널을 준비한다(1회 등록으로 충분, 반복 호출 무해).
// iOS 에는 채널 개념이 없으므로 no-op. 권한/미지원 시 조용히 무시한다.
export async function ensureTrackingChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(TRACKING_CHANNEL_ID, {
      name: '보행 안전 측정',
      // LOW 중요도: 소리/헤드업 없이 상태바에 조용히 유지된다.
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: [0],
      enableVibrate: false,
    });
  } catch {
    // 미지원/실패 -> 조용히 무시.
  }
}

// 보행 세션이 진행 중인 동안 상단에 유지되는 "측정 중" 지속 알림을 표시한다.
// 고정 식별자를 사용하므로 이미 표시 중이면 같은 알림을 덮어써 중복이 생기지 않는다.
//
// Android: LOW 중요도 채널 + sticky/ongoing 으로 사용자가 스와이프로 지울 수 없게 유지한다.
// iOS: 시스템상 "완전히 고정되어 지울 수 없는" 로컬 알림은 없다. 일반 로컬 알림으로
//   상단/알림센터에 남겨 두며, 사용자가 수동으로 밀어낼 수 있다는 한계가 있다(추후
//   Live Activities 로 개선 예정). 종료 시에는 dismissTrackingNotification 으로 제거된다.
// 권한이 없거나 런타임 미지원이면 세션을 깨지 않도록 조용히 no-op 한다.
export async function presentTrackingNotification(): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;
    await ensureTrackingChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: TRACKING_NOTIFICATION_ID,
      content: {
        title: '보행 안전 측정 중',
        body: '보행 세션이 진행 중입니다. 위험구역 진입 시 알려드려요.',
        sound: null, // 조용히 유지(경고음 없음)
        // Android 에서 스와이프로 지워지지 않도록 고정한다(iOS 에는 영향 없음).
        sticky: true,
        autoDismiss: false,
      },
      // Android: 채널 지정(즉시 표시). iOS: 채널 개념이 없어 즉시(null) 표시.
      trigger:
        Platform.OS === 'android' ? { channelId: TRACKING_CHANNEL_ID } : null,
    });
  } catch {
    // 권한 거부/미지원/런타임 오류 -> 세션에 영향 없이 no-op.
  }
}

// 진행 중 세션이 끝났을 때 "측정 중" 지속 알림을 고정 식별자 기준으로 정확히 제거한다.
// 이미 표시된 알림(dismiss) 과 예약분(cancel) 모두 정리한다. 실패 시 no-op.
export async function dismissTrackingNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
  } catch {
    // 표시된 알림이 없거나 미지원 -> 무시.
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(TRACKING_NOTIFICATION_ID);
  } catch {
    // 예약분이 없거나 미지원 -> 무시.
  }
}
