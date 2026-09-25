// 홈 화면 - 보행 세션 시작/중지 및 실시간 WSS 표시
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useWalkSession } from '../src/hooks/useWalkSession';
import { computeWSS } from '../src/wss/engine';
import { useAudioEnvironment } from '../src/sensors/useAudioEnvironment';
import { isEarEffectivelyOccluded } from '../src/sensors/audioState';
import { palette, spacing, radius, font, shadow } from '../src/theme';

export default function HomeScreen() {
  const { segments, isTracking, start, stop } = useWalkSession();

  const wss = useMemo(() => computeWSS(segments), [segments]);

  // FEAT-002: 자동 감지된 오디오 상태를 읽기 전용으로만 표시(수동 컨트롤 없음).
  const audioEnv = useAudioEnvironment();
  const earOccluded = isEarEffectivelyOccluded(audioEnv);
  const audioStatusText = earOccluded
    ? '이어폰(블루투스)+재생 감지됨 · 청각 주의'
    : '이어폰 재생 미감지 · 주변음 인지 가능';

  // 상태(안전/위험)를 파스텔 색으로 직관 표현. 로직/임계값은 기존 그대로.
  const danger = wss.belowCriticalThreshold;
  const scoreCardStyle = danger ? styles.scoreCardDanger : styles.scoreCardSafe;
  const scoreTextStyle = danger ? styles.scoreDanger : styles.scoreSafe;
  const badgeStyle = danger ? styles.badgeDanger : styles.badgeSafe;
  const badgeTextStyle = danger ? styles.badgeTextDanger : styles.badgeTextSafe;

  return (
    <View style={styles.container}>
      <View style={[styles.scoreCard, scoreCardStyle]}>
        <Text style={styles.scoreLabel}>현재 보행 안전 점수</Text>
        <Text style={[styles.score, scoreTextStyle]}>{Math.round(wss.displayScore)}</Text>
        <View style={[styles.badge, badgeStyle]}>
          <Text style={[styles.badgeText, badgeTextStyle]}>
            {danger ? '주의: 위험 수준입니다' : '안전하게 걷고 있어요'}
          </Text>
        </View>
      </View>

      <View style={styles.audioChip}>
        <Text style={styles.audioStatus}>{audioStatusText}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, isTracking ? styles.stop : styles.start]}
        onPress={() => (isTracking ? void stop() : void start())}
        activeOpacity={0.85}
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
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: palette.bg,
  },
  scoreCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  scoreCardSafe: { backgroundColor: palette.safeBg },
  scoreCardDanger: { backgroundColor: palette.dangerBg },
  scoreLabel: { fontSize: font.label, color: palette.textMuted, fontWeight: '600' },
  score: { fontSize: font.score, fontWeight: '800', lineHeight: font.score + 8 },
  scoreSafe: { color: palette.safeText },
  scoreDanger: { color: palette.dangerText },
  badge: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  badgeSafe: { backgroundColor: palette.surface },
  badgeDanger: { backgroundColor: palette.surface },
  badgeText: { fontSize: font.small, fontWeight: '700' },
  badgeTextSafe: { color: palette.safeText },
  badgeTextDanger: { color: palette.dangerText },
  audioChip: {
    alignSelf: 'stretch',
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  audioStatus: { fontSize: font.small, color: palette.textMuted, textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    ...shadow.button,
  },
  start: { backgroundColor: palette.skyDeep },
  stop: { backgroundColor: palette.pinkDeep },
  buttonText: { color: palette.onDark, fontSize: font.subtitle, fontWeight: '800' },
  links: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.lg },
  link: { color: palette.skyDeep, fontSize: font.label, fontWeight: '600' },
});
