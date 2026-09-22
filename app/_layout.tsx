// expo-router 루트 레이아웃 (Stack)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// FEAT-004: 백그라운드 세션 파이프라인/지오펜스 태스크를 전역 스코프에서 등록한다.
// TaskManager.defineTask 는 Expo 요구상 모듈 로드 시점(전역)에서 정의되어야 하므로,
// 이 두 모듈을 import 하는 것만으로 태스크가 등록된다(사이드이펙트 import).
import '../src/session/backgroundTask';
import '../src/sensors/geofenceController';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitleAlign: 'center' }}>
        <Stack.Screen name="index" options={{ title: '보행 안전 점수' }} />
        <Stack.Screen name="map" options={{ title: '위험 지도' }} />
        <Stack.Screen name="report" options={{ title: 'WSS 리포트' }} />
      </Stack>
    </>
  );
}
