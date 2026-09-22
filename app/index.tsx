// 홈 화면 - 보행 세션 시작/중지 및 실시간 WSS 표시
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useWalkSession } from '../src/hooks/useWalkSession';
import { computeWSS } from '../src/wss/engine';
import { useAudioEnvironment } from '../src/sensors/useAudioEnvironment';
import { isEarEffectivelyOccluded } from '../src/sensors/audioState';

export default function HomeScreen() {
  const { segments, isTracking, start, stop } = useWalkSession();

  const wss = useMemo(() => computeWSS(segments), [segments]);

  // FEAT-002: 자동 감지된 오디오 상태를 읽기 전용으로만 표시(수동 컨트롤 없음).
  const audioEnv = useAudioEnvironment();
  const earOccluded = isEarEffectivelyOccluded(audioEnv);
  const audioStatusText = earOccluded
    ? '이어폰(블루투스)+재생 감지됨 · 청각 주의'
    : '이어폰 재생 미감지 · 주변음 인지 가능';

  return (
    <View style={styles.container}>
      <Text style={styles.scoreLabel}>현재 보행 안전 점수</Text>
      <Text style={styles.score}>{Math.round(wss.displayScore)}</Text>
      <Text style={styles.sub}>
        {wss.belowCriticalThreshold ? '주의: 위험 수준입니다' : '안전하게 걷고 있어요'}
      </Text>

      <Text style={styles.audioStatus}>{audioStatusText}</Text>

      <TouchableOpacity
        style={[styles.button, isTracking ? styles.stop : styles.start]}
        onPress={() => (isTracking ? stop() : void start())}
      >
        <Text style={styles.buttonText}>{isTracking ? '보행 종료' : '보행 시작'}</Text>
      </TouchableOpacity>

      <View style={styles.links}>
        <Link href="/map" style={styles.link}>
          위험 지도 보기
        </Link>
        <Link href="/report" style={styles.link}>
          리포트 보기
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  scoreLabel: { fontSize: 16, color: '#555' },
  score: { fontSize: 72, fontWeight: '800' },
  sub: { fontSize: 14, color: '#777', marginBottom: 8 },
  audioStatus: { fontSize: 13, color: '#8a6d3b', marginBottom: 24 },
  button: { paddingVertical: 14, paddingHorizontal: 40, borderRadius: 999 },
  start: { backgroundColor: '#1a7f37' },
  stop: { backgroundColor: '#b42318' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  links: { flexDirection: 'row', gap: 24, marginTop: 32 },
  link: { color: '#0b6bcb', fontSize: 16 },
});
