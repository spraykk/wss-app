// expo-router 루트 레이아웃 (Stack)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { palette } from '../src/theme';
// FEAT-003 (Option A - Step 1): confirmedUse(확인된 사용)의 유일한 증거 소스.
// 루트에서 캡처 단계 터치 핸들러로 "실제 인앱 상호작용" 시각을 기록한다.
import { recordInteraction } from '../src/session/interactionTracker';
// FEAT-004: 백그라운드 세션 파이프라인/지오펜스 태스크를 전역 스코프에서 등록한다.
// TaskManager.defineTask 는 Expo 요구상 모듈 로드 시점(전역)에서 정의되어야 하므로,
// 이 두 모듈을 import 하는 것만으로 태스크가 등록된다(사이드이펙트 import).
import '../src/session/backgroundTask';
import '../src/sensors/geofenceController';
// FEAT-006: 최초 실행 시 단계적 권한 온보딩으로 유도한다(완료 후 스킵).
import {
  isOnboardingComplete,
  subscribeOnboardingComplete,
  wasCompletedThisSession,
} from '../src/storage/onboarding';
// 보행 세션용 "측정 중" 지속 알림의 Android 채널을 앱 시작 시 1회 준비한다(iOS 무해).
import { ensureTrackingChannel } from '../src/notifications/alerts';

export default function RootLayout() {
  // onboardingDone: null=조회중, true/false=결과. 조회 완료 전에는 리다이렉트하지 않는다.
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let mounted = true;
    // Android 지속 알림 채널을 미리 준비(iOS/미지원/실패 시 조용히 no-op).
    void ensureTrackingChannel().catch(() => {});
    void (async () => {
      // 이번 세션에서 이미 완료 신호가 있었다면(경합 상황) 곧바로 true 로 반영한다.
      const done = wasCompletedThisSession() || (await isOnboardingComplete());
      if (mounted) setOnboardingDone(done);
    })();
    // 온보딩 완료 신호를 구독한다. onFinish -> markOnboardingComplete 가 이 세션에서
    // 완료를 저장하면, AsyncStorage 재조회 없이 즉시 게이트 상태를 true 로 갱신한다.
    // 이로써 router.replace('/') 직후에도 홈에서 다시 온보딩으로 튕기지 않는다.
    const unsubscribe = subscribeOnboardingComplete(() => {
      if (mounted) setOnboardingDone(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (onboardingDone === null) return; // 아직 조회 중
    // 이번 세션에서 이미 온보딩을 완료했다면, 상태(onboardingDone)가 아직 true 로
    // 커밋되기 전이라도 절대 온보딩으로 되돌리지 않는다. router.replace('/') 로 인한
    // segments 변경이 setOnboardingDone(true) 커밋보다 먼저 관찰되는 경합에서도
    // 루프를 원천 차단한다(콜드 재시작 시 이 플래그는 false 로 초기화된다).
    if (wasCompletedThisSession()) return;
    const inOnboarding = segments[0] === 'onboarding';
    if (!onboardingDone && !inOnboarding) {
      // 최초 실행 & 온보딩 밖 -> 온보딩으로 유도.
      router.replace('/onboarding');
    }
  }, [onboardingDone, segments, router]);

  // FEAT-003: 루트 View 에 캡처 단계 터치 핸들러를 걸어, 어떤 화면(ScrollView/
  // TouchableOpacity 등)에서든 실제 사용자 상호작용이 시작될 때 recordInteraction() 을
  // 호출한다. onStartShouldSetResponderCapture 는 캡처 단계에서 "터치 시작"을 관측만 하고
  // false 를 돌려주어 responder 권한을 가져가지 않으므로 자식 터치를 절대 막지 않는다.
  // 정직성: 이 신호는 앱이 "포그라운드"일 때만 발생한다. 백그라운드/타앱 사용 시간은
  // 여기서 관측되지 않으며, 그 시간은 usageClassification.ts 에서 unknownUse 로 처리된다.
  const onTouchCapture = (): boolean => {
    recordInteraction();
    return false; // responder 권한을 가져가지 않음 -> 자식 터치 그대로 통과.
  };

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={onTouchCapture}
      onMoveShouldSetResponderCapture={onTouchCapture}
    >
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: palette.sky },
          headerTintColor: palette.text,
          headerTitleStyle: { fontWeight: '800', color: palette.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '보행 개선' }} />
        <Stack.Screen name="map" options={{ title: '위험 지도' }} />
        <Stack.Screen name="report" options={{ title: 'WSS 리포트' }} />
        <Stack.Screen name="feedback" options={{ title: '의견 보내기' }} />
        {/* 방식1(Step 2 준비): 자세 측정/기록 도구 화면. 아직 WSS 점수에 반영 안 함(측정용). */}
        <Stack.Screen name="posture-lab" options={{ title: '자세 측정 도구' }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/permissions" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
