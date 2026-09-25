// expo-router 루트 레이아웃 (Stack)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// FEAT-004: 백그라운드 세션 파이프라인/지오펜스 태스크를 전역 스코프에서 등록한다.
// TaskManager.defineTask 는 Expo 요구상 모듈 로드 시점(전역)에서 정의되어야 하므로,
// 이 두 모듈을 import 하는 것만으로 태스크가 등록된다(사이드이펙트 import).
import '../src/session/backgroundTask';
import '../src/sensors/geofenceController';
// FEAT-006: 최초 실행 시 단계적 권한 온보딩으로 유도한다(완료 후 스킵).
import { isOnboardingComplete } from '../src/storage/onboarding';
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
      const done = await isOnboardingComplete();
      if (mounted) setOnboardingDone(done);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (onboardingDone === null) return; // 아직 조회 중
    const inOnboarding = segments[0] === 'onboarding';
    if (!onboardingDone && !inOnboarding) {
      // 최초 실행 & 온보딩 밖 -> 온보딩으로 유도.
      router.replace('/onboarding');
    }
  }, [onboardingDone, segments, router]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitleAlign: 'center' }}>
        <Stack.Screen name="index" options={{ title: '보행 안전 점수' }} />
        <Stack.Screen name="map" options={{ title: '위험 지도' }} />
        <Stack.Screen name="report" options={{ title: 'WSS 리포트' }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/permissions" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
