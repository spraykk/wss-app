// 홈 화면 - 보행 세션 시작/중지 (상태 중심 UI)
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// FEAT-002: 진행 중 실시간 점수 카드를 제거했다. 예전에는 computeWSS(segments) 로
// 계산한 displayScore 를 상단 대형 카드에 상시 렌더했는데, '보행 종료' 시 세션이 비워지면
// computeWSS([]) 가 100 을 돌려줘 종료 직후 100점이 잘못 표시되는 버그가 있었다.
// 이제 홈은 상태(측정 시작 / 측정 중 / 종료 결과) 중심으로 구성하고, 점수는 오직
// '보행 종료' 직후 useWalkSession.stop() 이 반환한 그 세션의 최종 결과로만 안내한다.
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useWalkSession } from '../src/hooks/useWalkSession';
import type { WSSResult } from '../src/types';
import { useAudioEnvironment } from '../src/sensors/useAudioEnvironment';
import { isEarEffectivelyOccluded } from '../src/sensors/audioState';
import { palette, spacing, radius, font, shadow } from '../src/theme';

export default function HomeScreen() {
  const { isTracking, start, stop } = useWalkSession();

  // 방금 종료한 보행의 결과(없으면 null). '측정 시작' 시 초기화한다.
  const [lastResult, setLastResult] = useState<WSSResult | null>(null);
  // 세그먼트 없이 종료해 표시할 점수가 없었던 경우를 구분해 안내 문구를 띄운다.
  const [endedWithoutWalk, setEndedWithoutWalk] = useState(false);

  // FEAT-002: 자동 감지된 오디오 상태를 읽기 전용으로만 표시(수동 컨트롤 없음).
  const audioEnv = useAudioEnvironment();
  const earOccluded = isEarEffectivelyOccluded(audioEnv);
  const audioStatusText = earOccluded
    ? '이어폰(블루투스)+재생 감지됨 · 청각 주의'
    : '이어폰 재생 미감지 · 주변음 인지 가능';

  const handleStart = (): void => {
    // 이전 종료 결과/안내를 초기화한 뒤 측정을 시작한다.
    setLastResult(null);
    setEndedWithoutWalk(false);
    void start();
  };

  const handleStop = (): void => {
    void (async () => {
      const r = await stop();
      setLastResult(r);
      setEndedWithoutWalk(r === null);
    })();
  };

  // 종료 결과 카드 색상은 이 결과에만 국한해 적용한다(상시 점수 표시 아님).
  const resultDanger = lastResult?.belowCriticalThreshold ?? false;

  return (
    <View style={styles.container}>
      {isTracking ? (
        // 측정 중: 큰 점수 카드 대신 '측정 중' 상태만 표시한다.
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>측정 중</Text>
          <Text style={styles.statusHint}>보행이 끝나면 점수를 알려드릴게요</Text>
        </View>
      ) : lastResult ? (
        // 종료 결과: 방금 세션의 최종 displayScore 를 정수(점)로 안내한다.
        <View
          style={[
            styles.resultCard,
            resultDanger ? styles.resultCardDanger : styles.resultCardSafe,
          ]}
        >
          <Text style={styles.resultLabel}>이번 보행의 점수는</Text>
          <Text
            style={[
              styles.resultScore,
              resultDanger ? styles.resultScoreDanger : styles.resultScoreSafe,
            ]}
          >
            {Math.round(lastResult.displayScore)}점입니다
          </Text>
        </View>
      ) : endedWithoutWalk ? (
        // 세그먼트 0으로 종료 -> 100점을 띄우지 않고 안내만 한다.
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>측정된 보행이 없어요</Text>
          <Text style={styles.statusHint}>보행을 측정해 안전 점수를 확인해요</Text>
        </View>
      ) : (
        // 최초/대기 상태: 시작 유도.
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>보행 안전 측정</Text>
          <Text style={styles.statusHint}>보행을 측정해 안전 점수를 확인해요</Text>
        </View>
      )}

      <View style={styles.audioChip}>
        <Text style={styles.audioStatus}>{audioStatusText}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, isTracking ? styles.stop : styles.start]}
        onPress={isTracking ? handleStop : handleStart}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{isTracking ? '보행 종료' : '측정 시작'}</Text>
      </TouchableOpacity>

      <View style={styles.links}>
        <Link href="/map" style={styles.link}>
          위험 지도 보기
        </Link>
        <Link href="/report" style={styles.link}>
          리포트 보기
        </Link>
        {/* FEAT-002: 개발/진단용 실시간 패널. 점수가 왜 안 떨어지는지 단계별 값 확인. */}
        <Link href="/diagnostics" style={styles.link}>
          진단 패널(개발용)
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
  statusCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  statusTitle: { fontSize: font.title, color: palette.text, fontWeight: '800' },
  statusHint: { fontSize: font.label, color: palette.textMuted, fontWeight: '600' },
  resultCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  resultCardSafe: { backgroundColor: palette.safeBg },
  resultCardDanger: { backgroundColor: palette.dangerBg },
  resultLabel: { fontSize: font.label, color: palette.textMuted, fontWeight: '600' },
  resultScore: { fontSize: font.hero, fontWeight: '800' },
  resultScoreSafe: { color: palette.safeText },
  resultScoreDanger: { color: palette.dangerText },
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
