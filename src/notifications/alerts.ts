// 로컬 알림 래퍼 (expo-notifications)
//
// 고위험 zone 에 진입한 상태에서 휴대폰을 사용 중이면 로컬 알림으로 경고한다.
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import * as Notifications from 'expo-notifications';

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
