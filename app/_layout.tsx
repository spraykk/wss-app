// expo-router 루트 레이아웃 (Stack)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

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
